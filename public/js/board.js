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

// Copies an engine candidate onto the grid and recomputes adjacencies. Shared by
// both generation paths, so a worker's board is laid down exactly as a
// single-threaded one is.
function applyMines(cells) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      grid[r][c].mine = cells[r * COLS + c].mine;
    }
  }
  computeAdjacents();
}

// Reshapes a flat row-major candidate into the 2D form the solver reads, without
// touching the live grid. Needed because a mood has to compare several candidate
// boards before choosing one, so the candidates cannot be laid down as they
// arrive the way the single-board path does.
function candidateToGrid(cells) {
  const out = new Array(ROWS);
  for (let r = 0; r < ROWS; r++) {
    const row = new Array(COLS);
    for (let c = 0; c < COLS; c++) row[c] = cells[r * COLS + c];
    out[r] = row;
  }
  return out;
}

/**
 * Verify a candidate and report how hard it is, in one solve.
 *
 * Returns { difficulty } for a board that is solvable by deduction alone, or null
 * for one that is not — the same accept/reject decision the single-board path
 * makes, since it is the same solver. This runs on the main thread, which is why
 * the worker path does it inside the worker instead.
 */
function assessCandidate(cells, excludeR, excludeC) {
  const result = solveWithDifficulty(candidateToGrid(cells), excludeR, excludeC);
  if (!result.solved) return null;
  return { cells, difficulty: result.difficulty };
}

/** Whether a difficulty tally clears a mood's minimum for each tier. */
function moodQualifies(difficulty, spec) {
  if (spec.minSophisticated > 0 && countAtLeastTier(difficulty, 'sophisticated') < spec.minSophisticated) {
    return false;
  }
  if (spec.minTopTier > 0 && countAtLeastTier(difficulty, 'top-tier') < spec.minTopTier) {
    return false;
  }
  return true;
}

/**
 * Choose which of the collected boards to play, per the mood's pick rule.
 *
 * 'first' takes them in arrival order and is deliberately not a sort: Normal must
 * cost nothing over the old behaviour, which played whatever verified first.
 * 'second' and 'max' sort by score, and 'second' returns the median of a
 * three-board batch so that neither the softest nor the nastiest board of the
 * batch is the one that gets played.
 */
function selectByMood(collected, spec) {
  if (spec.pick === 'first') return collected[0];
  const byScore = collected.slice().sort((a, b) => a.difficulty.score - b.difficulty.score);
  if (spec.pick === 'second') return byScore[Math.floor((byScore.length - 1) / 2)];
  return byScore[byScore.length - 1];
}

/** Generation budget for a mood: collecting N boards is N times the work. */
function moodBudgetMs(spec) {
  return GENERATION_BUDGET_MS * Math.max(1, spec.budgetFactor || 1);
}

/**
 * Tell the player how hard the board they were just handed is, and which
 * deductions it took. Logged rather than shown on the board: the board is the
 * game, and a difficulty badge in the corner of a Windows 98 window is a design
 * decision nobody asked for. The numbers are the same ones the mood used to
 * choose the board, so what is reported is what was actually required.
 */
function reportBoardDifficulty(difficulty, spec) {
  if (!difficulty) return;
  const techniques = (difficulty.used || []).join(', ');
  const line =
    `generateBoardSafe: ${spec.label} mood -> difficulty ${difficulty.score} ` +
    `(${difficulty.percent}% non-basic of ${difficulty.moves} deductions); ` +
    `tiers: ${difficulty.summary}; techniques: ${techniques}`;
  if (spec.label === 'Normal') {
    // Normal is the default and by far the most common case, so it stays quiet
    // unless the board is actually hard, in which case it is worth knowing.
    if (difficulty.tiers.sophisticated === 0 && difficulty.tiers['top-tier'] === 0) return;
    console.info(line);
    return;
  }
  console.info(line);
}


// Workers to race, and whether to race them at all. Multi-threaded generation
// only means anything alongside no-guess boards — with no-guess off a board is a
// single random draw and there is nothing to parallelise. The Worker check keeps
// the single-threaded path as the fallback wherever workers are unavailable.
function generationWorkerCount() {
  return Math.max(1, Math.min(MAX_GENERATION_WORKERS, Math.floor(Number(boardConfig.workerCount)) || 1));
}

function useWorkerGeneration() {
  // `!== 'undefined'` rather than `=== 'function'`: Worker is a constructor
  // function in every engine that has it, but there is no reason to insist on
  // that when all we need is for it to exist.
  return boardConfig.noGuess && boardConfig.multiThreaded && typeof Worker !== 'undefined';
}

/**
 * Races generationWorkerCount() workers, each building and verifying its own
 * candidate, and takes the first board that passes — or, for a mood above Normal,
 * keeps collecting until it has enough qualifying boards to choose between.
 *
 * A worker only reports success after the independent solver has confirmed the
 * board and measured its difficulty, so the result is used as-is. It is our own
 * same-origin code doing that check, so the main thread does not repeat it —
 * re-verifying here would block the main thread for exactly as long as the work
 * was worth moving off it.
 *
 * Once the batch is decided the whole field is torn down, winners included: an
 * abandoned search is real CPU the browser is still spending, and for a mood that
 * means the workers that are no longer needed.
 *
 * Resolves true if a verified board was applied, false if the search ran out and
 * a random board was used instead. Never rejects.
 */
function generateBoardInWorkers(excludeR, excludeC, spec) {
  const count = generationWorkerCount();
  // A null spec is a preset: no mood, so no batch, no minimum for the workers
  // and no difficulty to report. The first board to arrive wins, exactly as it
  // did before the mood feature existed.
  const mooded = spec !== null;
  const required = mooded ? spec.required : 1;
  const budget = mooded ? moodBudgetMs(spec) : GENERATION_BUDGET_MS;
  const startTime = Date.now();
  const deadline = startTime + budget;
  const request = {
    type: 'generate',
    cols: COLS,
    rows: ROWS,
    mines: MINES,
    startR: excludeR,
    startC: excludeC,
    openOnStart: boardConfig.openOnStart,
    budgetMs: budget,
    candidateBudgetMs: GENERATION_CANDIDATE_BUDGET_MS,
    // Whether the worker should measure difficulty at all, and if so the minimum
    // a board must meet. Told to the worker so it can reject a board that does
    // not meet the mood before posting it, rather than the main thread
    // discarding a finished search and having to ask for another.
    analyzeDifficulty: mooded,
    minSophisticated: mooded ? spec.minSophisticated : 0,
    minTopTier: mooded ? spec.minTopTier : 0,
  };

  return new Promise((resolve) => {
    const workers = [];
    const collected = [];
    let pending = 0;
    let settled = false;
    let candidates = 0;
    let rejected = 0;
    let lastReason = 'no workers';
    let timer = null;

    // Always tears the whole field down: on a win, on exhaustion and on the
    // timeout alike. A leaked worker would keep searching for a board nobody
    // will use.
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      for (const w of workers) {
        try {
          w.terminate();
        } catch (e) {}
      }
      workers.length = 0;
    };

    // A mood chooses out of the batch; a preset just takes whichever board
    // arrived, which is what the race did before moods existed.
    const pickWinner = () => (mooded ? selectByMood(collected, spec) : collected[0]);

    const finish = (chosen) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (chosen) {
        if (mooded && required > 1 && collected.length < required) {
          console.warn(
            `generateBoardSafe: ${spec.label} mood asked for ${required} qualifying boards ` +
              `and got ${collected.length} (${rejected} rejected as too easy) — ` +
              `playing the best of those. Turn on multi-threaded generation to widen the search.`
          );
        }
        applyMines(chosen.cells);
        if (mooded) reportBoardDifficulty(chosen.difficulty, spec);
        resolve(true);
        return;
      }
      // Nothing to show for the search, so the player still gets a playable
      // board. This includes the case where no worker could be created at all:
      // generateBoardSafe returns this promise directly, so handing back here
      // would leave the grid empty rather than letting anything else try.
      warnNoGuessGaveUp(lastReason, candidates, Date.now() - startTime);
      placeMinesRandom(excludeR, excludeC);
      computeAdjacents();
      resolve(false);
    };

    // One worker out of the field is done. Only give up once they all are: a
    // worker that runs dry early says nothing about the others still searching.
    const workerDone = (msg) => {
      candidates += (msg && msg.candidates) || 0;
      rejected += (msg && msg.rejected) || 0;
      if (msg && msg.reason) lastReason = msg.reason;
      if (--pending > 0) return;
      finish(null);
    };

    for (let i = 0; i < count; i++) {
      let worker;
      try {
        worker = new Worker('js/gen-worker.js');
      } catch (e) {
        // Blocked or unavailable. Whatever did start can still produce a board.
        console.warn('generateBoardInWorkers: could not start a worker.', e);
        continue;
      }
      pending++;
      workers.push(worker);
      worker.onmessage = (e) => {
        const msg = e.data || {};
        if (settled) return;
        if (msg.type === 'board') {
          candidates++;
          // The worker judges the mood, because it has already solved the board
          // and re-judging here would mean solving it again. A board it marked
          // rejected is not a candidate for the batch: it did its job and found
          // a guess-free board, but one too easy for what was asked.
          if (msg.rejected) {
            rejected++;
            try {
              worker.postMessage(request);
            } catch (e) {
              workerDone({ reason: 'worker error' });
            }
            return;
          }
          collected.push({ cells: msg.cells, difficulty: msg.difficulty });
          // Normal takes the first board outright. A mood needs a whole batch
          // before it can pick, so it keeps the workers searching.
          if (collected.length >= required) {
            finish(pickWinner());
            return;
          }
          // This worker has done what it was asked; send it looking again so the
          // batch can still be filled once the others run out.
          try {
            worker.postMessage(request);
          } catch (e) {
            workerDone({ reason: 'worker error' });
          }
          return;
        }
        workerDone(msg);
      };
      worker.onerror = (e) => {
        // Never let one broken worker strand the click.
        if (settled) return;
        console.warn('generateBoardInWorkers: worker failed.', e.message || e);
        workerDone({ reason: 'worker error' });
      };
      worker.postMessage(request);
    }

    if (pending === 0) {
      // No worker could be created at all — hand back to the caller so the
      // single-threaded path can still try.
      finish(null);
      return;
    }

    // Backstop for workers that neither answer nor fail, e.g. a tab that was
    // throttled mid-search.
    timer = setTimeout(() => {
      if (settled) return;
      lastReason = 'budget';
      // A partial batch is still the best board found: better than discarding
      // real work and handing the player a random board.
      finish(collected.length > 0 ? pickWinner() : null);
    }, Math.max(0, deadline - Date.now()));
  });
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
 * When the "Multi-threaded generation" setting is on, that propose-and-verify
 * work runs in web workers racing each other and the first verified board wins
 * (see generateBoardInWorkers and gen-worker.js). Otherwise it runs inline, one
 * candidate at a time, yielding between attempts.
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
    // The solver mood is a custom-game feature, so it is resolved only for
    // custom. Every preset keeps the generation path it had before moods
    // existed: no mood spec, no difficulty accounting, no batch to fill, and
    // nothing logged about the result. A preset is chosen by its size and mine
    // count alone, and is not ours to re-rank.
    const spec = isCustomDifficulty(boardConfig.difficulty)
      ? effectiveSolverMood(boardConfig.difficulty, boardConfig.solverMood)
      : null;
    if (useWorkerGeneration()) return generateBoardInWorkers(excludeR, excludeC, spec);

    // Normal keeps the original loop: apply a candidate, verify it, stop at the
    // first board that passes. A mood above Normal cannot work that way, because
    // it has to choose between boards, so it collects a batch before touching the
    // grid. Presets have no mood at all and share the Normal loop, one solve and
    // no report.
    if (!spec || spec.required === 1) {
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

        applyMines(res.cells);
        if (!spec) {
          if (isSolvable(grid, excludeR, excludeC)) return true;
        } else {
          // One solve serves both purposes: the same `solved` verdict the plain
          // isSolvable() call gives, and the difficulty report.
          const solved = solveWithDifficulty(grid, excludeR, excludeC);
          if (solved.solved) {
            reportBoardDifficulty(solved.difficulty, spec);
            return true;
          }
        }
      }

      warnNoGuessGaveUp(lastReason, candidates, Date.now() - startTime);
    } else {
      const budget = moodBudgetMs(spec);
      const deadline = Date.now() + budget;
      const startTime = deadline - budget;
      const collected = [];
      let candidates = 0;
      let rejected = 0;
      let lastReason = 'budget';
      let fatal = null;

      while (collected.length < spec.required && !fatal && Date.now() < deadline) {
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
          fatal = e;
          break;
        }
        if (!res.ok) {
          lastReason = res.reason === 'board-limit' || res.reason === 'iteration-limit'
            ? res.reason
            : 'candidate budget';
          // A degenerate board can never yield a batch, so stop rather than spin.
          if (res.reason === 'board-limit' || res.reason === 'iteration-limit') break;
          continue;
        }
        candidates++;

        const assessed = assessCandidate(res.cells, excludeR, excludeC);
        if (!assessed) continue; // not solvable by deduction: try another
        if (!moodQualifies(assessed.difficulty, spec)) {
          rejected++;
          continue;
        }
        collected.push(assessed);
      }

      if (collected.length > 0) {
        if (collected.length < spec.required) {
          console.warn(
            `generateBoardSafe: ${spec.label} mood asked for ${spec.required} qualifying boards ` +
              `and got ${collected.length} (${rejected} rejected as too easy) — ` +
              `playing the best of those. Turn on multi-threaded generation to widen the search.`
          );
        }
        const chosen = selectByMood(collected, spec);
        applyMines(chosen.cells);
        reportBoardDifficulty(chosen.difficulty, spec);
        return true;
      }

      warnNoGuessGaveUp(lastReason, candidates, Date.now() - startTime);
    }
  }

  placeMinesRandom(excludeR, excludeC);
  computeAdjacents();
  return false;
}
