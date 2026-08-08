'use strict';
/* ==================================================================
   WOOLDOM — js/game.js
   G state, the brook opening (§1.6), the turn loop (§1.2), completion
   scoring, the pack hook registry, replay-log saves, and the animation
   clock. This file owns WHEN things happen; board.js owns whether they
   are legal and what they are worth.

   The one rule that shapes everything below: place() is THE input path.
   The pointer, the keyboard, ai.js and WoolDbg all arrive there and
   nowhere else, which is what makes a replay log a complete save.
   ================================================================== */

/* ---------------- 1. STATE ---------------- */

const G = {
  mode:'menu',              // menu | brook | play | reveal | end
  step:'idle',              // idle | place | post   (where inside a turn we are)
  seats:[], turnIdx:0,
  satchel:null, dead:[],    // satchel is bound to the module-level array below
  drawn:null,               // the tile in hand, or null
  pending:null,             // {x,y,tileId,rot,seg,completed[]} — this turn's placement
  brook:null,               // brook-phase state, §1.6; null once the brook is done
  reveal:null,              // {base:[scores], steps:[...], idx} — end walkthrough
  config:null, seed:0, satchelTotal:0, moveNo:0,
  log:[],                   // the save: one {t,x,y,rot,s?} per completed turn
  recent:[],                // last few scoring events, for the ui move-log
  banner:'',
  view:{cx:0, cy:0, zoom:1},
  tick:0, frac:1, calm:false,
  autoAI:true,              // ui.js sets false when it wants to animate AI turns
  replaying:false,          // suppresses autosave + sfx while a log is rebuilt
};
window.G = G;

/* The satchel and the discard live as module-level arrays because board.js's
   stateHash reads `satchel.length` and WoolDbg hands out `satchel` directly;
   G.satchel is the same array, not a copy. */
const satchel = [];
const dead = [];
G.satchel = satchel; G.dead = dead;

/* ---------------- 2. HOOK REGISTRY ----------------
   Ships empty in wave 1 and stays empty until the packs land in wave 3 — but
   it ships NOW, because a hook added later is an engine edit and the whole
   point of the registry is that packs never edit the engine. Every row is a
   plain function; the engine iterates in push order.

     satchel(bag, config)                    mutate the bag before it is shuffled
     canPlace(tileId, rot, x, y, ok) -> ok   veto/allow      (called BY board.js)
     onPlaced(x, y, tileId, rot, completed)  tile is down    (called BY board.js)
     spots(options, pending, G)      -> new array of postable segIdx
     scoreMod(rows, root, final)     -> rows                 (called BY board.js)
     onComplete(root, rows, G)               a feature just scored
     turnStart(seatIdx, G) / turnEnd(seatIdx, G)
     final(rows)                     -> rows  end walkthrough (called BY board.js)
     menu(rows, G)                   -> rows                 (called BY ui.js)

   Four of the ten fire inside board.js, next to the state they judge, and are
   NOT re-fired here — a row invoked twice per event is worse than one never
   invoked, because the second call looks like it worked. */
const Hooks = {
  satchel:[], canPlace:[], onPlaced:[], spots:[], scoreMod:[],
  onComplete:[], turnStart:[], turnEnd:[], final:[], menu:[],
};
window.Hooks = Hooks;

/* ---------------- 3. CONSTANTS ---------------- */

const SKEY = 'wooldom.';
const SAVE_V = 1;                    // replay-log format; bump only on a break

/* Brook OFF pre-places one Gate Road at the origin (§1.1) — tiles.js owns the
   id as OPENING_TILE; it comes OUT of the 72, so satchel + board + dead is a
   constant either way. */
const BROOK_SPRING = 'B_SPRING', BROOK_FORK = 'B_FORK', BROOK_LAKE = 'B_LAKE';
const BROOK_FORK_BY = 4;             // §1.6: the fork lands within the first four draws

/* §6 personalities in default pick order. ai.js owns the table, so these are
   read from AI.PERSONALITY_ORDER at CALL time (ai.js loads after this file, so
   there is nothing to read at load time) — one source of truth, and the two
   provably cannot drift. The literal below is the fallback for a suite that
   loads game.js without ai.js, which several do.
   The ORDER matters and is deliberately not Object.keys: which temper lands in
   seat 2 has to be reproducible for a replay, and key order that depends on
   how someone last tidied the table is a reproducibility bug in waiting. */
const AI_SEATS_FALLBACK = [
  {personality:'wick', name:'Old Wick'}, {personality:'bram', name:'Bram'},
  {personality:'maud', name:'Maud'},     {personality:'pip',  name:'Pip'},
];
const DIFFICULTIES_FALLBACK = ['lamb','ewe','ram'];

function aiSeatTable(){
  if(typeof AI === 'undefined' || !AI || !Array.isArray(AI.PERSONALITY_ORDER)) return AI_SEATS_FALLBACK;
  const rows = AI.PERSONALITY_ORDER.map(k => ({
    personality: k,
    name: (AI.PERSONALITIES && AI.PERSONALITIES[k] && AI.PERSONALITIES[k].name) || k,
  }));
  return rows.length ? rows : AI_SEATS_FALLBACK;
}
function difficultyTable(){
  if(typeof AI === 'undefined' || !AI || !Array.isArray(AI.DIFFICULTY_ORDER)) return DIFFICULTIES_FALLBACK;
  return AI.DIFFICULTY_ORDER.length ? AI.DIFFICULTY_ORDER : DIFFICULTIES_FALLBACK;
}
const RECENT_KEEP = 8;               // ui shows the last 3; keep a little slack

/* side → neighbour offset, N=0 E=1 S=2 W=3 (the §2.1 winding) */
const GDX = [0, 1, 0, -1], GDY = [-1, 0, 1, 0];

/* ---------------- 4. SMALL SERVICES ---------------- */

/* Every Snd call in this file goes through here: audio.js may not have landed,
   a row may not exist yet, and a replay must be silent. */
function sfx(name, x){
  if(G.replaying) return;
  if(typeof Snd==='undefined' || !Snd || typeof Snd[name]!=='function') return;
  try{ Snd[name](x); }catch(e){}
}

/* How far through the satchel we are, 0 at the first draw and 1 at the last. */
function depletion(){
  const total = G.satchelTotal || 1;
  return clamp(1 - satchel.length/total, 0, 1);
}
/* audio.js's hi() layer is silent at exactly 0.5 and ramps from there:
       if(intensity>0.5 && spec.hi) spec.hi(step, t, (intensity-0.5)*2)
   so tension handed over raw would waste its entire bottom half. Mapping
   t -> 0.5+0.5t cancels that arithmetic exactly (lift === t), which means the
   number below IS the layer's amplitude and there is no second calibration to
   keep in your head. The t>0 guard keeps an untouched satchel genuinely quiet
   instead of parking the bed at 1.225x gain. (Same convention as Burned
   Ground's setTension — see CONTRACT.md §audio.) */
function setTension(t){
  const i = t>0 ? 0.5 + 0.5*clamp(t,0,1) : 0;
  if(typeof Snd!=='undefined' && Snd && Snd.musicIntensity) Snd.musicIntensity(i);
  return i;
}

function lsGet(k, d){ try{ const v=localStorage.getItem(SKEY+k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(SKEY+k, JSON.stringify(v)); }catch(e){} }
function prefGet(k, d){ const p = lsGet('prefs', {}) || {}; return (k in p) ? p[k] : d; }
function prefSet(k, v){ const p = lsGet('prefs', {}) || {}; p[k] = v; lsSet('prefs', p); }

/* tiles.js and board.js land in the same wave as this file. Nothing here may
   throw while they are still stubs — the boot suite loads every module. */
function depsReady(){
  return typeof TILES!=='undefined' && typeof tileById==='function'
      && typeof edgeCode==='function' && typeof placeTile==='function'
      && typeof canPlace==='function' && typeof legalCells==='function';
}
function brookReady(){ return depsReady() && typeof BROOK_TILES!=='undefined'; }

/* ---------------- 5. SETUP ---------------- */

function normalizeConfig(cfg){
  cfg = cfg || {};
  const TEMPERS = aiSeatTable(), LEVELS = difficultyTable();
  const midLevel = LEVELS[Math.min(1, LEVELS.length-1)];
  let seats = cfg.seats;
  if(typeof seats === 'number'){                    // "give me a 3-player game"
    const n = clamp(seats|0, 2, 5), list = [{human:true, name:'You'}];
    for(let i=1;i<n;i++) list.push(Object.assign({human:false}, TEMPERS[(i-1)%TEMPERS.length]));
    seats = list;
  }
  if(!seats || !seats.length) seats = [{human:true, name:'You'},
                                       Object.assign({human:false}, TEMPERS[0])];
  seats = seats.slice(0,5).map((s,i)=>{
    const ai = TEMPERS[(i ? i-1 : 0) % TEMPERS.length];
    const human = s.human !== false && !s.personality;
    return {
      name: (s.name || (human ? 'You' : ai.name)),
      color: s.color || PAL['p'+(i+1)] || PAL.p1,
      human,
      personality: human ? null : (s.personality || ai.personality),
      difficulty: s.difficulty || midLevel,
      score:0, supply:SHEPHERDS, ai:{},
    };
  });
  return {
    seats,
    modules: Object.assign({brook:true}, cfg.modules||{}),
    seed: (cfg.seed!=null && cfg.seed!=='') ? (cfg.seed|0) : (Date.now()|0),
    calm: cfg.calm!=null ? !!cfg.calm : !!prefGet('calm', false),
  };
}

/* The bag, before shuffling: every tile repeated by its count, then the pack
   rows, then one Gate Road pulled out if it is going to be the opening tile.
   Brook tiles are NOT in here — they are their own 12, played first. */
/* How many copies of a tile the deal carries. The two ends of this are easy to
   get backwards and both are silent: `count||1` turns an explicit `count:0`
   into ONE copy, so a tile someone tried to disable ships anyway; `count|0`
   turns an ABSENT count into zero, so a hand-authored row that omits it
   vanishes. Absent means one (the documented default), explicit zero means
   none, and nothing negative gets through. */
function tileCopies(t){
  if(!t || t.count == null) return 1;
  return Math.max(0, t.count|0);
}

function buildSatchel(cfg){
  const bag = [];
  for(const t of TILES) for(let i=0, n=tileCopies(t); i<n; i++) bag.push(t.id);
  for(const h of Hooks.satchel) h(bag, cfg);
  if(!cfg.modules.brook){
    const i = bag.indexOf(OPENING_TILE);
    if(i>=0) bag.splice(i,1);
  }
  return RNG.shuffle(bag);
}

function startGame(config){
  const cfg = normalizeConfig(config);
  G.config = cfg;
  G.seed = cfg.seed;
  RNG.seed(G.seed);

  G.seats = cfg.seats;
  G.turnIdx = 0; G.moveNo = 0;
  G.drawn = null; G.pending = null; G.reveal = null; G.brook = null;
  G.log = []; G.recent = []; G.banner = '';
  G.step = 'idle'; G.calm = cfg.calm;
  dead.length = 0; satchel.length = 0;
  if(typeof resetBoard==='function') resetBoard(G.seats.length);
  syncSupplies();
  if(!depsReady()){ G.mode = 'menu'; return G; }   // stubs still loading: stay put

  /* Order matters only because it must be STABLE: the satchel shuffle and the
     brook shuffle draw from the same stream, so the satchel goes first, always. */
  const bag = buildSatchel(cfg);
  for(const id of bag) satchel.push(id);
  G.satchelTotal = satchel.length;

  if(cfg.modules.brook && brookReady()){
    brookInit();
    G.mode = 'brook';
  }else{
    placeTile(0, 0, OPENING_TILE, 0);              // §1.1 opening tile
    stampSeat(0, 0, -1);                           // the land, not a player's move
    G.mode = 'play';
  }
  if(typeof Snd!=='undefined' && Snd && Snd.musicStart) Snd.musicStart('pasture');
  setTension(0);
  beginTurn();
  /* Save the opening straight away, empty log and all. Starting a game
     abandons the one before it, and without this the menu's resume would still
     be offering the OLD game right up until this one's first turn ends — which
     is both wrong and impossible to tell apart from a correct resume. */
  autosave();
  return G;
}

/* placeTile leaves cell.seat null — whose move it was is the turn loop's
   knowledge, not the graph's. −1 marks the land itself: the opening tile and
   the spring belong to nobody. */
function stampSeat(x, y, seat){
  if(typeof board==='undefined' || !board || !board.get) return;
  const c = board.get(cellKey(x,y));
  if(c) c.seat = seat;
}

/* board.js is the authority on shepherd supplies — postShepherd and
   returnShepherds move them, and stateHash reads board's array, not ours.
   G.seats[i].supply is a mirror kept for the hud and the AI, refreshed
   wherever a shepherd changes hands. Two counters, one of them derived. */
function syncSupplies(){
  if(typeof supplyOf!=='function') return;
  for(let i=0;i<G.seats.length;i++) G.seats[i].supply = supplyOf(i);
}

/* ---------------- 6. THE BROOK (§1.6) ----------------
   The brook is a chain, and the chain arithmetic is what every rule here is
   protecting: the spring opens one end, a two-brook-edge tile is net zero, the
   fork is net +1, a lake is net −1. Two lakes therefore close exactly the two
   ends the fork left open — provided no lake is drawn early enough to cap the
   only end there is. That is the whole reason for the holdback. */

function isLakeId(id){ return id === BROOK_LAKE; }
function brookRemaining(){ return G.brook ? G.brook.queue.length + G.brook.held.length : 0; }

/* Draw order: everything but the spring, shuffled, with the fork forced into
   the first four DRAWS. "Draws" and "positions" differ because held lakes cost
   no draw, so the fork is placed against the non-lake ranks. */
function brookInit(){
  const list = [];
  for(const t of BROOK_TILES){
    if(t.id === BROOK_SPRING) continue;
    for(let i=0, n=tileCopies(t); i<n; i++) list.push(t.id);
  }
  const q = RNG.shuffle(list);
  const mids = [];
  for(let i=0;i<q.length;i++) if(!isLakeId(q[i])) mids.push(i);
  let forkRank = -1;
  for(let r=0;r<mids.length;r++) if(q[mids[r]] === BROOK_FORK){ forkRank = r; break; }
  if(forkRank >= BROOK_FORK_BY){
    const src = mids[forkRank], dst = mids[RNG.int(BROOK_FORK_BY)];
    const t = q[src]; q[src] = q[dst]; q[dst] = t;
  }

  /* `stranded` and `leftover` both end up in dead[] but mean opposite things,
     and counting them together is the metric mistake this module invites:
       stranded — the tile had NO legal placement, the brook cornered itself.
                  Only a stranded LAKE actually hurts; a stranded middle is
                  parity-neutral (2 brook edges, net zero) so the two lakes
                  still close the two branches.
       leftover — the brook finished early because converging branches closed
                  an end by confluence, so tiles were simply not needed. Benign.
     Reporting "brook tiles set aside" without splitting these overstates the
     failure rate by roughly an order of magnitude. */
  G.brook = { queue:q, held:[], ends:[], placed:0, relax:false,
              heldEver:0, stranded:0, strandedLakes:0, leftover:0 };

  /* The spring is the board, not a move: auto-placed, unlogged, and its brook
     sides are read off the tile rather than assumed to be south. */
  placeTile(0, 0, BROOK_SPRING, 0);
  stampSeat(0, 0, -1);
  const code = edgeCode(BROOK_SPRING, 0);
  for(let s=0;s<4;s++) if(code[s]==='B') G.brook.ends.push({x:0, y:0, side:s, lastTurn:0});
}

/* The lake holdback, stated once: a lake caps an end for good, so drawing one
   while ordinary brook tiles are still waiting would strand them behind a
   closed brook. Such a lake is set aside and comes back when the ordinary
   tiles — the fork among them, which is why §1.6 phrases this as "after the
   fork" — are spent. This is also what makes the lakes come last without a
   second sorting pass. */
function brookNext(){
  const b = G.brook;
  if(!b) return null;
  while(b.queue.length){
    const id = b.queue.shift();
    if(!isLakeId(id)) return id;
    b.held.push(id); b.heldEver++;
  }
  return b.held.length ? b.held.shift() : null;
}

/* Which way the brook bends: heading in is the side of the PREVIOUS cell we
   left through; heading out is the side of this tile we leave through. */
function turnOf(inHeading, outSide){
  const d = (outSide - inHeading + 4) % 4;
  return d===1 ? 1 : d===3 ? -1 : 0;      // +1 clockwise, -1 anticlockwise, 0 straight
}

/* What placing tileId@rot at (x,y) would do to the brook: which open ends it
   consumes, which new ends it opens, and whether §1.6 allows it. Called both
   to filter legal placements and, once, to commit. */
function brookAnalyze(tileId, rot, x, y, relaxed){
  const b = G.brook;
  if(!b) return {ok:false, why:'not in the brook phase'};
  const code = edgeCode(tileId, rot);
  const entries = [], open = [];
  for(let s=0;s<4;s++){
    if(code[s]!=='B') continue;
    const nx = x+GDX[s], ny = y+GDY[s];
    if(board.has(cellKey(nx,ny))){
      /* An occupied neighbour showing brook back at us can only be an open end:
         a joined brook edge has tiles on both sides, and this cell is empty. */
      let e = null;
      for(const q of b.ends)
        if(q.x+GDX[q.side]===x && q.y+GDY[q.side]===y && (q.side+2)%4===s){ e = q; break; }
      if(!e) return {ok:false, why:'brook edge meets a closed brook'};
      entries.push(e);
    }else open.push(s);
  }
  if(!entries.length) return {ok:false, why:'must extend an open brook end'};

  const from = entries[0];
  const exits = open.map(s=>{
    const t = turnOf(from.side, s);
    return {side:s, turn:t, lastTurn: t!==0 ? t : from.lastTurn};
  });

  /* No U-turn, §1.6: a CURVED brook tile may not bend the way the previous
     curve on this branch bent. A curve is exactly one end in, one end out,
     perpendicular — which is what turn!==0 detects. The fork is deliberately
     exempt: it is not a curved tile, and refusing it for the sake of one of
     its two arms would cost it most of its rotations. A tile that consumes two
     ends at once is a junction, not a branch, and has no single previous curve
     to compare against. */
  if(!relaxed && entries.length===1 && exits.length===1){
    const ex = exits[0];
    if(ex.turn!==0 && ex.turn===from.lastTurn)
      return {ok:false, why:'no two successive bends the same way'};
  }
  return {ok:true, entries, exits};
}

/* End the opening and hand the game to the satchel. Brook tiles still in the
   queue when the last end closes are set aside exactly like dead tiles rather
   than quietly evaporating, so board + satchel + dead stays equal to the tile
   count the game was dealt — the invariant test/ai-match.js asserts. */
function brookClose(){
  const b = G.brook;
  if(b){
    while(b.queue.length){ b.leftover++; dead.push(b.queue.shift()); }
    while(b.held.length){ b.leftover++; dead.push(b.held.shift()); }
    b.relax = false;
  }
  G.mode = 'play';
}

/* Commit the brook bookkeeping for a tile that is already on the board. Ends
   whose target cell just filled are gone whether we consumed them on purpose
   or a converging branch did it for us, so they are filtered by the board
   rather than by the analysis. */
function brookCommit(x, y, info){
  const b = G.brook;
  b.ends = b.ends.filter(e => !board.has(cellKey(e.x+GDX[e.side], e.y+GDY[e.side])));
  for(const ex of info.exits) b.ends.push({x, y, side:ex.side, lastTurn:ex.lastTurn});
  b.placed++;
}

/* ---------------- 7. LEGALITY ----------------
   board.canPlace answers "do the edges match"; this answers "may this seat put
   it there, right now, in this phase, under the loaded packs". */

function placeOk(tileId, rot, x, y, relaxed){
  if(!canPlace(tileId, rot, x, y)) return false;   // edges + the canPlace hook rows
  if(G.mode==='brook' && !brookAnalyze(tileId, rot, x, y, relaxed).ok) return false;
  return true;
}

function legalPlacements(tileId, relaxed){
  if(!depsReady() || tileId==null) return [];
  const out = [];
  for(const c of (legalCells(tileId) || [])){
    const rots = (c.rots||[]).filter(r => placeOk(tileId, r, c.x, c.y, relaxed));
    if(rots.length) out.push({x:c.x, y:c.y, rots});
  }
  return out;
}

/* ---------------- 8. THE TURN LOOP (§1.2) ---------------- */

function beginTurn(){
  if(G.mode!=='brook' && G.mode!=='play') return;
  G.step = 'place'; G.pending = null; G.drawn = null;
  for(const h of Hooks.turnStart) h(G.turnIdx, G);
  setTension(depletion());
  sfx('turn');
  /* Second person for the human, third for everyone else. The third-person
     template alone produced "You is placing…" on every single human turn,
     because the human seat is literally named "You". With more than one human
     on the board — which normalizeConfig supports and the suites use — "your
     turn" cannot say WHOSE, so the name comes back. */
  const seat = G.seats[G.turnIdx];
  const soloHuman = G.seats.filter(s => s.human).length === 1;
  G.banner = !seat ? ''
    : !seat.human ? seat.name + ' is placing…'
    : soloHuman ? 'your turn — lay the tile'
    : seat.name + ' — your turn';
  if(draw() == null){ endGame(); return; }
  if(typeof updateHud==='function') updateHud();
  pumpAI();
}

/* Draw, with the dead-tile rule (§1.2 step 2 ⚑): a tile with no legal
   placement anywhere is removed from the game and a replacement drawn. No
   player choice, so a replay reproduces the discards without logging them. */
function draw(){
  if(G.drawn != null) return G.drawn;
  if(G.mode==='brook'){
    const id = drawBrook();
    if(id != null){ G.drawn = id; sfx('draw'); return id; }
    brookClose();      // the brook is spent — that ends the OPENING, not the game
  }
  while(satchel.length){
    const id = satchel.pop();
    if(legalPlacements(id).length){ G.drawn = id; sfx('draw'); return id; }
    dead.push(id);
  }
  return null;         // satchel empty: now it really is over
}

function drawBrook(){
  const b = G.brook;
  while(brookRemaining()){
    const id = brookNext();
    if(id == null) break;
    b.relax = false;
    if(legalPlacements(id).length) return id;
    /* No-U-turn is a shaping rule, not a geometric one, and a brook that has
       shaped itself into a corner is exactly the strangling the rule exists to
       prevent. Relaxing it for one tile beats dropping that tile, because a
       dropped lake leaves a brook end open for the rest of the game. */
    if(legalPlacements(id, true).length){ b.relax = true; return id; }
    /* Genuinely nowhere to put it: the brook has cornered itself. Only a
       stranded LAKE leaves an end open for the rest of the game — a stranded
       middle is parity-neutral, so the two lakes still close the two ends. */
    b.stranded++;
    if(isLakeId(id)) b.strandedLakes++;
    dead.push(id);
  }
  return null;
}

/* THE input path. Pointer, keys, ai.js and WoolDbg all land here; nothing else
   may put a tile on the board. */
function place(x, y, rot){
  if(G.mode!=='brook' && G.mode!=='play') return false;
  if(G.step!=='place' || G.drawn==null) return false;
  x = x|0; y = y|0; rot = ((rot|0) % 4 + 4) % 4;
  const id = G.drawn;
  const relaxed = !!(G.brook && G.brook.relax);
  if(!placeOk(id, rot, x, y, relaxed)){ sfx('badPlace'); return false; }

  /* The brook analysis has to happen while the cell is still empty. */
  const info = (G.mode==='brook') ? brookAnalyze(id, rot, x, y, relaxed) : null;
  const res = placeTile(x, y, id, rot) || {};
  stampSeat(x, y, G.turnIdx);
  if(info) brookCommit(x, y, info);
  G.moveNo++;
  G.drawn = null;
  G.pending = {x, y, tileId:id, rot, seg:null, completed:res.completed || []};
  G.log.push({t:id, x, y, rot});
  /* No pan argument. Snd's pan-x is CANVAS space 0..960 (CONTRACT.md, audio
     as-built) and this is a board cell — passing it would read as hard-left
     for every tile west of the origin. Centred is right until a call site
     actually holds a screen x, which only ui.js ever does. */
  sfx('place');

  /* Post window opens even on a brook tile (§1.6 allows it) — but a window
     with nothing in it is a dead beat, not a decision, so it closes itself. */
  G.step = 'post';
  if(!postOptions().length) resolveTurn();
  else if(typeof updateHud==='function') updateHud();
  return true;
}

/* Which segments of the tile just placed can take a shepherd. board.canPost is
   the feature-is-unclaimed test; supply is ours. */
function postOptions(){
  const p = G.pending;
  if(!p || G.step!=='post') return [];
  if(!G.seats[G.turnIdx] || supplyOf(G.turnIdx) <= 0) return [];
  const t = tileById(p.tileId);
  if(!t || !t.segs) return [];
  let opts = [];
  for(let i=0;i<t.segs.length;i++){
    if(typeof canPost==='function' ? canPost(p.x, p.y, i) : false) opts.push(i);
  }
  for(const h of Hooks.spots) opts = h(opts, p, G) || opts;
  return opts;
}

function spot(segIdx){
  if(G.step!=='post' || !G.pending) return false;
  segIdx = segIdx|0;
  if(postOptions().indexOf(segIdx) < 0){ sfx('badPlace'); return false; }
  if(!postShepherd(G.pending.x, G.pending.y, segIdx, G.turnIdx)){ sfx('badPlace'); return false; }
  syncSupplies();
  G.pending.seg = segIdx;
  G.log[G.log.length-1].s = segIdx;      // amend this turn's move, don't add one
  sfx('shepherdOn');
  resolveTurn();
  return true;
}

function skip(){
  if(G.step!=='post' || !G.pending) return false;
  sfx('ui');
  resolveTurn();
  return true;
}

/* Step 4: score what this placement finished, hand the shepherds back, save,
   pass the crook. Scoring comes AFTER the post window because a shepherd
   posted onto a feature this tile just completed scores on it. */
function resolveTurn(){
  const p = G.pending;
  G.pending = null;
  G.step = 'idle';
  if(p) scoreCompletions(p.completed);
  for(const h of Hooks.turnEnd) h(G.turnIdx, G);
  autosave();
  if(typeof updateHud==='function') updateHud();
  nextSeat();
}

const DONE_SFX = {fold:'foldDone', lane:'laneDone', shrine:'shrineDone'};

function scoreCompletions(roots){
  for(const root of (roots||[])){
    if(!root) continue;
    const rows = (typeof scoreFeature==='function' ? scoreFeature(root, false) : []) || [];
    for(const r of rows){
      const seat = G.seats[r.seat];
      if(seat) seat.score += (r.pts|0);
      G.recent.unshift({seat:r.seat, pts:r.pts|0, kind:root.type, why:r.why||''});
    }
    if(G.recent.length > RECENT_KEEP) G.recent.length = RECENT_KEEP;
    /* §1.4: everyone on a scored feature goes home, and they go home whether
       or not the feature paid anybody — an unclaimed majority still frees the
       losers' shepherds. board.js moves them; we only mirror the count. */
    const back = (typeof returnShepherds==='function') ? (returnShepherds(root) || []) : [];
    if(back.length){ syncSupplies(); sfx('shepherdBack'); }
    sfx(DONE_SFX[root.type] || 'scoreSmall');
    showScore(root, rows);
    for(const h of Hooks.onComplete) h(root, rows, G);
  }
}

/* The visible half of scoring. render.js owns both queues and loads after this
   file, so they exist by the time any turn runs — but they are still guarded,
   because a suite may load the engine without the renderer. Floater coords are
   board cells, fractional, and `cells` goes to pushFlash verbatim (it accepts
   the Set that rootMeta already carries). */
function showScore(root, rows){
  if(!rows || !rows.length) return;
  if(typeof pushFlash==='function')
    pushFlash(root.cells, G.seats[rows[0].seat] ? G.seats[rows[0].seat].color : null);
  if(typeof pushFloater!=='function') return;
  const at = nwCell(root.cells);
  if(!at) return;
  /* Ties all score full (§1.4), so a tied feature raises one floater per
     holder — fanned sideways rather than stacked, or they overprint. */
  rows.forEach((r,i)=>{
    const seat = G.seats[r.seat];
    pushFloater(at.x + 0.5 + (i - (rows.length-1)/2)*0.6, at.y + 0.4,
                '+' + (r.pts|0), seat ? seat.color : null);
  });
}
/* north-west-most cell of a feature — the same anchor board.js picks for the
   reveal camera, so a floater and its walkthrough step point at one place */
function nwCell(cells){
  if(!cells) return null;
  let best = null;
  for(const ck of cells){
    const comma = ck.indexOf(',');
    const x = +ck.slice(0, comma), y = +ck.slice(comma+1);
    if(!best || y < best.y || (y === best.y && x < best.x)) best = {x, y};
  }
  return best;
}

/* Every shepherd on the board, flattened. board.js keeps posts on the feature
   root, which is the right home for them — a shepherd belongs to a feature,
   not to a tile — but render.js needs the inverted view once per frame, and
   walking the roots per frame is work it should not repeat. */
function shepherdList(){
  const out = [];
  if(typeof featureRoots !== 'function') return out;
  for(const m of featureRoots())
    for(const sh of (m.shepherds || []))
      out.push({seat:sh.seat, x:sh.x, y:sh.y, seg:sh.seg, kind:m.type});
  return out;
}

function nextSeat(){
  /* The brook is over when it runs out of open ends OR out of tiles; the seat
     that would have laid the next brook tile draws from the satchel instead,
     so the rotation never skips a beat. The two conditions close it in
     different places — ends here (tiles may be left over), tiles in draw()
     (an end may be left open) — and both land in brookClose. */
  if(G.mode==='brook' && (!brookRemaining() || !G.brook.ends.length)) brookClose();
  G.turnIdx = (G.turnIdx + 1) % G.seats.length;
  if(G.mode==='play' && !satchel.length){ endGame(); return; }
  beginTurn();
}

/* AI turns, flattened. aiMove() -> place() -> resolveTurn() -> beginTurn() would
   otherwise recurse once per turn for the length of the game; the re-entry
   guard turns that recursion into this loop. ui.js sets G.autoAI=false when it
   wants to animate the AI's move instead, and drives pumpAI itself.

   Silent during a replay, and that is load-bearing rather than an optimisation:
   the log already RECORDS what the AI chose, so letting it choose again would
   both play the turn twice and desync the log from the board — the replay then
   fails on the next entry, having reproduced nothing. A rebuild replays
   decisions; it does not re-take them. */
let inTurnPump = false;
function pumpAI(){
  if(inTurnPump || G.replaying) return;
  inTurnPump = true;
  try{
    while(G.autoAI && (G.mode==='play' || G.mode==='brook') && G.step==='place'){
      const seat = G.seats[G.turnIdx];
      if(!seat || seat.human || typeof aiMove!=='function') break;
      const before = G.moveNo;
      aiMove(G.turnIdx);
      if(G.moveNo === before) break;        // the AI declined to move: don't spin
    }
  }finally{ inTurnPump = false; }
}

/* ---------------- 9. THE END (§1.5) ----------------
   Final points are applied the moment the game ends, so a headless playout is
   final the instant mode leaves 'play'. The reveal is presentation over the
   top of that: `base` is the scoreboard before the walkthrough, so ui.js can
   tick it up step by step without the engine holding points in escrow. */

function holderSeats(step){
  const h = step && step.holders;
  if(!h || !h.length) return [];
  return h.map(v => (typeof v === 'object' && v) ? (v.seat|0) : (v|0));
}

function endGame(){
  if(G.mode==='reveal' || G.mode==='end') return;
  G.drawn = null; G.pending = null; G.step = 'idle';
  const base = G.seats.map(s => s.score);
  const steps = (typeof finalScore==='function' ? finalScore() : []) || [];
  for(const st of steps)
    for(const seatIdx of holderSeats(st)){
      const seat = G.seats[seatIdx];
      if(seat) seat.score += (st.pts|0);
    }
  G.reveal = {base, steps, idx:0};
  G.mode = 'reveal';
  G.banner = 'the counting';
  if(typeof Snd!=='undefined' && Snd && Snd.musicStart) Snd.musicStart('reveal');
  setTension(1);
  /* No autosave here: resolveTurn already wrote the completed log a moment ago,
     and finishReveal clears it. A finished game is not a game to resume. */
  if(typeof updateHud==='function') updateHud();
}

/* The scoreboard as it stood after the first `n` walkthrough steps. */
function revealScoresAt(n){
  const r = G.reveal;
  if(!r) return G.seats.map(s=>s.score);
  const out = r.base.slice();
  for(let i=0;i<Math.min(n, r.steps.length);i++)
    for(const seatIdx of holderSeats(r.steps[i]))
      if(out[seatIdx]!=null) out[seatIdx] += (r.steps[i].pts|0);
  return out;
}
function revealNext(){
  if(G.mode!=='reveal' || !G.reveal) return false;
  if(G.reveal.idx >= G.reveal.steps.length){ finishReveal(); return false; }
  G.reveal.idx++;
  sfx('scoreSmall');
  return true;
}
function revealAll(){ if(G.reveal) G.reveal.idx = G.reveal.steps.length; return G.reveal; }

function finishReveal(){
  if(G.mode!=='reveal') return false;
  G.mode = 'end';
  G.banner = '';
  const best = G.seats.reduce((a,s)=> s.score>a ? s.score : a, -Infinity);
  const humanWon = G.seats.some(s => s.human && s.score===best);
  if(typeof Snd!=='undefined' && Snd && Snd.musicStop) Snd.musicStop();
  sfx(humanWon ? 'win' : 'fail');
  recordStats();
  clearSave();                        // a finished game is not a game to resume
  if(typeof updateHud==='function') updateHud();
  return true;
}

/* Best score per configuration — seats and modules, not seed, because a seed
   is one deal and the interesting record is across deals. */
function configKey(){
  const c = G.config || {};
  const mods = Object.keys(c.modules||{}).filter(k=>c.modules[k]).sort().join('+');
  return (c.seats ? c.seats.length : 0) + 'p:' + (mods || 'base');
}
function recordStats(){
  const you = G.seats.filter(s=>s.human).sort((a,b)=>b.score-a.score)[0];
  if(!you) return;
  const st = lsGet('stats', {}) || {}, k = configKey();
  st[k] = { best: Math.max((st[k] && st[k].best) || 0, you.score),
            games: ((st[k] && st[k].games) || 0) + 1 };
  lsSet('stats', st);
}

/* ---------------- 10. SAVES (§3.2) ----------------
   The engine is deterministic, so the game IS its seed plus its inputs: a log
   of {t,x,y,rot,s?}, one per completed turn, replayed through place()/spot().
   Dead-tile discards and the brook's draw order are not logged because the
   same seed reproduces them exactly — and if it ever stops doing so, the tile
   check in replaySave catches it on the first divergent move instead of
   handing back a quietly wrong board. */

function saveObject(){
  return { v:SAVE_V, seed:G.seed, config:{
             seats: G.seats.map(s=>({name:s.name, human:s.human,
                                     personality:s.personality, difficulty:s.difficulty})),
             modules: Object.assign({}, G.config ? G.config.modules : {}),
           }, log:G.log.slice() };
}
/* Autosave at the TURN boundary, never inside a post window: the log's unit is
   a finished turn, so a save is always a state the replay can land on exactly.
   Quitting mid-window costs you that placement and hands the same tile back. */
function autosave(){
  if(G.replaying) return;
  if(G.mode==='reveal' || G.mode==='end') return;
  lsSet('save', saveObject());
}
function hasSave(){ const s = lsGet('save', null); return !!(s && s.v===SAVE_V && s.log); }
function clearSave(){ lsSet('save', null); }

/* Rebuild a game from a log by replaying it through the real input path. Any
   divergence — a bumped save version, a tile the deal no longer produces, an
   illegal move — aborts and says so rather than half-loading. */
function replaySave(save){
  if(!save || save.v !== SAVE_V || !Array.isArray(save.log)) return false;
  /* Flagged BEFORE the rebuild starts, so a replay that turns out to be
     unloadable cannot overwrite the very save it was reading on its way past
     startGame's opening autosave. */
  G.replaying = true;
  try{
    startGame(Object.assign({}, save.config, {seed:save.seed}));
    if(G.mode==='menu') return false;
    for(const m of save.log){
      if(G.step!=='place') return false;
      if(G.drawn !== m.t) return false;                 // the deal diverged
      if(!place(m.x, m.y, m.rot)) return false;
      if(G.step==='post'){ if(m.s!=null ? !spot(m.s) : !skip()) return false; }
    }
  }finally{ G.replaying = false; }
  autosave();
  if(typeof updateHud==='function') updateHud();
  return true;
}
function resumeGame(){ return replaySave(lsGet('save', null)); }

/* ---------------- 11. ANIMATION CLOCK ----------------
   There is no simulation to advance here — a tile-layer's clock exists only so
   floaters rise and outlines flash at the same rate on every machine. G.tick is
   the beat; G.frac is where we are between beats, for interpolated draws. */
let lastTs = 0, acc = 0;
function frame(ts){
  requestAnimationFrame(frame);
  /* Clamped at BOTH ends. The ceiling is the usual one — a backgrounded tab
     must not come back and run a thousand ticks at once. The floor matters
     just as much and is easier to miss: a frame timestamp behind lastTs (a
     clock that stepped back, or a caller passing its own ts after startLoop
     stamped lastTs from performance.now()) makes dt negative, and a negative
     dt does not merely skip a tick — it drives the accumulator below zero and
     the animation clock never ticks again. */
  const dt = clamp((ts - lastTs)/1000, 0, 0.1); lastTs = ts;
  const stepSec = 1/TPS;
  acc += dt;
  while(acc >= stepSec){ acc -= stepSec; G.tick++; }
  G.frac = clamp(acc/stepSec, 0, 1);
  if(typeof render==='function') render();
  if(typeof updateHud==='function') updateHud();
}
/* self-guarding so ui.js can call it at boot without starting two clocks */
function startLoop(){
  if(startLoop.on) return;
  startLoop.on = 1;
  lastTs = (typeof performance!=='undefined' && performance.now) ? performance.now() : 0;
  requestAnimationFrame(frame);
}

/* ---------------- 12. HARNESS DRIVER ----------------
   runToEnd plays random-legal moves to the final screen. Its dice are NOT
   RNG: RNG is the engine's stream and, after the opening shuffles, the engine
   never touches it again — which is precisely why a replay lands on the same
   stateHash, since stateHash includes RNG.state. A driver drawing from RNG
   would advance that state in the original and not in the replay, and every
   round-trip assertion in test/saveload.js would fail for a reason that has
   nothing to do with saving. So the driver carries its own stream. */
function harnessRand(seed){
  let s = seed|0;
  return function(){
    s = (s + 0x6D2B79F5)|0;
    let t = Math.imul(s ^ (s>>>15), 1|s);
    t = (t + Math.imul(t ^ (t>>>7), 61|t)) ^ t;
    return ((t ^ (t>>>14))>>>0) / 4294967296;
  };
}
function runToEnd(opts){
  opts = opts || {};
  const max = opts.maxSteps || 4000;
  const rnd = opts.rand || harnessRand(opts.seed!=null ? opts.seed : (G.seed ^ 0x5eed1e));
  const postRate = opts.postRate!=null ? opts.postRate : 0.5;
  const useAI = !!opts.ai;
  /* opts.turns stops after N completed turns instead of at the end screen, so
     a screenshot harness can stage a mid-game board with one seeded call
     rather than writing board state by hand. */
  const stopAfter = opts.turns!=null ? (opts.turns|0) : -1;
  const startedAt = G.log.length;
  for(let n=0; n<max; n++){
    /* Only ever stop on a clean turn boundary. The log entry is pushed at
       place() time, so testing the count alone would sometimes hand back a
       game frozen inside its post window — useful by accident, unpredictable
       on purpose. */
    if(stopAfter >= 0 && G.step==='place' && G.log.length - startedAt >= stopAfter) return G.mode;
    if(G.mode==='reveal'){ revealAll(); finishReveal(); return G.mode; }
    if(G.mode==='end' || G.mode==='menu') return G.mode;
    if(G.step==='place'){
      const seat = G.seats[G.turnIdx];
      if(useAI && seat && !seat.human && typeof aiMove==='function'){
        const before = G.moveNo;
        aiMove(G.turnIdx);
        if(G.moveNo===before) return G.mode;
        continue;
      }
      if(G.drawn==null && draw()==null){ endGame(); continue; }
      /* draw() only ever hands back a placeable tile, so an empty candidate
         list is a bug, not a game state. Stall loudly instead of calling it a
         finished game — a suite asserting mode==='end' then fails where the
         fault is, not three modules away. */
      const cands = legalPlacements(G.drawn, !!(G.brook && G.brook.relax));
      if(!cands.length) return G.mode;
      const c = cands[(rnd()*cands.length)|0];
      if(!place(c.x, c.y, c.rots[(rnd()*c.rots.length)|0])) return G.mode;
      continue;
    }
    if(G.step==='post'){
      const o = postOptions();
      if(o.length && rnd() < postRate) spot(o[(rnd()*o.length)|0]);
      else skip();
      continue;
    }
    return G.mode;
  }
  return G.mode;
}

/* ---------------- 13. DEBUG / TEST API ----------------
   ai.js adds aiMove and ui.js augments this with the pointer-path hooks its
   suites need; neither moves nor replaces it, because every method below is
   the real input path and not a shortcut around it. */
window.WoolDbg = {
  seed(n){ RNG.seed(n|0); G.seed = n|0; },
  get state(){ return G; },
  board: ()=> (typeof board!=='undefined' ? board : null),
  scores: ()=> G.seats.map(s=>s.score),
  seats: ()=> G.seats,
  satchel: ()=> satchel.length,
  draw, place, spot, skip,
  legal: (tileId)=> legalPlacements(tileId!=null ? tileId : G.drawn,
                                    !!(G.brook && G.brook.relax)),
  featureAt: (x,y,segIdx)=> (typeof featureAt==='function' ? featureAt(x,y,segIdx) : null),
  runToEnd,
  startGame,
  stateHash: ()=> (typeof stateHash==='function' ? stateHash() : null),
  TILES: ()=> (typeof TILES!=='undefined' ? TILES : null),
};
