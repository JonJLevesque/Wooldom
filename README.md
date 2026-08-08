# Wooldom 🐑

A tile-laying pastoral — draw a tile, lay the land, post your shepherds, and
count the meadows when the satchel runs dry. An original homage to the classic
tile-and-follower genre, played solo against AI rivals.

**Play it: open `index.html` in any modern browser.** No server, no build step,
no dependencies — vanilla HTML5 canvas, CSS, and JavaScript.

## How to play

Each turn you draw a tile from the **satchel** and lay it against the growing
map — edges must agree: meadow meets meadow, lane meets lane, fold meets fold.
Then you may post one of your seven **shepherds** onto a feature of that tile,
if nobody's shepherd already works the connected feature:

- **Lanes** score 1 a tile when both ends close.
- **Folds** (walled sheep-pens) score 2 a tile — plus 2 per **Prize Ram** —
  when the wall closes.
- **Shrines** score 9 when all eight neighboring tiles are laid.
- **Meadows** never close: at the game's end, each meadow pays **3 points per
  finished fold it touches** to whoever has the most herders seated in it.

Scored shepherds come home; herders in meadows never do. That tension — spend
a shepherd forever for endgame meadow points, or keep them cycling — is the
whole game. Most shepherds on a feature wins it; ties pay everyone in full.

**The Brook** (on by default): twelve river tiles open the game, from the
Spring to the two Lakes — with a fork in the middle, so the map starts split
around living water.

## The rivals

- **Old Wick** — builds patiently, finishes what he starts
- **Bram** — plays your position, not his
- **Maud** — wants every meadow in the shire
- **Pip** — lanes and shrines, always moving

Each at three tempers: **Lamb**, **Ewe**, or **Ram**. Same seed, same satchel —
every game is replayable from its seed, and a resumed game is bit-identical
to one never interrupted.

## Code layout

Plain script tags share globals — load order matters (see `index.html`):

```
js/core.js    constants, palette, the seeded RNG (all gameplay randomness)
js/audio.js   Web Audio synthesis: sfx + three generative pastoral themes
js/tiles.js   the 72-tile base set + 12-tile brook, as pure data
js/board.js   the feature graph: union-find, completion, scoring
js/art.js     procedural tile painter — every tile drawn from its data
js/game.js    turn loop, brook phase, hooks, replay-log saves
js/ai.js      evaluation AI: four personalities, stateless difficulty noise
js/render.js  board drawing, floaters, the end-reveal walkthrough
js/ui.js      input, menus, pan/zoom, settings, boot
```

`CONTRACT.md` records every cross-module interface and as-built decision.

## Tests

Everything drives the same input path the mouse does, through `WoolDbg`:

```
node test/boot.js        # modules load; page-integrity collision scans
node test/tiledata.js    # tile data lint: slot partition, roster, invariants
node test/rules.js       # hand-computed scoring fixtures
node test/placement.js   # edge-match symmetry, no unplaceable tiles
node test/meadows.js     # independent flood-fill scorer vs the engine
node test/brook.js       # the opening: fork, lakes, no-U-turn, strandings
node test/saveload.js    # resume ≡ straight-through, hash-identical
node test/ai-smoke.js    # AI legality, determinism, side-effect-freedom
node test/uiflow.js      # screen state machine, input paths
node test/audio-smoke.js # full audio API under hostile args
```

Design rule of thumb, learned by measurement: a segment's identity is
(cell, segIdx) — never its type, never its cell set — and any non-meadow edge
in the brook module is a mine the Lake can step on.
