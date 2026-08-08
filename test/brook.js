'use strict';
/* Wooldom — test/brook.js
   The brook opening, design §1.6: the Spring auto-placed, the Fork forced into
   the first four draws and opening a second branch, the lake holdback, the
   no-U-turn rule, posting during the opening, and the brook-OFF opener.

   The no-U-turn case is a hand-computed fixture rather than a seeded playout,
   because the point is to prove the rule rejects a SPECIFIC rotation while
   accepting its mirror — a random game only proves it rejects something. */

const { load } = require('./shim');

const results = [];
function check(label, ok, note){
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (note && !ok ? '\n  → ' + note : ''));
  results.push(!!ok);
}

let g = null, err = null;
try{ g = load(); }catch(e){ err = e; }
if(err){
  console.log('FAIL  suite could not load the modules\n  → ' + err.message);
  console.log('BROOK FAILED');
  process.exit(1);
}
const D = g.D, probe = g.probe;
const G = probe('G');
const HUMANS = [{human:true, name:'A'}, {human:true, name:'B'}];
const GDX = [0,1,0,-1], GDY = [-1,0,1,0];

/* module internals the suite reaches through the shim's eval probe — these are
   game.js's own functions, not a test-only back door around them */
const edgeCode = probe('edgeCode'), cellKey = probe('cellKey');
const brookAnalyze = probe('brookAnalyze'), postOptions = probe('postOptions');
const legalPlacements = probe('legalPlacements'), drawFn = probe('draw');
const OPENING_TILE = probe('OPENING_TILE');

function prng(seed){
  let s = seed|0;
  return ()=>{ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s);
    t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
}
/* one full turn through the real input path; returns the tile it laid */
function playTurn(rnd, postRate){
  if(G.step !== 'place') return null;
  const id = G.drawn;
  const cands = D.legal();
  if(!cands.length) return null;
  const c = cands[(rnd()*cands.length)|0];
  if(!D.place(c.x, c.y, c.rots[(rnd()*c.rots.length)|0])) return null;
  if(G.step === 'post'){
    const o = postOptions();
    if(o.length && rnd() < (postRate==null ? 0.35 : postRate)) D.spot(o[(rnd()*o.length)|0]);
    else D.skip();
  }
  return id;
}
/* play the opening out, returning the brook tiles in the order they were laid */
function runBrook(seed, postRate){
  D.startGame({seed, seats:HUMANS, modules:{brook:true}});
  const rnd = prng(seed*7919 + 13), laid = [];
  while(G.mode === 'brook'){
    const id = playTurn(rnd, postRate);
    if(id == null) break;
    laid.push(id);
  }
  return laid;
}
/* force a known brook queue so a fixture does not depend on a shuffle */
function forceBrookQueue(ids){
  G.brook.queue.length = 0; G.brook.held.length = 0;
  for(const id of ids) G.brook.queue.push(id);
  G.drawn = null;
  return drawFn();
}

/* ---------------- 1. setup: the Spring is the board, not a move ---------------- */
D.startGame({seed:5, seats:HUMANS, modules:{brook:true}});
const springCell = D.board().get(cellKey(0,0));
check('brook ON opens in brook mode with the Spring at the origin',
  G.mode === 'brook' && D.board().size === 1 && springCell && springCell.tileId === 'B_SPRING',
  'mode=' + G.mode + ' board=' + D.board().size);
check('the Spring belongs to nobody (seat −1), not to the first seat',
  springCell && springCell.seat === -1, 'seat=' + (springCell && springCell.seat));
const springB = [...edgeCode('B_SPRING',0)].filter(c=>c==='B').length;
check('the Spring opens exactly one brook end, read off its own edges',
  G.brook.ends.length === 1 && springB === 1,
  'ends=' + JSON.stringify(G.brook.ends));
check('the satchel is untouched by the opening (all 72 base tiles still in it)',
  D.satchel() === 72, 'satchel=' + D.satchel());

/* Tiles are conserved: on the board, in the satchel, set aside, or in hand.
   The tile in hand is the one everything else forgets. */
const BROOK_IDS = new Set(probe('BROOK_TILES').map(t=>t.id));
function dealt(){ return D.board().size + D.satchel() + G.dead.length + (G.drawn ? 1 : 0); }
function brookTilesAccountedFor(){
  let n = 0;
  for(const c of D.board().values()) if(BROOK_IDS.has(c.tileId)) n++;
  for(const id of G.dead) if(BROOK_IDS.has(id)) n++;
  if(G.drawn && BROOK_IDS.has(G.drawn)) n++;
  return n;
}

/* ---------------- 2. the Fork: first four draws, two branches ---------------- */
let forkLate = 0, forkRanks = [];
for(let s=1; s<=60; s++){
  const laid = runBrook(s);
  const r = laid.indexOf('B_FORK');
  forkRanks.push(r);
  if(r < 0 || r >= 4) forkLate++;
}
check('the Fork is drawn within the first four draws, every seed (60 seeds)',
  forkLate === 0, 'seeds with a late/absent fork: ' + forkLate + ' ranks=' + forkRanks.slice(0,12));

D.startGame({seed:5, seats:HUMANS, modules:{brook:true}});
forceBrookQueue(['B_FORK','B_STR','B_STR','B_CURVE']);
const endsBeforeFork = G.brook.ends.length;
const forkCands = D.legal();
D.place(forkCands[0].x, forkCands[0].y, forkCands[0].rots[0]);
if(G.step === 'post') D.skip();
check('the Fork turns one open end into two',
  endsBeforeFork === 1 && G.brook.ends.length === 2,
  'before=' + endsBeforeFork + ' after=' + G.brook.ends.length);

/* both branches must be genuinely extendable, not merely counted */
const extendable = G.brook.ends.filter(e=>{
  const tx = e.x+GDX[e.side], ty = e.y+GDY[e.side];
  for(let r=0;r<4;r++) if(brookAnalyze('B_STR', r, tx, ty, false).ok) return true;
  return false;
});
check('both of the Fork\'s ends can actually be extended edge to edge',
  extendable.length === 2, 'extendable=' + extendable.length + ' of ' + G.brook.ends.length);

/* ---------------- 3. no U-turn (hand-computed fixture) ----------------
   B_CURVE is [M,B,B,M]: brook on E and S at rot 0. Entering a cell from the
   NORTH, only two rotations show brook back at the entry —
     rot2 (BMMB) in N out W: turn = (3−2+4)%4 = 1  → clockwise
     rot3 (BBMM) in N out E: turn = (1−2+4)%4 = 3  → anticlockwise
   so a curve entered from the north bends one way or the other and never
   straight, which is exactly the case §1.6 legislates. */
D.startGame({seed:5, seats:HUMANS, modules:{brook:true}});
forceBrookQueue(['B_CURVE','B_CURVE','B_CURVE','B_CURVE']);
const bothWays = [2,3].every(r => brookAnalyze('B_CURVE', r, 0, 1, false).ok);
check('a first curve may bend either way (nothing to repeat yet)', bothWays);

D.place(0, 1, 2);                       // bend clockwise
if(G.step === 'post') D.skip();
const branch = G.brook.ends[0];
check('the branch remembers which way it just bent',
  G.brook.ends.length === 1 && branch.lastTurn === 1,
  'ends=' + JSON.stringify(G.brook.ends));

const tx = branch.x + GDX[branch.side], ty = branch.y + GDY[branch.side];
const again = brookAnalyze('B_CURVE', 3, tx, ty, false);   // would bend clockwise again
const mirror = brookAnalyze('B_CURVE', 0, tx, ty, false);  // bends anticlockwise
check('a second bend the SAME way is rejected',
  again.ok === false && /successive bends/.test(again.why || ''),
  JSON.stringify(again));
check('the mirror bend is accepted', mirror.ok === true, JSON.stringify(mirror));
check('the rejected rotation is absent from the legal placements, so it can never be played',
  !(legalPlacements('B_CURVE').find(c=>c.x===tx && c.y===ty) || {rots:[]}).rots.includes(3));
check('place() refuses the U-turn and accepts the mirror through the real input path',
  D.place(tx, ty, 3) === false && D.place(tx, ty, 0) === true);
if(G.step === 'post') D.skip();
const relaxed = brookAnalyze('B_CURVE', 3, tx, ty, true);
check('the rule is a shaping rule: relaxing it is what stops a cornered brook stranding a tile',
  relaxed.ok === true || relaxed.why !== 'no two successive bends the same way',
  JSON.stringify(relaxed));

/* ---------------- 4. the lake holdback ---------------- */
let heldSeeds = 0, lakeEarly = 0, forkAfterLake = 0, noHoldButUnsorted = 0;
const SEEDS = 60;
for(let s=1; s<=SEEDS; s++){
  const laid = runBrook(s);
  const firstLake = laid.indexOf('B_LAKE');
  const lastMid = laid.map((id,i)=>id==='B_LAKE'?-1:i).reduce((a,b)=>b>a?b:a, -1);
  if(firstLake >= 0 && firstLake < lastMid) lakeEarly++;              // a lake ahead of a middle
  if(firstLake >= 0 && laid.indexOf('B_FORK') > firstLake) forkAfterLake++;
  if(G.brook.heldEver > 0) heldSeeds++;
  /* A deal that held nothing had no work for the rule to do: the shuffle put
     both lakes at the back by itself, which happens about one deal in 55
     (2!·9!/11!) — so demanding the holdback always fires would be asserting
     against the arithmetic. The one escape is an opening that corners itself
     and gets a tile set aside, which takes that tile out of the laid order. */
  else {
    const cornered = G.dead.some(id=>BROOK_IDS.has(id));
    if(!cornered && !laid.slice(-2).every(id=>id==='B_LAKE')) noHoldButUnsorted++;
  }
}
check('the holdback is load-bearing: it fires on ' + heldSeeds + ' of ' + SEEDS + ' deals',
  heldSeeds > 0, 'it never fired — the rule is doing nothing');
check('a deal that held nothing had already shuffled both lakes last',
  noHoldButUnsorted === 0, 'deals that skipped the holdback but were unsorted: ' + noHoldButUnsorted);
check('no lake is ever laid while an ordinary brook tile is still to come',
  lakeEarly === 0, 'seeds with an early lake: ' + lakeEarly);
check('the Fork is always laid before any lake (§1.6 "reinserted after the fork")',
  forkAfterLake === 0, 'violations: ' + forkAfterLake);

/* deterministic: the same seed twice is the same opening, tile for tile */
const runA = runBrook(21), hashA = D.stateHash();
const runB = runBrook(21), hashB = D.stateHash();
check('the same seed replays the same opening, tile for tile',
  runA.join(',') === runB.join(',') && runA.length > 0,
  runA.join(',') + '\n    vs ' + runB.join(','));
check('and lands on the same stateHash', hashA === hashB, hashA + ' vs ' + hashB);

/* ---------------- 5. the lakes terminate the branches ----------------
   The chain arithmetic: the Spring opens one end, a two-brook-edge tile is net
   zero, the Fork is net +1, a lake is net −1 — so an opening that lays all 11
   tiles must close both ends.

   dead[] holds two different things and counting them together is the metric
   trap this module invites (tiles-a hit it independently from the data side,
   getting 22.4% where the true figure was 19.2%, and a different ranking of
   the candidate fixes out of it):
     LEFTOVER  the brook never needed the tile — converging branches closed an
               end by confluence, which is a real edge-matched join and closes
               it just as properly as a lake. Benign.
     STRANDED  the tile had nowhere legal to go. Even this only costs something
               when the stranded tile is a LAKE: a middle carries two brook
               edges, so dropping it is parity-neutral and the two lakes still
               close the two branches.
   The honest failure metric is open ends at close, not tiles set aside. */
let laidAll = 0, closedWhenWhole = 0, openAtClose = 0, everOver2 = 0, lost = 0;
let stranded = 0, strandedLakes = 0, leftover = 0, openWithEveryLakePlaced = 0;
const SWEEP = 120;
for(let s=1; s<=SWEEP; s++){
  D.startGame({seed:s, seats:HUMANS, modules:{brook:true}});
  const rnd = prng(s*104729 + 7);
  let maxEnds = 0;
  while(G.mode === 'brook'){
    maxEnds = Math.max(maxEnds, G.brook.ends.length);
    if(playTurn(rnd) == null) break;
  }
  const b = G.brook;
  stranded += b.stranded; strandedLakes += b.strandedLakes; leftover += b.leftover;
  if(maxEnds > 2) everOver2++;
  if(b.stranded === 0){ laidAll++; if(b.ends.length === 0) closedWhenWhole++; }
  if(b.ends.length){ openAtClose++; if(!b.strandedLakes) openWithEveryLakePlaced++; }
  /* every brook tile is on the board, set aside, or in hand — none evaporate,
     including any left in the queue when the last end closed */
  if(brookTilesAccountedFor() !== 12 || dealt() !== 84) lost++;
}
check('every one of the 12 brook tiles is always accounted for, and the deal always totals 84',
  lost === 0, 'seeds losing a tile: ' + lost);
check('an opening that strands nothing always closes both ends with the two lakes',
  laidAll > 0 && closedWhenWhole === laidAll,
  laidAll + ' openings stranded nothing, ' + closedWhenWhole + ' of them closed');
check('an end is left open ONLY when a lake was stranded — dropping a middle is parity-neutral',
  openWithEveryLakePlaced === 0,
  openAtClose + ' openings ended with an open end, ' + openWithEveryLakePlaced +
  ' of those with every lake placed');
check('leftover tiles cost nothing: a confluence closes an end as properly as a lake',
  openAtClose <= strandedLakes,
  'leftover=' + leftover + ' openAtClose=' + openAtClose + ' strandedLakes=' + strandedLakes);
check('the brook never opens a third branch (only the Fork adds one)',
  everOver2 === 0, 'seeds exceeding 2 open ends: ' + everOver2);
console.log('  note: over ' + SWEEP + ' openings — ' + openAtClose + ' ended with a dead-end stream (' +
            (100*openAtClose/SWEEP).toFixed(1) + '%); ' + stranded + ' tile(s) stranded of which ' +
            strandedLakes + ' were lakes; ' + leftover + ' left over as unnecessary');

/* ---------------- 6. posting during the opening (§1.6 allows it) ---------------- */
D.startGame({seed:5, seats:HUMANS, modules:{brook:true}});
forceBrookQueue(['B_STR','B_STR','B_CURVE']);
const before = G.seats[G.turnIdx].supply, poster = G.turnIdx;
const pc = D.legal()[0];
D.place(pc.x, pc.y, pc.rots[0]);
const opts = postOptions();
check('a brook tile offers postable segments', opts.length > 0, 'options=' + JSON.stringify(opts));
const tile = D.TILES && probe('tileById')(G.pending.tileId);
const brookSeg = tile.segs.findIndex(s=>s.t==='b');
check('the brook segment itself is never postable — the brook does not score',
  brookSeg >= 0 && !opts.includes(brookSeg),
  'brookSeg=' + brookSeg + ' options=' + JSON.stringify(opts));
const posted = D.spot(opts[0]);
check('a shepherd may be posted during the brook phase and leaves the supply',
  posted === true && G.seats[poster].supply === before - 1,
  'posted=' + posted + ' supply ' + before + '→' + G.seats[poster].supply);
check('the posted shepherd is on the feature the board reports',
  (D.featureAt(pc.x, pc.y, opts[0]) || {shepherds:[]}).shepherds.some(s=>s.seat===poster));

/* ---------------- 7. brook OFF: the single opening tile ---------------- */
D.startGame({seed:5, seats:HUMANS, modules:{brook:false}});
const opener = D.board().get(cellKey(0,0));
check('brook OFF pre-places one Gate Road at the origin and starts in play',
  G.mode === 'play' && D.board().size === 1 && opener && opener.tileId === OPENING_TILE,
  'mode=' + G.mode + ' tile=' + (opener && opener.tileId));
check('the opening tile comes OUT of the 72, so the deal still totals 72 (one is already in hand)',
  D.satchel() === 70 && G.drawn != null && dealt() === 72,
  'satchel=' + D.satchel() + ' drawn=' + G.drawn + ' dealt=' + dealt());
check('there is no brook state to extend when the module is off',
  G.brook === null, 'brook=' + JSON.stringify(G.brook));
check('brook OFF still reaches the end screen',
  (D.runToEnd({seed:5}), G.mode === 'end'), 'mode=' + G.mode);

const ok = results.every(Boolean);
console.log(ok ? 'BROOK OK' : 'BROOK FAILED');
process.exit(ok ? 0 : 1);
