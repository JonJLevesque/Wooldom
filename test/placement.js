'use strict';
/* ==================================================================
   WOOLDOM — test/placement.js   (wave 1-B)

   Legality proofs. Three things are being defended here:

   1. The slot/rotation convention is shared. board.js maps a canonical
      slot c to board slot (c + 3·rot) % 12 and reads the side off it;
      tiles.js rotates the `edges` array. If those two ever disagree the
      board still *looks* legal while folds and lanes merge into the
      wrong features, so the agreement is asserted tile by tile.
   2. Legality is symmetric and exactly characterised. On a one-tile
      board, tile B is placeable if and only if B shares an edge
      character with the tile already down — an exact iff, not a
      "usually works", which also proves the relation is symmetric.
   3. The frontier fast path is honest. legalCells() answers from a
      cached per-cell requirement table; it is checked against a
      brute-force sweep of the whole bounding box on seeded boards.
   ================================================================== */
const { load } = require('./shim');

const results = [];
const check = (label, ok, note) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if(!ok && note) for(const n of [].concat(note).slice(0, 8)) console.log('       → ' + n);
  results.push(!!ok);
};

let B = null, loadErr = null;
try{
  const g = load();
  B = g.probe('({placeTile,canPlace,legalCells,resetBoard,setTileSource,board,featureAt,' +
              'tileById,edgeCode,slotOwner,TILES,BROOK_TILES,RNG})');
}catch(e){ loadErr = e; }
check('engine loads headlessly', !loadErr, loadErr && (loadErr.message + '\n' + loadErr.stack));
if(loadErr){ console.log('PLACEMENT FAILED'); process.exit(1); }

const ALL = B.TILES.concat(B.BROOK_TILES);
const OPENING = 'FOLD1_LS';                     // pre-placed when the Brook module is off
const TYPE_CHAR = { m:'M', l:'L', f:'F', b:'B' };
const rotSlot = (slot, rot) => (slot + 3 * rot) % 12;
/* the design's own rotation formula, recomputed here rather than imported */
const rawCode = (id, rot) => {
  const e = B.tileById(id).edges;
  return [0,1,2,3].map(s => e[(s - rot + 4) % 4]);
};

/* ---------------- 1. the encoding itself ---------------- */
(function slotPartition(){
  const bad = [];
  for(const t of ALL){
    const owner = new Array(12).fill(-1);
    t.segs.forEach((sg, i) => {
      for(const slot of (sg.e || [])){
        if(slot < 0 || slot > 11) bad.push(t.id + ' seg ' + i + ' has slot ' + slot);
        else if(owner[slot] >= 0) bad.push(t.id + ' slot ' + slot + ' claimed by segs ' + owner[slot] + ' and ' + i);
        else owner[slot] = i;
      }
      if(sg.t === 's' && (sg.e || []).length) bad.push(t.id + ' shrine seg ' + i + ' owns slots');
    });
    for(let s = 0; s < 12; s++) if(owner[s] < 0) bad.push(t.id + ' slot ' + s + ' is unowned');
    for(let s = 0; s < 12; s++) if(B.slotOwner(t, s) !== owner[s])
      bad.push(t.id + ' slotOwner(' + s + ')=' + B.slotOwner(t, s) + ', segments say ' + owner[s]);
  }
  check('every slot of every tile belongs to exactly one segment', bad.length === 0, bad);
})();

(function rotationIsAnIdentityAfterFour(){
  const bad = [];
  for(let slot = 0; slot < 12; slot++){
    let s = slot;
    for(let i = 0; i < 4; i++) s = rotSlot(s, 1);
    if(s !== slot) bad.push('slot ' + slot + ' came back as ' + s);
  }
  for(const t of ALL){
    const zero = [...B.edgeCode(t.id, 0)].join('');
    for(let r = 0; r < 4; r++){
      const code = [...B.edgeCode(t.id, r)].join('');
      if(code.length !== 4) bad.push(t.id + ' r' + r + ' edge code is "' + code + '"');
      if([...B.edgeCode(t.id, r + 4)].join('') !== code) bad.push(t.id + ' r' + r + ' ≠ r' + (r + 4));
    }
    if([...B.edgeCode(t.id, 4)].join('') !== zero) bad.push(t.id + ' four quarter-turns is not the identity');
  }
  check('four quarter-turns bring slots and edge codes back to the start', bad.length === 0, bad);
})();

(function abutmentIsItsOwnInverse(){
  const bad = [];
  for(let side = 0; side < 4; side++) for(let i = 0; i < 3; i++){
    const theirSide = (side + 2) % 4, theirI = 2 - i;
    if((theirSide + 2) % 4 !== side || 2 - theirI !== i)
      bad.push('side ' + side + ' slot ' + i + ' does not abut back onto itself');
  }
  check('the abutment map side s slot i ↔ side s+2 slot 2−i is an involution', bad.length === 0, bad);
})();

(function edgeCodeAgreesWithSlotOwnership(){
  const bad = [];
  for(const t of ALL) for(let rot = 0; rot < 4; rot++){
    const code = B.edgeCode(t.id, rot);
    for(let side = 0; side < 4; side++){
      const canon = i => (side * 3 + i - 3 * rot + 12) % 12;
      const seg = i => t.segs[B.slotOwner(t, canon(i))];
      const centre = seg(1), flanks = [seg(0), seg(2)];
      if(!centre){ bad.push(t.id + ' r' + rot + ' side ' + side + ' has no centre segment'); continue; }
      if(TYPE_CHAR[centre.t] !== code[side])
        bad.push(t.id + ' r' + rot + ' side ' + side + ': edgeCode says ' + code[side] +
                 ' but the centre slot belongs to a ' + centre.t + ' segment');
      if(code[side] === 'L' || code[side] === 'B'){
        for(const f of flanks) if(f.t !== 'm')
          bad.push(t.id + ' r' + rot + ' side ' + side + ': a ' + code[side] + ' side must be flanked by meadow, found ' + f.t);
      }else{
        for(const f of flanks) if(f !== centre)
          bad.push(t.id + ' r' + rot + ' side ' + side + ': an ' + code[side] + ' side must give all three slots to one segment');
      }
    }
  }
  check('edgeCode and slot ownership agree at every rotation of every tile', bad.length === 0, bad);
})();

/* ---------------- 2. legality on a one-tile board ---------------- */
(function oneTileBoards(){
  const bad = [];
  const chars = t => new Set(t.edges);
  for(const a of ALL) for(let rot = 0; rot < 4; rot++){
    B.resetBoard(2);
    if(!B.placeTile(0, 0, a.id, rot)){ bad.push('could not open with ' + a.id + ' r' + rot); continue; }
    const av = chars(a);
    for(const b of ALL){
      const shares = [...chars(b)].some(c => av.has(c));
      const fits = B.legalCells(b.id).length > 0;
      if(fits !== shares)
        bad.push(b.id + ' on a lone ' + a.id + ' r' + rot + ': engine says ' + fits +
                 ', shared edge characters say ' + shares);
    }
    if(bad.length > 8) break;
  }
  check('on a one-tile board a tile fits exactly when it shares an edge character', bad.length === 0, bad);
})();

(function matchSymmetry(){
  const bad = [];
  const fitsOn = (host, guest) => { B.resetBoard(2); B.placeTile(0, 0, host, 0); return B.legalCells(guest).length > 0; };
  for(const a of ALL) for(const b of ALL){
    const ab = fitsOn(a.id, b.id), ba = fitsOn(b.id, a.id);
    if(ab !== ba) bad.push(a.id + '/' + b.id + ': ' + ab + ' one way, ' + ba + ' the other');
    if(bad.length > 8) break;
  }
  check('A fits beside B if and only if B fits beside A', bad.length === 0, bad);
})();

(function everyTileFitsTheOpeningTile(){
  B.resetBoard(2);
  B.placeTile(0, 0, OPENING, 0);
  const stuck = ALL.filter(t => B.legalCells(t.id).length === 0).map(t => t.id);
  check('every tile in the game can be played onto the opening tile', stuck.length === 0, stuck.join(', '));
})();

/* Which pairs simply cannot meet is a property of the mix, not a bug —
   an all-wall High Fold has nothing to say to an all-grass shrine. It is
   reported so the tile author can see the shape of it. */
(function reportDisjointPairs(){
  let pairs = 0;
  const lonely = new Map();
  for(let i = 0; i < ALL.length; i++) for(let j = i + 1; j < ALL.length; j++){
    const a = new Set(ALL[i].edges);
    if([...new Set(ALL[j].edges)].some(c => a.has(c))) continue;
    pairs++;
    for(const id of [ALL[i].id, ALL[j].id]) lonely.set(id, (lonely.get(id) || 0) + 1);
  }
  const worst = [...lonely].sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0] + '×' + e[1]);
  console.log('note  ' + pairs + ' of the ' + (ALL.length * (ALL.length - 1) / 2) +
              ' tile pairs share no edge character and can never sit side by side' +
              ' (most isolated: ' + worst.join(', ') + ')');
})();

/* ---------------- 3. the frontier fast path ---------------- */
function bruteLegal(tileId){
  const out = new Set();
  let minX = 0, maxX = 0, minY = 0, maxY = 0, first = true;
  for(const k of B.board.keys()){
    const c = k.indexOf(','), x = +k.slice(0, c), y = +k.slice(c + 1);
    if(first){ minX = maxX = x; minY = maxY = y; first = false; }
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const NB = [[0,-1],[1,0],[0,1],[-1,0]];
  for(let x = minX - 2; x <= maxX + 2; x++) for(let y = minY - 2; y <= maxY + 2; y++){
    if(B.board.has(x + ',' + y)) continue;
    for(let r = 0; r < 4; r++){
      const code = rawCode(tileId, r);
      let touching = false, ok = true;
      for(let s = 0; s < 4 && ok; s++){
        const o = B.board.get((x + NB[s][0]) + ',' + (y + NB[s][1]));
        if(!o) continue;
        touching = true;
        if(code[s] !== rawCode(o.tileId, o.rot)[(s + 2) % 4]) ok = false;
      }
      if(ok && touching) out.add(x + ',' + y + ':' + r);
    }
  }
  return out;
}

function randomBoard(seed, tiles){
  B.RNG.seed(seed);
  B.resetBoard(2);
  B.placeTile(0, 0, OPENING, 0);
  for(let i = 1; i < tiles; i++){
    const id = ALL[B.RNG.int(ALL.length)].id;
    const cells = B.legalCells(id);
    if(!cells.length) continue;
    const c = cells[B.RNG.int(cells.length)];
    B.placeTile(c.x, c.y, id, c.rots[B.RNG.int(c.rots.length)]);
  }
}

(function frontierMatchesBruteForce(){
  const bad = [];
  for(let seed = 1; seed <= 12 && bad.length <= 8; seed++){
    randomBoard(seed * 7919, 24);
    for(const t of ALL){
      const fast = new Set();
      for(const c of B.legalCells(t.id)) for(const r of c.rots) fast.add(c.x + ',' + c.y + ':' + r);
      const slow = bruteLegal(t.id);
      for(const k of fast) if(!slow.has(k)) bad.push('seed ' + seed + ': legalCells offers ' + t.id + ' at ' + k + ', brute force refuses');
      for(const k of slow) if(!fast.has(k)) bad.push('seed ' + seed + ': legalCells misses ' + t.id + ' at ' + k);
      if(bad.length > 8) break;
    }
  }
  check('legalCells matches a brute-force sweep on twelve seeded boards', bad.length === 0, bad);
})();

(function legalCellsIsCleanAndOrdered(){
  const bad = [];
  randomBoard(4242, 30);
  for(const t of ALL){
    const cells = B.legalCells(t.id);
    const seen = new Set();
    let prev = null;
    for(const c of cells){
      const k = c.x + ',' + c.y;
      if(seen.has(k)) bad.push(t.id + ' lists ' + k + ' twice');
      seen.add(k);
      if(!c.rots.length) bad.push(t.id + ' lists ' + k + ' with no legal rotation');
      if(new Set(c.rots).size !== c.rots.length) bad.push(t.id + ' repeats a rotation at ' + k);
      if(prev && (c.y < prev.y || (c.y === prev.y && c.x < prev.x))) bad.push(t.id + ' is out of order at ' + k);
      if(B.board.has(k)) bad.push(t.id + ' offers the occupied cell ' + k);
      prev = c;
    }
  }
  check('legalCells returns unique, ordered, non-empty, unoccupied cells', bad.length === 0, bad);
})();

(function everyPlacementIsReachableFromEveryRotation(){
  /* the UI's rotate key auto-advances to a rotation that is legal
     somewhere, so on a real board every tile must offer at least one */
  randomBoard(999331, 30);
  const stuck = ALL.filter(t => B.legalCells(t.id).length === 0).map(t => t.id);
  const rotless = ALL.filter(t => {
    const seen = new Set();
    for(const c of B.legalCells(t.id)) for(const r of c.rots) seen.add(r);
    return B.legalCells(t.id).length > 0 && seen.size === 0;
  }).map(t => t.id);
  check('on a 30-tile board every tile has somewhere to go', stuck.length === 0 && rotless.length === 0,
        'no home: ' + stuck.join(', '));
})();

/* ---------------- 4. the tile-source seam ---------------- */
(function tileSourceSeam(){
  /* board.js reads tile data through setTileSource so the engine can be
     driven by a fixture table (packs, and wave-1 bring-up before
     tiles.js landed). Kept alive so it does not rot. */
  const SOLO = { id:'X_CROSS', name:'test', edges:['L','L','L','L'], count:1,
                 segs:[{t:'l', e:[1], spot:[32,12]}, {t:'l', e:[4], spot:[52,32]},
                       {t:'l', e:[7], spot:[32,52]}, {t:'l', e:[10], spot:[12,32]},
                       {t:'m', e:[2,3], spot:[50,14]}, {t:'m', e:[5,6], spot:[50,50]},
                       {t:'m', e:[8,9], spot:[14,50]}, {t:'m', e:[11,0], spot:[14,14]}] };
  const src = {
    TILES:[SOLO], BROOK_TILES:[],
    tileById:id => (id === SOLO.id ? SOLO : null),
    edgeCode:(id, rot) => [0,1,2,3].map(s => SOLO.edges[(s - rot + 4) % 4]).join(''),
    slotOwner:(t, slot) => SOLO.segs.findIndex(sg => sg.e.indexOf(slot) >= 0),
  };
  let ok = false, note = '';
  try{
    B.setTileSource(src);
    B.resetBoard(2);
    B.placeTile(0, 0, 'X_CROSS', 0);
    B.placeTile(1, 0, 'X_CROSS', 0);
    const arm = B.featureAt(0, 0, 1);            // the east arm, joined to its neighbour
    ok = !!arm && arm.type === 'lane' && arm.cells.size === 2 && arm.opens === 0 &&
         B.legalCells('X_CROSS').length === 6 && !B.tileById('X_CROSS');
    note = arm ? 'arm cells=' + arm.cells.size + ' opens=' + arm.opens : 'no feature';
  }catch(e){ note = e.message; }
  finally{ B.setTileSource(null); B.resetBoard(2); }
  check('setTileSource swaps the tile table in and back out again', ok, note);
})();

(function realDataIsBackAfterTheSeamTest(){
  B.resetBoard(2);
  B.placeTile(0, 0, OPENING, 0);
  check('the real tile table is restored afterwards',
        B.legalCells('LANE2_S').length > 0 && !!B.tileById(OPENING));
})();

console.log(results.every(Boolean) ? 'PLACEMENT OK' : 'PLACEMENT FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
