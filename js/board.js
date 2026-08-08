'use strict';
/* ==================================================================
   WOOLDOM — js/board.js   (wave 1-B)

   The pasture: the cell map, the union-find feature graph over segment
   instances, placement legality, shepherd posting, and every scoring
   formula. Rules source: design §1.3–§1.5 (features, completion,
   scoring), §3.1 (data architecture), §3.3 (the formula table).

   Turn contract for game.js — board.js owns the feature graph and the
   shepherd supplies; game.js owns seat scores and the satchel:

     const res = placeTile(x, y, tileId, rot);      // null if illegal
     if(res){ ... optionally postShepherd(x, y, seg, seat) ... }
     for(const f of res.completed){
       for(const row of scoreFeature(f, false)) seats[row.seat].score += row.pts;
       returnShepherds(f);                          // supplies come home (§1.4)
     }

   At game end, finalScore() returns the ordered walkthrough rows and
   changes no state (§1.5 — shepherds stay put, the game is over).
   ================================================================== */

/* ---------------- 1. TILE DATA ACCESS ----------------
   Normally the frozen tiles.js globals. Tests inject a fixture table
   through setTileSource() so the engine suites can run while tiles.js
   is still landing; setTileSource(null) hands the engine back to the
   real data. Everything is read lazily and guarded by typeof so a stub
   tiles.js never breaks the headless boot. */
let TileSrc = null;

function setTileSource(src){ TileSrc = src || null; codeCache.clear(); }

function tileTable(){
  if(TileSrc) return TileSrc.TILES || [];
  return (typeof TILES !== 'undefined' && TILES) ? TILES : [];
}
function brookTable(){
  if(TileSrc) return TileSrc.BROOK_TILES || [];
  return (typeof BROOK_TILES !== 'undefined' && BROOK_TILES) ? BROOK_TILES : [];
}
function tileOf(id){
  if(TileSrc) return TileSrc.tileById ? TileSrc.tileById(id) : byIdIn(TileSrc.TILES, id);
  if(typeof tileById !== 'undefined') return tileById(id);
  return byIdIn(tileTable(), id) || byIdIn(brookTable(), id);
}
function byIdIn(list, id){
  if(!list) return null;
  for(const t of list) if(t.id === id) return t;
  return null;
}

/* The 4 edge chars of a tile AS PLACED at `rot` (N,E,S,W). tiles.js owns
   edgeCode; the derivation is kept as a fallback so board.js stays usable
   against a bare data table. Rotating cw by one step moves the old west
   edge to the north, i.e. code[side] = edges[(side-rot+4)%4]. */
const codeCache = new Map();
function codeFor(id, rot){
  const ck = id + '_' + rot;
  const hit = codeCache.get(ck);
  if(hit) return hit;
  let c = null;
  if(TileSrc && TileSrc.edgeCode) c = TileSrc.edgeCode(id, rot);
  else if(!TileSrc && typeof edgeCode !== 'undefined') c = edgeCode(id, rot);
  if(!c){
    const t = tileOf(id);
    if(!t) return null;
    c = [0,1,2,3].map(s => t.edges[(s - rot + 4) % 4]);
  }
  codeCache.set(ck, c);
  return c;
}

/* segIdx owning a CANONICAL (rotation-0) slot 0..11. */
function ownerOf(tile, slot){
  if(TileSrc && TileSrc.slotOwner) return TileSrc.slotOwner(tile, slot);
  if(!TileSrc && typeof slotOwner !== 'undefined') return slotOwner(tile, slot);
  for(let i = 0; i < tile.segs.length; i++){
    const e = tile.segs[i].e;
    if(e && e.indexOf(slot) >= 0) return i;
  }
  return -1;
}
/* segIdx owning a BOARD slot of a tile placed at `rot`. Rotating cw maps
   canonical slot c → board slot (c + 3*rot) % 12, so we invert.
   This is the INVERSE of tiles.js's rotSlot(), which board.js deliberately
   does not call: tiles.js exports the forward map only, so borrowing it for
   the two forward uses (sidesTouched, openSides) while this one — the
   merge-critical direction, which decides who joins whom — stayed
   hand-rolled would look like a shared source of truth without being one.
   All three stay inline together, and test/placement.js asserts the
   convention against edgeCode for all 32 tiles × 4 rotations × 4 sides. */
function segAtSlot(tileId, rot, boardSlot){
  const t = tileOf(tileId);
  if(!t) return -1;
  return ownerOf(t, (boardSlot - 3 * rot + 12) % 12);
}

/* ---------------- 2. STATE ---------------- */
const board = new Map();        // 'x,y' → {tileId, rot, seat, n}
const shrines = [];             // {x,y,seg,key} — completion needs the 8-ring
const frontier = new Map();     // 'x,y' → [N,E,S,W] required edge char | null
const ufParent = new Map();     // segKey → segKey
const ufRank = new Map();
const ufMeta = new Map();       // rootKey → rootMeta
let placeN = 0;                 // placement counter (cell.n)
let supplies = [];              // seat → shepherds still in hand

const NB = [[0,-1],[1,0],[0,1],[-1,0]];                                  // N,E,S,W (y grows south)
const NB8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
const SEG_TYPE = { m:'meadow', l:'lane', f:'fold', s:'shrine', b:'brook' };
const TYPE_ORDER = { lane:0, fold:1, shrine:2, meadow:3, brook:4 };

function segKey(x, y, i){ return x + ',' + y + ':' + i; }

function resetBoard(seatCount){
  board.clear(); shrines.length = 0; frontier.clear();
  ufParent.clear(); ufRank.clear(); ufMeta.clear();
  placeN = 0;
  supplies = new Array(Math.max(1, seatCount || 5)).fill(SHEPHERDS);
}
resetBoard(5);

function seatSlot(seat){
  while(supplies.length <= seat) supplies.push(SHEPHERDS);
  return seat;
}
function supplyOf(seat){ seatSlot(seat); return supplies[seat]; }

/* pack hook rows (game.js ships the registry; packs push into it) */
function hookRows(name){
  return (typeof Hooks !== 'undefined' && Hooks && Array.isArray(Hooks[name])) ? Hooks[name] : null;
}

/* ---------------- 3. UNION-FIND OVER SEGMENT INSTANCES ----------------
   One node per 'x,y:segIdx'. Roots carry the feature metadata; `opens`
   counts still-exposed sides (+1 per side a segment touches, −2 whenever
   two segments meet across a side), so complete ⇔ opens===0. Meadows
   never complete and skip the accounting entirely. */
function find(k){
  if(!ufParent.has(k)) return null;
  let r = k;
  while(ufParent.get(r) !== r) r = ufParent.get(r);
  while(ufParent.get(k) !== r){ const nx = ufParent.get(k); ufParent.set(k, r); k = nx; }
  return r;
}
function metaOf(k){ const r = find(k); return r === null ? null : ufMeta.get(r); }

/* how many distinct sides a segment touches once the tile is rotated */
function sidesTouched(seg, rot){
  const seen = [false,false,false,false];
  let n = 0;
  const e = seg.e || [];
  for(const c of e){
    const side = (((c + 3 * rot) % 12) / 3) | 0;
    if(!seen[side]){ seen[side] = true; n++; }
  }
  return n;
}

/* Join two segment instances that meet across a tile side. Lanes, folds
   and brooks close one open side each (−2 on the merged root); meadows
   merely merge. A join whose ends are already the same feature (a loop
   closing on itself) still closes both sides. */
function joinSegs(ak, bk){
  const ra = find(ak), rb = find(bk);
  if(ra === null || rb === null) return null;
  const ma = ufMeta.get(ra), mb = ufMeta.get(rb);
  if(ma.type !== mb.type)
    throw new Error('board: edge match joined ' + ma.type + ' to ' + mb.type + ' at ' + ak + '/' + bk);
  const closes = ma.type !== 'meadow';
  if(ra === rb){
    if(closes) ma.opens -= 2;
    return ra;
  }
  const rka = ufRank.get(ra), rkb = ufRank.get(rb);
  const keep = rka >= rkb ? ra : rb, drop = keep === ra ? rb : ra;
  if(rka === rkb) ufRank.set(keep, rka + 1);
  ufParent.set(drop, keep);
  const mk = ufMeta.get(keep), md = ufMeta.get(drop);
  for(const c of md.cells) mk.cells.add(c);
  for(const f of md.adjFolds) mk.adjFolds.add(f);
  for(const s of md.shepherds) mk.shepherds.push(s);
  mk.opens = mk.opens + md.opens - (closes ? 2 : 0);
  mk.rams += md.rams;
  mk.done = mk.done || md.done;
  ufMeta.delete(drop);
  return keep;
}

/* ---------------- 4. PLACEMENT ---------------- */
function filledNeighbours(x, y){
  let n = 0;
  for(const d of NB8) if(board.has(cellKey(x + d[0], y + d[1]))) n++;
  return n;
}

function canPlace(tileId, rot, x, y){
  rot = ((rot % 4) + 4) % 4;
  if(board.has(cellKey(x, y))) return false;
  const code = codeFor(tileId, rot);
  if(!code) return false;
  let touching = board.size === 0;               // the opening tile lands anywhere
  for(let side = 0; side < 4; side++){
    const o = board.get(cellKey(x + NB[side][0], y + NB[side][1]));
    if(!o) continue;
    touching = true;
    const theirs = codeFor(o.tileId, o.rot);
    if(!theirs || code[side] !== theirs[(side + 2) % 4]) return false;
  }
  return hookPlace(tileId, rot, x, y, touching);
}

/* Packs may veto or (Planks & Keeps) allow a placement the base rules
   reject; the last row to express an opinion wins. */
function hookPlace(tileId, rot, x, y, ok){
  const rows = hookRows('canPlace');
  if(rows) for(const fn of rows){
    const r = fn(tileId, rot, x, y, ok);
    if(r === true || r === false) ok = r;
  }
  return ok;
}

/* Frontier cells carry the edge chars their placed neighbours demand, so
   legality is 4 char compares per rotation instead of 4 map lookups. */
function noteFrontier(x, y){
  const cell = board.get(cellKey(x, y));
  const code = codeFor(cell.tileId, cell.rot);
  for(let side = 0; side < 4; side++){
    const nk = cellKey(x + NB[side][0], y + NB[side][1]);
    if(board.has(nk)) continue;
    let req = frontier.get(nk);
    if(!req){ req = [null,null,null,null]; frontier.set(nk, req); }
    req[(side + 2) % 4] = code[side];            // the char that cell must show back
  }
}

function legalCells(tileId){
  /* An empty pasture takes the opening tile anywhere, so the origin stands
     for every cell — but it still has to go through canPlace rather than
     being handed back unconditionally. A tile whose data the lookups cannot
     resolve (an unregistered pack row) would otherwise be offered here with
     all four rotations and then refused by placeTile, which reads as "the
     tile is fine, the placement failed" and sends you hunting in the wrong
     file. Four calls, once per game, and the two can never disagree. */
  if(board.size === 0){
    const rots = [];
    for(let r = 0; r < 4; r++) if(canPlace(tileId, r, 0, 0)) rots.push(r);
    return rots.length ? [{ x:0, y:0, rots }] : [];
  }
  const codes = [0,1,2,3].map(r => codeFor(tileId, r));
  if(!codes[0]) return [];
  const out = [];
  for(const [k, req] of frontier){
    const comma = k.indexOf(',');
    const x = +k.slice(0, comma), y = +k.slice(comma + 1);
    const rots = [];
    for(let r = 0; r < 4; r++){
      const c = codes[r];
      let ok = true;
      for(let s = 0; s < 4; s++) if(req[s] !== null && req[s] !== c[s]){ ok = false; break; }
      if(hookPlace(tileId, r, x, y, ok)) rots.push(r);
    }
    if(rots.length) out.push({ x, y, rots });
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

/* Lay a tile: build its segment instances, lift its `touches` rows into
   meadow→fold adjacency, join every abutting segment across all four
   sides, then report what that finished. Returns null if illegal. */
function placeTile(x, y, tileId, rot){
  rot = ((rot % 4) + 4) % 4;
  if(!canPlace(tileId, rot, x, y)) return null;
  const tile = tileOf(tileId);
  if(!tile) return null;
  const key = cellKey(x, y);
  board.set(key, { tileId, rot, seat:null, n:placeN++ });
  frontier.delete(key);
  noteFrontier(x, y);

  const segs = tile.segs || [];
  for(let i = 0; i < segs.length; i++){
    const s = segs[i], sk = segKey(x, y, i), type = SEG_TYPE[s.t] || 'meadow';
    ufParent.set(sk, sk); ufRank.set(sk, 0);
    const meta = { type, cells:new Set([key]), opens:0, rams:s.ram ? 1 : 0,
                   shepherds:[], adjFolds:new Set(), key:sk, done:false };
    if(type === 'shrine'){                       // §1.3: 8 neighbours, not sides
      meta.opens = 8 - filledNeighbours(x, y);
      shrines.push({ x, y, seg:i, key:sk });
    }else if(type !== 'meadow'){
      meta.opens = sidesTouched(s, rot);
    }
    ufMeta.set(sk, meta);
  }
  for(let i = 0; i < segs.length; i++){          // meadow borders fold, on this tile
    const t = segs[i].touches;
    if(!t || !t.length) continue;
    const m = ufMeta.get(segKey(x, y, i));
    for(const fi of t) m.adjFolds.add(segKey(x, y, fi));
  }

  for(let side = 0; side < 4; side++){
    const nx = x + NB[side][0], ny = y + NB[side][1];
    const other = board.get(cellKey(nx, ny));
    if(!other) continue;
    const os = (side + 2) % 4;
    const pairs = new Map();                     // one join per segment pair, not per slot
    for(let i = 0; i < 3; i++){
      const mine = segAtSlot(tileId, rot, side * 3 + i);
      const theirs = segAtSlot(other.tileId, other.rot, os * 3 + (2 - i));
      if(mine < 0 || theirs < 0)
        throw new Error('board: unowned slot joining ' + tileId + '@' + key + ' side ' + side);
      pairs.set(mine + '|' + theirs, [mine, theirs]);
    }
    for(const p of pairs.values()) joinSegs(segKey(x, y, p[0]), segKey(nx, ny, p[1]));
  }

  /* completions: this tile's own features, plus any shrine whose ring we
     just filled (the only feature that completes without being touched) */
  const completed = [], seen = new Set();
  for(let i = 0; i < segs.length; i++){
    const r = find(segKey(x, y, i));
    if(seen.has(r)) continue;
    seen.add(r);
    const m = ufMeta.get(r);
    if(!m || m.done || m.type === 'meadow' || m.type === 'brook') continue;
    if(m.opens === 0){ m.done = true; completed.push(m); }
  }
  for(const sh of shrines){
    if(Math.abs(sh.x - x) > 1 || Math.abs(sh.y - y) > 1) continue;
    const m = metaOf(sh.key);
    if(!m || m.done) continue;
    m.opens = 8 - filledNeighbours(sh.x, sh.y);
    if(m.opens === 0){ m.done = true; if(!completed.includes(m)) completed.push(m); }
  }
  completed.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const rows = hookRows('onPlaced');
  if(rows) for(const fn of rows) fn(x, y, tileId, rot, completed);
  return { completed };
}

/* ---------------- 5. SHEPHERDS ---------------- */
function featureAt(x, y, segIdx){ return metaOf(segKey(x, y, segIdx)); }

/* §1.2 step 3: legal only if the whole MERGED feature is unclaimed. The
   "must be a segment of the tile just placed" half of the rule is the
   turn loop's business, not the graph's. */
function canPost(x, y, segIdx){
  const m = metaOf(segKey(x, y, segIdx));
  if(!m) return false;
  if(m.type === 'brook') return false;           // the brook itself never scores
  return m.shepherds.length === 0;
}

function postShepherd(x, y, segIdx, seat){
  if(!canPost(x, y, segIdx)) return false;
  seatSlot(seat);
  if(supplies[seat] <= 0) return false;
  const m = metaOf(segKey(x, y, segIdx));
  m.shepherds.push({ seat, x, y, seg:segIdx, cell:cellKey(x, y), weight:1 });
  supplies[seat]--;
  return true;
}

/* §1.4: everyone on a scored feature goes home — whether or not the
   feature paid anybody, since an unclaimed majority still frees the
   losers' shepherds. Returns the posts that were lifted, {seat,x,y,seg}
   each, for mirroring a supply readout or animating the walk home.
   board.js owns the supply array: callers must NOT credit it again. */
function returnShepherds(m){
  const back = m.shepherds.slice();
  for(const sh of back){ seatSlot(sh.seat); supplies[sh.seat]++; }
  m.shepherds.length = 0;
  return back;
}

/* ---------------- 6. FEATURE QUERIES ---------------- */
function featureRoots(){
  const out = [], seen = new Set();
  for(const k of ufParent.keys()){
    const r = find(k);
    if(seen.has(r)) continue;
    seen.add(r);
    const m = ufMeta.get(r);
    if(m) out.push(m);
  }
  return out;
}

/* The flat "every shepherd on the board" view lives in game.js, NOT here:
   it is derived from featureRoots() above, and a second copy in board.js
   would silently shadow it — two `function` declarations in the shared
   scope do not throw the way a let/function clash does, the later one just
   wins. featureRoots() is the seam; game.js does the flattening. */

/* Every (cell, side) where this feature is still exposed. This is an
   independent recomputation of `opens` — the suites assert the two agree
   after every placement — and it is what the brook phase needs to find
   the ends it may extend. */
function openSides(m){
  if(!m || m.type === 'meadow' || m.type === 'shrine') return [];
  const root = find(m.key);
  const out = [];
  for(const ck of m.cells){
    const comma = ck.indexOf(',');
    const x = +ck.slice(0, comma), y = +ck.slice(comma + 1);
    const cell = board.get(ck);
    if(!cell) continue;
    const tile = tileOf(cell.tileId);
    for(let i = 0; i < tile.segs.length; i++){
      if(find(segKey(x, y, i)) !== root) continue;
      const seen = [false,false,false,false];
      for(const c of (tile.segs[i].e || [])){
        const side = (((c + 3 * cell.rot) % 12) / 3) | 0;
        if(seen[side]) continue;
        seen[side] = true;
        if(!board.has(cellKey(x + NB[side][0], y + NB[side][1]))) out.push({ x, y, side });
      }
    }
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x || a.side - b.side);
  return out;
}

function isComplete(m){
  if(!m || m.type === 'meadow' || m.type === 'brook') return false;
  return m.opens === 0;
}

/* Meadow→fold adjacency: `touches` was lifted as segment keys at
   placement time, so the set is re-canonicalised through find() on read
   (design §3.1 — fold roots move as folds merge). */
function adjFoldRoots(m){
  if(!m || m.type !== 'meadow') return [];
  const canon = new Set();
  for(const k of m.adjFolds){ const r = find(k); if(r !== null) canon.add(r); }
  m.adjFolds.clear();
  for(const r of canon) m.adjFolds.add(r);
  const out = [];
  for(const r of canon){ const f = ufMeta.get(r); if(f && f.type === 'fold') out.push(f); }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}
function completedAdjFolds(m){ return adjFoldRoots(m).filter(f => f.opens === 0); }

/* ---------------- 7. SCORING (design §3.3) ---------------- */
function basePoints(m, final){
  switch(m.type){
    case 'lane':   return m.cells.size;                          // 1/tile, complete or not
    case 'fold':   return (m.cells.size + m.rams) * (final ? 1 : 2);
    case 'shrine': return final ? 9 - m.opens : 9;               // 1 + filled neighbours
    case 'meadow': return final ? 3 * completedAdjFolds(m).length : 0;
    default:       return 0;                                     // brooks never score
  }
}

function describe(m, final, pts){
  const t = m.cells.size;
  switch(m.type){
    case 'lane':   return 'Lane · ' + t + ' tile' + (t === 1 ? '' : 's') + ' × 1 = ' + pts;
    case 'fold':   return 'Fold · ' + t + ' tile' + (t === 1 ? '' : 's') +
                          (m.rams ? ' + ' + m.rams + ' ram' + (m.rams === 1 ? '' : 's') : '') +
                          ' × ' + (final ? 1 : 2) + ' = ' + pts;
    case 'shrine': return final ? 'Shrine · 1 + ' + (8 - m.opens) + ' neighbours = ' + pts
                                : 'Shrine · itself + 8 neighbours = 9';
    case 'meadow': { const n = completedAdjFolds(m).length;
                     return 'Meadow · ' + n + ' finished fold' + (n === 1 ? '' : 's') + ' × 3 = ' + pts; }
    default:       return 'Brook · no score';
  }
}

/* §1.4/§1.5 majority: the seat(s) with the most shepherds take the full
   amount, ties all score, everyone else takes nothing. Shepherd `weight`
   is 1 for the base game; packs (Head Shepherd, Alderman) reweight. */
function scoreFeature(m, final){
  final = !!final;
  let rows = [];
  if(m && m.shepherds.length){
    const pts = basePoints(m, final);
    const by = new Map();
    for(const sh of m.shepherds) by.set(sh.seat, (by.get(sh.seat) || 0) + (sh.weight == null ? 1 : sh.weight));
    let best = 0;
    for(const v of by.values()) if(v > best) best = v;
    if(best > 0){
      const why = describe(m, final, pts);
      const seats = [...by.keys()].sort((a, b) => a - b);
      for(const seat of seats) if(by.get(seat) === best) rows.push({ seat, pts, why });
    }
  }
  const mods = hookRows('scoreMod');
  if(mods) for(const fn of mods){ const r = fn(rows, m, final); if(Array.isArray(r)) rows = r; }
  return rows;
}

/* End-of-game walkthrough (§1.5), ordered lanes → folds → shrines →
   meadows and within a class north-west to south-east so the reveal
   camera moves sensibly. Read-only: shepherds stay on the board. */
function finalScore(){
  const rows = [];
  const picked = featureRoots().filter(m =>
    m.shepherds.length > 0 && m.type !== 'brook' &&
    (m.type === 'meadow' || m.opens !== 0));
  for(const m of picked){
    let ax = 0, ay = 0, first = true;
    const cells = [...m.cells].sort();
    for(const ck of m.cells){
      const comma = ck.indexOf(',');
      const x = +ck.slice(0, comma), y = +ck.slice(comma + 1);
      if(first || y < ay || (y === ay && x < ax)){ ax = x; ay = y; first = false; }
    }
    const awards = scoreFeature(m, true);
    /* `cells` does NOT identify a feature, and neither does (cell,type):
       most of the roster carries two or more segments of one type, so a
       Market Cross holds four separate lanes and Facing Folds two
       separate folds on one cell. A feature is (cell, segIdx) — hence
       the root key on every row, for anything that needs to point at one
       particular feature. */
    rows.push({ kind:m.type, key:m.key, cells, holders:awards.map(a => a.seat),
                pts:awards.length ? awards[0].pts : basePoints(m, true),
                detail:awards.length ? awards[0].why : describe(m, true, basePoints(m, true)),
                anchor:{ x:ax, y:ay } });
  }
  rows.sort((a, b) => TYPE_ORDER[a.kind] - TYPE_ORDER[b.kind] ||
                      a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);
  const mods = hookRows('final');
  if(mods) for(const fn of mods){ const r = fn(rows); if(Array.isArray(r)) return r; }
  return rows;
}

/* ---------------- 8. STATE HASH ----------------
   FNV-1a over the board, the posts, seat scores and supplies, the satchel
   depth and the RNG state. AI scratch memory is deliberately excluded so
   a replay hashes identically whatever the AI was thinking. */
function fnv1a(s){
  let h = 0x811c9dc5 >>> 0;
  for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}
function stateHash(){
  const parts = [];
  for(const k of [...board.keys()].sort()){
    const c = board.get(k);
    parts.push(k + '=' + c.tileId + '/' + c.rot + '/' + (c.seat == null ? '-' : c.seat));
  }
  const posts = [];
  for(const m of featureRoots())
    for(const sh of m.shepherds) posts.push(sh.x + ',' + sh.y + ':' + sh.seg + '=' + sh.seat);
  posts.sort();
  const g = (typeof G !== 'undefined' && G) ? G : null;
  const scores = (g && g.seats) ? g.seats.map(s => s.score | 0).join(',') : '';
  const depth = (g && g.satchel) ? g.satchel.length : 0;
  return fnv1a(parts.join(';') + '|' + posts.join(';') + '|' + scores +
               '|' + supplies.join(',') + '|' + depth + '|' + RNG.state);
}
