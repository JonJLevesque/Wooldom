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
  order. AI difficulty noise is NOT RNG-routed — it is stateless, hash-derived
  from (G.seed, G.moveNo, seat, candidate) so resume ≡ straight-through (see
  the ai.js as-built block). Math.random is cosmetics only. hash(x,y) texture.
- Tests: `node test/<suite>.js` — every suite green before a wave closes.
- Headless-safe: no throwing under test/shim.js's noop-canvas Proxy.
- Per-pixel work only at paint/cache time, never in the frame loop.
- Visual work verified by headless-Chrome screenshots
  (freeze frames with `render();render=function(){};` in the driver).
- FLAG, DON'T PATCH — integrator included: while a file has an active owner,
  ALL fixes route through that owner (a silent concurrent edit can be
  clobbered by the owner's next write with no conflict marker, and a
  well-meant fix can introduce its mirror bug — both happened this wave).

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
As-built (Wave 1-F): pan-x is CANVAS-SPACE 0..960 (where the event appears on
screen), NOT a board cell — run cells through the view transform or omit for
center. win/fail/ui are always centered. Loud tier is win .50 alone; mid tier
ordering is the game's value order (foldDone .26 > shrineDone > laneDone >
place > shepherdOn ...); badPlace is deliberately mild (.09, heard dozens of
times per game). loopStart/loopStop retained (unreferenced until a wave-3
pack needs a held sound — AMB beds die on theme change, loops don't).
game.js calls musicIntensity(0.5 + 0.5·satchelConsumedFraction) — hi() is
silent at exactly 0.5. ⚠ audio-smoke parses CONTRACT.md's theme/sfx lines and
index.html's literal width="960" attribute — keep both intact.

## js/tiles.js (Wave 1-A)
TILES (72-tile base) + BROOK_TILES (12) exactly per design §2:
{ id, name, edges:['M'|'L'|'F'|'B' ×4 N,E,S,W], count, ram?:1,
  segs:[{ t:'m'|'l'|'f'|'s'|'b', e:[slotIds], spot:[x,y 0..63], touches?:[segIdx] }] }
Slot encoding (FROZEN): side*3+i, i clockwise around the perimeter
(N w→e, E n→s, S e→w, W s→n). Abut: side s slot i ↔ side (s+2)%4 slot 2-i.
Rotate cw: slot→(slot+3)%12, edges rotate right. Slot ownership: F side → all
3 slots to the fold seg; M side → all 3 to one meadow seg; L/B side → center
slot to lane/brook, flanks to flanking meadow segs. Shrines own no slots.
Helpers: tileById(id), edgeCode(tileId,rot)→4-CHAR STRING (one === per side
match), slotOwner(tile,slot)→segIdx, rotSlot(slot,rot), OPENING_TILE='FOLD1_LS'.
Counts asserted by test/tiledata.js: base 72, brook 12, rams 10.
As-built (Wave 1-A): there is NO plain FOLD4 — the only High Fold is FOLD4_R
(satchel builders beware). Rams are authored on BOTH the fold segment
(seg.ram — authoritative for scoring) and the tile (tile.ram — art/satchel);
lint asserts agreement. Brook split is 1 spring / 9 middles / 2 lakes (the
§1.6 prose said 8 — the shipped ROSTER governs); open-end parity provably
closes at 0 exactly as the lakes land.
⚑ INTEGRATOR DECISION (Wave 1 rebalance, supersedes design §2.3's table): the
brook roster is 6 ids — B_SPRING:1 B_FORK:1 B_STR:4 B_CURVE:2 B_SHRINE:2
B_LAKE:2. B_BRIDGE and B_FOLD are REMOVED: the Lake has zero rotational
freedom, so every non-meadow rim edge in the module is a mine — dead-end
streams measured 19.17%→1.50% with them gone (mechanism + sweep in tiles-a's
report; lint now enforces every non-brook edge in the module is meadow).
Cost accepted: no lane/fold feature can start during the opening (two shrines
can). The Plank Crossing concept returns in a wave-3 pack as SATCHEL tiles
carrying B edges — which also lets mid-game draws heal residual dead ends. B_FORK is ONE brook segment with three center
slots (brooks never complete, so no per-arm termination — unlike lane
crossings). Ram twins are deep copies of their plain twin at load.

## js/board.js (Wave 1-B)
board Map(cellKey→{tileId,rot,seat,n}); union-find feature graph per design §3:
placeTile(x,y,tileId,rot)→{completed:[rootMeta]}, canPlace(tileId,rot,x,y),
legalCells(tileId)→[{x,y,rots:[..]}], postShepherd(x,y,segIdx,seat)→bool,
canPost(x,y,segIdx)→bool, featureAt(x,y,segIdx)→rootMeta,
scoreFeature(root, final)→[{seat,pts,why}] (routes through Hooks.scoreMod),
finalScore()→[{kind,key,anchor,cells,holders,pts,detail}] (ordered walkthrough
data; key is the unique (cell,segIdx)-derived feature id — see INVARIANT below),
resetBoard(), stateHash() [FNV-1a: sorted board + posts + scores + supplies +
satchel length + RNG.state; seat.ai.* excluded].
rootMeta: {type:'lane'|'fold'|'shrine'|'meadow', cells:Set, opens, rams,
shepherds:[{seat,x,y,seg}], adjFolds:Set(fold roots)}. opens: +1 per touched
side per segment, −2 per side-join; complete ⇔ opens===0 (meadows skip).
Shrines: {x,y,seat?} list; complete = 8 neighbors occupied.
INVARIANT (asserted from both sides — tiles.js header + board.js + rules
fixtures): a segment's identity is (cell, segIdx) — NEVER (cell, type) and
NEVER its cell set. 20 of 30 tiles carry 2+ same-type segments on one cell
(LANE4 holds four independent lanes); finalScore rows carry a unique `key`.

## js/art.js (Wave 1-D)
paintTile(tileId,rot)→64×64 canvas, cached Map('id_rot'); paints purely from
segment data (design §5): meadow dither+flowers, 3px rutted lanes via center,
fold interiors (region test at paint time) with pen texture + tiny sheep +
wall + gate where a lane meets it, 5px brook + banks, shrine building.
SPRITES table: char-grid sprites with per-sprite palette
({w,h,pal:{char:hex},rows:[...]}) — packs push rows (ram/sheep/hut ship).
drawShepherd(ctx,seatColor,kind,x,y,scale): kind 'stand'|'seat'; x,y = where
the shepherd STANDS (bottom center); scale<1 auto-swaps to a 6px mini.
drawLogo(canvas). artRotSpot(x,y,rot)→[x,y] — the single definition of which
way a tile turns (View.spot and render both call it). artFelt(), artEmblem(name),
artClearCache().
As-built (Wave 1-D): geometry is DERIVED, never authored — fold shape from
owned sides, gates wherever a lane path crosses a fold mask, ponds wherever a
brook touches exactly ONE side. Pack-tile author rules (each fixed a real bug — plus Wave 2's: an
orientation-sensitive sprite must be pushed as a PROP, never painted into the
canonical buffer, or it tumbles with the rotation remap):
fold segments claim a pixel only if their field beats every other fold's by
FOLD_SEP (else FOLD2SEP_A's two pens merge into a fictional L); a fold mask is
reduced to the component connected to its own sides, pockets filled; a lane
arm drives to a gate only as the tile's ONLY stub (arms meeting arms stop at
the hamlet plaza; stubs end at shrine doors). Widths (legibility at 64px,
wider than §5 prose): lane 8px w/ parallel-offset ruts, brook 11px, wall 4px.
Rotations are a buffer index remap — art and slot rotation cannot drift.
As-built (Wave 2): artPaintTile returns {buf, props, seed} — orientation-
sensitive props (shrine buildings, huts, sheep, ram emblems) stamp AFTER the
rotation remap (they used to tumble with the tile; shrines rendered upside
down at rot 2). render.js gained a presentation camera (reveal walk / zoom
tween / ghost ease, all gated on rushed() = G.fast OR G.skipFx union);
rnGeom/worldToScreen/screenToCell untouched.

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
AUGMENTS with ui hooks (never moves/replaces). scores/seats are CALLABLES.
As-built (Wave 1-C): G.step ('place'|'post'|'idle') is the authoritative
sub-phase (there is no G.phase). G.autoAI lets ui.js own AI pacing.
shepherdList()→[{seat,x,y,seg,kind}] for render. runToEnd({turns:N}) stages a
mid-game board on a clean turn boundary (screenshot harnesses). game.js calls
pushFloater/pushFlash (render-owned) as features resolve, typeof-guarded.
legalPlacements(tileId, relax) is the phase-aware enumeration (brook rules,
no-U-turn, relax flag when only-legal-option) — AI and UI both use it, never
raw board.legalCells during the brook. Frame clock dt is clamped BOTH ends
(a backwards timestamp froze G.tick permanently — fixed Wave 1-C).
REPLAY RULE: a rebuild REPLAYS logged decisions, it never RE-TAKES them —
pumpAI (and any future auto-actor) must check G.replaying and stand down.
Resume ≡ straight-through is the asserted property (saveload: rebuild
accepted + same game by board/posts/scores/supplies/moves + finished state +
hash-identical + zero RNG draws). Mode after rebuild is 'reveal' not 'end'
(the walkthrough is a UI step the log doesn't record — both are finished).

## js/ai.js (Wave 1-G baseline; Wave 2 full)
Per design §6: enumerate legal (cell,rot,spot|null); eval with named weight
consts; NO board mutation during search (hypothetical merges read roots only).
P(complete) from a maintained satchel edge histogram. Personalities Old Wick/
Bram/Maud/Pip as weight vectors; difficulty = Box-Muller RNG noise σ
{2.5,1.0,0.25} (Lamb/Ewe/Ram). aiMove(seatIdx) acts through game.js's real
input path. seat.ai.* excluded from stateHash. Budget <50ms/turn (asserted).
AI.hooks rows for pack eval terms (wave 3).
As-built (Wave 1-G): satchel histogram is DERIVED per turn from G.satchel
(never maintained — no second source of truth to desync on dead tiles/resume/
pack satchel hooks); buckets count SIDES; P(complete)=a_T^opens×satchelFrac^0.5
cap 0.98. Enumeration goes through game's legalPlacements (brook/no-U-turn
aware, relax flag passed through), NOT raw legalCells. aiMove returns a plan
object or null, never false (test progress via G.moveNo, not !==false).
AI value = full expectation P·complete + (1−P)·end (unfinished features still
end-score); unbanked majority priced as soft equity (sole 1.0/tie .6/behind
.15); banked points use the exact 0-or-1 rule. AI.PERSONALITIES/AI.DIFFICULTY
are the single menu source. INTEGRATOR AMENDMENT (supersedes the Box-Muller-
on-RNG phrasing above): difficulty noise is STATELESS — hash-derived from
(G.seed, G.moveNo, seatIdx, candidateIdx), never RNG.next() — so a resumed AI
game is bit-identical to straight-through play; RNG.state is untouched by AI.
As-built (Wave 2): Maud TUNED — w_meadow 1.6→1.1, w_scar 0.7→1.3 (wins
5.4%→26.4% pooled over held-out seed sets; still the meadow specialist at
33.2% meadow share; the mispricing was the PERMANENCE of a herder, not the
meadow's value — a meadow post is the most lucrative single use of a shepherd
at 6.61pts). Supply-aware scarcity (supply^α) measured and REJECTED (levels
everyone down; α=1 is the peak). Bram's real lever is w_pot (not w_block,
inert 0.9–1.5) — recorded in ai.js for a later wave, deliberately not taken.
Difficulty sigmas verified, unchanged: Ram>Lamb 90%, Ewe>Lamb 76%, Ram>Ewe 69%.
AI.plan(seatIdx) → same shape as seat.ai.plan (seg = intended segIdx or
null); returns null rather than throwing; only meaningful with a tile in hand
(it deliberately does not draw). It is the pure dry-run selection seam — aiMove calls it, ui.js's
ghost beat consumes it, NOBODY re-derives a choice (proven selection-identical:
all 18 goldens byte-identical across the refactor). Purity asterisk: plan()
triggers board.js's lazy adjFolds re-canonicalization (idempotent, stateHash-
invisible, same as featureAt) — a future deep structural snapshot WILL see
that Set rewritten; the caveat lives in aiPlan's header.
test/ai-match.golden.json is a committed artifact — regenerate ONLY via
AI_MATCH_UPDATE=1; the config list is fingerprinted into it (config drift
fails loudly). Assertions are on stateHash; scoreboards print, never assert.

## js/render.js (Wave 1-D)
render(): board blits from art cache under view {cx,cy,zoom in ZOOMS}; ghost
tile (translucent; red tint on illegal), legal-cell pulse, shepherd sprites at
transformed spots, numbered post-discs overlay, +N pixel-font floaters,
completed-feature outline flash, turn banner, reveal-walkthrough highlighting,
calm-mode caps. 3×5 pixel FONT + drawPixelText ported from the siblings.
Reads G/board read-only. Never throws headless.
As-built (Wave 1-D): render.js OWNS the geometry the app hit-tests through —
worldToScreen/screenToCell/screenToCellF/rnGeom; ui.js's View forwards to
these (the disc hit-tested IS the disc drawn — LOAD-BEARING FOR INPUT, do not
change rounding without telling ui-e). Exports the feedback queues game.js
drives: pushFloater(x,y,text,color) [fractional BOARD CELL coords],
pushFlash(cells,color) [rootMeta.cells verbatim], pushBanner(text,color);
plus FONT/drawPixelText/textW for ui.js (FONT includes '·'). Reveal spotlight = steps[idx], the
step ABOUT to be counted. Every read typeof/null-guarded. render.js EXPORTS
rnBusy()→bool (true while any flash/floater/wool-puff/drop-in/settle is on
screen) — ui's AI settle beat gates on it; ANY caller must cap what it will
wait (see the ui.js block's 700ms cap rationale).
Screenshot gotcha (CORRECTED Wave 2 — the old wording was backwards): headless
Chrome under --virtual-time-budget DOES service the page's rAF loop, so a
setTimeout chain races it — a driver staging a mid-animation state may shoot
that state plus N frames. Reliable pattern: NULL requestAnimationFrame in the
driver, let the in-flight frame pass, THEN stage and freeze with
render();render=function(){}; and hide #menu/#end. Related trap: a far-future
hand-supplied frame timestamp doesn't pause anything — it makes every timed
state instantly overdue; step the clock in small increments from
performance.now(). Narrow-layout shots: headless Chrome FLOORS its viewport at
500px — --window-size=400 silently yields a CROP of a 500px page (use the
scratchpad narrow.sh pattern; a 'broken' mobile screenshot may be this).
An exception inside a setTimeout callback is NOT caught by the try/catch
around the scheduling call — a visual driver dies silently mid-sequence
(blank frames, no error). Put the catch INSIDE the callback.

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
As-built (Wave 2): AI pacing is a four-beat state machine (think 300 / ghost
400 / commit / settle 300 FLOOR then held while render's rnBusy() reports
feedback on screen, HARD-CAPPED at 700 — the cap is a safety property, not
taste: rnBusy's queues reap in RENDER frames, so a page that stops calling
render() pins it true forever; gating on another module's liveness without a
ceiling ships a hung game) driven off the FRAME TIMESTAMP, never the wall
clock — one clock for browser and suites, no test-only path. F, a board tap,
or the persisted SKIP AI ANIMATION setting collapse the WAIT only; the move is
bit-identical either way (uiflow asserts by stateHash across two whole games).
The ghost beat consumes ai.js's AI.plan (pure dry-run) — ui.js NEVER
re-derives the choice, and the beat folds away if plan() is absent. G.ghost
may carry ai:<seatIdx> during an AI ghost beat (ui's own setGhost/clearGhost
stand down) — test `G.ghost.ai != null`, NEVER truthiness (seat 0 is real).
ui publishes per frame for render: G.aiState, G.hover, and G.skipFx = the
UNION of all three animation-collapse paths (F held, SKIP AI ANIMATION
setting, board tap) — render's rushed() must gate on G.skipFx, not G.fast. Coarse pointers are two-tap for BOTH laying and posting; mouse
path unchanged (asserted separately). index.html has TWO live regions — #sr
(turn/board) and #srHint (teaching hints), ONE writer each (they shared #sr
first and the banner won every frame — the tutorial was announced to nobody).
prefs keys: skipAI, hintsOff, hintsSeen. buildEnd() is guarded against
double-folding finalScore() (it's called more than once; the category bars
must total each seat's score exactly — asserted, and the assertion fails on
the previously-shipped double-count).

## test/ (suites by wave)
shim.js+boot.js (Wave 0, done). Wave 1: tiledata (A), rules+placement+meadows
(B), brook+saveload (C), audio-smoke (F), uiflow (E). Wave 2: ai-match (G).
Wave 3: packs-<name> each. meadows.js MUST use an independent flood-fill
scorer written from the rules text, importing nothing from board.js.
Wave-3 kickoff habits (earned this wave): for ANY new check, PLANT the fault
it claims to catch before trusting it green (a scan can sit where it can never
fire); report a COUNT beside every agreement check (a dead code path hides
behind a green boolean); cheap proxy metrics diverge from the target exactly
on the cases that matter — verify against something independently derived.
Three more, from five structurally-unfailable tests found in wave 2: a suite
or driver may NOT measure the thing under test THROUGH the thing under test
(a camera measured via its own transform is a tautology); a screenshot driver
must fail LOUDLY (timer callbacks swallow exceptions — plausible artifacts
with rows silently missing); and before changing SHIPPED behavior to fix
something a harness showed you, confirm it occurs under the REAL frame loop
(a fix for a harness-only problem is invisible forever and looks like
diligence). And the meta-rule behind three of this wave's four real defects:
when a result contradicts something you already know, CHASE it — don't file
it. Each was preceded by a moment where the honest reaction was "that can't
be right". Summary rule for harness work: on this project the harness has
been wrong far more often than the code — verify the instrument before
believing the reading.
Wave-3 brief notes: (0) BLOCKER — tiles.js needs registerTiles(rows)
(append + re-index _TILE_BY_ID/_EDGE_CODES/_SLOT_OWNER) AND a matching
base-versus-registered split in tiledata's roster/count assertions — landing
one without the other either breaks packs silently or forces the roster guard
(the one we least want weakened) to be loosened. Design both together, BEFORE
the first pack agent starts. Today a pack's TILES.push() yields tileById→null and
the tile is simply never offered (the empty-board legalCells fast path that
once offered ANY tile at the origin without consulting canPlace was a real
board.js bug, found via this trail and fixed — the branch now defers to
canPlace per rotation, so the two cannot disagree by construction). tiledata's
slotOwner cross-check catches unregistered rows and names registerTiles as
the fix in its failure message.
board.js needs nothing (it reads through the lookups). (1) the brook module now exercises NO brook↔fold or
brook↔lane adjacency — a pack reintroducing either walks fresh ground; test it
directly. (2) A lane-over-water tile is forced into rim order B,L,B,L — two
Lake-mines AND 180°-symmetric (placer cannot steer) — so any such tile belongs
in the SATCHEL (mid-game), never in the brook module; the tiledata rim-alphabet
guard enforces this and explains itself on failure. ⚠ B-edged satchel tiles
INVALIDATE that guard's stated premise ("no base tile carries a B edge") —
re-MEASURE the dead-end rate with the new satchel before relaxing OR retaining
the {B,M} rim invariant; don't delete it as stale, don't keep it unexamined. (3) art.js's plank-sleeper
painting is retained and dormant: it triggers off lane-path-over-brook-pixels
generically, so wave-3 bridge tiles paint correctly with zero art work.
