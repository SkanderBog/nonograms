// generator.js — instantly creates nonogram puzzles with a few solutions
// (unique by default) that are fun to play. CLI included.
//
// How it works:
//   1. Draw a structured random picture (symmetric blobs, blobs, diagonal
//      stripes or checkerboard) with a healthy fill ratio.
//   2. Derive the row/column clues from the picture.
//   3. Prove the solution count with the solver. If rivals exist, flip one
//      cell where the picture disagrees with a found rival and re-prove —
//      this drives the puzzle toward uniqueness very quickly.
//   4. Accept the puzzle only if its difficulty (how far pure line solving
//      gets + how much search the uniqueness proof needed) is in range.
//   5. Redraw if a candidate cannot be fixed within the attempt budget.
// Seeded (--seed), so every puzzle is reproducible.

import {
  cluesFromGrid,
  mulberry32,
  parseArgs,
  popcount,
  renderGrid,
  rowsToArrays,
} from './core.js';
import { solvePuzzle } from './solver.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DIFFICULTIES = ['Trivial', 'Easy', 'Medium', 'Hard', 'Expert'];

// How hard a puzzle feels for a human, estimated from how the uniqueness
// proof went: how much branching the solver needed (a proxy for the
// lookahead a human needs), and whether pure line-solving alone solves it.
// Thresholds scale with the cell count — a 20x20 that needs 100 branch nodes
// is easy, a 5x5 that needs 100 is brutal.
export function classifyDifficulty(lineSolvablePercent, nodes, cells = 100) {
  const scale = Math.max(1, cells / 100);
  if (nodes <= 1) {
    // No real lookahead: difficulty is then mostly about size.
    return cells < 64 ? 'Trivial' : 'Easy';
  }
  if (nodes <= 3 * scale) return 'Easy';
  if (nodes <= 30 * scale) return 'Medium';
  if (nodes <= 300 * scale) return 'Hard';
  return 'Expert';
}

// ---------------------------------------------------------------------------
// Patterns — each returns bitmask rows for a w×h picture.
// ---------------------------------------------------------------------------

// Random blobs (ellipses / rectangles) until roughly targetFill is reached.
function randomBlobs(w, h, rand, targetFill = 0.5) {
  const rows = new Array(h).fill(0n);
  let filled = 0;
  const total = w * h;
  for (let guard = 0; guard < 400 && filled / total < targetFill; guard++) {
    const cx = Math.floor(rand() * w);
    const cy = Math.floor(rand() * h);
    const rx = 1 + Math.floor(rand() * Math.max(1, w / 3));
    const ry = 1 + Math.floor(rand() * Math.max(1, h / 3));
    const rect = rand() < 0.35;
    for (let y = Math.max(0, cy - ry); y <= Math.min(h - 1, cy + ry); y++) {
      for (let x = Math.max(0, cx - rx); x <= Math.min(w - 1, cx + rx); x++) {
        const inside = rect || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
        if (!inside) continue;
        const bit = 1n << BigInt(x);
        if (!(rows[y] & bit)) {
          rows[y] |= bit;
          filled++;
        }
      }
    }
  }
  return rows;
}

// Blobs in a base region, then mirrored (h / v / both / 180° rotation).
function makeSymmetric(w, h, rand) {
  const type = Math.floor(rand() * 4);
  const baseW = type === 0 ? w : Math.ceil(w / 2);
  const baseH = type === 1 ? h : Math.ceil(h / 2);
  const base = randomBlobs(baseW, baseH, rand);
  const rows = new Array(h).fill(0n);
  const set = (y, x) => {
    rows[y] |= 1n << BigInt(x);
  };
  for (let y = 0; y < baseH; y++) {
    for (let x = 0; x < baseW; x++) {
      if (!((base[y] >> BigInt(x)) & 1n)) continue;
      if (type === 0) {
        set(y, x);
        set(h - 1 - y, x);
      } else if (type === 1) {
        set(y, x);
        set(y, w - 1 - x);
      } else if (type === 2) {
        set(y, x);
        set(y, w - 1 - x);
        set(h - 1 - y, x);
        set(h - 1 - y, w - 1 - x);
      } else {
        set(y, x);
        set(h - 1 - y, w - 1 - x);
      }
    }
  }
  return rows;
}

// Stamp a few 2x2 filled squares and 2x2 holes onto a picture. Striped
// patterns (diagonal / checker) have translation degeneracies — shifted
// copies satisfy nearly the same clues — and these distinctive anchors break
// that symmetry so the puzzle collapses toward a unique solution.
function addAnchors(rows, w, h, rand, count) {
  for (let i = 0; i < count; i++) {
    const ax = Math.floor(rand() * (w - 1));
    const ay = Math.floor(rand() * (h - 1));
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) rows[ay + dy] |= 1n << BigInt(ax + dx);
    }
  }
  for (let i = 0; i < count; i++) {
    const ax = Math.floor(rand() * (w - 1));
    const ay = Math.floor(rand() * (h - 1));
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) rows[ay + dy] &= ~(1n << BigInt(ax + dx));
    }
  }
  return rows;
}

// Diagonal stripes with a little noise. Noise is scaled down for big grids:
// noise cells create huge families of near-identical rival solutions that
// make uniqueness hard to reach.
function makeDiagonal(w, h, rand) {
  const dir = rand() < 0.5 ? 1 : -1;
  const period = 4 + Math.floor(rand() * 2); // 4..5
  const phase = Math.floor(rand() * period);
  const noise = w * h >= 144 ? 0.02 : 0.06;
  const rows = new Array(h).fill(0n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (((x + dir * y) % period) + period) % period;
      const on = v === phase || v === (phase + 1) % period;
      if (on ? rand() > noise : rand() < noise) rows[y] |= 1n << BigInt(x);
    }
  }
  return addAnchors(rows, w, h, rand, w * h >= 144 ? 2 : 1);
}

// Checkerboard with a little noise (scaled down for big grids, see above).
// A pure checkerboard has exactly 2 solutions, so uniqueness is close at hand.
function makeChecker(w, h, rand) {
  const phase = Math.floor(rand() * 2);
  const noise = w * h >= 144 ? 0.03 : 0.12;
  const rows = new Array(h).fill(0n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (((x + y) & 1) === phase && rand() > noise) rows[y] |= 1n << BigInt(x);
    }
  }
  return addAnchors(rows, w, h, rand, w * h >= 144 ? 1 : 1);
}

// Blobby picture with rectangular outline holes carved into it —
// Mondrian-ish abstract. The carves create distinctive corner/single clues
// that make the puzzle mostly unique right away.
function makeShapes(w, h, rand) {
  const rows = randomBlobs(w, h, rand, 0.52);
  const carves = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < carves; i++) {
    const rw = 2 + Math.floor(rand() * Math.min(6, w / 3));
    const rh = 2 + Math.floor(rand() * Math.min(6, h / 3));
    const x0 = Math.floor(rand() * Math.max(1, w - rw));
    const y0 = Math.floor(rand() * Math.max(1, h - rh));
    const x1 = x0 + rw - 1;
    const y1 = y0 + rh - 1;
    for (let x = x0; x <= x1; x++) {
      rows[y0] &= ~(1n << BigInt(x));
      rows[y1] &= ~(1n << BigInt(x));
    }
    for (let y = y0; y <= y1; y++) {
      rows[y] &= ~(1n << BigInt(x0));
      rows[y] &= ~(1n << BigInt(x1));
    }
  }
  return rows;
}

export const PATTERNS = {
  symmetric: makeSymmetric,
  blobs: (w, h, r) => randomBlobs(w, h, r, 0.5),
  shapes: makeShapes,
  diagonal: makeDiagonal,
  checker: makeChecker,
};

// Large diagonal-stripe puzzles are genuinely Expert-class (their uniqueness
// is slow to prove and they need lots of human lookahead), so "auto" avoids
// them above 256 cells. They remain available by explicit --pattern.
const AUTO_PATTERNS = ['symmetric', 'blobs', 'shapes', 'checker'];
const AUTO_PATTERNS_SMALL = ['symmetric', 'blobs', 'shapes', 'diagonal', 'checker'];

const fillRatio = (rows, w, h) => rows.reduce((acc, row) => acc + popcount(row), 0) / (w * h);

// ---------------------------------------------------------------------------
// The generator itself.
// ---------------------------------------------------------------------------
export function generatePuzzle(opts = {}) {
  const width = opts.width ?? 10;
  const height = opts.height ?? 10;
  const pattern = opts.pattern ?? 'auto';
  const allowed = opts.maxSolutions ?? 1; // "a few solutions"
  const minFill = opts.minFill ?? 0.35;
  const maxFill = opts.maxFill ?? 0.65;
  const minDiff = opts.minDifficulty ?? 'Easy'; // skip Trivial by default (non-trivial only)
  const maxDiff = opts.maxDifficulty ?? null;
  const verifyMs = opts.verifyMs ?? Math.max(400, width * height * 2);
  const overallMs = opts.overallMs ?? 8000;
  const maxImages = opts.maxImages ?? 20;
  const maxFlips = opts.maxFlips ?? 6;
  const seed = opts.seed ?? (Date.now() ^ Math.floor(Math.random() * 0xffffffff));
  const rand = mulberry32(seed);
  const t0 = Date.now();

  for (let img = 0; img < maxImages; img++) {
    if (Date.now() - t0 > overallMs) break;
    const autoList = width * height >= 256 ? AUTO_PATTERNS : AUTO_PATTERNS_SMALL;
    const name = pattern === 'auto' ? autoList[Math.floor(rand() * autoList.length)] : pattern;
    const makeFn = PATTERNS[name];
    if (!makeFn) throw new Error(`unknown pattern "${pattern}" (try symmetric, blobs, diagonal, checker, auto)`);

    let rows = makeFn(width, height, rand);
    if (fillRatio(rows, width, height) < minFill || fillRatio(rows, width, height) > maxFill) continue;

    for (let flip = 0; flip < maxFlips; flip++) {
      if (Date.now() - t0 > overallMs) break;
      const { rowClues, colClues } = cluesFromGrid(rows, width, height);
      const res = solvePuzzle(
        { width, height, rowClues, colClues },
        { maxSolutions: allowed + 1, timeBudgetMs: verifyMs }
      );
      if (res.timedOut) break; // uniqueness unprovable within budget → redraw
      if (res.solutions.length <= allowed) {
        const diff = classifyDifficulty(res.lineSolvablePercent, res.nodes, width * height);
        const di = DIFFICULTIES.indexOf(diff);
        const inRange =
          (minDiff === null || di >= DIFFICULTIES.indexOf(minDiff)) &&
          (maxDiff === null || di <= DIFFICULTIES.indexOf(maxDiff));
        if (inRange && res.solutions.some((s) => s.every((row, r) => row === rows[r]))) {
          return {
            width,
            height,
            rowClues,
            colClues,
            solution: rowsToArrays(rows, width),
            solutions: res.solutions.map((s) => rowsToArrays(s, width)),
            count: res.solutions.length,
            seed,
            pattern: name,
            difficulty: diff,
            lineSolvablePercent: res.lineSolvablePercent,
            searchNodes: res.nodes,
            verifyMs: res.elapsedMs,
            generatedMs: Date.now() - t0,
            generatedAt: new Date().toISOString(),
          };
        }
        break; // unique but wrong difficulty → redraw
      }
      // Rivals exist: flip a few cells where the picture disagrees with a
      // rival — killing several rival solutions at once converges faster
      // than flipping a single cell.
      const rival = res.solutions.find((s) => s.some((row, r) => row !== rows[r]));
      if (!rival) break;
      const diffs = [];
      for (let r = 0; r < height; r++) {
        let x = rows[r] ^ rival[r];
        while (x) {
          const low = x & -x;
          diffs.push([r, low.toString(2).length - 1]);
          x ^= low;
        }
      }
      // shuffle and take up to 3 differing cells
      for (let i = diffs.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [diffs[i], diffs[j]] = [diffs[j], diffs[i]];
      }
      let ratio = NaN;
      for (let k = 0; k < Math.min(3, diffs.length); k++) {
        const [r, c] = diffs[k];
        rows[r] ^= 1n << BigInt(c);
        ratio = fillRatio(rows, width, height);
        if (ratio < minFill || ratio > maxFill) break; // drifted out of bounds → redraw
      }
    }
  }
  return null; // gave up within the attempt budget
}

// ---------------------------------------------------------------------------
// CLI: node generator.js [--size 10x10] [--count 3] [--pattern blobs] ...
// ---------------------------------------------------------------------------
const HELP = `Usage: node generator.js [options]

Generates nonogram puzzles instantly: a structured random picture is turned
into clues, the solver proves the puzzle has only the requested number of
solutions ("few" — unique by default), and a difficulty filter keeps only
puzzles that are fun (not trivial, not brutal). Every puzzle is written to
puzzles/ as JSON and printed to the terminal.

Options:
  --size W[xH]       grid size (default 10; e.g. 10 or 15x10)
  --count N          how many puzzles to generate (default 1)
  --pattern NAME     symmetric | blobs | shapes | diagonal | checker | auto
  --seed N           reproducible seed
  --max-solutions N  allow puzzles with up to N solutions (default 1)
  --min-fill F       minimum fill ratio (default 0.35)
  --max-fill F       maximum fill ratio (default 0.65)
  --min-difficulty D Trivial | Easy | Medium | Hard | Expert
                     (default Easy, Trivial below 10x10)
  --max-difficulty D (default Hard)
  --time-ms N        time budget per uniqueness proof (ms)
  --output DIR       where to write the JSON files (default puzzles/)
  --json             print machine-readable output
  --help             this text`;

function printPuzzle(p, index) {
  const title = `puzzle ${index}: ${p.width}x${p.height} · ${p.pattern} · seed ${p.seed} · ` +
    `${p.difficulty} · ${p.count} solution${p.count === 1 ? '' : 's'} · verified in ${p.verifyMs} ms`;
  console.log('─'.repeat(Math.min(title.length, 78)));
  console.log(title);
  console.log('─'.repeat(Math.min(title.length, 78)));
  console.log(p.solution.map((row) => row.map((v) => (v ? '█' : '·')).join('')).join('\n'));
  console.log('');
}

function savePuzzle(p, dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `puzzle-${p.width}x${p.height}-s${p.seed}.json`);
  writeFileSync(file, JSON.stringify(p, null, 2));
  return file;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length > 0) {
    console.log(HELP);
    return;
  }
  if (args.pattern && args.pattern !== 'auto' && !(args.pattern in PATTERNS)) {
    console.error(`unknown pattern "${args.pattern}" — try: ${Object.keys(PATTERNS).join(', ')} or auto`);
    process.exit(1);
  }
  const m = String(args.size ?? '10').split(/x/i).map(Number);
  const width = m[0];
  const height = m[1] ?? m[0];
  if (!(width >= 2 && height >= 2) || width > 60 || height > 60) {
    console.error('--size must be between 2 and 60, e.g. 10 or 10x15');
    process.exit(1);
  }
  const count = args.count ?? 1;
  const outDir = args.output ? String(args.output) : join(HERE, 'puzzles');
  const made = [];
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    const p = generatePuzzle({
      width,
      height,
      pattern: args.pattern ?? 'auto',
      seed: args.seed !== undefined ? Number(args.seed) + i : undefined,
      maxSolutions: args['max-solutions'] ?? 1,
      minDifficulty: args['min-difficulty'] ?? 'Easy',
      maxDifficulty: args['max-difficulty'] ?? 'Hard',
      minFill: args['min-fill'] !== undefined ? Number(args['min-fill']) : undefined,
      maxFill: args['max-fill'] !== undefined ? Number(args['max-fill']) : undefined,
      verifyMs: args['time-ms'],
    });
    if (!p) {
      console.error(
        `  ! no ${width}x${height} puzzle found within the attempt budget ` +
          `(try again, or widen --min-difficulty / --max-difficulty)`
      );
      continue;
    }
    made.push(p);
    printPuzzle(p, made.length);
    console.log(`  saved: ${savePuzzle(p, outDir)}`);
    console.log('');
  }
  console.log(`generated ${made.length}/${count} puzzle(s) in ${Date.now() - t0} ms → ${outDir}`);
  if (args.json) console.log(JSON.stringify(made));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
