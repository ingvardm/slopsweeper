// Board setup: empty-grid construction plus the board generator.
//
// Mine placement uses uniform random sampling via Fisher-Yates shuffle,
// excluding the first-click safety zone (see exclusionZoneSize in config.js).
// No-guess boards are additionally validated for opening size and
// solvability via the solver (solver.js).
//
// The exclusion-set placement model and the difficulty/size model are adapted
// from JSMinesweeper by David N Hill (MIT) — see THIRD-PARTY-NOTICES.md.

function initGrid() {
  syncBoardCssVars();
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
      const flagEl = document.createElement('span');
      flagEl.classList.add('cell-flag');
      flagEl.textContent = getThemeGlyph('flag');
      cellEl.appendChild(flagEl);
      const questionEl = document.createElement('span');
      questionEl.classList.add('cell-question');
      questionEl.textContent = getThemeGlyph('question');
      cellEl.appendChild(questionEl);
      const explosionEl = document.createElement('span');
      explosionEl.classList.add('cell-explosion');
      explosionEl.textContent = getThemeGlyph('explosion');
      cellEl.appendChild(explosionEl);
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
  if (typeof autoRevealVisited !== 'undefined') autoRevealVisited.clear();
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

// Radius of the mine-free zone around the first click: 0 for a plain safe
// start (just the clicked cell), 1 for an "opening on start" board (the whole
// 3x3 neighbourhood). Falls back to 0 on boards too small for the 3x3 zone.
function exclusionRadius() {
  return exclusionZoneSize(COLS, ROWS, boardConfig.openOnStart) > 1 ? 1 : 0;
}

function inSafetyZone(r, c, excludeR, excludeC) {
  const radius = exclusionRadius();
  return Math.abs(r - excludeR) <= radius && Math.abs(c - excludeC) <= radius;
}

// Fisher-Yates shuffle: produce a uniformly random permutation of candidates,
// then place mines at the first MINES positions. Excludes the first-click
// safety zone, which is a single cell unless "opening on start" is enabled.
function placeMinesRandom(excludeR, excludeC) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      grid[r][c].mine = false;

  const candidates = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (!inSafetyZone(r, c, excludeR, excludeC))
        candidates.push([r, c]);

  // A very small board can leave fewer candidate cells than MINES asks for;
  // place what fits rather than reading past the end of the array.
  const count = Math.min(MINES, candidates.length);

  // Fisher-Yates shuffle in place
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  for (let i = 0; i < count; i++) {
    const [r, c] = candidates[i];
    grid[r][c].mine = true;
  }
}

// Logs why no guaranteed no-guess board could be produced. The board handed back
// is still valid, it just is not guaranteed solvable without guessing.
function warnNoGuessGaveUp(reason, candidates, elapsedMs) {
  console.warn(
    `generateBoardSafe: no verified no-guess board on ${describeBoard()} ` +
      `(${reason}; ${candidates} candidate(s), ${elapsedMs}ms) — using a random board instead.`
  );
}

/*
 * Board Generator.
 *
 * With no-guess mode on this asks the vendored JSMinesweeper engine (see
 * noguess.js) to propose a board, then keeps it only if solver.js confirms it
 * can be solved from the first click by deduction alone. Both halves matter:
 *
 * - Proposing by relocating mines is what makes dense boards possible. Searching
 *   for a good board by redrawing cannot work: on 30x30/250 no randomly placed
 *   layout is solvable by pure deduction (measured 0 of 25).
 * - Verifying separately is what makes the promise true. The engine's own model
 *   is mutated by every mine relocation, so it reaches "won" using information a
 *   player never gets; measured, 0 of 7 of its 30x16/99 and 30x30/250 boards were
 *   actually guess-free. Roughly half of its candidates pass the independent
 *   check, so a few attempts are normal.
 *
 * With no-guess mode off a single random draw is taken, so games start instantly.
 *
 * A valid board is always left on the grid. If no candidate can be verified
 * within the budget — or the board is so small that none can exist, such as
 * 2x2/1 where every cell touches every other — this falls back to a random
 * board rather than stalling the click.
 */
async function generateBoardSafe(excludeR, excludeC) {
  if (boardConfig.noGuess) {
    const deadline = Date.now() + GENERATION_BUDGET_MS;
    const startTime = deadline - GENERATION_BUDGET_MS;
    let candidates = 0;
    let lastReason = 'budget';

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      let res;
      try {
        res = await buildNoGuessCandidate({
          cols: COLS,
          rows: ROWS,
          mines: MINES,
          startR: excludeR,
          startC: excludeC,
          openOnStart: boardConfig.openOnStart,
          budgetMs: Math.min(GENERATION_CANDIDATE_BUDGET_MS, remaining),
        });
      } catch (e) {
        // Never let a fault in the vendored engine cost the player their click.
        console.warn('generateBoardSafe: no-guess generation failed, using a random board.', e);
        lastReason = 'engine error';
        break;
      }
      if (!res.ok) {
        lastReason = res.reason === 'board-limit' || res.reason === 'iteration-limit'
          ? res.reason
          : 'candidate budget';
        break;
      }
      candidates++;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          grid[r][c].mine = res.cells[r * COLS + c].mine;
        }
      }
      computeAdjacents();

      if (isSolvable(grid, excludeR, excludeC)) return true;
    }

    warnNoGuessGaveUp(lastReason, candidates, Date.now() - startTime);
  }

  placeMinesRandom(excludeR, excludeC);
  computeAdjacents();
  return false;
}
