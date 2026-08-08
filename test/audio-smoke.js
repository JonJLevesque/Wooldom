'use strict';
/* Wave 1-F: js/audio.js.

   Phase 1 (mandated): with NO AudioContext, every public Snd method takes
   plausible AND hostile arguments without throwing, and the CONTRACT.md surface
   is all there. The method list and the theme list are parsed out of
   CONTRACT.md rather than copied here, so the contract is what is being tested
   and not a stale transcription of it.
   Phase 2: the same API against a fake AudioContext, which is the only way to
   see that the engine actually builds a graph — that panOf spans the canvas
   width index.html declares, that THEME_SETUP (not a name switch) drives
   per-theme routing, and that no non-finite value and no non-positive
   exponential-ramp target ever reaches an AudioParam (both throw in real Web
   Audio).
   Phase 3: the theme table. Each theme is exercised against the fake ctx by
   capturing the pitches and onset times it schedules, which is enough to prove
   four things the tables alone cannot: that a name resolves to its own
   composition rather than silently falling back to pasture, that the pattern is
   bit-identical across two runs from the same clock (no Math.random at schedule
   time), that the audible loop is as long as the design asks for, and that hi()
   is silent at exactly 0.5 intensity and adds voices above it.
   Phase 4: the mix. The peaks documented in audio.js's mix-reference block are
   parsed out of the source and checked against what each sfx actually asks an
   AudioParam for, so the comment block is an enforced table rather than a
   promise. */
const fs = require('fs');
const path = require('path');
const { load } = require('./shim');
const ROOT = path.join(__dirname, '..');

const results = [];
const check = (label, ok, note) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (note && !ok ? '\n  → ' + note : ''));
  results.push(!!ok);
};
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;

let Snd = null, loadErr = null;
try { Snd = load().probe('Snd'); } catch (e) { loadErr = e; }
check('shim loads with audio.js present', !loadErr, loadErr && loadErr.stack);
if (loadErr) { console.log('AUDIO SMOKE FAILED'); process.exit(1); }

/* ---------------- the contract, read from the contract ---------------- */
const contract = fs.readFileSync(path.join(ROOT, 'CONTRACT.md'), 'utf8');
const audioSrc = fs.readFileSync(path.join(ROOT, 'js', 'audio.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// "themes menu/pasture/reveal (intensity mapped ...)"
const themeM = contract.match(/themes\s+([a-z]+(?:\/[a-z]+)+)/i);
// "SFX rows (no-op safe, optional pan-x 0..960): place, rotate, ... , ui."
const sfxM = contract.match(/SFX rows[^:]*:\s*([^.]+)\./i);
// the pan domain is the canvas's logical width, not a number this file invents
const cvM = html.match(/<canvas[^>]*id="cv"[^>]*width="(\d+)"/);
check('CONTRACT.md still declares the theme list', !!themeM, 'no "themes a/b/c" line found');
check('CONTRACT.md still declares the sfx rows', !!sfxM, 'no "SFX rows ...:" line found');
check('index.html still declares the board canvas width', !!cvM, 'no <canvas id="cv" width=...> found');
if (!themeM || !sfxM || !cvM) { console.log('AUDIO SMOKE FAILED'); process.exit(1); }

const ALL_THEMES = themeM[1].split('/');
const SFX = sfxM[1].split(/[,\s]+/).filter(Boolean);
const W = +cvM[1];
// the engine surface every screen and settings popover drives
const ENGINE = ['init', 'toggleMute', 'setVolume', 'setMusicVolume', 'setSfxVolume',
  'duck', 'musicStart', 'musicStop', 'musicIntensity'];
const METHODS = ENGINE.concat(SFX);
// Burned Ground's artillery surface: the port keeps its engine, not its game
const STRAY = ['fire', 'boom', 'bigBoom', 'nukeBoom', 'tankDeath', 'clang', 'thud',
  'shieldHit', 'shieldBreak', 'splitPop', 'rumbleStart', 'rumbleStop', 'digLoopStart',
  'digLoopStop', 'crackle', 'patter', 'aimTick', 'buy', 'chime', 'windBed'];

console.log('      contract: themes [' + ALL_THEMES.join(', ') + '] · ' + SFX.length +
  ' sfx rows · pan domain 0..' + W);
const missing = METHODS.filter(m => typeof Snd[m] !== 'function');
check('all ' + METHODS.length + ' contract methods exist', !missing.length, 'missing: ' + missing);
const stray = STRAY.filter(m => m in Snd);
check('no Burned Ground game sfx survived the port', !stray.length, 'still present: ' + stray);
check('muted / volume getters read back',
  typeof Snd.muted === 'boolean' && typeof Snd.volume === 'number');

/* ---------------- phase 1: hostile args, no AudioContext ---------------- */
// junk a caller could realistically produce: an unset field, a bad parse, a
// value from the wrong end of the board, a slider that ran off its rail.
const HOSTILE = [
  [], [undefined], [null], [NaN], [Infinity], [-Infinity], [-1], [-0.0001],
  [1e9], [0], [1], ['loud'], [{}], [[]], [true], [W + 500], [W / 2], [W], [0.5],
];
const THEME_ARGS = [
  [], [undefined], [null], ['menu'], ['pasture'], ['nope'], ['toString'],
  ['constructor'], ['__proto__'], [42], [{}], [''],
];

let thrown = null;
try {
  Snd.init(); Snd.init();                       // idempotent, and there is no ctx to build
  for (const m of METHODS) {
    if (m === 'musicStart') continue;           // themes get their own arg list
    for (const args of HOSTILE) Snd[m].apply(Snd, args);
  }
  for (const args of THEME_ARGS) Snd.musicStart.apply(Snd, args);
  for (const name of ALL_THEMES) { Snd.musicStart(name); Snd.musicStop(); }
  Snd.musicStop();
  const m1 = Snd.toggleMute(), m2 = Snd.toggleMute();
  if (m1 === m2) throw new Error('toggleMute did not toggle');
  if (Snd.muted) Snd.toggleMute();              // the sweep above toggled an odd count
} catch (e) { thrown = e; }
check('no method throws without an AudioContext', !thrown, thrown && thrown.stack);

// setters must survive junk and still leave readable, in-range state
Snd.setVolume(NaN);
check('setVolume(NaN) leaves a finite volume', typeof Snd.volume === 'number' && isFinite(Snd.volume));
Snd.setVolume(-5); check('setVolume(-5) clamps to 0', Snd.volume === 0);
Snd.setVolume(99); check('setVolume(99) clamps to 1', Snd.volume === 1);
Snd.setVolume(0.6); check('setVolume(0.6) round-trips', near(Snd.volume, 0.6));
check('muted is false after the phase-1 round trip', Snd.muted === false);

/* ---------------- phase 2: fake AudioContext ---------------- */
const bad = [];                                  // illegal values seen by any AudioParam
const log = { pan: [], made: {} };               // what the engine asked for
let vtime = 0;                                   // virtual ctx.currentTime
const advance = dt => { vtime += dt; };
const tally = k => { log.made[k] = (log.made[k] || 0) + 1; };
const madeVoices = () => (log.made.osc || 0) + (log.made.bufsrc || 0);
const finite = (label, v) => {
  if (typeof v !== 'number' || !isFinite(v)) bad.push(label + ' got ' + String(v));
};

// Two capture channels, both opt-in so nothing collects while the suite is idle:
//   cap  — oscillator pitches with their onset times, for the theme phase
//   gcap — every gain level asked for, for the mix phase
let cap = null, gcap = null;
function mkParam(name, isPitch) {
  let v = 0;
  const gain = name === 'gain';
  return {
    get value() { return v; },
    set value(x) { finite(name + '.value', x); if (name === 'pan') log.pan.push(x); v = x; },
    setValueAtTime(x, t) {
      finite(name + '.setValueAtTime', x); finite(name + '@time', t);
      if (isPitch && cap) cap.push({ f: x, t: t });
      if (gain && gcap) gcap.push(x);
      return this;
    },
    linearRampToValueAtTime(x, t) { finite(name + '.linearRamp', x); finite(name + '@time', t); return this; },
    exponentialRampToValueAtTime(x, t) {
      finite(name + '.expRamp', x); finite(name + '@time', t);
      if (!(x > 0)) bad.push('exponentialRampToValueAtTime(' + x + ') on ' + name + ' — real Web Audio throws');
      if (gain && gcap) gcap.push(x);
      return this;
    },
    setTargetAtTime(x, t, tc) {
      finite(name + '.setTarget', x); finite(name + '@time', t); finite(name + '.timeConstant', tc);
      if (!(tc > 0)) bad.push('setTargetAtTime timeConstant ' + tc + ' on ' + name);
      return this;
    },
    cancelScheduledValues(t) { finite(name + '@cancel', t); return this; },
  };
}
const wire = o => Object.assign(o, { connect() { }, disconnect() { } });
const playable = o => Object.assign(o, {
  start(t) { if (t !== undefined) finite('start@time', t); },
  stop(t) { if (t !== undefined) finite('stop@time', t); },
});

function FakeCtx() { this.destination = wire({}); }
FakeCtx.prototype = {
  get currentTime() { return vtime; },           // an accessor, so the suite owns the clock
  sampleRate: 8000,
  state: 'running',
  resume() { },
  createGain() { tally('gain'); return wire({ gain: mkParam('gain') }); },
  createBiquadFilter() {
    tally('filter');
    return wire({ type: '', frequency: mkParam('frequency'), Q: mkParam('Q'), gain: mkParam('biquadGain') });
  },
  createOscillator() {
    tally('osc');
    return playable(wire({ type: '', frequency: mkParam('frequency', true), detune: mkParam('detune') }));
  },
  createBufferSource() {
    tally('bufsrc');
    return playable(wire({ buffer: null, loop: false, playbackRate: mkParam('playbackRate') }));
  },
  createStereoPanner() { tally('panner'); return wire({ pan: mkParam('pan') }); },
  createDelay() { tally('delay'); return wire({ delayTime: mkParam('delayTime') }); },
  createDynamicsCompressor() {
    tally('comp');
    return wire({
      threshold: mkParam('threshold'), knee: mkParam('knee'), ratio: mkParam('ratio'),
      attack: mkParam('attack'), release: mkParam('release'),
    });
  },
  createBuffer(ch, len) { tally('buffer'); const d = new Float32Array(len); return { getChannelData: () => d }; },
};

global.AudioContext = FakeCtx;
// capture the scheduler so virtual time, not wall-clock, drives the music
const realSetInterval = global.setInterval, realClearInterval = global.clearInterval;
let tickFn = null;
global.setInterval = fn => { tickFn = fn; return 1; };
global.clearInterval = () => { tickFn = null; };
function runMusic(seconds) {
  for (let i = 0, n = Math.round(seconds / 0.2); i < n; i++) { advance(0.2); if (tickFn) tickFn(); }
}

let p2err = null;
try { Snd.init(); } catch (e) { p2err = e; }
check('init() builds the bus chain against a real-shaped ctx', !p2err, p2err && p2err.stack);
// master, musicBus, sfxBus, musicDuck, musicLift — and exactly one limiter
check('the limiter and the five-gain bus chain exist',
  (log.made.comp || 0) === 1 && (log.made.gain || 0) >= 5,
  'comp=' + log.made.comp + ' gains=' + log.made.gain);

/* --- panOf spans the canvas, not a number audio.js made up --- */
log.pan.length = 0;
Snd.place(0); advance(1); Snd.place(W); advance(1); Snd.place(W / 2); advance(1);
const pans = log.pan.slice();
check('pan spans the whole canvas: x=0 → -0.7', near(pans[0], -0.7), 'pans=' + pans);
check('pan spans the whole canvas: x=' + W + ' → +0.7 (a 640-wide panOf would clip to +1)',
  pans.some(p => near(p, 0.7)), 'pans=' + pans);
check('pan spans the whole canvas: x=' + W / 2 + ' → centre 0', pans.some(p => near(p, 0)), 'pans=' + pans);
log.pan.length = 0;
Snd.place(-9999); advance(1); Snd.place(1e9); advance(1);
check('off-canvas pan-x clamps into [-1,1]',
  log.pan.length > 0 && log.pan.every(p => p >= -1 && p <= 1), 'pans=' + log.pan);

/* --- THEME_SETUP drives routing --- */
let d0 = log.made.delay || 0, v0 = madeVoices();
Snd.musicStart('pasture');
const pastureDelays = (log.made.delay || 0) - d0;
runMusic(34);                                   // two full loops plus change
check('pasture schedules music across two full loops', madeVoices() - v0 > 20,
  'voices=' + (madeVoices() - v0));
check('pasture declares no echo, so none is built', pastureDelays === 0, 'delays=' + pastureDelays);

d0 = log.made.delay || 0;
Snd.musicStart('menu');
const menuDelays = (log.made.delay || 0) - d0;
runMusic(20);
check('menu declares an echo, so THEME_SETUP builds one', menuDelays >= 1, 'delays=' + menuDelays);

let themeErr = null;
try { for (const args of THEME_ARGS) { Snd.musicStart.apply(Snd, args); runMusic(2); } }
catch (e) { themeErr = e; }
check('unknown / prototype-key theme names fall back instead of throwing', !themeErr, themeErr && themeErr.stack);
Snd.musicStop();

/* ---------------- phase 3: the theme table ---------------- */
/* Every run rewinds the virtual clock to where it started, so two runs of one
   theme are identical by construction and any difference in the captured pitch
   stream is nondeterminism in the composition itself. */
function runTheme(name, seconds, inten) {
  const t0 = vtime, dd = log.made.delay || 0, s0 = madeVoices();
  cap = [];
  Snd.musicIntensity(inten || 0);      // before musicStart: it schedules synchronously
  Snd.musicStart(name);
  const setup = madeVoices() - s0;     // drones + ambient bed + the opening bar
  runMusic(seconds);
  const out = {
    events: cap, pitches: cap.map(e => e.f), setup,
    voices: madeVoices() - s0, delays: (log.made.delay || 0) - dd,
  };
  cap = null;
  Snd.musicStop(); Snd.musicIntensity(0);
  vtime = t0;
  return out;
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* The melody and the bed are told apart by tuning: every mnote pitch is an
   equal-tempered note, and audio.js deliberately keeps every ambient voice off
   that grid (see the comment above bleat/pip/collar). That is what makes the
   loop measurable — the bed is aperiodic by design and would otherwise mask
   the repeat. */
const isNote = f => {
  if (!(f > 0)) return false;
  const m = Math.round(69 + 12 * Math.log2(f / 440));
  return Math.abs(f - 440 * Math.pow(2, (m - 69) / 12)) < 1e-6;
};
/* The audible loop: the smallest shift under which the whole captured stream
   maps onto itself. Derived from what was scheduled, not from THEMES[x].len ×
   beat, so it measures the composition rather than trusting its arithmetic. */
function loopPeriod(events) {
  if (events.length < 6) return null;
  const t0 = events[0].t, e = events.map(x => ({ f: x.f, t: x.t - t0 }));
  const T = e[e.length - 1].t, EPS = 1e-3;
  const cands = [...new Set(e.map(x => x.t))].filter(p => p > 0.05 && p <= T / 2).sort((a, b) => a - b);
  for (const P of cands) {
    const lim = T - P + EPS;
    let ok = true;
    for (const a of e) {
      if (a.t > lim) continue;
      if (!e.some(b => b.f === a.f && Math.abs(b.t - (a.t + P)) < EPS)) { ok = false; break; }
    }
    if (!ok) continue;
    const n1 = e.filter(x => x.t < P - EPS).length;
    const n2 = e.filter(x => x.t >= P - EPS && x.t < 2 * P - EPS).length;
    if (n1 === n2) return P;
  }
  return null;
}

const RUN = 44;                        // seconds — over two loops of the longest theme
const silentTheme = [], nondet = [], thin = [], noSetup = [], loops = {}, streams = {};
for (const name of ALL_THEMES) {
  const a = runTheme(name, RUN);
  streams[name] = a;
  if (!a.voices) silentTheme.push(name);
  if (!a.setup) noSetup.push(name);
  if (new Set(a.pitches).size < 4) thin.push(name + '(' + new Set(a.pitches).size + ')');
  if (!same(a.pitches, runTheme(name, RUN).pitches)) nondet.push(name);
  a.mel = a.events.filter(e => isNote(e.f));       // the tune, without the bed
  loops[name] = loopPeriod(a.mel);
}
check('all ' + ALL_THEMES.length + ' contract themes schedule music', !silentTheme.length, 'silent: ' + silentTheme);
check('every theme builds its drones / ambient bed on start', !noSetup.length, 'built nothing: ' + noSetup);
check('every theme is a real composition, not one repeated pitch', !thin.length, 'too few pitches: ' + thin);
check('every theme is deterministic across two runs of the same clock (no Math.random at schedule time)',
  !nondet.length, 'varied between runs: ' + nondet);
/* A name with no THEMES row resolves to DEFAULT_THEME and then schedules that
   theme's tune note for note, which is the only way to see a fallback from
   outside: exactly one contract theme may match it (the default itself), and no
   two themes may match each other. Both comparisons are on the melodic layer
   only — a theme that borrowed another's tune and changed nothing but its
   ambient bed would still be a copy. */
const fallback = runTheme('nope-not-a-theme', RUN);
const tune = s => (s.mel || s.events.filter(e => isNote(e.f))).map(e => e.f).join(',');
const isDefault = ALL_THEMES.filter(n => tune(streams[n]) === tune(fallback));
check('an unknown theme name falls back onto one of the contract themes',
  isDefault.length === 1, 'matched ' + isDefault.length + ' themes: ' + isDefault);
check('every theme name resolves to its own tune, not a copy of another',
  new Set(ALL_THEMES.map(n => tune(streams[n]))).size === ALL_THEMES.length,
  'two themes schedule an identical melody');

const fmt = p => (p === null ? 'not found' : p.toFixed(2) + 's');
console.log('      measured loops: ' +
  ALL_THEMES.map(n => n + ' ' + fmt(loops[n])).join(' · '));
// design §9: the play theme is a >=14s loop, the reveal theme >=10s
const MIN_LOOP = { pasture: 14, reveal: 10, menu: 12 };
const unmeasured = ALL_THEMES.filter(n => loops[n] === null);
check('every theme has a measurable loop', !unmeasured.length,
  'no repeat found inside ' + (RUN / 2) + 's for: ' + unmeasured + ' — either the loop is ' +
  'longer than half the run (raise RUN) or an ambient voice has landed on the ' +
  'equal-tempered grid and is being counted as melody (keep AMB pitches off-grid)');
const shortLoop = ALL_THEMES.filter(n => MIN_LOOP[n] && loops[n] !== null && loops[n] < MIN_LOOP[n] - 1e-6);
check('every theme loops no faster than the design allows', !shortLoop.length,
  shortLoop.map(n => n + ' = ' + fmt(loops[n]) + ', wants >=' + MIN_LOOP[n] + 's').join(' | '));
// and the separation the measurement rests on: the bed does not share the loop
const bedded = ALL_THEMES.filter(n => {
  const all = loopPeriod(streams[n].events);
  return all !== null && loops[n] !== null && Math.abs(all - loops[n]) < 1e-3;
});
check('the ambient bed is aperiodic, so the melody is what was measured', !bedded.length,
  'whole stream repeats on the melodic loop: ' + bedded);

// THEME_SETUP routing, read back from what the engine actually built
const echoThemes = ALL_THEMES.filter(n => n !== 'pasture');
const noEcho = echoThemes.filter(n => streams[n].delays < 1);
check('pasture stays dry', streams.pasture.delays === 0, 'delays=' + streams.pasture.delays);
check('every echoed theme gets its delay built from THEME_SETUP', !noEcho.length, 'no delay built: ' + noEcho);

/* --- the intensity convention: silent at exactly 0.5, lifting above it --- */
const half = runTheme('pasture', RUN, 0.5), full = runTheme('pasture', RUN, 1);
check('musicIntensity(0.5) is exactly the plain theme — hi() does not open on the boundary',
  half.voices === streams.pasture.voices && same(half.pitches, streams.pasture.pitches),
  'plain=' + streams.pasture.voices + ' at-0.5=' + half.voices);
check('musicIntensity(1) opens pasture\'s hi() layer',
  full.voices > streams.pasture.voices,
  'plain=' + streams.pasture.voices + ' hot=' + full.voices);
const shrank = ALL_THEMES.filter(n => runTheme(n, RUN, 1).voices < streams[n].voices);
check('intensity never takes voices away from a theme', !shrank.length, 'lost voices: ' + shrank);

let switchErr = null;
try {
  for (const name of ALL_THEMES) { Snd.musicStart(name); runMusic(1.2); }   // screen to screen
  for (const name of ALL_THEMES) { Snd.musicStart(name); Snd.musicStop(); } // start/stop churn
  Snd.musicStop(); Snd.musicStop();
} catch (e) { switchErr = e; }
check('switching between all ' + ALL_THEMES.length + ' themes back-to-back never throws',
  !switchErr, switchErr && switchErr.stack);
check('musicStop leaves no scheduler running', tickFn === null);
check('the whole theme table runs without an illegal AudioParam value',
  !bad.length, bad.slice(0, 3).join(' | '));

/* ---------------- phase 4: the mix table, against the mix ---------------- */
/* audio.js writes its peaks down in a comment block. Parse them out and hold
   the code to them, so the tiers are a checked table instead of a claim. */
const mixBlock = (audioSrc.match(/Mix reference[\s\S]*?Music \(THEMES/) || [''])[0];
const documented = {};
for (const m of mixBlock.matchAll(/\b([a-zA-Z][a-zA-Z]+)\s+\.(\d+)\b/g)) documented[m[1]] = parseFloat('0.' + m[2]);
check('audio.js documents a peak for every sfx row',
  SFX.every(n => n in documented),
  'undocumented: ' + SFX.filter(n => !(n in documented)));

function peakOf(name) {
  gcap = [];
  Snd[name](W / 2); advance(1.5);
  const m = gcap.reduce((a, b) => (b > a ? b : a), 0);
  gcap = null;
  return m;
}
const measured = {}, offTable = [];
for (const name of SFX) {
  measured[name] = peakOf(name);
  if (name in documented && !near(measured[name], documented[name]))
    offTable.push(name + ' plays ' + measured[name] + ', documented ' + documented[name]);
}
check('every sfx plays at the peak the mix block documents', !offTable.length, offTable.join(' | '));
check('no sfx is silently dead', SFX.every(n => measured[n] > 0),
  'produced nothing: ' + SFX.filter(n => !(measured[n] > 0)));

const loudest = SFX.reduce((a, b) => (measured[b] > measured[a] ? b : a));
const quietest = SFX.reduce((a, b) => (measured[b] < measured[a] ? b : a));
check('win is the loudest thing in the game', loudest === 'win', 'loudest is ' + loudest);
check('ui is the quietest thing in the game', quietest === 'ui', 'quietest is ' + quietest);
// the tier order is the game's value order — see the mix block's rationale
const ordered = [['foldDone', 'laneDone'], ['shepherdOn', 'shepherdBack'],
  ['place', 'rotate'], ['place', 'badPlace'], ['foldDone', 'turn']];
const inverted = ordered.filter(p => !(measured[p[0]] > measured[p[1]]));
check('the mid tier is ordered by what the sound is worth', !inverted.length,
  inverted.map(p => p[0] + ' (' + measured[p[0]] + ') should sit over ' + p[1] + ' (' + measured[p[1]] + ')').join(' | '));

/* --- every sfx, live, across the canvas and off the end of it --- */
let sfxErr = null;
try {
  for (const m of SFX)
    for (const x of [0, W / 4, W / 2, W, undefined, NaN, -50, 1e9]) { Snd[m](x); advance(0.75); }
} catch (e) { sfxErr = e; }
check('every sfx plays with a live ctx and hostile pan-x', !sfxErr, sfxErr && sfxErr.stack);

/* --- mute really gates sfx --- */
Snd.toggleMute();
const n0 = madeVoices();
advance(5); Snd.place(100); Snd.win(); Snd.foldDone(200);
check('muted sfx create no voices', madeVoices() === n0);
Snd.toggleMute();

/* --- the invariant that matters: nothing illegal ever reached a param --- */
check('no non-finite value and no non-positive exponential ramp reached an AudioParam',
  !bad.length, bad.slice(0, 5).join(' | ') + (bad.length > 5 ? ' (+' + (bad.length - 5) + ' more)' : ''));

global.setInterval = realSetInterval; global.clearInterval = realClearInterval;
const okAll = results.every(Boolean);
console.log(okAll ? 'AUDIO SMOKE OK' : 'AUDIO SMOKE FAILED');
process.exit(okAll ? 0 : 1);
