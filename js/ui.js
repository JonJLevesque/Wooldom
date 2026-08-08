'use strict';
/* ==================================================================
   WOOLDOM — js/ui.js
   The DOM chrome, the pointer and the keyboard, the menus, and boot.
   Owns: index.html's elements, css/style.css, the view state (G.view),
   and every path a human uses to reach game.js. It never decides a rule:
   every placement and every posted shepherd goes through game.js's own
   place()/spot()/skip(), which is the same path the AI and the tests take.
   Drawing — including the tray canvas — belongs to art.js/render.js.
   ================================================================== */

/* ---------------- 0. THE ENGINE ADAPTER ----------------
   Wooldom's modules are built in parallel, so every name ui.js does not own
   is reached through this one block. If game.js lands a different spelling,
   this is the only place that changes — nothing below ever pokes at a global
   directly. Everything degrades to a no-op rather than throwing, so the menu
   still boots when a module is still a stub. */

if(typeof G==='undefined' || !G){          // game.js hasn't landed: keep the menu alive
  window.G = { mode:'menu', seats:[], satchel:[], dead:[], drawn:null,
               turnIdx:0, config:{}, tick:0 };
}

const UiEng = {
  mode(){ return (G && G.mode) || 'menu'; },
  /* game.js calls it `step`; accept `phase` too so a rename doesn't silence the
     whole input layer */
  step(){ return (G && (G.step || G.phase)) || ''; },
  seats(){ return (G && G.seats) || []; },
  seat(i){ return UiEng.seats()[i] || null; },
  turnIdx(){ return G ? (G.turnIdx|0) : 0; },
  current(){ return UiEng.seat(UiEng.turnIdx()); },
  humanTurn(){ const s=UiEng.current(); return !!(s && s.human); },
  drawn(){ return (G && G.drawn) || null; },
  satchel(){ return (G && G.satchel && G.satchel.length)|0; },
  dead(){ return (G && G.dead && G.dead.length)|0; },
  seatColor(i){ const s=UiEng.seat(i); return (s && s.color) || PAL['p'+(i+1)] || PAL.p1; },
  seatName(i){ const s=UiEng.seat(i); return (s && s.name) || ('SEAT '+(i+1)); },

  tile(id){
    if(!id) return null;
    if(typeof tileById==='function') return tileById(id);
    if(typeof TILES!=='undefined' && TILES && TILES.length)
      for(const t of TILES) if(t.id===id) return t;
    return null;
  },
  tileName(id){ const t=UiEng.tile(id); return (t && t.name) || id || ''; },

  /* Legal cells, never a UI re-derivation. game.js's legalPlacements is the one
     to ask: board.js's legalCells only answers "do the edges match", while this
     one also applies the phase — during the brook that means extending an open
     end and the no-U-turn rule, and offering a cell the brook will refuse is
     how you get a ghost that says yes and a click that does nothing. */
  legal(id){
    if(!id) return [];
    if(typeof legalPlacements==='function')
      return legalPlacements(id, !!(G.brook && G.brook.relax)) || [];
    if(typeof legalCells==='function') return legalCells(id) || [];
    const D=window.WoolDbg;
    if(D && typeof D.legal==='function') return D.legal(id) || [];
    return [];
  },
  place(x,y,rot){
    if(typeof place==='function') return place(x,y,rot);
    const D=window.WoolDbg;
    if(D && typeof D.place==='function') return D.place(x,y,rot);
    return false;
  },
  post(seg){
    if(typeof spot==='function') return spot(seg);
    const D=window.WoolDbg;
    if(D && typeof D.spot==='function') return D.spot(seg);
    return false;
  },
  skip(){
    if(typeof skip==='function') return skip();
    const D=window.WoolDbg;
    if(D && typeof D.skip==='function') return D.skip();
    return false;
  },
  /* which segments of the tile just laid may take a shepherd. game.js's
     postOptions() is the authority — it is what the pack `spots` hooks extend —
     and it answers with segment indices. */
  postable(){
    if(typeof postOptions==='function'){ const r=postOptions(); return Array.isArray(r)?r:[]; }
    return null;
  },
  pending(){ return (G && G.pending) || null; },
  canPost(x,y,seg){ return (typeof canPost==='function') ? !!canPost(x,y,seg) : true; },
  featureAt(x,y,seg){ return (typeof featureAt==='function') ? featureAt(x,y,seg) : null; },
  start(cfg){
    if(typeof startGame==='function') return startGame(cfg);
    const D=window.WoolDbg;
    if(D && typeof D.startGame==='function') return D.startGame(cfg);
    return false;
  },
  /* game.js owns the save; the menu only asks whether there is one */
  hasSave(){
    if(typeof hasSave==='function') return !!hasSave();
    try{
      const raw = (typeof localStorage!=='undefined') && localStorage.getItem('wooldom.save');
      if(!raw) return false;
      const s=JSON.parse(raw);
      return !!(s && s.log);
    }catch(e){ return false; }
  },
  /* a bare `typeof`, not window[name]: script-tag functions are window
     properties in a browser but plain locals under test/shim.js's single eval,
     and only the bare form finds them in both */
  resume(){
    if(typeof resumeGame==='function') return resumeGame();
    if(typeof loadGame==='function') return loadGame();
    return false;
  },
  final(){
    if(typeof finalScore==='function'){ const r=finalScore(); return Array.isArray(r)?r:[]; }
    return [];
  },
  /* the walkthrough step the reveal is on, when game.js runs one */
  revealNext(){ if(typeof revealNext==='function') return revealNext(); return false; },
  /* skipping the walkthrough means landing on the summary, not standing on its
     last step: revealAll() runs the counter out, revealNext() then closes it */
  revealSkip(){
    if(typeof revealAll==='function'){
      revealAll();
      if(typeof finishReveal==='function') finishReveal();
      else if(typeof revealNext==='function') revealNext();
      return true;
    }
    if(typeof revealSkip==='function') return revealSkip();
    return false;
  },
};

/* ---------------- 1. SMALL HELPERS ----------------
   All of these survive test/shim.js's minimal element stub. */
function attr(node,name,val){ if(node && node.setAttribute) node.setAttribute(name,val); }
function mkEl(tag,cls,txt){
  const e=document.createElement(tag);
  if(cls) e.className=cls;
  if(txt!=null) e.textContent=txt;
  return e;
}
/* Activation that keeps the keyboard honest: a mouse click (detail>0) drops
   focus so SPACE goes back to the board, while a keyboard activation (detail 0)
   leaves focus where the player put it. */
function onAct(node,fn){
  if(!node || !node.addEventListener) return node;
  node.addEventListener('click',e=>{ if(e && e.detail>0 && node.blur) node.blur(); fn(e); });
  return node;
}
function snd(name,x){ if(typeof Snd!=='undefined' && Snd && Snd[name]) Snd[name](x); }
function mq(q){ try{ return (typeof matchMedia==='function') ? matchMedia(q) : null; }catch(e){ return null; } }
function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
function uiShow(id){ const e=el(id); if(e && e.classList) e.classList.remove('hidden'); }
function uiHide(id){ const e=el(id); if(e && e.classList) e.classList.add('hidden'); }
function uiText(id,v){ const e=el(id); if(e) e.textContent=v; }
function uiHtml(id,v){ const e=el(id); if(e) e.innerHTML=v; }
function titleCase(s){ return String(s||'').replace(/(^|[\s-])(\w)/g,(m,a,b)=>a+b.toUpperCase()); }

/* ---------------- 2. PREFERENCES (wooldom.prefs) ----------------
   One JSON object, read-modify-written every time so game.js and ui.js can
   both touch the key without either holding a stale copy. */
const UI_PREFS='wooldom.prefs';
function prefsAll(){
  try{
    if(typeof localStorage==='undefined') return {};
    return JSON.parse(localStorage.getItem(UI_PREFS)||'{}') || {};
  }catch(e){ return {}; }
}
/* game.js keeps prefs under the same key and reads `calm` out of it at
   startGame, so go through its accessors when they exist — two writers with two
   cached copies of one object is how a setting quietly reverts. */
function uiPref(k,d){
  if(typeof prefGet==='function') return prefGet(k,d);
  const p=prefsAll();
  return (k in p) ? p[k] : d;
}
function uiPrefSet(k,v){
  if(typeof prefSet==='function') return prefSet(k,v);
  const p=prefsAll(); p[k]=v;
  try{ if(typeof localStorage!=='undefined') localStorage.setItem(UI_PREFS,JSON.stringify(p)); }catch(e){}
}

/* ---------------- 3. VIEW & TRANSFORMS ----------------
   Shared with render.js. Declared as a property assignment, not a lexical
   const, so that a stray `const View` in another module can shadow it without
   the two declarations colliding at load time. Cell coordinates are integers;
   G.view.cx/cy are floats naming the cell coordinate at the centre of the
   canvas. Everything on screen is derived from these four functions, and the
   post-disc hit test uses the very same spot() render.js draws with. */
const UI_W=960, UI_H=540;                 // the canvas's design size (CSS-scaled)
let uiCv=null, uiTray=null;

function canvasW(){ return (uiCv && uiCv.width) || UI_W; }
function canvasH(){ return (uiCv && uiCv.height) || UI_H; }
function uiView(){
  if(!G.view || typeof G.view.zoom!=='number') G.view={cx:0,cy:0,zoom:1};
  return G.view;
}
/* render.js owns the drawing geometry (rnGeom/worldToScreen/screenToCell) and
   art.js owns how a segment spot turns with its tile (artRotSpot). View simply
   forwards to them: a hit test that recomputes the same arithmetic separately
   is a hit test that will one day disagree with the pixels. The fallbacks below
   are byte-for-byte the same formulas, and exist only so the menu still works
   if render.js is not there yet. */
function uiOriginX(){ return Math.round(canvasW()/2 - uiView().cx*(TILE*uiView().zoom)); }
function uiOriginY(){ return Math.round(canvasH()/2 - uiView().cy*(TILE*uiView().zoom)); }
window.View = {
  px(){ return (typeof rnGeom==='function') ? rnGeom().S : TILE*uiView().zoom; },
  w2s(cx,cy){
    if(typeof worldToScreen==='function'){ const p=worldToScreen(cx,cy); return [p.sx,p.sy]; }
    const S=View.px();
    return [ uiOriginX()+cx*S, uiOriginY()+cy*S ];
  },
  s2w(sx,sy){
    if(typeof screenToCellF==='function'){ const p=screenToCellF(sx,sy); return [p.x,p.y]; }
    const S=View.px();
    return [ (sx-uiOriginX())/S, (sy-uiOriginY())/S ];
  },
  cellAt(sx,sy){
    if(typeof screenToCell==='function'){ const p=screenToCell(sx,sy); return [p.x,p.y]; }
    const w=View.s2w(sx,sy);
    return [Math.floor(w[0]), Math.floor(w[1])];
  },
  /* a tile-local point (0..63) on the tile at (cx,cy) laid at `rot`, in canvas
     px — rounded exactly as render.js rounds it when it draws the disc */
  spot(cx,cy,rot,sp){
    const s=sp||[32,32];
    const p=(typeof artRotSpot==='function') ? artRotSpot(s[0],s[1],rot) : uiRotSpot(s,rot);
    const S=View.px(), o=View.w2s(cx,cy);
    return [ Math.round(o[0]+(p[0]+0.5)*(S/TILE)), Math.round(o[1]+(p[1]+0.5)*(S/TILE)) ];
  },
  /* the disc's drawn radius, so the target and the picture are one thing */
  discR(){ return Math.max(9, Math.round(View.px()/6)); },
  inView(cx,cy){
    const o=View.w2s(cx,cy), p=View.px();
    return o[0]>-p && o[1]>-p && o[0]<canvasW() && o[1]<canvasH();
  },
};
/* clockwise, the same winding as tiles.js's slot→(slot+3)%12 */
function uiRotSpot(sp,rot){
  let x=sp[0], y=sp[1];
  const r=((rot|0)%4+4)%4, N=TILE-1;
  for(let i=0;i<r;i++){ const nx=N-y; y=x; x=nx; }
  return [x,y];
}

/* the camera stays within arm's reach of the tiles that exist */
const UI_MARGIN=3;
let uiBoundsSig=-1, uiBounds={x0:0,y0:0,x1:0,y1:0};
function boardBounds(){
  const b=(typeof board!=='undefined') ? board : null;
  const n=(b && b.size)|0;
  if(!n) return {x0:0,y0:0,x1:0,y1:0};
  if(n===uiBoundsSig) return uiBounds;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  b.forEach((v,k)=>{
    const c=String(k).split(','), x=+c[0], y=+c[1];
    if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
  });
  uiBoundsSig=n; uiBounds={x0,y0,x1,y1};
  return uiBounds;
}
function clampView(){
  const v=uiView(), b=boardBounds();
  v.cx=clamp(v.cx, b.x0-UI_MARGIN, b.x1+1+UI_MARGIN);
  v.cy=clamp(v.cy, b.y0-UI_MARGIN, b.y1+1+UI_MARGIN);
}
function centreOn(x,y){ const v=uiView(); v.cx=x+0.5; v.cy=y+0.5; clampView(); }
function zoomIdx(){
  const z=uiView().zoom;
  let bi=0,bd=Infinity;
  for(let i=0;i<ZOOMS.length;i++){ const d=Math.abs(ZOOMS[i]-z); if(d<bd){ bd=d; bi=i; } }
  return bi;
}
/* land on a zoom step, keeping whatever is under (sx,sy) exactly where it is */
function setZoomIdx(ni,sx,sy){
  const i=zoomIdx();
  ni=clamp(ni,0,ZOOMS.length-1);
  if(ni===i) return false;
  const ax=(sx==null)?canvasW()/2:sx, ay=(sy==null)?canvasH()/2:sy;
  const before=View.s2w(ax,ay);
  uiView().zoom=ZOOMS[ni];
  const after=View.s2w(ax,ay);
  const v=uiView();
  v.cx+=before[0]-after[0]; v.cy+=before[1]-after[1];
  clampView();
  return true;
}
function zoomStep(dir,sx,sy){ return setZoomIdx(zoomIdx()+(dir<0?-1:1), sx, sy); }
/* Nearest step measured in LOG space, because zoom is a ratio: halfway between
   0.5× and 1× is 0.707×, not 0.75×, and the linear reading made the lower half
   of every pinch feel dead. */
function zoomNearest(z){
  let bi=0,bd=Infinity;
  for(let i=0;i<ZOOMS.length;i++){
    const d=Math.abs(Math.log(ZOOMS[i]/Math.max(z,1e-6)));
    if(d<bd){ bd=d; bi=i; }
  }
  return bi;
}
/* A pinch reports a continuous ratio and the board has three zooms, so the
   gesture snaps. The deadband is not polish: fingers holding still on the
   boundary jitter by a pixel either way, and without it the board strobes
   between two zoom steps at frame rate for as long as they rest there. */
const UI_PINCH_DEAD=0.12;                 // log units clear of the midpoint
function zoomTo(z,sx,sy){
  const i=zoomIdx(), ni=zoomNearest(z);
  if(ni===i) return false;
  const mid=Math.sqrt(ZOOMS[i]*ZOOMS[ni]);
  if(Math.abs(Math.log(Math.max(z,1e-6)/mid))<UI_PINCH_DEAD) return false;
  return setZoomIdx(ni,sx,sy);
}

/* ---------------- 4. THE TILE IN HAND ----------------
   The drawn tile, its rotation, the cells it may go on, and the ghost that
   follows the pointer. G.legal / G.legalRot / G.ghost / G.post are written here and
   read by render.js; nothing else in the app writes them. */
const UI_DRAG_PX=6;                       // a click is a click until it moves this far
let uiRot=0;                              // rotation of the tile in hand
let uiLegal={id:null, list:[], byKey:new Map()};
let uiLastPlace=null;                     // {x,y,rot,tileId} — the human's own last lay
let uiTabIdx=-1;
let uiLegalSig='';

function refreshLegal(force){
  const id=UiEng.drawn();
  // moveNo and step cover the brook, where legality changes without the board
  const sig=[id, G.moveNo|0, UiEng.turnIdx(), UiEng.mode(), UiEng.step(),
             (typeof board!=='undefined'&&board&&board.size)|0].join('|');
  if(!force && sig===uiLegalSig) return;
  uiLegalSig=sig;
  const list=id ? UiEng.legal(id) : [];
  const byKey=new Map();
  for(const c of list) byKey.set(cellKey(c.x,c.y), c);
  uiLegal={id, list, byKey};
  G.legal=list;
  if(id && !rotLegalSomewhere(uiRot)) uiRot=firstLegalRot();
  publishRot();
  uiTabIdx=-1;
  if(G.ghost) setGhost(G.ghost.x, G.ghost.y);
}
/* render.js narrows the legal-cell outlines to the cells the CURRENT rotation
   fits, and paints the tray tile at it */
function publishRot(){ G.legalRot=uiRot; G.trayRot=uiRot; G.rot=uiRot; }
function rotLegalSomewhere(r){
  for(const c of uiLegal.list) if(c.rots && c.rots.indexOf(r)>=0) return true;
  return false;
}
function firstLegalRot(){
  for(let r=0;r<4;r++) if(rotLegalSomewhere(r)) return r;
  return uiRot;
}
function cellRotOk(x,y,r){
  const c=uiLegal.byKey.get(cellKey(x,y));
  return !!(c && c.rots && c.rots.indexOf(r)>=0);
}
/* The ghost has two authors and only one of them is the pointer. While the
   pasture is showing where it means to play, a stray mouse move must not wipe
   the preview out from under it — and on a touch screen the armed first tap has
   to survive the pointerleave that follows a lift. */
function setGhost(x,y){
  if(uiAiGhostOn()) return;
  if(!UiEng.drawn() || !placingNow()){ if(!uiArmed) G.ghost=null; return; }
  G.ghost={ x, y, rot:uiRot, legal:cellRotOk(x,y,uiRot) };
}
function clearGhost(){ if(uiAiGhostOn()) return; G.ghost=null; }

/* Rotate auto-advances past rotations that fit nowhere on the board: a player
   should never have to press R four times to find the one that works. */
function uiRotate(dir){
  if(!UiEng.drawn()) return uiRot;
  const d=(dir<0)?-1:1;
  for(let i=1;i<=4;i++){
    const nr=((uiRot+d*i)%4+4)%4;
    if(!uiLegal.list.length || rotLegalSomewhere(nr)){ uiRot=nr; break; }
  }
  publishRot();
  if(G.ghost) setGhost(G.ghost.x,G.ghost.y);
  snd('rotate');
  updateTray();
  return uiRot;
}

function placingNow(){
  const s=UiEng.step();
  if(s) return uiScreen()==='game' && UiEng.humanTurn() && s==='place' && !!UiEng.drawn();
  return uiScreen()==='game' && UiEng.humanTurn() && !!UiEng.drawn() && !postingNow();
}
function postingNow(){
  const s=UiEng.step();
  if(s) return (s==='post'||s==='spot') && UiEng.humanTurn();
  return !!(G.post && G.post.opts && G.post.opts.length);
}

/* the illegal-drop answer: render.js tints the ghost red and shakes it for a
   few ticks off this stamp (and holds still under calm), plus a sound and words
   for anyone not watching the pixels. */
function badPlace(x,y,quiet){
  if(!G.ghost) G.ghost={x, y, rot:uiRot, legal:false};
  G.ghost.legal=false;
  G.ghost.badTick=(typeof G.tick==='number')?G.tick:0;
  // audio pan-x is CANVAS space 0..960, not a board cell (audio.js as-built)
  if(!quiet) snd('badPlace', panX(x));
  uiSpeak('that tile does not fit there');
}
/* the screen x of a cell's centre, clamped to the canvas, for positional sfx */
function panX(cx){
  const p=View.w2s(cx+0.5, 0);
  return clamp(p[0], 0, canvasW());
}

function tryPlaceAt(x,y){
  if(!placingNow()) return false;
  if(!cellRotOk(x,y,uiRot)){ badPlace(x,y); return false; }
  /* cleared BEFORE the engine runs, never after: place() resolves the turn
     inside itself, so a completion this very tile causes sets the flag on the
     way through and a clear afterwards would wipe the hint it just earned */
  hintFlags.completed=false;
  uiArmed=null;
  const id=UiEng.drawn(), who=UiEng.seatName(UiEng.turnIdx());
  const r=UiEng.place(x,y,uiRot);
  // game.js's place() sounds its own refusal; ours would be the second one
  if(r===false){ badPlace(x,y,true); return false; }
  uiLastPlace={x,y,rot:uiRot,tileId:id};
  logLine(who+' lays <b>'+UiEng.tileName(id)+'</b> at '+x+','+y);
  clearGhost();
  buildPostOpts();
  refreshLegal(true);
  updateTray();
  uiSpeak(UiEng.tileName(id)+' laid at '+x+', '+y
    + (postingNow() ? '. Post a shepherd, or skip.' : ''));
  return true;
}

/* The numbered discs. One per segment of the tile just laid, in segment order,
   so the number under the pointer is the number on the keyboard. game.js's
   postOptions() says which of them the rules will actually accept; the rest are
   drawn greyed with the name of whoever already herds them, because a choice
   that silently vanishes is worse than one that explains itself.
   Published as G.post — the shape render.js draws from. */
function buildPostOpts(){
  const p=UiEng.pending() || uiLastPlace;
  G.post=null;
  if(!p || !postingNow()) return null;
  const x=(p.x|0), y=(p.y|0);
  const t=UiEng.tile(p.tileId);
  if(!t || !t.segs) return null;
  const allowed=UiEng.postable();               // null when game.js has no list
  /* board.canPost answers "this feature is unclaimed" and nothing else — the
     supply is checked inside postShepherd. postOptions() already folds both in;
     the fallback has to do it by hand or it will offer a disc to a seat with no
     shepherds left. */
  const seat=UiEng.current();
  const spare=!seat || seat.supply==null || seat.supply>0;
  const opts=[];
  t.segs.forEach((s,i)=>{
    const ok = allowed ? (allowed.indexOf(i)>=0) : (spare && UiEng.canPost(x,y,i));
    let by=null;
    if(!ok){
      const f=UiEng.featureAt(x,y,i);
      const h=f && f.shepherds && f.shepherds[0];
      if(h && h.seat!=null) by=UiEng.seatName(h.seat);
    }
    opts.push({ n:i+1, seg:i, spot:s.spot||[32,32], ok, by,
                kind:s.t, x, y, rot:(p.rot|0) });
  });
  G.post={ x, y, rot:(p.rot|0), tileId:p.tileId, opts };
  return G.post;
}
function postOpts(){ return (G.post && G.post.opts) || []; }
function postDisc(n){
  if(!postingNow()) return false;
  const o=postOpts().find(p=>p.n===n);
  if(!o) return false;
  if(!o.ok){
    snd('ui');
    uiSpeak(o.by ? ('already herded by '+o.by) : 'that feature cannot take a shepherd');
    return false;
  }
  const who=UiEng.seatName(UiEng.turnIdx());
  const r=UiEng.post(o.seg);
  if(r===false) return false;              // game.js sounded the refusal already
  logLine(who+' posts a shepherd on the '+(UI_KIND[o.kind]||'feature'));
  G.post=null;
  updateTray();
  return true;
}
function postSkip(){
  if(!postingNow()) return false;
  const r=UiEng.skip();
  if(r===false) return false;
  G.post=null;
  updateTray();
  return true;
}
const UI_KIND={m:'meadow', l:'lane', f:'fold', s:'shrine', b:'brook'};
/* how many canvas pixels one CSS pixel is worth — the canvas is a fixed 960
   wide and CSS scales the element, so on a phone one finger-width of screen is
   two and a half canvas pixels' worth of target */
function cssToCanvas(){
  const r=(uiCv && uiCv.getBoundingClientRect) ? uiCv.getBoundingClientRect() : null;
  const w=r && r.width;
  return (w>0) ? (canvasW()/w) : 1;
}
/* NEAREST disc, not the first one within reach. The forgiving radius a finger
   needs is wide enough that two discs on one tile overlap, and first-match
   would then hand every tap in the overlap to whichever segment the tile
   happens to list first. Nearest-wins makes the enlargement safe; it is capped
   at a little over half a tile so a tap off the tile still misses everything.
   The DRAWN radius is untouched — render.js's disc and this test stay one
   thing, which is what makes the picture the target. */
function discAt(sx,sy){
  const drawn=View.discR()+2;                   // a couple of px of forgiveness
  const want=22*cssToCanvas();                  // 44 CSS px across, in canvas px
  const r=Math.max(drawn, Math.min(want, View.px()*0.55));
  const r2=r*r;
  let best=null, bd=Infinity;
  for(const o of postOpts()){
    const p=View.spot(o.x,o.y,o.rot,o.spot);
    const d=(sx-p[0])*(sx-p[0])+(sy-p[1])*(sy-p[1]);
    if(d<=r2 && d<bd){ bd=d; best=o; }
  }
  return best;
}

/* Tab walks the legal cells in reading order, and the camera goes with it —
   a keyboard player must never be shown a cursor that is off screen. */
function tabCells(){
  return uiLegal.list.slice().sort((a,b)=> a.y-b.y || a.x-b.x);
}
function tabCycle(dir){
  const list=tabCells();
  if(!list.length) return null;
  uiTabIdx = (uiTabIdx<0) ? (dir<0?list.length-1:0)
                          : ((uiTabIdx+dir)%list.length+list.length)%list.length;
  const c=list[uiTabIdx];
  if(c.rots && c.rots.indexOf(uiRot)<0){ uiRot=c.rots[0]; publishRot(); }
  G.tabCell={x:c.x,y:c.y};
  setGhost(c.x,c.y);
  centreOn(c.x,c.y);
  updateTray();
  uiSpeak('cell '+c.x+', '+c.y+(cellRotOk(c.x,c.y,uiRot)?', fits':''));
  return c;
}

/* ---------------- 5. POINTER ----------------
   One click-versus-drag threshold, one pinch, one wheel step. The DOM
   listeners do nothing but turn client coordinates into canvas pixels; the
   functions below are the input path, and the debug hooks call them directly. */
let uiPtrs=new Map(), uiPan=null, uiDragging=false, uiPinch=null;

/* ---- coarse pointers ----
   A finger has no hover and no pixel to speak of, so the same tap that a mouse
   can afford to treat as a decision has to be split in two: the first tap
   PROPOSES (the ghost appears, the tray says what will happen, LAY IT lights),
   the second COMMITS. Both laying a tile and posting a shepherd are permanent,
   which is the whole argument for it. The keyboard and the tray buttons are
   already explicit, so they commit on the first press and never arm.
   Which kind of pointer we are on follows the last one used, not the device: a
   laptop with a touchscreen should behave like a mouse until a finger arrives. */
let uiCoarse=!!(mq('(pointer: coarse)') && mq('(pointer: coarse)').matches);
let uiCoarseForced=null;                  // tests and the debug hook override
let uiArmed=null;                         // {kind:'cell'|'post', key, n}
function twoTap(){ return (uiCoarseForced===null) ? uiCoarse : uiCoarseForced; }
function notePointer(e){
  if(uiCoarseForced!==null) return;
  const t=e && e.pointerType;
  if(typeof t==='string' && t) uiCoarse=(t!=='mouse');
}
function armedFor(kind,key){ return !!(uiArmed && uiArmed.kind===kind && uiArmed.key===key); }
function arm(kind,key,n){ uiArmed={kind,key,n:(n==null?null:n)}; updateTray(); updateHint(); }
function disarm(){
  if(!uiArmed) return false;
  uiArmed=null;
  updateTray(); updateHint();
  return true;
}

function canvasPos(e){
  const r=(uiCv && uiCv.getBoundingClientRect) ? uiCv.getBoundingClientRect()
        : {left:0,top:0,width:canvasW(),height:canvasH()};
  const w=r.width||canvasW(), h=r.height||canvasH();
  return [ (e.clientX-r.left)*canvasW()/w, (e.clientY-r.top)*canvasH()/h ];
}
function uiDown(sx,sy,id){
  uiPtrs.set(id==null?1:id,{x:sx,y:sy});
  if(uiPtrs.size===2){
    const p=[...uiPtrs.values()];
    uiPinch={ d0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)||1, z0:uiView().zoom,
              mx:(p[0].x+p[1].x)/2, my:(p[0].y+p[1].y)/2 };
    uiPan=null; uiDragging=false;
    disarm();                              // a second finger is a gesture, not a tap
    return;
  }
  if(uiPtrs.size>2) return;
  const v=uiView();
  uiPan={ sx, sy, cx:v.cx, cy:v.cy };
  uiDragging=false;
}
function uiMove(sx,sy,id){
  if(uiPtrs.has(id==null?1:id)) uiPtrs.set(id==null?1:id,{x:sx,y:sy});
  if(uiPinch && uiPtrs.size>=2){
    const p=[...uiPtrs.values()];
    const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)||1;
    const mx=(p[0].x+p[1].x)/2, my=(p[0].y+p[1].y)/2;
    /* the anchor rides between the fingers rather than sitting where they first
       landed, so a pinch that also slides keeps the same patch of grass under
       it — which is the whole reason to anchor a zoom at all */
    if(mx!==uiPinch.mx || my!==uiPinch.my){
      const S=View.px(), v=uiView();
      v.cx-=(mx-uiPinch.mx)/S; v.cy-=(my-uiPinch.my)/S;
      uiPinch.mx=mx; uiPinch.my=my;
      clampView();
    }
    zoomTo(uiPinch.z0*(d/uiPinch.d0), mx, my);
    return;
  }
  if(uiPan){
    const dx=sx-uiPan.sx, dy=sy-uiPan.sy;
    if(!uiDragging && Math.hypot(dx,dy)>UI_DRAG_PX){
      uiDragging=true; G.dragging=true; disarm(); setCursor();
    }
    if(uiDragging){
      const p=View.px(), v=uiView();
      v.cx=uiPan.cx-dx/p; v.cy=uiPan.cy-dy/p;
      clampView();
      setHover(null);                      // a pan is not a hover
      return;
    }
  }
  const c=View.cellAt(sx,sy);
  setHover(c);
  setGhost(c[0],c[1]);
}
/* G.hover — the board cell under the pointer, published for render.js, which
   marks it in the moments there is no ghost to mark instead (the post window,
   an AI's turn, no tile in hand). Integer cells or null; render draws nothing
   when it is absent, so it is safe for it to be absent often. It is absent
   during a drag (a pan is not a hover) and off the game screen. */
function setHover(c){
  G.hover = (c && uiScreen()==='game') ? {x:c[0]|0, y:c[1]|0} : null;
}
function uiUp(sx,sy,id){
  uiPtrs.delete(id==null?1:id);
  if(uiPtrs.size<2) uiPinch=null;
  const wasDrag=uiDragging;
  uiPan=null; uiDragging=false; G.dragging=false; setCursor();
  if(wasDrag){ setHover(null); return false; }
  return uiClick(sx,sy);
}
function uiCancel(){
  uiPtrs.clear(); uiPan=null; uiPinch=null; uiDragging=false; G.dragging=false;
  setHover(null); setCursor();
}
/* a click on the board means whichever of the two things is currently on offer */
function uiClick(sx,sy){
  if(uiScreen()!=='game') return false;
  /* a tap while the pasture is playing means "get on with it" — it collapses
     the remaining waits up to your own turn, and changes no move */
  if(!UiEng.humanTurn()){ uiAiSkip=true; return false; }

  if(postingNow()){
    const d=discAt(sx,sy);
    if(!d){ disarm(); return false; }
    if(!d.ok){ disarm(); return postDisc(d.n); }   // postDisc says why it refused
    if(twoTap() && !armedFor('post',d.n)){
      arm('post',d.n,d.n);
      uiSpeak('post on the '+(UI_KIND[d.kind]||'feature')+'? tap it again to confirm');
      snd('ui');
      return false;
    }
    disarm();
    return postDisc(d.n);
  }

  const c=View.cellAt(sx,sy), k=cellKey(c[0],c[1]);
  if(twoTap() && placingNow() && !armedFor('cell',k)){
    if(!cellRotOk(c[0],c[1],uiRot)){ disarm(); badPlace(c[0],c[1]); return false; }
    setGhost(c[0],c[1]);
    arm('cell',k);
    uiSpeak('the tile fits at '+c[0]+', '+c[1]+'. Tap again to lay it.');
    snd('ui');
    return false;
  }
  disarm();
  return tryPlaceAt(c[0],c[1]);
}
function setCursor(){
  if(!uiCv || !uiCv.classList) return;
  uiCv.classList.toggle('panning', !!uiDragging);
  uiCv.classList.toggle('placing', !uiDragging && placingNow());
}

/* ---------------- 6. CHROME ----------------
   Everything above and below the board. Written only when something changed:
   this runs every animation frame, and a live region spoken at 60Hz turns a
   screen reader into a metronome. */
let chipSig='', barSig='', traySig='', spoken='', hintOff=false, logOpen=false;
const uiLog=[];

function uiSpeak(msg){
  const sr=el('sr');
  if(!sr) return;
  if(msg===spoken) return;
  spoken=msg; sr.textContent=msg;
}
/* The teaching hints get a live region of their OWN. They shared #sr at first,
   and lost every time: updateChrome writes the turn banner last, on every
   frame, so a hint announced at the top of the call was gone by the bottom of
   it. Two regions with one writer each need no arbitration and cannot race. */
let spokenHint='';
function uiSpeakHint(html){
  const sr=el('srHint');
  if(!sr) return;
  const msg=String(html||'').replace(/<[^>]*>/g,'')
    .replace(/&middot;/g,'.').replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
  if(msg===spokenHint) return;
  spokenHint=msg; sr.textContent=msg;
}
function logLine(html){
  uiLog.push(html);
  if(uiLog.length>12) uiLog.shift();
  drawLog();
}
function drawLog(){
  const box=el('logLines');
  if(!box) return;
  box.innerHTML=uiLog.slice(-3).map(l=>'<div class="ln">'+l+'</div>').join('');
  const ml=el('movelog');
  if(ml && ml.classList) ml.classList.toggle('collapsed', !logOpen);
  const tg=el('logToggle');
  if(tg){ attr(tg,'aria-expanded', logOpen?'true':'false'); tg.textContent = logOpen?'MOVES ▾':'MOVES'; }
}
function toggleLog(on){
  logOpen = (on===undefined) ? !logOpen : !!on;
  drawLog();
}
/* The move log is a DOM overlay on the board's bottom-left corner, and
   render.js reserves a caption band along the bottom of #cv for the reveal
   walkthrough's arithmetic. They would sit on top of each other. The log is the
   one with nothing to say during the counting — it reports the last few things
   that scored, which is exactly what the walkthrough is narrating in full — so
   it stands down for the duration and comes back on the end card. */
let logHidden=false;
function updateLogVisibility(){
  const away=(UiEng.mode()==='reveal');
  if(away===logHidden) return;
  logHidden=away;
  const ml=el('movelog');
  if(ml && ml.classList) ml.classList.toggle('hidden', away);
}

function shepherdPips(s){
  const left=(s && s.supply!=null) ? (s.supply|0) : SHEPHERDS;
  return '•'.repeat(clamp(left,0,SHEPHERDS)) + '·'.repeat(clamp(SHEPHERDS-left,0,SHEPHERDS));
}
function buildChips(){
  const box=el('seatChips');
  if(!box) return;
  box.innerHTML='';
  const seats=UiEng.seats(), turn=UiEng.turnIdx();
  const thinking=uiAiThinking() ? turn : -1;
  seats.forEach((s,i)=>{
    const busy=(i===thinking);
    const c=mkEl('div','chip'+(i===turn?' turn':'')+(s.human?'':' ai')+(busy?' think':''));
    const sw=mkEl('span','sw'); if(sw.style) sw.style.background=UiEng.seatColor(i);
    c.appendChild(sw);
    c.appendChild(mkEl('span','nm', String(s.name||('SEAT '+(i+1))).toUpperCase()));
    /* The seat that is working says so on its own chip, where the player is
       already looking to see whose turn it is. Three SQUARES, drawn in CSS
       rather than written as characters: the shepherd pips right beside them
       are round dots, and a row of round dots next to a row of round dots reads
       as one number nobody can parse. Shape and colour both differ, so the two
       cannot be confused even at a glance or in monochrome. */
    if(busy){
      const t=mkEl('span','tk');
      t.appendChild(mkEl('i')); t.appendChild(mkEl('i')); t.appendChild(mkEl('i'));
      attr(t,'aria-hidden','true');
      c.appendChild(t);
    }
    c.appendChild(mkEl('span','pips', shepherdPips(s)));
    c.appendChild(mkEl('span','sc', String(s.score|0)));
    attr(c,'aria-label', (s.name||('seat '+(i+1)))+', '+(s.score|0)+' points, '
      +((s.supply!=null?s.supply:SHEPHERDS)|0)+' shepherds in hand'
      +(i===turn?(busy?', thinking':', playing now'):''));
    box.appendChild(c);
  });
}
function updateChips(){
  const seats=UiEng.seats();
  const sig=UiEng.turnIdx()+'|'+(uiAiThinking()?'t':'-')+'|'+seats.map(s=>
    (s.name||'')+':'+(s.score|0)+':'+(s.supply!=null?s.supply:SHEPHERDS)).join(',');
  if(sig===chipSig) return;
  chipSig=sig;
  buildChips();
}
function updateBar(){
  const sig=UiEng.satchel()+'/'+UiEng.dead()+'/'+JSON.stringify((G.config&&G.config.modules)||{});
  if(sig!==barSig){
    barSig=sig;
    uiText('hSatchel', uiScreen()==='menu' ? '—'
      : String(UiEng.satchel()) + (UiEng.dead()?(' · '+UiEng.dead()+' ASIDE'):''));
    const mods=el('hModules');
    if(mods){
      mods.innerHTML='';
      const m=(G.config && G.config.modules) || {};
      for(const k in m) if(m[k]) mods.appendChild(mkEl('span','modchip', k.toUpperCase()));
    }
  }
  const info=el('hoverinfo');
  if(info) info.textContent=bannerText();
}
/* the DOM turn banner: render.js paints one on the canvas too, and they say the
   same words — this one is what a screen reader and a stalled canvas still get */
function bannerText(){
  const m=UiEng.mode();
  if(m==='menu') return '';
  if(m==='end') return 'FINAL COUNT';
  const s=UiEng.current();
  if(!s) return '';
  const who=String(s.name||'').toUpperCase();
  if(m==='reveal') return 'COUNTING THE MEADOWS';
  // the engine's own banner speaks for the seats it is driving
  if(!s.human) return (G.banner ? String(G.banner).toUpperCase()
                                : who+' IS '+(m==='brook'?'LAYING THE BROOK':'PLACING')+'…');
  if(postingNow()) return 'POST A SHEPHERD, OR SKIP';
  if(UiEng.drawn()) return 'YOUR TURN — LAY THE TILE';
  return 'YOUR TURN';
}
function hintFor(){
  if(uiScreen()!=='game') return '';
  if(!UiEng.humanTurn())
    return 'the pasture is thinking &middot; hold <b>F</b> or tap the board to hurry it along';
  if(postingNow())
    return '<b>1–9</b> post a shepherd on that segment &middot; <b>0</b> or <b>SPACE</b> to skip '
         + '&middot; a grey disc is a feature somebody already herds';
  if(twoTap())
    return 'drag to pan &middot; pinch to zoom &middot; tap the tile to rotate &middot; '
         + 'tap a cell, then tap again to lay it';
  return 'drag to pan &middot; wheel to zoom &middot; <b>R</b> or right-click rotates &middot; '
       + 'click lays the tile &middot; <b>TAB</b> walks the legal cells &middot; <b>ENTER</b> lays';
}

/* ---- the first-game hints ----
   Four things this genre reliably fails to explain, said once each, at the
   moment they are true rather than in a wall of text at the start. Each is
   retired the moment its situation passes, so a hint you read and acted on does
   not come back; "seen" lives in prefs, so it does not come back next game
   either. NO MORE HINTS retires the lot; the settings toggle brings them back.
   The wording follows the pointer — "tap … then tap again" is a different
   instruction from "click", and telling a phone to click is how a tutorial
   loses somebody on the first move. */
let hintFlags={};                         // per-game one-shots the flow watches
let hintCur=null;                         // the teaching hint on screen right now
const UI_HINT_ROWS=[
  { id:'done', see:()=>!!hintFlags.completed,
    text:()=>'<b>THAT FEATURE IS FINISHED.</b> Whoever had the most shepherds on it '
      +'took the whole score — a tie pays everybody tied — and every shepherd '
      +'standing on it has just walked home to its supply, ready to post again.' },
  { id:'brook', see:()=>UiEng.mode()==='brook' && placingNow(),
    text:()=>'<b>THE BROOK OPENS THE GAME.</b> Before the satchel, the water runs out '
      +'from the spring and the lakes cap its ends. The brook itself never scores, '
      +'but it divides the meadows exactly as a lane does — so where it goes decides '
      +'how big your grass ends up being. You may post a shepherd during it.' },
  { id:'post', see:()=>postingNow(),
    text:()=>(twoTap()
        ? 'tap a numbered disc — then tap it again to confirm — or press <b>SKIP</b>. '
        : '<b>POST A SHEPHERD?</b> Click a numbered disc, press <b>1–9</b>, or <b>SKIP</b>. ')
      +'You have seven in all, and one only comes back when the feature it stands on '
      +'is finished. A grey disc is a feature somebody already herds.' },
  { id:'place', see:()=>UiEng.mode()==='play' && placingNow(),
    text:()=>(twoTap()
        ? '<b>YOUR TURN.</b> Tap a glowing cell to try the tile there, then tap again to lay it. '
        : '<b>YOUR TURN.</b> Click a glowing cell to lay the tile. ')
      +'Only the cells where it fits are lit; <b>R</b> or the tray tile turns it. '
      +'Every side that touches must match.' },
];
function hintsOn(){ return !uiPref('hintsOff',false); }
function hintSeenMap(){ const s=uiPref('hintsSeen',null); return (s && typeof s==='object')?s:{}; }
function hintSeen(id){ return !!hintSeenMap()[id]; }
function hintMarkSeen(id){
  if(!id || hintSeen(id)) return;
  const s=Object.assign({},hintSeenMap());
  s[id]=true;
  uiPrefSet('hintsSeen',s);
}
function hintReset(){ hintFlags={}; hintCur=null; }
/* bringing the hints back has to forget what was seen too, or the toggle turns
   on a flow with nothing left in it */
function hintsEnable(on){
  uiPrefSet('hintsOff', !on);
  if(on) uiPrefSet('hintsSeen',{});
  hintReset();
  updateHint();
  applyToggleLabels();
}
function hintRow(){
  if(!hintsOn() || uiScreen()!=='game') return null;
  for(const r of UI_HINT_ROWS){
    if(hintSeen(r.id)) continue;
    let on=false;
    try{ on=!!r.see(); }catch(e){}
    if(on) return r;
  }
  return null;
}
/* dismiss: the ✕ retires whichever hint is up. On the standing control strip it
   keeps its old meaning — quiet for this session only. */
function hintDismiss(){
  if(hintCur){
    hintMarkSeen(hintCur);
    if(hintCur==='done') hintFlags.completed=false;
    hintCur=null;
    updateHint();
    return true;
  }
  hintOff=true;
  updateHint();
  return false;
}
function updateHint(){
  const ht=el('hintText'), hb=el('hintbar'), hs=el('hintSkip');
  const row=hintRow();
  const was=hintCur;
  /* a hint whose moment has passed is retired without being clicked: reading it
     and doing the thing it asked for is the most complete dismissal there is */
  if(hintCur && (!row || row.id!==hintCur)){ hintMarkSeen(hintCur); hintCur=null; }
  if(row) hintCur=row.id;
  const teach=!!row;
  const hint = teach ? row.text() : (hintOff?'':hintFor());
  if(ht) ht.innerHTML=hint;
  if(hb && hb.classList){
    hb.classList.toggle('off', !hint);
    hb.classList.toggle('teach', teach);
  }
  if(hs) hs.hidden=!teach;
  if(teach && hintCur!==was) uiSpeakHint(hint);
  else if(!teach) uiSpeakHint('');
}
function updateTray(){
  const id=UiEng.drawn();
  const posting=postingNow();
  /* game.js clears G.drawn the moment the tile lands, so through the post
     window the tray has to name the tile that is now ON the board — otherwise
     the panel reads "the satchel, waiting" at the exact moment it is waiting
     on YOU. */
  const laid=(posting && G.post) ? G.post.tileId : null;
  const shown=id||laid;
  const sig=[shown, uiRot, posting?'p':'-', UiEng.humanTurn(), uiLegal.list.length,
             uiScreen(), uiArmed?(uiArmed.kind+':'+uiArmed.key):'-',
             posting ? postOpts().map(o=>o.n+(o.ok?'+':'-')).join('') : ''].join('|');
  if(sig===traySig) return;
  traySig=sig;
  const info=el('trayInfo');
  if(info){
    info.innerHTML='';
    const name=mkEl('div','tname'), sub=mkEl('div','tsub');
    if(shown){
      name.textContent=UiEng.tileName(shown);
      const armedCell=!!(uiArmed && uiArmed.kind==='cell' && G.ghost);
      const armedPost=!!(uiArmed && uiArmed.kind==='post');
      sub.innerHTML = armedPost
        ? 'tap that disc <em>again</em> to post the shepherd, or choose another'
        : armedCell
        ? 'it will go here &middot; tap again, or <em>LAY IT</em>, to commit'
        : posting
        ? 'laid &middot; <em>post a shepherd</em> on a numbered disc, or skip'
        : (uiLegal.list.length + ' place' + (uiLegal.list.length===1?'':'s')
           + ' it will go &middot; rotation <em>' + (uiRot*90) + '&deg;</em>');
    }else{
      name.textContent = uiScreen()==='game' ? 'THE SATCHEL' : 'WOOLDOM';
      sub.innerHTML = uiScreen()==='game' ? 'waiting on the turn…' : 'no game in play';
    }
    info.appendChild(name); info.appendChild(sub);
  }
  buildTrayBtns();
  setCursor();
}
function updateChrome(){
  syncScreens();
  refreshLegal(false);
  if(G.post && !postingNow()) G.post=null;
  else if(!G.post && postingNow()) buildPostOpts();
  updateChips();
  updateBar();
  updateTray();
  updateHint();
  /* G.skipFx — the one boolean render.js needs to answer "collapse this ease".
     There are THREE ways a player asks for that (F held, the persisted SKIP AI
     ANIMATION setting, and a tap on the board to hurry the turn along), and
     render reading only G.fast would honour one of them: the setting would
     shorten ui.js's waits while render kept playing full-length eases over the
     top, which is worse than not having the setting. One flag, one meaning. */
  G.skipFx=uiAiFast();
  updateLogVisibility();
  if(uiScreen()!=='game') setHover(null);
  const b=bannerText();
  if(uiScreen()==='game') uiSpeak(b);
}
/* game.js calls updateHud() at every point where it has changed something the
   chrome shows — the same name Burned Ground used, so the engine's nudges land
   here instead of waiting for the next frame. */
function updateHud(){ updateChrome(); }

/* ---------------- 6b. THE AI'S TURN, AT A WATCHABLE PACE ----------------
   game.js resolves AI turns inside place() when G.autoAI is on, which finishes
   a four-seat round before the screen has drawn once. G.autoAI is documented as
   ui.js's flag: we take it off and let the turn land on its own beat instead,
   so the player can see what the pasture just did to them.

   Four beats: THINK (the seat chip works), GHOST (the tile it settled on, shown
   where it is about to land), the commit, then SETTLE (a breath in which the
   floaters and the completion flash are the only things moving). The whole turn
   is about a second.

   THE PROMISE, and the line every change here has to stay on the right side of:
   F, a tap on the board, and the SKIP AI ANIMATION setting collapse the WAIT.
   They never touch the thinking. Every beat below is a pure delay around calls
   that happen in the same order with the same arguments either way, so a game
   played with the animation skipped is bit-identical to one watched in full —
   test/uiflow.js asserts exactly that, by stateHash, and it is the reason the
   skip is a wait-length question and never a branch around aiMove.

   Time comes from the frame timestamp, not from the wall clock: rAF hands the
   browser's own DOMHighResTimeStamp to uiFrame, and a headless suite hands
   uiFrameOnce whatever timestamps it likes. One clock, no test-only path. */
const UI_AI_THINK=300, UI_AI_GHOST=400, UI_AI_SETTLE=300, UI_AI_SETTLE_MAX=700;
let uiAiBeat=null;          // {state:'think'|'ghost'|'settle', t0, seat, move, plan}
let uiAiSkip=false;         // a tap on the board: fast-forward to the human again
let uiNowTs=0;              // the timestamp of the frame being served

/* Skipping is three switches OR'd: F held, the persisted setting, and the
   one-shot a board tap arms. */
function uiAiFast(){ return !!(G.fast || uiPref('skipAI',false) || uiAiSkip); }
function uiAiElapsed(ms,t0){ return uiAiFast() || (uiNowTs-t0)>=ms; }

/* The settle is a breath for the feedback the turn just produced, so its length
   ought to be that feedback's rather than a number I picked: a flat 300ms cut a
   completed fold's celebration off half way through and started the next seat
   thinking over the top of it. render.js's rnBusy() is true while any flash,
   floater, wool puff, shepherd drop-in or tile settle is still on screen.
   CAPPED REGARDLESS. rnBusy is documented to fall false on its own, and I
   believe it — but its queues are reaped in RENDER frames, so any page or
   harness that stops calling render() leaves it stuck true forever, and a
   pacing loop that trusted it would hang the whole game rather than merely
   mistime it. The cap is what makes gating on another module's liveness safe. */
function uiRnBusy(){
  if(typeof rnBusy!=='function') return false;
  try{ return !!rnBusy(); }catch(e){ return false; }
}
function uiAiSettled(t0){
  if(uiAiFast()) return true;
  const dt=uiNowTs-t0;
  if(dt<UI_AI_SETTLE) return false;          // the breath is owed either way
  if(dt>=UI_AI_SETTLE_MAX) return true;      // and it is never open-ended
  return !uiRnBusy();
}

/* ai.js's plan is only reachable before the tile lands if ai.js offers a pure
   dry-run — aiMove itself places on its way through, so by the time it returns
   there is nothing left to preview. Without one the ghost beat has nothing to
   show and folds away; the cadence keeps its length via the think beat, and the
   turn is otherwise identical. Never re-derive the choice here: ai.js's noise is
   module-private, and a second argmax in ui.js would be a second answer. */
function uiAiPlanFor(seat){
  /* ai-w2's gate, and it is theirs to insist on: plan() deliberately does NOT
     draw, because draw() pops the satchel, can retire a dead tile and can close
     the brook phase — a preview with consequences is not a preview. So it is
     only meaningful with a tile already in hand, and asking without one is
     meaningless work on a path that runs every frame. */
  if(UiEng.step()!=='place' || UiEng.drawn()==null) return null;
  const A=aiTable();
  const f=(A && typeof A.plan==='function') ? A.plan
        : (typeof aiPlan==='function') ? aiPlan : null;
  if(!f) return null;
  try{
    const p=f(seat);
    return (p && typeof p.x==='number' && typeof p.y==='number') ? p : null;
  }catch(e){ return null; }
}
/* The AI's preview rides on G.ghost, which render.js already draws (G.drawn is
   the AI's tile from beginTurn). `ai` names the seat, so render may colour it
   differently — nothing breaks if it does not. */
function uiAiGhostOn(){ return !!(G.ghost && G.ghost.ai!=null); }
function uiAiShowGhost(plan,seat){
  G.ghost={ x:plan.x|0, y:plan.y|0, rot:plan.rot|0, legal:true, ai:seat };
}
function uiAiState(){ return (uiAiBeat && uiAiBeat.state) || ''; }
function uiAiPublish(){ G.aiState=uiAiState(); }
function uiAiClear(){
  if(uiAiGhostOn()) G.ghost=null;
  uiAiBeat=null;
  uiAiPublish();
}
/* the beats only mean anything while a seat is thinking; a settle is the board
   catching its breath and must not leave a chip spinning */
function uiAiThinking(){ const s=uiAiState(); return s==='think'||s==='ghost'; }

function pumpAiTurn(){
  const m=UiEng.mode();
  if(m!=='play' && m!=='brook'){ uiAiClear(); return; }

  /* The settle outlives the turn that earned it: resolveTurn has already passed
     the crook by the time we get here, so this beat is deliberately keyed to
     nothing — it simply runs out before the next seat may start thinking. */
  if(uiAiBeat && uiAiBeat.state==='settle'){
    if(!uiAiSettled(uiAiBeat.t0)){ uiAiPublish(); return; }
    uiAiBeat=null;
  }

  const s=UiEng.current();
  if(!s || s.human || UiEng.step()!=='place'){
    if(s && s.human) uiAiSkip=false;       // the fast-forward ends where it was aimed
    uiAiClear();
    return;
  }
  if(typeof aiMove!=='function'){          // no ai.js: let the engine drive itself
    G.autoAI=true;
    if(typeof pumpAI==='function') pumpAI();
    return;
  }

  const seat=UiEng.turnIdx(), move=G.moveNo|0;
  if(!uiAiBeat || uiAiBeat.seat!==seat || uiAiBeat.move!==move)
    uiAiBeat={ state:'think', t0:uiNowTs, seat, move, plan:null };
  const b=uiAiBeat;

  if(b.state==='think'){
    if(!uiAiElapsed(UI_AI_THINK, b.t0)){ uiAiPublish(); return; }
    b.plan=uiAiPlanFor(seat);
    b.t0=uiNowTs;
    if(b.plan){ uiAiShowGhost(b.plan, seat); b.state='ghost'; }
    else b.state='commit';
  }
  if(b.state==='ghost'){
    if(!uiAiElapsed(UI_AI_GHOST, b.t0)){ uiAiPublish(); return; }
    b.state='commit';
  }

  if(uiAiGhostOn()) G.ghost=null;          // the real tile is about to take its place
  const before=G.moveNo|0;
  aiMove(seat);
  /* An AI that declines to move would leave the game sitting here for good;
     hand the turn back to the engine's own pump rather than stall the game. */
  if((G.moveNo|0)===before){
    uiAiBeat=null;
    uiAiPublish();
    G.autoAI=true;
    if(typeof pumpAI==='function') pumpAI();
    return;
  }
  uiAiBeat={ state:'settle', t0:uiNowTs, seat:-1, move:-1, plan:null };
  uiAiPublish();
}

/* ---------------- 7. SCREENS ----------------
   Three of them — menu, game, end — driven from G.mode rather than from
   whoever clicked last, because the engine can end a game without asking. */
let uiLastScreen=null;
function uiScreen(){
  const m=UiEng.mode();
  return (m==='menu') ? 'menu' : (m==='end') ? 'end' : 'game';
}
function syncScreens(){
  const s=uiScreen();
  if(s===uiLastScreen) return;
  const prev=uiLastScreen;
  uiLastScreen=s;
  if(s==='menu'){ uiShow('menu'); uiHide('end'); buildMenu(); }
  else uiHide('menu');
  if(s==='end'){ buildEnd(); uiShow('end'); }
  else uiHide('end');
  if(s!=='menu' && prev==='menu') toggleSettings(false);
  chipSig=''; barSig=''; traySig='';
}

/* ---- the menu ---- */
const UI_DIFFS=[['LAMB','lamb'],['EWE','ewe'],['RAM','ram']];
const UI_FALLBACK_PERSONAS=[
  {id:'wick', name:'Old Wick', school:'Steadwright'},
  {id:'bram', name:'Bram',     school:'Thornhedge'},
  {id:'maud', name:'Maud',     school:'Meadowlord'},
  {id:'pip',  name:'Pip',      school:'Waywalker'},
];
/* ai.js is the single source for who exists and what they are called: the
   picker is built from AI.PERSONALITIES / AI.DIFFICULTY rather than from a copy
   kept here, so the menu that names a seat and the evaluator that plays it
   cannot drift apart. The *_ORDER arrays decide the order — the tables are
   objects, and a replay must not depend on property insertion order. The
   fallback table is for a page where ai.js never loaded at all. */
function aiTable(){
  if(typeof AI!=='undefined' && AI) return AI;
  if(typeof AI_PERSONALITIES!=='undefined') return {PERSONALITIES:AI_PERSONALITIES};
  return null;
}
function personas(){
  const A=aiTable(), T=A && A.PERSONALITIES;
  if(T && typeof T==='object' && !Array.isArray(T)){
    const order=(A.PERSONALITY_ORDER && A.PERSONALITY_ORDER.length)
      ? A.PERSONALITY_ORDER : Object.keys(T);
    const out=[];
    for(const id of order){
      const r=T[id];
      if(!r) continue;
      out.push({ id:(r.key||id), name:r.name||titleCase(id),
                 school:r.house||r.school||'', blurb:r.blurb||'' });
    }
    if(out.length) return out;
  }
  if(Array.isArray(T) && T.length){
    return T.map(r=> typeof r==='string'
      ? {id:r, name:titleCase(r), school:'', blurb:''}
      : {id:(r.id||r.key), name:r.name||titleCase(r.id||r.key),
         school:r.house||r.school||'', blurb:r.blurb||''});
  }
  return UI_FALLBACK_PERSONAS;
}
/* [LABEL, id, tooltip] rows for the difficulty segment */
function difficulties(){
  const A=aiTable(), T=A && A.DIFFICULTY;
  if(T && typeof T==='object'){
    const order=(A.DIFFICULTY_ORDER && A.DIFFICULTY_ORDER.length)
      ? A.DIFFICULTY_ORDER : Object.keys(T);
    const out=[];
    for(const id of order){
      const r=T[id];
      if(!r) continue;
      const nm=r.name||titleCase(id);
      out.push([nm.toUpperCase(), (r.key||id),
        r.sigma!=null ? (nm+' — misreads its own count by about '+r.sigma
                          +(r.sigma===1?' point':' points'))
                      : nm]);
    }
    if(out.length) return out;
  }
  return UI_DIFFS;
}
function personaName(id){
  for(const p of personas()) if(p.id===id) return p.name;
  return titleCase(id);
}
const uiSetup={
  seats:2,
  name:'',
  ai:[{p:'wick',d:'ewe'},{p:'bram',d:'ewe'},{p:'maud',d:'ewe'},{p:'pip',d:'ewe'}],
  modules:{brook:true},
  seed:'',
};
(function restoreSetup(){
  const s=uiPref('setup',null);
  if(!s || typeof s!=='object') return;
  if(s.seats) uiSetup.seats=clamp(s.seats|0,2,5);
  if(typeof s.name==='string') uiSetup.name=s.name;
  if(Array.isArray(s.ai)) s.ai.forEach((r,i)=>{ if(uiSetup.ai[i] && r) uiSetup.ai[i]={p:r.p||'wick',d:r.d||'ewe'}; });
  if(s.modules && typeof s.modules==='object') uiSetup.modules=Object.assign(uiSetup.modules,s.modules);
})();
function saveSetup(){ uiPrefSet('setup', uiSetup); }

let menuView='root';
function showMenu(){
  G.mode='menu'; uiLastScreen='menu';
  uiHide('end'); uiShow('menu');
  clearGhost(); G.post=null; uiLastPlace=null;
  buildMenu();
  if(typeof Snd!=='undefined' && Snd){
    if(Snd.musicIntensity) Snd.musicIntensity(0);
    if(Snd.musicStart) Snd.musicStart('menu');
  }
}
function segRow(label,opts,cur,fn,aria){
  const r=mkEl('div','setuprow');
  r.appendChild(mkEl('span','slbl',label));
  const g=mkEl('div','dirseg');
  attr(g,'role','group'); attr(g,'aria-label',aria||label);
  opts.forEach(o=>{
    const on=(o[1]===cur);
    const b=mkEl('button','dbtn'+(on?' on':''), o[0]);
    b.type='button';
    if(o[2]) b.title=o[2];
    attr(b,'aria-pressed', on?'true':'false');
    attr(b,'aria-label', (aria||label)+': '+(o[2]||o[0]));
    onAct(b,()=>{ snd('ui'); fn(o[1]); saveSetup(); buildMenu(); });
    g.appendChild(b);
  });
  r.appendChild(g);
  return r;
}
function buildMenu(){
  const root=el('menuRoot');
  if(!root) return;
  root.innerHTML='';
  if(menuView==='help'){ buildHelp(root); return; }

  const box=mkEl('div'); box.id='setupbox';
  box.appendChild(segRow('SEATS',[['2',2],['3',3],['4',4],['5',5]],uiSetup.seats,
    v=>{ uiSetup.seats=v; },'Number of seats'));

  /* seat 1 is the human, always: this is a solo game against the pasture */
  const you=mkEl('div','setuprow seat');
  const dot=mkEl('span','pdot'); if(dot.style) dot.style.background=PAL.p1;
  you.appendChild(dot);
  you.appendChild(mkEl('span','who','YOU'));
  const nm=document.createElement('input');
  nm.type='text'; nm.className='tinput nameinput'; nm.maxLength=12; nm.id='nameIn';
  nm.value=uiSetup.name; nm.placeholder='SHEPHERD';
  attr(nm,'aria-label','Your name');
  if(nm.addEventListener) nm.addEventListener('input',()=>{ uiSetup.name=nm.value; saveSetup(); });
  you.appendChild(nm);
  you.appendChild(mkEl('span','note','seat one, and the only pair of hands'));
  box.appendChild(you);

  const plist=personas();
  for(let i=1;i<uiSetup.seats;i++){
    const cfg=uiSetup.ai[i-1];
    const row=mkEl('div','setuprow seat');
    const d=mkEl('span','pdot'); if(d.style) d.style.background=PAL['p'+(i+1)];
    row.appendChild(d);
    row.appendChild(mkEl('span','who','SEAT '+(i+1)));
    const g=mkEl('div','dirseg');
    attr(g,'role','group'); attr(g,'aria-label','Seat '+(i+1)+' opponent');
    plist.forEach(p=>{
      const on=(p.id===cfg.p);
      const b=mkEl('button','dbtn'+(on?' on':''), p.name.toUpperCase());
      b.type='button';
      b.title=[p.name, p.school, p.blurb].filter(Boolean).join(' — ');
      attr(b,'aria-pressed', on?'true':'false');
      attr(b,'aria-label','Seat '+(i+1)+' plays as '+p.name+(p.school?', the '+p.school+' school':''));
      onAct(b,()=>{ snd('ui'); cfg.p=p.id; saveSetup(); buildMenu(); });
      g.appendChild(b);
    });
    row.appendChild(g);
    const gd=mkEl('div','dirseg');
    attr(gd,'role','group'); attr(gd,'aria-label','Seat '+(i+1)+' difficulty');
    difficulties().forEach(o=>{
      const on=(o[1]===cfg.d);
      const b=mkEl('button','dbtn'+(on?' on':''), o[0]);
      b.type='button';
      b.title=o[2]||o[0];
      attr(b,'aria-pressed', on?'true':'false');
      attr(b,'aria-label','Seat '+(i+1)+' difficulty '+o[0]);
      onAct(b,()=>{ snd('ui'); cfg.d=o[1]; saveSetup(); buildMenu(); });
      gd.appendChild(b);
    });
    row.appendChild(gd);
    box.appendChild(row);
  }

  /* modules: brook ships now, packs push their own rows through Hooks.menu */
  const mods=mkEl('div','setuprow');
  mods.appendChild(mkEl('span','slbl','MODULES'));
  const mg=mkEl('div','dirseg');
  attr(mg,'role','group'); attr(mg,'aria-label','Modules');
  const modRows=[{key:'brook', label:'BROOK', title:'The brook opens the game, branching from the spring'}];
  if(typeof Hooks!=='undefined' && Hooks && Array.isArray(Hooks.menu)){
    for(const r of Hooks.menu){
      if(typeof r==='function'){ try{ r(mods); }catch(e){} continue; }
      if(r && r.key) modRows.push(r);
    }
  }
  modRows.forEach(r=>{
    if(uiSetup.modules[r.key]===undefined) uiSetup.modules[r.key]=!!r.def;
    const on=!!uiSetup.modules[r.key];
    const b=mkEl('button','dbtn'+(on?' on':''), r.label+(on?' ON':' OFF'));
    b.type='button';
    if(r.title) b.title=r.title;
    attr(b,'aria-pressed', on?'true':'false');
    attr(b,'aria-label', r.label+' module '+(on?'on':'off'));
    onAct(b,()=>{ snd('ui'); uiSetup.modules[r.key]=!uiSetup.modules[r.key]; saveSetup(); buildMenu(); });
    mg.appendChild(b);
  });
  mods.appendChild(mg);
  box.appendChild(mods);

  const seedRow=mkEl('div','setuprow');
  seedRow.appendChild(mkEl('span','slbl','SEED'));
  const si=document.createElement('input');
  si.type='text'; si.className='tinput seedinput'; si.id='seedIn'; si.maxLength=12;
  si.value=uiSetup.seed; si.placeholder='random';
  attr(si,'aria-label','Seed — leave blank for a random pasture');
  if(si.addEventListener) si.addEventListener('input',()=>{ uiSetup.seed=si.value; });
  seedRow.appendChild(si);
  seedRow.appendChild(mkEl('span','note','the same seed deals the same satchel'));
  box.appendChild(seedRow);
  root.appendChild(box);

  const btns=mkEl('div','btnrow');
  const start=mkEl('button','bigbtn','START'); start.type='button';
  onAct(start,()=>{ snd('ui'); startFromMenu(); });
  btns.appendChild(start);
  if(UiEng.hasSave()){
    const r=mkEl('button','bigbtn ghost','RESUME'); r.type='button';
    r.title='Pick up the saved game';
    onAct(r,()=>{ snd('ui'); resumeFromMenu(); });
    btns.appendChild(r);
  }
  const h=mkEl('button','bigbtn ghost','HOW TO PLAY'); h.type='button';
  onAct(h,()=>{ snd('ui'); menuView='help'; buildMenu(); });
  btns.appendChild(h);
  root.appendChild(btns);
}
/* Nine cells of DOM, no canvas: the help page has to work before art.js has
   painted anything and inside test/shim.js's noop-canvas, and a picture of the
   meadow rule is worth more than another paragraph about it. */
function meadowDiagram(){
  const cell=(cls,txt)=>'<span class="'+cls+'">'+(txt||'')+'</span>';
  return '<div class="mdiag">'
    + '<div class="mgrid" role="img" aria-label="A meadow with two finished folds '
    + 'on it and one shepherd sitting on the grass. Two finished folds pay three '
    + 'each, so the meadow is worth six points.">'
    +   cell('mc m') + cell('mc f','FOLD') + cell('mc m')
    +   cell('mc m') + cell('mc m sh','▲')  + cell('mc m')
    +   cell('mc f','FOLD') + cell('mc m') + cell('mc m')
    + '</div>'
    + '<div class="mcap">One meadow (the grass), two <b>finished</b> folds touching it, '
    + 'one shepherd sitting on it. That meadow pays <b>3 × 2 = 6</b> — the amount of '
    + 'grass never enters into it. An unfinished fold pays the meadow nothing.</div>'
    + '</div>';
}
function buildHelp(root){
  const d=mkEl('div','help');
  d.innerHTML=
    '<p><b>THE TURN.</b> Draw a tile from the satchel and lay it against what is '
    +'already on the table, so that every side it touches matches: meadow to meadow, '
    +'lane to lane, fold wall to fold wall. Then you may post one shepherd onto a '
    +'single feature of the tile you just laid — but only if nobody is herding that '
    +'feature already, anywhere along it.</p>'
    +'<p><b>WHAT SCORES.</b> A <b>lane</b> pays 1 a tile, a <b>fold</b> pays 2 a tile '
    +'and 2 more for each prize ram inside it, a <b>shrine</b> pays 9 once all eight '
    +'cells around it are filled. Whoever has the most shepherds on the finished '
    +'feature takes the whole score; if it is a tie, everybody tied takes the whole '
    +'score. Then every shepherd on it walks home to its supply.</p>'
    /* The one rule everybody gets wrong, and the one worth spending the space
       on: a meadow is not paid for its own size. Said three ways — the rule,
       the picture, and the mistake — because "3 per adjacent completed fold"
       reads as "3 per tile" to almost everyone the first time. */
    +'<p><b>MEADOWS — READ THIS ONE TWICE.</b> Meadows never finish, and they are '
    +'never paid for being big. At the end of the game a meadow pays '
    +'<b>3 points for each finished fold that touches it</b> — and nothing at all '
    +'for the grass itself. A vast meadow touching no finished fold is worth zero; '
    +'a single tile of grass wedged against three finished folds is worth 9. '
    +'Whoever has the most herders sitting on that meadow takes the lot, ties '
    +'included. A shepherd posted on grass sits down and stays there for the rest '
    +'of the game — it never comes home, so it is the most expensive post you can '
    +'make and usually the one that wins.</p>'
    +meadowDiagram()
    +'<p><b>THE BROOK.</b> With the brook module on, the game opens by laying the brook '
    +'out from the spring; the parting splits it in two and the lakes cap the ends. '
    +'Shepherds may be posted during the brook, and the water divides meadows exactly '
    +'as a lane does — but the brook itself never scores.</p>'
    +'<p><b>NO ROOM.</b> If a drawn tile fits nowhere at all it is set aside for good '
    +'and you draw the next one. Nobody chooses that; it just happens.</p>'
    +'<p><b>CONTROLS.</b> drag to pan &middot; wheel or <b>+ −</b> to zoom &middot; '
    +'<b>R</b> or right-click rotates &middot; click lays the tile &middot; '
    +'<b>TAB</b> walks the cells it will fit &middot; <b>ENTER</b> lays &middot; '
    +'<b>1–9</b> posts a shepherd &middot; <b>0</b> or <b>SPACE</b> skips &middot; '
    +'<b>ESC</b> backs out &middot; <b>M</b> mute &middot; <b>F</b> hurries the AI along.</p>'
    +'<p><b>ON A TOUCH SCREEN.</b> Drag to pan, pinch to zoom, tap the tile in the '
    +'tray to turn it. Laying a tile and posting a shepherd both take <em>two taps</em> '
    +'— the first shows you what will happen, the second commits it — because '
    +'neither can be taken back. Tap anywhere while the pasture is thinking to '
    +'hurry it to your turn.</p>';
  root.appendChild(d);
  const back=mkEl('button','bigbtn ghost','‹ BACK'); back.type='button';
  onAct(back,()=>{ snd('ui'); menuView='root'; buildMenu(); });
  root.appendChild(back);
}
function menuConfig(){
  const seats=[{ name:(uiSetup.name||'').trim().toUpperCase()||'SHEPHERD', human:true }];
  /* two seats may run the same personality; the chips and the move log are
     unreadable if both are called MAUD, so the later ones take a numeral */
  const used={};
  for(let i=1;i<uiSetup.seats;i++){
    const c=uiSetup.ai[i-1];
    const base=personaName(c.p).toUpperCase();
    used[base]=(used[base]||0)+1;
    const n=used[base];
    seats.push({ name: base+(n>1?' '+'I'.repeat(Math.min(n,3))+(n>3?String(n):''):''),
                 human:false, personality:c.p, difficulty:c.d });
  }
  const raw=String(uiSetup.seed||'').trim();
  let seed;
  if(raw){
    seed = /^-?\d+$/.test(raw) ? (parseInt(raw,10)>>>0) : strSeed(raw);
  }else seed=(Date.now()>>>0);
  return { seats, modules:Object.assign({},uiSetup.modules), seed };
}
/* a word is as good a seed as a number, and easier to pass to a friend */
function strSeed(s){
  let h=2166136261>>>0;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
  return h>>>0;
}
function startFromMenu(){
  const cfg=menuConfig();
  saveSetup();
  uiHide('menu');
  newGame(cfg);
}
function newGame(cfg){
  uiLog.length=0; drawLog();
  uiLastPlace=null; G.post=null; G.tabCell=null; uiTabIdx=-1; uiRot=0;
  uiCat={}; uiBest=null; uiFinalIn=false; uiArmed=null;
  uiView().cx=0; uiView().cy=0;
  UiEng.start(cfg);
  uiAiClear(); uiAiSkip=false;
  hintReset();
  applyCalm();
  uiLastScreen=null;
  refreshLegal(true);
  centreOn(0,0);
  chipSig=''; barSig=''; traySig=''; uiBoundsSig=-1;
  if(typeof Snd!=='undefined' && Snd && Snd.musicStart) Snd.musicStart('pasture');
  updateChrome();
}
function resumeFromMenu(){
  uiHide('menu');
  /* Nothing to guard here: pumpAI stands down on G.replaying, so a rebuild
     replays the AI's logged turns instead of re-taking them. ui.js used to
     clear G.autoAI around this call; that has been removed deliberately —
     a second mechanism covering for the engine's own is how someone later
     concludes the engine guard is unnecessary and deletes the real one. */
  const ok=UiEng.resume();
  if(ok===false){ uiShow('menu'); uiSpeak('there is no game to resume'); return false; }
  uiLog.length=0; drawLog();
  uiLastPlace=null; G.post=null; G.tabCell=null; uiTabIdx=-1;
  uiLastScreen=null;
  refreshLegal(true);
  chipSig=''; barSig=''; traySig=''; uiBoundsSig=-1;
  updateChrome();
  return true;
}

/* ---- the end card ----
   Ranked seats, and a stacked bar per seat showing where the points came from.
   Category totals are collected as features complete; whatever finalScore()
   reports at the end is folded in on top. */
let uiCat={}, uiBest=null, uiFinalIn=false;
function addCat(seat,kind,pts){
  if(seat==null || !pts) return;
  const k=(uiCat[seat] = uiCat[seat] || {lane:0,fold:0,shrine:0,meadow:0});
  if(k[kind]!=null) k[kind]+=pts;
}
/* the single biggest thing that happened all game, whoever it happened to */
function noteBest(seat,kind,pts,why){
  pts=pts|0;
  if(seat==null || pts<=0) return;
  if(uiBest && uiBest.pts>=pts) return;
  uiBest={seat, kind, pts, why:why||''};
}
const UI_CATS=[['lane','LANES',PAL.lane],['fold','FOLDS',PAL.fold],
               ['shrine','SHRINES',PAL.shrine],['meadow','MEADOWS',PAL.meadow]];
function collectFinal(){
  /* ONCE. buildEnd runs whenever the end screen is built — syncScreens on
     arrival, and again for anything that asks the ui for the summary — while
     finalScore() re-walks the whole board and answers in full every time. Fold
     that into a running total twice and every meadow is counted twice: the bars
     go wrong, and they go wrong in a way that still adds up to a plausible
     picture, which is why nothing noticed. */
  if(uiFinalIn) return;
  uiFinalIn=true;
  for(const row of UiEng.final()){
    const kind=row.kind||row.type;
    const pts=row.pts|0;
    for(const h of (row.holders||[])){
      const seat=(typeof h==='number')?h:h.seat;
      addCat(seat, kind, pts);
      noteBest(seat, kind, pts, 'a '+kind+' at the final count');
    }
  }
}
function buildEnd(){
  collectFinal();
  const seats=UiEng.seats();
  const rank=seats.map((s,i)=>({s,i})).sort((a,b)=>(b.s.score|0)-(a.s.score|0));
  const top=rank.length?(rank[0].s.score|0):0;
  const champHuman=!!(rank.length && rank[0].s.human && (rank[0].s.score|0)===top);
  const ti=el('eTitle');
  if(ti){
    const shared=rank.filter(r=>(r.s.score|0)===top);
    /* game.js names an unnamed human seat "You", which this third-person
       template turned into "YOU TAKES THE PASTURE" — the same disagreement
       beginTurn already had to fix on its own banner. Second person for the
       pronoun, the name for everybody who has one. */
    const champ=rank.length ? rank[0].s : null;
    const pronoun=!!(champ && champ.human && String(champ.name||'').trim().toUpperCase()==='YOU');
    ti.textContent = !rank.length ? 'NO PASTURE'
      : shared.length>1 ? 'A SHARED PASTURE'
      : pronoun ? 'YOU TAKE THE PASTURE'
      : String(champ.name||'').toUpperCase()+' TAKES THE PASTURE';
    if(ti.classList){ ti.classList.toggle('win',champHuman); ti.classList.toggle('fail',!champHuman); }
  }
  uiText('eStats','SEED '+((G.config&&G.config.seed)>>>0)+'  ·  '+seats.length+' SEATS'
    +'  ·  '+UiEng.dead()+' TILE'+(UiEng.dead()===1?'':'S')+' SET ASIDE');
  const tb=el('eTable');
  if(tb){
    let html='<div class="erow ehead"><span class="rk">#</span><span class="who">SEAT</span>'
      +'<span class="bhead">WHERE THE POINTS CAME FROM</span><span class="tot">TOTAL</span></div>';
    rank.forEach((r,n)=>{
      const c=uiCat[r.i]||{lane:0,fold:0,shrine:0,meadow:0};
      const sum=UI_CATS.reduce((a,k)=>a+(c[k[0]]|0),0);
      const total=r.s.score|0;
      // no category data (a stub engine, or points banked before the hooks landed):
      // show the total as one honest bar rather than an empty strip
      const parts = sum>0
        ? UI_CATS.map(k=>[k[2], (c[k[0]]|0)/Math.max(sum,1)])
        : [[PAL.uiDim, total>0?1:0]];
      const w=Math.max(total,1)/Math.max(top,1);
      const detail=UI_CATS.filter(k=>(c[k[0]]|0)>0)
        .map(k=>(c[k[0]]|0)+' from '+k[1].toLowerCase()).join(', ');
      html+='<div class="erow'+(n===0?' win':'')+'" title="'+(detail||'no points')+'">'
        +'<span class="rk">'+(n+1)+'</span>'
        +'<span class="who"><span class="sw" style="background:'+UiEng.seatColor(r.i)+'"></span>'
        +'<span class="nm">'+String(r.s.name||('SEAT '+(r.i+1))).toUpperCase()
        +(r.s.human?'':' <span style="opacity:.6">(AI)</span>')+'</span></span>'
        +'<span class="bars" style="width:'+Math.round(w*100)+'%">'
        + parts.map(p=>'<span style="background:'+p[0]+';width:'+(p[1]*100)+'%"></span>').join('')
        +'</span>'
        +'<span class="tot">'+total+'</span></div>';
    });
    tb.innerHTML=html;
  }
  /* the one thing worth retelling: not who won, but the biggest single score
     anybody took all game. It is the moment a player actually remembers, and
     the ranked table is the last place they would find it. */
  const best=el('eBest');
  if(best){
    if(uiBest){
      const col=UiEng.seatColor(uiBest.seat);
      best.innerHTML='<span class="blbl">BEST MOMENT</span>'
        +'<span class="bwho"><span class="sw" style="background:'+col+'"></span>'
        +String(UiEng.seatName(uiBest.seat)||'').toUpperCase()+'</span>'
        +'<span class="bval">+'+(uiBest.pts|0)+'</span>'
        +'<span class="bwhy">'+(uiBest.why||('a '+uiBest.kind))+'</span>';
      /* no aria-label here: on a bare div it is ignored by some screen readers
         and REPLACES the content in others, and the visible words already read
         correctly — "BEST MOMENT, YOU, plus 16, a finished fold" */
      best.hidden=false;
    }else{
      best.innerHTML=''; best.hidden=true;
    }
  }
  const hint=el('eHint');
  if(hint) hint.innerHTML='<span class="bkey">'
    + UI_CATS.map(k=>'<span><i style="background:'+k[2]+'"></i>'+k[1]+'</span>').join('')
    + '</span>';
  const again=el('eAgain');
  if(again && again.focus) again.focus();
}
function playAgain(){
  uiHide('end');
  const cfg=(G.config && G.config.seats) ? JSON.parse(JSON.stringify(G.config)) : menuConfig();
  cfg.seed=(Date.now()>>>0);                       // same table, fresh satchel
  newGame(cfg);
}
function toMenu(){
  if(typeof Snd!=='undefined' && Snd && Snd.musicStop) Snd.musicStop();
  menuView='root';
  showMenu();
}

/* ---------------- 8. SETTINGS, CALM, SCALING ---------------- */
let setOpen=false;
function calmPref(){ const v=uiPref('calm',null); return (v===null||v===undefined)?null:!!v; }
function applyCalm(){
  const p=calmPref(), m=mq('(prefers-reduced-motion: reduce)');
  G.calm = (p===null) ? !!(m&&m.matches) : p;
  const body=document.body;
  if(body && body.classList) body.classList.toggle('calm', !!G.calm);
  const cb=el('bCalm');
  if(cb){
    cb.textContent = G.calm?'CALM ON':'CALM OFF';
    if(cb.classList) cb.classList.toggle('on',!!G.calm);
    attr(cb,'aria-pressed', G.calm?'true':'false');
  }
}
function toggleCalm(){ uiPrefSet('calm', !G.calm); applyCalm(); }
/* SKIP AI ANIMATION is the same switch F holds down, latched. It shortens the
   waits around the AI's turn and touches nothing else — same seat, same
   enumeration, same move — which is what makes it a comfort setting rather
   than a difficulty one. */
function setSkipAI(on){ uiPrefSet('skipAI', !!on); applyToggleLabels(); }
function toggleSkipAI(){ setSkipAI(!uiPref('skipAI',false)); }
function applyToggleLabels(){
  const sk=el('bSkipAI');
  if(sk){
    const on=!!uiPref('skipAI',false);
    sk.textContent = on?'SKIP AI ANIMATION ON':'SKIP AI ANIMATION OFF';
    if(sk.classList) sk.classList.toggle('on',on);
    attr(sk,'aria-pressed', on?'true':'false');
  }
  const hb=el('bHints');
  if(hb){
    const on=hintsOn();
    hb.textContent = on?'HINTS ON':'HINTS OFF';
    if(hb.classList) hb.classList.toggle('on',on);
    attr(hb,'aria-pressed', on?'true':'false');
  }
}
function applyMixes(){
  const s=clamp(+uiPref('sfx',100)||0,0,100), m=clamp(+uiPref('mus',100)||0,0,100);
  if(typeof Snd!=='undefined' && Snd){
    if(Snd.setSfxVolume) Snd.setSfxVolume(s/100);
    if(Snd.setMusicVolume) Snd.setMusicVolume(m/100);
  }
  const sl=el('volSfx'), ml=el('volMus');
  if(sl) sl.value=String(s);
  if(ml) ml.value=String(m);
  uiText('volSfxV',String(s)); uiText('volMusV',String(m));
}
function toggleSettings(on){
  const p=el('setcard');
  if(!p) return;
  const was=setOpen;
  setOpen=(on===undefined)?!setOpen:!!on;
  if(p.classList) p.classList.toggle('hidden', !setOpen);
  const g=el('bSet');
  if(g){
    attr(g,'aria-expanded', setOpen?'true':'false');
    // hand focus back only if we were the ones holding it: closing a popover
    // that was never open should not pull the ring onto the gear
    if(was && !setOpen && g.focus) g.focus();
  }
  if(setOpen){ applyMixes(); const f=el('volSfx'); if(f && f.focus) f.focus(); }
}
/* wiping a save asks once, naming the cost */
let resetArmed=0;
function uiResetProgress(){
  const b=el('bReset'), now=nowMs();
  if(now-resetArmed>1600){
    resetArmed=now;
    if(b){
      b.textContent='SURE? ERASES ALL';
      if(b.classList) b.classList.add('armed');
      if(typeof setTimeout==='function') setTimeout(()=>{
        const x=el('bReset');
        if(x && x.textContent==='SURE? ERASES ALL'){
          x.textContent='RESET PROGRESS';
          if(x.classList) x.classList.remove('armed');
        }
      },1600);
    }
    return false;
  }
  resetArmed=0;
  if(typeof resetProgress==='function') resetProgress();
  else try{
    if(typeof localStorage!=='undefined'){
      localStorage.removeItem('wooldom.save');
      localStorage.removeItem('wooldom.stats');
      localStorage.removeItem(UI_PREFS);
    }
  }catch(e){}
  applyMixes(); applyCalm(); applyToggleLabels();
  hintReset(); updateHint();               // a cleared prefs file has seen nothing
  if(b){
    b.textContent='PROGRESS CLEARED';
    if(b.classList) b.classList.remove('armed');
    if(typeof setTimeout==='function') setTimeout(()=>{
      const x=el('bReset'); if(x) x.textContent='RESET PROGRESS'; },1600);
  }
  if(uiScreen()==='menu') buildMenu();
  return true;
}
function fsEl(){
  return (typeof document==='undefined') ? null
    : (document.fullscreenElement||document.webkitFullscreenElement||null);
}
function fsSupported(){
  const s=el('stage');
  if(!s || !(s.requestFullscreen||s.webkitRequestFullscreen)) return false;
  const on=document.fullscreenEnabled, wk=document.webkitFullscreenEnabled;
  return (on===undefined && wk===undefined) ? true : !!(on||wk);
}
function toggleFullscreen(){
  const s=el('stage');
  if(!s) return;
  try{
    const p = fsEl()
      ? (document.exitFullscreen||document.webkitExitFullscreen).call(document)
      : (s.requestFullscreen||s.webkitRequestFullscreen).call(s);
    if(p && p.catch) p.catch(()=>{});
  }catch(e){}
}
/* Pixel art wants whole-number scaling — anything else smears the 1px rims.
   Snap to the largest integer multiple of 960×540 that fits; below 1× there is
   nothing to snap to, so there we let it be fluid. */
function fitCanvas(){
  const doc=document.documentElement;
  const vw=doc&&doc.clientWidth, vh=doc&&doc.clientHeight;
  const stage=el('stage'), wrap=el('wrap');
  if(!(vw>0 && vh>0) || !stage || !wrap || typeof stage.offsetHeight!=='number') return;
  const foot=document.querySelector('footer');
  const full=!!fsEl();
  const pad=full?16:24, frame=4;
  const chromeH=(stage.offsetHeight-wrap.offsetHeight)
    + ((!full && foot && foot.offsetHeight)||0) + pad;
  const k=Math.min(Math.floor((vw-pad-frame)/UI_W), Math.floor((vh-chromeH-frame)/UI_H), 2);
  if(!(k>=1)){
    if(uiCv && uiCv.style) uiCv.style.width='100%';
    stage.style.width = full ? '100%' : (UI_W+frame)+'px';
    if(stage.style.removeProperty) stage.style.removeProperty('--fsw');
    return;
  }
  if(uiCv && uiCv.style) uiCv.style.width=(UI_W*k)+'px';
  stage.style.width = full ? '100%' : (UI_W*k+frame)+'px';
  if(stage.style.setProperty) stage.style.setProperty('--fsw',(UI_W*k+frame)+'px');
}

/* ---------------- 9. KEYBOARD ----------------
   Modifiers are never hijacked, a focused control keeps SPACE and ENTER for
   itself, and nothing fires while somebody is typing a name or a seed. */
let shiftHeld=false;
function focusedControl(e){
  const t=e&&e.target;
  return !!(t && t.tagName && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(t.tagName));
}
function typingIn(e){
  const t=e&&e.target;
  return !!(t && t.tagName && /^(INPUT|TEXTAREA)$/.test(t.tagName));
}
/* ESC peels one layer at a time, outermost first, and only reaches the menu
   when there is nothing left on top of the board. A teaching hint and an armed
   tap both count as layers: the hint because it is the newest thing asking for
   attention, the armed tap because backing out of a placement you have proposed
   but not committed is exactly what ESC is for. */
function escPressed(){
  if(setOpen){ toggleSettings(false); return; }
  const s=uiScreen();
  if(s==='menu'){ if(menuView!=='root'){ menuView='root'; buildMenu(); } return; }
  if(s==='end'){ toMenu(); return; }
  if(hintCur){ hintDismiss(); return; }
  if(UiEng.mode()==='reveal'){ UiEng.revealSkip(); return; }
  if(uiArmed){ disarm(); clearGhost(); return; }
  if(G.ghost){ clearGhost(); G.tabCell=null; uiTabIdx=-1; return; }
  toMenu();
}
function panBy(dx,dy){
  const v=uiView(), k=shiftHeld?4:1;
  v.cx+=dx*k; v.cy+=dy*k;
  clampView();
}
function toggleMute(){
  if(typeof Snd==='undefined' || !Snd || !Snd.toggleMute) return;
  const m=Snd.toggleMute(), b=el('bMute');
  if(b){ b.textContent=m?'🔇':'🔊'; attr(b,'aria-pressed', m?'true':'false'); }
  uiSpeak(m?'sound off':'sound on');
}
function uiKeyDown(e){
  if(!e) return;
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  const k=e.key;
  if(k==='Shift'){ shiftHeld=true; return; }
  if(typingIn(e)){
    if(k==='Escape' && e.target && e.target.blur) e.target.blur();
    return;
  }
  if(k==='Escape'){ escPressed(); return; }
  if(k==='?' || (k==='/' && e.shiftKey)){
    if(uiScreen()==='menu'){ menuView='help'; buildMenu(); }
    else { hintOff=false; updateHint(); }
    return;
  }
  if(k==='f'||k==='F'){ G.fast=true; return; }

  const game=(uiScreen()==='game');
  if(game && (k==='ArrowLeft'||k==='ArrowRight'||k==='ArrowUp'||k==='ArrowDown')){
    if(e.preventDefault) e.preventDefault();
    if(k==='ArrowLeft') panBy(-1,0);
    if(k==='ArrowRight') panBy(1,0);
    if(k==='ArrowUp') panBy(0,-1);
    if(k==='ArrowDown') panBy(0,1);
    return;
  }
  if(e.repeat) return;                      // everything below is a discrete action
  if(game && k==='Tab'){
    if(e.preventDefault) e.preventDefault();
    if(placingNow()) tabCycle(e.shiftKey?-1:1);
    return;
  }
  if(k===' '||k==='Spacebar'||e.code==='Space'){
    if(focusedControl(e)) return;
    if(e.preventDefault) e.preventDefault();
    if(postingNow()) postSkip();
    return;
  }
  if(k==='Enter'){
    if(focusedControl(e)) return;
    if(e.preventDefault) e.preventDefault();
    if(uiScreen()==='menu'){ startFromMenu(); return; }
    if(uiScreen()==='end'){ playAgain(); return; }
    if(UiEng.mode()==='reveal'){ UiEng.revealNext(); return; }
    if(postingNow()){ postSkip(); return; }
    if(G.ghost) tryPlaceAt(G.ghost.x,G.ghost.y);
    return;
  }
  if(k>='0' && k<='9'){
    if(focusedControl(e)) return;
    if(!game) return;
    const n=+k;
    if(n===0) postSkip();
    else if(postingNow()) postDisc(n);
    return;
  }
  switch(k){
    case 'r': case 'R': if(game) uiRotate(1); break;
    case 'm': case 'M': toggleMute(); break;
    case '+': case '=': if(game) zoomStep(1); break;
    case '-': case '_': if(game) zoomStep(-1); break;
  }
}
function uiKeyUp(e){
  if(!e) return;
  if(e.key==='Shift') shiftHeld=false;
  if(e.key==='f'||e.key==='F') G.fast=false;
}
/* every held key is released the moment the window stops being the thing that
   would hear the keyup */
function uiBlur(){ G.fast=false; shiftHeld=false; }

/* ---------------- 10. THE PANEL & TRAY BUTTONS ---------------- */
function mkBtn(parent,id,txt,fn,cls,title,key){
  const b=mkEl('button','sbtn'+(cls?' '+cls:''));
  b.type='button'; b.id=id;
  b.appendChild(mkEl('span','t',txt));
  if(key) b.appendChild(mkEl('span','k','['+key+']'));
  if(title) b.title=title;
  attr(b,'aria-label', title||txt);
  onAct(b,()=>{ snd('ui'); fn(); });
  if(parent && parent.appendChild) parent.appendChild(b);
  return b;
}
/* The tray's buttons ARE the post window on a phone. A numbered disc drawn on
   the canvas is about 21 canvas pixels across, and a 960-wide canvas shown on a
   400-wide screen makes that eight CSS pixels — no enlargement of the hit test
   can turn that into a 44px target without swallowing the tile whole. So the
   choice is offered twice: precisely, as the discs, and plainly, as one full
   button per segment. The buttons are also what a screen reader and a keyboard
   get, which is why they are built on every width and not just the narrow one.
   A segment somebody already herds stays present and greyed rather than being
   removed — pressing it says who has it, and a choice that silently vanishes is
   worse than one that explains itself. */
function buildTrayBtns(){
  const row=el('trayBtns');
  if(!row) return;
  row.innerHTML='';
  attr(row,'role','group');
  if(postingNow()){
    attr(row,'aria-label','Where this shepherd may go');
    for(const o of postOpts()){
      const kind=String(UI_KIND[o.kind]||'feature').toUpperCase();
      const here=armedFor('post',o.n);
      const b=mkBtn(row,'bPost'+o.n, (here?'CONFIRM ':'')+o.n+' '+kind,
        ()=>{
          if(o.ok && twoTap() && !armedFor('post',o.n)){
            arm('post',o.n,o.n);
            uiSpeak('post on the '+(UI_KIND[o.kind]||'feature')+'? press again to confirm');
            return;
          }
          disarm(); postDisc(o.n);
        },
        (here?'go':'')+(o.ok?'':' off'),
        o.ok ? ('Post a shepherd on the '+(UI_KIND[o.kind]||'feature'))
             : (o.by ? ('Already herded by '+o.by) : 'This feature cannot take a shepherd'),
        String(o.n));
      /* greyed, not disabled: a disabled button drops out of the tab order and
         then nobody can ask it why it is grey */
      if(!o.ok) attr(b,'aria-disabled','true');
    }
    mkBtn(row,'bSkip','SKIP',()=>{ disarm(); postSkip(); },'','Post no shepherd this turn','0');
    return;
  }
  attr(row,'aria-label','What you may do with the tile in hand');
  const bR=mkBtn(row,'bRot','↻ ROTATE',()=>uiRotate(1),'',
        'Turn the tile to the next rotation that fits somewhere','R');
  bR.disabled=!placingNow();
  const armedCell=!!(uiArmed && uiArmed.kind==='cell');
  const ready=!!(placingNow() && G.ghost && G.ghost.legal);
  const bP=mkBtn(row,'bPlace',armedCell?'LAY IT HERE':'LAY IT',
        ()=>{ disarm(); if(G.ghost) tryPlaceAt(G.ghost.x,G.ghost.y); },ready?'go':'',
        'Lay the tile on the highlighted cell','ENTER');
  bP.disabled=!ready;
}
function buildPanel(){
  const panel=el('panel');
  if(!panel) return;
  panel.innerHTML='';
  attr(panel,'role','group'); attr(panel,'aria-label','Game controls');
  mkBtn(panel,'bMenu','☰ MENU',()=>toMenu(),'','Leave the game and go back to the menu','ESC');
  mkBtn(panel,'bLog','☰ LOG',()=>toggleLog(),'','Show or hide the last few scores');
  const sp=mkEl('div','spacer'); panel.appendChild(sp);
  mkBtn(panel,'bMute',(typeof Snd!=='undefined'&&Snd&&Snd.muted)?'🔇':'🔊',
        ()=>toggleMute(),'ico','Mute all sound','M');
  attr(el('bMute'),'aria-pressed',(typeof Snd!=='undefined'&&Snd&&Snd.muted)?'true':'false');
  mkBtn(panel,'bSet','⚙',()=>toggleSettings(),'ico','Settings — sound, calm mode, reset');
  attr(el('bSet'),'aria-expanded','false'); attr(el('bSet'),'aria-controls','setcard');
  const fsb=mkBtn(panel,'bFull','⛶',()=>toggleFullscreen(),'ico','Fill the screen');
  if(!fsSupported() && fsb) fsb.hidden=true;
}

/* ---------------- 11. BOOT ---------------- */
uiCv=el('cv'); uiTray=el('trayCv');

if(uiCv && uiCv.addEventListener){
  uiCv.addEventListener('pointerdown',e=>{
    if(e.button && e.button!==0) return;
    if(e.preventDefault) e.preventDefault();
    notePointer(e);
    if(uiCv.setPointerCapture && e.pointerId!=null){ try{ uiCv.setPointerCapture(e.pointerId); }catch(err){} }
    const p=canvasPos(e); uiDown(p[0],p[1],e.pointerId);
  });
  uiCv.addEventListener('pointermove',e=>{ notePointer(e); const p=canvasPos(e); uiMove(p[0],p[1],e.pointerId); });
  uiCv.addEventListener('pointerup',e=>{ const p=canvasPos(e); uiUp(p[0],p[1],e.pointerId); });
  uiCv.addEventListener('pointercancel',()=>uiCancel());
  uiCv.addEventListener('pointerleave',e=>{
    uiPtrs.delete(e.pointerId==null?1:e.pointerId);
    if(uiPtrs.size<2) uiPinch=null;
    /* a finger lifting off a touch screen fires this straight after the tap
       that armed the placement — clearing the ghost here would erase the very
       proposal the second tap is meant to confirm */
    setHover(null);
    if(!uiDragging && !uiArmed) clearGhost();
  });
  uiCv.addEventListener('wheel',e=>{
    if(e.preventDefault) e.preventDefault();
    const p=canvasPos(e);
    zoomStep(e.deltaY<0?1:-1, p[0], p[1]);
  },{passive:false});
  uiCv.addEventListener('contextmenu',e=>{ if(e.preventDefault) e.preventDefault(); uiRotate(1); });
}
if(uiTray && uiTray.addEventListener)
  uiTray.addEventListener('pointerdown',e=>{ if(e.preventDefault) e.preventDefault(); uiRotate(1); });

if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('keydown',uiKeyDown);
  document.addEventListener('keyup',uiKeyUp);
}

buildPanel();
buildTrayBtns();
{
  const b=(id,fn)=>{ const x=el(id); if(x) onAct(x,()=>{ snd('ui'); fn(); }); };
  b('eAgain',playAgain);
  b('eMenu',toMenu);
  b('setClose',()=>toggleSettings(false));
  b('bCalm',toggleCalm);
  b('bSkipAI',toggleSkipAI);
  b('bHints',()=>hintsEnable(!hintsOn()));
  b('bReset',uiResetProgress);
  b('hintClose',()=>hintDismiss());
  b('hintSkip',()=>hintsEnable(false));
  b('logToggle',()=>toggleLog());
  const bind=(id,key,readout,setter)=>{
    const sl=el(id);
    if(!sl || !sl.addEventListener) return;
    sl.addEventListener('input',()=>{
      const v=clamp(+sl.value,0,100);
      uiPrefSet(key,v);
      uiText(readout,String(v));
      if(typeof Snd!=='undefined' && Snd && Snd[setter]) Snd[setter](v/100);
    });
  };
  bind('volSfx','sfx','volSfxV','setSfxVolume');
  bind('volMus','mus','volMusV','setMusicVolume');
}
/* completions reach the log through the engine's own hook rows, so the log says
   what the rules said, not what the UI guessed */
if(typeof Hooks!=='undefined' && Hooks && Array.isArray(Hooks.onComplete)){
  Hooks.onComplete.push((root, rows)=>{
    const kind=(root && root.type) || 'feature';
    hintFlags.completed=true;              // the first one teaches the rule
    for(const a of (rows||[])){
      if(!a || a.seat==null) continue;
      addCat(a.seat, kind, a.pts|0);
      noteBest(a.seat, kind, a.pts|0, 'a finished '+kind);
      logLine(String(kind).toUpperCase()+' → <b>'+UiEng.seatName(a.seat)+'</b> <i>+'+(a.pts|0)+'</i>');
    }
    // no sfx here: scoreCompletions() sounds the completion immediately before
    // it calls these rows, and a second one is just a flam
  });
}
/* no sound before a gesture — showMenu's own musicStart no-ops at boot */
if(typeof document!=='undefined' && document.addEventListener)
  document.addEventListener('pointerdown',()=>{
    if(typeof Snd==='undefined' || !Snd) return;
    if(Snd.init) Snd.init();
    if(uiScreen()==='menu' && Snd.musicStart) Snd.musicStart('menu');
  },{once:true});

applyMixes();
applyCalm();
applyToggleLabels();
{
  const rm=mq('(prefers-reduced-motion: reduce)');
  if(rm && rm.addEventListener) rm.addEventListener('change',applyCalm);
  else if(rm && rm.addListener) rm.addListener(applyCalm);
}
if(typeof drawLogo==='function'){ drawLogo(el('logoCv')); }
if(UiEng.mode()==='menu') showMenu(); else { uiLastScreen=null; updateChrome(); }
drawLog();
fitCanvas();
if(typeof addEventListener==='function'){
  addEventListener('resize',fitCanvas);
  addEventListener('orientationchange',fitCanvas);
  /* A key held down has no keyup if the window loses focus while it is down:
     alt-tab with F pressed, release it over something else, and G.fast stays
     true for the rest of the session. That was always wrong — SHIFT latches
     the same way and leaves the arrows panning at four times speed — but it
     costs far more now that G.fast feeds G.skipFx, because a stuck key
     silently disables the AI pacing AND every ease, camera walk and zoom
     tween in render.js, with nothing on screen to say why. Dropping the held
     modifiers on blur is the whole fix. */
  addEventListener('blur', uiBlur);
  if(document.addEventListener){
    document.addEventListener('fullscreenchange',fitCanvas);
    document.addEventListener('webkitfullscreenchange',fitCanvas);
  }
}

/* The frame loop. game.js owns the clock (frame(ts) advances G.tick) and
   render.js owns the paint; ui.js owns the calling of them, unless game.js
   ships a startLoop() of its own — then it drives, and this loop does nothing
   but keep the DOM chrome honest. Two engine loops would double the clock. */
const uiOwnsLoop = (typeof startLoop!=='function');
let uiFrames=0;
/* One frame's worth of work, separated from the scheduling so a suite can run
   exactly one without an rAF.
   The UI takes AI pacing off the engine only once it is demonstrably running a
   loop to pace it WITH. G.autoAI is session-level — startGame does not reset it
   — so clearing it in newGame() would leave it false for anything started later
   on the page, including a WoolDbg.startGame from a console or a harness that
   has no rAF to drive the turns. Claiming it on the first real frame means a
   page without an animation loop keeps the engine's own synchronous pump. */
function uiFrameOnce(ts){
  /* the beat clock. rAF passes the browser's timestamp and a suite passes its
     own; both are the same kind of thing, so the pacing has one clock and no
     test-only path. A missing or non-finite stamp falls back to the wall. */
  uiNowTs=(typeof ts==='number' && isFinite(ts)) ? ts : nowMs();
  if(uiFrames++===0) G.autoAI=false;
  if(uiOwnsLoop){
    if(typeof frame==='function') frame(ts);
    if(typeof render==='function') render();
  }
  pumpAiTurn();
  updateChrome();
}
function uiFrame(ts){
  uiFrameOnce(ts);
  if(typeof requestAnimationFrame==='function') requestAnimationFrame(uiFrame);
}
if(!uiOwnsLoop) startLoop();
if(typeof requestAnimationFrame==='function') requestAnimationFrame(uiFrame);

/* ---------------- 12. DEBUG HOOKS ----------------
   AUGMENT the object game.js owns — never move or replace it. Every hook below
   goes through the same functions the pointer and the keyboard call. */
{
  /* game.js owns WoolDbg; if it has not landed yet we create the bare object so
     the ui hooks exist — but we never replace one that is already there */
  const D = window.WoolDbg || (window.WoolDbg = {});
  D.ui={
    /* screens */
    state:()=>uiScreen(),
    menu:()=>toMenu(),
    get menuView(){ return menuView; },
    view:v=>{ menuView=v; buildMenu(); },
    help:()=>{ menuView='help'; buildMenu(); },
    setup:uiSetup,
    config:()=>menuConfig(),
    /* seat numbers here are the ones on screen: seat 1 is the human, so the
       personality pickers start at seat 2 */
    seats:n=>{ uiSetup.seats=clamp(n|0,2,5); saveSetup(); buildMenu(); return uiSetup.seats; },
    personality:(seat,id)=>{ const c=uiSetup.ai[(seat|0)-2]; if(c) c.p=id; saveSetup(); buildMenu(); return c&&c.p; },
    difficulty:(seat,id)=>{ const c=uiSetup.ai[(seat|0)-2]; if(c) c.d=id; saveSetup(); buildMenu(); return c&&c.d; },
    module:(k,on)=>{ uiSetup.modules[k]=!!on; saveSetup(); buildMenu(); return uiSetup.modules[k]; },
    seed:s=>{ uiSetup.seed=(s==null?'':String(s)); return uiSetup.seed; },
    playerName:s=>{ uiSetup.name=String(s||''); saveSetup(); buildMenu(); return uiSetup.name; },
    newGame:cfg=>{ if(cfg){ newGame(cfg); return cfg; } startFromMenu(); return G.config; },
    resume:()=>resumeFromMenu(),
    again:()=>playAgain(),
    end:()=>{ buildEnd(); return { cats:uiCat, rank:UiEng.seats().map(s=>s.score|0) }; },

    /* the board, through the pointer's own path */
    hover:(x,y)=>{ setGhost(x,y); return G.ghost; },
    ghost:()=>G.ghost,
    legal:()=>uiLegal.list,
    rotate:d=>uiRotate(d||1),
    rot:()=>uiRot,
    clickCell:(x,y)=>{
      const p=View.w2s(x+0.5,y+0.5);
      uiDown(p[0],p[1],1);
      return uiUp(p[0],p[1],1);
    },
    clickPx:(sx,sy)=>{ uiDown(sx,sy,1); return uiUp(sx,sy,1); },
    dragPx:(x0,y0,x1,y1)=>{ uiDown(x0,y0,1); uiMove(x1,y1,1); return uiUp(x1,y1,1); },
    pinch:(d0,d1)=>{
      uiDown(400,270,1); uiDown(400+d0,270,2);
      uiMove(400+d1,270,2);
      uiUp(400+d1,270,2); uiUp(400,270,1);
      return uiView().zoom;
    },
    tab:d=>tabCycle(d||1),
    place:()=>(G.ghost?tryPlaceAt(G.ghost.x,G.ghost.y):false),
    postOpts:()=>postOpts(),
    postDisc:n=>postDisc(n),
    postAt:(sx,sy)=>{ const d=discAt(sx,sy); return d?postDisc(d.n):false; },
    discPx:n=>{ const o=postOpts().find(p=>p.n===n); return o?View.spot(o.x,o.y,o.rot,o.spot):null; },
    discR:()=>View.discR(),
    skip:()=>postSkip(),
    posting:()=>postingNow(),
    placing:()=>placingNow(),
    /* the paced AI turn, as the frame loop runs it; fast:true is the F key.
       With the wait collapsed one pump carries a whole turn; without it, one
       pump advances one beat and the caller supplies the frames. */
    aiStep:fast=>{ const w=G.fast; if(fast) G.fast=true; pumpAiTurn(); G.fast=w; return G.moveNo|0; },
    aiBeat:()=>uiAiState(),
    aiPace:()=>({think:UI_AI_THINK, ghost:UI_AI_GHOST,
                 settle:UI_AI_SETTLE, settleMax:UI_AI_SETTLE_MAX}),
    rnBusy:()=>uiRnBusy(),
    aiGhost:()=>(uiAiGhostOn()?G.ghost:null),
    aiTap:()=>{ uiAiSkip=true; return uiAiSkip; },
    skipFx:()=>!!G.skipFx,
    hoverCell:()=>G.hover,
    movePx:(sx,sy)=>{ uiMove(sx,sy,1); return G.hover; },
    /* the three phases of a drag, separately, so a suite can look at the board
       WHILE the finger is still down — dragPx only ever shows the aftermath */
    downPx:(sx,sy)=>{ uiDown(sx,sy,1); return true; },
    upPx:(sx,sy)=>uiUp(sx,sy,1),
    skipAI:on=>{ if(on!==undefined) setSkipAI(!!on); return !!uiPref('skipAI',false); },
    /* one frame of the real loop, without scheduling the next */
    frame:ts=>{ uiFrameOnce(ts==null?nowMs():ts); return G.tick|0; },
    frames:()=>uiFrames,

    /* camera */
    pan:(dx,dy)=>{ panBy(dx,dy); return [uiView().cx,uiView().cy]; },
    zoom:d=>{ zoomStep(d); return uiView().zoom; },
    zoomAt:(d,sx,sy)=>{ zoomStep(d,sx,sy); return [uiView().cx,uiView().cy,uiView().zoom]; },
    centre:(x,y)=>{ centreOn(x,y); return [uiView().cx,uiView().cy]; },
    viewState:()=>({cx:uiView().cx, cy:uiView().cy, zoom:uiView().zoom}),

    /* keyboard, chrome, settings */
    key:(k,opt)=>{
      const e=Object.assign({key:k, target:{}, preventDefault(){}, repeat:false}, opt||{});
      uiKeyDown(e);
      if(k!=='Shift' && !(k==='f'||k==='F')) uiKeyUp({key:k});
      return true;
    },
    keyUp:k=>uiKeyUp({key:k}),
    blur:()=>{ uiBlur(); return !!G.fast; },
    banner:()=>bannerText(),
    chips:()=>UiEng.seats().map((s,i)=>({name:s.name, score:s.score|0,
      supply:(s.supply!=null?s.supply:SHEPHERDS), turn:i===UiEng.turnIdx()})),
    log:()=>uiLog.slice(),
    logOpen:on=>{ toggleLog(on); return logOpen; },
    logHidden:()=>logHidden,
    speak:()=>spoken,
    settings:on=>{ toggleSettings(on); return setOpen; },
    settingsOpen:()=>setOpen,
    calm:()=>{ toggleCalm(); return !!G.calm; },

    /* touch: which pointer the ui believes it is on, and the two-tap state */
    coarse:on=>{ uiCoarseForced=(on==null?null:!!on); updateTray(); updateHint(); return twoTap(); },
    armed:()=>(uiArmed?Object.assign({},uiArmed):null),
    hintText:()=>{ const e=el('hintText'); return e?String(e.innerHTML||''):''; },
    speakHint:()=>spokenHint,
    hintId:()=>hintCur,
    hintDismiss:()=>hintDismiss(),
    hintsOff:()=>{ hintsEnable(false); return !hintsOn(); },
    hintsOn:on=>{ hintsEnable(on===undefined?true:!!on); return hintsOn(); },
    best:()=>(uiBest?Object.assign({},uiBest):null),
    mixes:(sfx,mus)=>{
      if(sfx!=null) uiPrefSet('sfx',clamp(sfx|0,0,100));
      if(mus!=null) uiPrefSet('mus',clamp(mus|0,0,100));
      applyMixes();
      return {sfx:uiPref('sfx',100), mus:uiPref('mus',100)};
    },
    prefs:()=>prefsAll(),
    reset:()=>uiResetProgress(),
    fit:()=>fitCanvas(),
    tick:()=>{ updateChrome(); return true; },
    View:window.View,
  };
}
