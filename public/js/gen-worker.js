// No-guess generation worker: proposes and verifies boards off the main thread.
//
// One worker races one attempt. It owns the whole pipeline for that attempt —
// vendored engine proposal, then the independent solver.js check — because
// verifying on the main thread would block the very UI the workers exist to
// keep responsive. A board is posted back only after passing both, so the main
// thread can treat the first message it receives as final and terminate the
// rest of the field (see generateBoardInWorkers in board.js).
//
// This is a classic worker, not a module: the vendored engine is byte-for-byte
// upstream and defines plain globals, so it comes in through importScripts in
// the same order index.html uses. noguess.js and solver.js are therefore the
// very same files the main thread runs, not a second copy free to drift.

// The engine reaches for window.crypto (BruteForceAnalysis) and window.URL
// (MinesweeperGame). A worker global has no window, so point it at the worker
// global before the engine loads; self.crypto and self.URL both exist here.
self.window = self;

importScripts(
  'solver.js',
  'vendor/jsminesweeper/Board.js',
  'vendor/jsminesweeper/Tile.js',
  'vendor/jsminesweeper/solver_main.js',
  'vendor/jsminesweeper/solver_probability_engine.js',
  'vendor/jsminesweeper/Brute_force.js',
  'vendor/jsminesweeper/BruteForceAnalysis.js',
  'vendor/jsminesweeper/MinesweeperGame.js',
  'vendor/jsminesweeper/SolutionCounter.js',
  'vendor/jsminesweeper/EfficiencyHelper.js',
  'vendor/jsminesweeper/FiftyFiftyHelper.js',
  'vendor/jsminesweeper/LongTermRiskHelper.js',
  'vendor/jsminesweeper/PrimeSieve.js',
  'vendor/jsminesweeper/Binomial.js',
  'noguess.js'
);

// The pipeline reads these as globals, just as it does on the main thread:
// solver.js reads ROWS / COLS / MINES, and noguess.js falls back to
// GENERATION_CANDIDATE_BUDGET_MS when a call supplies no budget of its own. The
// values arrive from the main thread rather than being restated here, so
// config.js remains the single source of truth for them.
let request = null;

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type !== 'generate') return;
  self.ROWS = msg.rows;
  self.COLS = msg.cols;
  self.MINES = msg.mines;
  self.GENERATION_CANDIDATE_BUDGET_MS = msg.candidateBudgetMs;
  request = msg;
  // Always answer, even on an unexpected fault: a worker that fails quietly
  // leaves the main thread waiting out its backstop timer for a board that was
  // never coming. The catch is deliberately broad — this is the last line of
  // defence for a player's click, and the only thing it can still do is report
  // that it is out of candidates.
  race().catch((err) => {
    post({
      type: 'exhausted',
      reason: 'engine error',
      detail: String((err && err.message) || err),
      candidates: 0,
    });
  });
};

// Generates candidates until one verifies, then posts it and stops. The main
// thread discards us as soon as any worker wins, so there is nothing to gain
// from producing a second board.
async function race() {
  const deadline = Date.now() + request.budgetMs;
  const startTime = deadline - request.budgetMs;
  let candidates = 0;
  let lastReason = 'budget';

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    let res;
    try {
      res = await buildNoGuessCandidate({
        cols: request.cols,
        rows: request.rows,
        mines: request.mines,
        startR: request.startR,
        startC: request.startC,
        openOnStart: request.openOnStart,
        budgetMs: Math.min(request.candidateBudgetMs, remaining),
      });
    } catch (e) {
      // A fault in the vendored engine must not look like a verified board.
      post({ type: 'exhausted', reason: 'engine error', detail: String((e && e.message) || e), candidates });
      return;
    }

    if (!res.ok) {
      // A board limit means the board is degenerate — 2x2/1, where every cell
      // touches every other, admits no no-guess layout at all. Retrying cannot
      // help, so stop at once.
      if (res.reason === 'board-limit' || res.reason === 'iteration-limit') {
        post({ type: 'exhausted', reason: res.reason, candidates, elapsedMs: Date.now() - startTime });
        return;
      }
      // Otherwise the attempt simply ran out of its own slice of the budget,
      // which on a large board happens long before the overall deadline. Go
      // round again: the main thread is waiting for a first success until that
      // deadline, and several of us are searching in parallel, so a fresh
      // independent attempt is exactly what the race is for. Giving up here
      // instead would make every worker fail at the same instant and buy
      // nothing over a single thread.
      lastReason = 'candidate budget';
      continue;
    }
    candidates++;

    if (isSolvable(gridFromCells(res.cells), request.startR, request.startC)) {
      post({
        type: 'board',
        cells: res.cells,
        candidates,
        attempts: res.attempts,
        elapsedMs: Date.now() - startTime,
      });
      return;
    }
    // Roughly half of the engine's candidates fail the independent check, so
    // this is the normal path, not an anomaly: go round again.
  }

  post({ type: 'exhausted', reason: lastReason, candidates, elapsedMs: Date.now() - startTime });
}

// solver.js wants a 2D grid of cells; the engine hands back the same information
// as one flat row-major array. The cells are shared by reference, not copied.
function gridFromCells(cells) {
  const { cols, rows } = request;
  const grid = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const line = new Array(cols);
    for (let c = 0; c < cols; c++) line[c] = cells[r * cols + c];
    grid[r] = line;
  }
  return grid;
}

function post(msg) {
  self.postMessage(msg);
}
