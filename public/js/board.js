// Board setup: empty-grid construction plus the no-guess board generator.
// Mine placement uses a smooth value-noise density field (organic,
// classic Windows-like feel) with local anti-clutter inhibition so mines
// spread out instead of bunching. Candidates are validated with the solver
// (solver.js) and must open 26-39 cells on first click (see config.js);
// the repair step swaps mines locally along the solver's stuck frontier
// while preserving that opening.

function initGrid() {
  grid = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      question: false,
      adjacent: 0,
    }))
  );
  $grid.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cellEl = document.createElement('div');
      cellEl.classList.add('cell');
      cellEl.dataset.r = r;
      cellEl.dataset.c = c;
      cellEl.addEventListener('click', onCellClick);
      cellEl.addEventListener('dblclick', e => {
        e.preventDefault();
        onCellDoubleClick(e);
      });
      cellEl.addEventListener('contextmenu', onCellRightClick);
      // Track last hovered cell for keyboard shortcuts
      cellEl.addEventListener('mouseover', () => {
        lastR = r;
        lastC = c;
      });
      $grid.appendChild(cellEl);
    }
  }
  flagsLeft = MINES;
  setMinesLeft(flagsLeft);
  revealedCount = 0;
  firstClick = true;
  clearInterval(timerInterval);
  setTimer(0);
  updateStatusEmoji('default');
}

function computeAdjacents() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].mine) {
        grid[r][c].adjacent = 0;
        continue;
      }
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc].mine) {
            count++;
          }
        }
      }
      grid[r][c].adjacent = count;
    }
  }
}

function inSafetyZone(r, c, excludeR, excludeC) {
  return Math.abs(r - excludeR) <= 1 && Math.abs(c - excludeC) <= 1;
}

// Seeded PRNG (mulberry32) so each placement attempt gets its own noise field.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value-noise field over the board: a coarse random lattice (one value
// per STEP cells) with bilinear smoothstep interpolation. Fresh lattice per
// attempt via the passed rng, giving organic density variation like classic
// Windows boards but without pure-random clumping.
function makeMineNoise(rand) {
  const STEP = 5;
  const gw = Math.ceil(COLS / STEP) + 2;
  const gh = Math.ceil(ROWS / STEP) + 2;
  const lat = [];
  for (let y = 0; y < gh; y++) {
    lat.push([]);
    for (let x = 0; x < gw; x++) lat[y].push(rand());
  }
  const smooth = function (t) { return t * t * (3 - 2 * t); };
  return function (r, c) {
    const x = c / STEP;
    const y = r / STEP;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = lat[y0][x0];
    const b = lat[y0][x0 + 1];
    const d = lat[y0 + 1][x0];
    const e = lat[y0 + 1][x0 + 1];
    return a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy;
  };
}

// Noise-modulated, decluttered placement: mines are drawn one at a time with
// probability shaped by the noise field, while cells neighbouring already
// placed mines are strongly down-weighted so mines spread out instead of
// cluttering. The safety zone around the first click stays mine-free and the
// exact MINES count is always placed.
function placeMinesNoise(excludeR, excludeC, seed) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      grid[r][c].mine = false;
    }
  }
  const rand = mulberry32(seed);
  const noiseAt = makeMineNoise(rand);
  const base = [];
  const adjMines = [];
  const weights = [];
  for (let r = 0; r < ROWS; r++) {
    base.push([]);
    adjMines.push([]);
    weights.push([]);
    for (let c = 0; c < COLS; c++) {
      base[r].push(0.3 + 0.7 * noiseAt(r, c));
      adjMines[r].push(0);
      weights[r].push(0);
    }
  }
  const bump = function (r, c, d) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) adjMines[nr][nc] += d;
      }
    }
  };
  for (let placed = 0; placed < MINES; placed++) {
    let total = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c].mine || inSafetyZone(r, c, excludeR, excludeC)) {
          weights[r][c] = 0;
          continue;
        }
        const w = base[r][c] / (1 + 1.2 * adjMines[r][c]);
        weights[r][c] = w;
        total += w;
      }
    }
    if (total <= 0) break; // unreachable: far more eligible cells than mines
    let pick = rand() * total;
    let pr = 0;
    let pc = 0;
    outer:
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        pick -= weights[r][c];
        if (pick <= 0) {
          pr = r;
          pc = c;
          break outer;
        }
      }
    }
    grid[pr][pc].mine = true;
    bump(pr, pc, 1);
  }
}

// Flood-fill from the first click over safe cells, mirroring revealCell:
// expands through zero-adjacent cells, stops at numbers. Returns the boolean
// grid of the opening (exactly the cells the first click would reveal).
function computeOpeningSet(startR, startC) {
  const seen = [];
  for (let r = 0; r < ROWS; r++) {
    seen.push([]);
    for (let c = 0; c < COLS; c++) seen[r].push(false);
  }
  const stack = [{ r: startR, c: startC }];
  while (stack.length > 0) {
    const cur = stack.pop();
    const r = cur.r;
    const c = cur.c;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    if (seen[r][c] || grid[r][c].mine) continue;
    seen[r][c] = true;
    if (grid[r][c].adjacent === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          stack.push({ r: r + dr, c: c + dc });
        }
      }
    }
  }
  return seen;
}

function openingSize(opening) {
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (opening[r][c]) n++;
    }
  }
  return n;
}

function openingInRange(n) {
  return n >= OPENING_MIN_CELLS && n <= OPENING_MAX_CELLS;
}

function snapshotMines() {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].mine) out.push([r, c]);
    }
  }
  return out;
}

function restoreMines(coords) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) grid[r][c].mine = false;
  }
  for (let i = 0; i < coords.length; i++) {
    grid[coords[i][0]][coords[i][1]].mine = true;
  }
}

/*
 * No-Guess Board Generator, Windows-style placement.
 * 1. Placement: noise-modulated density with anti-clutter inhibition and a
 *    fresh random seed per attempt. A candidate is INVALID unless the
 *    first-click opening holds OPENING_MIN_CELLS..OPENING_MAX_CELLS cells —
 *    invalid boards are discarded and placement retried (closest candidate
 *    kept as a fallback so generation always terminates quickly).
 * 2. Repair: while the logical solver is stuck, swap one mine between two
 *    frontier cells (covered cells touching a revealed number) so the fix
 *    stays local to the ambiguity. Moves preserve the validated opening
 *    exactly — sources that would zero an opening boundary number are
 *    skipped — and uniform picks preserve the placement's decluttered
 *    spread instead of piling mines into the opposite corner.
 */
function generateBoardSafe(excludeR, excludeC, seed) {
  const MAX_PLACEMENT_ATTEMPTS = 60;
  const MAX_REPAIRS = 200;
  const TIME_BUDGET_MS = 2500;
  const t0 = Date.now();
  const seeded = Number.isInteger(seed);
  // Deterministic RNG for seeded (multiplayer) boards so both peers build
  // the identical mine layout from the shared seed. Unseeded solo boards
  // keep the original Math.random() behaviour.
  const seededRng = seeded ? mulberry32(seed >>> 0) : null;
  const nextRandom = seededRng ? () => seededRng() : Math.random;

  let bestMines = null;
  let bestMiss = Infinity;
  let placed = false;
  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    const attemptSeed = seeded
      ? ((nextRandom() * 0x7fffffff) | 0)
      : ((Math.random() * 0x7fffffff) | 0);
    placeMinesNoise(excludeR, excludeC, attemptSeed);
    computeAdjacents();
    const size = openingSize(computeOpeningSet(excludeR, excludeC));
    if (openingInRange(size)) {
      placed = true;
      bestMines = null;
      break;
    }
    const miss = size < OPENING_MIN_CELLS
      ? OPENING_MIN_CELLS - size
      : size - OPENING_MAX_CELLS;
    if (miss < bestMiss) {
      bestMiss = miss;
      bestMines = snapshotMines();
    }
    if (!seeded && Date.now() - t0 > TIME_BUDGET_MS) break;
  }
  if (!placed) {
    if (bestMines) restoreMines(bestMines);
    computeAdjacents();
    console.warn('No in-range first-click opening found; using closest candidate.');
  }

  // Opening set to preserve exactly through the repair step below.
  const opening = computeOpeningSet(excludeR, excludeC);

  for (let attempt = 0; attempt < MAX_REPAIRS; attempt++) {
    const analysis = analyzeBoard(grid, excludeR, excludeC);
    if (analysis.solved) {
      return; // board accepted: fully deducible without guessing
    }
    if (!seeded && Date.now() - t0 > TIME_BUDGET_MS) break;

    // Repair: swap one mine between two *frontier* cells (covered cells
    // touching a revealed number) so the fix stays local to where the
    // solver is stuck. Moving mines between arbitrary covered cells with a
    // low-adjacent destination bias drained mines away from the frontier
    // and piled them up in the opposite corner from the first click, so
    // both pools are frontier-restricted (with a global uniform fallback
    // for the rare empty-frontier iteration). Sources exclude the safety
    // zone; destinations must also avoid it.
    const revealed = analysis.revealed;
    const isFrontier = function (r, c) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          if (revealed[nr][nc] && grid[nr][nc].adjacent > 0) return true;
        }
      }
      return false;
    };
    const sources = [];
    const destinations = [];
    const fallbackSources = [];
    const fallbackDestinations = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (revealed[r][c]) continue;
        if (inSafetyZone(r, c, excludeR, excludeC)) continue;
        if (grid[r][c].mine) {
          // Skip sources whose removal would zero an opening boundary
          // number (that would grow the validated opening).
          let zeroesOpening = false;
          for (let dr = -1; dr <= 1 && !zeroesOpening; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr;
              const nc = c + dc;
              if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
              if (opening[nr][nc] && !grid[nr][nc].mine && grid[nr][nc].adjacent === 1) {
                zeroesOpening = true;
                break;
              }
            }
          }
          if (!zeroesOpening) {
            fallbackSources.push({ r, c });
            if (isFrontier(r, c)) sources.push({ r, c });
          }
        } else {
          fallbackDestinations.push({ r, c });
          if (isFrontier(r, c)) destinations.push({ r, c });
        }
      }
    }
    // Prefer local frontier swaps; fall back to the global covered pools
    // (uniform pick, no drift) only when the frontier has no eligible mine
    // or no free cell.
    const srcPool = sources.length > 0 ? sources : fallbackSources;
    const dstPool = destinations.length > 0 ? destinations : fallbackDestinations;
    if (srcPool.length === 0 || dstPool.length === 0) break;
    const s = srcPool[(nextRandom() * srcPool.length) | 0];
    // Uniform pick: preserves the placement's decluttered spread instead of
    // dragging mines toward one corner of the board.
    const d = dstPool[(nextRandom() * dstPool.length) | 0];
    grid[s.r][s.c].mine = false;
    grid[d.r][d.c].mine = true;
    computeAdjacents();
  }

  // Fallback: keep the last board (still has a safe zero opening).
  // Only warn if it is genuinely still stuck, which should now be rare.
  if (!isSolvable(grid, excludeR, excludeC)) {
    console.warn('Could not repair board into a fully deducible one; using last board.');
  }
}
