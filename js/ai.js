'use strict';
/* WOOLDOM — the opposition: one evaluator, four tempers.
   Every candidate move is scored against a HYPOTHETICAL merge: we read the
   current union-find roots through featureAt() and combine them with the
   candidate tile's own segments in a throwaway local union-find. board.js is
   never mutated during a search, so an interrupted or abandoned search leaves
   the game byte-identical — which is what lets aiEval run 500 times in a test
   without moving stateHash.
   Nothing in this file draws from RNG, or moves RNG.state, ever. Difficulty
   noise is hashed from the position (see aiNoise), which is what lets a SAVED
   and RESUMED AI game come out bit-identical to the same game played straight
   through — a resume replays the log without calling aiMove, so a stream would
   land RNG.state where the original never was.
   ai.js loads AFTER game.js (index.html order is law), so WoolDbg normally
   exists by the time we get here — but nothing in this file may touch G,
   board, TILES or the input path at LOAD time, only when called, because a
   sibling module may still be a stub when a suite loads us. */
/* ---------------- 6. AI ---------------- */

/* ---------------- personalities (design §6) ----------------
   Weight vectors, not behaviours: every temper runs the same evaluator and
   differs only in what it is willing to pay for. `bias` multiplies the value
   of a feature CLASS in this seat's own eyes — it is a taste, so it is never
   applied when we estimate what an opponent thinks a feature is worth.
   ⚑ Wave 2 tuning pass. Maud's two weights moved; the other three still carry
   their design numbers. Measured over a pairwise round-robin — every temper
   against every other, both seat orders, at Ram — pooled over three seed sets,
   720 games for Maud in each column. One set was used to tune; the other two
   were held back and never fitted against, and agree to within a point:

                    win%    mean    meadow share    in hand at mid-game
     maud before     5.4%    72.9       42.2%              0.93
     maud after     26.4%    91.2       33.2%              2.50

   She also stops running dry: turns spent holding no shepherd at all fall from
   41.9% to 18.0%, and her posts per game rise from 12.6 to 16.1 — the second
   half of the game is hers to play again rather than to sit out.

   Her failure was never that she liked meadows. It is that a meadow herder
   NEVER comes home — meadows do not complete, so P=0 and the piece is spent
   for the rest of the game — and w_scar 0.7 priced that permanence lower than
   anyone else at the table. She bought five a game, was out of shepherds by
   the halfway move, and spent 42% of her remaining turns holding nothing to
   post with. w_scar 1.3 makes her the most careful seat about spending a
   shepherd, which is the right instinct for the one temper whose signature
   purchase is non-refundable; w_meadow 1.1 raises the bar a meadow must clear
   without moving her off meadows. She remains the specialist on both measures
   that matter: 4.5 meadow claims a game to Bram's 3.6, and much the largest
   share of her points from grass (33% against Bram's 26%, Wick's 9%, Pip's
   4%). One piece of her character did soften and is worth stating plainly
   rather than burying — she used to seat herders at 0.32 satchel depletion,
   clearly first at the table, and now does it at 0.44, level with Bram
   (Wick 0.47, Pip 0.60). Making a shepherd expensive necessarily makes an
   early one expensive; that is the cost of the fix, and it is why w_scar
   stops at 1.3. Past 1.3 the win rate no longer responds at all and she
   merely hoards, seating later and later for nothing. All of it reproduces on
   two seed sets never used for tuning.

   Measured but NOT taken, for a later wave to decide deliberately: Bram's real
   handicap is w_pot 0.8, not w_block. Raising it to 0.9/1.0 is worth +6/+13
   points of win rate to him, while w_block — his signature — is inert all the
   way from 1.5 down to 0.9, every step inside noise. It is left alone because
   it costs Maud 3.6 points of win rate, which drags her pooled confidence
   interval down onto the 20% floor this pass had to clear. */
const AI_PERSONALITIES = {
  wick: { key:'wick', house:'Steadwright', name:'Old Wick',
          blurb:'builds folds and finishes what he starts',
          w_now:1.0, w_pot:1.2, w_meadow:0.7, w_block:0.3, w_scar:1.0,
          bias:{ fold:1.3 } },
  bram: { key:'bram', house:'Thornhedge', name:'Bram',
          blurb:'plays the hole you wanted',
          w_now:0.9, w_pot:0.8, w_meadow:0.8, w_block:1.5, w_scar:0.9,
          bias:{} },
  maud: { key:'maud', house:'Meadowlord', name:'Maud',
          blurb:'seats herders early and counts grass at the end',
          // w_meadow 1.6 → 1.1 and w_scar 0.7 → 1.3 in Wave 2; see the header.
          w_now:0.8, w_pot:0.9, w_meadow:1.1, w_block:0.5, w_scar:1.3,
          bias:{} },
  pip:  { key:'pip',  house:'Waywalker',  name:'Pip',
          blurb:'runs the lanes and the shrines',
          w_now:1.0, w_pot:1.1, w_meadow:0.5, w_block:0.4, w_scar:1.2,
          bias:{ lane:1.4, shrine:1.4 } },
};
const AI_DEFAULT_PERSONALITY = 'wick';
/* Default pick order for seats a config leaves unnamed. Explicit rather than
   Object.keys(), because which temper lands in seat 2 has to be reproducible
   for a replay, and an order that depends on property insertion is a
   reproducibility bug waiting for someone to tidy the table above. */
const AI_PERSONALITY_ORDER = ['wick', 'bram', 'maud', 'pip'];

/* Difficulty is not a different evaluator — it is how badly the evaluator's
   own numbers are read. σ is in POINTS, so it is comparable to the eval it
   perturbs: at Lamb a 2.5-point mistake is routine, at Ram it takes a
   near-tie for the noise to change the pick. */
const AI_DIFFICULTY = {
  lamb: { key:'lamb', name:'Lamb', sigma:2.5 },
  ewe:  { key:'ewe',  name:'Ewe',  sigma:1.0 },
  ram:  { key:'ram',  name:'Ram',  sigma:0.25 },
};
const AI_DEFAULT_DIFFICULTY = 'ewe';
const AI_DIFFICULTY_ORDER = ['lamb','ewe','ram'];

/* ---------------- the point formulas (mirror of design §3.3) ----------------
   board.scoreFeature() is the authority for what actually lands on a
   scoreboard; these are the same formulas restated for features that do not
   exist yet. They cannot be delegated — scoreFeature needs a real root, and a
   hypothetical has none — so test/ai-smoke.js asserts the two agree on every
   feature that really completes. If that assertion ever fires, this block is
   wrong, not board.js. */
const AI_LANE_PTS       = 1;   // complete lane: 1/tile
const AI_LANE_END_PTS   = 1;   // unfinished lane at end: 1/tile
const AI_FOLD_PTS       = 2;   // complete fold: 2 per (tile + ram)
const AI_FOLD_END_PTS   = 1;   // unfinished fold at end: 1 per (tile + ram)
const AI_SHRINE_PTS     = 9;   // complete shrine: itself + 8 neighbours
const AI_MEADOW_FOLD_PTS = 3;  // meadow at end: 3 per COMPLETED adjacent fold

/* ---------------- model constants ----------------
   Every number the evaluator leans on lives here with the reason it exists.
   Nothing below this block is a bare literal. */

// A fold that a meadow touches but that is not finished yet is not worth 3 —
// it is worth 3 × the chance it finishes. One notional open fold in a meadow's
// ledger is priced a little above a coin flip because open folds on a live
// board attract play.
const AI_MEADOW_OPEN_FOLD_W = 1.2;

// Majority equity. Ties all score full (§1.4), so a tied holder is not worth
// zero — but a tie is one opponent shepherd away from being a loss, and points
// the opponent also collects are worth less to us than points we take alone.
// Being outnumbered is not quite worthless either: features grow, and a second
// shepherd of ours can arrive on a merge.
const AI_EQ_SOLE   = 1.0;
const AI_EQ_TIE    = 0.6;
const AI_EQ_BEHIND = 0.15;

// P(complete). Per open edge we ask the REAL remaining satchel how dense
// matching sides are, then discount for the game running out of tiles.
const AI_P_MATCH_FLOOR = 0.02;  // no completion is ever called flatly impossible
const AI_P_SATCHEL_EXP = 0.5;   // depletion bites on a square root, not linearly
const AI_P_SHRINE_FILL = 0.55;  // per missing neighbour: a frontier cell beside
                                // a shrine is attractive but not guaranteed
const AI_P_MAX = 0.98;          // nothing unfinished is a certainty

// Scarcity: a posted shepherd is capital, and the cost of spending it is how
// long it stays out of supply, divided by how much supply is left. A herder on
// a meadow never comes back at all (meadows never complete) — that falls out
// of P=0 rather than being special-cased.
const AI_SCAR_K = 0.35;         // points per (turn locked ÷ shepherd in hand)

// Enumeration guard. Not a time budget — a deadline would make the AI
// non-deterministic and break replay — but a sanity ceiling on candidates so a
// pathological board cannot wedge a turn. Far above any real frontier.
const AI_MAX_PLACEMENTS = 4000;
const AI_BUDGET_MS = 50;        // design §6 budget; measured, never enforced

/* seg.t → feature class. 'b' (brook) is a real feature for connectivity and
   for splitting meadows, but it never scores. */
const AI_SEG_TYPE = { m:'meadow', l:'lane', f:'fold', s:'shrine', b:'brook' };
/* feature class → the edge letter a tile must show to extend it */
const AI_TYPE_EDGE = { lane:'L', fold:'F', brook:'B', meadow:'M' };

const AI_DIRS4 = [[0,-1],[1,0],[0,1],[-1,0]];              // N,E,S,W = side 0..3
const AI_DIRS8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

/* ---------------- reading the world (never writing it) ----------------
   Sibling modules may be stubs when a suite loads us, so every global they own
   is reached through a guard. typeof on an undeclared name is safe. */
function aiBoard(){ return (typeof board !== 'undefined' && board) ? board : null; }
function aiAt(x, y){ const b = aiBoard(); return b ? b.get(cellKey(x, y)) : undefined; }
function aiTile(id){ return (typeof tileById === 'function') ? tileById(id) : null; }
function aiReady(){
  return typeof legalCells === 'function' && typeof featureAt === 'function'
      && typeof slotOwner === 'function' && typeof tileById === 'function'
      && aiBoard() != null && typeof G === 'object' && G != null;
}

/* board.legalCells answers a question about edges. place() asks a bigger one —
   it runs the canPlace hook rows too, and during the brook phase it runs the
   no-U-turn shaping rule (§1.6) — and game.js already spells that out in
   legalPlacements(). Enumerating anything wider would let the AI choose a move
   the input path then refuses, which is not a lost point but a hung turn, so
   we ask the same function place() will. The `relax` flag has to be passed
   through: draw() sets it when a brook tile has no strict placement left, and
   place() will be checking against the relaxed rule for exactly that tile. */
function aiLegal(tileId){
  if(typeof legalPlacements === 'function'){
    return legalPlacements(tileId, !!(G.brook && G.brook.relax)) || [];
  }
  return (typeof legalCells === 'function') ? (legalCells(tileId) || []) : [];
}

/* board.js owns the shepherd supplies; G.seats[i].supply is a mirror. Read the
   authority when it is there. */
function aiSupply(seatIdx){
  if(typeof supplyOf === 'function') return supplyOf(seatIdx) | 0;
  const s = (G.seats || [])[seatIdx];
  return s ? (s.supply | 0) : 0;
}

/* adjFolds is documented as a Set of fold ROOTS. If board.js ends up storing
   stable ids there instead, resolve them through whatever lookup it offers;
   an entry we cannot resolve is counted as an OPEN fold, which under-values
   the meadow rather than over-values it. */
function aiFoldRoot(v){
  if(v && typeof v === 'object') return v;
  if(typeof rootById === 'function') return rootById(v) || null;
  return null;
}

/* The folds a meadow touches, as live rootMetas. rootMeta.adjFolds holds
   segment-instance KEY STRINGS ('0,0:1'), not roots — board.js exposes
   adjFoldRoots() to canonicalise them through find() and hand back the metas,
   which is the only way to read each fold's live `opens`. Resolving these by
   hand is what made every adjacent fold look permanently open and quietly
   deleted the 3-points-per-finished-fold half of the meadow term.
   adjFoldRoots() rewrites the set it reads in place, but that is path
   compression, not a rules change — the same lazy canonicalisation find()
   already does on every featureAt — and nothing it touches feeds stateHash. */
function aiAdjFolds(root){
  if(typeof adjFoldRoots === 'function') return adjFoldRoots(root) || [];
  const out = [];
  for(const f of (root.adjFolds || [])){ const fr = aiFoldRoot(f); if(fr) out.push(fr); }
  return out;
}

/* A meadow's ledger is read once per root per turn, not once per candidate:
   the roots cannot change while we search, and adjFoldRoots() rebuilds a Set
   on every call. Keyed on G.moveNo so a placement invalidates it. */
let aiLedgerCache = { moveNo:-1, map:new Map() };
function aiCachedLedger(root){
  const mv = (G && G.moveNo) | 0;
  if(aiLedgerCache.moveNo !== mv){ aiLedgerCache = { moveNo:mv, map:new Map() }; }
  let v = aiLedgerCache.map.get(root);
  if(v === undefined){ v = aiRootMeadowLedger(root); aiLedgerCache.map.set(root, v); }
  return v;
}

/* ---------------- the satchel edge histogram ----------------
   DERIVED, not maintained. A counter kept up to date on draw is a second
   source of truth about the satchel, and it desyncs the moment a tile dies to
   the dead-tile rule, a save is resumed mid-game, or a pack's `satchel` hook
   injects tiles. Recounting is 4 reads per remaining tile — under 350 reads on
   a full satchel — done once per turn and cached, so the exact answer is
   cheaper than the bug the incremental version would eventually cost.
   Buckets are SIDES, not tiles: h.L / total is the density of lane-showing
   sides in the pool, i.e. the chance a random side of a random remaining tile
   can extend a lane. */
let aiHistCache = null;
function aiHistogram(){
  const sat = (typeof G === 'object' && G && Array.isArray(G.satchel)) ? G.satchel : null;
  const left = sat ? sat.length : 0;
  if(aiHistCache && aiHistCache.left === left && aiHistCache.sat === sat) return aiHistCache;
  const h = { M:0, L:0, F:0, B:0 };
  let sides = 0;
  if(sat) for(const id of sat){
    const t = aiTile(id); if(!t || !t.edges) continue;
    for(const e of t.edges){ if(h[e] !== undefined) h[e]++; sides++; }
  }
  // How full the satchel started, for the depletion discount. game.js records
  // it; fall back to watching the high-water mark if it ever stops.
  const start = Math.max((G && G.satchelTotal) | 0, left, 1);
  aiHistCache = { h, sides, left, start, sat, frac: left / start };
  return aiHistCache;
}
function aiResetHistogram(){ aiHistCache = null; }

/* Density of sides in the remaining pool that can extend a feature of `type`. */
function aiMatchDensity(hist, type){
  const e = AI_TYPE_EDGE[type];
  if(!e || !hist.sides) return AI_P_MATCH_FLOOR;
  return Math.max(AI_P_MATCH_FLOOR, hist.h[e] / hist.sides);
}

/* P(this feature is ever finished). Each open edge needs a matching side to
   arrive AND the game to still be running when it does; the satchel fraction
   carries the second half. A meadow has no completion to speak of. */
function aiPComplete(type, opens, missingNbrs, hist){
  if(type === 'meadow') return 0;
  if(type === 'shrine'){
    if(missingNbrs <= 0) return 1;
    return Math.min(AI_P_MAX, Math.pow(AI_P_SHRINE_FILL, missingNbrs)
                            * Math.pow(hist.frac, AI_P_SATCHEL_EXP));
  }
  if(opens <= 0) return 1;
  const a = aiMatchDensity(hist, type);
  return Math.min(AI_P_MAX, Math.pow(a, opens) * Math.pow(hist.frac, AI_P_SATCHEL_EXP));
}

/* ---------------- majorities ----------------
   Shepherd counts per seat, as a sparse array indexed by seat. `extraSeat` is
   the shepherd this candidate move would post — the only way a seat can join a
   feature it does not already hold, since posting is legal only on an
   unclaimed feature (§1.2). */
/* Majority sums shepherd WEIGHT, not head count. Everything in wave 1 weighs 1,
   but board.js already carries the field so Hearth & Hall's Head Shepherd
   (weight 2) and the Alderman (weight = rams in the fold) need no change here
   — and a plain shepherd posted by us is always weight 1. */
function aiWeight(sh){ return (sh && sh.weight != null) ? (sh.weight | 0) : 1; }
function aiTallyOne(shepherds){
  const n = [];
  if(shepherds) for(const sh of shepherds){
    const s = sh && sh.seat; if(s == null) continue; n[s] = (n[s] || 0) + aiWeight(sh);
  }
  return n;
}
function aiTallyRoots(roots, extraSeat){
  const n = [];
  for(const r of roots){ if(!r || !r.shepherds) continue;
    for(const sh of r.shepherds){ const s = sh && sh.seat; if(s == null) continue;
      n[s] = (n[s] || 0) + aiWeight(sh); } }
  if(extraSeat != null) n[extraSeat] = (n[extraSeat] || 0) + 1;
  return n;
}
/* §1.4 exactly: every seat holding the maximum scores the full amount. */
function aiScoreShare(n, seat){
  const mine = n[seat] || 0;
  if(!mine) return 0;
  for(let s = 0; s < n.length; s++) if((n[s] || 0) > mine) return 0;
  return 1;
}
/* The same idea softened, for features that have not scored yet: a sole
   majority is worth holding, a tie is worth less than half of one, and being
   behind is worth the option value of a future merge. */
function aiHoldEquity(n, seat){
  const mine = n[seat] || 0;
  if(!mine) return 0;
  let best = 0;
  for(let s = 0; s < n.length; s++) if(s !== seat && (n[s] || 0) > best) best = n[s] || 0;
  if(mine > best) return AI_EQ_SOLE;
  if(mine === best) return AI_EQ_TIE;
  return AI_EQ_BEHIND;
}

/* ---------------- what a feature is worth ---------------- */
function aiCompleteValue(type, tiles, rams){
  switch(type){
    case 'lane':   return tiles * AI_LANE_PTS;
    case 'fold':   return (tiles + rams) * AI_FOLD_PTS;
    case 'shrine': return AI_SHRINE_PTS;
    default:       return 0;                       // meadows score only at the end; brooks never
  }
}
function aiEndValue(type, tiles, rams, nbrs){
  switch(type){
    case 'lane':   return tiles * AI_LANE_END_PTS;
    case 'fold':   return (tiles + rams) * AI_FOLD_END_PTS;
    case 'shrine': return 1 + nbrs;
    default:       return 0;
  }
}
/* Expected points, not Δvalue × P: an unfinished lane or fold still scores at
   the end (§1.5), so the honest expectation is P·complete + (1−P)·end. It
   falls back to exactly the design's formula wherever the end value is zero,
   and it correctly tells the AI that finishing a LANE buys no extra points at
   all — the reason to close a lane is the shepherd, which scarcity prices. */
function aiExpValue(type, tiles, rams, nbrs, P){
  return P * aiCompleteValue(type, tiles, rams) + (1 - P) * aiEndValue(type, tiles, rams, nbrs);
}
/* A meadow's ledger: finished folds are 3 apiece for certain, open ones are a
   discounted promise (design §6 meadowEquity). */
function aiMeadowLedger(done, open){
  return AI_MEADOW_FOLD_PTS * done + AI_MEADOW_OPEN_FOLD_W * open;
}
function aiRootMeadowLedger(root){
  let done = 0, open = 0;
  for(const fr of aiAdjFolds(root)){ if(fr.opens === 0) done++; else open++; }
  return aiMeadowLedger(done, open);
}

/* ---------------- local union-find (scratch, per candidate) ---------------- */
function aiFind(p, i){ while(p[i] !== i){ p[i] = p[p[i]]; i = p[i]; } return i; }
function aiJoin(p, a, b){ a = aiFind(p, a); b = aiFind(p, b); if(a !== b) p[b] = a; return a; }

/* How many tiles a merge really spans. Two distinct roots can already share a
   cell — one Facing Folds tile puts two separate fold roots on the same
   square — so summing root sizes over-counts. Iterate the small sets against
   the biggest one and count what is genuinely new. */
function aiMergedCells(roots, newKey){
  if(!roots.length) return 1;
  let base = roots[0];
  for(const r of roots) if(r.cells && (!base.cells || r.cells.size > base.cells.size)) base = r;
  if(!base.cells) { let n = 1; for(const r of roots) n += (r.cells ? r.cells.size : 0); return n; }
  let n = base.cells.size, extra = null;
  for(const r of roots){
    if(r === base || !r.cells) continue;
    for(const k of r.cells){
      if(base.cells.has(k)) continue;
      if(!extra) extra = new Set();
      if(!extra.has(k)){ extra.add(k); n++; }
    }
  }
  if(!base.cells.has(newKey) && !(extra && extra.has(newKey))) n++;
  return n;
}

/* Placed slot → canonical, the inverse of tiles.js's rotSlot(). We rotate one
   way to find which of our slots meets a neighbour, and back the other way to
   ask who owns a slot, because slotOwner() indexes canonical ids. */
function aiUnrotSlot(slot, rot){
  return ((slot - 3 * (((rot % 4) + 4) % 4)) % 12 + 12) % 12;
}

/* Slots tiles.js could not attribute to a segment. The slot partition is total
   and tiles-a's lint hard-fails otherwise, so this is a bug signal rather than
   a case to handle: we count it, and test/ai-smoke.js asserts it stays zero.
   Counted rather than thrown, because taking the game down mid-turn is a worse
   answer than valuing one tile slightly wrong. */
let aiSlotMiss = 0;

/* Prize Rams are authored per SEGMENT: tiles.js puts ram:1 on the fold segment
   (authoritative for scoring) and mirrors it at tile level as a "bears a ram"
   flag for art and satchel counting. We count the segment field. This returns a
   fallback segment ONLY for a tile that flags a ram without saying which fold
   holds it — no shipping tile does — so that a wave-3 pack which forgets the
   seg field is merely under-attributed instead of silently unrammed. */
function aiRamFallbackSeg(tile){
  if(!tile.ram) return -1;
  const segs = tile.segs || [];
  for(let i = 0; i < segs.length; i++) if(segs[i].ram) return -1;   // authored properly
  for(let i = 0; i < segs.length; i++) if(segs[i].t === 'f') return i;
  return -1;
}

/* ---------------- the cell context ----------------
   Everything about a candidate CELL that does not depend on the rotation:
   which sides have neighbours, how full its 8-neighbourhood is (a shrine on
   the tile we are about to lay needs all eight), and which existing shrines
   this placement advances. Shared across the cell's four rotations, which is
   most of what keeps a turn inside its budget. */
function aiCellCtx(x, y){
  const sideNbr = [];
  for(let s = 0; s < 4; s++){
    const nx = x + AI_DIRS4[s][0], ny = y + AI_DIRS4[s][1];
    const c = aiAt(nx, ny);
    const t = c ? aiTile(c.tileId) : null;
    sideNbr.push(t ? { x:nx, y:ny, rot:c.rot | 0, tile:t } : null);
  }
  /* board.js maintains a shrine root's `opens` as 8 − filled neighbours, on
     every placement in the 8-ring, so completion is `opens === 0` uniformly
     with every other feature and there is nothing here to count by hand. Our
     placement fills one of those neighbours, hence opens − 1.
     Every shrine segment on the cell, not the first: a feature is identified by
     (cell, segIdx), never by (cell, type). */
  let filled = 0;
  const shrines = [];
  for(const [dx, dy] of AI_DIRS8){
    const nx = x + dx, ny = y + dy, c = aiAt(nx, ny);
    if(!c) continue;
    filled++;
    const t = aiTile(c.tileId); if(!t || !t.segs) continue;
    for(let i = 0; i < t.segs.length; i++){
      if(t.segs[i].t !== 's') continue;
      const root = featureAt(nx, ny, i);
      if(root) shrines.push({ root, opens:Math.max(0, (root.opens | 0) - 1) });
    }
  }
  return { x, y, sideNbr, filled, shrines };
}

/* ---------------- the hypothetical merge ----------------
   The heart of the file, and the one place the "no mutation" rule is kept.
   For a candidate (cell, rot) we walk the tile's slots, find the segment each
   one abuts on an already-placed neighbour, and union the candidate's segments
   with the roots they reach — in a scratch parent array, never in board.js's.
   The result is the set of features that would exist after this placement,
   with their merged tile counts, rams, shepherds, opens and meadow ledgers. */
function aiHypo(ctx, tileId, rot){
  const tile = aiTile(tileId);
  if(!tile || !tile.segs) return null;
  const segs = tile.segs, ns = segs.length;
  const parent = []; for(let i = 0; i < ns; i++) parent.push(i);
  const ext = [];                       // node index → external rootMeta
  const extNode = new Map();            // rootMeta → node index
  const sideMask = new Array(ns).fill(0);

  const nodeFor = (root) => {
    let n = extNode.get(root);
    if(n === undefined){ n = parent.length; parent.push(n); extNode.set(root, n); ext[n] = root; }
    return n;
  };

  for(let s = 0; s < ns; s++){
    for(const c of (segs[s].e || [])){
      const p = rotSlot(c, rot);                  // canonical slot → placed slot
      const side = (p / 3) | 0, i = p % 3;
      sideMask[s] |= 1 << side;
      const nb = ctx.sideNbr[side];
      if(!nb) continue;
      // side s slot i meets side (s+2)%4 slot 2-i on the neighbour (§2.1)
      const p2 = ((side + 2) % 4) * 3 + (2 - i);
      const owner = slotOwner(nb.tile, aiUnrotSlot(p2, nb.rot));
      if(owner == null || owner < 0){ aiSlotMiss++; continue; }
      const root = featureAt(nb.x, nb.y, owner);
      if(root) aiJoin(parent, s, nodeFor(root));
    }
  }

  // Collapse the scratch forest into groups.
  const gOf = new Array(parent.length);
  const groups = [];
  for(let n = 0; n < parent.length; n++){
    const r = aiFind(parent, n);
    if(gOf[r] === undefined){
      gOf[r] = groups.length;
      groups.push({ type:null, segs:[], roots:[], opens:0, joins:0, tiles:0, rams:0,
                    nbrs:0, missing:0, complete:false, meadow:null });
    }
  }
  for(let n = 0; n < parent.length; n++) gOf[n] = gOf[aiFind(parent, n)];
  for(let n = 0; n < parent.length; n++){
    const g = groups[gOf[n]];
    if(n < ns){ g.segs.push(n); if(!g.type) g.type = AI_SEG_TYPE[segs[n].t] || 'meadow'; }
    else g.roots.push(ext[n]);
  }
  for(const g of groups) if(!g.type && g.roots.length) g.type = g.roots[0].type || 'meadow';

  // Every side of this cell that meets an occupied neighbour closes one open
  // end on the feature owning that side's CENTRE slot: −2 on the merged root
  // (§3.1). Meadows and shrines keep no opens, so an 'M' side is a no-op here.
  for(let side = 0; side < 4; side++){
    if(!ctx.sideNbr[side]) continue;
    const owner = slotOwner(tile, aiUnrotSlot(side * 3 + 1, rot));
    if(owner == null || owner < 0){ aiSlotMiss++; continue; }
    groups[gOf[owner]].joins++;
  }

  const newKey = cellKey(ctx.x, ctx.y);
  const ramFallback = aiRamFallbackSeg(tile);
  for(const g of groups){
    if(g.type === 'shrine'){
      // A shrine owns no slots, so it never merges: one cell, and its opens are
      // the eight neighbours it still wants — the same accounting board.js
      // keeps, so `complete ⇔ opens === 0` reads the same for every feature.
      g.tiles = 1;
      g.nbrs = ctx.filled;
      g.opens = g.missing = 8 - ctx.filled;
      g.complete = g.opens <= 0;
    } else {
      let opens = -2 * g.joins;
      for(const s of g.segs){
        let m = sideMask[s];
        while(m){ opens += m & 1; m >>>= 1; }
      }
      for(const r of g.roots) opens += (r.opens | 0);
      g.opens = Math.max(0, opens);
      g.tiles = aiMergedCells(g.roots, newKey);
      g.complete = (g.type !== 'meadow') && g.opens === 0;
    }
    for(const s of g.segs){
      g.rams += (segs[s].ram | 0);
      if(s === ramFallback) g.rams += (tile.ram | 0);
    }
    for(const r of g.roots) g.rams += (r.rams | 0);
  }

  // Meadow ledgers, after the merge. A fold this meadow touches may be one of
  // the groups we just built (the candidate tile's own `touches`, or an
  // adjacent fold root that this same placement extends), so folds are keyed
  // by group index where they are ours and by root object where they are not —
  // one Set, no double counting.
  for(const g of groups){
    if(g.type !== 'meadow') continue;
    const adj = new Set();
    for(const r of g.roots) for(const fr of aiAdjFolds(r)){
      // A fold this meadow already touches may be one THIS placement extends,
      // in which case its finished-ness is the hypothetical group's, not the
      // live root's. featureAt hands back stable canonical metas, so object
      // identity is the right way to spot that.
      const n = extNode.get(fr);
      if(n !== undefined) adj.add(gOf[n]); else adj.add(fr);
    }
    for(const s of g.segs) for(const fi of (segs[s].touches || [])){
      if(fi >= 0 && fi < ns) adj.add(gOf[fi]);
    }
    let done = 0, open = 0;
    for(const a of adj){
      if(typeof a === 'number'){
        const fg = groups[a];
        if(!fg || fg.type !== 'fold') continue;
        if(fg.complete) done++; else open++;
      } else if(a.opens === 0) done++; else open++;
    }
    g.meadow = aiMeadowLedger(done, open);
  }

  return { ctx, tile, tileId, rot, groups, gOf, ns, shrines:ctx.shrines };
}

/* Which segments of this candidate could take a shepherd. Legal iff the whole
   merged feature carries no shepherd at all (§1.2) and supply is left. Brook
   segments are excluded on merit rather than legality: a brook never scores,
   so a shepherd on one is a piece spent for nothing and is strictly dominated
   by skipping. */
function aiPostable(hypo, seatIdx){
  const out = [];
  if(aiSupply(seatIdx) <= 0) return out;
  for(let s = 0; s < hypo.ns; s++){
    const g = hypo.groups[hypo.gOf[s]];
    if(!g || g.type === 'brook') continue;
    let held = false;
    for(const r of g.roots) if(r.shepherds && r.shepherds.length){ held = true; break; }
    if(!held) out.push(s);
  }
  return out;
}

/* ---------------- evaluation ----------------
   V = w_now·now + w_pot·potential + w_meadow·meadowEquity + w_block·denial
       − w_scar·scarcity                                        (design §6)
   Side-effect free: reads roots, writes nothing, draws no randomness. */
function aiEvalMove(seatIdx, hypo, segIdx, hist){
  const seats = G.seats || [];
  const seat = seats[seatIdx];
  const p = aiPersonality(seat);
  const bias = p.bias || {};
  let now = 0, pot = 0, meadow = 0, denial = 0, scar = 0;

  const groups = hypo.groups;
  const postGroup = segIdx != null ? hypo.gOf[segIdx] : -1;
  for(let gi = 0; gi < groups.length; gi++){
    const g = groups[gi];
    if(g.type === 'brook') continue;               // never scores, nothing to weigh

    const after = aiTallyRoots(g.roots, gi === postGroup ? seatIdx : null);
    const P = g.complete ? 1 : aiPComplete(g.type, g.opens, g.missing, hist);
    const isMeadow = g.type === 'meadow';

    // What each absorbed root was already worth, before any seat is named.
    // Hoisted out of the seat loop: the tallies and the values do not depend
    // on whose eyes we are looking through, only the equity share does.
    const prior = [];
    for(const r of g.roots){
      const rv = isMeadow ? aiCachedLedger(r)
                          : aiExpValue(r.type || g.type, r.cells ? r.cells.size : 1,
                                       r.rams | 0, g.nbrs,
                                       aiPComplete(r.type || g.type, r.opens | 0, 0, hist));
      prior.push({ n: aiTallyOne(r.shepherds), v: rv });
    }

    const b = isMeadow ? (bias.meadow || 1) : (bias[g.type] || 1);
    const valAfter = isMeadow ? g.meadow
                   : g.complete ? aiCompleteValue(g.type, g.tiles, g.rams)
                                : aiExpValue(g.type, g.tiles, g.rams, g.nbrs, P);

    for(let s = 0; s < seats.length; s++){
      // What this feature is worth to seat s after the move…
      const share = (!isMeadow && g.complete) ? aiScoreShare(after, s) : aiHoldEquity(after, s);
      let d = share * valAfter;
      // …less what the roots it absorbed were already worth to it.
      for(const p of prior) d -= aiHoldEquity(p.n, s) * p.v;
      if(s !== seatIdx){ denial -= d; continue; }   // their gain is our loss
      if(isMeadow) meadow += d * b;
      else if(g.complete) now += share * valAfter * b;   // banked, tempered by taste
      else pot += d * b;
    }
  }

  // Shrines elsewhere on the board that this placement finishes. We cannot
  // post on them — they are not on the tile in hand — so they only ever move
  // `now` (ours) or `denial` (theirs).
  for(const sh of hypo.shrines){
    if(sh.opens > 0) continue;
    const t = aiTallyOne(sh.root.shepherds);
    for(let s = 0; s < seats.length; s++){
      const v = aiScoreShare(t, s) * AI_SHRINE_PTS;
      if(!v) continue;
      if(s === seatIdx) now += v * (bias.shrine || 1); else denial -= v;
    }
  }

  // Scarcity: only a post costs anything. expectedTurnsLocked is how much of
  // OUR remaining game the shepherd sits out — (1−P) of it, since a feature
  // that completes hands the piece straight back.
  if(segIdx != null){
    const g = hypo.groups[hypo.gOf[segIdx]];
    const P = g.complete ? 1 : aiPComplete(g.type, g.opens, g.missing, hist);
    const turnsLeft = hist.left / Math.max(1, seats.length);
    scar = AI_SCAR_K * ((1 - P) * turnsLeft) / Math.max(1, aiSupply(seatIdx));
  }

  let v = p.w_now * now + p.w_pot * pot + p.w_meadow * meadow
        + p.w_block * denial - p.w_scar * scar;
  for(const row of AI.hooks.eval){
    const add = row(seatIdx, hypo, segIdx, { now, pot, meadow, denial, scar, hist });
    if(typeof add === 'number' && isFinite(add)) v += add;
  }
  return { v, now, pot, meadow, denial, scar };
}

/* ---------------- enumeration ----------------
   Every legal cell × rotation × (skip + each postable segment of the tile just
   laid). Deterministic order: legalCells' order, then rotation, then segment —
   so ties break the same way on every replay. */
function aiMoves(seatIdx, tileId){
  if(!aiReady()) return [];
  const seat = (G.seats || [])[seatIdx];
  if(!seat) return [];
  const id = tileId != null ? tileId : G.drawn;
  if(id == null) return [];
  const hist = aiHistogram();
  const cells = aiLegal(id);
  const out = [];
  let placements = 0;
  for(const c of cells){
    const ctx = aiCellCtx(c.x, c.y);
    const rots = c.rots || [0, 1, 2, 3];
    for(const rot of rots){
      if(++placements > AI_MAX_PLACEMENTS) return out;
      const hypo = aiHypo(ctx, id, rot);
      if(!hypo) continue;
      const base = { x:c.x, y:c.y, rot, tileId:id };
      let e = aiEvalMove(seatIdx, hypo, null, hist);
      out.push(Object.assign({ seg:null }, base, e));
      for(const s of aiPostable(hypo, seatIdx)){
        e = aiEvalMove(seatIdx, hypo, s, hist);
        out.push(Object.assign({ seg:s }, base, e));
      }
    }
  }
  return out;
}

/* ---------------- temper & noise ---------------- */
function aiPersonality(seat){
  const raw = seat && seat.personality;
  return AI_PERSONALITIES[aiPersonalityKey(raw)];
}
function aiPersonalityKey(raw){
  if(raw == null) return AI_DEFAULT_PERSONALITY;
  const k = String(raw).toLowerCase().replace(/[^a-z]/g, '');
  if(AI_PERSONALITIES[k]) return k;
  for(const key in AI_PERSONALITIES){
    const p = AI_PERSONALITIES[key];
    if(k === p.house.toLowerCase() || k === p.name.toLowerCase().replace(/[^a-z]/g, '')) return key;
    if(k.indexOf(key) >= 0) return key;
  }
  return AI_DEFAULT_PERSONALITY;
}
function aiDifficultyKey(raw){
  if(typeof raw === 'number') return AI_DIFFICULTY_ORDER[clamp(raw | 0, 0, 2)];
  if(raw == null) return AI_DEFAULT_DIFFICULTY;
  const k = String(raw).toLowerCase().replace(/[^a-z]/g, '');
  return AI_DIFFICULTY[k] ? k : AI_DEFAULT_DIFFICULTY;
}
function aiSigma(seat){ return AI_DIFFICULTY[aiDifficultyKey(seat && seat.difficulty)].sigma; }

/* ---------------- difficulty noise: STATELESS ----------------
   Box-Muller over a hash of WHERE THE GAME IS, not over a stream. Both uniforms
   come from (G.seed, G.moveNo, seatIdx, candidateIndex), so the noise on a
   candidate is a pure function of the position: it does not depend on how many
   numbers anything has drawn to get here, and it never moves RNG.state.

   That is the whole point. A save is a replay log, and a resume rebuilds it
   through place() without ever calling aiMove — so noise drawn from the shared
   RNG stream would leave RNG.state somewhere the original game never was, and
   stateHash mixes RNG.state. Streamed noise therefore made a resumed AI game
   diverge from the same game played straight through. Hashing the position
   instead makes the two bit-identical, and costs nothing to save.

   core.js's hash() is two-argument and documented cosmetics-only, so the mixer
   is local: the same avalanche this project's mulberry32 already trusts,
   applied to a mixed key rather than to a running state.
   ⚑ Amended by the integrator from CONTRACT.md's original "AI noise through
   RNG" to seeded-and-deterministic, which is what that line was protecting. */
const AI_NOISE_SALT = 0x9e3779b9 | 0;      // golden-ratio odd constant

function aiMix(a, b, c, d, stream){
  let h = AI_NOISE_SALT;
  h ^= a | 0; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  h ^= b | 0; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  h ^= c | 0; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  h ^= d | 0; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  h ^= stream | 0; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 15;
  return h >>> 0;
}
/* strictly inside (0,1): the +0.5 keeps log(u1) finite at both ends */
function aiUniform(a, b, c, d, stream){
  return (aiMix(a, b, c, d, stream) + 0.5) / 4294967296;
}
function aiNoise(sigma, seatIdx, candIdx){
  if(!(sigma > 0)) return 0;             // safe now: there is no stream to desync
  const seed = (G && G.seed) | 0, mv = (G && G.moveNo) | 0;
  const u1 = aiUniform(seed, mv, seatIdx, candIdx, 0);
  const u2 = aiUniform(seed, mv, seatIdx, candIdx, 1);
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/* ---------------- choosing, without doing ----------------
   The top half of a turn — enumerate, score, pick — with nothing done about
   it. Returns the plan aiMove is about to act on, or null when there is no
   tile in hand or nowhere to put it.

   It exists as its own function because ui.js needs to show a ghost of where
   the AI intends to play BEFORE the tile lands, and aiMove is atomic: by the
   time it returns, the board has already changed and the moment is gone.
   Rather than let ui.js run its own argmax — aiSigma and aiNoise are private
   here, so it could only approximate one, and a second selection path would
   disagree with this one the moment either changed — aiMove now calls this and
   there is exactly one place a move is chosen.

   PURE, and that is the whole contract: no board mutation (aiHypo never had
   any), no draw, no G.drawn/G.moveNo, no seat.ai, and — the one that matters —
   no RNG. One honest asterisk, stated here because a reader who finds it
   unaided will stop trusting the paragraph: the search reaches meadow ledgers
   through board.js's adjFoldRoots(), which CANONICALISES rootMeta.adjFolds in
   place. That is path compression — the same lazy find() every featureAt call
   already performs, idempotent, invisible to stateHash, and true of AI.moves
   long before this function existed. Nothing a caller can observe changes; but
   a purity test that deep-snapshots the root graph instead of comparing
   stateHash will see that Set rewritten, and should not read it as a bug.
   The difficulty noise is
   hashed from (G.seed, G.moveNo, seatIdx, candidateIdx), so calling this and
   then calling aiMove at the same G.moveNo picks the same candidate BY
   CONSTRUCTION rather than by luck, and a preview cannot cost a resumed game
   its bit-identical replay. test/ai-smoke.js holds both halves of that:
   the purity, and the agreement with what aiMove actually plays. */
function aiPlan(seatIdx, tileId){
  if(!aiReady()) return null;
  const seat = (G.seats || [])[seatIdx];
  if(!seat) return null;
  /* Deliberately does NOT draw. draw() pops the satchel, can retire a dead
     tile and can close the brook phase — all real state changes, and a preview
     that caused them would be a preview with consequences. beginTurn() has
     already drawn by the time anything wants a ghost, so there is a tile in
     hand; when there is not, that is an answer, not a thing to fix here. */
  const id = tileId != null ? tileId : G.drawn;
  if(id == null) return null;

  const moves = aiMoves(seatIdx, id);
  if(!moves.length) return null;      // dead tile: game.js owns the set-aside

  /* Strictly greater, so the FIRST candidate of a tied maximum wins and the
     enumeration order (cells, then rotation, then segment) is the tie-break.
     Do not relax this to >=: ties are common on an open board, and which one
     is taken is part of what every golden hash in test/ai-match.js records. */
  const sigma = aiSigma(seat);
  let best = null, bestV = -Infinity;
  for(let i = 0; i < moves.length; i++){
    const m = moves[i];
    const v = m.v + aiNoise(sigma, seatIdx, i);
    if(v > bestV){ bestV = v; best = m; }
  }

  return { x:best.x, y:best.y, rot:best.rot, seg:best.seg, v:best.v, noisy:bestV,
           parts:{ now:best.now, pot:best.pot, meadow:best.meadow,
                   denial:best.denial, scar:best.scar },
           considered:moves.length, sigma,
           personality:aiPersonalityKey(seat.personality) };
}

/* ---------------- the turn ----------------
   Takes aiPlan's pick and plays it through the SAME functions the pointer
   calls — place() then spot() or skip(). By the time the move reaches board.js
   there is nothing to distinguish it from a clicked one.
   No time-based cutoff anywhere: a deadline would make the search depend on
   the machine it ran on, and replay saves would stop reproducing. */
function aiMove(seatIdx){
  if(!aiReady()) return null;
  const seat = (G.seats || [])[seatIdx];
  if(!seat) return null;
  if(!seat.ai) seat.ai = {};
  const t0 = aiNow();

  if(G.drawn == null && typeof draw === 'function') draw();
  const id = G.drawn;
  if(id == null){ seat.ai.plan = null; return null; }

  const best = aiPlan(seatIdx, id);
  if(!best){                          // dead tile: game.js owns the set-aside
    seat.ai.plan = null;
    seat.ai.ms = aiNow() - t0;
    return null;
  }
  seat.ai.plan = best;

  const placed = place(best.x, best.y, best.rot);
  if(placed === false){ seat.ai.ms = aiNow() - t0; return null; }

  /* The post window. Our postability was computed against a board that did not
     exist yet, so before spending a shepherd we ask the engine what it will
     actually accept; a segment it refuses would leave the turn parked in the
     post step forever. Any disagreement is counted rather than swallowed —
     test/ai-smoke.js asserts the count stays zero, so a real divergence
     between the hypothetical merge and board.canPost surfaces as a failure
     instead of as an AI that quietly stops posting. */
  if(G.step === 'post'){
    const opts = (typeof postOptions === 'function') ? postOptions() : null;
    const want = best.seg;
    if(want != null && (!opts || opts.indexOf(want) >= 0)) spot(want);
    else {
      if(want != null) seat.ai.postMiss = (seat.ai.postMiss | 0) + 1;
      if(typeof skip === 'function') skip();
    }
  }

  seat.ai.ms = aiNow() - t0;
  seat.ai.turns = (seat.ai.turns | 0) + 1;
  seat.ai.msMax = Math.max(seat.ai.msMax || 0, seat.ai.ms);
  return seat.ai.plan;
}
function aiNow(){
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/* ---------------- namespace ----------------
   AI.hooks rows are the wave-3 seam: a pack adds an eval term by pushing a
   function, never by editing this file. */
const AI = {
  PERSONALITIES: AI_PERSONALITIES,
  PERSONALITY_ORDER: AI_PERSONALITY_ORDER,
  DIFFICULTY: AI_DIFFICULTY,
  DIFFICULTY_ORDER: AI_DIFFICULTY_ORDER,
  hooks: { eval:[] },
  move: aiMove,
  /* The dry run behind ui.js's ghost beat: the same pick aiMove is about to
     make, with nothing done about it. See aiPlan. */
  plan: aiPlan,
  moves: aiMoves,
  evalMove: aiEvalMove,
  hypo: aiHypo,
  cellCtx: aiCellCtx,
  histogram: aiHistogram,
  resetHistogram: aiResetHistogram,
  slotMiss: () => aiSlotMiss,
  // exposed so test/ai-smoke.js can hold the meadow term against board.js's own
  // completedAdjFolds instead of against itself
  meadowFolds: (root) => { let done = 0, open = 0;
    for(const fr of aiAdjFolds(root)){ if(fr.opens === 0) done++; else open++; }
    return { done, open }; },
  MEADOW_FOLD_PTS: AI_MEADOW_FOLD_PTS,
  personalityKey: aiPersonalityKey,
  difficultyKey: aiDifficultyKey,
  completeValue: aiCompleteValue,
  endValue: aiEndValue,
  BUDGET_MS: AI_BUDGET_MS,
};
window.AI = AI;

/* ---------------- debug wiring ----------------
   CONTRACT: ai.js ADDS aiMove to WoolDbg and never moves or replaces it.
   index.html loads us after game.js, so the object normally already exists and
   we simply augment it. If it does not — a suite loading a stubbed game.js, or
   a future reorder — we intercept the single assignment that publishes it, add
   our method to the object on its way through, and stand down, leaving WoolDbg
   an ordinary writable property exactly as game.js wrote it so ui.js can
   augment it in turn. */
(function(){
  function augment(v){
    if(!v || typeof v !== 'object') return v;
    if(typeof v.aiMove !== 'function') v.aiMove = aiMove;
    if(typeof v.aiMoves !== 'function') v.aiMoves = aiMoves;
    if(!v.AI) v.AI = AI;
    return v;
  }
  if(window.WoolDbg && typeof window.WoolDbg === 'object'){ augment(window.WoolDbg); return; }
  Object.defineProperty(window, 'WoolDbg', {
    configurable:true, enumerable:true,
    get(){ return undefined; },
    set(v){
      Object.defineProperty(window, 'WoolDbg',
        { value:v, writable:true, enumerable:true, configurable:true });
      augment(v);
    },
  });
})();
