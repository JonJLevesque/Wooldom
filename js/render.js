'use strict';
/* ==================================================================
   WOOLDOM — js/render.js : everything drawn on a canvas

   Owns #cv (the board) and #trayCv (the tile in hand). Reads G and the board
   map, never writes to either. Every field it reads is optional and guarded,
   so this file renders whatever exists at the time and never throws — the
   headless suites load it against a noop-canvas with no game running at all.

   The frame loop only blits: tile art comes pre-painted from art.js, shepherds
   and emblems come from its sprite cache. Nothing here touches a pixel buffer.
   ================================================================== */

function P(c,x,y,w,h){ c.fillRect(x|0,y|0,w||1,h||1); }

/* CALM MODE — ui.js owns the setting and the OS reduced-motion preference.
   Everything that pulses, flashes or shakes reads this and holds still. */
function calm(){
  return typeof G!=='undefined' && !!G && (!!G.calm || !!G.fxCalm);
}
/* 1 on the tick something happened, easing to 0 over `span`, and 0 whenever the
   stamp is idle or stale from a game we have already left (G.tick restarts) */
function fxAge(stamp,tick,span){
  if(typeof stamp!=='number') return 0;
  const k=tick-stamp;
  return (k>=0 && k<span) ? 1-k/span : 0;
}
function gTick(){ return (typeof G!=='undefined' && G && typeof G.tick==='number') ? G.tick : rTick; }
/* "Get on with it." Anything that makes the player WAIT reads this; anything
   that is merely decoration does not, so a collapsed animation still leaves the
   board looking like itself.
   G.skipFx is the union ui.js publishes of all three ways to ask — F held, the
   persisted SKIP AI ANIMATION setting, and a tap on the board to hurry the turn
   along. Reading G.fast alone (which is only the F key) would mean a player who
   turned the SETTING on got ui.js's waits shortened while these eases played on
   at full length over the top: a setting that visibly fails to do what it says.
   Read as a UNION rather than "skipFx when present, else fast": either flag
   asking for the collapse is enough, so a frame in which the key is already
   down but the published union has not caught up cannot un-collapse an
   animation, and a ui that never publishes skipFx still works off G.fast. */
function rushed(){
  if(typeof G==='undefined' || !G) return false;
  return !!G.fast || !!G.skipFx;
}

/* Every animation in this file is paced in render frames, the same unit
   FLOAT_LIFE and FLASH_LIFE already use — a screenshot driver can then step an
   animation to an exact frame by calling render() n times. The comments quote
   milliseconds at 60fps. (A driver must stop the page's own rAF loop before
   posing a mid-animation frame: this Chrome DOES service rAF, contrary to the
   note in CONTRACT.md, so ui.js's loop otherwise renders between a driver's
   timer callbacks.) */
function rnEaseOut(t){ return 1-(1-t)*(1-t); }
function rnEaseIO(t){ return t<0.5 ? 2*t*t : 1-2*(1-t)*(1-t); }
/* 0..1 progress through a span that started at `at`, or -1 when it is over.
   A stamp from a previous game (rTick only ever climbs) simply reads as over. */
function rnPhase(at, span){
  if(at<0) return -1;
  const t=(rTick-at)/span;
  return (t>=0 && t<1) ? t : -1;
}

/* ---- tiny 3x5 bitmap font (row bitmasks: col0=4, col1=2, col2=1) ---- */
const FONT={
  'A':[7,5,7,5,5],'B':[6,5,6,5,6],'C':[7,4,4,4,7],'D':[6,5,5,5,6],'E':[7,4,6,4,7],
  'F':[7,4,6,4,4],'G':[7,4,5,5,7],'H':[5,5,7,5,5],'I':[7,2,2,2,7],'J':[1,1,1,5,7],
  'K':[5,6,4,6,5],'L':[4,4,4,4,7],'M':[5,7,7,5,5],'N':[5,7,7,7,5],'O':[7,5,5,5,7],
  'P':[7,5,7,4,4],'Q':[7,5,5,7,1],'R':[7,5,7,6,5],'S':[3,4,2,1,6],'T':[7,2,2,2,2],
  'U':[5,5,5,5,7],'V':[5,5,5,5,2],'W':[5,5,7,7,5],'X':[5,5,2,5,5],'Y':[5,5,2,2,2],
  'Z':[7,1,2,4,7],
  // O is boxy, zero is a narrow oval; S has cut corners, five is squared off —
  // at 3x5 those are the only readings that survive 0/O and 5/S side by side
  '0':[2,5,5,5,2],'1':[2,6,2,2,7],'2':[7,1,7,4,7],'3':[7,1,7,1,7],'4':[5,5,7,1,1],
  '5':[7,4,7,1,7],'6':[7,4,7,5,7],'7':[7,1,2,2,2],'8':[7,5,7,5,7],'9':[7,5,7,1,7],
  ' ':[0,0,0,0,0],'!':[2,2,2,0,2],'.':[0,0,0,0,2],':':[0,2,0,2,0],'\'':[2,2,0,0,0],
  '/':[1,1,2,4,4],'%':[5,1,2,4,5],'+':[0,2,7,2,0],'?':[7,1,2,0,2],'-':[0,0,7,0,0],
  // an ellipsis is three dots: the inherited [.,.,.,.,5] lit columns 0 and 2 and
  // rendered every "placing…" in the game as "placing.."
  '…':[0,0,0,0,7],'>':[4,6,7,6,4],'<':[1,3,7,3,1],'×':[0,5,2,5,0],'°':[2,5,2,0,0],
  '$':[3,6,7,3,6],',':[0,0,0,2,4],'(':[1,2,2,2,1],')':[4,2,2,2,4],'=':[0,7,0,7,0],
  // board.js writes its score lines with a middle dot ("Lane · 5 tiles × 1 = 6");
  // without a glyph every reveal caption printed a hole where the separator goes
  '·':[0,0,2,0,0],
};
function drawGlyph(c,ch,x,y){                    // uses current fillStyle
  const g=FONT[ch]; if(!g) return;
  for(let r=0;r<5;r++){ const b=g[r]; if(!b)continue;
    if(b&4)P(c,x,y+r); if(b&2)P(c,x+1,y+r); if(b&1)P(c,x+2,y+r); }
}
// centred on x; y is the top row. Optional 1px orthogonal outline for legibility.
function drawPixelText(c,str,x,y,col,outlineCol){
  str=String(str).toUpperCase();
  const gw=4, tw=str.length*gw-1;
  const sx=Math.round(x-tw/2), sy=Math.round(y);
  if(outlineCol){
    c.fillStyle=outlineCol;
    for(const[ox,oy] of [[-1,0],[1,0],[0,-1],[0,1]]){
      let cx=sx+ox; for(const ch of str){ drawGlyph(c,ch,cx,sy+oy); cx+=gw; }
    }
  }
  c.fillStyle=col; let cx=sx;
  for(const ch of str){ drawGlyph(c,ch,cx,sy); cx+=gw; }
}
function textW(str){ return String(str).length*4-1; }

const RN_INK='#14180f', RN_FELT='#23301f', RN_EDGE='#1a2317';

function rnShade(hex,k){
  const h=String(hex).replace('#','');
  const f=i=>{ const v=Math.round(parseInt(h.substr(i,2),16)*k); return ('0'+clamp(v,0,255).toString(16)).slice(-2); };
  return '#'+f(0)+f(2)+f(4);
}

/* ---------------- CANVASES ---------------- */
let rnCvEl=null, rnCtx=null, rnTrayEl=null, rnTrayCtx=null;
function rnBoard(){
  const e = (typeof el==='function') ? el('cv') : null;
  if(e && e!==rnCvEl){ rnCvEl=e; rnCtx = e.getContext ? e.getContext('2d') : null; }
  return rnCvEl;
}
function rnTray(){
  const e = (typeof el==='function') ? el('trayCv') : null;
  if(e && e!==rnTrayEl){ rnTrayEl=e; rnTrayCtx = e.getContext ? e.getContext('2d') : null; }
  return rnTrayEl;
}

/* ---------------- VIEW GEOMETRY ----------------
   G.view.cx / cy are BOARD CELL COORDS (fractional) of the point at the centre
   of the canvas; zoom is one of ZOOMS. The origin is rounded ONCE and every
   cell is placed off it, so tiles never open a 1px seam between them at any
   zoom. ui.js hit-tests through these same three functions, which is the only
   way pan/zoom and drawing can be guaranteed to agree. */
function rnGeom(){
  const cv=rnBoard();
  const W=(cv && cv.width|0)||0, H=(cv && cv.height|0)||0;
  const v=(typeof G!=='undefined' && G && G.view) || {};
  const z=(typeof ZOOMS!=='undefined' && ZOOMS.indexOf(v.zoom)>=0) ? v.zoom : 1;
  const S=(typeof TILE!=='undefined'?TILE:64)*z;
  const cx=+v.cx||0, cy=+v.cy||0;
  return { W, H, S, z, cx, cy, ox:Math.round(W/2-cx*S), oy:Math.round(H/2-cy*S) };
}
function worldToScreen(x,y){ const g=rnGeom(); return { sx:g.ox+x*g.S, sy:g.oy+y*g.S, s:g.S }; }
function screenToCellF(px,py){ const g=rnGeom(); return { x:(px-g.ox)/g.S, y:(py-g.oy)/g.S }; }
function screenToCell(px,py){ const p=screenToCellF(px,py); return { x:Math.floor(p.x), y:Math.floor(p.y) }; }

/* ================= THE PRESENTATION CAMERA ====================
   rnGeom() above is the TRUE geometry and stays that way: ui.js hit-tests
   through it, so the cell a click lands on is always the cell the settled
   board says it is. Everything here is a display-only rider on top of it —
   the scale tween between zoom steps, and the reveal's walk from feature to
   feature — handed to the world layers as a SECOND geometry object. Nothing
   below ever writes G.view: a camera that moved the real view would fight
   ui.js's own pan clamp and would mean a click during a 150ms tween landed on
   a cell the player cannot see yet. */
const RN_ZOOM_SPAN = 9;         // ~150ms: long enough to read as a move, short
                                // enough that the board is never in the way
const RN_PAN_SPAN  = 24;        // ~400ms, the reveal's step-to-step walk
const RN_CAP_BAND  = 78;        // px at the bottom of the board the reveal
                                // caption owns; the camera aims above it

let rnPrevG=null, rnZoomFrom=null, rnZoomAt=-1;
let rnPan={x:0,y:0}, rnPanFrom={x:0,y:0}, rnPanAt=-1, rnPanKey='', rnPanHeld=false;
let rnPanPrevG=null;

/* the zoom tween, as the geometry we should be drawing with THIS frame.
   Snapshotting the whole origin (not just the scale) is what keeps the point
   the player zoomed at pinned: ui.js has already moved cx/cy to anchor it, so
   interpolating from the old origin to the new one replays exactly the view
   they were looking at, wherever they pointed. */
function rnZoomTween(g){
  if(rnPrevG && rnPrevG.S!==g.S && rnPrevG.W===g.W && rnPrevG.H===g.H){
    // a resize changes W/H and every origin with it — that is not a zoom step.
    // Calm holds still, and the post window must not disagree with its discs.
    const post=(typeof G!=='undefined' && G && G.post);
    if(!calm() && !rushed() && !post){ rnZoomFrom=rnPrevG; rnZoomAt=rTick; }
    else { rnZoomAt=-1; rnZoomFrom=null; }
  }
  rnPrevG=g;
  const t=rnPhase(rnZoomAt, RN_ZOOM_SPAN);
  if(t<0 || !rnZoomFrom){ rnZoomAt=-1; return null; }
  const u=1-rnEaseIO(t), f=rnZoomFrom;
  return { S:g.S+(f.S-g.S)*u, ox:g.ox+(f.ox-g.ox)*u, oy:g.oy+(f.oy-g.oy)*u };
}
/* where the reveal camera wants the spotlit feature: centred in the board area
   ABOVE the caption band, which is the whole reason the caption stopped landing
   on top of the thing it is describing */
function rnPanTarget(g, st){
  const cs=rnCells(st && st.cells);
  if(!cs.length) return null;
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for(const [x,y] of cs){
    if(x<x0)x0=x; if(x>x1)x1=x;
    if(y<y0)y0=y; if(y>y1)y1=y;
  }
  const wx=(x0+x1+1)/2, wy=(y0+y1+1)/2;
  return { x: g.W/2-(g.ox+wx*g.S), y: (g.H-RN_CAP_BAND)/2-(g.oy+wy*g.S) };
}
function rnRevealPan(g){
  const inReveal = typeof G!=='undefined' && G && G.mode==='reveal' && G.reveal;
  if(!inReveal){
    rnPan={x:0,y:0}; rnPanKey=''; rnPanAt=-1; rnPanHeld=false; rnPanPrevG=null;
    return null;
  }
  /* Its OWN snapshot of the previous frame's true geometry, not rnPrevG: the
     zoom tween is evaluated first each frame and has already advanced that one
     to the current geometry by the time we get here, so comparing against it
     would find them equal every time and never notice a pan at all. Null on the
     first reveal frame, so arriving from a moving play-phase camera is not
     mistaken for the player nudging the walkthrough. */
  const prev=rnPanPrevG;
  rnPanPrevG={ W:g.W, H:g.H, ox:g.ox, oy:g.oy, S:g.S };
  const st=rnRevealStep();
  const to=st ? rnPanTarget(g, st) : null;
  if(!to){ return (rnPan.x||rnPan.y) ? rnPan : null; }
  const key=String(G.reveal.idx|0)+'|'+(st.key||st.kind||'');
  if(key!==rnPanKey){ rnPanKey=key; rnPanFrom={x:rnPan.x, y:rnPan.y}; rnPanAt=rTick; rnPanHeld=false; }
  /* A player moving the camera themselves outranks the walkthrough camera: give
     up the walk for this step rather than tug against them. The next step starts
     easing again from wherever they left it.
     Detected rather than declared, and that is the point — ui.js pans on arrow
     keys and zooms on the wheel and on pinch during the reveal too, not only on
     a drag, so testing G.dragging alone would have left the camera hauling the
     feature back to centre against every one of those. This file never writes
     G.view, so ANY change in the TRUE geometry during the reveal is the user;
     our own offset rides on top of it and cannot feed back into this test.
     A resize moves the origin without anybody having panned, so W/H gates it. */
  if(prev && prev.W===g.W && prev.H===g.H &&
     (prev.ox!==g.ox || prev.oy!==g.oy || prev.S!==g.S)) rnPanHeld=true;
  if(G.dragging) rnPanHeld=true;
  if(rnPanHeld) return (rnPan.x||rnPan.y) ? rnPan : null;
  if(calm() || rushed()){ rnPan={x:to.x, y:to.y}; rnPanAt=-1; return rnPan; }
  const t=rnPhase(rnPanAt, RN_PAN_SPAN);
  if(t<0){ rnPan={x:to.x, y:to.y}; return rnPan; }
  const e=rnEaseIO(t);
  rnPan={ x:rnPanFrom.x+(to.x-rnPanFrom.x)*e, y:rnPanFrom.y+(to.y-rnPanFrom.y)*e };
  return rnPan;
}
/* the geometry the world layers draw with: the true one unless a tween or the
   reveal camera is riding on it. `zt` carries the TRUE zoom through, so a
   sprite that swaps art at a zoom threshold swaps once, at the step, instead of
   part-way through the tween. */
function rnDisplay(g, tw, pan){
  if(!tw && !pan){ g.zt=g.z; return g; }
  const S=tw?tw.S:g.S;
  return { W:g.W, H:g.H, S, z:S/((typeof TILE!=='undefined'?TILE:64)), zt:g.z,
           cx:g.cx, cy:g.cy,
           ox:(tw?tw.ox:g.ox)+(pan?pan.x:0), oy:(tw?tw.oy:g.oy)+(pan?pan.y:0) };
}

/* ---------------- GAME STATE READERS ---------------- */
function rnBoardMap(){
  if(typeof board!=='undefined' && board && typeof board.forEach==='function') return board;
  if(typeof G!=='undefined' && G && G.board && typeof G.board.forEach==='function') return G.board;
  if(typeof WoolDbg!=='undefined' && WoolDbg && typeof WoolDbg.board==='function'){
    try{ const b=WoolDbg.board(); if(b && typeof b.forEach==='function') return b; }catch(e){}
  }
  return null;
}
function rnTileOf(id){
  if(typeof tileById==='function'){ try{ const t=tileById(id); if(t) return t; }catch(e){} }
  if(typeof TILES!=='undefined' && Array.isArray(TILES)){ for(const t of TILES) if(t&&t.id===id) return t; }
  if(typeof BROOK_TILES!=='undefined' && Array.isArray(BROOK_TILES)){ for(const t of BROOK_TILES) if(t&&t.id===id) return t; }
  return null;
}
function rnSeat(i){
  const s=(typeof G!=='undefined' && G && G.seats) ? G.seats[i] : null;
  return s || {name:'SEAT '+((i|0)+1), color:PAL['p'+(((i|0)%5)+1)]};
}
function rnSeatCol(i){ const s=rnSeat(i); return s.color || PAL.p1; }
/* board cell key -> [x,y]; accepts a Set of 'x,y' keys (rootMeta.cells
   verbatim), an array of pairs, or an array of {x,y} */
function rnCells(cells){
  const out=[];
  if(!cells || typeof cells.forEach!=='function') return out;
  cells.forEach(v=>{
    if(v==null) return;
    if(typeof v==='string'){ const p=v.split(','); out.push([+p[0],+p[1]]); }
    else if(Array.isArray(v)) out.push([+v[0],+v[1]]);
    else if(typeof v==='object' && 'x' in v) out.push([+v.x,+v.y]);
  });
  return out;
}
/* every shepherd on the board, flattened. game.js may expose this three ways;
   whichever it picked, render only ever reads. */
/* memoised for the frame: the diff pass and the drawing pass both want it, and
   the fallbacks below walk every feature root to build it */
let rnShepMemo={tick:-1, val:[]};
function rnShepherds(){
  if(rnShepMemo.tick===rTick) return rnShepMemo.val;
  const v=rnShepherdsRaw();
  rnShepMemo={tick:rTick, val:Array.isArray(v)?v:[]};
  return rnShepMemo.val;
}
function rnShepherdsRaw(){
  if(typeof shepherdList==='function'){ try{ const l=shepherdList(); if(Array.isArray(l)) return l; }catch(e){} }
  if(typeof G!=='undefined' && G && Array.isArray(G.posts)) return G.posts;
  // board.js keeps posts on the feature root, which is the right home for them
  // (a shepherd belongs to a feature, not a tile). Walking the roots is a few
  // hundred path-compressed lookups — cheaper than the mirror it would replace.
  if(typeof featureRoots==='function'){
    try{
      const out=[];
      for(const m of featureRoots()) if(m && m.shepherds) for(const s of m.shepherds) out.push(s);
      return out;
    }catch(e){}
  }
  const bm=rnBoardMap();
  if(!bm) return [];
  const out=[];
  bm.forEach((e,k)=>{
    if(!e || !e.post) return;
    const p=k.split(',');
    out.push({ seat:e.post.seat, seg:e.post.seg, x:+p[0], y:+p[1] });
  });
  return out;
}
/* legal cells for the tile in hand. Staged on G by whoever computed it; if it
   isn't, fall back to board.js but memoise — legalCells sweeps the frontier and
   has no business running 60 times a second. */
let rnLegalMemo={key:'', val:[]};
function rnLegal(){
  if(typeof G==='undefined' || !G) return [];
  if(Array.isArray(G.legal)) return G.legal;
  if(!G.drawn || typeof legalCells!=='function') return [];
  const bm=rnBoardMap();
  const key=G.drawn+'|'+(bm?bm.size:0);
  if(rnLegalMemo.key!==key){
    rnLegalMemo.key=key;
    try{ rnLegalMemo.val=legalCells(G.drawn)||[]; }catch(e){ rnLegalMemo.val=[]; }
  }
  return rnLegalMemo.val;
}

/* ================= FEEDBACK QUEUES ==================================
   render.js owns these; game.js and ui.js push into them. Cosmetic only, so
   they are stepped on the render tick and a dropped frame can never perturb a
   playout. */
let rTick=0;
const rnFloaters=[], rnFlashes=[];
const FLOAT_LIFE=70, FLASH_LIFE=54, FLOAT_CAP=48, FLASH_CAP=12;

/* x,y are BOARD CELL COORDS, fractional — the centre of cell (cx,cy) is
   (cx+0.5, cy+0.5). The floater rises about 30px over its life. */
function pushFloater(x,y,text,color){
  /* the sideways drift of the arc, deterministic from the floater itself: a
     tied feature raises one +N per holder from adjacent points, and drawing
     them from Math.random would let two land on the same path */
  const dx=(typeof hash==='function' ? hash((x*7)|0, (y*11)|0) : 0.5)-0.5;
  rnFloaters.push({ x:+x||0, y:+y||0, dx:dx*1.6, text:String(text),
                    col:color||PAL.gold, born:rTick });
  while(rnFloaters.length>FLOAT_CAP) rnFloaters.shift();
}
function pushFlash(cells,color){
  const cs=rnCells(cells);
  if(!cs.length) return;
  rnFlashes.push({ cells:cs, col:color||PAL.gold, born:rTick });
  while(rnFlashes.length>FLASH_CAP) rnFlashes.shift();
}
function rnReap(){
  for(let i=rnFloaters.length-1;i>=0;i--) if(rTick-rnFloaters[i].born>FLOAT_LIFE) rnFloaters.splice(i,1);
  for(let i=rnFlashes.length-1;i>=0;i--)  if(rTick-rnFlashes[i].born>FLASH_LIFE) rnFlashes.splice(i,1);
  for(let i=rnPuffs.length-1;i>=0;i--)    if(rTick-rnPuffs[i].born>PUFF_LIFE) rnPuffs.splice(i,1);
  for(const k of rnDrops.keys()) if(rTick-rnDrops.get(k)>DROP_LIFE) rnDrops.delete(k);
}

/* ================= ANIMATIONS NOBODY HAS TO ANNOUNCE =============
   A tile lands, a shepherd is posted, a shepherd walks home off a feature that
   just scored: three things worth animating, and all three are already visible
   as a difference between this frame's state and last frame's. Deriving them
   from that difference rather than from a call means game.js and ui.js gained
   no new obligations — and, more usefully, that they animate identically
   whoever caused them, engine or player or AI.

   The guard on all three is bulk change. A resume rebuilds the whole board and
   every shepherd on it in one frame; that is not eighty placements and it must
   not look like eighty placements, so a diff bigger than one step is taken as
   a rebuild and animates nothing. */
const PUFF_LIFE=26, DROP_LIFE=15, BOUNCE_LIFE=13, PUFF_CAP=8;
const rnPuffs=[];                 // wool left behind by a shepherd going home
const rnDrops=new Map();          // shepherd key -> tick it was posted
let rnSeenCells=null, rnSeenSheps=null;
let rnBounce=null;                // {x,y,at} the tile that just landed

function rnShepKey(s){ return s.seat+'@'+s.x+','+s.y+'#'+(s.seg|0); }
let rnSeenMode='';
function rnDiffState(){
  const bm=rnBoardMap();
  const menu=(typeof G==='undefined' || !G || G.mode==='menu');
  /* The play-phase feedback is deliberately NOT cleared when the walkthrough
     begins; it is left to expire on its own lifetime.
     It used to be, on the strength of a screenshot showing half a dozen +N's
     littering the first reveal step. That screenshot was a harness artifact, not
     the game: a floater is stamped with rTick, and the driver that produced it
     played every turn of the game without calling render() once, so every
     floater ever pushed shared a single birth tick and they all surfaced
     together at the end. Under real pacing a turn is about sixty render frames
     and FLOAT_LIFE is seventy, so the only feedback still alive when the game
     ends is the feedback for the move that ended it — and endGame runs
     synchronously inside that very placement, so a feature completing on the
     last turn is at age zero right here. Clearing threw away the last
     celebration of the game to solve a problem that only the harness had. */
  const mode=(typeof G!=='undefined' && G) ? String(G.mode||'') : '';
  if(mode!==rnSeenMode) rnSeenMode=mode;
  /* A new game (or the menu) resets the baseline silently: the board going from
     eighty tiles to none is not seventy-nine events. */
  if(menu || !bm){ rnSeenCells=null; rnSeenSheps=null; rnBounce=null; rnPuffs.length=0; rnDrops.clear(); return; }

  const cells=new Set();
  bm.forEach((e,k)=>{ if(e && e.tileId) cells.add(k); });
  if(rnSeenCells && cells.size===rnSeenCells.size+1 && !calm()){
    for(const k of cells) if(!rnSeenCells.has(k)){
      const p=k.split(',');
      rnBounce={ x:+p[0], y:+p[1], at:rTick };
      break;
    }
  }
  rnSeenCells=cells;

  const list=rnShepherds();
  const now=new Map();
  for(const s of list) if(s && typeof s.x==='number') now.set(rnShepKey(s), s);
  if(rnSeenSheps){
    let added=0, gone=0;
    for(const k of now.keys()) if(!rnSeenSheps.has(k)) added++;
    for(const k of rnSeenSheps.keys()) if(!now.has(k)) gone++;
    // one post per turn; a feature can send several shepherds home at once, so
    // the going-home side is allowed a whole feature's worth and no more
    if(added===1 && !calm()) for(const k of now.keys()) if(!rnSeenSheps.has(k)) rnDrops.set(k, rTick);
    if(gone>0 && gone<=5 && !calm()) for(const [k,s] of rnSeenSheps) if(!now.has(k)) rnPuff(s);
  }
  rnSeenSheps=now;
}
/* the wool a shepherd leaves where it stood. Board cell coords, so it stays
   put under a pan and rides the zoom with everything else. */
function rnPuff(s){
  if(rnPuffs.length>=PUFF_CAP) return;
  const spot=rnShepSpot(s);
  rnPuffs.push({ x:s.x+(spot[0]+0.5)/TILE, y:s.y+(spot[1]+0.5)/TILE, born:rTick });
}
/* the tile-local pixel a shepherd stands on, turned with its tile. Shared by
   the drawing pass and the wool puff so the wool is left exactly where the
   shepherd was, not merely on the same tile. */
function rnShepSpot(s){
  const bm=rnBoardMap();
  const e=bm ? bm.get(cellKey(s.x,s.y)) : null;
  const tile=e ? rnTileOf(e.tileId) : null;
  const seg=(tile && tile.segs) ? tile.segs[s.seg|0] : null;
  const spot=(seg && seg.spot) ? seg.spot : [32,32];
  const p=(typeof artRotSpot==='function') ? artRotSpot(spot[0], spot[1], e?e.rot|0:0) : spot;
  return [p[0], p[1], seg];
}

/* Is a celebration still on the screen? ui.js paces the AI's turn and asked for
   this so its post-move settle can wait for a completion to finish being shown
   instead of cutting it off with the next seat's tile. It answers only for the
   feedback this file owns, and it always goes false on its own — the queues are
   reaped on a fixed lifetime, so a caller gating on it can never hang. Callers
   should still cap what they will wait: on a turn that scored nothing this is
   false immediately, and on one that scored it is the ~1s the flash lives. */
function rnBusy(){
  if(rnFlashes.length || rnFloaters.length || rnPuffs.length) return true;
  if(rnBounce && rnPhase(rnBounce.at, BOUNCE_LIFE)>=0) return true;
  for(const at of rnDrops.values()) if(rnPhase(at, DROP_LIFE)>=0) return true;
  return false;
}

/* ---- the turn banner: keyed to the turn counter, not to the mode, so an AI
   that takes its whole turn between two frames still gets announced ---- */
let rnBannerAt=-1, rnBannerTxt='', rnBannerCol=PAL.ui, rnBannerSeen=-1;
const RN_BANNER_SPAN=96;
function pushBanner(text,color){ rnBannerAt=rTick; rnBannerTxt=String(text); rnBannerCol=color||PAL.ui; }
/* game.js rewrites G.banner every time the turn changes hands, so the string
   itself is the edge to trigger on — an AI that takes its whole turn between
   two frames still gets announced. */
function rnPollBanner(){
  if(typeof G==='undefined' || !G) return;
  if(G.mode==='menu' || G.mode==='end'){ rnBannerSeen=-1; rnBannerAt=-1; return; }
  const n = (typeof G.banner==='string' && G.banner) ? G.banner
          : (typeof G.turnCount==='number' ? 'T'+G.turnCount : 'S'+G.turnIdx);
  if(n===rnBannerSeen || n===undefined) return;
  const first = rnBannerSeen===-1;
  rnBannerSeen=n;
  if(first && G.mode==='menu') return;
  const s=rnSeat(G.turnIdx|0);
  pushBanner((typeof G.banner==='string' && G.banner) ? G.banner : ((s.name||'')+"'S TURN"),
             s.color||PAL.ui);
}

/* ================= BOARD ===================================== */
/* the tile that just landed settles rather than appearing: a small overshoot
   damped out over a fifth of a second, scaled about the tile's own centre so it
   never disturbs its neighbours */
function rnBounceK(){
  if(!rnBounce) return 1;
  const t=rnPhase(rnBounce.at, BOUNCE_LIFE);
  if(t<0){ rnBounce=null; return 1; }
  const e=1-t;
  return 1 + 0.13*e*e*Math.cos(t*9.0);
}
function rnDrawBoard(c,g){
  const bm=rnBoardMap();
  if(!bm || typeof paintTile!=='function') return;
  const pad=g.S;
  const bk=rnBounceK(), bx=rnBounce?rnBounce.x:NaN, by=rnBounce?rnBounce.y:NaN;
  bm.forEach((e,k)=>{
    if(!e || !e.tileId) return;
    const p=k.split(','), x=+p[0], y=+p[1];
    const sx=g.ox+x*g.S, sy=g.oy+y*g.S;
    if(sx>g.W+pad || sy>g.H+pad || sx+g.S<-pad || sy+g.S<-pad) return;
    const art=paintTile(e.tileId, e.rot|0);
    if(!art) return;
    if(bk!==1 && x===bx && y===by){
      const d=g.S*(bk-1)/2;
      c.drawImage(art, sx-d, sy-d, g.S*bk, g.S*bk);
    } else {
      c.drawImage(art, sx, sy, g.S, g.S);
    }
  });
}
/* the table: baize, anchored to the board so it pans with the tiles rather than
   sliding underneath them */
let rnFeltPat=null, rnFeltSrc=null;
function rnFillFelt(c,g){
  if(typeof artFelt==='function'){
    const cv=artFelt();
    if(cv && (cv!==rnFeltSrc || !rnFeltPat)){
      rnFeltSrc=cv;
      try{ rnFeltPat=c.createPattern(cv,'repeat'); }catch(e){ rnFeltPat=null; }
    }
    if(rnFeltPat){
      c.save();
      c.translate(g.ox%64, g.oy%64);
      c.fillStyle=rnFeltPat;
      c.fillRect(-64,-64,g.W+128,g.H+128);
      c.restore();
      return;
    }
  }
  c.fillStyle=RN_FELT;
  c.fillRect(0,0,g.W,g.H);
}
/* the unbuilt board: a faint lattice so an empty frontier still reads as a grid
   you can aim at, drawn only where tiles could actually go */
function rnDrawLattice(c,g){
  if(g.S<24) return;
  const x0=Math.floor((0-g.ox)/g.S)-1, x1=Math.ceil((g.W-g.ox)/g.S)+1;
  const y0=Math.floor((0-g.oy)/g.S)-1, y1=Math.ceil((g.H-g.oy)/g.S)+1;
  if((x1-x0)*(y1-y0)>1600) return;
  c.fillStyle='rgba(242,234,217,.10)';
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) P(c, g.ox+x*g.S, g.oy+y*g.S, 2, 2);
}
/* one soft outline per legal cell, breathing on the logic tick */
function rnDrawLegal(c,g){
  if(typeof G==='undefined' || !G || G.mode==='menu' || G.mode==='reveal' || G.mode==='end') return;
  if(G.post) return;                      // the post window owns the screen
  const list=rnLegal();
  if(!list.length) return;
  const t=gTick();
  // hold the pulse still while the board is being dragged: a pan is already
  // motion, and thirty cells breathing under a moving finger is just noise
  const k = (calm()||G.dragging) ? 0.42 : 0.34+0.30*(0.5+0.5*Math.sin(t/9));
  const rot=(typeof G.legalRot==='number')?G.legalRot:null;
  c.lineWidth=Math.max(2, Math.round(g.S/22));
  for(const cell of list){
    if(!cell) continue;
    if(rot!==null && Array.isArray(cell.rots) && cell.rots.indexOf(rot)<0) continue;
    const sx=g.ox+cell.x*g.S, sy=g.oy+cell.y*g.S;
    if(sx>g.W || sy>g.H || sx+g.S<0 || sy+g.S<0) continue;
    c.fillStyle='rgba(255,216,107,'+(k*0.13).toFixed(3)+')';
    c.fillRect(sx+2, sy+2, g.S-4, g.S-4);
    c.strokeStyle='rgba(255,216,107,'+k.toFixed(3)+')';
    c.strokeRect(sx+2.5, sy+2.5, g.S-5, g.S-5);
  }
  /* the Tab cursor gets corner brackets rather than a fourth shade of outline —
     keyboard focus has to be findable among thirty pulsing cells at a glance */
  const tc=G.tabCell;
  if(tc && typeof tc.x==='number'){
    const sx=g.ox+tc.x*g.S, sy=g.oy+tc.y*g.S, L=Math.max(6, Math.round(g.S/4));
    c.strokeStyle=PAL.ui; c.lineWidth=Math.max(2, Math.round(g.S/20));
    c.beginPath();
    for(const [ax,ay,dx,dy] of [[0,0,1,1],[1,0,-1,1],[0,1,1,-1],[1,1,-1,-1]]){
      const px=sx+ax*g.S, py=sy+ay*g.S;
      c.moveTo(px+dx*L, py); c.lineTo(px, py); c.lineTo(px, py+dy*L);
    }
    c.stroke();
  }
}
/* the cell the pointer is over when there is no tile to show there — during the
   AI's turn, the follower window, an empty satchel. ui.js sets G.hover; if it
   does not, nothing is drawn and nothing is lost. */
function rnDrawHover(c,g){
  if(typeof G==='undefined' || !G) return;
  const h=G.hover;
  if(!h || typeof h.x!=='number' || G.ghost || G.post) return;
  if(G.mode==='menu' || G.mode==='reveal' || G.mode==='end') return;
  const sx=g.ox+h.x*g.S, sy=g.oy+h.y*g.S;
  if(sx>g.W || sy>g.H || sx+g.S<0 || sy+g.S<0) return;
  c.fillStyle='rgba(242,234,217,.055)';
  c.fillRect(sx+1, sy+1, g.S-2, g.S-2);
  c.strokeStyle='rgba(242,234,217,.22)';
  c.lineWidth=1;
  c.strokeRect(sx+1.5, sy+1.5, g.S-3, g.S-3);
}
/* the tile under the pointer. Red-tinted when it can't go there, and a short
   deterministic shake on a refused drop — never under calm, where a rejection
   is exactly the jolt the setting exists to prevent. */
/* Whose hand is the tile in? A ghost the player is dragging must sit exactly
   under their pointer — a ghost that lags a finger reads as a dropped frame —
   but the AI's ghost is the only picture of a decision the player did not make,
   so it slides into its cell instead of blinking there. Nothing has to tell us
   which is which: the seat whose turn it is already says. */
let rnGhostP=null;
/* Which seat is proposing this tile, or -1 for the player's own ghost.
   ui.js publishes G.ghost.ai as a SEAT INDEX, so the test has to be `!= null`
   and never a truthiness check — seat 0 is a perfectly ordinary AI seat and
   `ai:0` would read as "no AI" to anything looking for a truthy flag. The
   turn-seat fallback covers a ui that has not published the field at all. */
function rnGhostAi(gh){
  if(gh && gh.ai!=null && gh.ai!==false) return (gh.ai===true) ? (G.turnIdx|0) : (gh.ai|0);
  const seat=(typeof G!=='undefined' && G && G.seats) ? G.seats[G.turnIdx|0] : null;
  return (!!seat && seat.human===false) ? (G.turnIdx|0) : -1;
}
function rnGhostEase(gh, g){
  const tgt={x:+gh.x||0, y:+gh.y||0};
  const ai = rnGhostAi(gh)>=0;
  if(!ai || calm() || rushed()){ rnGhostP=tgt; return tgt; }
  if(!rnGhostP){
    /* first sight of an AI ghost: come up out of the satchel — off the bottom
       of the board, in the target's own column — so the move reads as a tile
       being brought to a cell rather than one materialising on it */
    const from=(gh.from && gh.from.length===2)
      ? {x:+gh.from[0], y:+gh.from[1]}
      : {x:tgt.x, y:(g.H-g.oy)/g.S+0.8};
    rnGhostP={x:from.x, y:from.y};
  }
  const k=0.24;
  rnGhostP={ x:rnGhostP.x+(tgt.x-rnGhostP.x)*k, y:rnGhostP.y+(tgt.y-rnGhostP.y)*k };
  // settle exactly, or a tile hangs a hundredth of a cell off its grid for ever
  if(Math.abs(rnGhostP.x-tgt.x)<0.01 && Math.abs(rnGhostP.y-tgt.y)<0.01) rnGhostP=tgt;
  return rnGhostP;
}
function rnDrawGhost(c,g){
  if(typeof G==='undefined' || !G) return;
  const gh=G.ghost;
  if(!gh || typeof gh.x!=='number' || !G.drawn || typeof paintTile!=='function'){ rnGhostP=null; return; }
  const bad = gh.legal===false;
  let jx=0, jy=0;
  const shake=fxAge(gh.badTick, gTick(), 10);
  if(shake>0 && !calm()) jx=Math.round((gTick()&1?1:-1)*shake*3);
  const ai=rnGhostAi(gh);
  const at=rnGhostEase(gh, g);
  const sx=g.ox+at.x*g.S+jx, sy=g.oy+at.y*g.S+jy;
  const art=paintTile(G.drawn, gh.rot|0);
  c.save();
  c.globalAlpha = bad ? 0.45 : 0.68;
  if(art) c.drawImage(art, sx, sy, g.S, g.S);
  c.globalAlpha=1;
  if(bad){
    c.fillStyle='rgba(217,91,67,.42)';
    c.fillRect(sx,sy,g.S,g.S);
    c.strokeStyle=PAL.bad;
    c.lineWidth=2;
    c.strokeRect(sx+1, sy+1, g.S-2, g.S-2);
  } else if(ai>=0){
    /* THE PASTURE'S GHOST, NOT YOURS. For most of a second an AI's proposal sits
       on the board looking exactly like the tile the player is about to lay —
       same warm rim, same translucency — which invites them to click a cell that
       is not theirs to click. So it wears the proposing seat's own colour, in a
       dashed rim: the colour says whose it is (the same language as their
       shepherds and their scoring outline) and the broken line says nothing has
       been laid yet. Static dashes — a marching one would be motion for its own
       sake, and calm would have to take it away again. */
    const col=rnSeatCol(ai);
    const d=Math.max(4, Math.round(g.S/10));
    c.fillStyle=col;
    c.globalAlpha=0.13;
    c.fillRect(sx, sy, g.S, g.S);
    c.globalAlpha=1;
    if(c.setLineDash) c.setLineDash([d, Math.max(3, Math.round(d*0.6))]);
    c.strokeStyle=RN_INK; c.lineWidth=4;
    c.strokeRect(sx+2, sy+2, g.S-4, g.S-4);
    c.strokeStyle=col;    c.lineWidth=2;
    c.strokeRect(sx+2, sy+2, g.S-4, g.S-4);
    if(c.setLineDash) c.setLineDash([]);
  } else {
    c.strokeStyle='rgba(255,232,180,.85)';
    c.lineWidth=2;
    c.strokeRect(sx+1, sy+1, g.S-2, g.S-2);
  }
  c.restore();
}
/* `only` is a Set of 'x,y' cell keys — the reveal uses it to put the spotlit
   feature's shepherds back on top of its dimming wash */
function rnDrawShepherds(c,g,only){
  if(typeof drawShepherd!=='function') return;
  const list=rnShepherds();
  const zt=(typeof g.zt==='number')?g.zt:g.z;
  for(const s of list){
    if(!s || typeof s.x!=='number') continue;
    if(only && !only.has(s.x+','+s.y)) continue;
    const sx=g.ox+s.x*g.S, sy=g.oy+s.y*g.S;
    if(sx>g.W || sy>g.H || sx+g.S<0 || sy+g.S<0) continue;
    const p=rnShepSpot(s), seg=p[2];
    const px=sx+(p[0]+0.5)*(g.S/TILE);
    let py=sy+(p[1]+0.5)*(g.S/TILE);
    /* a herder posted on a meadow is the same piece, sitting down (design §0).
       game.js's shepherdList carries the feature type, which saves resolving
       the segment again for every shepherd on every frame. */
    const kind=(s.kind ? s.kind==='meadow' : (seg && seg.t==='m')) ? 'seat' : 'stand';
    /* just posted: drop in from above and land, which is the only moment the
       player has to notice a piece leaving somebody's supply */
    let a=1;
    const dt=rnDrops.size ? rnPhase(rnDrops.get(rnShepKey(s))||-1, DROP_LIFE) : -1;
    if(dt>=0){
      const e=rnEaseOut(dt);
      py-=(1-e)*18*Math.max(g.z,0.5);
      a=Math.min(1, 0.25+dt*2.2);
    }
    c.save();
    c.globalAlpha=a;
    // the shadow tightens as the piece comes down, which is what sells the drop
    const sh=(dt>=0? 0.35+0.65*rnEaseOut(dt) : 1);
    c.fillStyle='rgba(20,24,15,'+(0.30*sh).toFixed(3)+')';
    const shy=sy+(p[1]+0.5)*(g.S/TILE);
    c.beginPath();
    c.ellipse ? c.ellipse(px, shy, 4*g.z/sh, 1.8*g.z, 0, 0, 6.284) : c.rect(px-4*g.z, shy-1, 8*g.z, 2);
    c.fill();
    drawShepherd(c, rnSeatCol(s.seat), kind, px, py+1, zt);
    c.restore();
  }
}
/* the wool a shepherd leaves behind on its way home: five tufts opening out and
   fading. The piece is gone by the time board.js tells anyone it has been
   returned, so this is the only mark on the board that says a feature paid out
   and emptied — which is why it is drawn to be seen rather than to be tasteful.
   Wool over the cream floor of a pen has almost no contrast to spend, so it
   holds full opacity for the first third and the tuft carries its own outline. */
function rnDrawPuffs(c,g){
  if(!rnPuffs.length || calm()) return;
  const tuft=(typeof artEmblem==='function') ? artEmblem('puff') : null;
  for(const p of rnPuffs){
    const t=(rTick-p.born)/PUFF_LIFE;
    if(t<0||t>1) continue;
    const e=rnEaseOut(t);
    const px=g.ox+p.x*g.S, py=g.oy+p.y*g.S;
    if(px<-40||px>g.W+40||py<-40||py>g.H+40) continue;
    c.save();
    c.globalAlpha=clamp(1.30-t*t*1.55, 0, 1);
    const s=Math.max(1, Math.round(g.z));
    for(let i=0;i<5;i++){
      const a=i*1.257+0.35, r=(2+e*9)*Math.max(g.z,0.5);
      const x=Math.round(px+Math.cos(a)*r), y=Math.round(py-6*g.z-Math.sin(a)*r*0.7-e*5*g.z);
      if(tuft) c.drawImage(tuft, x-4*s, y-3*s, tuft.width*s, tuft.height*s);
      else { c.fillStyle='rgba(253,251,244,.9)'; c.fillRect(x-s, y-s, s*2, s*2); }
    }
    c.restore();
  }
}
/* the follower overlay: a numbered disc on every segment of the tile just laid,
   greyed where the merged feature is already somebody's */
function rnDrawPostDiscs(c,g){
  if(typeof G==='undefined' || !G || !G.post) return;
  const po=G.post;
  const opts=po.opts||po.options;
  if(!Array.isArray(opts) || !opts.length) return;
  const bm=rnBoardMap();
  const e=bm? bm.get(cellKey(po.x, po.y)) : null;
  const tile=rnTileOf(po.tileId || (e?e.tileId:G.drawn));
  const rot=(typeof po.rot==='number') ? po.rot|0 : (e? e.rot|0 : 0);
  const sx=g.ox+po.x*g.S, sy=g.oy+po.y*g.S;
  // dim the rest of the board so the choice is the only lit thing
  c.fillStyle='rgba(10,14,9,.34)';
  c.fillRect(0,0,g.W,g.H);
  if(typeof paintTile==='function'){
    const art=paintTile(po.tileId || (e?e.tileId:G.drawn), rot);
    if(art) c.drawImage(art,sx,sy,g.S,g.S);
  }
  // the same radius ui.js hit-tests with (View.discR) — the target and the
  // picture have to be one thing or a click lands next to the disc it hit
  const R=Math.max(9, Math.round(g.S/6));
  for(let i=0;i<opts.length;i++){
    const o=opts[i];
    if(!o) continue;
    const label=(typeof o.n==='number') ? o.n : (i+1);
    let spot=o.spot;
    if(!spot){
      const seg=(tile&&tile.segs)?tile.segs[o.seg|0]:null;
      spot=(seg&&seg.spot)?seg.spot:[32,32];
    }
    const p=(typeof artRotSpot==='function')?artRotSpot(spot[0],spot[1],rot):spot;
    const px=Math.round(sx+(p[0]+0.5)*(g.S/TILE)), py=Math.round(sy+(p[1]+0.5)*(g.S/TILE));
    const ok=o.ok!==false;
    c.beginPath(); c.arc(px,py,R,0,6.2832);
    c.fillStyle = ok ? 'rgba(20,24,15,.86)' : 'rgba(20,24,15,.55)';
    c.fill();
    c.lineWidth=2;
    c.strokeStyle = ok ? PAL.gold : PAL.uiDim;
    c.stroke();
    // a 3x5 glyph is a speck on a 42px disc, so the number grows with the disc
    const ns = R>=15 ? 2 : 1;
    c.save(); c.scale(ns,ns);
    drawPixelText(c, String(label), px/ns, (py-2*ns)/ns, ok?PAL.ui:PAL.uiDim, RN_INK);
    c.restore();
    if(!ok && o.by) drawPixelText(c, String(o.by), px, py+R+3, PAL.uiDim, RN_INK);
  }
  // no instruction text here: ui.js's hint bar already says how to post, and a
  // second copy on the canvas lands on top of the turn banner
}
/* completed features flash their outline: the perimeter of the cell set, so a
   nine-tile fold reads as one shape rather than nine squares */
/* The perimeter of a feature's cells as a list of grid-corner edges, ordered
   by angle about the centroid so drawing a prefix of the list lights the
   outline up as one sweep round the shape rather than in scattered pieces.
   Computed once per flash and kept on it — the cell set cannot change. */
function rnFlashEdges(f){
  if(f.edges) return f.edges;
  const have=new Set(f.cells.map(p=>p[0]+','+p[1]));
  let cx=0, cy=0;
  for(const [x,y] of f.cells){ cx+=x+0.5; cy+=y+0.5; }
  cx/=f.cells.length; cy/=f.cells.length;
  const es=[];
  const add=(x0,y0,x1,y1)=>{
    es.push([x0,y0,x1,y1, Math.atan2((y0+y1)/2-cy, (x0+x1)/2-cx)]);
  };
  for(const [x,y] of f.cells){
    if(!have.has(x+','+(y-1)))     add(x,   y,   x+1, y);
    if(!have.has(x+','+(y+1)))     add(x,   y+1, x+1, y+1);
    if(!have.has((x-1)+','+y))     add(x,   y,   x,   y+1);
    if(!have.has((x+1)+','+y))     add(x+1, y,   x+1, y+1);
  }
  es.sort((a,b)=>a[4]-b[4]);
  f.edges=es;
  return es;
}
/* completed features flash their outline: the perimeter of the cell set, so a
   nine-tile fold reads as one shape rather than nine squares. The line runs
   round it first and then pulses, which is what turns "these tiles lit up" into
   "this is one thing, and it is yours". */
const RN_SWEEP=0.34;              // fraction of the flash's life the run takes
function rnDrawFlashes(c,g){
  for(const f of rnFlashes){
    const age=(rTick-f.born)/FLASH_LIFE;
    if(age<0||age>1) continue;
    const es=rnFlashEdges(f);
    if(!es.length) continue;
    const quiet=calm();
    const pulse = quiet ? 0.42*(1-age) : (0.30+0.55*Math.abs(Math.sin(age*9.4)))*(1-age*0.6);
    /* calm mode gets the whole outline at once and holds it still: the sweep is
       motion, and motion is the thing the setting exists to remove */
    const n = quiet ? es.length : Math.max(1, Math.ceil(es.length*Math.min(1, age/RN_SWEEP)));
    const stroke=(cnt)=>{
      c.beginPath();
      for(let i=0;i<cnt;i++){
        const e=es[i];
        c.moveTo(g.ox+e[0]*g.S, g.oy+e[1]*g.S);
        c.lineTo(g.ox+e[2]*g.S, g.oy+e[3]*g.S);
      }
      c.stroke();
    };
    /* laid down twice: a dark line under the seat's colour. A seat colour alone
       is a 2px line over a meadow that is itself speckled with light and dark,
       and at zoom 1 it read as another grid line rather than as a feature
       lighting up. The dark bed is what makes it a drawn outline. */
    const lw=Math.max(3, Math.round(g.S/20));
    c.globalAlpha=clamp(pulse,0,1)*0.55;
    c.lineWidth=lw+2;
    c.strokeStyle=RN_INK;
    stroke(n);
    c.globalAlpha=clamp(pulse,0,1)*0.92;
    c.lineWidth=lw;
    c.strokeStyle=f.col;
    stroke(n);
    // the head of the sweep runs a touch brighter, so the eye has something to
    // follow round the shape instead of watching an outline accumulate
    if(!quiet && n<es.length){
      const e=es[n-1];
      c.globalAlpha=clamp(pulse,0,1);
      c.strokeStyle='rgba(255,247,222,.95)';
      c.beginPath();
      c.moveTo(g.ox+e[0]*g.S, g.oy+e[1]*g.S);
      c.lineTo(g.ox+e[2]*g.S, g.oy+e[3]*g.S);
      c.stroke();
    }
    c.globalAlpha=1;
  }
}
/* A +N thrown upward and drifting is a score being awarded; a +N sliding
   straight up is a label. The rise eases out (fast off the mark, hanging at the
   top) and the drift is constant, which is what bends the path into an arc.
   Under calm the drift and the ease both go, leaving the plain rise. */
function rnDrawFloaters(c,g){
  const quiet=calm();
  for(const f of rnFloaters){
    const age=(rTick-f.born)/FLOAT_LIFE;
    if(age<0||age>1) continue;
    if(age>0.86 && (rTick&1)) continue;           // flicker out at the end
    const rise = quiet ? age*30 : rnEaseOut(age)*34;
    const x=g.ox+f.x*g.S+(quiet?0:f.dx*age*17), y=g.oy+f.y*g.S-rise;
    if(x<-40||x>g.W+40||y<-20||y>g.H+20) continue;
    c.save();
    c.globalAlpha=clamp(1.25-age*1.1,0,1);
    /* a +N is feedback, not board content, so it does not shrink with the board:
       at 1x the 3x5 font drew a five-pixel-tall score nobody could read at zoom
       1 or 0.5. Sized off the TRUE zoom, so a zoom tween cannot flicker it. */
    const sc=((g.zt||g.z)>=2)?3:2;
    c.scale(sc,sc);
    drawPixelText(c, f.text, x/sc, y/sc, f.col, RN_INK);
    c.restore();
  }
}

/* ================= REVEAL WALKTHROUGH =========================
   consumes one row of finalScore() at a time: glow the feature's cells, then
   show the arithmetic that turns them into points (design §4). */
/* game.js counts G.reveal.idx as the number of steps already banked, so the
   step under the spotlight is the NEXT one — highlight it, Enter counts it. */
function rnRevealStep(){
  const r=(typeof G!=='undefined' && G) ? G.reveal : null;
  if(!r) return null;
  if(Array.isArray(r.steps)) return r.steps[Math.min(r.idx|0, r.steps.length-1)] || null;
  return r.step || r;
}
/* The spotlight is a real spotlight: the rest of the pasture goes down a stop
   and the feature being counted is put back at full brightness on top of it,
   shepherds included. Dimming the board is what makes a five-tile lane in the
   middle of eighty tiles findable at a glance — the old warm wash alone left
   the player hunting for it. */
function rnDrawReveal(c,g){
  /* the MODE, not just the presence of G.reveal: finishReveal leaves G.reveal
     in place when it moves to 'end', and testing the object alone left the dim
     wash and the arithmetic panel painted on the board behind the end card */
  if(typeof G==='undefined' || !G || G.mode!=='reveal' || !G.reveal) return;
  const st=rnRevealStep();
  if(!st) return;
  const cells=rnCells(st.cells);
  const have=new Set(cells.map(p=>p[0]+','+p[1]));

  c.fillStyle='rgba(8,11,7,.50)';
  c.fillRect(0,0,g.W,g.H);

  if(cells.length && typeof paintTile==='function'){
    const bm=rnBoardMap();
    c.imageSmoothingEnabled = g.S < TILE;
    for(const [x,y] of cells){
      const e=bm? bm.get(cellKey(x,y)) : null;
      if(!e || !e.tileId) continue;
      const art=paintTile(e.tileId, e.rot|0);
      if(art) c.drawImage(art, g.ox+x*g.S, g.oy+y*g.S, g.S, g.S);
    }
    c.imageSmoothingEnabled=false;
    rnDrawShepherds(c, g, have);
    const t=gTick();
    // gentler than it needs to look on its own: the surrounding dim is what
    // picks the feature out now, so the wash only has to say "warm", and a
    // heavier one washed the tile art it is meant to be showing off
    const k = calm() ? 0.11 : 0.06+0.08*(0.5+0.5*Math.sin(t/8));
    c.fillStyle='rgba(255,216,107,'+k.toFixed(3)+')';
    for(const [x,y] of cells) c.fillRect(g.ox+x*g.S, g.oy+y*g.S, g.S, g.S);
    c.strokeStyle=PAL.gold; c.lineWidth=Math.max(2, Math.round(g.S/26));
    c.beginPath();
    for(const [x,y] of cells){
      const sx=g.ox+x*g.S, sy=g.oy+y*g.S;
      if(!have.has(x+','+(y-1))){ c.moveTo(sx,sy); c.lineTo(sx+g.S,sy); }
      if(!have.has(x+','+(y+1))){ c.moveTo(sx,sy+g.S); c.lineTo(sx+g.S,sy+g.S); }
      if(!have.has((x-1)+','+y)){ c.moveTo(sx,sy); c.lineTo(sx,sy+g.S); }
      if(!have.has((x+1)+','+y)){ c.moveTo(sx+g.S,sy); c.lineTo(sx+g.S,sy+g.S); }
    }
    c.stroke();
  }
  rnDrawRevealCaption(c,g,st);
}
/* The arithmetic panel. It sits at ONE place for the whole walkthrough — same
   y, same height, same anatomy — because a caption that moves is a caption the
   player has to find again on every step; RN_CAP_BAND is reserved for it and
   the camera aims the feature above it, so the two no longer overlap.
   board.js's `detail` already opens with the feature's name ("Lane · 5 tiles ×
   1 = 6"), so printing the kind as well said LANE twice. */
function rnDrawRevealCaption(c,g,st){
  const holders=(st.holders||[]).map(h=>{
    if(typeof h==='number') return rnSeat(h).name;
    if(h && typeof h==='object') return h.name || rnSeat(h.seat|0).name;
    return String(h);
  });
  const l1=String(st.detail || st.kind || '').toUpperCase();
  const l2=(holders.length?('> '+holders.join(', ')):'> NOBODY')+
           (typeof st.pts==='number'?('  +'+st.pts):'');
  const steps=Array.isArray(G.reveal.steps)?G.reveal.steps:null;
  const nSteps=steps?steps.length:G.reveal.n;
  const iStep=steps?(G.reveal.idx|0):G.reveal.i;
  const counter=(typeof nSteps==='number' && typeof iStep==='number')
    ? (Math.min(iStep+1,nSteps)+'/'+nSteps) : '';
  const cw=counter?textW(counter)+14:0;
  const inner=Math.max(textW(l1), textW(l2))*2+24;
  const w=inner+cw, H=36;
  const bx=Math.round(g.W/2-w/2), by=Math.round(g.H-16-H);
  // a cast shadow, so the panel reads as sitting over the board rather than
  // punched into it — it is allowed to cross a tile, just not to blend with one
  c.fillStyle='rgba(0,0,0,.34)'; c.fillRect(bx+2, by+3, w, H);
  c.fillStyle='rgba(16,20,12,.92)'; c.fillRect(bx, by, w, H);
  /* the panel's top rule doubles as the progress of the counting: gold for the
     steps banked, dim for the ones still to come. A separate bar along the foot
     read as an underline of whatever word happened to sit above it. */
  const done=(typeof nSteps==='number' && nSteps && typeof iStep==='number')
    ? Math.min(iStep+1,nSteps)/nSteps : 1;
  c.fillStyle='rgba(255,216,107,.28)'; c.fillRect(bx, by, w, 2);
  c.fillStyle=PAL.gold;                c.fillRect(bx, by, Math.round(w*done), 2);
  c.fillStyle='rgba(242,234,217,.14)'; c.fillRect(bx, by+2, w, 1);
  c.save(); c.scale(2,2);
  drawPixelText(c, l1, (bx+inner/2)/2, (by+9)/2,  PAL.ui,   RN_INK);
  drawPixelText(c, l2, (bx+inner/2)/2, (by+21)/2, PAL.gold, RN_INK);
  c.restore();
  if(counter){
    c.fillStyle='rgba(242,234,217,.10)'; c.fillRect(bx+inner, by+5, 1, H-10);
    drawPixelText(c, counter, bx+inner+cw/2, by+H/2-3, PAL.uiDim, RN_INK);
  }
}

function rnDrawBanner(c,g){
  if(rnBannerAt<0) return;
  // the post window dims the board and owns the top of the screen
  if(typeof G!=='undefined' && G && G.post) return;
  const age=rTick-rnBannerAt;
  if(age<0 || age>=RN_BANNER_SPAN) return;
  const k=Math.min(clamp(age/10,0,1), clamp((RN_BANNER_SPAN-age)/10,0,1));
  const tw=textW(rnBannerTxt)*2;
  const slide=calm()?0:Math.round((1-k)*-30);
  const bx=Math.round(g.W/2-tw/2)-11+slide, by=10;
  c.save(); c.globalAlpha=k;
  // near-opaque: over a lit meadow a 76%-alpha plate let the green through and
  // the banner all but vanished at the one moment it has something to say
  c.fillStyle='rgba(12,15,9,.93)'; c.fillRect(bx,by-1,tw+22,16);
  c.fillStyle=rnBannerCol; c.fillRect(bx,by-1,3,16); c.fillRect(bx+tw+19,by-1,3,16);
  c.fillStyle='rgba(242,234,217,.18)'; c.fillRect(bx,by-1,tw+22,1);
  c.fillStyle='rgba(0,0,0,.35)'; c.fillRect(bx,by+15,tw+22,1);
  c.scale(2,2);
  drawPixelText(c, rnBannerTxt, (g.W/2+slide)/2, (by+4)/2, rnBannerCol, RN_INK);
  c.restore();
}

/* ================= THE TRAY ==================================
   #trayCv: the tile in hand at ~84px with its name and the rotation it will be
   laid at. ui.js owns the surrounding DOM; the canvas is ours. */
function rnDrawTray(){
  const cv=rnTray(), c=rnTrayCtx;
  if(!cv || !c) return;
  const W=cv.width|0, H=cv.height|0;
  if(!W || !H) return;
  c.clearRect(0,0,W,H);
  c.fillStyle=RN_EDGE; c.fillRect(0,0,W,H);
  const S=(typeof G!=='undefined' && G) ? G : null;
  /* game.js clears G.drawn the moment the tile lands, so for the whole follower
     window the tray would read SATCHEL EMPTY while that very tile is sitting on
     the board under the numbered discs. While the post window is open the tray
     shows what was just laid. */
  let id  = S ? S.drawn : null;
  let rot = S ? ((S.ghost && typeof S.ghost.rot==='number') ? S.ghost.rot : (S.rot|0)) : 0;
  if(S && !id && S.post && S.post.tileId){ id=S.post.tileId; rot=S.post.rot|0; }
  const pad=6;
  const s=Math.min(W-pad*2, H-pad*2);
  const x=Math.round((W-s)/2), y=Math.round((H-s)/2);
  if(id && typeof paintTile==='function'){
    const art=paintTile(id, rot);
    if(art){
      if(c.imageSmoothingEnabled!==undefined) c.imageSmoothingEnabled = s<TILE;
      c.drawImage(art, x, y, s, s);
    }
    c.strokeStyle=PAL.uiDim; c.lineWidth=1; c.strokeRect(x-0.5, y-0.5, s+1, s+1);
    // no name on the canvas: ui.js prints it in the DOM alongside at a readable
    // size, and that copy is the accessible one
    for(let i=0;i<4;i++){
      c.fillStyle = (i===((rot%4)+4)%4) ? PAL.gold : 'rgba(195,185,164,.35)';
      P(c, x+s-4-(3-i)*5, y+3, 3, 3);
    }
  } else {
    c.fillStyle='rgba(242,234,217,.06)'; c.fillRect(x,y,s,s);
    drawPixelText(c, 'SATCHEL', W/2, y+s/2-6, PAL.uiDim, RN_INK);
    drawPixelText(c, 'EMPTY',   W/2, y+s/2+2, PAL.uiDim, RN_INK);
  }
}

/* ================= RENDER ===================================== */
function render(){
  rTick++;
  const cv=rnBoard(), c=rnCtx;
  rnReap();
  rnPollBanner();
  if(!cv || !c || !cv.width || !cv.height){ rnDrawTray(); return; }
  const g=rnGeom();
  if(!g.W || !g.H){ rnDrawTray(); return; }

  /* `gd` is the same board seen through the presentation camera; `g` stays the
     geometry ui.js hit-tests through. Only the world layers take gd. The post
     discs deliberately do NOT: the disc a click lands on has to be the disc on
     the screen, so that one layer is always drawn in settled coordinates (and
     the zoom tween refuses to start while the window is open). */
  const gd=rnDisplay(g, rnZoomTween(g), rnRevealPan(g));
  rnDiffState(gd);

  c.imageSmoothingEnabled=false;
  rnFillFelt(c,gd);
  rnDrawLattice(c,gd);

  if(typeof G!=='undefined' && G){
    c.imageSmoothingEnabled = gd.S < TILE;     // minify smoothly, magnify crisply
    rnDrawBoard(c,gd);
    c.imageSmoothingEnabled = false;
    rnDrawLegal(c,gd);
    rnDrawHover(c,gd);
    rnDrawGhost(c,gd);
    rnDrawShepherds(c,gd);
    rnDrawPuffs(c,gd);
    rnDrawFlashes(c,gd);
    rnDrawPostDiscs(c,g);
    rnDrawReveal(c,gd);
    rnDrawFloaters(c,gd);
    rnDrawBanner(c,g);
  }
  rnDrawTray();
}

/* ---------------- CONTRACT SURFACE ---------------- */
if(typeof window!=='undefined'){
  window.render         = render;
  window.pushFloater    = pushFloater;
  window.pushFlash      = pushFlash;
  window.pushBanner     = pushBanner;
  window.rnBusy         = rnBusy;
  window.worldToScreen  = worldToScreen;
  window.screenToCell   = screenToCell;
  window.screenToCellF  = screenToCellF;
  window.drawPixelText  = drawPixelText;
  window.textW          = textW;
  window.FONT           = FONT;
}
