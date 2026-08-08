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
function rnShepherds(){
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
  rnFloaters.push({ x:+x||0, y:+y||0, text:String(text), col:color||PAL.gold, born:rTick });
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
function rnDrawBoard(c,g){
  const bm=rnBoardMap();
  if(!bm || typeof paintTile!=='function') return;
  const pad=g.S;
  bm.forEach((e,k)=>{
    if(!e || !e.tileId) return;
    const p=k.split(','), x=+p[0], y=+p[1];
    const sx=g.ox+x*g.S, sy=g.oy+y*g.S;
    if(sx>g.W+pad || sy>g.H+pad || sx+g.S<-pad || sy+g.S<-pad) return;
    const art=paintTile(e.tileId, e.rot|0);
    if(art) c.drawImage(art, sx, sy, g.S, g.S);
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
/* the tile under the pointer. Red-tinted when it can't go there, and a short
   deterministic shake on a refused drop — never under calm, where a rejection
   is exactly the jolt the setting exists to prevent. */
function rnDrawGhost(c,g){
  if(typeof G==='undefined' || !G) return;
  const gh=G.ghost;
  if(!gh || typeof gh.x!=='number' || !G.drawn || typeof paintTile!=='function') return;
  const bad = gh.legal===false;
  let jx=0, jy=0;
  const shake=fxAge(gh.badTick, gTick(), 10);
  if(shake>0 && !calm()) jx=Math.round((gTick()&1?1:-1)*shake*3);
  const sx=g.ox+gh.x*g.S+jx, sy=g.oy+gh.y*g.S+jy;
  const art=paintTile(G.drawn, gh.rot|0);
  c.save();
  c.globalAlpha = bad ? 0.45 : 0.68;
  if(art) c.drawImage(art, sx, sy, g.S, g.S);
  c.globalAlpha=1;
  if(bad){
    c.fillStyle='rgba(217,91,67,.42)';
    c.fillRect(sx,sy,g.S,g.S);
    c.strokeStyle=PAL.bad;
  } else {
    c.strokeStyle='rgba(255,232,180,.85)';
  }
  c.lineWidth=2;
  c.strokeRect(sx+1, sy+1, g.S-2, g.S-2);
  c.restore();
}
function rnDrawShepherds(c,g){
  if(typeof drawShepherd!=='function') return;
  const list=rnShepherds();
  for(const s of list){
    if(!s || typeof s.x!=='number') continue;
    const sx=g.ox+s.x*g.S, sy=g.oy+s.y*g.S;
    if(sx>g.W || sy>g.H || sx+g.S<0 || sy+g.S<0) continue;
    const bm=rnBoardMap();
    const e=bm? bm.get(cellKey(s.x,s.y)) : null;
    const tile=e? rnTileOf(e.tileId) : null;
    const seg=(tile && tile.segs)? tile.segs[s.seg|0] : null;
    const spot=(seg && seg.spot)? seg.spot : [32,32];
    const p=(typeof artRotSpot==='function') ? artRotSpot(spot[0], spot[1], e?e.rot|0:0) : spot;
    const px=sx+(p[0]+0.5)*(g.S/TILE), py=sy+(p[1]+0.5)*(g.S/TILE);
    /* a herder posted on a meadow is the same piece, sitting down (design §0).
       game.js's shepherdList carries the feature type, which saves resolving
       the segment again for every shepherd on every frame. */
    const kind=(s.kind ? s.kind==='meadow' : (seg && seg.t==='m')) ? 'seat' : 'stand';
    c.fillStyle='rgba(20,24,15,.30)';
    c.beginPath(); c.ellipse ? c.ellipse(px, py, 4*g.z, 1.8*g.z, 0, 0, 6.284) : c.rect(px-4*g.z, py-1, 8*g.z, 2);
    c.fill();
    drawShepherd(c, rnSeatCol(s.seat), kind, px, py+1, g.z);
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
function rnDrawFlashes(c,g){
  for(const f of rnFlashes){
    const age=(rTick-f.born)/FLASH_LIFE;
    if(age<0||age>1) continue;
    const pulse = calm() ? 0.42*(1-age) : (0.30+0.55*Math.abs(Math.sin(age*9.4)))*(1-age*0.6);
    const have=new Set(f.cells.map(p=>p[0]+','+p[1]));
    // thin enough to read as a glow round the feature rather than a fence
    // built on top of it — at 2x zoom a sixteenth of a tile is eight solid px
    c.lineWidth=Math.max(2, Math.round(g.S/26));
    c.strokeStyle=f.col;
    c.globalAlpha=clamp(pulse,0,1)*0.85;
    c.beginPath();
    for(const [x,y] of f.cells){
      const sx=g.ox+x*g.S, sy=g.oy+y*g.S;
      if(!have.has((x)+','+(y-1))){ c.moveTo(sx,sy); c.lineTo(sx+g.S,sy); }
      if(!have.has((x)+','+(y+1))){ c.moveTo(sx,sy+g.S); c.lineTo(sx+g.S,sy+g.S); }
      if(!have.has((x-1)+','+y)){ c.moveTo(sx,sy); c.lineTo(sx,sy+g.S); }
      if(!have.has((x+1)+','+y)){ c.moveTo(sx+g.S,sy); c.lineTo(sx+g.S,sy+g.S); }
    }
    c.stroke();
    c.globalAlpha=1;
  }
}
function rnDrawFloaters(c,g){
  for(const f of rnFloaters){
    const age=(rTick-f.born)/FLOAT_LIFE;
    if(age<0||age>1) continue;
    if(age>0.86 && (rTick&1)) continue;           // flicker out at the end
    const x=g.ox+f.x*g.S, y=g.oy+f.y*g.S-age*30;
    if(x<-40||x>g.W+40||y<-20||y>g.H+20) continue;
    c.save();
    c.globalAlpha=clamp(1.25-age*1.1,0,1);
    const sc=g.z>=2?2:1;
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
function rnDrawReveal(c,g){
  if(typeof G==='undefined' || !G || !G.reveal) return;
  const st=rnRevealStep();
  if(!st) return;
  const cells=rnCells(st.cells);
  if(cells.length){
    const t=gTick();
    const k = calm() ? 0.30 : 0.20+0.16*(0.5+0.5*Math.sin(t/8));
    c.fillStyle='rgba(255,216,107,'+k.toFixed(3)+')';
    for(const [x,y] of cells) c.fillRect(g.ox+x*g.S, g.oy+y*g.S, g.S, g.S);
    c.strokeStyle=PAL.gold; c.lineWidth=2;
    const have=new Set(cells.map(p=>p[0]+','+p[1]));
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
  const holders=(st.holders||[]).map(h=>{
    if(typeof h==='number') return rnSeat(h).name;
    if(h && typeof h==='object') return h.name || rnSeat(h.seat|0).name;
    return String(h);
  });
  const l1=String(st.kind||'').toUpperCase()+(st.detail?(' - '+st.detail):'');
  const l2=(holders.length?('> '+holders.join(', ')):'> NOBODY')+
           (typeof st.pts==='number'?('  +'+st.pts):'');
  const w=Math.max(textW(l1), textW(l2))*2+24;
  const bx=Math.round(g.W/2-w/2), by=g.H-52;
  c.fillStyle='rgba(16,20,12,.84)'; c.fillRect(bx,by,w,34);
  c.fillStyle=PAL.gold; c.fillRect(bx,by,w,2);
  c.save(); c.scale(2,2);
  drawPixelText(c, l1, g.W/4, (by+8)/2, PAL.ui, RN_INK);
  drawPixelText(c, l2, g.W/4, (by+20)/2, PAL.gold, RN_INK);
  c.restore();
  const nSteps=Array.isArray(G.reveal.steps)?G.reveal.steps.length:G.reveal.n;
  const iStep=Array.isArray(G.reveal.steps)?(G.reveal.idx|0):G.reveal.i;
  if(typeof nSteps==='number' && typeof iStep==='number')
    drawPixelText(c, Math.min(iStep+1,nSteps)+'/'+nSteps, g.W-24, by+4, PAL.uiDim, RN_INK);
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

  c.imageSmoothingEnabled=false;
  rnFillFelt(c,g);
  rnDrawLattice(c,g);

  if(typeof G!=='undefined' && G){
    c.imageSmoothingEnabled = g.S < TILE;      // minify smoothly, magnify crisply
    rnDrawBoard(c,g);
    c.imageSmoothingEnabled = false;
    rnDrawLegal(c,g);
    rnDrawGhost(c,g);
    rnDrawShepherds(c,g);
    rnDrawFlashes(c,g);
    rnDrawPostDiscs(c,g);
    rnDrawReveal(c,g);
    rnDrawFloaters(c,g);
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
  window.worldToScreen  = worldToScreen;
  window.screenToCell   = screenToCell;
  window.screenToCellF  = screenToCellF;
  window.drawPixelText  = drawPixelText;
  window.textW          = textW;
  window.FONT           = FONT;
}
