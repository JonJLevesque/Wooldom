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
/* a pinch reports a continuous ratio; the board only has three zooms, so the
   nearest step wins and the gesture snaps to it */
function zoomTo(z,sx,sy){
  let bi=0,bd=Infinity;
  for(let i=0;i<ZOOMS.length;i++){ const d=Math.abs(ZOOMS[i]-z); if(d<bd){ bd=d; bi=i; } }
  return setZoomIdx(bi,sx,sy);
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
function setGhost(x,y){
  if(!UiEng.drawn() || !placingNow()){ G.ghost=null; return; }
  G.ghost={ x, y, rot:uiRot, legal:cellRotOk(x,y,uiRot) };
}
function clearGhost(){ G.ghost=null; }

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
function discAt(sx,sy){
  const r=View.discR()+2;                       // a couple of px of forgiveness
  for(const o of postOpts()){
    const p=View.spot(o.x,o.y,o.rot,o.spot);
    if((sx-p[0])*(sx-p[0])+(sy-p[1])*(sy-p[1]) <= r*r) return o;
  }
  return null;
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
    zoomTo(uiPinch.z0*(d/uiPinch.d0), uiPinch.mx, uiPinch.my);
    return;
  }
  if(uiPan){
    const dx=sx-uiPan.sx, dy=sy-uiPan.sy;
    if(!uiDragging && Math.hypot(dx,dy)>UI_DRAG_PX){ uiDragging=true; G.dragging=true; setCursor(); }
    if(uiDragging){
      const p=View.px(), v=uiView();
      v.cx=uiPan.cx-dx/p; v.cy=uiPan.cy-dy/p;
      clampView();
      return;
    }
  }
  const c=View.cellAt(sx,sy);
  setGhost(c[0],c[1]);
}
function uiUp(sx,sy,id){
  uiPtrs.delete(id==null?1:id);
  if(uiPtrs.size<2) uiPinch=null;
  const wasDrag=uiDragging;
  uiPan=null; uiDragging=false; G.dragging=false; setCursor();
  if(wasDrag) return false;
  return uiClick(sx,sy);
}
function uiCancel(){
  uiPtrs.clear(); uiPan=null; uiPinch=null; uiDragging=false; G.dragging=false; setCursor();
}
/* a click on the board means whichever of the two things is currently on offer */
function uiClick(sx,sy){
  if(uiScreen()!=='game') return false;
  if(postingNow()){
    const d=discAt(sx,sy);
    if(d) return postDisc(d.n);
    return false;
  }
  const c=View.cellAt(sx,sy);
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

function shepherdPips(s){
  const left=(s && s.supply!=null) ? (s.supply|0) : SHEPHERDS;
  return '•'.repeat(clamp(left,0,SHEPHERDS)) + '·'.repeat(clamp(SHEPHERDS-left,0,SHEPHERDS));
}
function buildChips(){
  const box=el('seatChips');
  if(!box) return;
  box.innerHTML='';
  const seats=UiEng.seats(), turn=UiEng.turnIdx();
  seats.forEach((s,i)=>{
    const c=mkEl('div','chip'+(i===turn?' turn':'')+(s.human?'':' ai'));
    const sw=mkEl('span','sw'); if(sw.style) sw.style.background=UiEng.seatColor(i);
    c.appendChild(sw);
    c.appendChild(mkEl('span','nm', String(s.name||('SEAT '+(i+1))).toUpperCase()));
    c.appendChild(mkEl('span','pips', shepherdPips(s)));
    c.appendChild(mkEl('span','sc', String(s.score|0)));
    attr(c,'aria-label', (s.name||('seat '+(i+1)))+', '+(s.score|0)+' points, '
      +((s.supply!=null?s.supply:SHEPHERDS)|0)+' shepherds in hand'
      +(i===turn?', playing now':''));
    box.appendChild(c);
  });
}
function updateChips(){
  const seats=UiEng.seats();
  const sig=UiEng.turnIdx()+'|'+seats.map(s=>
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
  if(!UiEng.humanTurn()) return 'hold <b>F</b> to skip the animation';
  if(postingNow())
    return '<b>1–9</b> post a shepherd on that segment &middot; <b>0</b> or <b>SPACE</b> to skip '
         + '&middot; a grey disc is a feature somebody already herds';
  return 'drag to pan &middot; wheel to zoom &middot; <b>R</b> or right-click rotates &middot; '
       + 'click lays the tile &middot; <b>TAB</b> walks the legal cells &middot; <b>ENTER</b> lays';
}
function updateHint(){
  const ht=el('hintText'), hb=el('hintbar');
  const hint=hintOff?'':hintFor();
  if(ht) ht.innerHTML=hint;
  if(hb && hb.classList) hb.classList.toggle('off', !hint);
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
             uiScreen()].join('|');
  if(sig===traySig) return;
  traySig=sig;
  const info=el('trayInfo');
  if(info){
    info.innerHTML='';
    const name=mkEl('div','tname'), sub=mkEl('div','tsub');
    if(shown){
      name.textContent=UiEng.tileName(shown);
      sub.innerHTML = posting
        ? 'laid &middot; <em>post a shepherd</em> on a numbered disc, or skip'
        : (uiLegal.list.length + ' place' + (uiLegal.list.length===1?'':'s')
           + ' it will go &middot; rotation <em>' + (uiRot*90) + '&deg;</em>');
    }else{
      name.textContent = uiScreen()==='game' ? 'THE SATCHEL' : 'WOOLDOM';
      sub.innerHTML = uiScreen()==='game' ? 'waiting on the turn…' : 'no game in play';
    }
    info.appendChild(name); info.appendChild(sub);
  }
  const bR=el('bRot'), bP=el('bPlace'), bS=el('bSkip');
  if(bR) bR.disabled=!placingNow();
  if(bP){ bP.disabled=!(placingNow() && G.ghost && G.ghost.legal);
          bP.classList.toggle('go', !bP.disabled); }
  if(bS){ bS.disabled=!postingNow(); bS.classList.toggle('go', postingNow()); }
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
   so the player can see what the pasture just did to them. Holding F collapses
   the wait — the design's promise is that F skips the animation, never the
   thinking, so the move itself is unchanged either way. */
const UI_AI_PACE=600;
let aiWaitFrom=0;
function pumpAiTurn(){
  const m=UiEng.mode();
  const s=UiEng.current();
  if((m!=='play' && m!=='brook') || UiEng.step()!=='place' || !s || s.human){ aiWaitFrom=0; return; }
  if(typeof aiMove!=='function'){          // no ai.js: let the engine drive itself
    G.autoAI=true;
    if(typeof pumpAI==='function') pumpAI();
    return;
  }
  const now=nowMs();
  if(!aiWaitFrom){ aiWaitFrom=now; return; }
  if(now-aiWaitFrom < (G.fast?0:UI_AI_PACE)) return;
  aiWaitFrom=0;
  const before=G.moveNo|0;
  aiMove(UiEng.turnIdx());
  /* An AI that declines to move would leave the game sitting here for good;
     hand the turn back to the engine's own pump rather than stall the game. */
  if((G.moveNo|0)===before){
    G.autoAI=true;
    if(typeof pumpAI==='function') pumpAI();
  }
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
    +'<p><b>MEADOWS.</b> Meadows never finish. At the end of the game each meadow pays '
    +'<b>3 for every finished fold it touches</b>, to whoever has the most herders '
    +'sitting on it. A shepherd posted on grass sits down and stays there for good.</p>'
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
    +'<b>ESC</b> menu &middot; <b>M</b> mute &middot; <b>F</b> skips the AI\'s animation.</p>';
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
  uiCat={};
  uiView().cx=0; uiView().cy=0;
  UiEng.start(cfg);
  aiWaitFrom=0;
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
let uiCat={};
function addCat(seat,kind,pts){
  if(seat==null || !pts) return;
  const k=(uiCat[seat] = uiCat[seat] || {lane:0,fold:0,shrine:0,meadow:0});
  if(k[kind]!=null) k[kind]+=pts;
}
const UI_CATS=[['lane','LANES',PAL.lane],['fold','FOLDS',PAL.fold],
               ['shrine','SHRINES',PAL.shrine],['meadow','MEADOWS',PAL.meadow]];
function collectFinal(){
  for(const row of UiEng.final()){
    const kind=row.kind||row.type;
    const pts=row.pts|0;
    for(const h of (row.holders||[])) addCat(typeof h==='number'?h:h.seat, kind, pts);
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
    ti.textContent = !rank.length ? 'NO PASTURE'
      : shared.length>1 ? 'A SHARED PASTURE'
      : String(rank[0].s.name||'').toUpperCase()+' TAKES THE PASTURE';
    if(ti.classList){ ti.classList.toggle('win',champHuman); ti.classList.toggle('fail',!champHuman); }
  }
  uiText('eStats','SEED '+((G.config&&G.config.seed)>>>0)+'  ·  '+seats.length+' SEATS'
    +'  ·  '+UiEng.dead()+' TILE'+(UiEng.dead()===1?'':'S')+' SET ASIDE');
  const tb=el('eTable');
  if(tb){
    let html='<div class="erow ehead"><span class="rk">#</span><span class="who">SEAT</span>'
      +'<span>WHERE THE POINTS CAME FROM</span><span class="tot">TOTAL</span></div>';
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
      html+='<div class="erow'+(n===0?' win':'')+'"><span class="rk">'+(n+1)+'</span>'
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
  applyMixes(); applyCalm();
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
function escPressed(){
  if(setOpen){ toggleSettings(false); return; }
  const s=uiScreen();
  if(s==='menu'){ if(menuView!=='root'){ menuView='root'; buildMenu(); } return; }
  if(s==='end'){ toMenu(); return; }
  if(UiEng.mode()==='reveal'){ UiEng.revealSkip(); return; }
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
function buildTrayBtns(){
  const row=el('trayBtns');
  if(!row) return;
  row.innerHTML='';
  attr(row,'role','group'); attr(row,'aria-label','What you may do with the tile in hand');
  mkBtn(row,'bRot','↻ ROTATE',()=>uiRotate(1),'','Turn the tile to the next rotation that fits somewhere','R');
  mkBtn(row,'bPlace','LAY IT',()=>{ if(G.ghost) tryPlaceAt(G.ghost.x,G.ghost.y); },'',
        'Lay the tile on the highlighted cell','ENTER');
  mkBtn(row,'bSkip','SKIP',()=>postSkip(),'','Post no shepherd this turn','0');
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
    if(uiCv.setPointerCapture && e.pointerId!=null){ try{ uiCv.setPointerCapture(e.pointerId); }catch(err){} }
    const p=canvasPos(e); uiDown(p[0],p[1],e.pointerId);
  });
  uiCv.addEventListener('pointermove',e=>{ const p=canvasPos(e); uiMove(p[0],p[1],e.pointerId); });
  uiCv.addEventListener('pointerup',e=>{ const p=canvasPos(e); uiUp(p[0],p[1],e.pointerId); });
  uiCv.addEventListener('pointercancel',()=>uiCancel());
  uiCv.addEventListener('pointerleave',e=>{
    uiPtrs.delete(e.pointerId==null?1:e.pointerId);
    if(uiPtrs.size<2) uiPinch=null;
    if(!uiDragging) clearGhost();
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
  b('bReset',uiResetProgress);
  b('hintClose',()=>{ hintOff=true; updateHint(); });
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
    for(const a of (rows||[])){
      if(!a || a.seat==null) continue;
      addCat(a.seat, kind, a.pts|0);
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
    /* the paced AI turn, as the frame loop runs it; fast:true is the F key */
    aiStep:fast=>{ const w=G.fast; if(fast) G.fast=true; aiWaitFrom=1; pumpAiTurn(); G.fast=w; return G.moveNo|0; },
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
    banner:()=>bannerText(),
    chips:()=>UiEng.seats().map((s,i)=>({name:s.name, score:s.score|0,
      supply:(s.supply!=null?s.supply:SHEPHERDS), turn:i===UiEng.turnIdx()})),
    log:()=>uiLog.slice(),
    logOpen:on=>{ toggleLog(on); return logOpen; },
    speak:()=>spoken,
    settings:on=>{ toggleSettings(on); return setOpen; },
    settingsOpen:()=>setOpen,
    calm:()=>{ toggleCalm(); return !!G.calm; },
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
