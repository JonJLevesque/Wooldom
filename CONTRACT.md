# Wooldom — module contract

Plain script tags share one global scope; load order in index.html is law:
core → audio → tiles → board → art → game → ai → [pack-*] → render → ui.
One writer per file per wave. Cross-module calls use ONLY the names below;
additions happen by editing this file (the integrator owns it), never ad hoc.
Full design (the rulebook source): /Users/jonjl/.claude/plans/eventual-bubbling-melody-agent-aplan-tiles-458702258a546d6c.md

## Hard rules (all waves)
- Original homage: original names/terminology/tile mix; rules text in our own
  words; ALL art procedural. Never reference the classic game's branding.
- No ES modules, no build, must run from file:// — plain script tags only.
- ALL gameplay randomness through `RNG` (seeded): satchel shuffles, brook draw
  order, AI noise. Math.random is cosmetics only. hash(x,y) for texture.
- Tests: `node test/<suite>.js` — every suite green before a wave closes.
- Headless-safe: no throwing under test/shim.js's noop-canvas Proxy.
- Per-pixel work only at paint/cache time, never in the frame loop.
- Visual work verified by headless-Chrome screenshots
  (freeze frames with `render();render=function(){};` in the driver).

## js/core.js (Wave 0 — FROZEN)
TILE=64, TPS=30, SHEPHERDS=7, ZOOMS=[0.5,1,2], PAL, clamp, hash,
RNG{seed,state,next,range,int,pick,shuffle}, el/show/hide, cellKey(x,y).

## js/audio.js (Wave 1-F) — port Burned Ground Snd verbatim
Bus/limiter engine unchanged; content ONLY as THEMES/AMB/THEME_SETUP rows:
themes menu/pasture/reveal (intensity mapped from satchel depletion by game.js
via the 0.5+0.5t convention — hi() is silent at exactly 0.5). SFX rows (no-op
safe, optional pan-x 0..960): place, rotate, draw, badPlace, shepherdOn,
shepherdBack, scoreSmall, foldDone, laneDone, shrineDone, turn, win, fail, ui.
Pack rows (wave 3): wolfHowl, dogBark, gavel, plankThunk.

## js/tiles.js (Wave 1-A)
TILES (72-tile base) + BROOK_TILES (12) exactly per design §2:
{ id, name, edges:['M'|'L'|'F'|'B' ×4 N,E,S,W], count, ram?:1,
  segs:[{ t:'m'|'l'|'f'|'s'|'b', e:[slotIds], spot:[x,y 0..63], touches?:[segIdx] }] }
Slot encoding (FROZEN): side*3+i, i clockwise around the perimeter
(N w→e, E n→s, S e→w, W s→n). Abut: side s slot i ↔ side (s+2)%4 slot 2-i.
Rotate cw: slot→(slot+3)%12, edges rotate right. Slot ownership: F side → all
3 slots to the fold seg; M side → all 3 to one meadow seg; L/B side → center
slot to lane/brook, flanks to flanking meadow segs. Shrines own no slots.
Helpers: tileById(id), edgeCode(tileId,rot)→[4 chars], slotOwner(tile,slot)→segIdx.
Counts asserted by test/tiledata.js: base 72, brook 12, rams 10.

## js/board.js (Wave 1-B)
board Map(cellKey→{tileId,rot,seat,n}); union-find feature graph per design §3:
placeTile(x,y,tileId,rot)→{completed:[rootMeta]}, canPlace(tileId,rot,x,y),
legalCells(tileId)→[{x,y,rots:[..]}], postShepherd(x,y,segIdx,seat)→bool,
canPost(x,y,segIdx)→bool, featureAt(x,y,segIdx)→rootMeta,
scoreFeature(root, final)→[{seat,pts,why}] (routes through Hooks.scoreMod),
finalScore()→[{kind,cells,holders,pts,detail}] (ordered walkthrough data),
resetBoard(), stateHash() [FNV-1a: sorted board + posts + scores + supplies +
satchel length + RNG.state; seat.ai.* excluded].
rootMeta: {type:'lane'|'fold'|'shrine'|'meadow', cells:Set, opens, rams,
shepherds:[{seat,x,y,seg}], adjFolds:Set(fold roots)}. opens: +1 per touched
side per segment, −2 per side-join; complete ⇔ opens===0 (meadows skip).
Shrines: {x,y,seat?} list; complete = 8 neighbors occupied.

## js/art.js (Wave 1-D)
paintTile(tileId,rot)→64×64 canvas, cached Map('id_rot'); paints purely from
segment data (design §5): meadow dither+flowers, 3px rutted lanes via center,
fold interiors (region test at paint time) with pen texture + tiny sheep +
wall + gate where a lane meets it, 5px brook + banks, shrine building.
SPRITES table: 8×8 emblems (ram + pack icons — packs push rows),
shepherd 10×14 / herder seated (seat-colored via recolor), drawShepherd(ctx,
seatColor, kind, x,y, scale). drawLogo(canvas).

## js/game.js (Wave 1-C)
G {mode:'menu'|'brook'|'play'|'reveal'|'end', seats:[{name,color,human,
personality,difficulty,score,supply,ai:{}}], turnIdx, satchel:[tileIds],
dead:[], drawn:tileId|null, phase state, config {seats,modules,seed,...},
view {cx,cy,zoom}, tick, calm, ...}.
startGame(config) [seeded shuffle; brook phase if module on, per design §1.6:
spring auto-place, fork forced into first four draws, lakes held back, no-U-turn],
draw(), place(x,y,rot) [THE real input path], spot(segIdx)/skip(),
turn flow + completion scoring + supply return, endGame()→reveal walkthrough,
Hooks registry {satchel,canPlace,onPlaced,spots,scoreMod,onComplete,turnStart,
turnEnd,final,menu} (arrays; packs push rows; engine iterates — ships NOW),
saves: replay-log {v,seed,config,log} at wooldom.save, prefs wooldom.prefs,
autosave per turn, resume; frame(ts) animation clock (TPS accumulator, G.tick).
Defines window.WoolDbg CORE: {seed, state, board:()=>board, scores, seats,
satchel:()=>satchel.length, draw, place, spot, skip, legal, featureAt,
runToEnd, startGame, stateHash, TILES:()=>TILES} — ai.js adds aiMove; ui.js
AUGMENTS with ui hooks (never moves/replaces).

## js/ai.js (Wave 1-G baseline; Wave 2 full)
Per design §6: enumerate legal (cell,rot,spot|null); eval with named weight
consts; NO board mutation during search (hypothetical merges read roots only).
P(complete) from a maintained satchel edge histogram. Personalities Old Wick/
Bram/Maud/Pip as weight vectors; difficulty = Box-Muller RNG noise σ
{2.5,1.0,0.25} (Lamb/Ewe/Ram). aiMove(seatIdx) acts through game.js's real
input path. seat.ai.* excluded from stateHash. Budget <50ms/turn (asserted).
AI.hooks rows for pack eval terms (wave 3).

## js/render.js (Wave 1-D)
render(): board blits from art cache under view {cx,cy,zoom in ZOOMS}; ghost
tile (translucent; red tint on illegal), legal-cell pulse, shepherd sprites at
transformed spots, numbered post-discs overlay, +N pixel-font floaters,
completed-feature outline flash, turn banner, reveal-walkthrough highlighting,
calm-mode caps. 3×5 pixel FONT + drawPixelText ported from the siblings.
Reads G/board read-only. Never throws headless.

## js/ui.js (Wave 1-E)
Owns index.html DOM + css/style.css. Menu (seats 2–5: human seat + 1–4 AI
personality/difficulty pickers, module toggles [Brook ON default], seed field,
resume), pointer: drag-pan (threshold), wheel/pinch zoom snap, ghost follows
pointer, click places, R/right-click/tray-tap rotate (auto-advance to a legal
rotation), post-disc clicks, keys (arrows pan, Shift fast, Tab/Shift-Tab cycle
legal cells w/ camera follow, Enter place, 1–9 post, 0/Space skip, Esc, M, F
skip-AI-animation, ? help), seat chips/satchel/move-log chrome, settings
popover (calm/sfx/music/reset — port Burned Ground patterns: onAct,
focusedControl, applyCalm, fitCanvas, fullscreen), end summary screen, boot.
AUGMENTS WoolDbg with ui hooks needed by tests.

## test/ (suites by wave)
shim.js+boot.js (Wave 0, done). Wave 1: tiledata (A), rules+placement+meadows
(B), brook+saveload (C), audio-smoke (F), uiflow (E). Wave 2: ai-match (G).
Wave 3: packs-<name> each. meadows.js MUST use an independent flood-fill
scorer written from the rules text, importing nothing from board.js.
