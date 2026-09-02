// solver.js — enumerates ALL solutions of a nonogram puzzle (CLI included).
//
// Algorithm: backtracking with line-constraint propagation.
//   1. For every row and column, precompute all completions of the line that
//      match its clues (bitmask enumeration, see core.js#lineMasks).
//   2. Propagate to a fixpoint: for each line keep only completions consistent
//      with the cells fixed so far; a cell that is filled (empty) in every
//      remaining completion of its line gets fixed.
//   3. A line with no completions left is a contradiction → backtrack.
//   4. Branch on the most-constrained undecided cell (fewest completions in
//      its line and in the crossing line), trying the likelier value first.
// Every leaf is validated against the clues before being counted, so results
// are exact even for pathological inputs.

import { FULL, lineMasks, matchesClues, parseArgs, parsePuzzle, renderGrid } from './core.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// opts: { maxSolutions = 1e6, timeBudgetMs = Infinity }
// Returns { solutions: BigInt[][], count, truncated, timedOut, nodes,
//           lineSolvablePercent, elapsedMs }
export function solvePuzzle(puzzle, opts = {}) {
  const { width: n, height: m, rowClues, colClues } = puzzle;
  const maxSolutions = opts.maxSolutions ?? 1_000_000;
  const timeBudgetMs = opts.timeBudgetMs ?? Infinity;
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;

  const rowFilled = new Array(m).fill(0n);
  const rowEmpty = new Array(m).fill(0n);
  const colFilled = new Array(n).fill(0n);
  const colEmpty = new Array(n).fill(0n);

  // Base completions per line (null = too many to enumerate → unconstrained).
  const rowMasks = rowClues.map((c) => {
    const r = lineMasks(n, c);
    return r.truncated ? null : r.masks;
  });
  const colMasks = colClues.map((c) => {
    const r = lineMasks(m, c);
    return r.truncated ? null : r.masks;
  });

  const validMasks = (base, filled, empty) => {
    if (base === null) return null;
    const out = [];
    for (const mk of base) {
      if ((mk & filled) === filled && (mk & empty) === 0n) out.push(mk);
    }
    return out;
  };

  // Fix the cells forced by every remaining completion of each line.
  // Returns false on contradiction.
  const propagate = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 0; r < m; r++) {
        const v = validMasks(rowMasks[r], rowFilled[r], rowEmpty[r]);
        if (v === null) continue;
        if (v.length === 0) return false;
        let all = v[0];
        let any = 0n;
        for (let i = 0; i < v.length; i++) {
          all &= v[i];
          any |= v[i];
        }
        const f1 = all; // filled in every completion
        const f0 = FULL(n) & ~any; // empty in every completion
        const nf = f1 & ~rowFilled[r];
        const ne = f0 & ~rowEmpty[r];
        if (nf !== 0n || ne !== 0n) {
          changed = true;
          rowFilled[r] |= f1;
          rowEmpty[r] |= f0;
          for (let c = 0; c < n; c++) {
            const bit = 1n << BigInt(c);
            if (nf & bit) colFilled[c] |= 1n << BigInt(r);
            if (ne & bit) colEmpty[c] |= 1n << BigInt(r);
          }
        }
      }
      for (let c = 0; c < n; c++) {
        const v = validMasks(colMasks[c], colFilled[c], colEmpty[c]);
        if (v === null) continue;
        if (v.length === 0) return false;
        let all = v[0];
        let any = 0n;
        for (let i = 0; i < v.length; i++) {
          all &= v[i];
          any |= v[i];
        }
        const f1 = all;
        const f0 = FULL(m) & ~any;
        const nf = f1 & ~colFilled[c];
        const ne = f0 & ~colEmpty[c];
        if (nf !== 0n || ne !== 0n) {
          changed = true;
          colFilled[c] |= f1;
          colEmpty[c] |= f0;
          for (let r = 0; r < m; r++) {
            const bit = 1n << BigInt(r);
            if (nf & bit) rowFilled[r] |= 1n << BigInt(c);
            if (ne & bit) rowEmpty[r] |= 1n << BigInt(c);
          }
        }
      }
    }
    return true;
  };

  if (!propagate()) {
    return {
      solutions: [],
      count: 0,
      truncated: false,
      timedOut: false,
      nodes: 0,
      lineSolvablePercent: 0,
      elapsedMs: elapsed(),
    };
  }

  const determinedCells = () => {
    let cnt = 0;
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < n; c++) {
        const bit = 1n << BigInt(c);
        if ((rowFilled[r] & bit) || (rowEmpty[r] & bit)) cnt++;
      }
    }
    return cnt;
  };
  const lineSolvablePercent = Math.round((100 * determinedCells()) / (n * m));

  const solutions = [];
  let nodes = 0;
  let truncated = false;
  let timedOut = false;

  const search = () => {
    if (timedOut || truncated) return;
    nodes++;
    if ((nodes & 255) === 0 && elapsed() > timeBudgetMs) {
      timedOut = true;
      return;
    }

    // Complete? (state is consistent because propagate() ended without a
    // contradiction, so rows determined ⇔ all cells determined)
    let complete = true;
    for (let r = 0; r < m; r++) {
      if ((rowFilled[r] | rowEmpty[r]) !== FULL(n)) {
        complete = false;
        break;
      }
    }
    if (complete) {
      if (matchesClues(rowFilled, n, m, rowClues, colClues)) {
        if (solutions.length < maxSolutions) solutions.push(rowFilled.slice());
        else truncated = true;
      }
      return;
    }

    // Choose the line with the fewest remaining completions (>= 2).
    let best = null; // { kind: 'row'|'col', idx, v: BigInt[]|null }
    for (let r = 0; r < m; r++) {
      if (rowMasks[r] === null) continue;
      const v = validMasks(rowMasks[r], rowFilled[r], rowEmpty[r]);
      if (v.length >= 2 && (best === null || v.length < best.v.length)) {
        best = { kind: 'row', idx: r, v };
      }
    }
    for (let c = 0; c < n; c++) {
      if (colMasks[c] === null) continue;
      const v = validMasks(colMasks[c], colFilled[c], colEmpty[c]);
      if (v.length >= 2 && (best === null || v.length < best.v.length)) {
        best = { kind: 'col', idx: c, v };
      }
    }

    const cells = [];
    if (best !== null) {
      const len = best.kind === 'row' ? n : m;
      const f = best.kind === 'row' ? rowFilled[best.idx] : colFilled[best.idx];
      const e = best.kind === 'row' ? rowEmpty[best.idx] : colEmpty[best.idx];
      for (let i = 0; i < len; i++) {
        const bit = 1n << BigInt(i);
        if (!(f & bit) && !(e & bit)) cells.push(i);
      }
    } else {
      // Every non-null line is determined yet the grid is not complete: only
      // possible with truncated (null) lines. Take any undecided cell.
      outer: for (let r = 0; r < m; r++) {
        for (let c = 0; c < n; c++) {
          const bit = 1n << BigInt(c);
          if (!(rowFilled[r] & bit) && !(rowEmpty[r] & bit)) {
            best = { kind: 'row', idx: r, v: null };
            cells.push(c);
            break outer;
          }
        }
      }
    }
    if (cells.length === 0) return; // should not happen

    // Among the candidates, branch on the cell whose crossing line is most
    // constrained; tie-break by how lopsided the completions' votes are.
    const crossCount = (i) => {
      if (best.kind === 'row') {
        if (colMasks[i] === null) return Infinity;
        return validMasks(colMasks[i], colFilled[i], colEmpty[i]).length;
      }
      if (rowMasks[i] === null) return Infinity;
      return validMasks(rowMasks[i], rowFilled[i], rowEmpty[i]).length;
    };
    let bestCell = cells[0];
    let bestCross = Infinity;
    let bestSkew = -1;
    for (const i of cells) {
      const cross = crossCount(i);
      if (cross > bestCross) continue;
      let skew = 0;
      if (best.v !== null) {
        let ones = 0;
        // Bit of cell i inside the line's mask: 1<<i works for rows; for a
        // column line the mask is indexed by row, so the bit is 1<<idx.
        const bit = best.kind === 'row' ? 1n << BigInt(i) : 1n << BigInt(best.idx);
        for (const mk of best.v) if (mk & bit) ones++;
        skew = Math.abs(2 * ones - best.v.length);
      }
      if (cross < bestCross || skew > bestSkew) {
        bestCross = cross;
        bestSkew = skew;
        bestCell = i;
      }
    }

    const r = best.kind === 'row' ? best.idx : bestCell;
    const c = best.kind === 'row' ? bestCell : best.idx;
    const bitR = 1n << BigInt(c);
    const bitC = 1n << BigInt(r);
    const saved = [rowFilled.slice(), rowEmpty.slice(), colFilled.slice(), colEmpty.slice()];
    const restore = () => {
      for (let i = 0; i < m; i++) {
        rowFilled[i] = saved[0][i];
        rowEmpty[i] = saved[1][i];
      }
      for (let i = 0; i < n; i++) {
        colFilled[i] = saved[2][i];
        colEmpty[i] = saved[3][i];
      }
    };
    const tryValue = (value) => {
      if (value) {
        rowFilled[r] |= bitR;
        colFilled[c] |= bitC;
      } else {
        rowEmpty[r] |= bitR;
        colEmpty[c] |= bitC;
      }
      if (propagate()) search();
    };

    // Try the value supported by more completions first.
    // Same bit-index rule as the skew votes above.
    const voteBit2 = best.kind === 'row' ? bitR : bitC;
    let ones = null;
    if (best.v !== null) {
      let cnt = 0;
      for (const mk of best.v) if (mk & voteBit2) cnt++;
      ones = cnt;
    }
    if (ones !== null && ones * 2 < best.v.length) {
      tryValue(0);
      restore();
      tryValue(1);
    } else {
      tryValue(1);
      restore();
      tryValue(0);
    }
  };

  search();

  return {
    solutions,
    count: solutions.length,
    truncated,
    timedOut,
    nodes,
    lineSolvablePercent,
    elapsedMs: elapsed(),
  };
}

// ---------------------------------------------------------------------------
// CLI: node solver.js <puzzle.json|puzzle.txt> [--max N] [--show N]
//                [--time-ms N] [--json]
// ---------------------------------------------------------------------------
const HELP = `Usage: node solver.js <file> [options]

Solves a nonogram and enumerates ALL its solutions (exact counts).

<file>  puzzle as JSON (generator output, or {"width","height","rowClues",
        "colClues"}) or plain text:
          line 1: "W H"
          next H lines: row clues, space-separated ("0" or blank = empty row)
          next W lines: column clues

Options:
  --max N      stop counting after N solutions (default 1000000)
  --show N     print the first N solution grids (default 10)
  --time-ms N  give up after N ms (count may be incomplete)
  --json       also print a machine-readable result
  --help       this text`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file || args.help) {
    console.log(HELP);
    return;
  }
  const puzzle = parsePuzzle(readFileSync(file, 'utf8'));
  const res = solvePuzzle(puzzle, {
    maxSolutions: args.max ?? 1_000_000,
    timeBudgetMs: args['time-ms'] ?? Infinity,
  });

  const clueLine = (clues) => (clues.length ? clues.join(' ') : '0');
  console.log(`${puzzle.width}x${puzzle.height} puzzle (${file})`);
  console.log('row clues: ' + puzzle.rowClues.map(clueLine).join(' | '));
  console.log('col clues: ' + puzzle.colClues.map(clueLine).join(' | '));
  console.log('');

  const show = args.show ?? 10;
  for (let i = 0; i < Math.min(res.solutions.length, show); i++) {
    console.log(`solution #${i + 1}:`);
    console.log(renderGrid(res.solutions[i], puzzle.width));
    console.log('');
  }
  let countStr = res.truncated ? `>= ${res.count}` : String(res.count);
  if (res.timedOut) countStr += ' (timed out — count incomplete)';
  console.log(
    `total solutions: ${countStr}  ·  ${res.elapsedMs} ms  ·  ${res.nodes} branch nodes  ·  ` +
      `${res.lineSolvablePercent}% cells line-solvable`
  );

  if (args.json) {
    console.log(
      JSON.stringify({
        puzzle,
        count: res.count,
        truncated: res.truncated,
        timedOut: res.timedOut,
        elapsedMs: res.elapsedMs,
        nodes: res.nodes,
        lineSolvablePercent: res.lineSolvablePercent,
        solutions: res.solutions.map((s) =>
          Array.from({ length: puzzle.height }, (_, r) =>
            Array.from({ length: puzzle.width }, (_, c) => Number((s[r] >> BigInt(c)) & 1n))
          )
        ),
      })
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
