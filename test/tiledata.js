'use strict';
/* Wave 1-A lint: the tile roster is well-formed.
   Counts and edge signatures match the design table; every rim slot of every
   tile is owned by exactly one segment whose type agrees with that side;
   art spots are in range and distinct; `touches` only ever points a meadow at
   a fold; and the two rotation rules (slot+3 and edges-rotate-right) agree.
   Runs the real module through test/shim.js — no data is retyped here except
   the design's own tables and worked examples. */
const { load } = require('./shim');

const results = [];
const check = (label, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if(!ok && detail) String(detail).split('\n').slice(0, 8).forEach(l => console.log('  → ' + l));
  results.push(!!ok);
};
const fail = (list) => list.slice(0, 8).join('\n') + (list.length > 8 ? `\n… and ${list.length - 8} more` : '');

let g = null, probe = null, loadErr = null;
try { g = load(); probe = g.probe; } catch(e){ loadErr = e; }
if(loadErr){
  check('modules load headlessly', false, loadErr.stack || loadErr.message);
  console.log('TILEDATA FAILED');
  process.exit(1);
}

const json = expr => JSON.parse(probe('JSON.stringify(' + expr + ')'));
const TILES = json('TILES');
const BROOK = json('BROOK_TILES');
const ALL = TILES.concat(BROOK);
const edgeCode = (id, rot) => probe(`edgeCode(${JSON.stringify(id)},${rot})`);
const rotSlot = (slot, rot) => probe(`rotSlot(${slot},${rot})`);
const ownerRow = id => json(`[0,1,2,3,4,5,6,7,8,9,10,11].map(s=>slotOwner(${JSON.stringify(id)},s))`);

const SIDE_NAME = ['N','E','S','W'];
const slots = seg => seg.e.slice().sort((a,b) => a-b).join(',');

/* ---------- 1. counts, ids, and the design's tables ---------- */

// design §2.2 / §2.3 — the roster as published, ram twins as their own ids
const EXPECT = {
  LANE2_S:  [8, 'LMLM'], LANE2_C:   [9, 'MMLL'], LANE3:      [4, 'MLLL'],
  LANE4:    [1, 'LLLL'], SHRINE:    [4, 'MMMM'], SHRINE_L:   [2, 'MMLM'],
  FOLD1:    [5, 'FMMM'], FOLD1_LS:  [4, 'FLML'], FOLD1_CSW:  [3, 'FMLL'],
  FOLD1_CSE:[3, 'FLLM'], FOLD1_L3:  [3, 'FLLL'],
  FOLD2A:   [3, 'FFMM'], FOLD2A_R:  [2, 'FFMM'],
  FOLD2O:   [1, 'FMFM'], FOLD2O_R:  [2, 'FMFM'],
  FOLD2A_C: [3, 'FFLL'], FOLD2A_C_R:[2, 'FFLL'],
  FOLD2SEP_O:[3,'FMFM'], FOLD2SEP_A:[2, 'FFMM'],
  FOLD3:    [3, 'FFMF'], FOLD3_R:   [1, 'FFMF'],
  FOLD3_L:  [1, 'FFLF'], FOLD3_L_R: [2, 'FFLF'],
  FOLD4_R:  [1, 'FFFF'],
};
const EXPECT_BROOK = {
  B_SPRING:[1,'MMBM'], B_FORK:[1,'BBBM'], B_STR:[4,'BMBM'], B_CURVE:[2,'MBBM'],
  B_SHRINE:[2,'MBBM'], B_LAKE:[2,'BMMM'],
};

const sum = list => list.reduce((n,t) => n + t.count, 0);
check('base satchel sums to 72', sum(TILES) === 72, 'got ' + sum(TILES));
check('brook module sums to 12', sum(BROOK) === 12, 'got ' + sum(BROOK));

// a ram is a fold SEGMENT bearing the emblem; the tile flag must agree with it
let ramSegs = 0, ramTiles = 0;
const ramMismatch = [];
for(const t of ALL){
  const marked = t.segs.filter(s => s.ram);
  ramSegs += t.count * marked.length;
  if(t.ram) ramTiles += t.count;
  if(!!t.ram !== (marked.length > 0)) ramMismatch.push(`${t.id}: tile ram=${t.ram} but ${marked.length} ram segs`);
  if(marked.some(s => s.t !== 'f')) ramMismatch.push(`${t.id}: ram on a non-fold segment`);
  if(marked.length > 1) ramMismatch.push(`${t.id}: ${marked.length} ram segments`);
}
check('exactly 10 Prize Rams', ramSegs === 10, 'ram segments in the satchel: ' + ramSegs);
check('tile ram flags agree with ram segments', ramMismatch.length === 0 && ramTiles === 10,
      fail(ramMismatch.concat(ramTiles === 10 ? [] : ['tile-level ram total ' + ramTiles])));

{
  const bad = [];
  const seen = new Set();
  for(const t of ALL){
    if(seen.has(t.id)) bad.push('duplicate id ' + t.id);
    seen.add(t.id);
    if(!(Number.isInteger(t.count) && t.count > 0)) bad.push(`${t.id}: count ${t.count}`);
    if(!Array.isArray(t.edges) || t.edges.length !== 4 || t.edges.some(e => !'MLFB'.includes(e)))
      bad.push(`${t.id}: edges ${JSON.stringify(t.edges)}`);
    if(!t.name) bad.push(t.id + ': no name');
  }
  const table = t => (EXPECT[t.id] || EXPECT_BROOK[t.id]);
  for(const t of ALL){
    const row = table(t);
    if(!row){ bad.push(t.id + ': not in the design roster'); continue; }
    if(t.count !== row[0]) bad.push(`${t.id}: count ${t.count}, design says ${row[0]}`);
    if(t.edges.join('') !== row[1]) bad.push(`${t.id}: edges ${t.edges.join('')}, design says ${row[1]}`);
  }
  for(const id of Object.keys(EXPECT).concat(Object.keys(EXPECT_BROOK)))
    if(!seen.has(id)) bad.push('missing tile ' + id);
  check('roster matches the design tables (ids, counts, edges)', bad.length === 0, fail(bad));
}

/* ---------- 2. slot partition + side-type consistency ---------- */
{
  const bad = [];
  for(const t of ALL){
    const owner = new Array(12).fill(-1);
    t.segs.forEach((sg, i) => {
      if(!Array.isArray(sg.e)) { bad.push(`${t.id} seg ${i}: no slot list`); return; }
      if(!'mlfsb'.includes(sg.t)) bad.push(`${t.id} seg ${i}: type '${sg.t}'`);
      if((sg.t === 's') !== (sg.e.length === 0))
        bad.push(`${t.id} seg ${i}: type '${sg.t}' with ${sg.e.length} slots (only shrines own none)`);
      for(const s of sg.e){
        if(!Number.isInteger(s) || s < 0 || s > 11){ bad.push(`${t.id} seg ${i}: slot ${s} out of 0..11`); continue; }
        if(owner[s] !== -1) bad.push(`${t.id}: slot ${s} claimed by segs ${owner[s]} and ${i}`);
        owner[s] = i;
      }
    });
    for(let s = 0; s < 12; s++) if(owner[s] === -1) bad.push(`${t.id}: slot ${s} unowned`);

    // slotOwner() must report the same partition the data declares. A tile that
    // is in the array but in NONE of the lookups reports -1 for all twelve, and
    // that is a different bug with a different fix — say so rather than let a
    // pack author debug segment data that is perfectly correct.
    const row = ownerRow(t.id);
    if(row.every(v => v === -1) && !probe(`!!tileById(${JSON.stringify(t.id)})`)){
      bad.push(`${t.id}: present in TILES/BROOK_TILES but invisible to tileById/edgeCode/` +
               `slotOwner. indexTiles() runs ONCE at load, so a row pushed afterwards — a ` +
               `js/pack-*.js file, which loads after tiles.js — is in the array and in no ` +
               `index. Nothing throws: the tile simply never places and the dead-tile rule ` +
               `discards it. Fix is a registerTiles(rows) in tiles.js that appends AND ` +
               `re-indexes, not a change to this tile's segments.`);
    } else {
      for(let s = 0; s < 12; s++)
        if(row[s] !== owner[s]) bad.push(`${t.id}: slotOwner(${s})=${row[s]}, segs say ${owner[s]}`);
    }

    // side type ⇒ who owns that side's three slots
    for(let side = 0; side < 4; side++){
      const [a, c, b] = [side*3, side*3+1, side*3+2];
      const type = t.edges[side];
      const seg = i => t.segs[owner[i]] || {t:'?'};
      const where = `${t.id} side ${SIDE_NAME[side]}(${type})`;
      if(type === 'F' || type === 'M'){
        const want = type === 'F' ? 'f' : 'm';
        if(owner[a] !== owner[c] || owner[c] !== owner[b])
          bad.push(`${where}: 3 slots split across segs ${owner[a]},${owner[c]},${owner[b]} — must be one`);
        else if(seg(a).t !== want) bad.push(`${where}: owned by a '${seg(a).t}' segment, want '${want}'`);
      } else {
        const want = type === 'L' ? 'l' : 'b';
        if(seg(c).t !== want) bad.push(`${where}: centre slot is '${seg(c).t}', want '${want}'`);
        if(seg(a).t !== 'm') bad.push(`${where}: flank slot ${a} is '${seg(a).t}', want meadow`);
        if(seg(b).t !== 'm') bad.push(`${where}: flank slot ${b} is '${seg(b).t}', want meadow`);
      }
    }
  }
  check('every slot 0..11 owned by exactly one segment, type matching its side',
        bad.length === 0, fail(bad));
}

/* ---------- 3. art spots ---------- */
{
  const bad = [];
  for(const t of ALL){
    const seen = new Map();
    t.segs.forEach((sg, i) => {
      const p = sg.spot;
      if(!Array.isArray(p) || p.length !== 2){ bad.push(`${t.id} seg ${i}: no spot`); return; }
      if(p.some(v => !Number.isInteger(v) || v < 0 || v > 63))
        bad.push(`${t.id} seg ${i}: spot ${JSON.stringify(p)} outside 0..63`);
      const k = p.join(',');
      if(seen.has(k)) bad.push(`${t.id}: segs ${seen.get(k)} and ${i} share spot ${k}`);
      seen.set(k, i);
    });
  }
  check('every segment has a distinct spot inside 0..63', bad.length === 0, fail(bad));
}

/* ---------- 4. touches: meadow → fold, on this tile only ---------- */
{
  const bad = [];
  for(const t of ALL){
    t.segs.forEach((sg, i) => {
      if(sg.touches === undefined) return;
      if(sg.t !== 'm'){ bad.push(`${t.id} seg ${i}: '${sg.t}' segment carries touches`); return; }
      if(!Array.isArray(sg.touches) || !sg.touches.length){ bad.push(`${t.id} seg ${i}: empty touches`); return; }
      if(new Set(sg.touches).size !== sg.touches.length) bad.push(`${t.id} seg ${i}: repeated touches`);
      for(const j of sg.touches){
        if(!Number.isInteger(j) || j < 0 || j >= t.segs.length){ bad.push(`${t.id} seg ${i}: touches ${j} — no such segment`); continue; }
        if(t.segs[j].t !== 'f') bad.push(`${t.id} seg ${i}: touches seg ${j} of type '${t.segs[j].t}', folds only`);
      }
    });
    // a tile with a fold and a meadow must declare the border somewhere
    const folds = t.segs.filter(s => s.t === 'f').length;
    const declared = t.segs.some(s => s.touches && s.touches.length);
    if(folds && t.segs.some(s => s.t === 'm') && !declared)
      bad.push(`${t.id}: has folds and meadows but no touches authored`);
  }
  check('touches are valid meadow→fold references', bad.length === 0, fail(bad));
}

/* ---------- 4b. invariants other modules were told they can rely on ---------- */
{
  // art.js derives a path's sides from its CENTRE slots (slot%3===1), and
  // board.js reads an L/B centre slot as the path. A path segment holding a
  // flank slot would silently break both.
  const bad = [];
  const arms = [];
  for(const t of ALL) for(const sg of t.segs){
    if(sg.t !== 'l' && sg.t !== 'b') continue;
    const off = sg.e.filter(s => s % 3 !== 1);
    if(off.length) bad.push(`${t.id}: ${sg.t} segment owns flank slot(s) ${off} — paths own centres only`);
    if(sg.e.length > 2) arms.push(`${t.id}:${sg.t}`);
  }
  check('lane/brook segments own only centre slots', bad.length === 0, fail(bad));
  // Lane crossings are split one segment per arm; the brook fork is not, because
  // a brook never completes and so has no ends to terminate. B_FORK is therefore
  // the only path segment with more than two arms — art.js special-cases it.
  check('B_FORK is the only path segment with more than two arms',
        arms.length === 1 && arms[0] === 'B_FORK:b', arms.join(', ') || '(none found)');
}

/* ---------- 4c. the brook mix closes its own open ends ---------- */
{
  // §1.6: the spring opens one end; a placed tile with k brook edges consumes an
  // end and opens k-1 (net k-2); the two lakes must close the last two ends just
  // as the brook satchel empties. That is a property of THIS mix, so it is
  // asserted here rather than left for game.js to discover at runtime.
  const brookEdges = t => t.edges.filter(e => e === 'B').length;
  const spring = BROOK.find(t => t.id === 'B_SPRING');
  const lake = BROOK.find(t => t.id === 'B_LAKE');
  let open = brookEdges(spring), middles = 0;
  for(const t of BROOK){
    if(t.id === 'B_SPRING' || t.id === 'B_LAKE') continue;
    middles += t.count;
    open += t.count * (brookEdges(t) - 2);
  }
  const left = open + lake.count * (brookEdges(lake) - 2);
  check('brook draw order splits 1 spring / 9 middles / 2 lakes',
        spring.count === 1 && middles === 9 && lake.count === 2,
        `spring ${spring.count}, middles ${middles}, lakes ${lake.count}`);
  check('the fork leaves exactly 2 open ends for the 2 lakes', open === 2,
        `${open} open end(s) after the ${middles} middles`);
  check('the brook closes with no open ends left', left === 0, 'ends left: ' + left);
}

/* ---------- 5. rotation: the two rules agree, ×4 is identity ---------- */
{
  const bad = [];
  for(let s = 0; s < 12; s++){
    let v = s;
    for(let k = 0; k < 4; k++) v = rotSlot(v, 1);
    if(v !== s) bad.push(`slot ${s}: four quarter-turns landed on ${v}`);
    if(rotSlot(s, 1) !== (s + 3) % 12) bad.push(`slot ${s}: rotSlot ≠ (slot+3)%12`);
  }
  check('slot rotation is (slot+3)%12 and ×4 is the identity', bad.length === 0, fail(bad));

  const bad2 = [];
  const rotateRight = c => c[3] + c[0] + c[1] + c[2];
  for(const t of ALL){
    for(let r = 0; r < 4; r++){
      // derive the rim independently: carry each slot's type through rotSlot
      const rim = new Array(12);
      for(let s = 0; s < 12; s++) rim[rotSlot(s, r)] = t.edges[(s / 3) | 0];
      let want = '';
      for(let side = 0; side < 4; side++){
        const [a, c, b] = [rim[side*3], rim[side*3+1], rim[side*3+2]];
        if(a !== c || c !== b) bad2.push(`${t.id} rot ${r}: side ${SIDE_NAME[side]} is not one type (${a}${c}${b})`);
        want += c;
      }
      const got = edgeCode(t.id, r);
      if(got !== want) bad2.push(`${t.id} rot ${r}: edgeCode '${got}', slot rotation says '${want}'`);
      if(got.length !== 4) bad2.push(`${t.id} rot ${r}: edgeCode is not 4 chars`);
    }
    const codes = [0,1,2,3].map(r => edgeCode(t.id, r));
    for(let r = 0; r < 4; r++)
      if(rotateRight(codes[r]) !== codes[(r + 1) % 4])
        bad2.push(`${t.id}: rot ${r}→${(r+1)%4} is not an edges-rotate-right`);
    if(edgeCode(t.id, 0) !== codes[0] || edgeCode(t.id, 4) !== codes[0])
      bad2.push(`${t.id}: rot 4 ≠ rot 0`);
  }
  check('edgeCode matches manual rotation for all tiles × 4 rotations', bad2.length === 0, fail(bad2));
}

/* ---------- 6. the design's worked examples, spot-checked ---------- */
{
  const byId = id => ALL.find(t => t.id === id);
  const segsOf = (id, type) => byId(id).segs.filter(s => s.t === type);

  // LANE2_S — lane [1,7]; meadow-east [2,3,4,5,6]; meadow-west [8,9,10,11,0]
  const ls = byId('LANE2_S');
  check("LANE2_S is a through lane with a meadow each side",
    slots(ls.segs[0]) === '1,7' && slots(ls.segs[1]) === '2,3,4,5,6' && slots(ls.segs[2]) === '0,8,9,10,11'
    && segsOf('LANE2_S','l').length === 1,
    JSON.stringify(ls.segs.map(s => [s.t, slots(s)])));

  // FOLD1_LS — the CONTRACT's shape example, verbatim
  const gr = byId('FOLD1_LS');
  check("FOLD1_LS Gate Road matches the contract's worked example",
    slots(gr.segs[0]) === '0,1,2' && gr.segs[0].t === 'f' &&
    slots(gr.segs[1]) === '4,10'  && gr.segs[1].t === 'l' &&
    slots(gr.segs[2]) === '3,11'  && String(gr.segs[2].touches) === '0' &&
    slots(gr.segs[3]) === '5,6,7,8,9' && gr.segs[3].touches === undefined,
    JSON.stringify(gr.segs));

  // FOLD2O — ONE fold spanning N–S; it splits the meadows, each touching it
  for(const id of ['FOLD2O','FOLD2O_R']){
    const t = byId(id);
    const folds = segsOf(id, 'f'), meadows = segsOf(id, 'm');
    check(`${id}: one spanning fold splits the meadows, both bordering it`,
      folds.length === 1 && slots(folds[0]) === '0,1,2,6,7,8' &&
      meadows.length === 2 && slots(meadows[0]) === '3,4,5' && slots(meadows[1]) === '9,10,11' &&
      meadows.every(m => String(m.touches) === '0'),
      JSON.stringify(t.segs.map(s => [s.t, slots(s), s.touches])));
  }

  // FOLD2SEP_O — same rim as FOLD2O, but two folds and ONE wrap-around meadow
  {
    const t = byId('FOLD2SEP_O');
    const folds = segsOf('FOLD2SEP_O','f'), meadows = segsOf('FOLD2SEP_O','m');
    check('FOLD2SEP_O: two facing folds, one meadow wrapping between them',
      folds.length === 2 && slots(folds[0]) === '0,1,2' && slots(folds[1]) === '6,7,8' &&
      meadows.length === 1 && slots(meadows[0]) === '3,4,5,9,10,11' &&
      String(meadows[0].touches) === '0,1',
      JSON.stringify(t.segs.map(s => [s.t, slots(s), s.touches])));
    check('FOLD2O and FOLD2SEP_O share an edge signature but differ inside',
      t.edges.join('') === byId('FOLD2O').edges.join('') &&
      segsOf('FOLD2O','m').length !== meadows.length);
  }

  // LANE4 — four arms, each its own segment terminating at the hamlet
  {
    const arms = segsOf('LANE4','l');
    check('LANE4: four separate lane arms, one slot each, ending at the hamlet',
      arms.length === 4 && arms.every(a => a.e.length === 1) &&
      arms.map(a => a.e[0]).sort((x,y)=>x-y).join(',') === '1,4,7,10' &&
      segsOf('LANE4','m').length === 4,
      JSON.stringify(byId('LANE4').segs.map(s => [s.t, slots(s)])));
    check('LANE3: three arms end at the hamlet, three meadow wedges',
      segsOf('LANE3','l').length === 3 && segsOf('LANE3','l').every(a => a.e.length === 1) &&
      segsOf('LANE3','m').length === 3);
    // through-lanes stay one segment holding both centre slots
    check('through lanes are one segment with both centre slots',
      segsOf('LANE2_S','l').length === 1 && segsOf('FOLD1_LS','l').length === 1 &&
      segsOf('LANE2_C','l')[0].e.length === 2);
  }

  // brook: the fork is one body of water; lakes and the spring are stubs
  check('B_FORK is one brook segment with three arms',
    segsOf('B_FORK','b').length === 1 && slots(segsOf('B_FORK','b')[0]) === '1,4,7' &&
    segsOf('B_FORK','m').length === 3);
  check('B_SPRING and B_LAKE are single-ended brook stubs',
    segsOf('B_SPRING','b').length === 1 && segsOf('B_SPRING','b')[0].e.length === 1 &&
    segsOf('B_LAKE','b').length === 1 && segsOf('B_LAKE','b')[0].e.length === 1);
  // The Lake has one brook edge, so exactly one rotation faces a given open end
  // and its other three sides must match three placed neighbours with no freedom
  // to dodge. Every L or F rim edge in the module is a mine it can step on, and
  // a stranded Lake leaves a brook end open for the whole game — no base tile
  // carries a B edge to close it. Measured: 3 such edges → 19.2% of openings end
  // with a dangling brook; none → 1.5%. This is the guard on that.
  {
    const mines = [];
    for(const t of BROOK) t.edges.forEach((e, side) => {
      if(e !== 'B' && e !== 'M') mines.push(`${t.id} side ${SIDE_NAME[side]} is '${e}'`);
    });
    // If you are reading this because you just tripped it: the assertion is not
    // bureaucracy, and deleting it costs about 18 points of dead-end rate.
    // During the brook phase the board holds ONLY brook tiles, so the module's
    // rim alphabet is the whole alphabet in play. Keeping it {B,M} means a
    // Lake's three meadow sides can only ever meet meadow or open space. Add one
    // L or F edge and you hand the Lake a mismatch it cannot rotate away from,
    // because with a single brook edge exactly one rotation faces a given open
    // end. Wave 3's Planks & Keeps is the likely customer: a bridge tile needs
    // B,L,B,L (the only rim order where a lane crosses water), which is 2 mines
    // AND 180°-symmetric, so the placer cannot even steer them.
    check('every non-brook edge in the brook module is meadow (the Lake cannot dodge)',
          mines.length === 0,
          fail(mines.concat(['a stranded Lake leaves a brook end open for the whole game —',
                             'no base tile carries a B edge to close it later.',
                             'measured: 3 such edges → 19.2% of openings end with a dangling',
                             'brook; none → 1.5%. see js/tiles.js BROOK_TILES header.'])));
    const lake = byId('B_LAKE');
    check('the Lake is maximally permissive: one brook edge, three meadow',
          lake.edges.filter(e => e === 'B').length === 1 &&
          lake.edges.filter(e => e === 'M').length === 3);
  }

  // shrines own no slots and never carry a rim
  check('shrine tiles carry one slot-less shrine segment',
    ['SHRINE','SHRINE_L','B_SHRINE'].every(id =>
      segsOf(id,'s').length === 1 && segsOf(id,'s')[0].e.length === 0));

  // FOLD3_L: the gate stub cuts the southern verge in two
  check('FOLD3_L: the lane stub splits the verge into two meadows',
    segsOf('FOLD3_L','m').length === 2 && segsOf('FOLD3_L','l').length === 1 &&
    segsOf('FOLD3_L','m').every(m => String(m.touches) === '0'));

  // ram twins are their plain twin plus the emblem
  for(const [plain, ram] of [['FOLD2A','FOLD2A_R'],['FOLD2O','FOLD2O_R'],
                             ['FOLD2A_C','FOLD2A_C_R'],['FOLD3','FOLD3_R'],['FOLD3_L','FOLD3_L_R']]){
    const strip = t => JSON.stringify(t.segs.map(s => [s.t, slots(s), s.spot, s.touches || null]));
    check(`${ram} is ${plain}'s geometry plus the ram`,
      strip(byId(plain)) === strip(byId(ram)) &&
      byId(ram).edges.join('') === byId(plain).edges.join('') &&
      byId(ram).segs.filter(s => s.ram).length === 1 && !byId(plain).segs.some(s => s.ram));
  }

  check('tileById reaches base and brook tiles, and nothing else',
    json('tileById("FOLD4_R")').id === 'FOLD4_R' && json('tileById("B_LAKE")').id === 'B_LAKE' &&
    probe('tileById("NOPE")') === null);
  check('the brook-off opening tile is a real base tile',
    !!byId(probe('OPENING_TILE')) && probe('OPENING_TILE') === 'FOLD1_LS');
}

const ok = results.every(Boolean);
console.log(`${results.filter(Boolean).length}/${results.length} checks · ${TILES.length} base ids (${sum(TILES)} tiles) · ${BROOK.length} brook ids (${sum(BROOK)} tiles)`);
console.log(ok ? 'TILEDATA OK' : 'TILEDATA FAILED');
process.exit(ok ? 0 : 1);
