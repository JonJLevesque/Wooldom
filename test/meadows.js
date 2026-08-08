'use strict';
/* ==================================================================
   WOOLDOM — test/meadows.js   (wave 1-B)

   The meadow rule (design §1.5 ⚑) is the one piece of scoring with no
   completion event to anchor it: a meadow is whatever grass stays
   connected once lanes, brooks and fold walls have cut the board up,
   and it pays 3 points per FINISHED fold it feeds to whoever has the
   herder majority on it. That is easy to get subtly wrong, so it is
   checked against a second implementation.

   Everything below the driver is written from the rules text and the
   tile encoding alone. It borrows NOTHING from board.js — its own
   union-find, its own flood fill over the half-edge lattice, its own
   notion of a finished fold ("no fold edge faces an empty cell"). The
   only things it reads are the tile table, its own log of placements,
   and its own log of postings. board.js is driven, then asked for
   finalScore(), and the two answers must agree.
   ================================================================== */
const { load } = require('./shim');

const results = [];
const check = (label, ok, note) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if(!ok && note) for(const n of [].concat(note).slice(0, 10)) console.log('       → ' + n);
  results.push(!!ok);
};

let B = null, loadErr = null;
try{
  const g = load();
  B = g.probe('({placeTile,canPlace,legalCells,postShepherd,canPost,featureAt,scoreFeature,' +
              'finalScore,resetBoard,returnShepherds,supplyOf,openSides,featureRoots,' +
              'board,tileById,TILES,BROOK_TILES,RNG})');
}catch(e){ loadErr = e; }
check('engine loads headlessly', !loadErr, loadErr && (loadErr.message + '\n' + loadErr.stack));
if(loadErr){ console.log('MEADOWS FAILED'); process.exit(1); }

const NB = [[0,-1],[1,0],[0,1],[-1,0]];
const OPENING = 'FOLD1_LS';

/* ==================================================================
   THE INDEPENDENT SCORER
   Written from §1.3 ("a connected grass region; lanes, brooks and fold
   walls divide meadows"), §1.5 (3 per completed adjacent fold, herder
   majority, ties all score) and the §2.1 slot encoding. Nothing here
   calls board.js.
   ================================================================== */

/* §2.1: slot = side*3 + i clockwise; a quarter-turn clockwise sends
   canonical slot c to c+3, so a board slot read back at rotation r is
   canonical slot (slot − 3r) mod 12. */
function ownerOfCanonical(tile, canon){
  for(let i = 0; i < tile.segs.length; i++){
    const e = tile.segs[i].e;
    if(e && e.indexOf(canon) >= 0) return i;
  }
  return -1;
}
function segAtBoardSlot(tile, rot, slot){ return ownerOfCanonical(tile, (slot - 3 * rot + 12) % 12); }
function sidesOfSeg(tile, segIdx, rot){
  const out = [];
  for(const c of (tile.segs[segIdx].e || [])){
    const side = (((c + 3 * rot) % 12) / 3) | 0;
    if(out.indexOf(side) < 0) out.push(side);
  }
  return out;
}

function makeUF(){
  const p = new Map();
  const uf = {
    add(k){ if(!p.has(k)) p.set(k, k); },
    find(k){
      let r = k;
      while(p.get(r) !== r) r = p.get(r);
      while(p.get(k) !== r){ const n = p.get(k); p.set(k, r); k = n; }
      return r;
    },
    union(a, b){ const ra = uf.find(a), rb = uf.find(b); if(ra !== rb) p.set(ra, rb); },
    groups(){
      const m = new Map();
      for(const k of p.keys()){
        const r = uf.find(k);
        if(!m.has(r)) m.set(r, new Set());
        m.get(r).add(k);
      }
      return m;
    },
  };
  return uf;
}

/* Flood fill the half-edge lattice: two segment slots are the same
   region when they are the same segment of one tile, or when they face
   each other across a shared side (side s slot i ↔ side s+2 slot 2−i). */
function floodFill(placements){
  const at = new Map();
  for(const p of placements) at.set(p.x + ',' + p.y, p);
  const meadow = makeUF(), fold = makeUF();

  for(const p of placements){
    const t = B.tileById(p.tileId);
    t.segs.forEach((sg, i) => {
      const k = p.x + ',' + p.y + ':' + i;
      if(sg.t === 'm') meadow.add(k);
      else if(sg.t === 'f') fold.add(k);
    });
  }
  for(const p of placements){
    const t = B.tileById(p.tileId);
    for(let side = 0; side < 4; side++){
      const nx = p.x + NB[side][0], ny = p.y + NB[side][1];
      const o = at.get(nx + ',' + ny);
      if(!o) continue;
      const ot = B.tileById(o.tileId), os = (side + 2) % 4;
      for(let i = 0; i < 3; i++){
        const a = segAtBoardSlot(t, p.rot, side * 3 + i);
        const b = segAtBoardSlot(ot, o.rot, os * 3 + (2 - i));
        const ka = p.x + ',' + p.y + ':' + a, kb = nx + ',' + ny + ':' + b;
        const ta = t.segs[a].t, tb = ot.segs[b].t;
        if(ta === 'm' && tb === 'm') meadow.union(ka, kb);
        else if(ta === 'f' && tb === 'f') fold.union(ka, kb);
      }
    }
  }
  return { at, meadow, fold };
}

/* §1.3: a fold is finished when its wall is closed — i.e. no side its
   segments touch faces an empty cell. */
function openFolds(at, fold){
  const open = new Map();
  for(const [root, members] of fold.groups()){
    let isOpen = false;
    for(const k of members){
      const c = k.lastIndexOf(':');
      const p = at.get(k.slice(0, c)), si = +k.slice(c + 1);
      const t = B.tileById(p.tileId);
      for(const side of sidesOfSeg(t, si, p.rot))
        if(!at.has((p.x + NB[side][0]) + ',' + (p.y + NB[side][1]))){ isOpen = true; break; }
      if(isOpen) break;
    }
    open.set(root, isOpen);
  }
  return open;
}

/* §1.5: 3 points per finished fold the meadow feeds, to the herder
   majority; ties all score. Meadows with no herder pay nobody. */
function bruteMeadowScore(placements, posts){
  const { at, meadow, fold } = floodFill(placements);
  const foldOpen = openFolds(at, fold);
  const rows = [];
  for(const [, members] of meadow.groups()){
    const cells = new Set(), adjacent = new Set();
    for(const k of members){
      const c = k.lastIndexOf(':');
      const ck = k.slice(0, c), si = +k.slice(c + 1);
      cells.add(ck);
      const p = at.get(ck), t = B.tileById(p.tileId);
      for(const fi of (t.segs[si].touches || [])) adjacent.add(fold.find(ck + ':' + fi));
    }
    let finished = 0;
    for(const r of adjacent) if(foldOpen.get(r) === false) finished++;
    const herders = new Map();
    for(const q of posts)
      if(members.has(q.x + ',' + q.y + ':' + q.seg)) herders.set(q.seat, (herders.get(q.seat) || 0) + 1);
    if(!herders.size) continue;
    let best = 0;
    for(const v of herders.values()) if(v > best) best = v;
    const holders = [...herders.keys()].filter(s => herders.get(s) === best).sort((a, b) => a - b);
    rows.push({ cells:[...cells].sort(), members, holders, pts:3 * finished, finished });
  }
  return rows;
}

/* the full meadow partition, for localising a disagreement */
function bruteMeadowCells(placements){
  const { meadow } = floodFill(placements);
  const out = [];
  for(const [, members] of meadow.groups()){
    const cells = new Set();
    for(const k of members) cells.add(k.slice(0, k.lastIndexOf(':')));
    out.push([...cells].sort().join('|'));
  }
  return out.sort();
}

/* ==================================================================
   THE DRIVER — random legal games played through board.js
   ================================================================== */
function playout(seed, seats){
  B.RNG.seed(seed);
  B.resetBoard(seats);
  const satchel = [];
  for(const t of B.TILES.concat(B.BROOK_TILES))
    for(let i = 0; i < t.count; i++) satchel.push(t.id);
  B.RNG.shuffle(satchel);

  const placements = [], posts = [], scores = new Array(seats).fill(0), problems = [];
  B.placeTile(0, 0, OPENING, 0);
  placements.push({ x:0, y:0, tileId:OPENING, rot:0 });

  let turn = 0, dead = 0;
  while(satchel.length){
    const id = satchel.pop();
    const cells = B.legalCells(id);
    if(!cells.length){ dead++; continue; }            // §1.2 dead-tile rule
    const c = cells[B.RNG.int(cells.length)];
    const rot = c.rots[B.RNG.int(c.rots.length)];
    const res = B.placeTile(c.x, c.y, id, rot);
    if(!res){ problems.push('legalCells offered an illegal ' + id + ' at ' + c.x + ',' + c.y + ' r' + rot); break; }
    placements.push({ x:c.x, y:c.y, tileId:id, rot });

    const seat = turn % seats;
    const tile = B.tileById(id);
    const options = [];
    for(let i = 0; i < tile.segs.length; i++) if(B.canPost(c.x, c.y, i)) options.push(i);
    if(options.length && B.supplyOf(seat) > 0 && B.RNG.next() < 0.6){
      const seg = options[B.RNG.int(options.length)];
      if(B.postShepherd(c.x, c.y, seg, seat)) posts.push({ x:c.x, y:c.y, seg, seat });
      else problems.push('canPost said yes but postShepherd refused ' + c.x + ',' + c.y + ':' + seg);
    }

    for(const m of res.completed){
      for(const row of B.scoreFeature(m, false)) scores[row.seat] += row.pts;
      for(const sh of m.shepherds){
        const i = posts.findIndex(p => p.x === sh.x && p.y === sh.y && p.seg === sh.seg && p.seat === sh.seat);
        if(i >= 0) posts.splice(i, 1);
      }
      B.returnShepherds(m);
    }
    turn++;
  }

  for(let s = 0; s < seats; s++){
    const held = posts.filter(p => p.seat === s).length;
    if(held + B.supplyOf(s) !== 7)
      problems.push('seat ' + s + ' has ' + held + ' posted + ' + B.supplyOf(s) + ' in hand, not 7');
  }
  for(const m of B.featureRoots()){
    if(m.type === 'meadow' || m.type === 'shrine') continue;
    const exposed = B.openSides(m).length;
    if(exposed !== m.opens) problems.push(m.type + ' ' + m.key + ' claims opens=' + m.opens + ' but ' + exposed + ' sides are exposed');
  }
  if(B.board.size !== placements.length)
    problems.push('board holds ' + B.board.size + ' tiles, the log says ' + placements.length);

  return { placements, posts, scores, dead, problems };
}

/* Rows are paired by the engine's root key, never by their cells: a
   spanning fold splits one tile's grass into two meadows that both cover
   exactly that one cell, so cell sets are not identities. Asking the
   engine which feature each of OUR segments landed in is also the
   partition test — every segment of one brute-force region must come
   back with the same root key, and two regions must never share one. */
function compareMeadows(game){
  const mine = bruteMeadowScore(game.placements, game.posts);
  const theirs = B.finalScore().filter(r => r.kind === 'meadow');
  const problems = [];
  const byKey = new Map();
  for(const r of theirs) byKey.set(r.key, r);

  for(const r of mine){
    const keys = new Set();
    for(const m of r.members){
      const c = m.lastIndexOf(':');
      const cell = m.slice(0, c).split(','), seg = +m.slice(c + 1);
      const f = B.featureAt(+cell[0], +cell[1], seg);
      keys.add(f ? f.key : 'MISSING ' + m);
    }
    if(keys.size !== 1){
      problems.push('brute force joins ' + r.members.size + ' segments around ' + r.cells[0] +
                    ' that board.js splits into ' + keys.size + ' features');
      continue;
    }
    const rootKey = [...keys][0];
    const t = byKey.get(rootKey);
    if(!t){
      problems.push('finalScore omits the meadow ' + rootKey + ' covering ' +
                    r.cells.slice(0, 6).join(' ') + (r.cells.length > 6 ? ' …' : ''));
      continue;
    }
    byKey.delete(rootKey);
    if(t.cells.join('|') !== r.cells.join('|'))
      problems.push('meadow ' + rootKey + ' covers ' + r.cells.length + ' cells by brute force, ' + t.cells.length + ' by board.js');
    if(t.pts !== r.pts)
      problems.push('meadow ' + rootKey + ' (' + r.cells.length + ' cells): brute force ' + r.pts +
                    ' from ' + r.finished + ' finished fold(s), finalScore ' + t.pts + ' — "' + t.detail + '"');
    if(t.holders.join(',') !== r.holders.join(','))
      problems.push('meadow ' + rootKey + ': brute force gives it to [' + r.holders + '], finalScore to [' + t.holders + ']');
  }
  for(const k of byKey.keys()) problems.push('finalScore reports a scoring meadow ' + k + ' that brute force does not');
  return problems;
}

/* ---------------- the runs ---------------- */
const RUNS = 200;
const t0 = Date.now();
const failures = [];
let meadowRows = 0, meadowPts = 0, deadTiles = 0, biggest = 0;

for(let i = 0; i < RUNS; i++){
  const seats = 2 + (i % 4);
  const seed = 1000003 + i * 7919;
  let game = null;
  try{
    game = playout(seed, seats);
    const problems = game.problems.concat(compareMeadows(game));
    const partitionMine = bruteMeadowCells(game.placements).join('\n');
    const partitionTheirs = B.featureRoots().filter(m => m.type === 'meadow')
      .map(m => [...m.cells].sort().join('|')).sort().join('\n');
    if(partitionMine !== partitionTheirs){
      const a = partitionMine.split('\n'), b = partitionTheirs.split('\n');
      problems.push('the meadow partitions differ: brute force cut the board into ' + a.length +
                    ' region(s), board.js into ' + b.length);
      for(const line of a) if(b.indexOf(line) < 0){ problems.push('  only brute force has: ' + line.split('|').slice(0, 5).join(' ')); break; }
    }
    if(problems.length) failures.push('seed ' + seed + ' (' + seats + ' seats): ' + problems[0] +
                                      (problems.length > 1 ? '  [+' + (problems.length - 1) + ' more]' : ''));
    for(const r of B.finalScore()) if(r.kind === 'meadow'){ meadowRows++; meadowPts += r.pts * r.holders.length; }
    deadTiles += game.dead;
    biggest = Math.max(biggest, game.placements.length);
  }catch(e){
    failures.push('seed ' + seed + ' (' + seats + ' seats) threw: ' + e.message);
  }
}
const ms = Date.now() - t0;

check('200 seeded playouts agree with an independent meadow scorer', failures.length === 0, failures);
console.log('note  ' + RUNS + ' games in ' + ms + 'ms · ' + meadowRows + ' scoring meadows worth ' +
            meadowPts + ' points · ' + deadTiles + ' dead tiles · largest board ' + biggest + ' tiles');

/* A cross-check is only worth having if it can fail. These feed the
   independent scorer a board it should disagree about, to prove the
   comparison is actually looking at the numbers. */
(function theCrossCheckCanFail(){
  const placements = [
    { x:0, y:0, tileId:'FOLD2SEP_O', rot:0 },
    { x:0, y:-1, tileId:'FOLD1', rot:2 },
    { x:0, y:1, tileId:'FOLD1', rot:0 },
  ];
  const posts = [{ x:0, y:0, seg:2, seat:0 }];
  const both = bruteMeadowScore(placements, posts);
  const wrapped = both.find(r => r.cells.length === 1 && r.cells[0] === '0,0');
  const oneFold = bruteMeadowScore(placements.slice(0, 2), posts).find(r => r.cells[0] === '0,0');
  const noneFold = bruteMeadowScore(placements.slice(0, 1), posts).find(r => r.cells[0] === '0,0');
  check('the independent scorer counts finished folds, not folds',
    !!wrapped && wrapped.pts === 6 && !!oneFold && oneFold.pts === 3 && !!noneFold && noneFold.pts === 0,
    'wrapped=' + (wrapped && wrapped.pts) + ' oneFold=' + (oneFold && oneFold.pts) + ' noneFold=' + (noneFold && noneFold.pts));
})();

(function bothAgreeOnTheHandFixture(){
  B.resetBoard(2);
  const placements = [
    { x:0, y:0, tileId:'FOLD2SEP_O', rot:0 },
    { x:0, y:-1, tileId:'FOLD1', rot:2 },
    { x:0, y:1, tileId:'FOLD1', rot:0 },
  ];
  for(const p of placements) B.placeTile(p.x, p.y, p.tileId, p.rot);
  B.postShepherd(0, 0, 2, 0);
  const posts = [{ x:0, y:0, seg:2, seat:0 }];
  const mine = bruteMeadowScore(placements, posts);
  const theirs = B.finalScore().filter(r => r.kind === 'meadow');
  const wrapped = mine.find(r => r.cells.length === 1 && r.cells[0] === '0,0');
  check('both scorers give the wrapping meadow 6 for its two finished folds',
    theirs.length === 1 && theirs[0].pts === 6 && !!wrapped && wrapped.pts === 6 &&
    theirs[0].holders.join() === '0',
    'engine=' + JSON.stringify(theirs.map(r => ({ pts:r.pts, holders:r.holders }))) +
    ' brute=' + (wrapped && wrapped.pts));
})();

console.log(results.every(Boolean) ? 'MEADOWS OK' : 'MEADOWS FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
