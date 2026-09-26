// Board configuration: difficulty presets, custom board sizes and the
// first-click exclusion policy. This file loads FIRST (see index.html) because
// it seeds the live ROWS / COLS / MINES globals that state.js reads while it
// parses, and before board.js builds the grid.
//
// Adapted from JSMinesweeper by David N Hill (MIT). Its first three difficulty
// presets (9x9/10, 16x16/40, 30x16/99), the custom-size clamping rules and the
// safe / "opening on start" first-click exclusion model follow that project;
// Ultra-Violence and Nightmare! are additions of this project. See
// THIRD-PARTY-NOTICES.md for the full licence text.

const BOARD_CONFIG_KEY = 'slopsweeper.boardConfig';

// Difficulty presets, keyed by the value used in the settings dropdown. The
// names are the classic Windows Minesweeper ones; the sizes are unchanged for
// the three originals, and Ultra-Violence and Nightmare! are the two extra
// steps, both 30x30 and progressively denser than Expert.
const DIFFICULTIES = {
  beginner: { cols: 9, rows: 9, mines: 10, label: "I'm Too Young To Die" },
  intermediate: { cols: 16, rows: 16, mines: 40, label: 'Hey, Not Too Rough' },
  expert: { cols: 30, rows: 16, mines: 99, label: 'Hurt Me Plenty' },
  'ultra-violence': { cols: 30, rows: 30, mines: 225, label: 'Ultra-Violence' },
  nightmare: { cols: 30, rows: 30, mines: 250, label: 'Nightmare!' },
};
const CUSTOM_DIFFICULTY = 'custom';

// Custom board ceiling. JSMinesweeper uses the same 250x250 limit.
const MAX_COLS = 250;
const MAX_ROWS = 250;

// The generator runs on the first click, so its search is bounded by a
// wall-clock budget. It yields to the event loop while it works (see noguess.js),
// so the page stays responsive and can show a busy state; these numbers
// therefore trade waiting time against the odds of falling back to a board that
// is not guaranteed guess-free.
//
// Two budgets, because the loop proposes a candidate at a time and then verifies
// it, and the per-candidate slice decides how many attempts fit in the total.
//
// Measured, over 10 first clicks each (centre, corners, edges): the presets and
// ordinary custom boards never come close to the limit — 30x30/250 averages 246ms
// and 50x40/400 averages 85ms. Only an extreme board like 100x100/2000 does
// (~2.5s per accepted board, and 2 of 10 first clicks exhausted the budget).
// Those boards still generate a valid, playable board, just not a guaranteed
// guess-free one. Raising this would trade a longer stare at the busy state for
// coverage on boards few players will build; lowering it saves the presets
// nothing, since they finish in milliseconds.
const GENERATION_BUDGET_MS = 5000;
const GENERATION_CANDIDATE_BUDGET_MS = 1500;

// Ceiling on generation workers asked for by the "Multi-threaded generation"
// setting. The number the player enters is honoured as given, but a typo like
// 800 should not try to spawn 800 threads. Declared here rather than in board.js
// because the board-config sanitizer reads it, and that runs during this file's
// own load (see boardConfig below) — a later declaration would be in its
// temporal dead zone and throw.
const MAX_GENERATION_WORKERS = 32;

const DEFAULT_BOARD_CONFIG = {
  difficulty: 'expert',
  customCols: 30,
  customRows: 16,
  customMines: 99,
  noGuess: true,
  openOnStart: true,
  // Off by default: single-threaded generation is the established, measured
  // path, and the presets finish in milliseconds without needing workers. The
  // workers pay off on large custom boards, where one candidate can take
  // seconds and several in parallel make the wait markedly shorter.
  multiThreaded: false,
  workerCount: 8,
};

// Live board dimensions. Declared with `let` rather than `const` because the
// difficulty selector rewrites them; every consumer reads them at call time,
// never at load time.
let ROWS = 16;
let COLS = 30;
let MINES = 99;

// The live selection, hydrated from localStorage rather than defaulted, so a
// saved choice is what the first board of a session actually uses. Calling the
// hoisted getBoardConfig() here is safe: everything it depends on
// (DEFAULT_BOARD_CONFIG, the size limits, the sanitizer) is initialised above.
// Skipping this was a real bug — settings were written to localStorage and
// shown correctly in the settings form, but every load built the default board.
let boardConfig = getBoardConfig();

// Number of cells the first click keeps mine-free, given the board size and
// the "opening on start" preference: 1 for a plain safe start, the full 3x3
// neighbourhood for an opening board. Boards too small to hold the 3x3 zone
// fall back to the plain safe start, as does a board that could not spare a
// single cell outside the zone.
function exclusionZoneSize(cols, rows, openOnStart) {
  if (!openOnStart) return 1;
  if (cols < 3 || rows < 3) return 1;
  if (cols * rows - 9 < 1) return 1;
  return 9;
}

// Clamps a requested custom board to something playable: 1..MAX per axis, and
// never more mines than there are cells outside the first-click exclusion
// zone. Non-numeric input falls back to the defaults.
function sanitizeBoardSize(cols, rows, mines, openOnStart) {
  const def = DEFAULT_BOARD_CONFIG;
  let c = Math.floor(Number(cols));
  let r = Math.floor(Number(rows));
  let m = Math.floor(Number(mines));
  if (!Number.isFinite(c)) c = def.customCols;
  if (!Number.isFinite(r)) r = def.customRows;
  if (!Number.isFinite(m)) m = def.customMines;
  c = Math.max(1, Math.min(MAX_COLS, c));
  r = Math.max(1, Math.min(MAX_ROWS, r));
  const zone = exclusionZoneSize(c, r, openOnStart);
  // Cells available for mines once the first-click zone is reserved. The floor
  // is normally 1, but a board with no spare cell at all (1x1) gets 0 rather
  // than an impossible mine count.
  const budget = Math.max(0, c * r - zone);
  m = Math.max(Math.min(1, budget), Math.min(budget, m));
  return { cols: c, rows: r, mines: m };
}

// Generation workers to ask for, as an integer in 1..MAX_GENERATION_WORKERS. A
// blank or non-numeric box falls back to the default rather than to 1, so
// clearing the field does not quietly mean "one at a time".
function sanitizeWorkerCount(count) {
  const def = DEFAULT_BOARD_CONFIG.workerCount;
  if (count === '' || count === null || count === undefined) return def;
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(MAX_GENERATION_WORKERS, n));
}

function sanitizeBoardConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const def = DEFAULT_BOARD_CONFIG;
  const difficulty =
    typeof src.difficulty === 'string' &&
    (src.difficulty === CUSTOM_DIFFICULTY || DIFFICULTIES[src.difficulty])
      ? src.difficulty
      : def.difficulty;
  const openOnStart =
    typeof src.openOnStart === 'boolean' ? src.openOnStart : def.openOnStart;
  const size = sanitizeBoardSize(src.customCols, src.customRows, src.customMines, openOnStart);
  return {
    difficulty,
    customCols: size.cols,
    customRows: size.rows,
    customMines: size.mines,
    noGuess: typeof src.noGuess === 'boolean' ? src.noGuess : def.noGuess,
    openOnStart,
    multiThreaded:
      typeof src.multiThreaded === 'boolean' ? src.multiThreaded : def.multiThreaded,
    workerCount: sanitizeWorkerCount(src.workerCount),
  };
}

function getBoardConfig() {
  try {
    const raw = localStorage.getItem(BOARD_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_BOARD_CONFIG };
    return sanitizeBoardConfig(JSON.parse(raw));
  } catch (e) {
    return { ...DEFAULT_BOARD_CONFIG };
  }
}

// Persists a patch and re-applies it to the live globals. Does NOT rebuild the
// grid — callers that change the board shape or generation policy must start a
// fresh board themselves (see restartBoard in ui.js).
function setBoardConfig(patch) {
  const next = sanitizeBoardConfig({ ...getBoardConfig(), ...(patch || {}) });
  boardConfig = next;
  try {
    localStorage.setItem(BOARD_CONFIG_KEY, JSON.stringify(next));
  } catch (e) {}
  applyBoardConfig();
  return next;
}

function applyBoardConfig() {
  if (boardConfig.difficulty === CUSTOM_DIFFICULTY) {
    COLS = boardConfig.customCols;
    ROWS = boardConfig.customRows;
    MINES = boardConfig.customMines;
  } else {
    const preset = DIFFICULTIES[boardConfig.difficulty] || DIFFICULTIES[DEFAULT_BOARD_CONFIG.difficulty];
    COLS = preset.cols;
    ROWS = preset.rows;
    MINES = preset.mines;
  }
  syncBoardCssVars();
}

// Board dimensions are published as CSS custom properties so the window and
// grid layout follow the selected difficulty instead of hardcoding the 30x16
// expert board.
function syncBoardCssVars() {
  const root = document.documentElement;
  root.style.setProperty('--board-cols', String(COLS));
  root.style.setProperty('--board-rows', String(ROWS));
}

// Human-readable summary of the current board, e.g. "30x16 / 99".
function describeBoard() {
  return `${COLS}x${ROWS} / ${MINES}`;
}

// Text for one entry in the difficulty dropdown, e.g.
// "Hurt Me Plenty — 30x16 / 99". Derived from DIFFICULTIES so the dropdown and
// the presets cannot drift apart the way a hand-written list of <option>s did.
function difficultyOptionLabel(key) {
  const preset = DIFFICULTIES[key];
  if (!preset) return key;
  return `${preset.label} — ${preset.cols}x${preset.rows} / ${preset.mines}`;
}

// Ranked-difficulty index, which is also the bucket index in scores.json and
// the `difficulty` value the scores API takes. The order comes from the
// declaration order of DIFFICULTIES, so adding a preset there is all it takes.
const DIFFICULTY_ORDER = Object.keys(DIFFICULTIES);

// Returns the bucket index for a difficulty key, or -1 for Custom, which is
// deliberately not ranked and so has no leaderboard.
function difficultyIndex(key) {
  return DIFFICULTY_ORDER.indexOf(key);
}

// Index of the difficulty currently being played, or -1 on Custom.
function currentDifficultyIndex() {
  return difficultyIndex(boardConfig.difficulty);
}

// Apply the persisted selection before anything else reads ROWS / COLS / MINES.
applyBoardConfig();
