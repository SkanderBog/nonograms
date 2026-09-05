# Nonograms

Nonogram puzzles generated and solved locally. Open **`index.html`** in a modern
browser (no build step, no server) and click **New puzzle**. Every accepted game
puzzle has exactly one verified solution and an Easy, Medium, or Hard label.
Those labels describe solver work; they are not calibrated human difficulty.
Some size/style/difficulty combinations may exhaust the generation budget.

## Play

- **Open `index.html` directly** (double-click it, or `python3 -m http.server 8080`
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
3. **Vet** the clues with an exhaustive solver. If a rival solution exists,
   flip up to three differing cells, recompute the clues, and re-check. This
   is a heuristic: it can create new rivals and need not converge.
4. Accept only after an untruncated, non-timed-out solve verifies the requested
   solution count, the intended picture is among those solutions, and fill
   ratio and difficulty filters pass. Otherwise retry within the attempt budget.

The browser requests exactly one solution, 35–65% filled cells, and difficulty
between the selected minimum and Hard. Difficulty uses search-node counts and
grid size; pure line-solving percentage is reported separately. Seeds reproduce
the random sequence, but machine speed and time cutoffs can change which
candidate is accepted. Generation currently runs synchronously and may pause
the page while searching; the time budgets are approximate.

## Files

| File | What it does |
|---|---|
| `index.html` | The whole game: generate + play, in one page |
| `bundle.js` | Browser bundle of the generator + solver (generated) |
| `build.js` | Rebuilds `bundle.js` from the source files |
| `core.js` | Shared grid/clue helpers (BigInt bitmasks) |
| `generator.js` | Picture → clues → uniqueness proof → difficulty filter |
| `solver.js` | Exhaustive all-solutions solver (the "vet" step) |
| `tests.js` | Parser, exhaustive small-grid, generation and bundle regressions |
| `PROJECT_STATUS.md` | Checked behavior and outstanding work |
| `puzzles/` | Local CLI output; ignored by Git |

The browser entry point and its small set of source files intentionally stay
together. `bundle.js` is committed so opening the page needs no installation.

## CLI

The same generator works from the command line:

```bash
node generator.js --size 15 --seed 42        # one unique 15×15 puzzle
node generator.js --size 10 --count 3        # three puzzles
node generator.js --size 20 --pattern checker # pick a style
node generator.js --size 12 --min-difficulty Medium   # only Medium+
```

Generated puzzles are printed and saved as JSON under `puzzles/` (gitignored).
The CLI accepts rectangular sizes too, such as `--size 15x10`. Its default
minimum difficulty is Trivial when either dimension is below 10, otherwise
Easy; its maximum is Hard. `--max-solutions N` explicitly allows up to N
solutions. A failed search prints a message and produces no puzzle file.

Solve a saved puzzle with `node solver.js puzzles/puzzle-15x15-s42.json`.
Solver counts are exact only if neither `truncated` nor `timedOut` is set.

## Regenerating the bundle

If you edit `core.js`, `solver.js`, or `generator.js`, rebuild the browser
bundle and commit it:

```bash
node build.js
npm test
```

Tests require Node.js 18 or newer and no third-party packages. `npm test` checks
that the committed bundle matches the sources before running the regressions.
It executes the bundle in an isolated JavaScript context without Node globals;
this is not a full browser interaction test.
