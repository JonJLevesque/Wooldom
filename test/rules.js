'use strict';
/* ==================================================================
   WOOLDOM — test/rules.js   (wave 1-B)

   The rulebook, as data. Every fixture is a hand-computed sequence of
   placements and postings with the scores and feature shapes worked out
   from design §1.3–§1.5 by hand, not by running the engine and blessing
   whatever fell out.

   The runner also enforces one invariant after EVERY placement that no
   fixture has to spell out: for every lane, fold and brook feature,
   `opens` must equal the number of (cell, side) pairs still exposed —
   an independent recount of the +1/−2 accounting.
   ================================================================== */
const { load } = require('./shim');

const results = [];
const check = (label, ok, note) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if(!ok && note) for(const n of [].concat(note)) console.log('       → ' + n);
  results.push(!!ok);
};

let B = null, loadErr = null;
try{
  const g = load();
  B = g.probe('({placeTile,canPlace,legalCells,postShepherd,canPost,featureAt,' +
              'scoreFeature,finalScore,resetBoard,stateHash,returnShepherds,supplyOf,' +
              'openSides,featureRoots,adjFoldRoots,completedAdjFolds,isComplete,' +
              'board,shrines,tileById,TILES,BROOK_TILES})');
}catch(e){ loadErr = e; }
check('engine loads headlessly', !loadErr, loadErr && (loadErr.message + '\n' + loadErr.stack));
if(loadErr){ console.log('RULES FAILED'); process.exit(1); }

const SEG_TYPE_NAME = { m:'meadow', l:'lane', f:'fold', s:'shrine', b:'brook' };

/* ---------------- the fixtures ----------------
   step forms:
     {place:[x,y,id,rot]}          lay a tile (must be legal)
     {place:[...], illegal:true}   assert the engine refuses it
     {place:[...], completes:n}    assert exactly n features finished
     {place:[...], then:[chk]}     assert feature shapes right after
     {post:[x,y,seg,seat]}         post a shepherd (must succeed)
     {post:[...], refused:true}    assert the engine refuses the post
   a feature check `chk` is {at:[x,y,seg], type, tiles, opens, rams,
     shepherds, folds (adjacent), doneFolds, same:[x,y,seg], notSame:[...]}
   fixture-level: score[] banked during play, supply[], expect:[chk],
     final:[{kind,pts,holders}] from finalScore(). */
const FIXTURES = [

{ name:'a two-tile fold scores 4 (uniform rule ⚑, no small-fold case)',
  seats:2,
  steps:[
    {place:[0,0,'FOLD1',0], then:[{at:[0,0,0], type:'fold', tiles:1, opens:1}]},
    {post:[0,0,0,0]},
    {place:[0,-1,'FOLD1',2], completes:1,
      then:[{at:[0,0,0], type:'fold', tiles:2, opens:0, rams:0, shepherds:0}]},
  ],
  score:[4,0], supply:[7,7] },

{ name:'a prize ram is worth a tile: closed 2×2 fold + 1 ram = 10',
  seats:2,
  steps:[
    {place:[0,0,'FOLD2A',1],   then:[{at:[0,0,0], opens:2, tiles:1}]},
    {post:[0,0,0,1]},
    {place:[1,0,'FOLD2A',2],   then:[{at:[0,0,0], opens:2, tiles:2}]},
    {place:[0,1,'FOLD2A',0],   then:[{at:[0,0,0], opens:2, tiles:3}]},
    {place:[1,1,'FOLD2A_R',3], completes:1,
      then:[{at:[0,0,0], type:'fold', tiles:4, rams:1, opens:0}]},
  ],
  score:[0,10] },

{ name:'a closed lane loop has no ends and scores 1 per tile',
  seats:2,
  steps:[
    {place:[0,0,'LANE2_C',3]},
    {post:[0,0,0,0]},
    {place:[1,0,'LANE2_C',0], then:[{at:[0,0,0], opens:2, tiles:2}]},
    {place:[0,1,'LANE2_C',2], then:[{at:[0,0,0], opens:2, tiles:3}]},
    {place:[1,1,'LANE2_C',1], completes:1,
      then:[{at:[0,0,0], type:'lane', tiles:4, opens:0}]},
  ],
  score:[4,0] },

{ name:'a crossing terminates its lanes (each arm is its own feature)',
  seats:2,
  steps:[
    {place:[0,0,'LANE2_S',1]},
    {place:[1,0,'LANE4',0], then:[
      {at:[0,0,0], type:'lane', tiles:2, opens:1},
      {at:[2,0,0], /* not yet placed */ absent:true}]},
    {place:[2,0,'LANE2_S',1], then:[
      {at:[0,0,0], tiles:2, opens:1},
      {at:[2,0,0], tiles:2, opens:1, notSame:[0,0,0]}]},
    {post:[0,0,0,0]},
    {place:[-1,0,'SHRINE_L',3], completes:1,
      then:[{at:[0,0,0], type:'lane', tiles:3, opens:0}]},
  ],
  score:[3,0] },

{ name:'a shrine scores 9 once all eight neighbours are down',
  seats:2,
  steps:[
    {place:[0,0,'SHRINE',0], then:[{at:[0,0,0], type:'shrine', opens:8}]},
    {post:[0,0,0,0]},
    {place:[1,0,'SHRINE',0]},
    {place:[0,1,'SHRINE',0]},
    {place:[-1,0,'SHRINE',0]},
    {place:[0,-1,'SHRINE',0], then:[{at:[0,0,0], opens:4}]},
    {place:[1,1,'SHRINE',0]},
    {place:[1,-1,'SHRINE',0]},
    {place:[-1,1,'SHRINE',0], then:[{at:[0,0,0], opens:1}]},
    {place:[-1,-1,'SHRINE',0], completes:1},
  ],
  score:[9,0], supply:[7,7] },

{ name:'an unfinished shrine scores 1 + its filled neighbours at the end',
  seats:2,
  steps:[
    {place:[0,0,'SHRINE',0]},
    {post:[0,0,0,1]},
    {place:[1,0,'SHRINE',0]},
    {place:[0,1,'SHRINE',0]},
    {place:[-1,0,'SHRINE',0], then:[{at:[0,0,0], opens:5}]},
  ],
  score:[0,0],
  final:[{kind:'shrine', pts:4, holders:[1]}] },

{ name:'merging two claimed lanes ties the majority — both seats score full',
  seats:2,
  steps:[
    {place:[0,0,'LANE2_S',1]},
    {post:[0,0,0,0]},
    {place:[0,1,'SHRINE',0]},
    {place:[1,1,'SHRINE',0]},
    {place:[2,1,'SHRINE',0]},
    {place:[2,0,'LANE2_S',1]},
    {post:[2,0,0,1]},
    {place:[1,0,'LANE2_S',1], then:[
      {at:[0,0,0], tiles:3, opens:2, shepherds:2, same:[2,0,0]}]},
    {place:[-1,0,'SHRINE_L',3], then:[{at:[0,0,0], tiles:4, opens:1}]},
    {place:[3,0,'SHRINE_L',1], completes:1,
      then:[{at:[0,0,0], type:'lane', tiles:5, opens:0}]},
  ],
  score:[5,5], supply:[7,7] },

{ name:'a shepherd may not join a feature that is already claimed',
  seats:3,
  steps:[
    {place:[0,0,'LANE2_S',1]},
    {post:[0,0,0,0]},
    {place:[1,0,'LANE2_S',1]},
    {post:[1,0,0,1], refused:true},              // the same lane, now merged
    {post:[1,0,1,1]},                            // the verge south of it is still free
    {post:[0,0,1,2], refused:true},              // …and it reaches back under this tile
    {post:[0,0,2,2]},                            // the verge NORTH of the lane is a
  ],                                             // different meadow — the lane splits them
  supply:[6,6,6] },

{ name:'a spanning fold splits the meadows either side of it',
  seats:2,
  steps:[
    {place:[0,0,'FOLD2O',0]},
  ],
  expect:[
    {at:[0,0,0], type:'fold', opens:2},
    {at:[0,0,1], type:'meadow', folds:1, notSame:[0,0,2]},
    {at:[0,0,2], type:'meadow', folds:1},
  ]},

{ name:'facing folds leave one meadow wrapping both of them',
  seats:2,
  steps:[
    {place:[0,0,'FOLD2SEP_O',0]},
  ],
  expect:[
    {at:[0,0,0], type:'fold', opens:1, notSame:[0,0,1]},
    {at:[0,0,2], type:'meadow', tiles:1, folds:2, doneFolds:0},
  ]},

{ name:'a meadow scores 3 per finished fold it feeds (⚑ single variant)',
  seats:2,
  steps:[
    {place:[0,0,'FOLD2SEP_O',0]},
    {post:[0,0,2,0]},                            // herder on the wrapping meadow
    {place:[0,-1,'FOLD1',2], completes:1},
    {place:[0,1,'FOLD1',0],  completes:1,
      then:[{at:[0,0,2], type:'meadow', folds:2, doneFolds:2}]},
  ],
  score:[0,0],                                   // neither fold was herded
  final:[{kind:'meadow', pts:6, holders:[0]}] },

{ name:'end formulas: unfinished lane 1/tile, fold 1/tile, shrine 1+neighbours',
  seats:2,
  steps:[
    {place:[0,0,'LANE2_S',1]},
    {post:[0,0,0,0]},
    {place:[0,1,'FOLD1',2]},
    {post:[0,1,0,1]},
    {place:[1,1,'SHRINE',0]},
    {post:[1,1,0,0]},
  ],
  final:[
    {kind:'lane',   pts:1, holders:[0]},
    {kind:'fold',   pts:1, holders:[1]},
    {kind:'shrine', pts:3, holders:[0]},
  ]},

{ name:'an unfinished fold counts its ram as a tile at the end',
  seats:2,
  steps:[
    {place:[0,0,'FOLD2A_R',0]},
    {post:[0,0,0,1]},
  ],
  expect:[{at:[0,0,0], type:'fold', rams:1, opens:2}],
  final:[{kind:'fold', pts:2, holders:[1]}] },

/* The four arms of a Market Cross are four separate features sharing one
   cell. Completing one must pay for that arm alone — this is the case
   where identifying a feature by its cell (or by cell+type) would pay out
   against the wrong one MID-GAME, with no final-scoring test to catch it. */
{ name:'completing one arm of a crossing pays that arm, not its three neighbours',
  seats:2,
  steps:[
    {place:[0,0,'LANE4',0], then:[
      {at:[0,0,0], type:'lane', tiles:1, opens:1, notSame:[0,0,1]},
      {at:[0,0,1], type:'lane', tiles:1, opens:1, notSame:[0,0,2]},
      {at:[0,0,2], type:'lane', tiles:1, opens:1, notSame:[0,0,3]},
      {at:[0,0,3], type:'lane', tiles:1, opens:1, notSame:[0,0,0]}]},
    {post:[0,0,0,0]},                            // seat 0 takes the north arm
    {post:[0,0,1,1]},                            // seat 1 takes the east arm
    {place:[0,-1,'SHRINE_L',0], completes:1, then:[
      {at:[0,0,0], type:'lane', tiles:2, opens:0, shepherds:0},
      {at:[0,0,1], type:'lane', tiles:1, opens:1, shepherds:1},
      {at:[0,0,2], type:'lane', tiles:1, opens:1},
      {at:[0,0,3], type:'lane', tiles:1, opens:1}]},
  ],
  score:[2,0],                                   // the north arm only
  supply:[7,6] },

/* The fold counterpart: Neighbour Folds holds two walled areas on one
   cell that score separately. Closing one must not close the other, pay
   against it, or send home the shepherd standing in it. */
{ name:'two folds on one cell score separately — closing one leaves the other open',
  seats:2,
  steps:[
    {place:[0,0,'FOLD2SEP_A',0], then:[
      {at:[0,0,0], type:'fold', tiles:1, opens:1, notSame:[0,0,1]},
      {at:[0,0,1], type:'fold', tiles:1, opens:1}]},
    {post:[0,0,0,0]},                            // seat 0 in the north fold
    {post:[0,0,1,1]},                            // seat 1 in the east fold
    {place:[0,-1,'FOLD1',2], completes:1, then:[
      {at:[0,0,0], type:'fold', tiles:2, opens:0, shepherds:0},
      {at:[0,0,1], type:'fold', tiles:1, opens:1, shepherds:1}]},
  ],
  score:[4,0],                                   // the north fold only
  supply:[7,6] },

{ name:'seven shepherds and no more; scoring sends them home',
  seats:2,
  steps:[
    {place:[0,0,'SHRINE',0]}, {post:[0,0,0,0]},
    {place:[1,0,'SHRINE',0]}, {post:[1,0,0,0]},
    {place:[2,0,'SHRINE',0]}, {post:[2,0,0,0]},
    {place:[3,0,'SHRINE',0]}, {post:[3,0,0,0]},
    {place:[4,0,'SHRINE',0]}, {post:[4,0,0,0]},
    {place:[5,0,'SHRINE',0]}, {post:[5,0,0,0]},
    {place:[6,0,'SHRINE',0]}, {post:[6,0,0,0]},
    {place:[7,0,'SHRINE',0]}, {post:[7,0,0,0], refused:true},
  ],
  supply:[0,7] },

{ name:'illegal placements: mismatched sides, occupied cells, floating tiles',
  seats:2,
  steps:[
    {place:[0,0,'FOLD1_LS',0]},                  // F north, lane E–W, meadow south
    {place:[1,0,'SHRINE',0],   illegal:true},    // meadow meets the lane
    {place:[0,0,'LANE2_S',1],  illegal:true},    // cell is taken
    {place:[3,3,'SHRINE',0],   illegal:true},    // touches nothing
    {place:[0,-1,'FOLD1',0],   illegal:true},    // meadow meets the fold wall
    {place:[0,-1,'FOLD1',2]},                    // …rotated to face it, fine
  ]},

{ name:'opens accounting holds across a placement that joins on two sides',
  seats:2,
  steps:[
    {place:[0,0,'LANE2_C',3], then:[{at:[0,0,0], opens:2}]},
    {place:[1,0,'LANE2_C',0], then:[{at:[0,0,0], opens:2}]},
    {place:[0,1,'LANE2_C',2], then:[{at:[0,0,0], opens:2}]},
    {place:[1,1,'FOLD1_LS',2], illegal:true},    // fold south meets a lane
    {place:[1,1,'LANE2_C',1], completes:1, then:[{at:[0,0,0], opens:0, tiles:4}]},
  ]},

];

/* ---------------- the runner ---------------- */
function featureOf(chk){ return B.featureAt(chk.at[0], chk.at[1], chk.at[2]); }

function verify(chk, errs, where){
  const m = featureOf(chk);
  if(chk.absent){ if(m) errs.push(where + 'expected no feature at ' + chk.at); return; }
  if(!m){ errs.push(where + 'no feature at ' + chk.at); return; }
  const cmp = (field, want, got) => {
    if(want != null && got !== want) errs.push(where + chk.at + ' ' + field + '=' + got + ', expected ' + want);
  };
  cmp('type', chk.type, m.type);
  cmp('tiles', chk.tiles, m.cells.size);
  cmp('opens', chk.opens, m.opens);
  cmp('rams', chk.rams, m.rams);
  cmp('shepherds', chk.shepherds, m.shepherds.length);
  cmp('adjacent folds', chk.folds, chk.folds == null ? null : B.adjFoldRoots(m).length);
  cmp('finished adjacent folds', chk.doneFolds, chk.doneFolds == null ? null : B.completedAdjFolds(m).length);
  if(chk.same && B.featureAt(chk.same[0], chk.same[1], chk.same[2]) !== m)
    errs.push(where + chk.at + ' should be the same feature as ' + chk.same);
  if(chk.notSame && B.featureAt(chk.notSame[0], chk.notSame[1], chk.notSame[2]) === m)
    errs.push(where + chk.at + ' should NOT be the same feature as ' + chk.notSame);
}

function runFixture(f){
  const errs = [], seats = f.seats || 2;
  B.resetBoard(seats);
  const score = new Array(seats).fill(0);
  let n = 0;

  for(const st of f.steps){
    n++;
    const where = 'step ' + n + ': ';
    if(st.place){
      const [x, y, id, rot] = st.place;
      if(st.illegal){
        if(B.canPlace(id, rot, x, y)) errs.push(where + id + ' r' + rot + ' at ' + x + ',' + y + ' should be illegal');
        else if(B.placeTile(x, y, id, rot)) errs.push(where + 'placeTile accepted an illegal ' + id);
        continue;
      }
      const res = B.placeTile(x, y, id, rot);
      if(!res){ errs.push(where + id + ' r' + rot + ' at ' + x + ',' + y + ' was refused'); break; }
      if(st.completes != null && res.completed.length !== st.completes)
        errs.push(where + 'finished ' + res.completed.length + ' feature(s), expected ' + st.completes);
      for(const m of res.completed){
        for(const row of B.scoreFeature(m, false)) score[row.seat] += row.pts;
        B.returnShepherds(m);
      }
      for(const m of B.featureRoots()){          // the standing invariant
        if(m.type === 'meadow' || m.type === 'shrine') continue;
        const exposed = B.openSides(m).length;
        if(exposed !== m.opens)
          errs.push(where + m.type + ' ' + m.key + ' claims opens=' + m.opens + ' but ' + exposed + ' sides are exposed');
      }
    }else if(st.post){
      const [x, y, seg, seat] = st.post;
      const got = B.postShepherd(x, y, seg, seat), want = !st.refused;
      if(got !== want) errs.push(where + 'post ' + x + ',' + y + ':' + seg + ' seat ' + seat + ' → ' + got + ', expected ' + want);
      if(B.canPost(x, y, seg) && want && got) errs.push(where + 'canPost still true after a successful post');
    }
    for(const chk of st.then || []) verify(chk, errs, where);
  }

  for(const chk of f.expect || []) verify(chk, errs, '');
  if(f.score) for(let s = 0; s < f.score.length; s++)
    if(score[s] !== f.score[s]) errs.push('seat ' + s + ' banked ' + score[s] + ' during play, expected ' + f.score[s]);
  if(f.supply) for(let s = 0; s < f.supply.length; s++)
    if(B.supplyOf(s) !== f.supply[s]) errs.push('seat ' + s + ' has ' + B.supplyOf(s) + ' shepherds in hand, expected ' + f.supply[s]);
  if(f.final){
    const rows = B.finalScore();
    if(rows.length !== f.final.length)
      errs.push('finalScore gave ' + rows.length + ' row(s) [' + rows.map(r => r.kind + ' ' + r.pts).join(', ') + '], expected ' + f.final.length);
    for(let i = 0; i < Math.min(rows.length, f.final.length); i++){
      const got = rows[i], want = f.final[i];
      if(want.kind != null && got.kind !== want.kind) errs.push('final row ' + i + ' is a ' + got.kind + ', expected a ' + want.kind);
      if(want.pts != null && got.pts !== want.pts) errs.push('final row ' + i + ' (' + got.kind + ') scored ' + got.pts + ', expected ' + want.pts + ' — "' + got.detail + '"');
      if(want.holders && got.holders.join(',') !== want.holders.join(','))
        errs.push('final row ' + i + ' (' + got.kind + ') went to [' + got.holders + '], expected [' + want.holders + ']');
    }
  }
  return errs;
}

for(const f of FIXTURES){
  let errs;
  try{ errs = runFixture(f); }
  catch(e){ errs = [e.message + '\n' + e.stack]; }
  check(f.name, errs.length === 0, errs);
}

/* ---------------- engine-level checks outside the fixture table ---------------- */
(function stateHashIsStable(){
  const play = () => {
    B.resetBoard(2);
    B.placeTile(0, 0, 'FOLD1_LS', 0);
    B.placeTile(0, 1, 'LANE2_S', 0);
    B.postShepherd(0, 1, 0, 1);
    return B.stateHash();
  };
  const a = play(), b = play();
  check('stateHash is deterministic and 32-bit hex', a === b && /^[0-9a-f]{8}$/.test(a), 'got ' + a + ' then ' + b);
  B.postShepherd(0, 0, 3, 0);
  check('stateHash moves when a shepherd is posted', B.stateHash() !== a);
})();

(function resetClearsEverything(){
  B.resetBoard(2);
  B.placeTile(0, 0, 'SHRINE', 0);
  B.postShepherd(0, 0, 0, 0);
  const dirty = B.stateHash();
  B.resetBoard(2);
  check('resetBoard empties the pasture', B.board.size === 0 && B.shrines.length === 0 &&
        B.featureRoots().length === 0 && B.supplyOf(0) === 7 && B.stateHash() !== dirty);
})();

(function firstTileThenFrontier(){
  B.resetBoard(2);
  const opening = B.legalCells('FOLD1_LS');
  const openingOk = opening.length === 1 && opening[0].x === 0 && opening[0].y === 0 && opening[0].rots.length === 4;
  B.placeTile(0, 0, 'FOLD1_LS', 0);
  const next = B.legalCells('LANE2_S');
  const cells = next.map(c => c.x + ',' + c.y).sort().join(' ');
  check('an empty pasture takes any tile; then only the frontier',
    openingOk && next.length <= 4 && next.every(c => Math.abs(c.x) + Math.abs(c.y) === 1),
    'opening=' + JSON.stringify(opening) + '  next=' + cells);
})();

(function legalCellsNeverOffersWhatPlacementRefuses(){
  /* The empty-board fast path used to hand back the origin without asking
     canPlace, so a tile the lookups cannot resolve — an unregistered pack
     row — was offered with four rotations and then refused by placeTile.
     That reads as "the tile is fine, the placement failed" and sends you
     hunting in the wrong file, so it is asserted on BOTH boards now. */
  const bad = [];
  const unknown = 'NO_SUCH_TILE';
  B.resetBoard(2);
  for(const c of B.legalCells(unknown)) for(const r of c.rots)
    bad.push('empty board offers an unknown tile at ' + c.x + ',' + c.y + ' r' + r);
  for(let r = 0; r < 4; r++) if(B.canPlace(unknown, r, 0, 0))
    bad.push('canPlace allows an unknown tile at the origin r' + r);
  if(B.placeTile(0, 0, unknown, 0)) bad.push('placeTile accepted an unknown tile');

  for(const t of B.TILES.concat(B.BROOK_TILES)){   // the real tiles, empty board
    B.resetBoard(2);
    const offered = new Set();
    for(const c of B.legalCells(t.id)) for(const r of c.rots) offered.add(c.x + ',' + c.y + ':' + r);
    for(let r = 0; r < 4; r++){
      const can = B.canPlace(t.id, r, 0, 0), has = offered.has('0,0:' + r);
      if(can !== has) bad.push(t.id + ' r' + r + ' on an empty board: canPlace=' + can + ' legalCells=' + has);
    }
  }
  check('on an empty board legalCells still defers to canPlace', bad.length === 0, bad);
})();

(function legalCellsAgreesWithCanPlace(){
  B.resetBoard(2);
  B.placeTile(0, 0, 'FOLD1_LS', 0);
  B.placeTile(1, 0, 'LANE2_S', 1);
  B.placeTile(0, 1, 'FOLD2SEP_O', 1);
  let bad = null;
  for(const t of B.TILES){
    const listed = new Set();
    for(const c of B.legalCells(t.id)) for(const r of c.rots) listed.add(c.x + ',' + c.y + ':' + r);
    for(let x = -3; x <= 4 && !bad; x++) for(let y = -3; y <= 4 && !bad; y++) for(let r = 0; r < 4; r++){
      const can = B.canPlace(t.id, r, x, y), has = listed.has(x + ',' + y + ':' + r);
      if(can !== has){ bad = t.id + ' r' + r + ' at ' + x + ',' + y + ': canPlace=' + can + ' legalCells=' + has; break; }
    }
    if(bad) break;
  }
  check('legalCells enumerates exactly what canPlace allows', !bad, bad);
})();

(function aFeatureIsCellAndSegmentNeverCellAndType(){
  /* Alone on the board a tile has no joins, so each of its segments must
     be its own feature. Most of the roster carries two or more segments
     of a single type — four lanes on a Market Cross, four meadow
     quarters on a Plank Crossing, two folds on Facing Folds — so this
     sweeps every tile rather than the two or three worth naming. */
  const bad = [], multi = [];
  for(const t of B.TILES.concat(B.BROOK_TILES)){
    const byType = {};
    for(const sg of t.segs) byType[sg.t] = (byType[sg.t] || 0) + 1;
    const dup = Object.keys(byType).filter(k => byType[k] > 1);
    if(dup.length) multi.push(t.id + '(' + dup.map(k => k + '×' + byType[k]).join(',') + ')');

    B.resetBoard(2);
    if(!B.placeTile(0, 0, t.id, 0)){ bad.push('could not open the board with ' + t.id); continue; }
    const roots = new Set();
    for(let i = 0; i < t.segs.length; i++){
      const m = B.featureAt(0, 0, i);
      if(!m){ bad.push(t.id + ' segment ' + i + ' has no feature'); continue; }
      roots.add(m);
      if(m.cells.size !== 1) bad.push(t.id + ' segment ' + i + ' spans ' + m.cells.size + ' cells while alone on the board');
      if(m.type !== SEG_TYPE_NAME[t.segs[i].t]) bad.push(t.id + ' segment ' + i + ' is a ' + m.type + ', expected ' + t.segs[i].t);
    }
    if(roots.size !== t.segs.length)
      bad.push(t.id + ' has ' + t.segs.length + ' segments but only ' + roots.size +
               ' distinct features on one cell — a feature is being identified by its cell');
  }
  check('every segment of a lone tile is its own feature', bad.length === 0, bad);
  console.log('note  ' + multi.length + ' of the ' + (B.TILES.length + B.BROOK_TILES.length) +
              ' tiles carry two or more segments of one type on a single cell, so neither ' +
              'cells nor (cell,type) identify a feature — only (cell,segIdx) does');
})();

(function finalScoreRowsAreIdentifiable(){
  /* Two meadows of a spanning fold cover the same one cell, so the
     walkthrough rows must be distinguishable by something other than
     their cells or the reveal will highlight the wrong grass. */
  B.resetBoard(2);
  B.placeTile(0, 0, 'FOLD2O', 0);
  B.postShepherd(0, 0, 1, 0);
  B.postShepherd(0, 0, 2, 1);
  const rows = B.finalScore();
  const keys = new Set(rows.map(r => r.key));
  const cellSets = new Set(rows.map(r => r.cells.join('|')));
  check('every finalScore row carries a unique key, even when the cells collide',
    rows.length === 2 && keys.size === 2 && cellSets.size === 1 &&
    rows.every(r => typeof r.key === 'string' && r.key) &&
    rows[0].holders.join() === '0' && rows[1].holders.join() === '1',
    JSON.stringify(rows.map(r => ({ key:r.key, cells:r.cells, holders:r.holders }))));
})();

console.log(results.every(Boolean) ? 'RULES OK' : 'RULES FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
