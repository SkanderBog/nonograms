// core.js — shared helpers for the Nonograms project (no dependencies).
//
// Data model
//   puzzle  = { width, height, rowClues: number[][], colClues: number[][] }
//   grid    = BigInt[] — one bitmask per row; bit c of row r is cell (r, c);
//             a set bit means the cell is FILLED.
//
// BigInt bitmasks are used so lines are not limited to 32/53 bits.

// Mask with the low `n` bits set.
export function FULL(n) {
  return (1n << BigInt(n)) - 1n;
}

// Number of set bits in a mask.
export function popcount(mask) {
  let c = 0;
  while (mask) {
    mask &= mask - 1n;
    c++;
  }
  return c;
}

// Deterministic PRNG (mulberry32) so --seed results are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Clues of a single line given as a bitmask of its filled cells.
export function lineClues(mask, n) {
  const clues = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    if ((mask >> BigInt(i)) & 1n) {
      run++;
    } else if (run) {
      clues.push(run);
      run = 0;
    }
  }
  if (run) clues.push(run);
  return clues;
}

// Row and column clues of a whole grid.
export function cluesFromGrid(rows, width, height) {
  const rowClues = rows.map((r) => lineClues(r, width));
  const colClues = [];
  for (let c = 0; c < width; c++) {
    let mask = 0n;
    for (let r = 0; r < height; r++) {
      if ((rows[r] >> BigInt(c)) & 1n) mask |= 1n << BigInt(r);
    }
    colClues.push(lineClues(mask, height));
  }
  return { rowClues, colClues };
}

// Does a grid satisfy a set of clues exactly?
export function matchesClues(rows, width, height, rowClues, colClues) {
  for (let r = 0; r < height; r++) {
    const a = lineClues(rows[r], width);
    if (a.length !== rowClues[r].length || a.some((v, i) => v !== rowClues[r][i])) return false;
  }
  for (let c = 0; c < width; c++) {
    let mask = 0n;
    for (let r = 0; r < height; r++) {
      if ((rows[r] >> BigInt(c)) & 1n) mask |= 1n << BigInt(r);
    }
    const a = lineClues(mask, height);
    if (a.length !== colClues[c].length || a.some((v, i) => v !== colClues[c][i])) return false;
  }
  return true;
}

// All completions of a line of length n matching `clues` and consistent with
// `filled` / `empty` (bitmasks of cells already known to be filled / empty).
// Returns { masks: BigInt[], truncated } — `truncated` means the list hit the
// cap and is incomplete (callers treat that line as unconstrained).
export function lineMasks(n, clues, filled = 0n, empty = 0n, cap = 20000) {
  const k = clues.length;
  if (k === 0) {
    return { masks: filled === 0n ? [0n] : [], truncated: false };
  }
  // rest[i] = minimum span needed to place blocks i..k-1
  const rest = new Array(k + 1).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    rest[i] = clues[i] + (i < k - 1 ? 1 : 0) + rest[i + 1];
  }
  const masks = [];
  let truncated = false;

  const rec = (idx, pos, mask) => {
    if (truncated) return;
    if (idx === k) {
      if ((mask & filled) === filled && (mask & empty) === 0n) {
        if (masks.length === cap) {
          truncated = true;
          return;
        }
        masks.push(mask);
      }
      return;
    }
    const len = clues[idx];
    const maxPos = n - rest[idx];
    for (let s = pos; s <= maxPos; s++) {
      // cells pos..s-1 form the gap after the previous block and must be empty
      if ((FULL(s) & ~FULL(pos)) & filled) continue;
      const block = FULL(len) << BigInt(s);
      if (block & empty) continue; // block must not cover a known-empty cell
      rec(idx + 1, s + len + 1, mask | block);
    }
  };
  rec(0, 0, 0n);
  return { masks, truncated };
}

// Bitmask rows from a 2D 0/1 array.
export function rowsFromArrays(grid, width) {
  return grid.map((row) => {
    let m = 0n;
    for (let c = 0; c < width; c++) if (row[c]) m |= 1n << BigInt(c);
    return m;
  });
}

// 2D 0/1 array from bitmask rows.
export function rowsToArrays(rows, width) {
  return rows.map((row) => {
    const a = [];
    for (let c = 0; c < width; c++) a.push((row >> BigInt(c)) & 1n ? 1 : 0);
    return a;
  });
}

// ASCII rendering of a grid ('#' filled, '.' empty).
export function renderGrid(rows, width) {
  return rows
    .map((row) => {
      let s = '';
      for (let c = 0; c < width; c++) s += (row >> BigInt(c)) & 1n ? '#' : '.';
      return s;
    })
    .join('\n');
}

// Plain-text puzzle format:
//   line 1:      "<width> <height>"
//   next height: row clues, space separated ("0" or blank = empty line)
//   next width:  column clues, space separated
// Lines starting with '#' are comments.
export function parseTextPuzzle(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  const head = lines[0].split(/\s+/).map(Number);
  const width = head[0];
  const height = head[1];
  const readClues = (line) =>
    line === undefined || line === '' ? [] : line.split(/\s+/).map(Number).filter((v) => v > 0);
  const rowClues = [];
  for (let r = 0; r < height; r++) rowClues.push(readClues(lines[1 + r]));
  const colClues = [];
  for (let c = 0; c < width; c++) colClues.push(readClues(lines[1 + height + c]));
  return { width, height, rowClues, colClues };
}

// Accepts either the JSON written by generator.js or plain text (see above).
export function parsePuzzle(text) {
  const t = text.trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    const rowClues = j.rowClues ?? j.clues?.rows ?? j.rows;
    const colClues = j.colClues ?? j.clues?.cols ?? j.cols;
    return {
      width: j.width ?? colClues.length,
      height: j.height ?? rowClues.length,
      rowClues,
      colClues,
    };
  }
  return parseTextPuzzle(t);
}

// Minimal --flag parsing shared by the CLIs.
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = /^\d+$/.test(next) ? Number(next) : next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}
