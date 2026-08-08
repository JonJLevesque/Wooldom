'use strict';
/* ==================================================================
   WOOLDOM — a tile-laying pastoral in plain JS
   Load order (index.html is law):
     core → audio → tiles → board → art → game → ai → [pack-*] → render → ui
   Globals are the module system. CONTRACT.md lists who owns what.
   All rules original; all art procedural; all gameplay randomness via RNG.
   ================================================================== */

/* ---------------- 1. CONSTANTS & HELPERS ---------------- */
const TILE = 64;                     // art px per tile at zoom 1
const TPS = 30;                      // animation clock ticks/sec (no physics here)
const SHEPHERDS = 7;                 // followers per seat, all playable
const ZOOMS = [0.5, 1, 2];           // board zoom steps → 32/64/128 px tiles

/* shared palette — wool-pastoral family; stable keys, never rename */
const PAL = {
  meadow:'#7db661', meadowDk:'#659a4c', flower:'#e8e4f0',
  lane:'#c9a86a', laneRut:'#a8874c',
  fold:'#f2ecdd', foldPen:'#d5cbb2', wall:'#8a8f98', wallLit:'#b7bcc4', wallDk:'#5d626b',
  brook:'#4f8edc', brookDk:'#2f66a8', bank:'#d8c68e',
  shrine:'#b0a8a0', shrineRoof:'#6b6560', bell:'#e8c04a',
  ram:'#e8c04a', ink:'#241f1a', night:'#141a14', parch:'#f4eeda',
  p1:'#4f8edc', p2:'#d95b43', p3:'#e8c04a', p4:'#7aa85a', p5:'#9a6fc0',
  ui:'#f2ead9', uiDim:'#c3b9a4', good:'#7cb85c', bad:'#d95b43', gold:'#ffd86b',
};

const clamp = (v,a,b)=> v<a?a : v>b?b : v;
// deterministic stateless hash 0..1 — texture/cosmetics only, NEVER gameplay
function hash(x,y){ let n=(x*73856093 ^ y*19349663)>>>0; n=(n^(n>>13))*0x5bd1e995>>>0; return ((n>>>8)&255)/255; }

/* seeded PRNG (mulberry32) — the ONLY source of gameplay randomness:
   satchel shuffles, AI eval noise, brook draw order. Cosmetics use
   Math.random so rendering never perturbs a replay. */
const RNG = (()=>{ let s=1;
  function next(){ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s);
    t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }
  return { seed(n){ s=n|0; }, get state(){ return s; }, next,
           range:(a,b)=>a+next()*(b-a), int:n=>(next()*n)|0,
           pick:a=>a[(next()*a.length)|0],
           shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(next()*(i+1))|0;
             const t=a[i]; a[i]=a[j]; a[j]=t; } return a; } };
})();

/* small DOM + formatting helpers (shared by every module) */
function el(id){ return document.getElementById(id); }
function show(id){ el(id).classList.remove('hidden'); }
function hide(id){ el(id).classList.add('hidden'); }
function cellKey(x,y){ return x+','+y; }
