'use strict';
/* Wave 1-G smoke: ai.js plays a legal game and lies about nothing.
   Two halves. The STATIC half needs no engine — the personality table, the
   score-formula mirrors, the noise generator, the merge arithmetic — and must
   be green the moment ai.js exists. The LIVE half drives a seeded Old Wick vs
   Old Wick match through WoolDbg's real input path, and is skipped with a loud
   banner while tiles/board/game are still Wave-0 stubs.
   Set AI_SMOKE_STRICT=1 to turn "skipped" into "failed" — that is the flag a
   wave-closing gate should use.
   Usage: node test/ai-smoke.js */
const { load } = require('./shim');

const STRICT = !!process.env.AI_SMOKE_STRICT;
let pass = 0, fail = 0, skip = 0;
const check = (label, ok, note) => {
  if(ok){ pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (note ? '\n  → ' + note : '')); }
  return ok;
};
const skipped = (label, why) => {
  if(STRICT){ fail++; console.log('FAIL  ' + label + '\n  → ' + why + ' (STRICT)'); return; }
  skip++; console.log('SKIP  ' + label + '  (' + why + ')');
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

let g, probe, D, G, AI;
try{
  g = load(); probe = g.probe; D = g.D; G = g.G;
  AI = global.window.AI;
}catch(e){
  console.log('FAIL  ai.js loads headlessly\n  → ' + (e && e.stack || e));
  process.exit(1);
}
check('ai.js loads headlessly', true);
check('window.AI published', !!AI && typeof AI.move === 'function');

/* Every check below dereferences AI, so if it did not publish, this suite has
   nothing left to say and would otherwise crash with a TypeError on the next
   line — reporting a stack trace where it should report 38 unrun checks. The
   condition check #2 exists to catch has to be survivable by the code that
   follows it, or catching it buys nothing. (Same shape as the collision scan
   that could not run during a collision; different file, same lesson.) */
if(!AI || typeof AI.move !== 'function'){
  console.log('  → js/ai.js did not publish window.AI; the remaining ' +
              '38 checks cannot run. Is it in index.html\'s script order?');
  console.log('\nAI-SMOKE FAILED  (' + pass + ' passed, ' + fail + ' failed, nothing else run)');
  process.exit(1);
}

/* module-scope handles the suite needs; undefined while a sibling is a stub */
const P = (expr) => { try{ return probe(expr); }catch(e){ return undefined; } };
const tileById   = P('typeof tileById==="function" ? tileById : null');
const featureAt  = P('typeof featureAt==="function" ? featureAt : null');
const legalCells = P('typeof legalCells==="function" ? legalCells : null');
const scoreFeature = P('typeof scoreFeature==="function" ? scoreFeature : null');
const boardMap   = P('typeof board!=="undefined" ? board : null');
const revealAll  = P('typeof revealAll==="function" ? revealAll : null');
const shepherdList = P('typeof shepherdList==="function" ? shepherdList : null');
const saveObject = P('typeof saveObject==="function" ? saveObject : null');
const replaySave = P('typeof replaySave==="function" ? replaySave : null');
const finishReveal = P('typeof finishReveal==="function" ? finishReveal : null');
const RNGmod     = P('RNG');
const SHEPHERDS  = P('SHEPHERDS');

/* ============================ STATIC HALF ============================ */

/* --- personalities: all four rows, at the design's weights (§6 table) --- */
{
  const want = {
    wick: { w_now:1.0, w_pot:1.2, w_meadow:0.7, w_block:0.3, w_scar:1.0 },
    bram: { w_now:0.9, w_pot:0.8, w_meadow:0.8, w_block:1.5, w_scar:0.9 },
    maud: { w_now:0.8, w_pot:0.9, w_meadow:1.6, w_block:0.5, w_scar:0.7 },
    pip:  { w_now:1.0, w_pot:1.1, w_meadow:0.5, w_block:0.4, w_scar:1.2 },
  };
  let ok = true, why = '';
  for(const k in want){
    const row = AI.PERSONALITIES[k];
    if(!row){ ok = false; why = 'missing personality ' + k; break; }
    for(const w in want[k]) if(row[w] !== want[k][w]){
      ok = false; why = k + '.' + w + ' is ' + row[w] + ', design says ' + want[k][w]; break;
    }
    if(!ok) break;
  }
  check('four personalities carry the design weight vectors', ok, why);
  check('type bias: Old Wick folds x1.3, Pip lanes+shrines x1.4',
    AI.PERSONALITIES.wick.bias.fold === 1.3 &&
    AI.PERSONALITIES.pip.bias.lane === 1.4 && AI.PERSONALITIES.pip.bias.shrine === 1.4);
  check('difficulty sigmas are 2.5 / 1.0 / 0.25',
    AI.DIFFICULTY.lamb.sigma === 2.5 && AI.DIFFICULTY.ewe.sigma === 1.0 &&
    AI.DIFFICULTY.ram.sigma === 0.25);
}

/* --- whatever string game.js/ui.js stores, we resolve to a real row --- */
{
  const cases = [['wick','wick'],['Old Wick','wick'],['Steadwright','wick'],
                 ['bram','bram'],['Thornhedge','bram'],['maud','maud'],
                 ['Meadowlord','maud'],['pip','pip'],['Waywalker','pip'],
                 [null,'wick'],['nonsense','wick']];
  let ok = true, why = '';
  for(const [inp, want] of cases){
    const got = AI.personalityKey(inp);
    if(got !== want){ ok = false; why = JSON.stringify(inp) + ' → ' + got + ', wanted ' + want; break; }
  }
  check('personality keys resolve from every spelling game.js might store', ok, why);
  check('difficulty keys resolve from names and indices',
    AI.difficultyKey('Lamb') === 'lamb' && AI.difficultyKey('ram') === 'ram' &&
    AI.difficultyKey(0) === 'lamb' && AI.difficultyKey(2) === 'ram' &&
    AI.difficultyKey(undefined) === 'ewe');
}

/* --- the score mirrors must equal design §1.4 / §1.5 / §3.3 --- */
{
  check('complete: lane 1/tile, fold 2/(tile+ram), two-tile fold = 4, shrine 9',
    AI.completeValue('lane', 5, 0) === 5 &&
    AI.completeValue('fold', 2, 0) === 4 &&
    AI.completeValue('fold', 3, 2) === 10 &&
    AI.completeValue('shrine', 1, 0) === 9);
  check('end: lane 1/tile, fold 1/(tile+ram), shrine 1+neighbours',
    AI.endValue('lane', 5, 0) === 5 &&
    AI.endValue('fold', 3, 2) === 5 &&
    AI.endValue('shrine', 1, 0, 6) === 7);
  check('brook and meadow are worth nothing on their own',
    AI.completeValue('brook', 9, 0) === 0 && AI.completeValue('meadow', 9, 0) === 0);
}

/* --- difficulty noise: stateless, N(0,sigma), and blind to RNG ---
   The noise is hashed from (seed, moveNo, seatIdx, candidateIndex), so these
   sample it the way aiMove does — across a grid of positions — rather than by
   pulling repeatedly on a stream. */
{
  const noise = P('aiNoise');
  const held = G.moveNo, heldSeed = G.seed;
  G.seed = 4242;
  const sample = (sigma) => {
    const out = [];
    for(let mv = 0; mv < 100; mv++){
      G.moveNo = mv;
      for(let seat = 0; seat < 4; seat++)
        for(let cand = 0; cand < 12; cand++) out.push(noise(sigma, seat, cand));
    }
    return out;
  };

  const a = sample(1.0), b = sample(1.0);
  check('noise is a pure function of the position', a.join(',') === b.join(','));

  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) * (v - mean), 0) / a.length);
  check('noise is N(0,1) at sigma 1  [mean ' + mean.toFixed(3) + ' sd ' + sd.toFixed(3) + ']',
    near(mean, 0, 0.06) && near(sd, 1, 0.06));

  const s25 = sample(2.5);
  const m25 = s25.reduce((s, v) => s + v, 0) / s25.length;
  const d25 = Math.sqrt(s25.reduce((s, v) => s + (v - m25) * (v - m25), 0) / s25.length);
  check('sigma scales: Lamb spreads 2.5x Ram  [sd ' + d25.toFixed(3) + ']', near(d25, 2.5, 0.15));

  /* Adjacent candidates must get INDEPENDENT noise. If candidateIndex leaked
     through the mixer, neighbouring candidates would be nudged the same way and
     the argmax would carry a systematic bias no weight vector explains. */
  G.moveNo = 7;
  const x = [], y = [];
  for(let c = 0; c < 4000; c++){ x.push(noise(1.0, 0, c)); y.push(noise(1.0, 0, c + 1)); }
  const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
  let cov = 0, vx = 0, vy = 0;
  for(let i = 0; i < x.length; i++){
    cov += (x[i] - mx) * (y[i] - my);
    vx += (x[i] - mx) * (x[i] - mx);
    vy += (y[i] - my) * (y[i] - my);
  }
  const r = cov / Math.sqrt(vx * vy);
  check('adjacent candidates get independent noise  [r=' + r.toFixed(4) + ']', Math.abs(r) < 0.05);

  /* The property the whole stateless rewrite exists for. */
  G.moveNo = 3;
  RNGmod.seed(1234);
  const rngBefore = RNGmod.state;
  for(let i = 0; i < 500; i++) noise(2.5, i % 4, i);
  check('noise never touches RNG.state', RNGmod.state === rngBefore,
    rngBefore + ' → ' + RNGmod.state);

  G.moveNo = held; G.seed = heldSeed;
}

/* --- merged tile counts: two roots that already share a cell count it once --- */
{
  const merge = P('aiMergedCells');
  const A = { cells:new Set(['0,0','1,0','2,0']) };
  const B = { cells:new Set(['2,0','3,0']) };          // shares 2,0 with A
  check('merged cell count is a union, not a sum',
    merge([A, B], '5,5') === 5 && merge([A], '1,0') === 3 && merge([], '9,9') === 1,
    'got ' + merge([A, B], '5,5') + '/' + merge([A], '1,0') + '/' + merge([], '9,9'));
}

/* --- majority equity: ties score full but are worth less than a sole hold --- */
{
  const eq = P('aiHoldEquity'), sc = P('aiScoreShare');
  check('scoreShare is exactly §1.4 (ties all score full)',
    sc([2,1], 0) === 1 && sc([2,1], 1) === 0 && sc([1,1], 0) === 1 && sc([1,1], 1) === 1 &&
    sc([0,2], 0) === 0);
  check('holdEquity ranks sole hold > tie > behind > absent',
    eq([2,1], 0) > eq([1,1], 0) && eq([1,1], 0) > eq([1,2], 0) && eq([0,1], 0) === 0);
}

/* --- WoolDbg augmentation: added, never replacing what game.js published --- */
{
  const W = global.window.WoolDbg;
  if(!W) skipped('WoolDbg carries aiMove', 'game.js has not published WoolDbg yet');
  else check('WoolDbg carries aiMove and aiMoves',
    typeof W.aiMove === 'function' && typeof W.aiMoves === 'function');
}

/* ============================= LIVE HALF ============================= */

const engineReady = !!(tileById && featureAt && legalCells && boardMap && D &&
                       typeof D.startGame === 'function' && typeof D.stateHash === 'function' &&
                       typeof D.place === 'function');

/* A seeded Old Wick vs Old Wick match. autoAI is switched OFF first: game.js
   pumps AI turns itself, and with every seat an AI that would run the whole
   game inside startGame, leaving nothing to time or to check between turns.
   The pumped path gets its own test at the bottom. */
function newMatch(seed, opts){
  opts = opts || {};
  const ai = (n) => ({ name:n, human:false, personality:'wick', difficulty:'ram' });
  const S = global.window.G;
  S.autoAI = !!opts.autoAI;
  try{
    D.startGame({ seed, seats:[ai('Wick A'), ai('Wick B')],
                  modules:{ brook:opts.brook !== false } });
  }catch(e){ return null; }
  if(!S.seats || S.seats.length !== 2 || S.mode === 'menu') return null;
  return { G:S };
}

/* Every shepherd on the board, found by walking each placed cell's segments to
   its root and counting each root once. Supply conservation is checked against
   this, not against a counter the engine keeps — the point is to catch the
   engine, not to agree with it. */
function postedBySeat(S){
  const n = [];
  const seen = new Set();
  for(const [key, cell] of boardMap){
    const t = tileById(cell.tileId); if(!t || !t.segs) continue;
    const [x, y] = key.split(',').map(Number);
    for(let s = 0; s < t.segs.length; s++){
      const root = featureAt(x, y, s);
      if(!root || seen.has(root)) continue;
      seen.add(root);
      for(const sh of (root.shepherds || [])) n[sh.seat] = (n[sh.seat] || 0) + 1;
    }
  }
  /* game.js's shepherdList() flattens the same posts, but it enumerates
     board.js's root REGISTRY (featureRoots) where the walk above rebuilds the
     root set from the cell side. Two independent paths to one truth, so
     comparing them costs nothing and catches a root that the registry has lost
     or that no cell can still reach. */
  let err = null;
  if(shepherdList){
    const m = [];
    for(const sh of (shepherdList() || [])) m[sh.seat] = (m[sh.seat] || 0) + 1;
    for(let i = 0; i < Math.max(n.length, m.length); i++)
      if((n[i] | 0) !== (m[i] | 0)){
        err = 'seat ' + i + ': cell-walk sees ' + (n[i] | 0) +
              ' posts, shepherdList() sees ' + (m[i] | 0);
        break;
      }
  }
  return { n, err };
}

function runMatch(seed, opts){
  opts = opts || {};
  const m = newMatch(seed, opts);
  if(!m) return { err:'startGame did not produce a live two-seat match' };
  const S = m.G;
  const times = [];
  let turns = 0, stall = 0, lastScores = S.seats.map(s => s.score | 0);
  let conserved = null, conserveErr = null, monoErr = null, supplyErr = null, hypoErr = null;
  let cmp = 0, posts = 0, cands = 0, listErr = null;

  /* Play stops at 'reveal' — final points are already applied there (§1.5);
     'end' is the far side of the walkthrough, which is presentation. */
  while((S.mode === 'play' || S.mode === 'brook') && turns < 400){
    const seatIdx = S.turnIdx | 0;
    const before = { cells:boardMap.size, sat:(S.satchel || []).length, turn:seatIdx };

    // The deep check: predict every merge this tile could make, let the engine
    // perform the one the AI picks, and compare. Predicting ALL of them rather
    // than guessing the AI's choice is what makes this cover every turn — the
    // difficulty noise means the move played is often not the noiseless argmax.
    let predicted = null;
    if(opts.verifyHypo && S.drawn != null){
      try{
        predicted = new Map();
        for(const c of AI.moves(seatIdx, S.drawn)){
          const k = c.x + ',' + c.y + ',' + c.rot;
          if(!predicted.has(k)) predicted.set(k, AI.hypo(AI.cellCtx(c.x, c.y), S.drawn, c.rot));
        }
      }catch(e){ hypoErr = hypoErr || ('predicting: ' + (e.stack || e)); }
    }

    const t0 = Date.now();
    let plan = null;
    try{ plan = D.aiMove(seatIdx); }
    catch(e){ return { err:'aiMove threw on turn ' + turns + ': ' + (e.stack || e) }; }
    times.push(Date.now() - t0);
    turns++;

    // Did the prediction describe the board we now have?
    if(predicted && plan && !hypoErr){
      const hypo = predicted.get(plan.x + ',' + plan.y + ',' + plan.rot);
      if(!hypo) hypoErr = 'turn ' + turns + ': AI played ' + plan.x + ',' + plan.y +
                          ' rot ' + plan.rot + ', which it never enumerated';
      else for(const pg of hypo.groups){
        if(pg.type === 'shrine' || !pg.segs.length) continue;
        const root = featureAt(plan.x, plan.y, pg.segs[0]);
        if(!root || !root.cells) continue;
        cmp++;
        if(root.cells.size !== pg.tiles){
          hypoErr = 'turn ' + turns + ' ' + pg.type + ': predicted ' + pg.tiles +
                    ' tiles, board says ' + root.cells.size; break;
        }
        if(pg.type !== 'meadow' && typeof root.opens === 'number' && root.opens !== pg.opens){
          hypoErr = 'turn ' + turns + ' ' + pg.type + ': predicted opens ' + pg.opens +
                    ', board says ' + root.opens; break;
        }
        if(pg.type === 'fold' && typeof root.rams === 'number' && root.rams !== pg.rams){
          hypoErr = 'turn ' + turns + ' fold: predicted ' + pg.rams + ' rams, board says ' +
                    root.rams; break;
        }
      }
    }
    if(plan){ cands += plan.considered | 0; if(plan.seg != null) posts++; }

    // no-progress guard: a turn that changes nothing would spin here forever
    if(boardMap.size === before.cells && (S.satchel || []).length === before.sat &&
       (S.turnIdx | 0) === before.turn && S.mode !== 'end'){
      if(++stall > 2) return { err:'no progress on turn ' + turns + ' (seat ' + seatIdx + ')' };
    } else stall = 0;

    // scores never go backwards
    for(let i = 0; i < S.seats.length; i++){
      if((S.seats[i].score | 0) < lastScores[i]) monoErr = monoErr ||
        ('seat ' + i + ' fell from ' + lastScores[i] + ' to ' + S.seats[i].score + ' on turn ' + turns);
      lastScores[i] = S.seats[i].score | 0;
    }

    // supply conservation: in hand + on the board = SHEPHERDS, always
    const posted = postedBySeat(S);
    if(posted.err) listErr = listErr || (posted.err + ' (turn ' + turns + ')');
    for(let i = 0; i < S.seats.length; i++){
      const total = (S.seats[i].supply | 0) + (posted.n[i] || 0);
      if(total !== SHEPHERDS) supplyErr = supplyErr ||
        ('seat ' + i + ' holds ' + S.seats[i].supply + ' + ' + (posted.n[i] || 0) +
         ' posted = ' + total + ', want ' + SHEPHERDS + ' (turn ' + turns + ')');
    }

    // tiles are conserved: satchel + board + dead never changes during play
    if(S.mode === 'play'){
      const tot = (S.satchel || []).length + boardMap.size + (S.dead || []).length;
      if(conserved == null) conserved = tot;
      else if(tot !== conserved) conserveErr = conserveErr ||
        ('satchel+board+dead was ' + conserved + ', is ' + tot + ' on turn ' + turns);
    }
  }

  const finalHash = D.stateHash();            // the scoreboard is final at 'reveal'
  if(S.mode === 'reveal' && revealAll && finishReveal){ revealAll(); finishReveal(); }
  let postMiss = 0;
  for(const s of S.seats) postMiss += (s.ai && s.ai.postMiss | 0);

  return { G:S, turns, times, monoErr, supplyErr, conserveErr, hypoErr, listErr, cmp, posts, postMiss,
           cands, hash:finalHash, ended:S.mode === 'end', mode:S.mode };
}

if(!engineReady){
  const missing = [!tileById && 'tiles.js', !legalCells && 'board.js',
                   !(D && D.startGame) && 'game.js'].filter(Boolean).join(' + ');
  const why = missing + ' still Wave-0 stub' + (missing.indexOf('+') > 0 ? 's' : '');
  ['seeded Old Wick vs Old Wick reaches mode "end"',
   'no exceptions through the real input path',
   'shepherd supply conserved every turn',
   'scores are monotone',
   'satchel + board + dead is constant',
   'hypothetical merge agrees with board.js',
   'same seed twice → identical stateHash',
   'evaluation is side-effect free (500 evals, stateHash unchanged)',
   'AI turn stays inside the 50 ms budget',
   'AI value formulas agree with board.scoreFeature',
  ].forEach(l => skipped(l, why));
} else {
  const r1 = runMatch(20260808, { verifyHypo:true });
  if(r1.err){
    check('seeded Old Wick vs Old Wick reaches mode "end"', false, r1.err);
    check('no exceptions through the real input path', false, r1.err);
  } else {
    check('seeded Old Wick vs Old Wick reaches mode "end"  [' + r1.turns + ' turns, ' +
          r1.G.seats.map(s => s.score).join(' vs ') + ']', r1.ended,
      'stopped after ' + r1.turns + ' turns in mode ' + r1.mode);
    check('no exceptions through the real input path', true);
    check('shepherd supply conserved every turn', !r1.supplyErr, r1.supplyErr);
    check('scores are monotone', !r1.monoErr, r1.monoErr);
    check('shepherdList() agrees with an independent walk of the feature graph',
      !r1.listErr, r1.listErr);
    check('satchel + board + dead is constant', !r1.conserveErr, r1.conserveErr);
    check('hypothetical merge agrees with board.js  [' + r1.cmp + ' features compared]',
      !r1.hypoErr && r1.cmp > 100, r1.hypoErr || ('only ' + r1.cmp + ' comparisons — vacuous'));
    // If the merge we searched ever disagreed with board.canPost, aiMove would
    // quietly skip instead of posting. It counts those; the count must be 0.
    check('every post the search proposed was legal at the input path  [' + r1.posts +
          ' posts in ' + r1.turns + ' turns]',
      r1.postMiss === 0 && r1.posts > 0,
      r1.postMiss ? r1.postMiss + ' proposed posts board.canPost refused' : 'AI never posted at all');
    check('enumeration is not degenerate  [' + (r1.cands / Math.max(1, r1.turns)).toFixed(0) +
          ' candidates/turn]', r1.cands / Math.max(1, r1.turns) > 20);
    // tiles.js's slot partition is total, so the search should never meet a
    // slot no segment owns. If it does, the tile data is wrong, not the search.
    check('every slot the search walked belongs to a segment',
      AI.slotMiss() === 0, AI.slotMiss() + ' slots had no owning segment');

    /* determinism — same seed, same game, to the last bit of the hash */
    const r2 = runMatch(20260808, {});
    check('same seed twice → identical stateHash',
      !r2.err && r1.hash === r2.hash, r2.err || (r1.hash + ' vs ' + r2.hash));

    /* budget: design §8 wants mean < 50 ms, max < 100 ms, headless */
    const t = r1.times, mean = t.reduce((s, v) => s + v, 0) / Math.max(1, t.length);
    const max = Math.max.apply(null, t.concat([0]));
    check('AI turn stays inside the 50 ms budget  [mean ' + mean.toFixed(1) +
          ' ms, max ' + max + ' ms, first ' + (t[0] | 0) + ' ms, ' + t.length + ' turns]',
      mean < AI.BUDGET_MS && max < 100);

    /* value formulas vs the engine's own scorer, on the finished board */
    if(scoreFeature){
      let vErr = null, meadowDone = 0, meadowSeen = 0, compared = 0;
      const seen = new Set();
      for(const [key, cell] of boardMap){
        const tl = tileById(cell.tileId); if(!tl || !tl.segs) continue;
        const [x, y] = key.split(',').map(Number);
        for(let s = 0; s < tl.segs.length; s++){
          const root = featureAt(x, y, s);
          if(!root || seen.has(root)) continue;
          seen.add(root);
          if(root.type === 'brook') continue;
          if(!root.shepherds || !root.shepherds.length) continue;
          const rows = scoreFeature(root, true) || [];
          if(!rows.length) continue;
          const engine = Math.max.apply(null, rows.map(r => r.pts | 0));
          let mine;
          if(root.type === 'meadow'){
            // The term that reads adjFolds. board.js scores a meadow at 3 per
            // FINISHED adjacent fold, so if our resolver ever stops seeing
            // finished folds — the exact shape of the bug board-b caught, where
            // string keys resolved to nothing and every fold looked open — this
            // fires instead of the AI just quietly playing meadows badly.
            const f = AI.meadowFolds(root);
            mine = AI.MEADOW_FOLD_PTS * f.done;
            meadowDone += f.done; meadowSeen++;
          } else {
            // A shrine's end value is 1 + filled neighbours, and board.js keeps
            // that as opens = 8 − filled.
            const nbrs = root.type === 'shrine' ? 8 - (root.opens | 0) : 0;
            mine = AI.endValue(root.type, root.cells.size, root.rams | 0, nbrs);
          }
          compared++;
          if(engine !== mine){
            vErr = root.type + ' of ' + root.cells.size + ' tiles / ' + (root.rams | 0) +
                   ' rams: board.scoreFeature says ' + engine + ', ai.js says ' + mine;
            break;
          }
        }
        if(vErr) break;
      }
      check('AI value formulas agree with board.scoreFeature  [' + compared +
            ' held features compared, ' + meadowSeen + ' of them meadows]',
        !vErr && compared > 0, vErr || 'nothing was compared — vacuous');
      // Guard against the check above passing because everything was zero.
      check('the meadow term sees finished folds  [' + meadowDone + ' across ' +
            meadowSeen + ' held meadows]', meadowDone > 0,
        'every adjacent fold looked open — adjFolds is not resolving');
    } else skipped('AI value formulas agree with board.scoreFeature', 'board.js has no scoreFeature');

    /* purity: evaluation reads the world and writes nothing, including RNG */
    const m3 = newMatch(777);
    if(!m3) skipped('evaluation is side-effect free (500 evals, stateHash unchanged)',
                    'could not start a fresh match');
    else {
      const S = m3.G;
      for(let i = 0; i < 6 && S.mode !== 'end'; i++) D.aiMove(S.turnIdx | 0);
      const h0 = D.stateHash();
      let evalErr = null;
      try{
        const id = S.drawn != null ? S.drawn : (S.satchel || [])[0];
        const cand = AI.moves(S.turnIdx | 0, id);
        if(cand.length){
          const top = cand[0];
          const hypo = AI.hypo(AI.cellCtx(top.x, top.y), id, top.rot);
          const hist = AI.histogram();
          let v0 = null;
          for(let i = 0; i < 500; i++){
            const e = AI.evalMove(S.turnIdx | 0, hypo, top.seg, hist);
            if(v0 === null) v0 = e.v;
            else if(e.v !== v0){ evalErr = 'eval drifted: ' + v0 + ' → ' + e.v + ' on pass ' + i; break; }
          }
          for(let i = 0; i < 5; i++) AI.moves(S.turnIdx | 0, id);
        } else evalErr = 'no candidates to evaluate';
      }catch(e){ evalErr = 'eval threw: ' + (e.stack || e); }
      const h1 = D.stateHash();
      check('evaluation is side-effect free (500 evals, stateHash unchanged)',
        !evalErr && h0 === h1, evalErr || ('stateHash ' + h0 + ' → ' + h1));
    }

    /* Competence, not just legality: the wave-1 bar is a seat worth playing
       against. Fixed seeds, so this is a deterministic assertion — a future
       tuning pass that loses one of these is telling you something. */
    {
      const place = P('place'), spot = P('spot'), skipTurn = P('skip'),
            legalPl = P('legalPlacements'), postOpts = P('postOptions');
      const mulberry = (a) => function(){ a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const randomTurn = (S, rnd) => {
        if(S.drawn == null) return;
        const cells = legalPl(S.drawn, !!(S.brook && S.brook.relax));
        if(!cells.length) return;
        const c = cells[(rnd() * cells.length) | 0];
        if(!place(c.x, c.y, c.rots[(rnd() * c.rots.length) | 0])) return;
        if(S.step !== 'post') return;
        const o = postOpts();
        if(o.length && rnd() < 0.5) spot(o[(rnd() * o.length) | 0]); else skipTurn();
      };
      let w = 0, sAI = 0, sR = 0, games = 0;
      for(let i = 0; i < 6; i++) for(const aiSeat of [0, 1]){
        const seed = 1000 + i * 37;
        const S = global.window.G;
        S.autoAI = false;
        const mk = (isAI) => ({ name:isAI ? 'Wick' : 'Random', human:false,
                                personality:'wick', difficulty:'ram' });
        D.startGame({ seed, seats:[mk(aiSeat === 0), mk(aiSeat === 1)], modules:{ brook:true } });
        const rnd = mulberry(seed ^ 0xbeef);
        for(let n = 0; n < 400 && (S.mode === 'play' || S.mode === 'brook'); n++){
          const before = S.moveNo;
          if((S.turnIdx | 0) === aiSeat) D.aiMove(aiSeat); else randomTurn(S, rnd);
          if(S.moveNo === before) break;
        }
        if(S.mode === 'reveal' && revealAll && finishReveal){ revealAll(); finishReveal(); }
        const a = S.seats[aiSeat].score | 0, b = S.seats[1 - aiSeat].score | 0;
        sAI += a; sR += b; games++; if(a > b) w++;
      }
      check('Old Wick beats a random-legal player  [' + w + '/' + games + ', mean ' +
            (sAI / games).toFixed(0) + ' vs ' + (sR / games).toFixed(0) + ']', w >= games - 1);
    }

    /* The personality table has to be wired to the search, not just exported. */
    {
      const hashes = {};
      for(const k of ['wick', 'bram', 'maud', 'pip']){
        const S = global.window.G;
        S.autoAI = false;
        D.startGame({ seed:5150, modules:{ brook:true },
          seats:[{ name:k, human:false, personality:k, difficulty:'ram' },
                 { name:'w', human:false, personality:'wick', difficulty:'ram' }] });
        for(let n = 0; n < 400 && (S.mode === 'play' || S.mode === 'brook'); n++){
          const before = S.moveNo;
          D.aiMove(S.turnIdx | 0);
          if(S.moveNo === before) break;
        }
        hashes[k] = D.stateHash();
      }
      const vals = Object.keys(hashes).map(k => hashes[k]);
      check('the four tempers play four different games from one seed',
        new Set(vals).size === 4, JSON.stringify(hashes));
    }

    /* CONTRACT: AI scratch memory lives under seat.ai.* and is excluded from
       stateHash. Two identical replays would agree either way, so prove it the
       only way that means anything — scribble on it and watch nothing move. */
    {
      const S = global.window.G;
      const h0 = D.stateHash();
      for(const s of S.seats){
        s.ai.plan = { junk:true, x:999, y:-999 };
        s.ai.scratch = [1, 2, 3];
        s.ai.ms = 12345;
      }
      check('seat.ai.* is excluded from stateHash', D.stateHash() === h0,
        'writing AI memory moved the hash ' + h0 + ' → ' + D.stateHash());
    }

    /* RESUME REPRODUCIBILITY — the property the stateless noise buys.
       Play a seeded AI match straight through; then play the same match again,
       snapshot its save partway, rebuild from that save, and finish. Because
       nothing in ai.js draws from RNG, the rebuild lands RNG.state exactly
       where the original had it, and the two games end on the same hash.
       With streamed noise this could not hold: a replay reconstructs the log
       through place() and never calls aiMove, so the stream would be short by
       two draws per AI turn replayed. */
    if(saveObject && replaySave){
      const S = global.window.G;
      /* Lamb throughout, but NOT because a wide sigma detects better — that was
         the plausible thing to assume and it is measurably false. Mutation-
         tested by making the noise stream-derived again (in the shim's eval
         scope, never on disk), across these four configs:

           streamed, lamb sigma 2.5   accepted 4/4  sameGame 0/4  sameHash 0/4
           streamed, ram  sigma 0.25  accepted 4/4  sameGame 0/4  sameHash 0/4

         Ram catches it exactly as reliably as Lamb: over the ~40 turns after a
         resume, even a 0.25-point perturbation flips some near-tie and the
         games separate. Lamb is kept only so this suite and saveload's share a
         setting. What IS load-bearing is that the AI KEEPS PLAYING after the
         rebuild — that is what makes the SCORES diverge and not merely the
         hash, and it is what separates this check from saveload's end-state
         round trip, where a rebuild never calls aiMove and sigma provably
         cannot matter.
         Seat COUNT is varied for an unrelated reason: seatIdx is one of the
         four hash inputs, so a mixer handling it poorly could hide at 2 seats. */
      const cfgs = [{ seed:606, n:2, brook:true }, { seed:11, n:3, brook:true },
                    { seed:7, n:5, brook:true }, { seed:99, n:2, brook:false }];
      const playOut = () => {
        for(let n = 0; n < 500 && (S.mode === 'play' || S.mode === 'brook'); n++){
          const before = S.moveNo;
          D.aiMove(S.turnIdx | 0);
          if(S.moveNo === before) break;
        }
        return D.stateHash();
      };
      const start = (c) => {
        const seats = [];
        for(let i = 0; i < c.n; i++) seats.push({
          name:'S' + i, human:false,
          personality:AI.PERSONALITY_ORDER[i % AI.PERSONALITY_ORDER.length],
          difficulty:'lamb' });
        S.autoAI = false;
        D.startGame({ seed:c.seed, seats, modules:{ brook:c.brook } });
      };
      let midErr = null, endErr = null, ran = 0;
      for(const c of cfgs){
        const tag = 'seed ' + c.seed + '/' + c.n + ' seats/brook ' + (c.brook ? 'on' : 'off');
        start(c);
        const straight = playOut();

        start(c);
        for(let n = 0; n < 25 && (S.mode === 'play' || S.mode === 'brook'); n++){
          const before = S.moveNo;
          D.aiMove(S.turnIdx | 0);
          if(S.moveNo === before) break;
        }
        const midHash = D.stateHash();
        const save = JSON.parse(JSON.stringify(saveObject()));

        S.autoAI = false;             // pumpAI stands down on G.replaying, but a
                                      // rebuild should never depend on that here
        /* Acceptance is asserted as its own thing, BEFORE anything is compared,
           and a refusal short-circuits the rest of this config. The two bugs
           this pair guards against fail at opposite ends and neither detector
           sees the other's: stream-derived noise is accepted and rebuilds the
           same board, failing only on the hash; an auto-actor that re-takes
           logged turns desyncs the log and is refused outright, never reaching
           a hash at all. Letting a refusal fall through would report it as a
           hash mismatch — the confusing symptom instead of the cause. */
        const ok = replaySave(save);
        if(ok === false){ midErr = midErr || (tag + ': replaySave REFUSED the log'); ran++; continue; }
        if(D.stateHash() !== midHash)
          midErr = midErr || (tag + ': rebuild landed on ' + D.stateHash() + ', not ' + midHash);
        const resumed = playOut();
        if(resumed !== straight)
          endErr = endErr || (tag + ': ' + straight + ' straight vs ' + resumed + ' resumed');
        ran++;
      }
      check('a mid-game AI save rebuilds to the same position  [' + ran + ' configs]',
        !midErr && ran === cfgs.length, midErr);
      check('a resumed AI game ends bit-identical to straight-through play  [' +
            ran + ' configs, 2-5 seats]', !endErr && ran === cfgs.length, endErr);
    } else skipped('a resumed AI game ends bit-identical to straight-through play',
                   'game.js exposes no saveObject/replaySave');

    /* game.js pumps AI turns itself when autoAI is on; that path must also end. */
    {
      const S = global.window.G;
      S.autoAI = true;
      D.startGame({ seed:31337, modules:{ brook:true },
        seats:[{ name:'A', human:false, personality:'wick', difficulty:'ewe' },
               { name:'B', human:false, personality:'bram', difficulty:'lamb' }] });
      const mode = (typeof D.runToEnd === 'function') ? D.runToEnd({ ai:true }) : S.mode;
      check('game.js autoAI pump drives a whole match to the end', mode === 'end',
        'ended in mode ' + mode + ' at move ' + S.moveNo);
    }
  }
}

console.log('');
console.log(fail ? 'AI-SMOKE FAILED  (' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped)'
     : skip ? 'AI-SMOKE PENDING ENGINE  (' + pass + ' passed, ' + skip +
              ' skipped — re-run when tiles/board/game land)'
            : 'AI-SMOKE OK  (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
