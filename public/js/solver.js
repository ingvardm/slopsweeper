// Logical solver: decides whether a board is solvable by deduction alone,
// without guessing. Used as the acceptance test for boards proposed by the
// no-guess generator (see noguess.js and board.js).
//
// "Solvable without guessing" is always relative to the strength of the solver,
// so these limits are the definition. MAX_ENUM_CELLS is the important one:
// frontier components larger than this are not enumerated exactly and the board
// is reported unsolvable, which makes the check conservative. At 20 it rejected
// boards a player could in fact deduce, and no-guess generation stalled on
// larger custom boards; 45 keeps the check honest without that cost. Raising it
// further widens what counts as solvable, at the price of time.

// How hard each deduction was to reach, and which pattern produced it. The names
// are the ones the Minesweeper community uses; the tiers are what the "Solver
// mood" setting filters on.
//
// The basic/sophisticated split is not cosmetic, it falls out of how the solver
// below reaches a move. The single-point pass has already run to a fixpoint over
// the whole board by the time the component pass takes a move, so anything the
// component pass resolves is by construction something the single-point rules
// could not settle on their own: two or more constraints had to be compared
// against each other. That is exactly the line between "a beginner can do this
// by looking" and "you have to reason about combinations".
//
// Within the component pass, what decides how demanding a move was is not the
// size of the component but the width of the narrowest constraint that touches
// the move: the number of unknowns that deduction had to resolve. A component
// can be large merely because the frontier happens to be connected, while the
// move itself came from a 2-cell constraint. Measured distributions for both are
// in README.md.
const DEDUCTION_TIERS = {
  basic: { tier: 'basic', weight: 1 },
  sophisticated: { tier: 'sophisticated', weight: 4 },
  'top-tier': { tier: 'top-tier', weight: 12 },
};

// Constraint widths that mean "reason over a handful of unknowns" and "reason
// over a real combinatorial space". A width of 3 is the 1-2-1-2 / subset family;
// from 4 up the placements interact enough that they have to be tracked.
const SOPHISTICATED_MIN_WIDTH = 3;
const TOP_TIER_MIN_WIDTH = 4;

// Community names for the same three tiers, used for display.
const TIER_TECHNIQUE = {
  basic: 'single-point',
  sophisticated: 'subset',
  'top-tier': 'hitting-set',
};

function tierForWidth(width) {
  if (width >= TOP_TIER_MIN_WIDTH) return 'top-tier';
  if (width >= SOPHISTICATED_MIN_WIDTH) return 'sophisticated';
  return 'basic';
}

const DIFFICULTY_TIER_ORDER = ['basic', 'sophisticated', 'top-tier'];

/**
 * Determine if a board can be solved entirely by logical deduction.
 *
 * Simulates a solver: flood-fill the opening, then loop basic single-point
 * rules plus exact enumeration of small connected frontier components until
 * solved or no deduction applies.
 */
function isSolvable(board, startR, startC) {
  return analyzeBoard(board, startR, startC).solved;
}

/**
 * Same solve, but also reports how hard each move was. Returns
 * { solved, revealed, difficulty }.
 */
function solveWithDifficulty(board, startR, startC) {
  return analyzeBoard(board, startR, startC);
}

/** A fresh, zeroed difficulty tally. */
function newDifficultyTally() {
  return {
    moves: 0,
    techniques: {},        // technique -> number of moves it produced
    tiers: { basic: 0, sophisticated: 0, 'top-tier': 0 },
    score: 0,              // raw weighted total; ranks boards of equal size
    percent: 0,            // 0-100, share of moves that were not basic
    widths: {},           // deciding constraint width -> moves
    components: {},       // component frontier size -> moves (diagnostic)
  };
}

function tallyDeduction(tally, tier, width, component) {
  const spec = DEDUCTION_TIERS[tier] || DEDUCTION_TIERS.basic;
  tally.moves++;
  tally.tiers[tier] = (tally.tiers[tier] || 0) + 1;
  const technique = TIER_TECHNIQUE[tier] || 'single-point';
  tally.techniques[technique] = (tally.techniques[technique] || 0) + 1;
  tally.score += spec.weight;
  if (width != null) tally.widths[width] = (tally.widths[width] || 0) + 1;
  if (component != null) tally.components[component] = (tally.components[component] || 0) + 1;
}

function finishDifficulty(tally) {
  const hard = tally.tiers.sophisticated + tally.tiers['top-tier'];
  tally.score = tally.score || 0;
  tally.percent = tally.moves ? Math.round((100 * hard) / tally.moves) : 0;
  // Techniques are stored under their display names, so order them by the tier
  // each one stands for, hardest first.
  const tierOf = {};
  for (const tier of DIFFICULTY_TIER_ORDER) tierOf[TIER_TECHNIQUE[tier]] = tier;
  tally.used = Object.keys(tally.techniques).sort(
    (a, b) => DIFFICULTY_TIER_ORDER.indexOf(tierOf[b]) - DIFFICULTY_TIER_ORDER.indexOf(tierOf[a]) || a.localeCompare(b)
  );
  tally.summary = DIFFICULTY_TIER_ORDER.filter((t) => tally.tiers[t] > 0)
    .map((t) => `${t} ${tally.tiers[t]}`)
    .join(', ');
  return tally;
}

/** How many deductions used at least a given tier. */
function countAtLeastTier(tally, tier) {
  const from = DIFFICULTY_TIER_ORDER.indexOf(tier);
  if (from < 0) return 0;
  let n = 0;
  for (let i = from; i < DIFFICULTY_TIER_ORDER.length; i++) n += tally.tiers[DIFFICULTY_TIER_ORDER[i]] || 0;
  return n;
}

// Core solver. Returns { solved, revealed } where revealed is the boolean
// grid of what the logical solver could uncover. Never mutates `board`.
function analyzeBoard(board, startR, startC) {
  const MAX_ENUM_CELLS = 45; // max frontier-component size to enumerate exactly
  const MAX_SOL_ENUM = 2000; // solution cap per component enumeration
  const MAX_ROUNDS = 2000;

  const tally = newDifficultyTally();

  const mineAt = (r, c) => board[r][c].mine;
  const adjAt = (r, c) => board[r][c].adjacent;

  const revealed = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const flagged = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

  // `technique`/`width` record how this reveal was reached; pass no tally for
  // the opening flood, which is a zero-expansion rather than a deduction.
  const flood = (sr, sc, tally, tier, width, component) => {
    const queue = [{ r: sr, c: sc }];
    while (queue.length) {
      const { r, c } = queue.pop();
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      if (revealed[r][c] || flagged[r][c] || mineAt(r, c)) continue;
      revealed[r][c] = true;
      if (tally) tallyDeduction(tally, tier, width, component);
      if (adjAt(r, c) === 0) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            queue.push({ r: r + dr, c: c + dc });
          }
        }
      }
    }
  };

  const neighboursOf = (r, c) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) out.push({ r: nr, c: nc });
      }
    }
    return out;
  };

  const revealedSafeCount = () => {
    let n = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) if (revealed[r][c]) n++;
    }
    return n;
  };

  const totalSafe = ROWS * COLS - MINES;

  flood(startR, startC);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 1. Basic single-point rules to a fixpoint.
    let basicChanged = true;
    while (basicChanged) {
      basicChanged = false;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (!revealed[r][c] || adjAt(r, c) === 0) continue;
          const covered = [];
          let flags = 0;
          for (const nb of neighboursOf(r, c)) {
            if (flagged[nb.r][nb.c]) flags++;
            else if (!revealed[nb.r][nb.c]) covered.push(nb);
          }
          if (covered.length === 0) continue;
          if (flags === adjAt(r, c)) {
            for (const nb of covered) {
              if (!revealed[nb.r][nb.c] && !flagged[nb.r][nb.c]) {
                flood(nb.r, nb.c, tally, tierForWidth(covered.length), covered.length);
                basicChanged = true;
              }
            }
          } else if (flags + covered.length === adjAt(r, c)) {
            for (const nb of covered) {
              if (!flagged[nb.r][nb.c]) {
                flagged[nb.r][nb.c] = true;
                tallyDeduction(tally, tierForWidth(covered.length), covered.length);
                basicChanged = true;
              }
            }
          }
        }
      }
    }

    if (revealedSafeCount() === totalSafe) return { solved: true, revealed, difficulty: finishDifficulty(tally) };

    // 2. Frontier = covered, unflagged cells touching a revealed number.
    const frontierIndex = new Map(); // "r,c" -> idx
    const frontier = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!revealed[r][c] || adjAt(r, c) === 0) continue;
        for (const nb of neighboursOf(r, c)) {
          if (!revealed[nb.r][nb.c] && !flagged[nb.r][nb.c]) {
            const key = nb.r + ',' + nb.c;
            if (!frontierIndex.has(key)) {
              frontierIndex.set(key, frontier.length);
              frontier.push({ r: nb.r, c: nb.c });
            }
          }
        }
      }
    }
    if (frontier.length === 0) return { solved: false, revealed, difficulty: finishDifficulty(tally) }; // stuck

    // 3. Constraints from the solver's point of view (no ground truth!).
    const constraints = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!revealed[r][c] || adjAt(r, c) === 0) continue;
        let required = adjAt(r, c);
        const cells = [];
        for (const nb of neighboursOf(r, c)) {
          if (flagged[nb.r][nb.c]) required--;
          else if (!revealed[nb.r][nb.c]) {
            const idx = frontierIndex.get(nb.r + ',' + nb.c);
            if (idx !== undefined) cells.push(idx);
          }
        }
        if (cells.length === 0) continue;
        if (required < 0 || required > cells.length) {
          return { solved: false, revealed, difficulty: finishDifficulty(tally) }; // inconsistent -> stuck
        }
        constraints.push({ cells, mines: required });
      }
    }

    // 4. Split into connected components (cells sharing a constraint).
    const parent = frontier.map((_, i) => i);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (const con of constraints) {
      for (let i = 1; i < con.cells.length; i++) {
        const a = find(con.cells[0]);
        const b = find(con.cells[i]);
        if (a !== b) parent[a] = b;
      }
    }
    const groups = new Map();
    frontier.forEach((_, i) => {
      const g = find(i);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    });

    // 5. Enumerate small components exactly; collect forced moves.
    let applied = false;
    for (const [, gidx] of groups) {
      if (gidx.length > MAX_ENUM_CELLS) continue; // too big: skip
      const pos = new Map(gidx.map((g, i) => [g, i]));
      const local = [];
      for (const con of constraints) {
        const cells = con.cells.filter((x) => pos.has(x)).map((x) => pos.get(x));
        if (cells.length) local.push({ cells, mines: con.mines });
      }
      const k = gidx.length;
      const assignment = Array(k).fill(false);
      const canBeMine = Array(k).fill(false);
      const canBeSafe = Array(k).fill(false);
      let solutions = 0;

      const partialOk = (idx) => {
        for (const con of local) {
          let soFar = 0;
          let unknown = 0;
          for (const ci of con.cells) {
            if (ci < idx) {
              if (assignment[ci]) soFar++;
            } else {
              unknown++;
            }
          }
          const need = con.mines - soFar;
          if (need < 0 || need > unknown) return false;
        }
        return true;
      };

      const backtrack = (idx) => {
        if (solutions > MAX_SOL_ENUM) return;
        if (idx === k) {
          for (const con of local) {
            let count = 0;
            for (const ci of con.cells) if (assignment[ci]) count++;
            if (count !== con.mines) return;
          }
          solutions++;
          for (let i = 0; i < k; i++) {
            if (assignment[i]) canBeMine[i] = true;
            else canBeSafe[i] = true;
          }
          return;
        }
        assignment[idx] = false;
        if (partialOk(idx + 1)) backtrack(idx + 1);
        assignment[idx] = true;
        if (partialOk(idx + 1)) backtrack(idx + 1);
      };
      backtrack(0);

      if (solutions === 0) return { solved: false, revealed, difficulty: finishDifficulty(tally) };
      // The single-point pass above already ran to a fixpoint across the whole
      // board, so whatever is left here is by construction a cell the basic
      // rules alone could not settle. The width decides how demanding the
      // combination reasoning was.
      // How many unknowns did this move actually have to reason over? Take the
      // narrowest constraint in the component that touches the cell: a move can
      // be pinned by a 3-cell constraint even inside a 20-cell component.
      const narrowest = new Array(k).fill(Infinity);
      for (const con of local) {
        for (const ci of con.cells) if (con.cells.length < narrowest[ci]) narrowest[ci] = con.cells.length;
      }
      for (let i = 0; i < k; i++) {
        const cell = frontier[gidx[i]];
        const tier = tierForWidth(narrowest[i] === Infinity ? k : narrowest[i]);
        if (canBeMine[i] && !canBeSafe[i] && !flagged[cell.r][cell.c]) {
          flagged[cell.r][cell.c] = true;
          tallyDeduction(tally, tier, narrowest[i], k);
          applied = true;
        } else if (canBeSafe[i] && !canBeMine[i] && !revealed[cell.r][cell.c]) {
          flood(cell.r, cell.c, tally, tier, narrowest[i], k);
          applied = true;
        }
      }
    }

    if (!applied) return { solved: false, revealed, difficulty: finishDifficulty(tally) }; // needs a guess
  }

  return { solved: false, revealed, difficulty: finishDifficulty(tally) };
}
