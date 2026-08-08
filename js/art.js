'use strict';
/* ==================================================================
   WOOLDOM — js/art.js : the procedural tile painter

   Every tile in the game is painted from its segment data alone. There are no
   hand-drawn assets and no per-tile special cases, so the 72 base tiles, the 12
   brook tiles and every pack tile that ships later stay consistent by
   construction: a fold looks like a fold because `segs` says a fold occupies
   those sides, not because somebody drew one.

   ALL per-pixel work happens here, at cache time. A tile is painted once into a
   raw RGBA buffer, the buffer is rotated by index remap for the other three
   rotations, and each becomes a 64x64 canvas the frame loop only ever blits.
   ================================================================== */

/* ---------------- 1. PAINTER CONSTANTS ---------------- */
const ART_SZ = 64;              // paint resolution; equals TILE at zoom 1

/* A fold side paints as a band whose depth bulges toward the middle of the
   side — the "chord + bulge" of design §5. Sides of the same fold segment are
   then joined by capsule necks to the blob's centroid, which is what makes a
   fold spanning two opposite sides paint as ONE connected shape (splitting the
   meadows) while two single-side fold segments stay separate. */
const FOLD_D0     = 13;         // band depth at the corners of a fold side
const FOLD_BULGE  = 7;          // extra depth at the middle of the side
const FOLD_SPOKE  = 11;         // half-width of the neck joining a side to the centroid
const FOLD_WOBBLE = 5.0;        // organic noise amplitude on the fold boundary
const FOLD_SEP    = 3.0;        // field margin one fold must beat another by, so
                                // two folds on one tile keep meadow between them
const WALL_T      = 4;          // wall thickness, px

/* Paths are stamped as concentric discs along a rounded polyline: filling the
   widest radius first and the narrowest last leaves parallel bands, so a disc
   profile IS the cross-section of the road, corners and all.
   The wheel ruts are the exception. A band thin enough to be a rut is thinner
   than one pixel at the centre of the path, so it lands only where a sample
   happens to fall near an integer and breaks into dashes — the ruts are stamped
   along genuine parallel offset curves instead (artRuts). */
const LANE_APPROACH = 9;        // px a path runs straight inward before it may bend
const PATH_CORNER   = 10;       // corner rounding radius on the control polyline
const LANE_RUT_OFF  = 1.6;      // rut offset either side of the lane centreline
const LANE_CLEAR    = 7;        // px of daylight a lane needs from a fold wall
const BROOK_CLEAR   = 9;        // the brook is wider, so it needs more
const POND_R        = 10;       // a brook that ends on a tile ends in water

/* ---------------- 2. COLOUR ---------------- */
const artHexCache = new Map(), artToneCache = new Map();
function artRGB(hex){
  let v = artHexCache.get(hex);
  if(v) return v;
  const h = String(hex).replace('#','');
  v = [parseInt(h.substr(0,2),16)|0, parseInt(h.substr(2,2),16)|0, parseInt(h.substr(4,2),16)|0];
  artHexCache.set(hex, v);
  return v;
}
/* a lighter/darker relative of a palette colour, as an rgb triple */
function artTone(hex, k){
  const key = hex+'|'+k;
  let v = artToneCache.get(key);
  if(v) return v;
  const c = artRGB(hex);
  v = [clamp(Math.round(c[0]*k),0,255), clamp(Math.round(c[1]*k),0,255), clamp(Math.round(c[2]*k),0,255)];
  artToneCache.set(key, v);
  return v;
}
/* blend two palette colours — used where a tone (which only scales brightness)
   would give the right value but the wrong warmth */
const artMixCache = new Map();
function artMix(a, b, t){
  const key=a+'|'+b+'|'+t;
  let v=artMixCache.get(key);
  if(v) return v;
  const ca=artRGB(a), cb=artRGB(b);
  v=[Math.round(ca[0]+(cb[0]-ca[0])*t), Math.round(ca[1]+(cb[1]-ca[1])*t), Math.round(ca[2]+(cb[2]-ca[2])*t)];
  artMixCache.set(key,v);
  return v;
}
function artHex(rgb){
  const h = n => ('0'+clamp(n|0,0,255).toString(16)).slice(-2);
  return '#'+h(rgb[0])+h(rgb[1])+h(rgb[2]);
}

/* ---------------- 3. PIXEL BUFFER ---------------- */
function artNewBuf(w,h){
  w = w||ART_SZ; h = h||ART_SZ;
  return { w, h, d:new Uint8ClampedArray(w*h*4) };
}
function artSet(b,x,y,c,a){
  x = x|0; y = y|0;
  if(x<0 || y<0 || x>=b.w || y>=b.h) return;
  const i = (y*b.w+x)*4;
  if(a===undefined || a>=1){ b.d[i]=c[0]; b.d[i+1]=c[1]; b.d[i+2]=c[2]; b.d[i+3]=255; return; }
  if(a<=0) return;
  b.d[i]   += (c[0]-b.d[i])*a;
  b.d[i+1] += (c[1]-b.d[i+1])*a;
  b.d[i+2] += (c[2]-b.d[i+2])*a;
  b.d[i+3] = 255;
}
function artFill(b,c){
  for(let i=0;i<b.d.length;i+=4){ b.d[i]=c[0]; b.d[i+1]=c[1]; b.d[i+2]=c[2]; b.d[i+3]=255; }
}
function artDisc(b,cx,cy,r,c){
  const r2=r*r;
  const x0=Math.max(0,Math.floor(cx-r)), x1=Math.min(b.w-1,Math.ceil(cx+r));
  const y0=Math.max(0,Math.floor(cy-r)), y1=Math.min(b.h-1,Math.ceil(cy+r));
  for(let y=y0;y<=y1;y++){
    const dy=y-cy;
    for(let x=x0;x<=x1;x++){ const dx=x-cx; if(dx*dx+dy*dy<=r2) artSet(b,x,y,c); }
  }
}
function artCanvasFromBuf(buf){
  const c = document.createElement('canvas');
  c.width = buf.w; c.height = buf.h;
  const g = c.getContext('2d');
  if(!g) return c;
  if(g.imageSmoothingEnabled!==undefined) g.imageSmoothingEnabled = false;
  try{
    const im = g.createImageData(buf.w, buf.h);
    if(im && im.data && im.data.length===buf.d.length) im.data.set(buf.d);
    g.putImageData(im,0,0);
  }catch(e){ /* headless canvas stub — the buffer is still the source of truth */ }
  return c;
}
/* rotate the painted buffer 90*rot clockwise; the same remap as the slot
   rotation in tiles.js, so art and rules agree on what "rot" means */
function artRotBuf(src, rot){
  rot = ((rot|0)%4+4)%4;
  if(!rot) return src;
  const N = src.w, out = artNewBuf(N,N);
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    let sx,sy;
    if(rot===1){ sx=y; sy=N-1-x; }
    else if(rot===2){ sx=N-1-x; sy=N-1-y; }
    else { sx=N-1-y; sy=x; }
    const si=(sy*N+sx)*4, di=(y*N+x)*4;
    out.d[di]=src.d[si]; out.d[di+1]=src.d[si+1]; out.d[di+2]=src.d[si+2]; out.d[di+3]=255;
  }
  return out;
}
/* where a canonical (rot 0) art coordinate ends up once the tile is rotated —
   render.js uses this to put shepherds and post-discs on the right pixel */
function artRotSpot(x, y, rot){
  rot = ((rot|0)%4+4)%4;
  const N = ART_SZ-1;
  if(rot===1) return [N-y, x];
  if(rot===2) return [N-x, N-y];
  if(rot===3) return [y, N-x];
  return [x, y];
}

/* ---------------- 4. NOISE & GEOMETRY ---------------- */
function artSmooth(t){ return t*t*(3-2*t); }
/* smooth value noise in 0..1 — cosmetics only, and stateless, so a redraw can
   never perturb a playout (core.js's hash, not RNG) */
function artNoise2(seed, x, y, cell){
  const fx=x/cell, fy=y/cell;
  const ix=Math.floor(fx), iy=Math.floor(fy);
  const tx=artSmooth(fx-ix), ty=artSmooth(fy-iy);
  const h=(a,b)=>hash(a*3+seed*77, b*5+seed*131);
  const a=h(ix,iy), b=h(ix+1,iy), c=h(ix,iy+1), d=h(ix+1,iy+1);
  const t=a+(b-a)*tx, u=c+(d-c)*tx;
  return t+(u-t)*ty;
}
function artSeed(str){
  let n=2166136261;
  str = String(str);
  for(let i=0;i<str.length;i++){ n^=str.charCodeAt(i); n=Math.imul(n,16777619); }
  return (n>>>16)&1023;
}
function artDistSeg(px,py,ax,ay,bx,by){
  const vx=bx-ax, vy=by-ay, L=vx*vx+vy*vy;
  let t = L>0 ? ((px-ax)*vx+(py-ay)*vy)/L : 0;
  t = t<0?0 : t>1?1 : t;
  const dx=px-(ax+vx*t), dy=py-(ay+vy*t);
  return Math.sqrt(dx*dx+dy*dy);
}

/* sides: N=0 E=1 S=2 W=3. Edge midpoints sit a hair OUTSIDE the tile so a path
   drawn to one meets its neighbour's path with no seam at the join. */
const ART_EDGE = [[31.5,-2],[65,31.5],[31.5,65],[-2,31.5]];   // where a path meets side s
const ART_MID  = [[31.5,0],[63,31.5],[31.5,63],[0,31.5]];      // the side's midpoint on the tile
const ART_IN   = [[0,1],[-1,0],[0,-1],[1,0]];                  // inward unit normal of side s
function artSideU(s,x,y){ return s===0?y : s===1?(ART_SZ-1-x) : s===2?(ART_SZ-1-y) : x; }
function artSideJ(s,x,y){ return (s===0||s===2)?x:y; }         // index along the side, 0..63

/* ---------------- 5. SPRITE TABLE ----------------
   8x8 emblems and the little inhabitants, as char grids with a per-sprite
   palette. Packs push their own rows (wool tuft, whey jug, inn lantern, wolf
   print, auction bell) onto SPRITES; nothing else about the painter changes. */
const SPRITES = {
  // the horns catch the light, the face stays the full gold — a pale face on a
  // cream pen floor is the one combination that disappears at 8px
  ram: { w:8, h:8,
    pal:{ o:PAL.ink, g:'#f4d474', d:PAL.ink, w:PAL.ram },
    rows:[ '.o....o.',
           'ogo..ogo',
           'oggooggo',
           '.owwwwo.',
           '.odwwdo.',
           '.owwwwo.',
           '..owwo..',
           '...oo...' ] },
  sheep: { w:8, h:6,
    pal:{ o:'#6b6157', w:'#fdfbf4', k:'#4a423a' },
    rows:[ '..oooo..',
           '.owwwwoo',
           'owwwwwko',
           'owwwwwko',
           '.owwwwo.',
           '..k..k..' ] },
  hut: { w:8, h:7,
    pal:{ o:PAL.ink, r:PAL.shrineRoof, s:PAL.shrine, d:'#3b322a' },
    rows:[ '..oooo..',
           '.orrrro.',
           'orrrrrro',
           'oooooooo',
           '.ossdso.',
           '.ossdso.',
           '.oooooo.' ] },
};
/* stamp a SPRITES row into a paint buffer, top-left at x,y */
function artSprite(buf, name, x, y, over){
  const s = SPRITES[name];
  if(!s) return;
  for(let r=0;r<s.rows.length;r++){
    const row = s.rows[r];
    for(let c=0;c<row.length;c++){
      const ch = row[c];
      if(ch==='.') continue;
      const col = s.pal[ch];
      if(!col) continue;
      artSet(buf, x+c, y+r, artRGB(col), over);
    }
  }
}

/* ---------------- 6. THE MEADOW ----------------
   Deliberately high-frequency: any coarse patch pattern would repeat at exactly
   64px on every copy of the tile and print a visible grid across the board, so
   the meadow gets speckle, tufts and flowers and nothing with a long wavelength.
   Nothing is keyed to the tile border for the same reason. */
function artPaintMeadow(buf, seed){
  const base=artRGB(PAL.meadow), dk=artRGB(PAL.meadowDk), lt=artTone(PAL.meadow,1.13);
  artFill(buf, base);
  for(let y=0;y<ART_SZ;y++) for(let x=0;x<ART_SZ;x++){
    const h = hash(x+seed*7, y-seed*3);
    if(h>0.80) artSet(buf,x,y,dk);
    else if(h<0.09) artSet(buf,x,y,lt);
    else if(h>0.70) artSet(buf,x,y,dk,0.35);
  }
  // grass tufts: a 2px blade with a lighter tip, sparse enough to stay texture
  for(let i=0;i<34;i++){
    const x=(hash(i+seed, 41)*ART_SZ)|0, y=(hash(71, i+seed)*ART_SZ)|0;
    artSet(buf,x,y+1,dk); artSet(buf,x,y,dk); artSet(buf,x+1,y+1,lt);
  }
  // flowers: mostly the pale palette flower, a few gold, one per position
  for(let i=0;i<15;i++){
    const x=(hash(i*13+seed, 199)*ART_SZ)|0, y=(hash(233, i*17+seed)*ART_SZ)|0;
    artSet(buf,x,y, artRGB(hash(i,seed)>0.72 ? PAL.gold : PAL.flower));
  }
}

/* ---------------- 7. THE FOLD ----------------
   region test at paint time (design §5): a scalar field per pixel, positive
   inside the walled area. Bands hug the fold's own sides; capsule necks join
   them through the blob centroid; low-frequency noise wobbles the boundary so
   no two walls read as the same arc. */
function artFoldField(sides, seed){
  const N=ART_SZ, f=new Float32Array(N*N);
  if(!sides.length){ f.fill(-999); return f; }
  let cx=0, cy=0;
  for(const s of sides){ cx+=ART_MID[s][0]; cy+=ART_MID[s][1]; }
  cx/=sides.length; cy/=sides.length;
  // depth of each side's band precomputed per column so the pixel loop stays arithmetic
  const depth={};
  for(const s of sides){
    const d=new Float32Array(N);
    for(let j=0;j<N;j++){
      const v=j/(N-1);
      d[j]=FOLD_D0 + FOLD_BULGE*Math.sin(Math.PI*v) + (artNoise2(seed+s*17, j, s*40, 21)-0.5)*4;
    }
    depth[s]=d;
  }
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    let v=-999;
    for(const s of sides){
      const b = depth[s][artSideJ(s,x,y)] - artSideU(s,x,y);
      if(b>v) v=b;
      const q = FOLD_SPOKE - artDistSeg(x,y, ART_MID[s][0], ART_MID[s][1], cx, cy);
      if(q>v) v=q;
    }
    f[y*N+x] = v + (artNoise2(seed, x, y, 11)-0.5)*FOLD_WOBBLE;
  }
  return f;
}
/* Turn a tile's fold fields into one mask each.

   A pixel joins a fold only if that fold's field beats every OTHER fold on the
   tile by FOLD_SEP, which leaves a strip of meadow along any seam where two of
   them meet. That strip is not decoration. FOLD2SEP_A puts two SEPARATE folds
   on ADJACENT sides; they score separately, and two bulging bands that meet at
   the corner would otherwise read as one L-shaped pen with no wall through the
   middle — a picture of a fold that does not exist, which a player would then
   count wrong. With one fold on the tile the rule costs nothing. */
function artFoldMasks(fields, sideSets){
  const out=[];
  for(let i=0;i<fields.length;i++){
    const f=fields[i], m=new Uint8Array(ART_SZ*ART_SZ);
    for(let k=0;k<m.length;k++){
      if(f[k]<=0) continue;
      let rival=-999;
      for(let j=0;j<fields.length;j++) if(j!==i && fields[j][k]>rival) rival=fields[j][k];
      if(f[k] > rival+FOLD_SEP) m[k]=1;
    }
    out.push(artCleanMask(m, sideSets[i]));
  }
  return out;
}
/* The boundary noise is what stops every wall being the same arc. It is also
   what occasionally punches a pocket of grass into the middle of a pen — where
   the field is marginal along the diagonals of a four-sided fold — or strands a
   walled crumb out in the meadow. Neither is ever in the tile data, and both
   read as a mistake, so the region is reduced to what the data actually says:
   one area, connected to the fold's own sides, with no islands inside it. */
function artCleanMask(m, sides){
  const N=ART_SZ, keep=new Uint8Array(N*N), q=[];
  const seed=(i)=>{ if(m[i] && !keep[i]){ keep[i]=1; q.push(i); } };
  for(const s of sides) for(let j=0;j<N;j++){
    if(s===0) seed(j);                       // top row
    else if(s===1) seed(j*N+(N-1));          // right column
    else if(s===2) seed((N-1)*N+j);          // bottom row
    else seed(j*N);                          // left column
  }
  for(let h=0;h<q.length;h++){
    const i=q[h], x=i%N, y=(i/N)|0;
    if(x>0)   seed(i-1);
    if(x<N-1) seed(i+1);
    if(y>0)   seed(i-N);
    if(y<N-1) seed(i+N);
  }
  // now flood the outside; unmasked pixels the outside can't reach are pockets
  const out=new Uint8Array(N*N), q2=[];
  const open=(i)=>{ if(!keep[i] && !out[i]){ out[i]=1; q2.push(i); } };
  for(let j=0;j<N;j++){ open(j); open((N-1)*N+j); open(j*N); open(j*N+(N-1)); }
  for(let h=0;h<q2.length;h++){
    const i=q2[h], x=i%N, y=(i/N)|0;
    if(x>0)   open(i-1);
    if(x<N-1) open(i+1);
    if(y>0)   open(i-N);
    if(y<N-1) open(i+N);
  }
  for(let i=0;i<keep.length;i++) if(!keep[i] && !out[i]) keep[i]=1;
  return keep;
}
/* distance inward from the wall. Out-of-bounds neighbours count as INSIDE: a
   fold that runs off the tile edge continues into whatever is placed next to
   it, so no wall is ever drawn along a tile seam. */
function artInnerDist(mask){
  const N=ART_SZ, d=new Int16Array(N*N), q=[];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const i=y*N+x;
    if(!mask[i]){ d[i]=0; continue; }
    d[i]=9999;
    if((x>0 && !mask[i-1]) || (x<N-1 && !mask[i+1]) ||
       (y>0 && !mask[i-N]) || (y<N-1 && !mask[i+N])){ d[i]=1; q.push(i); }
  }
  for(let h=0;h<q.length;h++){
    const i=q[h], x=i%N, y=(i/N)|0, nd=d[i]+1;
    if(x>0   && d[i-1]>nd){ d[i-1]=nd; q.push(i-1); }
    if(x<N-1 && d[i+1]>nd){ d[i+1]=nd; q.push(i+1); }
    if(y>0   && d[i-N]>nd){ d[i-N]=nd; q.push(i-N); }
    if(y<N-1 && d[i+N]>nd){ d[i+N]=nd; q.push(i+N); }
  }
  return d;                       // 9999 = deep interior the wall never reached
}
function artPaintFold(buf, mask, dist, seed){
  const N=ART_SZ;
  // the pen floor is wool-cream warmed toward bare earth: the palette cream on
  // its own is so pale and so flat that a fold merged across six tiles reads as
  // a beach rather than as somewhere a flock lives
  const cream=artMix(PAL.fold, PAL.foldPen, 0.28), pen=artRGB(PAL.foldPen);
  const earth=artTone(PAL.foldPen,0.82), straw=artRGB('#e3d19b'), pale=artRGB(PAL.fold);
  const wall=artRGB(PAL.wall), lit=artRGB(PAL.wallLit), dark=artRGB(PAL.wallDk);
  const rim=artTone(PAL.wallDk,0.60), block=artTone(PAL.wall,1.10), shade=artTone(PAL.wall,0.88);
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const i=y*N+x;
    if(!mask[i]) continue;
    const d=dist[i];
    if(d>=1 && d<=WALL_T){
      let c;
      if(d===1) c=rim;                                     // crisp silhouette
      else if(d===WALL_T) c=dark;                          // the wall's own shadow
      else {
        // dry stone: a coarse hash lays roughly 4px blocks, a fine one picks out
        // the mortar between them
        const b=hash((x/4)|0,(y/4)|0);
        c = b>0.72 ? block : b>0.34 ? wall : shade;
        if(hash(x+y*3, y-x)>0.86) c=dark;
      }
      // a lit crest wherever the wall faces up — that top highlight is what
      // makes slate read as a wall rather than a grey outline
      const up = (y-WALL_T-1>=0) ? mask[i-N*(WALL_T+1)] : 1;
      if(!up && d>=2 && d<WALL_T) c=lit;
      artSet(buf,x,y,c);
      continue;
    }
    // the pen floor: wool-cream trodden through to bare earth in patches, which
    // is what stops a big fold reading as a blank sheet of parchment
    artSet(buf,x,y,cream);
    const blot=artNoise2(seed+31, x, y, 7);
    if(blot>0.46) artSet(buf,x,y,pen, clamp((blot-0.46)*2.4,0,0.9));
    if(blot>0.70) artSet(buf,x,y,earth, clamp((blot-0.70)*2.6,0,0.75));
    if(blot<0.30) artSet(buf,x,y,pale, clamp((0.30-blot)*2.2,0,0.7));
    const h=hash(x*3+seed, y*5-seed);
    if(h>0.85) artSet(buf,x,y,earth,0.7);
    else if(h<0.06) artSet(buf,x,y,pale);
    // a worn ring just inside the wall, where the flock circles
    if(d>WALL_T && d<=WALL_T+4) artSet(buf,x,y,pen,0.36*(1-(d-WALL_T)/5));
  }
  // straw scatter — short dashes, never on the wall
  for(let i=0;i<36;i++){
    const x=(hash(i*7+seed,311)*N)|0, y=(hash(419,i*11+seed)*N)|0;
    const k=y*N+x;
    if(!mask[k] || dist[k]<=WALL_T+1) continue;
    const horiz=hash(i,seed)>0.5;
    artSet(buf,x,y,straw);
    artSet(buf,x+(horiz?1:0), y+(horiz?0:1), straw);
  }
}
/* interior spots ranked by how much elbow room they have, spaced apart —
   used for sheep, huts and the ram emblem so nothing lands on the wall */
/* `margin` keeps the sprite's whole bounding box on the tile: the wall never
   runs along a tile seam, so interior distance alone happily nominates a spot
   half off the edge and the flock ends up cropped in half */
function artInteriorSpots(mask, dist, seed, want, minDist, gap, avoid, margin){
  const N=ART_SZ, cand=[], m=margin||5;
  for(let y=m;y<N-m;y+=2) for(let x=m;x<N-m;x+=2){
    const i=y*N+x;
    if(!mask[i] || dist[i]<minDist) continue;
    let bad=false;
    if(avoid) for(const a of avoid){ const dx=x-a[0], dy=y-a[1]; if(dx*dx+dy*dy < gap*gap){ bad=true; break; } }
    if(bad) continue;
    cand.push([x,y, Math.min(dist[i],14) + hash(x+seed,y-seed)*6]);
  }
  cand.sort((a,b)=>b[2]-a[2]);
  const out=[];
  for(const c of cand){
    if(out.length>=want) break;
    let ok=true;
    for(const o of out){ const dx=c[0]-o[0], dy=c[1]-o[1]; if(dx*dx+dy*dy < gap*gap){ ok=false; break; } }
    if(ok) out.push(c);
  }
  return out;
}

/* ---------------- 8. PATHS: LANES, BROOKS, GATES ---------------- */
/* rounded polyline sampler: straight runs between vertices, a quadratic through
   each corner. The straight run out to the edge matters — a path has to leave
   the tile perpendicular or it won't line up with the neighbour's. */
function artPathSamples(ctrl){
  const out=[];
  if(!ctrl || ctrl.length<2) return out;
  const line=(a,b)=>{
    const dx=b[0]-a[0], dy=b[1]-a[1], L=Math.sqrt(dx*dx+dy*dy);
    const n=Math.max(1, Math.ceil(L*2));
    for(let i=1;i<=n;i++) out.push([a[0]+dx*i/n, a[1]+dy*i/n]);
  };
  const quad=(a,c,b)=>{
    const n=14;
    for(let i=1;i<=n;i++){
      const t=i/n, u=1-t;
      out.push([u*u*a[0]+2*u*t*c[0]+t*t*b[0], u*u*a[1]+2*u*t*c[1]+t*t*b[1]]);
    }
  };
  out.push([ctrl[0][0], ctrl[0][1]]);
  let cur=ctrl[0];
  for(let i=1;i<ctrl.length-1;i++){
    const v=ctrl[i], nx=ctrl[i+1];
    const toP=[cur[0]-v[0], cur[1]-v[1]], toN=[nx[0]-v[0], nx[1]-v[1]];
    const lp=Math.hypot(toP[0],toP[1])||1, ln=Math.hypot(toN[0],toN[1])||1;
    const rp=Math.min(PATH_CORNER, lp*0.5), rn=Math.min(PATH_CORNER, ln*0.5);
    const m1=[v[0]+toP[0]/lp*rp, v[1]+toP[1]/lp*rp];
    const m2=[v[0]+toN[0]/ln*rn, v[1]+toN[1]/ln*rn];
    line(cur, m1); quad(m1, v, m2); cur=m2;
  }
  line(cur, ctrl[ctrl.length-1]);
  return out;
}
/* split a sampled path into the runs that lie OUTSIDE the fold, so a lane stops
   at the wall instead of painting over it; each cut is where a gate belongs */
function artSplitAtFold(samples, mask){
  const runs=[], gates=[];
  let cur=null;
  for(let i=0;i<samples.length;i++){
    const p=samples[i], x=p[0]|0, y=p[1]|0;
    const inside = (x>=0&&y>=0&&x<ART_SZ&&y<ART_SZ) && mask && mask[y*ART_SZ+x];
    if(inside){
      if(cur){
        // the gate faces along the path's heading a few samples back, which is
        // the direction the lane was travelling when it reached the wall
        const back=samples[Math.max(0,i-3)];
        gates.push([p[0],p[1], p[0]-back[0], p[1]-back[1]]);
        runs.push(cur); cur=null;
      }
    } else {
      if(!cur) cur=[];
      cur.push(p);
    }
  }
  if(cur && cur.length) runs.push(cur);
  return { runs, gates };
}
function artStampRuns(buf, runs, profile){
  for(const band of profile){
    for(const run of runs) for(const p of run) artDisc(buf, p[0], p[1], band[0], band[1]);
  }
}
/* two wheel ruts running parallel to the path, offset along its local normal so
   they follow every bend instead of pooling at the corners */
function artRuts(buf, runs, off, col){
  for(const run of runs){
    if(run.length<2) continue;
    for(let i=0;i<run.length;i++){
      const a=run[Math.max(0,i-1)], b=run[Math.min(run.length-1,i+1)];
      let tx=b[0]-a[0], ty=b[1]-a[1];
      const L=Math.hypot(tx,ty);
      if(!L) continue;
      const nx=-ty/L, ny=tx/L, p=run[i];
      artSet(buf, Math.round(p[0]+nx*off), Math.round(p[1]+ny*off), col);
      artSet(buf, Math.round(p[0]-nx*off), Math.round(p[1]-ny*off), col);
    }
  }
}
/* where a brook segment touches only one side of the tile the water has to go
   somewhere: the spring's source pool and the lakes that cap the two branches
   are the same shape, drawn from the same fact about the data */
function artPond(buf, cx, cy, seed, r){
  r = r||POND_R;
  const bank=artRGB(PAL.bank), dk=artRGB(PAL.brookDk), w=artRGB(PAL.brook), lt=artTone(PAL.brook,1.32);
  const R=Math.ceil(r)+4;
  for(let y=-R;y<=R;y++) for(let x=-R;x<=R;x++){
    const px=Math.round(cx+x), py=Math.round(cy+y);
    if(px<0||py<0||px>=ART_SZ||py>=ART_SZ) continue;
    const d=Math.hypot(x,y);
    const rr=r+(artNoise2(seed+5, px, py, 8)-0.5)*5;
    if(d<=rr-4)      artSet(buf,px,py,w);
    else if(d<=rr-2) artSet(buf,px,py,dk);
    else if(d<=rr)   artSet(buf,px,py,bank);
  }
  for(let i=0;i<6;i++){
    const a=hash(i+seed,7)*6.2832, rr=hash(9,i+seed)*Math.max(1,r-6);
    artSet(buf, Math.round(cx+Math.cos(a)*rr), Math.round(cy+Math.sin(a)*rr), lt);
  }
}
function artGate(buf, mask, gx, gy, dx, dy){
  const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
  const px=-dy, py=dx;
  const tan=artRGB(PAL.lane), jamb=artRGB(PAL.wallDk), wood=artTone(PAL.laneRut,0.55);
  // punch the opening (only through wall pixels) and stone the jambs
  for(let a=-5;a<=5;a+=0.5) for(let p=-7;p<=7;p+=0.5){
    const x=Math.round(gx+dx*a+px*p), y=Math.round(gy+dy*a+py*p);
    if(x<0||y<0||x>=ART_SZ||y>=ART_SZ) continue;
    if(!mask[y*ART_SZ+x]) continue;
    const ap=Math.abs(a), pp=Math.abs(p);
    if(ap<=4.5 && pp<=4.0) artSet(buf,x,y,tan);
    else if(ap<=4.5 && pp<=5.8) artSet(buf,x,y,jamb);
  }
  // the gate itself: two rails between two posts
  for(let p=-3.6;p<=3.6;p+=0.4) for(const a of [-1.4,1.0]){
    artSet(buf, Math.round(gx+dx*a+px*p), Math.round(gy+dy*a+py*p), wood);
  }
  for(let a=-2.4;a<=2.0;a+=0.4) for(const p of [-3.4,3.4]){
    artSet(buf, Math.round(gx+dx*a+px*p), Math.round(gy+dy*a+py*p), wood);
  }
}
/* the crossing at the middle of a 3- or 4-way lane tile: a cobbled plaza, which
   is also the visual reason those arms are separate features */
function artHamlet(buf, hx, hy, seed){
  const stone=artTone(PAL.lane,0.92), joint=artRGB(PAL.laneRut), lit=artTone(PAL.lane,1.1);
  artDisc(buf,hx,hy,6.5,stone);
  for(let y=-7;y<=7;y++) for(let x=-7;x<=7;x++){
    if(x*x+y*y>42) continue;
    const px=Math.round(hx+x), py=Math.round(hy+y);
    const h=hash(px*5+seed, py*3-seed);
    if(h>0.74) artSet(buf,px,py,joint);
    else if(h<0.14) artSet(buf,px,py,lit);
  }
}

/* ---------------- 9. THE SHRINE ---------------- */
function artShrine(buf, sx, sy, seed){
  const ink=artRGB(PAL.ink), stone=artRGB(PAL.shrine), roof=artRGB(PAL.shrineRoof);
  const eave=artTone(PAL.shrineRoof,0.72), lit=artTone(PAL.shrine,1.12), door='#3a3129';
  const cx=Math.round(sx), top=Math.round(sy)-11;
  // a patch of trodden ground so the building sits IN the meadow rather than on
  // it; the radius wobbles because a clean disc reads as a lollipop stick
  const dirt=artTone(PAL.lane,0.90), grit=artRGB(PAL.laneRut);
  for(let y=-11;y<=11;y++) for(let x=-12;x<=12;x++){
    const px=cx+x, py=sy+4+y, d=Math.hypot(x,y);
    const rr=9.5+(artNoise2(seed+13, px, py, 7)-0.5)*5;
    if(d>rr) continue;
    artSet(buf,px,py,dirt, d>rr-2 ? 0.55 : 1);
    if(hash(px+seed, py)>0.80) artSet(buf,px,py,grit);
  }
  // gabled slate roof, drawn as widening courses
  for(let r=0;r<7;r++){
    const y=top+3+r, half=r+1;
    for(let x=-half;x<=half;x++) artSet(buf,cx+x,y, (x===-half||x===half)?ink:roof);
    if(r>0) artSet(buf,cx-half+1,y,artTone(PAL.shrineRoof,1.18));
  }
  for(let x=-8;x<=8;x++) artSet(buf,cx+x,top+10,eave);
  for(let x=-8;x<=8;x++) artSet(buf,cx+x,top+11,ink);
  // body
  for(let y=top+12;y<=top+18;y++) for(let x=-6;x<=6;x++){
    const b=(x===-6||x===6||y===top+18);
    artSet(buf,cx+x,y, b?ink:stone);
    if(!b && hash(cx+x*2, y*3+seed)>0.78) artSet(buf,cx+x,y,artTone(PAL.shrine,0.88));
    if(!b && x<-3) artSet(buf,cx+x,y,lit,0.35);
  }
  // arched doorway
  for(let y=top+14;y<=top+17;y++) for(let x=-2;x<=2;x++){
    if(y===top+14 && Math.abs(x)===2) continue;
    artSet(buf,cx+x,y, Math.abs(x)===2||y===top+14 ? ink : artRGB(door));
  }
  // the bell on its post
  artSet(buf,cx,top,ink); artSet(buf,cx,top+1,ink); artSet(buf,cx-1,top+1,ink);
  artSet(buf,cx-1,top+2,artRGB(PAL.bell)); artSet(buf,cx,top+2,artRGB(PAL.bell));
  artSet(buf,cx-1,top+3,artTone(PAL.bell,0.7)); artSet(buf,cx,top+3,artRGB(PAL.bell));
}

/* ---------------- 10. THE TILE PAINTER ---------------- */
function artTileOf(id){
  if(typeof tileById==='function'){ try{ const t=tileById(id); if(t) return t; }catch(e){} }
  const pools=[];
  if(typeof TILES!=='undefined' && Array.isArray(TILES)) pools.push(TILES);
  if(typeof BROOK_TILES!=='undefined' && Array.isArray(BROOK_TILES)) pools.push(BROOK_TILES);
  for(const p of pools){ for(const t of p) if(t && t.id===id) return t; }
  return null;
}
/* the tile centre, nudged just far enough out of the fold to give the paths
   room. Every lane and brook on the tile routes through this one point, which
   is what keeps a lane skirting a fold looking deliberate rather than random. */
function artHub(mask, clear){
  const N=ART_SZ;
  if(!mask) return [31.5,31.5];
  const d=new Int16Array(N*N), q=[];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const i=y*N+x;
    if(mask[i]){ d[i]=0; q.push(i); continue; }
    d[i]=9999;
    if(x===0||y===0||x===N-1||y===N-1){ d[i]=1; q.push(i); }
  }
  for(let h=0;h<q.length;h++){
    const i=q[h], x=i%N, y=(i/N)|0, nd=d[i]+1;
    if(x>0   && d[i-1]>nd){ d[i-1]=nd; q.push(i-1); }
    if(x<N-1 && d[i+1]>nd){ d[i+1]=nd; q.push(i+1); }
    if(y>0   && d[i-N]>nd){ d[i-N]=nd; q.push(i-N); }
    if(y<N-1 && d[i+N]>nd){ d[i+N]=nd; q.push(i+N); }
  }
  let best=1e9, bx=31.5, by=31.5, fb=-1, fx=31.5, fy=31.5;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const i=y*N+x;
    if(mask[i]) continue;
    const dx=x-31.5, dy=y-31.5, r=Math.sqrt(dx*dx+dy*dy);
    if(d[i]>fb){ fb=d[i]; fx=x; fy=y; }
    if(d[i]>=clear && r<best){ best=r; bx=x; by=y; }
  }
  return best<1e9 ? [bx+0.5,by+0.5] : [fx+0.5,fy+0.5];
}
function artSidesOfSeg(seg, centreOnly){
  const out=[];
  const e=(seg&&seg.e)||[];
  for(const slot of e){
    if(centreOnly && (slot%3)!==1) continue;
    const s=(slot/3)|0;
    if(out.indexOf(s)<0) out.push(s);
  }
  return out;
}

function artPaintTile(id){
  const buf = artNewBuf();
  const tile = artTileOf(id);
  const seed = artSeed(id);
  artPaintMeadow(buf, seed);
  if(!tile || !Array.isArray(tile.segs)){
    // unknown tile: a plain meadow with a mark, so a data bug is obvious on
    // screen instead of throwing in the middle of a frame
    const ink=artRGB(PAL.ink);
    for(let i=-6;i<=6;i++){ artSet(buf,32+i,32+i,ink); artSet(buf,32+i,32-i,ink); }
    return buf;
  }
  const segs = tile.segs;

  /* --- folds first: everything else is routed around them --- */
  const folds=[];
  let allFold=null;
  {
    const fields=[], sideSets=[], idx=[];
    for(let i=0;i<segs.length;i++){
      if(segs[i].t!=='f') continue;
      const sides=artSidesOfSeg(segs[i]);
      if(!sides.length) continue;
      fields.push(artFoldField(sides, seed+i*29));
      sideSets.push(sides);
      idx.push(i);
    }
    const masks=artFoldMasks(fields, sideSets);
    for(let n=0;n<masks.length;n++){
      folds.push({ i:idx[n], sides:sideSets[n], mask:masks[n],
                   dist:artInnerDist(masks[n]), seg:segs[idx[n]] });
      if(!allFold) allFold=new Uint8Array(ART_SZ*ART_SZ);
      for(let k=0;k<masks[n].length;k++) if(masks[n][k]) allFold[k]=1;
    }
  }
  for(const f of folds) artPaintFold(buf, f.mask, f.dist, seed+f.i*29);

  /* --- the flock, and the ram emblem if this is a prize tile --- */
  for(const f of folds){
    let area=0;
    for(let k=0;k<f.mask.length;k++) if(f.mask[k]) area++;
    const avoid=[];
    if(f.seg.spot) avoid.push([f.seg.spot[0], f.seg.spot[1]]);
    if(tile.ram && f===folds[0]){
      const r=artInteriorSpots(f.mask, f.dist, seed+3, 1, 6, 12, avoid, 6);
      if(r.length){
        avoid.push([r[0][0], r[0][1]]);
        // a one-pixel drop shadow is the whole reason the emblem reads as a
        // badge on the pen floor instead of a smudge of gold
        artSprite(buf,'ram', r[0][0]-3, r[0][1]-3, 0.35);
        artSprite(buf,'ram', r[0][0]-4, r[0][1]-4);
      }
    }
    if(area>820){
      const h=artInteriorSpots(f.mask, f.dist, seed+11, 1, 8, 16, avoid, 6);
      if(h.length){ artSprite(buf,'hut', h[0][0]-4, h[0][1]-4); avoid.push([h[0][0],h[0][1]]); }
    }
    // the flock is what stops a big pen reading as empty ground, so it scales
    // with how much floor there is to fill
    const want = area>760 ? 4 : area>380 ? 3 : 2;
    for(const s of artInteriorSpots(f.mask, f.dist, seed+7, want, 5, 10, avoid, 5))
      artSprite(buf,'sheep', s[0]-4, s[1]-3);
  }

  /* --- the hub every path routes through --- */
  const hasBrook = segs.some(s=>s.t==='b');
  const hub = artHub(allFold, hasBrook?BROOK_CLEAR:LANE_CLEAR);
  const shrineSeg = segs.find(s=>s.t==='s');
  let foldC=null;
  if(folds.length){
    let cx=0, cy=0;
    for(const s of folds[0].sides){ cx+=ART_MID[s][0]; cy+=ART_MID[s][1]; }
    foldC=[cx/folds[0].sides.length, cy/folds[0].sides.length];
  }

  const laneSegs=[], brookSegs=[];
  for(const s of segs){
    if(s.t==='l') laneSegs.push(s);
    else if(s.t==='b') brookSegs.push(s);
  }
  const stubs = laneSegs.filter(s=>artSidesOfSeg(s,true).length===1).length;

  /* the control polylines for one path segment. Two sides is one curve through
     the hub; three or more (the brook fork, and any pack tile that branches) is
     one arm per side meeting there; one side is an arm that has to END
     somewhere the eye accepts — a shrine door, a fold gate, the hamlet, or, for
     water, a pool. */
  const edgePt = s => [ART_EDGE[s][0], ART_EDGE[s][1]];
  const appPt  = s => [ART_MID[s][0]+ART_IN[s][0]*LANE_APPROACH,
                       ART_MID[s][1]+ART_IN[s][1]*LANE_APPROACH];
  const ctrlFor = (seg, isStub) => {
    const sides=artSidesOfSeg(seg,true);
    if(!sides.length) return [];
    if(sides.length===2)
      return [[edgePt(sides[0]), appPt(sides[0]), [hub[0],hub[1]], appPt(sides[1]), edgePt(sides[1])]];
    if(sides.length>2)
      return sides.map(s=>[edgePt(s), appPt(s), [hub[0],hub[1]]]);
    /* A LONE arm drives on past the hub to a gate; arms that meet other arms
       stop at the hamlet between them. FOLD1_L3 is the tile that makes the
       distinction matter — a fold on N and three lane arms below it, where
       tiles-a authored a meadow strip between the hamlet and the wall, so no
       lane on that tile touches the fold at all. FOLD3_L is the opposite: one
       stub, three fold sides, and a genuine gate. */
    const ctrl=[edgePt(sides[0]), appPt(sides[0]), [hub[0],hub[1]]];
    if(isStub){
      if(shrineSeg && shrineSeg.spot) ctrl.push([shrineSeg.spot[0], shrineSeg.spot[1]+4]);
      else if(foldC){
        const dx=foldC[0]-hub[0], dy=foldC[1]-hub[1], L=Math.hypot(dx,dy)||1;
        ctrl.push([hub[0]+dx/L*40, hub[1]+dy/L*40]);
      }
    }
    return [ctrl];
  };

  /* --- the brook, under everything that crosses it --- */
  const brookMask=new Uint8Array(ART_SZ*ART_SZ);
  const BROOK_PROFILE=[[5.6,artRGB(PAL.bank)],[4.4,artTone(PAL.bank,0.88)],
                       [3.5,artRGB(PAL.brookDk)],[2.4,artRGB(PAL.brook)]];
  for(const seg of brookSegs){
    const runs=[];
    for(const ctrl of ctrlFor(seg,false)){
      const sp=artSplitAtFold(artPathSamples(ctrl), allFold);
      for(const r of sp.runs) runs.push(r);
    }
    artStampRuns(buf, runs, BROOK_PROFILE);
    if(artSidesOfSeg(seg,true).length===1) artPond(buf, hub[0], hub[1], seed);
    // remember the water so a lane laid over it can grow sleepers
    for(const run of runs) for(const p of run){
      for(let y=-3;y<=3;y++) for(let x=-3;x<=3;x++){
        if(x*x+y*y>12) continue;
        const px=(p[0]+x)|0, py=(p[1]+y)|0;
        if(px>=0&&py>=0&&px<ART_SZ&&py<ART_SZ) brookMask[py*ART_SZ+px]=1;
      }
    }
    // ripples: short highlight dashes down the current, never animated
    let n=0;
    for(const run of runs) for(let k=0;k<run.length;k+=11){
      if((n++ & 1)===0) continue;
      const p=run[k];
      artSet(buf,p[0]|0,p[1]|0,artTone(PAL.brook,1.35));
      artSet(buf,(p[0]|0)+1,p[1]|0,artTone(PAL.brook,1.35));
    }
  }

  /* --- lanes, cut at any wall they reach, with a gate at each cut --- */
  const LANE_PROFILE=[[3.6,artTone(PAL.lane,0.80)],[2.6,artRGB(PAL.lane)]];
  const gates=[], planks=[];
  for(const seg of laneSegs){
    const sides=artSidesOfSeg(seg,true);
    const runs=[];
    for(const ctrl of ctrlFor(seg, sides.length===1 && stubs===1)){
      const sp=artSplitAtFold(artPathSamples(ctrl), allFold);
      for(const r of sp.runs) runs.push(r);
      for(const g of sp.gates) gates.push(g);
    }
    artStampRuns(buf, runs, LANE_PROFILE);
    artRuts(buf, runs, LANE_RUT_OFF, artRGB(PAL.laneRut));
    for(const run of runs) for(const p of run){
      const px=p[0]|0, py=p[1]|0;
      if(px>=0&&py>=0&&px<ART_SZ&&py<ART_SZ && brookMask[py*ART_SZ+px]) planks.push(p);
    }
  }
  if(stubs>=2) artHamlet(buf, hub[0], hub[1], seed);
  for(const g of gates) artGate(buf, allFold, g[0], g[1], g[2], g[3]);

  /* plank crossing: the lane keeps its colour over the water, but gets sleepers */
  if(planks.length){
    const wood=artTone(PAL.laneRut,0.62);
    for(let k=0;k<planks.length;k+=4){
      const p=planks[k], q=planks[Math.min(planks.length-1,k+2)];
      let dx=q[0]-p[0], dy=q[1]-p[1];
      const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
      for(let t=-3.4;t<=3.4;t+=0.4) artSet(buf, Math.round(p[0]-dy*t), Math.round(p[1]+dx*t), wood);
    }
  }

  if(shrineSeg && shrineSeg.spot) artShrine(buf, shrineSeg.spot[0], shrineSeg.spot[1], seed);
  return buf;
}

const artBaseCache = new Map(), artTileCache = new Map();
function paintTile(tileId, rot){
  rot = ((rot|0)%4+4)%4;
  const key = tileId+'_'+rot;
  let c = artTileCache.get(key);
  if(c) return c;
  let base = artBaseCache.get(tileId);
  if(!base){
    try{ base = artPaintTile(tileId); }
    catch(e){ base = artNewBuf(); artFill(base, artRGB(PAL.meadow)); }
    artBaseCache.set(tileId, base);
  }
  c = artCanvasFromBuf(artRotBuf(base, rot));
  artTileCache.set(key, c);
  return c;
}
function artClearCache(){ artBaseCache.clear(); artTileCache.clear(); artShepCache.clear(); }

/* ---------------- 11. SHEPHERDS ----------------
   10x14 standing, 10x11 seated (a herder on a meadow), plus 6px minis for the
   0.5 zoom where a half-scaled sprite would lose its hat. Recoloured per seat
   and cached — render.js only ever blits. */
const SHEP_ART = {
  stand:[ '...ooo....',
          '..ohhho.ww',
          '.ohhhhho.w',
          'oooooooo.w',
          '..offo...w',
          '..offo...w',
          '.olcccdo.w',
          'olcccccdow',
          'olcccccdow',
          '.olcccdo.w',
          '.olcccdo.w',
          '..occco..w',
          '..od.do..w',
          '..oo.oo..w' ],
  seat: [ '...ooo....',
          '..ohhho...',
          '.ohhhhho..',
          'oooooooo..',
          '..offo....',
          '..offo....',
          '.olcccdo..',
          'olcccccdo.',
          'olccccccdo',
          '.olcccddoo',
          '..ooooooo.' ],
  ministand:[ '..oo..',
              '.ohho.',
              'ooooow',
              '..ff.w',
              '.occdw',
              '.occdw',
              '.od.dw',
              '.oo.ow' ],
  miniseat: [ '..oo..',
              '.ohho.',
              'ooooo.',
              '..ff..',
              '.occd.',
              'occccd',
              '.ooooo' ],
};
const artShepCache = new Map();
function artShepCanvas(color, kind){
  const key = color+'|'+kind;
  let c = artShepCache.get(key);
  if(c) return c;
  const rows = SHEP_ART[kind] || SHEP_ART.stand;
  const w = rows[0].length, h = rows.length;
  const pal = {
    o: artRGB(PAL.ink),
    c: artRGB(color),
    l: artTone(color, 1.28),
    d: artTone(color, 0.66),
    h: artTone(color, 0.48),
    f: artRGB('#e8c49a'),
    w: artTone(PAL.laneRut, 0.72),
  };
  const buf = artNewBuf(w,h);
  for(let r=0;r<h;r++) for(let k=0;k<rows[r].length;k++){
    const ch = rows[r][k];
    if(ch==='.'||!pal[ch]) continue;
    artSet(buf,k,r,pal[ch]);
  }
  c = artCanvasFromBuf(buf);
  artShepCache.set(key,c);
  return c;
}
/* x,y is where the shepherd STANDS — bottom centre of the sprite */
function drawShepherd(ctx, color, kind, x, y, scale){
  if(!ctx || !ctx.drawImage) return;
  scale = scale || 1;
  const seated = kind==='seat' || kind==='herder' || kind==='m';
  const mini = scale < 1;
  const name = mini ? (seated?'miniseat':'ministand') : (seated?'seat':'stand');
  const cv = artShepCanvas(color||PAL.p1, name);
  const s = mini ? 1 : Math.max(1, Math.round(scale));
  const w = cv.width*s, h = cv.height*s;
  try{
    if(ctx.imageSmoothingEnabled!==undefined) ctx.imageSmoothingEnabled=false;
    ctx.drawImage(cv, Math.round(x-w/2), Math.round(y-h), w, h);
  }catch(e){}
}
/* The table the game is played on. Unbuilt cells are holes in the board, and a
   flat fill turns every one of them into a black rectangle punched through the
   screen; a woven baize gives them somewhere to be. Painted once, tiled as a
   pattern — the frame loop still only blits. */
let artFeltCv=null;
function artFelt(){
  if(artFeltCv) return artFeltCv;
  const N=64, buf=artNewBuf(N,N);
  const base=artRGB('#22301e'), dk=artRGB('#1b2718'), lt=artRGB('#2b3b26');
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const h=hash(x*7+3, y*11+5);
    // a two-directional weave, so the texture reads as cloth and not as noise
    const weave=((x+y)&3)===0 ? 0.5 : ((x-y)&5)===0 ? -0.4 : 0;
    artSet(buf,x,y, h>0.78 ? lt : h<0.16 ? dk : base);
    if(weave>0) artSet(buf,x,y,lt,0.16);
    else if(weave<0) artSet(buf,x,y,dk,0.20);
  }
  artFeltCv=artCanvasFromBuf(buf);
  return artFeltCv;
}

/* an 8x8 emblem as a standalone canvas, for chrome and the tray */
const artEmblemCache = new Map();
function artEmblem(name){
  let c = artEmblemCache.get(name);
  if(c) return c;
  const s = SPRITES[name];
  if(!s) return null;
  const buf = artNewBuf(s.w, s.h);
  artSprite(buf, name, 0, 0);
  c = artCanvasFromBuf(buf);
  artEmblemCache.set(name, c);
  return c;
}

/* ---------------- 12. THE LOGO ----------------
   pastoral counterpart to Burned Ground's burning ridge: dawn over grazed
   hills, a walled fold on the rise, the flock out in front. */
function drawLogo(cv){
  const e = cv || (typeof el==='function' ? el('logoCv') : null);
  if(!e || !e.getContext) return;
  const LW = e.width|0 || 128, LH = e.height|0 || 48;
  const buf = artNewBuf(LW, LH);
  const sky=[artRGB('#cfe0ef'), artRGB('#f7e6c4')];
  for(let y=0;y<LH;y++){
    const t=y/LH;
    const c=[sky[0][0]+(sky[1][0]-sky[0][0])*t, sky[0][1]+(sky[1][1]-sky[0][1])*t, sky[0][2]+(sky[1][2]-sky[0][2])*t];
    for(let x=0;x<LW;x++) artSet(buf,x,y,c);
  }
  // sun, then two ranks of hills so the near meadow has something behind it
  artDisc(buf, LW-26, 13, 6, artRGB('#ffe9a8'));
  artDisc(buf, LW-26, 13, 4, artRGB('#fff6d8'));
  const far=artTone(PAL.meadowDk,0.82), near=artRGB(PAL.meadow), nearDk=artRGB(PAL.meadowDk);
  for(let x=0;x<LW;x++){
    const ty=Math.round(26 - 4*Math.sin(x/21+0.6) - 2*Math.sin(x/9+2.1));
    for(let y=ty;y<LH;y++) artSet(buf,x,y,far);
    artSet(buf,x,ty,artTone(PAL.meadowDk,0.95));
  }
  for(let x=0;x<LW;x++){
    const ty=Math.round(33 - 5*Math.sin(x/17+2.4) - 2*Math.sin(x/6));
    for(let y=ty;y<LH;y++){
      const h=hash(x*3,y*5);
      artSet(buf,x,y, h>0.80?nearDk : h<0.08?artTone(PAL.meadow,1.12) : near);
    }
    artSet(buf,x,ty,artTone(PAL.meadow,1.2));
  }
  // a walled fold on the far rise
  const fx=LW-46, fy=20;
  for(let x=0;x<30;x++){
    const th=Math.round(3+1.4*Math.sin(x/5));
    for(let y=0;y<th+4;y++){
      const c = y<2 ? artRGB(PAL.wallLit) : y<th+2 ? artRGB(PAL.wall) : artRGB(PAL.wallDk);
      artSet(buf,fx+x,fy+8-y,c);
    }
  }
  artSprite(buf,'sheep', fx+6, fy+3); artSprite(buf,'sheep', fx+17, fy+2);
  // a lane down the near hill, and the flock on it
  for(let t=0;t<=40;t++){
    const x=Math.round(10+t*1.5), y=Math.round(40+3*Math.sin(t/7));
    artDisc(buf,x,y,3,artTone(PAL.lane,0.82)); artDisc(buf,x,y,2,artRGB(PAL.lane));
  }
  artSprite(buf,'sheep', 30, 38); artSprite(buf,'sheep', 41, 40);
  const g = e.getContext('2d');
  if(!g) return;
  if(g.imageSmoothingEnabled!==undefined) g.imageSmoothingEnabled=false;
  try{
    const im=g.createImageData(LW,LH);
    if(im && im.data && im.data.length===buf.d.length) im.data.set(buf.d);
    g.putImageData(im,0,0);
  }catch(err){}
  // the shepherd stands on the near hill, in front of the wordmark
  drawShepherd(g, PAL.p1, 'stand', 16, 44, 1);
  /* the wordmark sits on a plaque rather than carrying a pixel outline: at 2x
     the outline is two device px wide and closes the one-px gap between
     glyphs, which turns WOOLDOM into a single black brick. No tagline here —
     index.html already prints one under the canvas. */
  if(typeof drawPixelText==='function' && typeof textW==='function'){
    const word='WOOLDOM', tw=textW(word)*2;
    const bx=Math.round(LW/2-tw/2)-6, by=3, bw=tw+12, bh=16;
    g.fillStyle='rgba(18,22,14,.82)'; g.fillRect(bx,by,bw,bh);
    g.fillStyle='rgba(242,234,217,.16)'; g.fillRect(bx,by,bw,1);
    g.fillStyle='rgba(255,216,107,.55)'; g.fillRect(bx,by+bh-1,bw,1);
    g.save(); g.scale(2,2);
    drawPixelText(g, word, LW/4, 3, PAL.ui);
    g.restore();
  }
}

/* ---------------- 13. CONTRACT SURFACE ---------------- */
if(typeof window!=='undefined'){
  window.paintTile   = paintTile;
  window.SPRITES     = SPRITES;
  window.drawShepherd= drawShepherd;
  window.drawLogo    = drawLogo;
  window.artRotSpot  = artRotSpot;
  window.artEmblem   = artEmblem;
  window.artFelt     = artFelt;
  window.artClearCache = artClearCache;
}
