'use strict';
/* WAVE 2-G — test/ai-match.js, the wave's golden suite.

   ai-smoke asks whether the AI is legal and honest. This asks whether it is
   THE SAME AI as yesterday, across the whole seat-count × difficulty matrix,
   and it does that the only way that actually works:

   THE HASH RULE (wave-1 inheritance, learned the hard way). Assert stateHash,
   never the scoreboard. A resume/replay fault can leave the board, the posts,
   the scores AND the supplies all correct and still be a different game —
   RNG.state is in the hash and in nothing else a test can conveniently read.
   Every golden below is a hash, and the scoreboard is only ever printed.

   Goldens live in ai-match.golden.json, next to this file, and are regenerated
   only on purpose:

       AI_MATCH_UPDATE=1 node test/ai-match.js

   A hash that moves without that flag is the suite doing its job. Read it as a
   question, not a chore: SOMETHING changed how a seeded game plays out — a
   weight, a tie-break, an enumeration order, the satchel shuffle. If that was
   the intent, regenerate and say so in the commit; if it was not, the diff
   that moved it is the bug. Adding or removing a config is also a deliberate
   act, so the config LIST is fingerprinted into the file too and a mismatch
   fails loudly rather than quietly scoring fewer games than you think.

   EVERY ASSERTION BELOW HAS BEEN SEEN TO FAIL. Each was broken once, in a
   throwaway copy of the tree, and the check that caught it is named here — an
   assertion nobody has watched fail is a comment with a PASS next to it:

     shepherd conservation  ← supplyOf() over-reports by one
     monotone scores        ← one completion pays negative points
     tile conservation      ← leftover brook tiles evaporate at brookClose
     move was offered       ← the validator offers a narrower list than the
                              enumerator used (the legalCells/legalPlacements
                              split, which is exactly what this guards)
     mid-game rebuild       ← difficulty noise pulls on RNG (the wave-1 bug)
     resumed ends the same  ← noise keyed on seat.ai.turns: session state a
                              replay never rebuilds, so the MID hash still
                              matches and ONLY continued play diverges. That
                              fault is invisible to the mid-game check, which
                              is why both exist.
     golden stateHashes     ← Maud's w_meadow nudged 1.1 → 1.15
     matrix posts shepherds ← aiPostable returns nothing, ever
     goldens are distinct   ← stateHash stops discriminating
     turn budget            ← 60 ms added to every turn

   Note the shape of the two resume checks: a fault that breaks the rebuild
   short-circuits before the end-hash comparison runs, so the mid check is the
   detector for stream-derived noise and the end check is the detector for
   anything that only diverges once the AI starts playing again.

   Usage: node test/ai-match.js */

const { load } = require('./shim');
const fs = require('fs');
const path = require('path');

const UPDATE = !!process.env.AI_MATCH_UPDATE;
const GOLDEN_PATH = path.join(__dirname, 'ai-match.golden.json');
const GOLDEN_V = 1;

let pass = 0, fail = 0;
const check = (label, ok, note) => {
  if(ok){ pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (note ? '\n  → ' + note : '')); }
  return ok;
};

let g, D, G, probe, AI;
try{
  g = load(); D = g.D; G = g.G; probe = g.probe;
  AI = global.window.AI;
}catch(e){
  console.log('FAIL  ai-match loads headlessly\n  → ' + (e && e.stack || e));
  process.exit(1);
}

const P = (expr) => { try{ return probe(expr); }catch(e){ return undefined; } };
const tileById   = P('typeof tileById==="function" ? tileById : null');
const featureAt  = P('typeof featureAt==="function" ? featureAt : null');
const boardMap   = P('typeof board!=="undefined" ? board : null');
const saveObject = P('typeof saveObject==="function" ? saveObject : null');
const replaySave = P('typeof replaySave==="function" ? replaySave : null');
const SHEPHERDS  = P('SHEPHERDS');

if(!D || typeof D.startGame !== 'function' || typeof D.stateHash !== 'function' ||
   typeof D.aiMove !== 'function' || !boardMap || !tileById || !featureAt){
  console.log('FAIL  engine + ai are loaded\n  → this suite drives whole games ' +
              'through the real input path; it has nothing to say against a stub.');
  process.exit(1);
}
check('engine + ai are loaded', true);

/* ---------------- the matrix ----------------
   Seat counts 2–5 × the three difficulties, plus a mixed-difficulty row per
   seat count (seats do not all play at one level in a real game), plus two
   brook-off rows because the opening changes which tiles the satchel holds.
   Personalities are cycled from AI.PERSONALITY_ORDER with a per-config offset,
   so no temper is stuck in seat 0 for the whole matrix — seat index is one of
   the four inputs to the difficulty-noise mixer, and a temper that only ever
   plays one seat would hide a mixer that handles seatIdx badly. */
const DIFFS = AI.DIFFICULTY_ORDER.slice();          // lamb, ewe, ram
const PERS = AI.PERSONALITY_ORDER.slice();          // wick, bram, maud, pip

function buildConfigs(){
  const out = [];
  let n = 0;
  for(const seats of [2, 3, 4, 5]){
    for(const diff of DIFFS.concat(['mixed'])){
      out.push({ seats, diff, brook:true, seed:20260808 + (n++) * 101, offset:n });
    }
  }
  out.push({ seats:2, diff:'ram',  brook:false, seed:770001, offset:1 });
  out.push({ seats:5, diff:'ewe',  brook:false, seed:770002, offset:3 });
  return out;
}
const CONFIGS = buildConfigs();
const cfgKey = (c) => c.seats + 'p/' + c.diff + '/brook' + (c.brook ? 'on' : 'off') +
                      '/seed' + c.seed;
/* The config list itself is part of what a golden file describes. */
const CONFIG_SIG = CONFIGS.map(cfgKey).join('|');

function seatsFor(c){
  const out = [];
  for(let i = 0; i < c.seats; i++) out.push({
    name: 'S' + i, human:false,
    personality: PERS[(i + c.offset) % PERS.length],
    difficulty: c.diff === 'mixed' ? DIFFS[(i + c.offset) % DIFFS.length] : c.diff,
  });
  return out;
}

/* ---------------- independent bookkeeping ----------------
   Everything asserted per turn is recomputed from the board rather than read
   from a counter the engine maintains. The point is to catch the engine, not
   to agree with it. */
function postedBySeat(){
  const n = [];
  const seen = new Set();
  for(const [key, cell] of boardMap){
    const t = tileById(cell.tileId); if(!t || !t.segs) continue;
    const comma = key.indexOf(',');
    const x = +key.slice(0, comma), y = +key.slice(comma + 1);
    for(let s = 0; s < t.segs.length; s++){
      const root = featureAt(x, y, s);
      if(!root || seen.has(root)) continue;
      seen.add(root);
      for(const sh of (root.shepherds || [])) n[sh.seat] = (n[sh.seat] || 0) + 1;
    }
  }
  return n;
}
/* Every tile the deal produced, wherever it currently is. Constant for the
   whole game INCLUDING the brook phase — brook tiles waiting in the queue are
   neither on the board nor in the satchel, so a total that ignores them is a
   weaker statement that happens to hold only from brookClose onward.
   The tile IN HAND counts too: between draw() and place() it has left the
   satchel and not yet reached the board, and a turn boundary is exactly where
   that is true. Omitting it still holds turn to turn — the hand is refilled by
   the next beginTurn — and then jumps by one at the final turn, when the game
   ends holding nothing. That is a real off-by-one in the accounting, not in
   the engine, and it is the reason this counts four places and not three. */
function tileTotal(){
  const brookLeft = G.brook ? (G.brook.queue.length + G.brook.held.length) : 0;
  return (G.satchel || []).length + boardMap.size + (G.dead || []).length + brookLeft +
         (G.drawn != null ? 1 : 0);
}

/* ---------------- one playout ----------------
   Drives whole games through D.aiMove — the same entry ui.js and the pump use —
   and checks the per-turn invariants as it goes. Returns the failures it found
   as strings, so one bad config names itself instead of failing the matrix
   anonymously. */
function playout(c, opts){
  opts = opts || {};
  G.autoAI = false;
  D.startGame({ seed:c.seed, seats:seatsFor(c), modules:{ brook:c.brook } });
  if(!G.seats || G.seats.length !== c.seats || G.mode === 'menu')
    return { err:'startGame did not produce a live ' + c.seats + '-seat match' };

  const err = {};                       // first failure per invariant, named
  const note = (k, msg) => { if(!err[k]) err[k] = cfgKey(c) + ' — ' + msg; };
  const times = [];
  let turns = 0, posts = 0, stall = 0, legalChecked = 0;
  let lastScores = G.seats.map(s => s.score | 0);
  let total = tileTotal();

  while((G.mode === 'play' || G.mode === 'brook') && turns < 600){
    const seatIdx = G.turnIdx | 0;
    const before = { moveNo:G.moveNo, cells:boardMap.size };

    /* What the input path would accept RIGHT NOW, asked before the AI moves
       and through the same function place() validates against. beginTurn has
       already drawn, so there is a tile in hand to enumerate for. */
    let legal = null;
    if(G.drawn != null){
      try{ legal = D.legal(); }catch(e){ note('legal', 'legalPlacements threw: ' + e); }
    }

    const t0 = Date.now();
    let plan = null;
    try{ plan = D.aiMove(seatIdx); }
    catch(e){ return { err:cfgKey(c) + ' — aiMove threw on turn ' + turns + ': ' + (e.stack || e) }; }
    times.push(Date.now() - t0);
    turns++;

    /* The move the AI actually played has to be one the input path offered.
       place() returning false would leave moveNo where it was and the stall
       guard would fire, but that reports "stuck" three modules from the cause;
       this reports which move was not on the menu. */
    if(plan && legal){
      const cell = legal.find(q => q.x === plan.x && q.y === plan.y);
      if(!cell) note('legalMove', 'turn ' + turns + ': AI played ' + plan.x + ',' + plan.y +
                                  ', which legalPlacements did not offer');
      else if((cell.rots || []).indexOf(plan.rot) < 0)
        note('legalMove', 'turn ' + turns + ': AI played rotation ' + plan.rot + ' at ' +
                          plan.x + ',' + plan.y + ', which legalPlacements did not offer');
      else legalChecked++;
    }
    if(plan && plan.seg != null) posts++;

    // a turn that changed nothing would spin here forever
    if(G.moveNo === before.moveNo && boardMap.size === before.cells){
      if(++stall > 2) return { err:cfgKey(c) + ' — no progress on turn ' + turns };
    } else stall = 0;

    // §1.2: a seat's shepherds are either in hand or on the board, never lost
    const posted = postedBySeat();
    for(let i = 0; i < G.seats.length; i++){
      const held = (G.seats[i].supply | 0) + (posted[i] || 0);
      if(held !== SHEPHERDS)
        note('supply', 'turn ' + turns + ': seat ' + i + ' holds ' + G.seats[i].supply +
                       ' + ' + (posted[i] || 0) + ' posted = ' + held + ', want ' + SHEPHERDS);
    }
    // scores only ever go up
    for(let i = 0; i < G.seats.length; i++){
      if((G.seats[i].score | 0) < lastScores[i])
        note('mono', 'turn ' + turns + ': seat ' + i + ' fell from ' + lastScores[i] +
                     ' to ' + G.seats[i].score);
      lastScores[i] = G.seats[i].score | 0;
    }
    // tiles are conserved, brook queue included
    const now = tileTotal();
    if(now !== total) note('tiles', 'turn ' + turns + ': tile total was ' + total +
                                    ', is ' + now);
    total = now;

    if(opts.stopAfter && turns >= opts.stopAfter) break;
  }

  return { err:null, errs:err, turns, posts, times, legalChecked,
           hash:D.stateHash(), mode:G.mode,
           scores:G.seats.map(s => s.score | 0),
           supplies:G.seats.map(s => s.supply | 0) };
}

/* ---------------- run the matrix ---------------- */
const results = [];
const allTimes = [];
const invariants = { supply:null, mono:null, tiles:null, legalMove:null, legal:null };
let hardErr = null, totalTurns = 0, totalPosts = 0, totalLegal = 0, reached = 0;

for(const c of CONFIGS){
  const r = playout(c);
  if(r.err){ hardErr = hardErr || r.err; results.push({ c, r:null }); continue; }
  results.push({ c, r });
  totalTurns += r.turns; totalPosts += r.posts; totalLegal += r.legalChecked;
  for(const t of r.times) allTimes.push(t);
  for(const k in invariants) if(!invariants[k] && r.errs[k]) invariants[k] = r.errs[k];
  if(r.mode === 'reveal' || r.mode === 'end') reached++;
}

check('every config plays to the end through the real input path  [' + reached + '/' +
      CONFIGS.length + ' configs, ' + totalTurns + ' turns]',
  !hardErr && reached === CONFIGS.length, hardErr ||
  (reached + ' of ' + CONFIGS.length + ' configs finished'));

check('shepherd conservation: in hand + posted === ' + SHEPHERDS + ' every turn  [' +
      totalTurns + ' turns × seats]', !invariants.supply, invariants.supply);
check('scores are monotone across the matrix  [' + totalTurns + ' turns]',
  !invariants.mono, invariants.mono);
check('tile conservation: board + satchel + dead + brook queue is constant  [' +
      totalTurns + ' turns]', !invariants.tiles, invariants.tiles);
check('every AI move was offered by legalPlacements  [' + totalLegal + ' moves verified]',
  !invariants.legalMove && !invariants.legal && totalLegal > 200,
  invariants.legalMove || invariants.legal ||
  ('only ' + totalLegal + ' moves verified — vacuous'));

/* Posts have to actually happen, or half the assertions above are about a
   game where no shepherd ever moved. */
check('the matrix actually posts shepherds  [' + totalPosts + ' posts in ' +
      totalTurns + ' turns]', totalPosts > 100, 'only ' + totalPosts + ' posts');

/* ai.js counts every time its search proposed a post board.canPost then
   refused. Across the whole matrix that count must be zero. */
{
  let miss = 0;
  for(const s of (G.seats || [])) miss += (s.ai && s.ai.postMiss | 0);
  check('no proposed post was refused by the input path', miss === 0,
    miss + ' proposed posts were refused');
}

/* ---------------- perf, over the full matrix ---------------- */
{
  const mean = allTimes.reduce((s, v) => s + v, 0) / Math.max(1, allTimes.length);
  const max = Math.max.apply(null, allTimes.concat([0]));
  check('AI turn budget over the matrix  [mean ' + mean.toFixed(2) + ' ms, worst ' +
        max + ' ms, ' + allTimes.length + ' turns]',
    mean < AI.BUDGET_MS && max < 100,
    'design §8 wants mean < ' + AI.BUDGET_MS + ' ms and worst < 100 ms');
}

/* ---------------- resume ≡ straight-through, one config per seat count ----------------
   saveload.js owns this property for the engine; it is re-asserted here under
   ai-match's OWN configs because the thing that breaks it is AI-side (noise
   drawn from a stream instead of hashed from the position), and it breaks only
   for games that keep playing after the rebuild. */
if(saveObject && replaySave){
  let midErr = null, endErr = null, ran = 0;
  for(const seats of [2, 3, 4, 5]){
    const c = CONFIGS.find(q => q.seats === seats && q.diff === 'mixed');
    if(!c) continue;
    const straight = playout(c);
    if(straight.err){ midErr = midErr || straight.err; continue; }

    const partial = playout(c, { stopAfter:Math.max(4, (straight.turns / 3) | 0) });
    if(partial.err){ midErr = midErr || partial.err; continue; }
    const midHash = D.stateHash();
    const save = JSON.parse(JSON.stringify(saveObject()));

    G.autoAI = false;
    const ok = replaySave(save);
    ran++;
    if(ok === false){ midErr = midErr || (cfgKey(c) + ': replaySave REFUSED the log'); continue; }
    if(D.stateHash() !== midHash){
      midErr = midErr || (cfgKey(c) + ': rebuild landed on ' + D.stateHash() + ', not ' + midHash);
      continue;
    }
    // finish the rebuilt game the same way the original was finished
    let guard = 0;
    while((G.mode === 'play' || G.mode === 'brook') && guard++ < 600){
      const before = G.moveNo;
      D.aiMove(G.turnIdx | 0);
      if(G.moveNo === before) break;
    }
    if(D.stateHash() !== straight.hash)
      endErr = endErr || (cfgKey(c) + ': straight ' + straight.hash + ' vs resumed ' + D.stateHash());
  }
  check('a mid-game save rebuilds to the same position  [' + ran + ' configs, 2-5 seats]',
    !midErr && ran === 4, midErr || (ran + ' of 4 configs ran'));
  check('a resumed AI game ends on the same hash as straight-through  [' + ran +
        ' configs, 2-5 seats]', !endErr && ran === 4, endErr);
} else {
  check('a resumed AI game ends on the same hash as straight-through', false,
    'game.js exposes no saveObject/replaySave');
}

/* ---------------- the goldens ---------------- */
{
  let golden = null, readErr = null;
  try{ golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')); }
  catch(e){ readErr = e.code === 'ENOENT' ? 'no golden file yet' : String(e.message || e); }

  const fresh = { v:GOLDEN_V, configs:CONFIG_SIG, hashes:{} };
  for(const { c, r } of results) if(r) fresh.hashes[cfgKey(c)] = r.hash;

  if(UPDATE){
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(fresh, null, 2) + '\n');
    console.log('WROTE ' + GOLDEN_PATH + '  (' + Object.keys(fresh.hashes).length + ' configs)');
    check('goldens regenerated on request (AI_MATCH_UPDATE=1)', true);
    console.log('  → re-run WITHOUT the flag to check them, and say in the commit ' +
                'message what moved them.');
  } else if(!golden){
    check('golden hashes match', false, readErr +
      ' — create it with:  AI_MATCH_UPDATE=1 node test/ai-match.js');
  } else if(golden.v !== GOLDEN_V){
    check('golden hashes match', false, 'golden file is format v' + golden.v +
      ', this suite writes v' + GOLDEN_V + ' — regenerate with AI_MATCH_UPDATE=1');
  } else if(golden.configs !== CONFIG_SIG){
    check('golden hashes match', false,
      'the CONFIG LIST changed, so the stored hashes describe a different matrix.\n' +
      '     stored: ' + golden.configs + '\n' +
      '     now:    ' + CONFIG_SIG + '\n' +
      '     regenerate deliberately with AI_MATCH_UPDATE=1');
  } else {
    const diffs = [];
    for(const k in fresh.hashes)
      if(golden.hashes[k] !== fresh.hashes[k])
        diffs.push('  ' + k + ':  golden ' + golden.hashes[k] + '  →  now ' + fresh.hashes[k]);
    check('golden stateHashes match  [' + Object.keys(fresh.hashes).length +
          ' configs, seats 2-5 × ' + DIFFS.join('/') + '/mixed]',
      diffs.length === 0,
      diffs.length ? diffs.length + ' config(s) play differently than the golden:\n' +
        diffs.join('\n') + '\n     If that was intended, regenerate: ' +
        'AI_MATCH_UPDATE=1 node test/ai-match.js' : '');
  }

  /* A golden of a game nobody played would pass forever. */
  check('the goldens describe real games  [' + Object.keys(fresh.hashes).length +
        ' hashes, ' + new Set(Object.values(fresh.hashes)).size + ' distinct]',
    Object.keys(fresh.hashes).length === CONFIGS.length &&
    new Set(Object.values(fresh.hashes)).size === CONFIGS.length,
    'every config must produce a hash, and no two configs should coincide');
}

/* ---------------- what the matrix looked like ---------------- */
console.log('');
console.log('  config                          turns  posts   scores');
for(const { c, r } of results){
  if(!r){ console.log('  ' + cfgKey(c).padEnd(30) + '  — did not finish'); continue; }
  console.log('  ' + cfgKey(c).padEnd(30) + String(r.turns).padStart(6) +
              String(r.posts).padStart(7) + '   ' + r.scores.join(' / '));
}

console.log('');
console.log(fail ? 'AI-MATCH FAILED  (' + pass + ' passed, ' + fail + ' failed)'
                 : 'AI-MATCH OK  (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
