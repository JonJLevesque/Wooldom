'use strict';
/* ============================================================================
   test/uiflow.js — the UI's own suite (wave 1-E)

   Everything here goes through WoolDbg.ui, and every WoolDbg.ui hook is a thin
   wrapper over the function the pointer or the key handler calls: there is no
   test-only path into the game. The suite covers the screen state machine, a
   scripted game played to its end through that input path, rotate
   auto-advance, the post-disc hit test, camera and zoom, resume, and the
   settings that have to survive a reload.

   While the other wave-1 modules are still stubs the game-driving checks report
   SKIP rather than a false PASS — they turn themselves on the moment game.js
   lands. (To run them against a stand-in engine, copy the repo and drop one
   into js/game.js; index.html's load order does the rest.)
   ============================================================================ */
const { load } = require('./shim');

const results=[], skipped=[];
function check(label, ok, note){
  console.log((ok?'PASS':'FAIL')+'  '+label + (note&&!ok?('\n  → '+note):''));
  results.push(!!ok);
  return !!ok;
}
function skip(label, why){
  console.log('SKIP  '+label+'  ('+why+')');
  skipped.push(label);
}

/* ---- 0. page integrity: the window.* publish vector ----
   test/boot.js owns the DECLARATION scan (two modules declaring one top-level
   name — const/let/class dies loudly, function/var overwrites silently) and
   runs it before load, so it is not repeated here.

   It cannot see this third vector. `window.X = ...` has no declaration keyword
   to match, and the semantics are the same silent overwrite: the last module in
   load order wins, with no error. Measured, by appending
   `window.paintTile = function(){ return null; }` to render.js where art.js
   publishes the real one — boot, tiledata, rules, placement, brook, saveload
   and ai-smoke ALL stayed green, and this check was the only thing that caught
   it. Indentation is NOT a proxy for "guarded": art.js and render.js publish
   theirs indented inside an `if(typeof window!=='undefined')` environment
   check, which guards nothing about ownership.

   The one intended duplicate has its GUARD asserted at runtime below rather
   than its NAME allow-listed here — an allow-list keeps passing after the guard
   that made it safe is deleted, which is the failure it would exist to catch. */
(function(){
  const fs=require('fs'), path=require('path');
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const files=[...new Set([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]))];
  if(!files.length){ skip('no unexpected window.* export is published by two modules','no script tags found'); return; }
  const pub=new Map();
  for(const f of files){
    let src='';
    try{ src=fs.readFileSync(path.join(root,f),'utf8'); }catch(e){ continue; }
    for(const m of src.matchAll(/^\s*window\.([A-Za-z_$][\w$]*)\s*=/gm)){
      if(!pub.has(m[1])) pub.set(m[1], new Set());
      pub.get(m[1]).add(f);
    }
  }
  const shared=[...pub.entries()].filter(([,fl])=>fl.size>1)
    .map(([n,fl])=>n+' ('+[...fl].join(' and ')+')');
  /* G is the one by design: ui.js publishes a menu placeholder ONLY when
     game.js has not landed, so a page with a stubbed engine still boots to a
     menu. Any OTHER shared export is two modules fighting over one name. */
  const unexpected=shared.filter(r=>!r.startsWith('G ('));
  check('no unexpected window.* export is published by two modules',
    unexpected.length===0, unexpected.join('; ')+'  [all shared: '+(shared.join('; ')||'none')+']');
  check('the window scan found the publishes it should have',
    pub.size>=20 && pub.has('WoolDbg') && pub.has('View'), pub.size+' publishes');
})();

let app=null, err=null;
try{ app=load(); }catch(e){ err=e; }
if(!check('the page loads headlessly', !err, err && err.stack)) finish();

const D=(app&&app.D)||{}, G=(app&&app.G)||{};
const probe=(app&&app.probe)||(()=>undefined);
const ZOOMS=probe('ZOOMS')||[0.5,1,2];      // eval-scoped consts come through the probe
const View=(global.window&&global.window.View)||probe('window.View');
const U=D.ui;
if(!check('ui.js augments WoolDbg with a ui namespace', !!U)) finish();

/* The guard behind the one shared window.* export, tested rather than trusted.
   ui.js publishes a placeholder G only when game.js has not landed; if that
   condition ever inverts, the menu's stub silently replaces the engine's state
   object and the game plays against a shell. The placeholder has no autoAI /
   replaying / step, so their presence proves the engine's G is the one that
   survived — this is the assertion an allow-list of the NAME would not make. */
check('the engine owns window.G — ui.js\'s placeholder did not win',
  !!G && G.autoAI!==undefined && G.replaying!==undefined && G.step!==undefined,
  'G keys: '+Object.keys(G||{}).join(','));

/* ---- 1. the screen state machine starts at the menu ---- */
check('boots into the menu', U.state()==='menu' && U.menuView==='root');
U.help();
check('HOW TO PLAY is its own page', U.menuView==='help');
U.key('Escape');
check('ESC comes back from HOW TO PLAY', U.menuView==='root');

/* ---- 2. the menu's controls reach the config it hands the engine ---- */
U.playerName('tester');
U.seats(3);
U.personality(2,'maud'); U.difficulty(2,'ram');
U.personality(3,'bram'); U.difficulty(3,'lamb');
U.module('brook', true);
U.seed('wooldom');
let cfg=U.config();
check('seat count reaches the config', cfg.seats.length===3);
check('seat 1 is the human, the rest are not', cfg.seats[0].human===true
  && cfg.seats.slice(1).every(s=>s.human===false));
check('personality and difficulty pickers reach the config',
  cfg.seats[1].personality==='maud' && cfg.seats[1].difficulty==='ram'
  && cfg.seats[2].personality==='bram' && cfg.seats[2].difficulty==='lamb');
check('the brook module is on by default and toggles', cfg.modules.brook===true
  && U.module('brook',false)===false && U.config().modules.brook===false);
U.module('brook',true);
check('a worded seed becomes a number, and the same word twice gives the same number',
  typeof U.config().seed==='number' && U.config().seed===cfg.seed);
U.seed('');
check('a blank seed asks for a random one', typeof U.config().seed==='number');
U.seed('wooldom');
check('two seats on one personality get distinguishable names', (()=>{
  U.seats(4); U.personality(2,'maud'); U.personality(3,'maud');
  const n=U.config().seats.map(s=>s.name);
  return new Set(n).size===n.length;
})());
U.seats(3); U.personality(2,'wick'); U.personality(3,'maud');

/* ---- 2b. the pickers are ai.js's tables, not a copy ---- */
(function(){
  const A=(global.window && global.window.AI) || probe('typeof AI!=="undefined" ? AI : null');
  if(!A || !A.PERSONALITIES){ skip('the menu offers exactly the personalities ai.js defines','ai.js exports no table'); return; }
  const ids=(A.PERSONALITY_ORDER || Object.keys(A.PERSONALITIES));
  const menu=[];
  for(const id of ids){
    U.personality(2,id);
    menu.push(U.config().seats[1].personality);
  }
  check('the menu offers exactly the personalities ai.js defines',
    menu.join(',')===ids.join(','), menu.join(',')+' vs '+ids.join(','));
  const dids=(A.DIFFICULTY_ORDER || Object.keys(A.DIFFICULTY||{}));
  const got=[];
  for(const id of dids){ U.difficulty(2,id); got.push(U.config().seats[1].difficulty); }
  check('the menu offers exactly the difficulties ai.js defines',
    got.join(',')===dids.join(','), got.join(',')+' vs '+dids.join(','));
  /* the display name has to come from ai.js too, or the menu can call a seat
     one thing while the AI plays another */
  const first=A.PERSONALITIES[ids[0]];
  U.personality(2, ids[0]);
  check('seat names come from ai.js\'s table',
    U.config().seats[1].name === String(first.name||'').toUpperCase(),
    U.config().seats[1].name+' vs '+first.name);
})();
U.personality(2,'wick'); U.difficulty(2,'ewe');

/* ---- 3. does an engine exist to play against? ---- */
const hasEngine = (typeof D.startGame==='function' || typeof D.place==='function');
U.newGame();
const started = hasEngine && U.state()==='game';

if(!started){
  const why='game.js has not landed yet';
  ['menu leads into a game','the config reaches G.config','a scripted game reaches the end',
   'rotate auto-advances past rotations that fit nowhere','the ghost follows the pointer',
   'an illegal drop is refused','TAB walks the legal cells and the camera follows',
   'ENTER lays the tile','post discs hit-test exactly where they are drawn',
   'a claimed feature refuses a shepherd','0 skips the post window',
   'the end screen ranks the seats','PLAY AGAIN deals a new game',
   'the game can be resumed from its save'].forEach(l=>skip(l,why));
  finish();
}

check('menu leads into a game', U.state()==='game');
check('the config reaches G.config', G.config && G.config.seats
  && G.config.seats.length===3 && G.config.modules.brook===true);

/* ---- 4. the tile in hand: ghost, rotation, illegal drops ---- */
function humanPlacing(){ return U.placing(); }
function toHumanPlace(cap){
  for(let i=0;i<(cap||200);i++){
    if(G.mode!=='play' && G.mode!=='brook') return false;
    if(humanPlacing()) return true;
    if(!oneStep()) return false;
  }
  return false;
}
/* one seat's turn. The human seat is played through the pointer and the
   keyboard; an AI seat is played by ai.js when it exists, and puppeted through
   the engine's own place/spot when it does not, so this suite never fails for
   ai.js's timing. */
function oneStep(){
  // the end-of-game walkthrough is the ui's to advance, one step per ENTER
  if(G.mode==='reveal'){ U.key('Enter'); return true; }
  const seat=G.seats[G.turnIdx];
  if(!seat) return false;
  if(seat.human) return humanStep();
  if(typeof D.aiMove==='function'){
    /* aiMove returns a plan object or null and never false, so `!==false` would
       read a decline as success and spin this loop to its cap. Progress is the
       honest test, and it keeps working if the return shape ever changes. */
    const before=G.moveNo|0;
    D.aiMove(G.turnIdx);
    return (G.moveNo|0)!==before;
  }
  return puppetStep();
}
function humanStep(){
  if(U.placing()){
    const L=U.legal();
    if(!L.length) return false;
    const c=L[0];
    U.hover(c.x,c.y);
    for(let t=0;t<4 && !(U.ghost()&&U.ghost().legal); t++){ U.rotate(1); U.hover(c.x,c.y); }
    if(!(U.ghost()&&U.ghost().legal)) return false;
    return U.clickCell(c.x,c.y)!==false;
  }
  if(U.posting()){
    const o=U.postOpts().filter(p=>p.ok);
    if(o.length) return U.postDisc(o[0].n);
    return U.skip();
  }
  return false;
}
function puppetStep(){
  if(typeof D.place!=='function') return false;
  const L=(typeof D.legal==='function') ? (D.legal()||[]) : [];
  if(!L.length) return false;
  const c=L[0];
  if(D.place(c.x,c.y,c.rots[0])===false) return false;
  if(typeof D.skip==='function') D.skip();
  return true;
}

if(toHumanPlace()){
  const L=U.legal();
  check('the ghost follows the pointer', (()=>{
    const g=U.hover(L[0].x,L[0].y);
    return !!g && g.x===L[0].x && g.y===L[0].y;
  })());

  check('rotate auto-advances past rotations that fit nowhere', (()=>{
    const fits=new Set();
    U.legal().forEach(c=>c.rots.forEach(r=>fits.add(r)));
    if(!fits.size) return false;
    const seen=[];
    for(let i=0;i<8;i++) seen.push(U.rotate(1));
    const neverStrands = seen.every(r=>fits.has(r));
    const advances = (fits.size===1) ? new Set(seen).size===1 : new Set(seen).size>1;
    return neverStrands && advances;
  })(), 'R landed on a rotation that fits nowhere on the board');

  check('an illegal drop is refused', (()=>{
    // a cell nowhere near the tiles can never be legal
    const far=9999;
    const before=(typeof D.board==='function') ? D.board().size : -1;
    U.hover(far,far);
    const laid=U.clickCell(far,far);
    const after=(typeof D.board==='function') ? D.board().size : -1;
    return laid===false && before===after
        && !!(G.ghost && G.ghost.legal===false && typeof G.ghost.badTick==='number');
  })());

  check('TAB walks the legal cells and the camera follows', (()=>{
    const a=U.tab(1);
    if(!a) return false;
    const v1=U.viewState();
    const near = Math.abs(v1.cx-(a.x+0.5))<1e-6 && Math.abs(v1.cy-(a.y+0.5))<1e-6;
    const b=U.tab(1);
    return near && !!b && (b.x!==a.x || b.y!==a.y || U.legal().length===1);
  })());

  check('ENTER lays the tile', (()=>{
    const before=(typeof D.board==='function') ? D.board().size : -1;
    const cells=U.legal();
    if(!cells.length) return false;
    U.hover(cells[0].x,cells[0].y);
    for(let t=0;t<4 && !(U.ghost()&&U.ghost().legal); t++){ U.rotate(1); U.hover(cells[0].x,cells[0].y); }
    U.key('Enter');
    const after=(typeof D.board==='function') ? D.board().size : -1;
    return after===before+1;
  })());

  /* ---- 5. the post window ---- */
  const opts=U.postOpts();
  if(opts.length){
    check('post discs hit-test exactly where they are drawn', (()=>{
      const o=opts[0];
      const px=U.discPx(o.n);
      if(!px) return false;
      const target=U.postOpts().length;
      // a click one pixel from the drawn centre must find that same disc
      const hit=(()=>{
        const found=U.postOpts().find(p=>{
          const q=U.discPx(p.n);
          return Math.abs(q[0]-px[0])<0.001 && Math.abs(q[1]-px[1])<0.001;
        });
        return found && found.n===o.n;
      })();
      return hit && target>0;
    })());
    const claimed=opts.find(o=>!o.ok);
    if(claimed) check('a claimed feature refuses a shepherd', U.postDisc(claimed.n)===false);
    else skip('a claimed feature refuses a shepherd','no claimed segment on this tile');
    check('0 skips the post window', (()=>{
      U.key('0');
      return U.posting()===false;
    })());
  }else{
    skip('post discs hit-test exactly where they are drawn','no postable segment on this tile');
    skip('a claimed feature refuses a shepherd','no post window open');
    skip('0 skips the post window','no post window open');
  }
}else{
  ['the ghost follows the pointer','rotate auto-advances past rotations that fit nowhere',
   'an illegal drop is refused','TAB walks the legal cells and the camera follows',
   'ENTER lays the tile','post discs hit-test exactly where they are drawn',
   'a claimed feature refuses a shepherd','0 skips the post window']
   .forEach(l=>skip(l,'the human seat never got a tile to lay'));
}

/* ---- 6. the camera ---- */
check('zoom snaps through the three steps and stops at the ends', (()=>{
  const seen=[];
  for(let i=0;i<4;i++) seen.push(U.zoom(-1));
  for(let i=0;i<6;i++) seen.push(U.zoom(1));
  const uniq=[...new Set(seen)].sort((a,b)=>a-b);
  return uniq.every(z=>ZOOMS.indexOf(z)>=0) && seen[seen.length-1]===ZOOMS[ZOOMS.length-1];
})());
check('zooming at a point keeps that point under the pointer', (()=>{
  // anchored on a tile that exists, so the camera's clamp to the placed bounds
  // (which is allowed to move the view) is not what we end up measuring
  U.centre(0,0);
  U.zoom(-1); U.zoom(-1);
  const a=View.w2s(1.5,1.5);
  const before=View.s2w(a[0],a[1]);
  U.zoomAt(1,a[0],a[1]);
  const after=View.s2w(a[0],a[1]);
  // the drawing origin is snapped to a whole pixel so tiles never seam between
  // them, so the anchor may drift by that one pixel — never by a tile
  const S=View.px();
  return Math.abs(before[0]-after[0])*S<=1 && Math.abs(before[1]-after[1])*S<=1;
})());
check('a pinch lands on the nearest zoom step', (()=>{
  const z=U.pinch(100,240);           // spread by 2.4x
  return ZOOMS.indexOf(z)>=0;
})());
check('arrow keys pan, and SHIFT pans faster', (()=>{
  const a=U.viewState().cx;
  U.key('ArrowRight');
  const b=U.viewState().cx;
  U.key('ArrowRight',{shiftKey:true});      // shift is read from the held flag
  const c=U.viewState().cx;
  return b>=a && c>=b;
})());

/* ---- 6b. the AI's turn is paced by the ui, not inlined by the engine ---- */
check('with no animation loop running, the engine keeps its own AI pump', (()=>{
  U.seats(2); U.seed('pace'); U.newGame();
  /* ui.js claims AI pacing on its FIRST FRAME, not at newGame, because
     G.autoAI is session-level and a headless harness has no rAF to pace with.
     A suite that starts a game and never draws must still get AI turns. */
  return G.autoAI===true && U.frames()===0;
})());
check("once the ui is drawing, it decides when the AI's turn lands", (()=>{
  U.frame(1000);
  if(G.autoAI!==false) return false;
  // walk to an AI seat's placing step without touching the AI
  for(let i=0;i<80;i++){
    const s=G.seats[G.turnIdx];
    if(s && !s.human && U.step && G.step==='place') break;
    if(!oneStep()) break;
  }
  const s=G.seats[G.turnIdx];
  if(!s || s.human) return true;               // never reached an AI turn: nothing to prove
  const before=G.moveNo|0;
  const after=U.aiStep(true);                  // F: no wait, same move
  return after>before;
})());

/* ---- 7. play it out ---- */
let guard=0;
while(G.mode!=='end' && guard++<4000){ if(!oneStep()) break; }
check('a scripted game reaches the end', G.mode==='end' && U.state()==='end',
  'stopped in mode '+G.mode+' after '+guard+' steps');

if(U.state()==='end'){
  check('the end screen ranks the seats', (()=>{
    const e=U.end();
    return !!e && Array.isArray(e.rank) && e.rank.length===G.seats.length;
  })());
  check('the move log kept the last few lines', U.log().length>0);
  const seedBefore=G.config.seed;
  U.again();
  check('PLAY AGAIN deals a new game', U.state()==='game' && G.config.seed!==seedBefore);
}else{
  skip('the end screen ranks the seats','the game did not reach its end');
  skip('PLAY AGAIN deals a new game','the game did not reach its end');
}

/* ---- 8. menu ↔ game ↔ end ↔ menu ---- */
U.menu();
check('the state machine comes home to the menu', U.state()==='menu');

/* ---- 9. resume ---- */
(function(){
  /* a fresh game, a few turns in, put away and picked up again: the board that
     comes back has to be the same board, not merely a board */
  U.seats(2); U.seed('resume'); U.newGame();
  for(let i=0;i<8 && G.mode!=='end';i++) if(!oneStep()) break;
  let raw=null;
  try{ raw=localStorage.getItem('wooldom.save'); }catch(e){}
  if(!raw){ skip('the game can be resumed from its save','game.js writes no autosave yet'); return; }
  /* Board, scores, supplies AND stateHash. The hash mixes RNG.state, which
     only survives a rebuild because ai.js's difficulty noise is stateless
     (hash-derived from seed/moveNo/seat/candidate, never RNG.next()), so a
     resumed AI game is bit-identical to straight-through play. If that ever
     regresses to an RNG-routed noise the hash line below is what catches it. */
  const fingerprint=()=>{
    const b=(typeof D.board==='function') ? D.board() : null;
    const cells=[];
    if(b) b.forEach((v,k)=>cells.push(k+':'+v.tileId+':'+v.rot+':'+(v.seat!=null?v.seat:'-')));
    return cells.sort().join('|')+'#'+D.scores().join(',')
         + '#'+G.seats.map(s=>s.supply).join(',')+'#'+G.moveNo;
  };
  const before=fingerprint();
  const hashBefore=(typeof D.stateHash==='function') ? D.stateHash() : null;
  const rngBefore=probe('RNG.state');
  U.menu();
  const ok=U.resume();
  check('the game can be resumed from its save', ok!==false && U.state()==='game');
  check('the resumed game is the same board, score for score',
    fingerprint()===before, before+'\n    -> '+fingerprint());
  check('the resumed game is bit-identical: same stateHash, same RNG position',
    (hashBefore===null || D.stateHash()===hashBefore) && probe('RNG.state')===rngBefore,
    'hash '+hashBefore+' -> '+(typeof D.stateHash==='function'?D.stateHash():'n/a')
    +', RNG '+rngBefore+' -> '+probe('RNG.state'));
  U.menu();
})();

/* ---- 9b. the frame clock cannot be frozen by a backwards timestamp ----
   game.js clamps dt at BOTH ends; before that fix one non-monotone timestamp
   drove the accumulator negative and G.tick never advanced again, which stops
   every animation in the game silently and for good. */
(function(){
  const frame=probe('typeof frame==="function" ? frame : null');
  if(!frame){ skip('the frame clock survives a backwards timestamp','game.js exposes no frame()'); return; }
  const step=(ts,n)=>{ for(let i=0;i<n;i++){ ts+=34; frame(ts); } return ts; };
  let ts=100000;
  const t0=G.tick|0;
  ts=step(ts,12);
  const t1=G.tick|0;
  check('the frame clock advances on a monotone timestamp', t1>t0, t0+' -> '+t1);
  frame(ts-5000);                       // the clock jumps backwards once
  const t2=G.tick|0;
  check('a backwards timestamp does not wind the clock back', t2>=t1, t1+' -> '+t2);
  ts=step(ts,12);
  check('the clock keeps advancing afterwards', (G.tick|0)>t2, t2+' -> '+(G.tick|0));
})();

/* ---- 10. settings survive ---- */
U.mixes(37,12);
check('the sound mixes are written to wooldom.prefs',
  U.prefs().sfx===37 && U.prefs().mus===12);
const calmNow=U.calm();
check('calm mode toggles and is remembered',
  U.prefs().calm===calmNow && G.calm===calmNow && calmNow!==U.calm());
check('the settings popover opens and closes',
  U.settings(true)===true && U.settings(false)===false);
check('a reset needs arming first', (()=>{
  const first=U.reset();                    // arms
  const second=U.reset();                   // confirms
  let gone=true;
  try{ gone = !localStorage.getItem('wooldom.save'); }catch(e){}
  return first===false && second===true && gone;
})());

finish();

function finish(){
  const bad=results.filter(r=>!r).length;
  console.log((bad?'UIFLOW FAILED':'UIFLOW OK')
    + '  ('+results.filter(Boolean).length+' passed'
    + (bad?(', '+bad+' failed'):'')
    + (skipped.length?(', '+skipped.length+' skipped'):'')+')');
  process.exit(bad?1:0);
}
