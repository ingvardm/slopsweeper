// Board setup: empty-grid construction plus the no-guess board generator.
// Mine placement uses uniform random sampling via Fisher-Yates shuffle,
// excluding the first-click safety zone. Boards are validated for
// opening size and solvability via the solver (solver.js).

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
  viewingMode = false;
  viewedGameState = null;
}

function clearCellDOM(cellEl, r, c) {
  const glyphs = ['bomb', 'flag', 'wrong', 'explosion'];
  glyphs.forEach(g => {
    const el = cellEl.querySelector(`.cell-${g}`);
    if (el) el.classList.remove('exploded', 'flagged');
  });
  cellEl.classList.remove('revealed', 'flagged', 'questioned', 'preview');
  cellEl.dataset.glyph = '';
  cellEl.dataset.num = '';
  for (let i = cellEl.childNodes.length - 1; i >= 0; i--) {
    if (cellEl.childNodes[i].nodeType === 3) cellEl.childNodes[i].remove();
  }
  const questionEl = cellEl.querySelector('.cell-question');
  if (questionEl) questionEl.classList.remove('questioned');
  const flagEl = cellEl.querySelector('.cell-flag');
  if (flagEl) flagEl.classList.remove('flagged');
  const explosionEl = cellEl.querySelector('.cell-explosion');
  if (explosionEl) explosionEl.classList.remove('exploded');
}

function setCellNumber(cellEl, num) {
  cellEl.classList.add('revealed');
  cellEl.dataset.num = String(num);
  for (let i = cellEl.childNodes.length - 1; i >= 0; i--) {
    if (cellEl.childNodes[i].nodeType === 3) cellEl.childNodes[i].remove();
  }
  cellEl.appendChild(document.createTextNode(num));
}

function restoreBoardState(state) {
  try {
    grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => ({
        mine: false,
        revealed: false,
        flagged: false,
        question: false,
        adjacent: 0,
      }))
    );

    state.mines.forEach(([r, c]) => { grid[r][c].mine = true; });
    computeAdjacents();
    state.revealed.forEach(([r, c]) => { grid[r][c].revealed = true; });
    state.flagged.forEach(([r, c]) => { grid[r][c].flagged = true; });
    state.questions.forEach(([r, c]) => { grid[r][c].question = true; });

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
        cellEl.addEventListener('mouseover', () => {
          lastR = r;
          lastC = c;
        });

        const cell = grid[r][c];
        if (cell.mine) {
          cellEl.dataset.glyph = 'bomb';
        }
        if (cell.revealed) {
          if (cell.mine) {
            cellEl.dataset.glyph = 'bomb';
          } else if (cell.adjacent > 0) {
            setCellNumber(cellEl, cell.adjacent);
          }
          cellEl.classList.add('revealed');
        }
        if (cell.flagged) {
          cellEl.classList.add('flagged');
          flagEl.classList.add('flagged');
        }
        if (cell.question) {
          cellEl.classList.add('questioned');
          questionEl.classList.add('questioned');
        }

        $grid.appendChild(cellEl);
      }
    }

    flagsLeft = MINES - state.flagged.length;
    setMinesLeft(flagsLeft);
    revealedCount = state.revealed.length;
    setTimer(state.time || 0);
    viewingMode = true;
    viewedGameState = state;
    viewedTime = state.time || 0;
    updateStatusEmoji('view');
  } catch (e) {
    console.error('restoreBoardState failed:', e);
  }
}

function resetViewingMode() {
  viewingMode = false;
  viewedGameState = null;
  viewedTime = 0;
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

// Fisher-Yates shuffle: produce a uniformly random permutation of candidates,
// then place mines at the first MINES positions. Excludes the 3×3 safety
// zone around the first click.
function placeMinesRandom(excludeR, excludeC) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      grid[r][c].mine = false;

  const candidates = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (!inSafetyZone(r, c, excludeR, excludeC))
        candidates.push([r, c]);

  // Fisher-Yates shuffle in place
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  for (let i = 0; i < MINES; i++) {
    const [r, c] = candidates[i];
    grid[r][c].mine = true;
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
 * No-Guess Board Generator.
 * 1. Place mines uniformly at random via Fisher-Yates shuffle,
 *    excluding the 3x3 safety zone around the first click.
 * 2. Validate opening size (26-39 cells revealed on first click).
 * 3. Validate solvability via the constraint-propagation solver.
 * 4. Reject and regenerate if either check fails.
 *
 * This generator NEVER returns an unsolvable board. It keeps trying
 * until a solvable board is found.
 */
function generateBoardSafe(excludeR, excludeC) {
  let attempt = 0;
  while (true) {
    attempt++;
    placeMinesRandom(excludeR, excludeC);
    computeAdjacents();

    const opening = computeOpeningSet(excludeR, excludeC);
    const size = openingSize(opening);

    // Opening must be large enough to give the player information
    if (!openingInRange(size)) continue;

    // Board must be solvable without guessing
    if (isSolvable(grid, excludeR, excludeC)) return;

    // Safety: prevent infinite loop in extremely unlikely edge case
    if (attempt > 10000) {
      throw new Error(`generateBoardSafe: could not find solvable board after ${attempt} attempts`);
    }
  }
}
