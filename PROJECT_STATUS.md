# Project status

Reviewed 2026-09-05. This repository is the standalone browser game and CLI;
the companion `nonograms-study` repository contains the research work.

## Done

- Browser page with size/style/difficulty controls, fill/mark mode, check, clear,
  clue completion and a solved banner. The committed bundle contains the local
  generator and solver; no service or external package is needed to play.
- Seeded structured-picture generation, clue derivation, bounded attempts and
  exhaustive solution-count verification. Accepted puzzles meet the requested
  fill bounds and include the intended picture among the verified solutions.
- Ported the study repository's blank-clue parsing, column branching vote,
  untruncated-acceptance and post-edit fill-bound fixes. Preserved the game's
  Easy API default; aligned the small-grid CLI default with its help text.
- Guarded Check/Clear before the first puzzle exists and display a retry
  message if generation throws.
- Added `npm test`, deterministic exhaustive small-grid checks, a failing-old-
  behavior density regression, and a non-mutating bundle freshness check.
- Rebuilt `bundle.js`. Documented the flat source layout and corrected claims
  about guaranteed convergence, human difficulty and strict reproducibility.

## Verification

- `npm test`: **26 tests passed**. Exact solver solution sets checked against
  all 1,024 binary grids across 3×3, 2×4 and 4×2; includes ambiguity, impossible
  clues, empty clues, solution caps, parser boundaries and line-enumeration caps.
- Generated 24 seeded puzzles across sizes 5–15 and a puzzle for each of the
  five picture styles; re-solved each and verified uniqueness and fill bounds.
- Density regression: 5×5 seed 16 previously returned fill 0.36 with minimum
  0.40; it is now rejected when only one starting image is allowed.
- Bundle executes without Node globals and matches source generation for the
  same 10×10 seed. `node build.js --check` confirms source/bundle parity.
- CLI smoke: generated 5×5 seed 42 and independently re-solved its saved JSON
  to exactly one solution. Smoke output was kept outside the repository.
- All five browser sizes (10, 15, 20, 25 and 30) generated with seed 42 and the
  browser's Easy-through-Hard filter, then re-solved to exactly one solution.
  Generation took 11–1,344 ms in this run; these are examples, not speed bounds.

## Outstanding / deferred

- Full visual and interaction verification is still needed. A sandboxed Chrome
  launch failed, and the connected browser explicitly blocked the local-file
  URL under its URL policy. Browser workarounds were not attempted after that
  rejection; the automated bundle check is the available integration evidence.
- Move generation to a Web Worker and add cancellation for responsive play.
  Searches run on the main thread; solver time checks are periodic, so the
  nominal time budget is not a hard deadline.
- Calibrate difficulty with human solving techniques or player data. The
  current label depends on this solver's branching order and grid size;
  `lineSolvablePercent` does not currently affect the classification.
- Rival-flip repair has no convergence guarantee; restrictive selections can
  return no puzzle. This is handled as a normal generation failure.
- Keyboard/touch accessibility, narrow-screen layout, saved progress and a
  permanent browser end-to-end suite remain future work. Desktop mouse controls
  are the implemented interface; no persistence or puzzle-sharing UI exists.
- Add stricter validation for malformed API/CLI clues and option values. Current
  regression coverage concerns well-formed puzzles plus basic text-header and
  missing-record errors, not every invalid-input combination.

No mathematical research claims are established by this game. Related proof
questions and their evidence belong in the companion research repository.
