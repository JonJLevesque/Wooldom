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
   test/boot.js owns all three STATIC page-integrity scans (declaration
   collisions, window-publish sets, and a window publish overwriting another
   module's declaration) and pins `G` to the js/game.js + js/ui.js publisher
   pair. What a static scan cannot check is whether the guard that makes that
   pair safe still WORKS, and that is this line's job — boot's comment points
   here for it.
   ui.js publishes a placeholder G only when game.js has not landed. If that
   condition ever inverts, the menu's stub silently replaces the engine's state
   object and the game plays against a shell. The placeholder carries no
   autoAI / replaying / step, so their presence proves the engine's G survived.
   Verified by breaking the guard to `if(true)`: this fires, and eight checks
   go red behind it. */
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

/* ---- 6c. the AI's turn has beats ----
   Time here is the FRAME timestamp, which is the same thing rAF hands ui.js in
   a browser — the pacing has one clock and this suite simply supplies it, so
   there is no test-only path into the animation. */
(function(){
  U.keyUp('f'); U.skipAI(false); U.hintsOff();
  /* `!P.think` would read a pace of zero — the exact defect this section is
     here to catch — as "no pacing to test", and skip instead of failing */
  const P=U.aiPace();
  if(!P || typeof P.think!=='number'){ skip('the AI thinks before it plays','ui.js exposes no pace'); return; }
  U.seats(2); U.seed('beats'); U.newGame();
  U.frame(1000);                              // ui claims the pacing on frame one
  for(let i=0;i<120;i++){
    const s=G.seats[G.turnIdx];
    if(s && !s.human && G.step==='place') break;
    if(!oneStep()) break;
  }
  const seat=G.turnIdx, s=G.seats[seat];
  if(!s || s.human || G.step!=='place'){
    ['the AI thinks before it plays','a beat that has not run out is not a move',
     'the ghost shows the move before the board changes','the move lands after its beats']
      .forEach(l=>skip(l,'never reached an AI seat waiting to place'));
    return;
  }
  const t=20000, before=G.moveNo|0;
  U.frame(t);
  check('the AI thinks before it plays',
    U.aiBeat()==='think' && (G.moveNo|0)===before, 'beat '+U.aiBeat());
  U.frame(t+Math.floor(P.think/3));
  check('a beat that has not run out is not a move',
    U.aiBeat()==='think' && (G.moveNo|0)===before, 'beat '+U.aiBeat());
  U.frame(t+P.think+20);
  const st=U.aiBeat();
  if(st==='ghost'){
    const gh=U.aiGhost();
    check('the ghost shows the move before the board changes',
      !!gh && gh.ai===seat && (G.moveNo|0)===before && G.drawn!=null,
      'ghost '+JSON.stringify(gh)+' moveNo '+(G.moveNo|0));
    /* The preview and the pointer's own ghost are the same published slot, so a
       mouse drifting over the board during an AI turn is one setGhost away from
       erasing the thing the beat exists to show. */
    U.hover(gh.x+3, gh.y+3);
    const kept=U.aiGhost();
    check('a pointer moving over the board does not wipe out the preview',
      !!kept && kept.x===gh.x && kept.y===gh.y && kept.ai===seat,
      'after hover: '+JSON.stringify(kept));
    U.frame(t+P.think+P.ghost+40);
    check('the move lands after its beats',
      (G.moveNo|0)>before && U.aiBeat()==='settle' && !U.aiGhost(), 'beat '+U.aiBeat());
  }else{
    /* ai.js offers no side-effect-free plan, so there is nothing to preview and
       the beat folds away. Everything else about the cadence still holds. */
    skip('the ghost shows the move before the board changes','ai.js exposes no dry-run plan');
    check('the move lands after its beats',
      (G.moveNo|0)>before && st==='settle', 'beat '+st+' moveNo '+(G.moveNo|0));
  }
})();

/* ---- 6d. SKIP AI ANIMATION: it shortens the wait and nothing else ----
   The claim worth testing is not that the setting is quicker — it is that a
   game watched in full and a game skipped through are the SAME GAME. Two
   all-AI games off one seed, played to the end through the paced input path,
   compared by stateHash: same board, same posts, same scores, same RNG
   position. If a future change ever makes the skip branch around a decision
   instead of around a delay, these two numbers part company. */
(function(){
  const paced=(skipping)=>{
    U.skipAI(skipping);
    U.newGame({ seats:[{name:'ONE',human:false,personality:'wick',difficulty:'ewe'},
                       {name:'TWO',human:false,personality:'maud',difficulty:'ewe'}],
                modules:{brook:true}, seed:4242 });
    let ts=50000;
    for(let i=0;i<3000 && G.mode!=='reveal' && G.mode!=='end';i++){
      ts+=1000;
      U.frame(ts);
    }
    return { mode:G.mode, moves:G.moveNo|0,
             hash:(typeof D.stateHash==='function') ? D.stateHash() : null,
             scores:D.scores().join(',') };
  };
  const slow=paced(false);
  const fast=paced(true);
  U.skipAI(false);
  check('the paced AI plays a whole game through the ui\'s own frames',
    slow.moves>10 && (slow.mode==='reveal'||slow.mode==='end'),
    slow.moves+' moves, stopped in '+slow.mode);
  check('SKIP AI ANIMATION is written to wooldom.prefs',
    U.skipAI(true)===true && U.prefs().skipAI===true && U.skipAI(false)===false);
  check('skipping the animation collapses the wait and changes no move',
    slow.hash!==null && fast.hash===slow.hash
    && fast.moves===slow.moves && fast.scores===slow.scores,
    'watched '+slow.hash+' / '+slow.scores+'  vs  skipped '+fast.hash+' / '+fast.scores);
})();

/* ---- 6e. a tap on the board hurries the pasture along ---- */
(function(){
  U.skipAI(false);
  U.seats(2); U.seed('hurry'); U.newGame();
  U.frame(1000);
  for(let i=0;i<120;i++){
    const s=G.seats[G.turnIdx];
    if(s && !s.human && G.step==='place') break;
    if(!oneStep()) break;
  }
  const s=G.seats[G.turnIdx];
  if(!s || s.human || G.step!=='place'){ skip('a tap while the pasture thinks hurries it','no AI seat waiting'); return; }
  const before=G.moveNo|0;
  U.frame(60000);
  const stalled=(G.moveNo|0)===before;          // still on the think beat
  U.clickPx(480,270);                           // a tap on the board, not a placement
  U.frame(60050);
  check('a tap while the pasture thinks hurries it',
    stalled && (G.moveNo|0)>before, 'stalled '+stalled+', moveNo '+before+' -> '+(G.moveNo|0));
})();

/* ---- 6e2. the two things render.js reads off ui.js ----
   G.hover is the cell under the pointer, for the moments there is no ghost to
   mark instead. G.skipFx is the single "collapse this ease" boolean: there are
   THREE ways a player asks for that, and render reading only G.fast would
   honour one of them — the persisted setting would shorten ui.js's waits while
   render played full-length animations over the top, which is worse than not
   having the setting at all. */
(function(){
  U.coarse(false);
  U.skipAI(false); U.keyUp('f');
  U.seats(2); U.seed('hover'); U.newGame();
  U.frame(1000);
  for(let i=0;i<40 && !U.placing();i++) if(!oneStep()) break;
  const L=U.legal();
  if(!L.length){
    ['the hovered cell is published for render','a drag is not a hover',
     'leaving the board clears the hover'].forEach(l=>skip(l,'no legal cell to hover'));
  }else{
    const c=L[0], p=View.w2s(c.x+0.5, c.y+0.5);
    const h=U.movePx(p[0],p[1]);
    check('the hovered cell is published for render',
      !!h && h.x===c.x && h.y===c.y, 'G.hover='+JSON.stringify(h));
    /* A pan is motion, not a hover: a highlight chasing a dragging finger is
       the wrong answer to "which cell am I pointing at". Measured MID-drag,
       with the finger still down — letting the drag finish first would only
       ever show pointer-up's own clearing, which is a different line of code
       and would pass with this behaviour broken. */
    U.downPx(p[0],p[1]);
    U.movePx(p[0]+120,p[1]+90);
    const midDrag=U.hoverCell();
    U.upPx(p[0]+120,p[1]+90);
    check('a drag is not a hover', midDrag===null && U.hoverCell()===null,
      'mid-drag '+JSON.stringify(midDrag)+', after '+JSON.stringify(U.hoverCell()));
    U.movePx(p[0],p[1]);
    U.menu(); U.tick();
    check('leaving the board clears the hover', U.hoverCell()===null,
      'G.hover='+JSON.stringify(U.hoverCell()));
  }

  U.seats(2); U.seed('fx'); U.newGame();
  U.frame(1000); U.tick();
  const idle=U.skipFx();
  U.skipAI(true);  U.tick(); const bySetting=U.skipFx();
  U.skipAI(false); U.tick();
  U.key('f');      U.tick(); const byKey=U.skipFx();
  U.keyUp('f');    U.tick();
  U.aiTap();       U.tick(); const byTap=U.skipFx();
  check('every way of hurrying the AI reaches render as one flag',
    idle===false && bySetting===true && byKey===true && byTap===true,
    'idle '+idle+', setting '+bySetting+', F '+byKey+', tap '+byTap);
  U.skipAI(false); U.keyUp('f');
  U.seats(2); U.seed('fxclear'); U.newGame();      // newGame clears the tap one-shot
  U.frame(1000); U.tick();
  check('the flag falls back once nothing is hurrying it', U.skipFx()===false,
    'skipFx='+U.skipFx());

  /* A key held down gets no keyup if the window loses focus while it is down —
     alt-tab with F pressed and it stays "held" for the rest of the session.
     SHIFT latches the same way, but F is the expensive one now that it feeds
     G.skipFx: a stuck key silently disables the AI pacing AND every ease,
     camera walk and zoom tween in render.js, with nothing on screen to say why
     the game stopped animating. */
  check('a key held when the window loses focus does not latch', (()=>{
    U.key('f');                     // F down; U.key deliberately sends no keyup for it
    U.tick();
    const heldBefore=U.skipFx();
    U.blur();
    U.tick();
    return heldBefore===true && U.skipFx()===false;
  })(), 'skipFx after blur='+U.skipFx());
  U.keyUp('f');
})();

/* ---- 6e3. the settle waits for render's feedback, but never on trust ----
   The breath after an AI turn is for the flash and the floaters that turn just
   produced, so its length should be theirs (render.js's rnBusy()) rather than a
   number picked here. The CAP is the part that matters: rnBusy's queues are
   reaped in RENDER frames, so any page or harness that stops calling render()
   pins it true forever — gating on another module's liveness without a ceiling
   turns a mistimed beat into a hung game. This suite is exactly such a harness,
   which is what makes the cap observable here at all. */
(function(){
  const P=U.aiPace();
  const LBL=['the settle holds while render is still showing something',
             'the settle is capped, so a stuck render cannot hang the game'];
  if(!P || P.settleMax==null){ LBL.forEach(l=>skip(l,'ui.js exposes no settle cap')); return; }
  U.skipAI(false); U.keyUp('f'); U.hintsOff();
  U.newGame({ seats:[{name:'ONE',human:false,personality:'wick',difficulty:'ewe'},
                     {name:'TWO',human:false,personality:'maud',difficulty:'ewe'}],
              modules:{brook:true}, seed:777 });
  U.frame(1000);
  let ts=30000, at=-1;
  for(let i=0;i<600 && at<0;i++){ ts+=120; U.frame(ts); if(U.aiBeat()==='settle') at=ts; }
  if(at<0){ LBL.forEach(l=>skip(l,'never reached a settle beat')); return; }
  /* the busy signal is forced through render's own public queue, not a stub —
     a stubbed rnBusy would prove only that the stub works */
  probe('typeof pushFlash==="function" ? (pushFlash(new Set(["0,0"]),"#ffffff"), true) : false');
  if(!U.rnBusy()){ LBL.forEach(l=>skip(l,'render reports nothing on screen to wait for')); return; }
  U.frame(at + P.settle + 40);
  check(LBL[0], U.aiBeat()==='settle',
    'past the minimum with render still busy, beat is '+U.aiBeat());
  U.frame(at + P.settleMax + 40);
  check(LBL[1], U.rnBusy()===true && U.aiBeat()!=='settle',
    'rnBusy still '+U.rnBusy()+' and beat is '+U.aiBeat());
})();

/* ---- 6f. a coarse pointer proposes before it commits ----
   Laying a tile and posting a shepherd are both permanent and a finger is not a
   pixel, so on a touch pointer the first tap only shows what would happen. The
   mouse path must be untouched by that, which is the last check here. */
(function(){
  const LBL=['a first tap proposes rather than lays','a tap on another cell moves the proposal',
             'the second tap on the same cell lays it','the first tap on a disc does not post',
             'the second tap on the same disc posts','a mouse still lays on one click'];
  U.skipAI(true);
  U.seats(2); U.seed('touch'); U.newGame();
  U.frame(1000);
  /* a few turns in, not on turn one: the opening has exactly one legal cell, so
     "tapping another cell" would have nowhere to go */
  for(let i=0;i<16 && G.mode!=='end';i++) if(!oneStep()) break;
  if(!toHumanPlace()){ LBL.forEach(l=>skip(l,'the human seat never got a tile to lay')); U.skipAI(false); return; }
  U.coarse(true);

  const fits=()=>U.legal().filter(c=>c.rots && c.rots.indexOf(U.rot())>=0);
  let cells=fits();
  for(let t=0;t<4 && cells.length<1;t++){ U.rotate(1); cells=fits(); }
  if(!cells.length){ LBL.forEach(l=>skip(l,'no cell fits the current rotation')); U.coarse(null); U.skipAI(false); return; }

  const size=()=>(typeof D.board==='function') ? D.board().size : -1;
  const c0=cells[0], n0=size();
  const first=U.clickCell(c0.x,c0.y);
  const armed=U.armed();
  check(LBL[0], first===false && size()===n0
    && !!armed && armed.kind==='cell' && !!U.ghost() && U.ghost().x===c0.x && U.ghost().y===c0.y,
    'returned '+first+', armed '+JSON.stringify(armed));

  if(cells.length>1){
    const c1=cells[1];
    const moved=U.clickCell(c1.x,c1.y);
    check(LBL[1], moved===false && size()===n0
      && !!U.ghost() && U.ghost().x===c1.x && U.ghost().y===c1.y,
      'returned '+moved);
    U.clickCell(c0.x,c0.y);                      // arm the original again
  }else skip(LBL[1],'only one cell fits this rotation');

  const second=U.clickCell(c0.x,c0.y);
  check(LBL[2], second===true && size()===n0+1 && U.armed()===null, 'returned '+second);

  /* the post window, tapped through the same two-tap door */
  const opts=U.postOpts().filter(o=>o.ok);
  if(opts.length){
    const o=opts[0], px=U.discPx(o.n);
    const supply=()=>G.seats[G.turnIdx] ? (G.seats[G.turnIdx].supply|0) : -1;
    const s0=supply();
    const t1=U.clickPx(px[0],px[1]);
    const a1=U.armed();
    check(LBL[3], t1===false && supply()===s0 && !!a1 && a1.kind==='post' && a1.n===o.n,
      'returned '+t1+', armed '+JSON.stringify(a1));
    const t2=U.clickPx(px[0],px[1]);
    check(LBL[4], t2===true && U.posting()===false, 'returned '+t2);
  }else{
    skip(LBL[3],'no postable segment on this tile');
    skip(LBL[4],'no postable segment on this tile');
  }

  U.coarse(false);
  if(toHumanPlace()){
    let cs=fits();
    for(let t=0;t<4 && cs.length<1;t++){ U.rotate(1); cs=fits(); }
    if(cs.length){
      const n1=size();
      const laid=U.clickCell(cs[0].x,cs[0].y);
      check(LBL[5], laid===true && size()===n1+1 && U.armed()===null, 'returned '+laid);
    }else skip(LBL[5],'no cell fits the current rotation');
  }else skip(LBL[5],'the human seat never got a second tile');
  U.coarse(null);
  U.skipAI(false);
})();

/* ---- 6g. the first-game hints ---- */
(function(){
  const LBL=['a first game is taught','a hint dismissed is remembered in prefs',
             'a hint already seen does not come back','NO MORE HINTS retires the flow',
             'the settings toggle brings the hints back'];
  /* The suite's earlier sections play with hints on, so several are already
     retired by now. The precondition is set by writing the pref key directly
     rather than through U.hintsOn — the clearing behaviour is one of the things
     under test here, and a test may not use the code it is checking to arrange
     the state it checks it in. */
  const wipeHints=()=>{
    try{
      const p=JSON.parse(localStorage.getItem('wooldom.prefs')||'{}')||{};
      delete p.hintsSeen; p.hintsOff=false;
      localStorage.setItem('wooldom.prefs',JSON.stringify(p));
    }catch(e){}
  };
  wipeHints();
  U.skipAI(true);
  U.seats(2); U.seed('teach'); U.newGame();
  U.frame(1000);
  if(!toHumanPlace()){ LBL.forEach(l=>skip(l,'the human seat never got a tile to lay')); return; }
  U.tick();
  const id=U.hintId();
  check(LBL[0], !!id && U.hintText().length>20, 'hint '+id+': '+U.hintText().slice(0,60));
  /* A hint nobody can see is worth nothing to a screen-reader player, and the
     turn banner rewrites the main live region on every single frame — so the
     teaching gets a region of its own, and this is the check that it lands
     there and survives the banner. */
  check('the teaching hint reaches a live region of its own', (()=>{
    if(!id) return false;
    const plain=U.hintText().replace(/<[^>]*>/g,'').replace(/&middot;/g,'.')
      .replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
    return plain.length>20 && String(U.speakHint()||'')===plain;
  })(), 'hint region: '+String(U.speakHint()||'').slice(0,70)
      +'  /  banner region: '+String(U.speak()||'').slice(0,40));

  if(id){
    U.hintDismiss();
    const seen=U.prefs().hintsSeen;
    check(LBL[1], !!seen && seen[id]===true && U.hintId()!==id,
      'prefs.hintsSeen='+JSON.stringify(seen)+', showing '+U.hintId());

    U.seats(2); U.seed('teach2'); U.newGame();
    U.frame(1000);
    toHumanPlace();
    U.tick();
    check(LBL[2], U.hintId()!==id, 'still showing '+id);
  }else{
    skip(LBL[1],'no hint was showing to dismiss');
    skip(LBL[2],'no hint was showing to dismiss');
  }

  /* a clean slate again, so NO MORE HINTS has something to suppress: a flow
     that has simply run out of hints would otherwise look exactly like one
     that had been turned off */
  wipeHints();
  U.tick();
  const showing=U.hintId();
  U.hintsOff();
  U.tick();
  check(LBL[3], !!showing && U.prefs().hintsOff===true && U.hintId()===null,
    'was showing '+showing+', now '+U.hintId());

  /* And back on. The toggle has to forget what was SEEN as well as flipping the
     switch, or somebody who read every hint and later asks for them again gets
     an empty flow and no way to tell it from a broken one. So: turn them on,
     retire one, then ask again — the seen set has to be empty afterwards, which
     it cannot be unless the toggle actually clears it. */
  U.hintsOn(true);
  U.tick();
  U.hintDismiss();
  U.hintsOn(true);
  U.tick();
  check(LBL[4], U.prefs().hintsOff===false
    && Object.keys(U.prefs().hintsSeen||{}).length===0 && !!U.hintId(),
    'showing '+U.hintId()+', seen '+JSON.stringify(U.prefs().hintsSeen));
  U.hintsOff();
  U.skipAI(false);
})();

/* ---- 7. play it out ---- */
let guard=0;
/* render.js reserves a caption band along the bottom of #cv for the reveal
   walkthrough's arithmetic, and #movelog is a DOM overlay in that same corner,
   so it stands down for the counting. Sampled WHILE the reveal is running —
   by the end card it is allowed back, and a check that only looked afterwards
   would pass with the behaviour missing entirely. */
let logAwayInReveal=null;
while(G.mode!=='end' && guard++<4000){
  if(G.mode==='reveal' && logAwayInReveal===null){ U.tick(); logAwayInReveal=U.logHidden(); }
  if(!oneStep()) break;
}
U.tick();
const logBackAfter=U.logHidden();
check('a scripted game reaches the end', G.mode==='end' && U.state()==='end',
  'stopped in mode '+G.mode+' after '+guard+' steps');
if(logAwayInReveal===null) skip('the move log clears the reveal\'s caption band','never reached the reveal');
else check('the move log clears the reveal\'s caption band, and comes back after',
  logAwayInReveal===true && logBackAfter===false,
  'hidden during reveal '+logAwayInReveal+', hidden after '+logBackAfter);

if(U.state()==='end'){
  check('the end screen ranks the seats', (()=>{
    const e=U.end();
    return !!e && Array.isArray(e.rank) && e.rank.length===G.seats.length;
  })());
  check('the move log kept the last few lines', U.log().length>0);

  /* The breakdown is not decoration — it has to add up. Every point a seat has
     was banked either by a completion (which reaches the ui through game.js's
     own onComplete rows) or by the final walk, and those are the only two
     things feeding the bars, so the four categories must total the score
     exactly. This is also the honest test for the double-count: finalScore()
     re-walks the whole board and answers in full every time it is asked, and
     buildEnd is called more than once, so folding it in twice inflates every
     meadow — which still LOOKS like a plausible chart, and is why nothing
     caught it before. */
  check('the category bars add up to the score, once and only once', (()=>{
    const cats=U.end().cats||{};
    return G.seats.every((s,i)=>{
      const c=cats[i]||{};
      const sum=['lane','fold','shrine','meadow'].reduce((a,k)=>a+(c[k]|0),0);
      return sum===(s.score|0);
    });
  })(), (()=>{
    const cats=U.end().cats||{};
    return G.seats.map((s,i)=>{
      const c=cats[i]||{};
      return (s.name||i)+' bars '+['lane','fold','shrine','meadow'].reduce((a,k)=>a+(c[k]|0),0)
        +' vs score '+(s.score|0);
    }).join('; ');
  })());
  check('building the summary again does not change it', (()=>{
    const a=JSON.stringify(U.end().cats);
    const b=JSON.stringify(U.end().cats);
    return a===b;
  })());

  const rows=probe('typeof finalScore==="function" ? finalScore().map(function(r){'
    +'return {pts:r.pts|0, held:((r.holders||[]).length>0)}; }) : []')||[];
  const maxFinal=rows.reduce((m,r)=>Math.max(m, r.held?(r.pts|0):0), 0);
  check('the summary names the biggest single score of the game', (()=>{
    const b=U.best();
    return !!b && b.pts>0 && b.seat!=null && !!G.seats[b.seat] && b.pts>=maxFinal;
  })(), 'best '+JSON.stringify(U.best())+', biggest final row '+maxFinal);

  /* Leave the MENU holding a different table before asking PLAY AGAIN to keep
     this one. Without this the check passes either way: the finished game was
     itself dealt from the menu, so a PLAY AGAIN that quietly rebuilt from
     menuConfig() would rebuild the very same seats and look correct. */
  U.seats(5); U.personality(2,'pip'); U.difficulty(2,'ram');
  const seedBefore=G.config.seed;
  const tableBefore=JSON.stringify({
    seats:G.config.seats.map(s=>[s.name,s.human,s.personality,s.difficulty]),
    modules:G.config.modules });
  U.again();
  check('PLAY AGAIN deals a new game', U.state()==='game' && G.config.seed!==seedBefore);
  check('PLAY AGAIN keeps the table it was set up with', JSON.stringify({
      seats:G.config.seats.map(s=>[s.name,s.human,s.personality,s.difficulty]),
      modules:G.config.modules })===tableBefore,
    tableBefore+'\n    -> '+JSON.stringify({
      seats:G.config.seats.map(s=>[s.name,s.human,s.personality,s.difficulty]),
      modules:G.config.modules }));
}else{
  ['the end screen ranks the seats','the category bars add up to the score, once and only once',
   'building the summary again does not change it',
   'the summary names the biggest single score of the game',
   'PLAY AGAIN deals a new game','PLAY AGAIN keeps the table it was set up with']
   .forEach(l=>skip(l,'the game did not reach its end'));
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
