// tests.js — smoke + property tests. Run with: node tests.js

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  cluesFromGrid,
  lineMasks,
  matchesClues,
  mulberry32,
  parsePuzzle,
  parseTextPuzzle,
  rowsFromArrays,
} from './core.js';
import { solvePuzzle } from './solver.js';
import { classifyDifficulty, DIFFICULTIES, generatePuzzle } from './generator.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// --- lineMasks ------------------------------------------------------------
test('lineMasks: [2,1] in 5 cells has 3 completions', () => {
  const { masks, truncated } = lineMasks(5, [2, 1]);
  assert.equal(truncated, false);
  assert.equal(masks.length, 3);
});

test('lineMasks: [1,1,1] in 5 cells has 1 completion', () => {
  assert.equal(lineMasks(5, [1, 1, 1]).masks.length, 1);
});

test('lineMasks: [1,1] in 2 cells is impossible', () => {
  assert.equal(lineMasks(2, [1, 1]).masks.length, 0);
});

test('lineMasks: respects filled/empty filters', () => {
  // [2] in 5 cells has 4 completions; cell 2 empty leaves 2 of them.
  const { masks } = lineMasks(5, [2], 0n, 1n << 2n);
  assert.equal(masks.length, 2);
});

test('lineMasks: empty clues give the all-empty line', () => {
  assert.deepEqual(lineMasks(4, []).masks, [0n]);
});

test('lineMasks: the cap reports incomplete enumeration without false constraints', () => {
  const result = lineMasks(5, [1], 0n, 0n, 2);
  assert.equal(result.masks.length, 2);
  assert.equal(result.truncated, true);
});

// --- solver ---------------------------------------------------------------
// 3x3 X shape — provably unique:
//  1 0 1 / 0 1 0 / 1 0 1
const X = {
  width: 3,
  height: 3,
  rowClues: [[1, 1], [1], [1, 1]],
  colClues: [[1, 1], [1], [1, 1]],
};

test('solver: 3x3 X has exactly 1 solution', () => {
  const res = solvePuzzle(X);
  assert.equal(res.count, 1);
  assert.deepEqual(res.solutions[0], [0b101n, 0b010n, 0b101n]);
});

test('solver: 2x2 two diagonals has exactly 2 solutions', () => {
  const res = solvePuzzle({ width: 2, height: 2, rowClues: [[1], [1]], colClues: [[1], [1]] });
  assert.equal(res.count, 2);
});

test('solver: 3x3 permutation matrices has exactly 6 solutions', () => {
  const res = solvePuzzle({ width: 3, height: 3, rowClues: [[1], [1], [1]], colClues: [[1], [1], [1]] });
  assert.equal(res.count, 6);
});

test('solver: every returned solution satisfies the clues', () => {
  const res = solvePuzzle({ width: 3, height: 3, rowClues: [[1], [1], [1]], colClues: [[1], [1], [1]] });
  for (const s of res.solutions) {
    assert.ok(matchesClues(s, 3, 3, [[1], [1], [1]], [[1], [1], [1]]));
  }
});

test('solver: empty-clue 2x2 has exactly 1 solution (all empty)', () => {
  const res = solvePuzzle({ width: 2, height: 2, rowClues: [[], []], colClues: [[], []] });
  assert.equal(res.count, 1);
  assert.deepEqual(res.solutions[0], [0n, 0n]);
});

test('solver: impossible clues give 0 solutions', () => {
  const res = solvePuzzle({ width: 2, height: 2, rowClues: [[1, 1], []], colClues: [[], []] });
  assert.equal(res.count, 0);
});

test('solver: maxSolutions cap is respected', () => {
  const res = solvePuzzle(
    { width: 3, height: 3, rowClues: [[1], [1], [1]], colClues: [[1], [1], [1]] },
    { maxSolutions: 2 }
  );
  assert.equal(res.count, 2);
  assert.equal(res.truncated, true);
});

test('solver: exact counts and grids agree with exhaustive 3x3 and rectangular grids', () => {
  for (const [width, height] of [[3, 3], [2, 4], [4, 2]]) {
    const groups = new Map();
    for (let bits = 0; bits < 2 ** (width * height); bits++) {
      const rows = Array.from({ length: height }, (_, r) =>
        BigInt((bits >>> (r * width)) & ((1 << width) - 1)));
      const clues = cluesFromGrid(rows, width, height);
      const key = JSON.stringify(clues);
      if (!groups.has(key)) groups.set(key, { clues, grids: [] });
      groups.get(key).grids.push(rows.join(','));
    }
    for (const { clues, grids } of groups.values()) {
      const result = solvePuzzle({ width, height, ...clues });
      assert.equal(result.truncated, false);
      assert.equal(result.timedOut, false);
      assert.equal(result.count, grids.length);
      assert.deepEqual(result.solutions.map((rows) => rows.join(',')).sort(), grids.sort());
    }
  }
});

// --- parsing ---------------------------------------------------------------
test('parseTextPuzzle: reads the text format', () => {
  const p = parseTextPuzzle('3 3\n1 1\n1\n1 1\n1 1\n1\n1 1');
  assert.deepEqual(p, X);
});

test('parsePuzzle: reads generator-style JSON', () => {
  const p = parsePuzzle(
    JSON.stringify({ width: 3, height: 3, rowClues: [[1], [1], [1]], colClues: [[1], [1], [1]] })
  );
  assert.equal(p.width, 3);
  assert.equal(p.rowClues.length, 3);
});

test('parsePuzzle: preserves blank row and final column clues', () => {
  const text = '\n# header comment\n2 2\n\n1\n# column comment\n1\n';
  assert.deepEqual(parsePuzzle(text), {
    width: 2, height: 2, rowClues: [[], [1]], colClues: [[1], []],
  });
  assert.deepEqual(parsePuzzle('1 1\n\n'), {
    width: 1, height: 1, rowClues: [[]], colClues: [[]],
  });
});

test('parseTextPuzzle: rejects missing headers, dimensions and clue records', () => {
  for (const text of ['', '# only a comment', '0 2\n0\n0', '2.5 2\n0', '2 2\n0']) {
    assert.throws(() => parseTextPuzzle(text));
  }
});

// --- generator -------------------------------------------------------------
test('generator: 24 puzzles across sizes 5-15 are unique, valid and in range', () => {
  const rand = mulberry32(20260831);
  for (let i = 0; i < 24; i++) {
    const w = [5, 8, 10, 12, 15][Math.floor(rand() * 5)];
    const p = generatePuzzle({ width: w, height: w, seed: Math.floor(rand() * 1e9), minDifficulty: 'Trivial' });
    assert.ok(p, `generation failed for ${w}x${w} (#${i})`);
    assert.equal(p.count, 1, `not unique: ${w}x${w} seed ${p.seed}`);
    assert.ok(DIFFICULTIES.includes(p.difficulty));
    const fill = p.solution.flat().reduce((sum, cell) => sum + cell, 0) / (w * w);
    assert.ok(fill >= 0.35 && fill <= 0.65, `fill ratio out of range: ${fill}`);
    // clues round-trip: the intended solution reproduces the puzzle's clues
    const rows = rowsFromArrays(p.solution, p.width);
    assert.ok(matchesClues(rows, p.width, p.height, p.rowClues, p.colClues));
    // independent re-solve agrees
    const res = solvePuzzle(
      { width: p.width, height: p.height, rowClues: p.rowClues, colClues: p.colClues },
      { maxSolutions: 2 }
    );
    assert.equal(res.count, 1);
    assert.equal(res.truncated, false);
    assert.equal(res.timedOut, false);
  }
});

test('generator: rejects candidates whose rival edits drift outside fill bounds', () => {
  // Previously accepted a 36%-filled puzzle despite minFill: 0.4.
  const p = generatePuzzle({
    width: 5, height: 5, seed: 16, minDifficulty: 'Trivial',
    minFill: 0.4, maxFill: 0.44, maxImages: 1,
  });
  if (p) {
    const fill = p.solution.flat().reduce((sum, cell) => sum + cell, 0) / 25;
    assert.ok(fill >= 0.4 && fill <= 0.44);
  }
});

test('generator: exhausted attempts return null', () => {
  assert.equal(generatePuzzle({ maxImages: 0 }), null);
});

test('generator: each named pattern yields a verified 10x10 puzzle', () => {
  for (const pattern of ['symmetric', 'blobs', 'shapes', 'diagonal', 'checker']) {
    const p = generatePuzzle({ width: 10, height: 10, seed: 42, pattern, minDifficulty: 'Trivial' });
    assert.ok(p, `generation failed for ${pattern}`);
    const result = solvePuzzle(p, { maxSolutions: 2 });
    assert.equal(result.count, 1);
    assert.equal(result.truncated, false);
    assert.equal(result.timedOut, false);
  }
});

test('generator: reproducible for the same seed', () => {
  const a = generatePuzzle({ width: 8, height: 8, seed: 424242 });
  const b = generatePuzzle({ width: 8, height: 8, seed: 424242 });
  assert.deepEqual(a.rowClues, b.rowClues);
  assert.deepEqual(a.solution, b.solution);
});

test('classifyDifficulty: no lookahead → Trivial when small, Easy when large', () => {
  assert.equal(classifyDifficulty(100, 0, 25), 'Trivial'); // 5x5
  assert.equal(classifyDifficulty(100, 1, 400), 'Easy'); // 20x20
});

test('classifyDifficulty: branch nodes scale with size', () => {
  assert.equal(classifyDifficulty(50, 5), 'Medium'); // 10x10, 5 nodes
  assert.equal(classifyDifficulty(50, 100), 'Hard'); // 10x10, 100 nodes
  assert.equal(classifyDifficulty(50, 100, 400), 'Medium'); // 20x20, 100 nodes is medium
});

test('browser bundle: runs without Node globals and matches source generation', () => {
  const path = new URL('./bundle.js', import.meta.url);
  const before = readFileSync(path, 'utf8');
  const browser = {};
  runInNewContext(before, browser, { timeout: 1000 });
  const options = { width: 10, height: 10, seed: 42 };
  const bundled = browser.generatePuzzle(options);
  const source = generatePuzzle(options);
  assert.ok(bundled);
  assert.equal(JSON.stringify(bundled.solution), JSON.stringify(source.solution));
  assert.equal(bundled.count, 1);
  assert.equal(bundled.difficulty, source.difficulty);
});

console.log(`\n${passed} tests passed ✔`);
