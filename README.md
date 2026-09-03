# Nonograms

Instant, *unique*, *non-trivial* nonogram puzzles. Open **`index.html`** in any
browser (no build step, no server) and click **New puzzle** — a fresh puzzle is
generated on the spot, guaranteed to have exactly one solution and to need some
actual thinking (Easy, Medium, or Hard — never Trivial).

## Play

- **Open `index.html` directly** (double-click it, or `python3 -m http.server`
  then visit `http://localhost:8080`). It works either way.
- Pick a size (10×10 … 30×30), a picture style, and a minimum difficulty, then
  **New puzzle**.
- Left-click fills a cell, right-click (or Shift-click) marks it. **Mode** swaps
  the left-click action. **Check** compares against the hidden solution;
  **Clear** resets the grid.
- Clue numbers strike through when a line is complete; the banner appears when
  you've solved it.

## How the puzzles are made

Every puzzle is generated from a structured random picture:

1. Draw a picture (symmetric blobs, blobs, Mondrian "shapes", diagonal stripes,
   or checkerboard).
2. Derive the row/column clues from it.
3. **Vet** the clues with an exhaustive solver — if a rival solution exists,
   flip the few cells where the picture disagrees with that rival and re-check.
   This converges to a *unique* solution in 1–3 rounds.
4. Keep the puzzle only if its difficulty (how much lookahead a human needs,
   estimated from the solver's search) is **Easy, Medium, or Hard** — trivial
   puzzles are redrawn.

The result: a puzzle that is provably unique, fun to solve, and reproducible by
its seed.

## Files

| File | What it does |
|---|---|
| `index.html` | The whole game: generate + play, in one page |
| `bundle.js` | Browser bundle of the generator + solver (generated) |
| `build.js` | Rebuilds `bundle.js` from the source files |
| `core.js` | Shared grid/clue helpers (BigInt bitmasks) |
| `generator.js` | Picture → clues → uniqueness proof → difficulty filter |
| `solver.js` | Exhaustive all-solutions solver (the "vet" step) |

## CLI

The same generator works from the command line:

```bash
node generator.js --size 15 --seed 42        # one unique 15×15 puzzle
node generator.js --size 10 --count 3        # three puzzles
node generator.js --size 20 --pattern checker # pick a style
node generator.js --size 12 --min-difficulty Medium   # only Medium+
```

Generated puzzles are printed and saved as JSON under `puzzles/` (gitignored).

## Regenerating the bundle

If you edit `core.js`, `solver.js`, or `generator.js`, rebuild the browser
bundle and commit it:

```bash
node build.js
```
