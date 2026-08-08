'use strict';
/* Wooldom — Web Audio synthesis: buses, sfx, ambience + generative music.

   The engine is Burned Ground's Snd ported unchanged: the master/limiter bus
   chain, the look-ahead scheduler, the per-source gate pools, the
   no-op-without-a-context safety, the hostile-argument guards, and the
   THEMES / AMB / THEME_SETUP tables that the engine reads without ever
   learning a theme's name. Everything below the engine is Wooldom content,
   and all of it arrives as table rows — adding a theme is a THEMES entry, an
   AMB entry and (optionally) a THEME_SETUP row; adding a wave-3 pack sound is
   one more row in the returned object. No engine code changes for either.

   Three deliberate differences from the port source, all of them content:

   1. panOf spans FIELD_W = 960 — the canvas's logical width, from index.html's
      <canvas id="cv" width="960"> — where Burned Ground spanned its 640-wide
      field. A pan-x here is therefore canvas-space: where the event appears on
      screen, not a board cell, because Wooldom's board pans and zooms under a
      fixed canvas and a cell has no permanent position in the stereo field.
      Callers holding only a cell should either run it through the view
      transform or pass nothing at all, which centres the sound.
   2. The wind bed is gone. It existed there because wind was a gameplay tell
      that had to survive both a theme change and the music being switched off.
      Wooldom has no such value, so its breeze is an ordinary AMB bed and dies
      with its theme like every other bed.
   3. The arena themes and the artillery sfx are replaced by Wooldom's rows.

   musicIntensity(v) carries game.js's satchel-depletion signal under the
   0.5 + 0.5t convention: t is how far through the satchel the game has got, so
   v is 0.5 on the first tile and 1.0 on the last. The scheduler opens the hi()
   layer on intensity > 0.5 strictly, which is what makes a full satchel sound
   like the plain theme — 0.5 is silence for hi(), not a whisper of it. */
/* ---------------- 2. AUDIO ---------------- */
const Snd = (()=>{
  const MASTER_BASE = 0.5;            // reference loudness (original fixed gain)
  const AMB_LEVEL   = 0.7;            // ambient-bed bus target
  const DUCK_LEVEL  = 0.35;           // music level while ducked (settings open)
  const AMB_BEAT    = 0.5;            // seconds per ambient scheduler step
  const DEFAULT_THEME = 'pasture';    // fallback when asked for a theme we lack
  const FIELD_W = 960;                // canvas logical width — the pan-x domain

  let ctx=null, noiseBuf=null, muted=false;
  // fixed bus chain: destination <- master <- limiter <- {musicBus, sfxBus}
  let master=null, limiter=null, musicBus=null, sfxBus=null, musicDuck=null, musicLift=null;
  let vol=0.85, musicVol=1, sfxVol=1, ducked=false, intensity=0;
  // music engine state
  let musicTimer=null, musicGain=null, voiceBus=null, ambBus=null, ambEcho=null, musicTheme=null;
  let nextNoteTime=0, nextAmbTime=0, mstep=0, astep=0;
  let musicNodes=[];                  // sources/oscillators to stop when the loop ends
  let musicGraph=[];                  // plain nodes to disconnect when the loop ends
  const gates={};                     // per-source rate-limit windows

  const cl=(v,a,b)=> v<a?a : v>b?b : v;
  // hostile-arg guard: a non-number or NaN reaching an AudioParam throws, and
  // every one of these setters is wired straight to a slider or a game value
  const num=(v,d)=> (typeof v==='number' && isFinite(v)) ? v : d;
  const has=(o,k)=> Object.prototype.hasOwnProperty.call(o,k);
  // deterministic 0..1 from an integer — pattern variation without Math.random at schedule time
  function frand(n){ let x=(n*2654435761)>>>0; x^=x>>>15; x=Math.imul(x,2246822519)>>>0;
    x^=x>>>13; return ((x>>>8)&0xffff)/65536; }

  function init(){
    if(ctx) return;
    try{ ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return; }
    master = ctx.createGain(); master.connect(ctx.destination);
    // safety limiter: everything is summed here, master rides *after* it so the
    // output can never clip no matter how many features complete on one tile
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value=-8; limiter.knee.value=0; limiter.ratio.value=20;
    limiter.attack.value=0.003; limiter.release.value=0.25;
    limiter.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(limiter);
    sfxBus   = ctx.createGain(); sfxBus.connect(limiter);
    musicDuck= ctx.createGain(); musicDuck.connect(musicBus);
    musicLift= ctx.createGain(); musicLift.connect(musicDuck);
    master.gain.value    = muted?0:MASTER_BASE*vol;
    musicBus.gain.value  = musicVol;
    sfxBus.gain.value    = sfxVol;
    musicDuck.gain.value = ducked?DUCK_LEVEL:1;
    musicLift.gain.value = 1+0.45*intensity;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
  }
  function ramp(param,v,tc){ if(!param) return;
    try{ param.setTargetAtTime(v, ctx.currentTime, tc||0.02); }catch(e){ param.value=v; } }
  function applyGain(){ if(master) ramp(master.gain, muted?0:MASTER_BASE*vol, 0.015); }
  function ok(){ if(ctx && ctx.state==='suspended') ctx.resume(); return !!(ctx && !muted); }

  /* Rate limit that scales with count: up to `slots` hits inside a `span`-second
     window, so three folds completing on one tile can overlap but a player
     probing the board for a legal cell never machine-guns the dud. */
  function gate(key,span,slots){
    if(!ctx) return false;
    const now=ctx.currentTime, a=gates[key]||(gates[key]=[]);
    while(a.length && now-a[0]>=span) a.shift();
    if(a.length>=slots) return false;
    a.push(now); return true;
  }

  /* ---- sfx voices (all scheduled on ctx.currentTime, never setTimeout) ---- */
  // canvas x (0..FIELD_W) -> stereo pan; anything else means "centre"
  function panOf(x){ return (typeof x==='number' && isFinite(x)) ? cl(x/FIELD_W*1.4-0.7,-1,1) : null; }
  function sfxOut(node,pan){
    if(pan!=null && ctx.createStereoPanner){
      const p=ctx.createStereoPanner(); p.pan.value=pan; node.connect(p); p.connect(sfxBus);
    } else node.connect(sfxBus);
  }
  // oscillator voice with pitch slide + decay envelope; `at` = seconds from now
  function tone(f0,f1,dur,type,peak,at,pan){
    if(!ok()) return;
    const t=ctx.currentTime+(at||0), o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(f0,t);
    if(f1!==f0) o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(peak,t); g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
    o.connect(g); sfxOut(g,pan); o.start(t); o.stop(t+dur+0.02);
  }
  // filtered noise burst
  function noise(dur,peak,freq,type,at,pan,q){
    if(!ok()) return;
    const t=ctx.currentTime+(at||0), s=ctx.createBufferSource(), g=ctx.createGain(), f=ctx.createBiquadFilter();
    s.buffer=noiseBuf; s.loop=true;
    f.type=type||'lowpass'; f.frequency.value=freq; if(q) f.Q.value=q;
    g.gain.setValueAtTime(peak,t); g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
    s.connect(f); f.connect(g); sfxOut(g,pan); s.start(t); s.stop(t+dur+0.02);
  }
  // noise that swells then falls while its filter sweeps — airy, not percussive
  function bloom(dur,peak,f0,f1,type,at,pan){
    if(!ok()) return;
    const t=ctx.currentTime+(at||0), s=ctx.createBufferSource(), g=ctx.createGain(), f=ctx.createBiquadFilter();
    s.buffer=noiseBuf; s.loop=true;
    f.type=type||'bandpass'; f.Q.value=0.9;
    f.frequency.setValueAtTime(f0,t); f.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(0.0008,t);
    g.gain.exponentialRampToValueAtTime(peak,t+dur*0.3);
    g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
    s.connect(f); f.connect(g); sfxOut(g,pan); s.start(t); s.stop(t+dur+0.03);
  }

  /* Ref-counted looping sfx: many callers share one voice, so start() counts up
     and only the last stop() fades it out. Deliberately un-panned — a shared
     voice cannot honestly claim one position. Nothing in the base game holds a
     sound open, so this is currently unreferenced; it is the engine's fourth
     voice type and the mechanism a wave-3 pack reaches for when it needs a
     sound that outlives a theme change (the AMB beds do not — musicStart tears
     them down and rebuilds them on every theme switch). */
  const loops={};
  function loopStart(key,spec){
    if(!ok()) return;
    const L=loops[key];
    if(L){ L.n++; return; }
    const s=ctx.createBufferSource(), f=ctx.createBiquadFilter(), g=ctx.createGain();
    s.buffer=noiseBuf; s.loop=true;
    f.type=spec.type; f.frequency.value=spec.freq; if(spec.q) f.Q.value=spec.q;
    g.gain.value=0.0001;
    s.connect(f); f.connect(g); g.connect(sfxBus);
    const lo=ctx.createOscillator(), la=ctx.createGain();     // wobble, so it breathes
    lo.type='sine'; lo.frequency.value=spec.lfo; la.gain.value=spec.depth;
    lo.connect(la); la.connect(f.frequency); lo.start();
    s.start();
    loops[key]={ n:1, s, g, extra:[lo], graph:[f,la] };
    ramp(g.gain, spec.peak, 0.06);
  }
  function loopStop(key){
    const L=loops[key]; if(!L) return;
    L.n--; if(L.n>0) return;
    delete loops[key];
    if(!ctx) return;
    const t=ctx.currentTime, stopAt=t+0.20;
    ramp(L.g.gain, 0, 0.05);
    [L.s].concat(L.extra).forEach(n=>{ try{ n.stop(stopAt); }catch(e){} });
    setTimeout(()=>{ [L.s,L.g].concat(L.extra,L.graph)
      .forEach(n=>{ try{ n.disconnect(); }catch(e){} }); }, 320);
  }

  /* ---- music helpers ---- */
  const A4=440;
  function ntof(m){ return A4*Math.pow(2,(m-69)/12); } // MIDI note -> frequency
  // scheduled melodic voice into the music bus (soft click-free envelope)
  function mnote(t,freq,dur,type,peak,attack,release){
    if(!ctx||!voiceBus) return;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t);
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(peak, t+(attack||0.02));
    g.gain.setValueAtTime(peak, t+Math.max(attack||0.02, dur-(release||0.2)));
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g); g.connect(voiceBus); o.start(t); o.stop(t+dur+0.05);
  }
  // scheduled percussive noise tick into the music bus
  function mnoise(t,dur,vol,freq,type){
    if(!ctx||!voiceBus||!noiseBuf) return;
    const s=ctx.createBufferSource(), g=ctx.createGain(), f=ctx.createBiquadFilter();
    s.buffer=noiseBuf; s.loop=true;
    f.type=type||'lowpass'; f.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+0.005);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    s.connect(f); f.connect(g); g.connect(voiceBus); s.start(t); s.stop(t+dur+0.05);
  }
  // sustained drone, tracked so it is stopped when the loop ends (mute is handled at master)
  function drone(freq,type,peak){
    if(!ctx||!voiceBus) return;
    const t=ctx.currentTime, o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(peak,t+2.5);
    o.connect(g); g.connect(voiceBus); o.start(t); musicNodes.push(o); musicGraph.push(g);
  }

  /* Each theme: level = music-bus loudness, beat = seconds/step, len = steps before
     the pattern repeats, play(step,t), optional hi(step,t,v) for the intensity lift.
     Adding a theme is a THEMES entry + an AMB entry + (optionally) a THEME_SETUP
     row — the engine below never learns a theme's name.

     All three are G major with a flat seventh in reach, over a G/D drone: an
     open fifth with no leading tone is what a pipe or a hurdy-gurdy gives you
     for free, and it is the cheapest honest route to "folk" without quoting
     anybody. Nothing here is faster than 0.45s a step; this is a game where a
     turn can be two minutes of thinking, and a bed that hurries is a bed that
     gets switched off. */
  const THEMES = {
    // menu: very quiet, very sparse, welcoming — a slow G-major invitation with
    // room to hear the field behind it. 16 steps x 1.0s = a 16-second loop.
    menu: { level:0.075, beat:1.0, len:16,
      seq:[67,-1,71,-1, 74,-1,-1,72, 71,-1,67,-1, 62,-1,-1,-1],
      play(s,t){ const i=s%this.len, n=this.seq[i]; if(n<0) return;
        mnote(t,ntof(n),1.05,'triangle',0.55,0.25,0.85);
        if(i===0) mnote(t,ntof(n-12),1.7,'sine',0.26,0.50,1.20); } },
    // pasture: the play theme, and the only one anybody hears for an hour. A is
    // the tune, patient and full of rests; B answers it with more motion and
    // the flat seventh (F natural, 77) before walking back down to the tonic.
    // 32 steps x 0.45s = a 14.4-second loop.
    pasture: { level:0.115, beat:0.45, len:32,
      A:[67,-1,69,-1, 71,-1,74,-1, 72,-1,71,-1, 69,-1,-1,-1],
      B:[71,-1,74,76, 77,-1,76,-1, 74,-1,72,71, 67,-1,-1,-1],
      play(s,t){ const i=s%this.len, n=(i<16?this.A:this.B)[i%16]; if(n<0) return;
        mnote(t,ntof(n),0.85,'triangle',0.78,0.05,0.55);
        if(i%8===0) mnote(t,ntof(n-12),1.10,'triangle',0.30,0.08,0.80);
        if(i>=16 && i%8===2) mnote(t,ntof(n+12),0.45,'sine',0.16,0.04,0.35); },
      // the satchel running low. Not a drum kit and not a key change: a low G
      // arriving under the tune every 3.6s, and a soft tick between the arrivals
      // — the pulse of something counting down, at a level you notice only once
      // it is already there.
      hi(s,t,v){ if(s%8===4) mnote(t,ntof(55),0.90,'sine',0.20*v,0.10,0.70);
        if(s%16===12) mnoise(t,0.09,0.10*v,220,'lowpass'); } },
    // reveal: the end walkthrough, played under a scoreboard filling itself in.
    // It only has one job, which is to sound like an ending, so it is a descent
    // to the tonic in sine dyads with attacks slow enough to have no onset and
    // a fifth detuned just enough to breathe. 16 steps x 0.8s = 12.8 seconds.
    reveal: { level:0.095, beat:0.8, len:16,
      seq:[74,-1,72,-1, 71,-1,-1,69, 67,-1,71,-1, 74,-1,67,-1],
      play(s,t){ const i=s%this.len, n=this.seq[i]; if(n<0) return;
        mnote(t,ntof(n),1.40,'sine',0.60,0.35,1.10);
        mnote(t,ntof(n+7)*1.0012,1.40,'sine',0.26,0.45,1.10);   // the breathing fifth
        if(i%8===0) mnote(t,ntof(n-24),2.00,'sine',0.22,0.60,1.60); } },
  };

  /* Per-theme routing, as data. drones:[[midi,type,peak],...] play for the life
     of the loop; echo:{time,fb,wet} inserts a feedback delay across the voice
     bus. musicStart iterates this — it never tests a theme name.
     G2 = 43, D3 = 50, G3 = 55: the drone is the open fifth in all three. */
  const THEME_SETUP = {
    menu:    { drones:[[43,'sine',0.13]], echo:{time:0.50, fb:0.30, wet:0.30} },
    // pasture alone is dry. It is outdoors and it is the theme you live in: an
    // open field has nothing for the sound to come back off, and a delay you
    // hear for an hour is a delay you end up hating.
    pasture: { drones:[[43,'sine',0.22],[50,'sine',0.15]] },
    // long and wet, because the reveal is the one moment the game is allowed to
    // sound like a room rather than a field
    reveal:  { drones:[[43,'sine',0.15],[55,'sine',0.09]], echo:{time:0.60, fb:0.38, wet:0.30} },
  };

  /* ---- ambient beds: a couple of permanent nodes plus sparsely scheduled blips ---- */
  function ambBed(type,freq,level,lfoRate,lfoDepth,q){
    if(!ctx||!ambBus||!noiseBuf) return;
    const s=ctx.createBufferSource(), f=ctx.createBiquadFilter(), g=ctx.createGain();
    s.buffer=noiseBuf; s.loop=true;
    f.type=type; f.frequency.value=freq; if(q) f.Q.value=q;
    g.gain.value=level;
    s.connect(f); f.connect(g); g.connect(ambBus);
    if(lfoRate){ const lo=ctx.createOscillator(), la=ctx.createGain();
      lo.type='sine'; lo.frequency.value=lfoRate; la.gain.value=lfoDepth;
      lo.connect(la); la.connect(f.frequency); lo.start();
      musicNodes.push(lo); musicGraph.push(la); }
    s.start(); musicNodes.push(s); musicGraph.push(f,g);
  }
  function ambDelay(time,fb,wet){
    if(!ctx||!ambBus) return;
    const dl=ctx.createDelay(1.0), f=ctx.createGain(), w=ctx.createGain();
    dl.delayTime.value=time; f.gain.value=fb; w.gain.value=wet;
    dl.connect(f); f.connect(dl); dl.connect(w); w.connect(ambBus);
    ambEcho=dl; musicGraph.push(dl,f,w);
  }
  function ambTone(t,f0,f1,dur,type,peak,echo){
    if(!ctx||!ambBus) return;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(f0,t);
    if(f1!==f0) o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(peak,t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(ambBus); if(echo&&ambEcho) g.connect(ambEcho);
    o.start(t); o.stop(t+dur+0.05);
  }
  /* ambTone's textural counterpart, for beds whose events are grit rather than
     pitch. The filter sweeps f0->f1 so a swish can actually move, and the attack
     scales with duration: a 40ms tick snaps, a 1.4s rumble swells. */
  function ambNoise(t,dur,peak,f0,f1,type,q,echo){
    if(!ctx||!ambBus||!noiseBuf) return;
    const s=ctx.createBufferSource(), g=ctx.createGain(), f=ctx.createBiquadFilter();
    s.buffer=noiseBuf; s.loop=true;
    f.type=type||'bandpass'; if(q) f.Q.value=q;
    f.frequency.setValueAtTime(f0,t);
    if(f1!==f0) f.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(peak, t+Math.min(0.35,dur*0.15));
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    s.connect(f); f.connect(g); g.connect(ambBus); if(echo&&ambEcho) g.connect(ambEcho);
    s.start(t); s.stop(t+dur+0.05);
  }
  /* Every ambient pitch below is deliberately off the equal-tempered grid — the
     field is not a member of the band, and a sheep landing on a scale degree
     immediately sounds like a synthesiser doing an impression of one. (It also
     means test/audio-smoke.js can separate the melody from the bed by asking
     which captured pitches are notes.) Keep new ambient voices off-grid. */
  // distant sheep: reedy, two-part, and always falling away at the end
  function bleat(t,f){ ambTone(t, f, f*1.05, 0.12,'sawtooth',0.019);
    ambTone(t+0.11, f*1.03, f*0.86, 0.28,'sawtooth',0.014); }
  // a bird two fields over
  function pip(t,f){ ambTone(t, f*0.78, f, 0.045,'sine',0.038);
    ambTone(t+0.06, f, f*0.84, 0.055,'sine',0.028); }
  // the bell on a ewe's collar, pushed into the theme's delay where there is one
  function collar(t,f){ ambTone(t, f, f*0.997, 0.42,'sine',0.024,true);
    ambTone(t+0.03, f*1.51, f*1.50, 0.50,'sine',0.012,true); }
  // wind combing dry grass
  function swish(t,dur){ ambNoise(t,dur,0.024,540,1320,'bandpass',0.8); }

  const AMB = {
    // the same field as pasture, heard from the doorway: same breeze, thinner,
    // and events rare enough that somebody reading the menu is not interrupted
    menu:{ bed(){ ambBed('bandpass',700,0.026,0.045,220,0.7); },
      ev(s,t){ const r=frand(s*3+9); if(r<=0.88) return;
        if(r>0.965) bleat(t, 397+((frand(s*7)*70)|0));
        else pip(t, 2303+((frand(s*5)*600)|0)); } },
    // the busiest bed in the game, because a pasture with nothing moving in it
    // just sounds like a bug: breeze underneath, grass on top of that, and
    // sheep and collar bells often enough that the field feels occupied
    pasture:{ bed(){ ambBed('bandpass',680,0.046,0.05,250,0.7); },
      ev(s,t){ const r=frand(s*3+1); if(r<=0.74) return;
        if(r>0.955) bleat(t, 384+((frand(s*11)*90)|0));
        else if(r>0.900) collar(t, 1683+((frand(s*13)*220)|0));
        else if(r>0.840) pip(t, 2273+((frand(s*5)*640)|0));
        else swish(t, 0.6+frand(s*31)*0.9); } },
    // evening: the breeze has dropped, so the bed is lower and duller and its
    // delay lets the collar bells ring out over a board nobody is playing on
    reveal:{ bed(){ ambBed('lowpass',520,0.030,0.04,170); ambDelay(0.58,0.40,0.44); },
      ev(s,t){ const r=frand(s*17+5); if(r<=0.86) return;
        if(r>0.955) collar(t, 1712+((frand(s*23)*180)|0));
        else if(r>0.900) bleat(t, 371+((frand(s*29)*60)|0));
        else pip(t, 2411+((frand(s*19)*380)|0)); } },
  };

  function killMusic(fade){
    if(musicTimer){ clearInterval(musicTimer); musicTimer=null; }
    const g=musicGain, ab=ambBus, nodes=musicNodes, graph=musicGraph, t=ctx?ctx.currentTime:0;
    musicGain=null; voiceBus=null; ambBus=null; ambEcho=null; musicTheme=null;
    mstep=0; astep=0; musicNodes=[]; musicGraph=[];
    if(ctx) [g,ab].forEach(n=>{ if(!n) return;
      try{ n.gain.cancelScheduledValues(t);
        n.gain.setValueAtTime(Math.max(0.0001,n.gain.value),t);
        n.gain.exponentialRampToValueAtTime(0.0001,t+fade);
      }catch(e){} });
    const stopAt = t+fade+0.05;
    nodes.forEach(n=>{ try{ n.stop(stopAt); }catch(e){} });
    setTimeout(()=>{
      try{ g&&g.disconnect(); }catch(e){}
      try{ ab&&ab.disconnect(); }catch(e){}
      nodes.forEach(n=>{ try{ n.disconnect(); }catch(e){} });
      graph.forEach(n=>{ try{ n.disconnect(); }catch(e){} });
    }, fade*1000+140);
  }

  function schedule(){
    if(!ctx || !musicTimer || !musicTheme) return;
    if(ctx.state==='suspended') ctx.resume();
    const spec=THEMES[musicTheme], amb=AMB[musicTheme], now=ctx.currentTime, ahead=now+0.6;
    // a backgrounded tab starves setInterval; resync instead of firing the whole backlog
    if(nextNoteTime<now) nextNoteTime=now+0.02;
    if(nextAmbTime <now) nextAmbTime =now+0.02;
    while(nextNoteTime<ahead){
      if(!muted){ spec.play(mstep,nextNoteTime);
        if(intensity>0.5 && spec.hi) spec.hi(mstep,nextNoteTime,(intensity-0.5)*2); }
      mstep++; nextNoteTime+=spec.beat;
    }
    while(nextAmbTime<ahead){
      if(!muted && amb && amb.ev) amb.ev(astep,nextAmbTime);
      astep++; nextAmbTime+=AMB_BEAT;
    }
  }

  function musicStart(name){
    init(); if(!ctx) return;
    if(!has(THEMES,name)) name=DEFAULT_THEME;    // own keys only: 'toString' is not a theme
    killMusic(0.08);                      // stop any existing loop first (idempotent)
    const spec=THEMES[name], t=ctx.currentTime;
    musicTheme=name; mstep=0; astep=0;
    musicGain=ctx.createGain();
    musicGain.gain.setValueAtTime(0.0001,t);
    musicGain.gain.exponentialRampToValueAtTime(spec.level, t+1.5);   // fade in
    musicGain.connect(musicLift);
    voiceBus=ctx.createGain(); voiceBus.gain.value=1; voiceBus.connect(musicGain);
    ambBus=ctx.createGain();                                          // bypasses the intensity lift
    ambBus.gain.setValueAtTime(0.0001,t);
    ambBus.gain.exponentialRampToValueAtTime(AMB_LEVEL, t+2.5);
    ambBus.connect(musicDuck);
    // per-theme routing + drones, straight off the data table
    const setup = has(THEME_SETUP,name) ? THEME_SETUP[name] : null;
    if(setup && setup.echo){
      const e=setup.echo, dl=ctx.createDelay(1.0), fb=ctx.createGain(), wet=ctx.createGain();
      dl.delayTime.value=e.time; fb.gain.value=e.fb; wet.gain.value=e.wet;
      voiceBus.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(musicGain);
      musicGraph.push(dl,fb,wet);
    }
    if(setup && setup.drones) setup.drones.forEach(d=> drone(ntof(d[0]),d[1],d[2]));
    const amb=AMB[name]; if(amb && amb.bed) amb.bed();
    nextNoteTime=t+0.1; nextAmbTime=t+0.4;
    musicTimer=setInterval(schedule,200);
    schedule();
  }

  function musicStop(){
    if(!ctx){ if(musicTimer){ clearInterval(musicTimer); musicTimer=null; } return; }
    killMusic(0.5);
  }

  function setVolume(v){ vol = cl(num(v,0.85), 0, 1); applyGain(); }
  function setMusicVolume(v){ musicVol = cl(num(v,1), 0, 1);
    if(musicBus) ramp(musicBus.gain, musicVol, 0.03); }
  function setSfxVolume(v){ sfxVol = cl(num(v,1), 0, 1);
    if(sfxBus) ramp(sfxBus.gain, sfxVol, 0.03); }
  function duck(on){ ducked = !!on;
    if(musicDuck) ramp(musicDuck.gain, ducked?DUCK_LEVEL:1, 0.08); }
  function musicIntensity(v){ intensity = cl(num(v,0), 0, 1);
    if(musicLift) ramp(musicLift.gain, 1+0.45*intensity, 0.6); }

  /* Mix reference (pre-limiter peaks) — which tier a sound sits in is a design
     decision, not an accident, so it is written down:

     Loud (>=.30): win .50, and nothing else. A win is the only moment this game
       is allowed to raise its voice; every other sound has to stay under it.
     Mid (.10-.26): foldDone .26 / shrineDone .24 / fail .22 / laneDone .18 /
       place .16 / shepherdOn .14 / scoreSmall .13 / turn .12 /
       shepherdBack .11 / draw .10.
     Quiet (<=.09, lives under the music bed): badPlace .09 / rotate .07 / ui .03.

     The order inside the mid tier is the game's value order rather than a
     mixing accident. A fold is worth more than a lane, so foldDone sits over
     laneDone. Posting a shepherd costs you one of seven and getting him back
     costs nothing, so shepherdOn is louder than shepherdBack. Rotating is a
     rehearsal and placing is a decision, so rotate sits well under place.
     shrineDone is brighter than everything around it and therefore needs less
     level than foldDone to be heard over the bed. badPlace sits at little over
     half of place and has no ring at all: a player hunting for a legal cell
     triggers it dozens of times a game, and a refused input should read as
     "not there", never as a telling-off. scoreSmall is one fixed chime for any N — the
     number is already on screen as a floater, so the sound only has to say
     "points", and a 12-point meadow blaring over a 2-point lane would make the
     common case unpleasant for no information gained.

     Music (THEMES[x].level, the music-bus target the fade-in settles on):
       menu .075 / reveal .095 / pasture .115. pasture is the loudest because it
       is the only bed under a game long enough to need something to lean on;
       menu is the quietest because it plays over somebody reading. */
  return {
    init,
    toggleMute(){ muted=!muted; applyGain(); return muted; },
    get muted(){ return muted; },
    get volume(){ return vol; },
    setVolume, setMusicVolume, setSfxVolume, duck,
    musicStart, musicStop, musicIntensity,

    /* --- the board. Every one of these takes an optional canvas-space x
       (0..960); anything else, including nothing at all, centres it. --- */
    // a tile meeting the table: a short woody knock with a little air on top.
    // The most frequent sound in the game, so it is short and it does not ring.
    place(x){ if(!gate('place',0.05,3)) return; const p=panOf(x);
      noise(.045,.16,900,'bandpass',0,p,1.6); tone(320,180,.09,'triangle',.14,0,p);
      noise(.020,.05,3400,'highpass',0,p); },
    // the same knock with the body taken out — a card turned, not a card played
    rotate(x){ if(!gate('rotate',0.06,3)) return; const p=panOf(x);
      noise(.030,.07,1500,'bandpass',0,p,2.2); tone(620,520,.05,'triangle',.06,0,p); },
    // a tile coming out of the satchel: leather and paper, a sweep rather than
    // a hit, because nothing has been decided yet
    draw(x){ if(!gate('draw',0.10,2)) return; const p=panOf(x);
      bloom(.16,.10,700,2600,'bandpass',0,p); noise(.05,.04,1800,'bandpass',.10,p,1.1); },
    // a tile that will not go there: a dud with no ring and no top end. It is
    // the sound of a knock that failed to land, and it is over immediately.
    badPlace(x){ if(!gate('badPlace',0.12,2)) return; const p=panOf(x);
      tone(150,90,.11,'sine',.09,0,p); noise(.06,.05,320,'lowpass',0,p); },
    // 'hup' — a shepherd sent out to stand somewhere: short, rising, committed
    shepherdOn(x){ if(!gate('shepherdOn',0.06,2)) return; const p=panOf(x);
      tone(340,520,.07,'triangle',.14,0,p); tone(760,980,.06,'sine',.05,.01,p);
      noise(.03,.03,2200,'bandpass',0,p,1.4); },
    // and the same shape falling, for one coming home to the supply
    shepherdBack(x){ if(!gate('shepherdBack',0.06,2)) return; const p=panOf(x);
      tone(520,340,.08,'triangle',.11,0,p); tone(980,700,.06,'sine',.04,.01,p); },
    // the +N floater's chime. One sound for any N — see the mix note above.
    scoreSmall(x){ if(!gate('scoreSmall',0.06,4)) return; const p=panOf(x);
      tone(1318,1318,.07,'sine',.13,0,p); tone(1976,1976,.11,'sine',.07,.05,p); },
    // a fold closed: two notes, up a fifth and settling, with a low root under
    // the answer. The warmest sound in the game and the one it pays you with.
    foldDone(x){ if(!gate('foldDone',0.08,3)) return; const p=panOf(x);
      tone(392,392,.16,'triangle',.26,0,p);
      tone(587,587,.30,'triangle',.22,.13,p);
      tone(196,196,.42,'sine',.12,.13,p);
      noise(.10,.03,4200,'highpass',.13,p); },
    // a lane closed: foldDone's move, higher and lighter and without the bass —
    // the same good news, worth less
    laneDone(x){ if(!gate('laneDone',0.08,3)) return; const p=panOf(x);
      tone(587,587,.11,'triangle',.18,0,p); tone(784,784,.20,'sine',.13,.09,p); },
    // a shrine finished: a small struck bell, fundamental plus two partials it
    // has no business having, which is what makes a bell a bell
    shrineDone(x){ if(!gate('shrineDone',0.10,2)) return; const p=panOf(x);
      tone(1046,1046,.55,'sine',.24,0,p); tone(1568,1568,.42,'sine',.10,.005,p);
      tone(2637,2637,.28,'sine',.05,.005,p); tone(523,523,.70,'sine',.09,.01,p); },
    // the turn hand-off: soft, two notes, and quiet enough to survive being
    // heard several hundred times
    turn(x){ if(!gate('turn',0.10,2)) return; const p=panOf(x);
      tone(784,784,.10,'sine',.12,0,p); tone(1175,1175,.18,'sine',.09,.075,p); },

    /* --- the game, not the board: these are outcomes, so they are centred --- */
    // modest by design: a G-major arpeggio and a warm chord to sit on. Triangles
    // rather than squares — this game does not have a fanfare in it that wants
    // an edge, and .50 is loud enough when nothing else is over .26.
    win(){ [392,494,587,784].forEach((f,i)=> tone(f,f,.26,'triangle',.50,i*.13));
      tone(587,587,.42,'triangle',.24,.39);
      tone(784,784,.60,'triangle',.30,.52); tone(1175,1175,.60,'sine',.14,.52);
      noise(.34,.05,4600,'highpass',.52); },
    // losing a pastoral is not a catastrophe: a falling fifth, soft, done
    fail(){ tone(392,294,.55,'triangle',.22); tone(196,147,.85,'sine',.14,.05);
      noise(.40,.04,420,'lowpass',.05); },
    // very quiet click, for buttons and pickers
    ui(){ if(!gate('ui',0.04,2)) return; tone(1500,1200,.02,'square',.030);
      noise(.015,.012,3000,'highpass'); },

    /* Wave-3 pack sfx (wolfHowl, dogBark, gavel, plankThunk) are further rows
       right here, built from the same four voices (tone / noise / bloom / loop)
       under the same gate discipline, and slotted into the mix tiers above.
       Nothing above this return needs to change to add one. */
  };
})();
