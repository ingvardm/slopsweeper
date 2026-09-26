// No-guess board generation, driving the vendored JSMinesweeper engine.
//
// The engine (public/js/vendor/jsminesweeper/) is David N Hill's, MIT licensed
// and vendored byte-for-byte; see PROVENANCE.md in that directory and
// THIRD-PARTY-NOTICES.md at the repo root. This file supplies the three things
// the engine expects from its original host page and reproduces the generation
// loop from createNoGuessGame() in MinesweeperGame.js:
//
//   random board -> solve -> if a guess is needed, relocate mines to break the
//   ambiguity ("fillers", applied through ServerGame.fix) -> re-solve -> repeat
//
// Relocating mines is what makes this work at all. Searching for a good board by
// redrawing cannot: on a 30x30/250 board no randomly placed layout is solvable
// by pure deduction (measured 0 of 25), so redrawing only burns the budget.
//
// This produces *candidates*, not a guarantee. The engine's own model is mutated
// by each fix(), so the cells it reveals while building are not the cells a
// player would reveal on the finished board, and its "won" verdict is reached
// with that extra information. Measured, 0 of 7 boards it produced for 30x16/99
// and 30x30/250 were actually guess-free. So board.js treats this as a proposer
// and accepts a candidate only after solver.js confirms it independently.

// --- host-page globals the engine reads -------------------------------------
// These mirror the defaults main.js gives them in JSMinesweeper. The engine
// reads them for logging and for the "are we replaying?" flags; the generator
// path never sets any of them.

let oldrng = false;
let analysisMode = false;
let replayMode = false;
let replayData = null;
let replayStep = 0;
let replayInterrupt = false;
let replaying = false;
let analysing = false;
let guessAnalysisPruning = true;
let justPressedAnalyse = false;
let dragging = false;
let dragTile;
let dragButton;
let hoverTile;
let canvasLocked = false;
let isExpanded = false;
let leftClickFlag = false;
let previousBoardHash = 0;
let previousAnalysisQuery = '';
let analysisBoard;
let gameBoard;
let board;
let exportParms = null;
let imagesLoaded = 0;

// The engine's only outbound dependency: main.js renders these to the page.
function writeToConsole() {}
function showMessage() {}

// Binomial lookup used by the probability engine when a board has floating
// tiles (covered cells not adjacent to any revealed number). main.js builds it
// with these exact values; the prime sieve and lookup table cost ~20ms.
const BINOMIAL_TABLE = new Binomial(65000, 1000);
let binomialCache = new BinomialCache(5000, 1000, BINOMIAL_TABLE);

// --- generation --------------------------------------------------------------

// Yields to the event loop so the browser can paint the "Generating…" state.
// solver() is async but never actually suspends, so awaiting it alone only
// drains microtasks and the page stays frozen.
function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let binomialReady = false;
function ensureEngineReady() {
  // Building the binomial table is synchronous work; do it before the first
  // click rather than during one.
  binomialReady = binomialReady || !!binomialCache;
  return binomialReady;
}

// Options mirror createNoGuessGame()'s, which is the configuration its no-guess
// builder uses.
function noGuessSolverOptions() {
  return {
    playStyle: PLAY_STYLE_NOFLAGS,
    verbose: false,
    advancedGuessing: false,
    noGuessingMode: true,
    guessPruning: true,
  };
}

/**
 * Propose one candidate no-guess board for (startR, startC).
 *
 * Returns { ok, cells, attempts, iterations, elapsedMs, reason }. cells is a flat
 * array of { mine, adjacent } in row-major order, or null if the engine could
 * not finish a board in time. This is a proposal: the caller must verify it.
 */
async function buildNoGuessCandidate(opts) {
  const cols = opts.cols;
  const rows = opts.rows;
  const mines = opts.mines;
  const startR = opts.startR;
  const startC = opts.startC;
  const openOnStart = opts.openOnStart !== false;
  const budgetMs = opts.budgetMs || GENERATION_CANDIDATE_BUDGET_MS;
  const maxBoards = opts.maxBoards || 20000;
  const maxLoops = opts.maxLoops || 1000000;

  ensureEngineReady();
  const options = noGuessSolverOptions();
  // gameType "zero" is upstream's 3x3-safe opening; anything else excludes only
  // the clicked cell, which is our "safe cell only" mode.
  const gameType = openOnStart ? 'zero' : 'normal';

  // The engine narrates its search through console.log, and not all of it is
  // behind the verbose flag: solver_main.js has writeToConsole(text, true) calls
  // that print whatever we ask for. Upstream's own page shows that chatter too.
  // We would rather not put it in front of players, and the vendored files stay
  // byte-identical to upstream, so it is muted here for the duration of the
  // search. console.error is left alone so a real fault is still visible.
  return withQuietConsole(() => proposeBoard({ cols, rows, mines, startR, startC, openOnStart, gameType, options, budgetMs, maxBoards, maxLoops }));
}

/**
 * Run fn with console.log/warn/info/debug muted, restoring them afterwards even
 * if fn throws.
 */
async function withQuietConsole(fn) {
  const quiet = ['log', 'warn', 'info', 'debug', 'trace'];
  const saved = {};
  for (const level of quiet) {
    saved[level] = console[level];
    console[level] = function () {};
  }
  try {
    return await fn();
  } finally {
    for (const level of quiet) console[level] = saved[level];
  }
}

async function proposeBoard({ cols, rows, mines, startR, startC, openOnStart, gameType, options, budgetMs, maxBoards, maxLoops }) {
  const startIndex = startR * cols + startC;
  const startTime = Date.now();

  let iterations = 0;
  let boardsTried = 0;
  let sinceYield = 0;

  while (boardsTried < maxBoards && iterations < maxLoops) {
    if (Date.now() - startTime > budgetMs) break;
    boardsTried++;

    const seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const game = new ServerGame('ng', cols, rows, mines, startIndex, seed, gameType);
    const boardModel = new Board('ng', cols, rows, mines, seed, gameType);

    let revealed = game.clickTile(game.getTile(startIndex));
    applyResults(boardModel, revealed);
    let guessed = false;

    while (revealed.header.status === IN_PLAY && iterations < maxLoops && !guessed) {
      if (Date.now() - startTime > budgetMs) break;
      iterations++;

      const reply = await solver(boardModel, options);
      const fillers = reply.fillers;

      // Relocate mines to break the ambiguity that stopped the solver.
      for (let i = 0; i < fillers.length; i++) {
        revealed = game.fix(fillers[i]);
        applyResults(boardModel, revealed);
      }

      // With fillers applied the model is stale, so re-solve rather than act on
      // this reply's actions. Mirrors createNoGuessGame().
      const actions = fillers.length > 0 ? [] : reply.actions;
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (action.action === ACTION_CHORD) continue;
        if (action.action === ACTION_FLAG) continue; // a certain mine: no tile to clear
        if (action.prob !== 1) {
          guessed = true; // would have to guess: abandon this board
          break;
        }
        const tile = game.getTile(boardModel.xy_to_index(action.x, action.y));
        revealed = game.clickTile(tile);
        if (revealed.header.status !== IN_PLAY) break;
        applyResults(boardModel, revealed);
      }

      if (fillers.length === 0 && actions.length === 0) guessed = true;

      if (++sinceYield >= 25) {
        sinceYield = 0;
        if (Date.now() - startTime > budgetMs) break;
        await yieldToBrowser();
      }
    }

    if (revealed.header.status === WON) {
      const cells = new Array(cols * rows);
      for (let i = 0; i < cells.length; i++) {
        cells[i] = { mine: !!game.tiles[i].is_bomb, adjacent: game.tiles[i].value };
      }
      // fix() can in principle leave the mine count or the safe opening
      // altered; reject such a board rather than trust it.
      const check = { cols, rows, mines, startR, startC, openOnStart };
      if (validateNoGuessLayout({ cells, cols, rows }, check)) {
        return { ok: true, cells, attempts: boardsTried, iterations, elapsedMs: Date.now() - startTime };
      }
    }
  }

  // Say which limit stopped us: a degenerate board such as 2x2/1 can never be
  // no-guess, so it hits the board/iteration cap rather than the clock.
  let reason = 'budget';
  if (iterations >= maxLoops) reason = 'iteration-limit';
  else if (boardsTried >= maxBoards) reason = 'board-limit';

  return { ok: false, cells: null, attempts: boardsTried, iterations, elapsedMs: Date.now() - startTime, reason };
}

/**
 * Re-check a candidate against the promises we make: exact mine count, adjacency
 * values that match the mine layout, and a mine-free opening.
 */
function validateNoGuessLayout(layout, opts) {
  const cols = opts.cols;
  const rows = opts.rows;
  const startR = opts.startR;
  const startC = opts.startC;
  const openOnStart = opts.openOnStart !== false;

  let mineCount = 0;
  for (let i = 0; i < layout.cells.length; i++) if (layout.cells[i].mine) mineCount++;
  if (mineCount !== opts.mines) return false;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          if (layout.cells[rr * cols + cc].mine) n++;
        }
      }
      if (n !== layout.cells[r * cols + c].adjacent) return false;
    }
  }

  const radius = openOnStart ? 1 : 0;
  for (let r = startR - radius; r <= startR + radius; r++) {
    for (let c = startC - radius; c <= startC + radius; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      if (layout.cells[r * cols + c].mine) return false;
    }
  }
  return true;
}
