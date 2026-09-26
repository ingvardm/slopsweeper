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

// Core solver. Returns { solved, revealed } where revealed is the boolean
// grid of what the logical solver could uncover. Never mutates `board`.
function analyzeBoard(board, startR, startC) {
  const MAX_ENUM_CELLS = 45; // max frontier-component size to enumerate exactly
  const MAX_SOL_ENUM = 2000; // solution cap per component enumeration
  const MAX_ROUNDS = 2000;

  const mineAt = (r, c) => board[r][c].mine;
  const adjAt = (r, c) => board[r][c].adjacent;

  const revealed = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const flagged = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

  const flood = (sr, sc) => {
    const queue = [{ r: sr, c: sc }];
    while (queue.length) {
      const { r, c } = queue.pop();
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      if (revealed[r][c] || flagged[r][c] || mineAt(r, c)) continue;
      revealed[r][c] = true;
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
                flood(nb.r, nb.c);
                basicChanged = true;
              }
            }
          } else if (flags + covered.length === adjAt(r, c)) {
            for (const nb of covered) {
              if (!flagged[nb.r][nb.c]) {
                flagged[nb.r][nb.c] = true;
                basicChanged = true;
              }
            }
          }
        }
      }
    }

    if (revealedSafeCount() === totalSafe) return { solved: true, revealed };

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
    if (frontier.length === 0) return { solved: false, revealed }; // stuck

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
          return { solved: false, revealed }; // inconsistent -> stuck
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

      if (solutions === 0) return { solved: false, revealed };
      for (let i = 0; i < k; i++) {
        const cell = frontier[gidx[i]];
        if (canBeMine[i] && !canBeSafe[i] && !flagged[cell.r][cell.c]) {
          flagged[cell.r][cell.c] = true;
          applied = true;
        } else if (canBeSafe[i] && !canBeMine[i] && !revealed[cell.r][cell.c]) {
          flood(cell.r, cell.c);
          applied = true;
        }
      }
    }

    if (!applied) return { solved: false, revealed }; // needs a guess
  }

  return { solved: false, revealed };
}
