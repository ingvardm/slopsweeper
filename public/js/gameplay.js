// Core gameplay: revealing cells, chording, and win/loss handling.

function getNeighbors(r, c) {
  const neighbors = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
        neighbors.push({ r: nr, c: nc });
      }
    }
  }
  return neighbors;
}

function chordCell(r, c) {
  const cell = grid[r][c];
  // Only act on revealed numbered cells
  if (!cell.revealed || cell.adjacent === 0) return;
  const neighbors = getNeighbors(r, c);
  const flaggedCount = neighbors.filter(n => grid[n.r][n.c].flagged).length;
  // Proceed only if flags match the number on the cell
  if (flaggedCount !== cell.adjacent) return;
  // Reveal all unflagged, unrevealed neighbors
  neighbors.forEach(n => {
    const neighbor = grid[n.r][n.c];
    if (!neighbor.revealed && !neighbor.flagged) {
      revealCell(n.r, n.c);
    }
  });
}

function revealCell(r, c) {
  const cell = grid[r][c];
  if (cell.revealed || cell.flagged) return;
  cell.revealed = true;
  cell.question = false; // a "?" is only a reminder – left-click still reveals the cell
  revealedCount++;
  const cellEl = $grid.children[r * COLS + c];
  cellEl.classList.add('revealed');
  cellEl.classList.remove('questioned');
  cellEl.classList.remove('preview');
  delete cellEl.dataset.glyph;
  delete cellEl.dataset.num;
  cellEl.textContent = '';
  if (cell.mine) {
    // Record the mine that caused the loss
    triggeredMine = { r, c };
    cellEl.dataset.glyph = 'explosion'; // themed glyph for the triggered mine
    gameOver(false);
    return;
  }
  if (cell.adjacent > 0) {
    cellEl.textContent = cell.adjacent;
    cellEl.dataset.num = String(cell.adjacent); // pure-CSS number color
  } else {
    // flood fill
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
          revealCell(nr, nc);
        }
      }
    }
  }
  checkVictory();
  if (typeof mpOnLocalProgress === 'function') mpOnLocalProgress();
}

function gameOver(won) {
  const multiplayer = typeof mpIsMultiplayer === 'function' && mpIsMultiplayer();
  stopTimer();
  if (!won) {
    updateStatusEmoji('lost');
    // Game over - reveal mines and handle flags
    // (triggeredMine will be cleared after processing mines)

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        const cellEl = $grid.children[r * COLS + c];
        cellEl.classList.remove('preview'); // press preview never survives game over
        if (cell.mine) {
          if (cell.flagged) {
            // Correct flag on a mine – keep the flag visual
            cellEl.dataset.glyph = 'flag'; // themed flag glyph
            cellEl.textContent = '';
            cellEl.classList.add('flagged');
            // Do not reveal flagged mines on loss
          } else {
            // Unflagged mine – show bomb unless this is the triggered mine
            // (a "?" mark is not a flag, so it is replaced by the bomb)
            cell.question = false;
            cellEl.classList.remove('questioned');
            delete cellEl.dataset.num;
            cellEl.textContent = '';
            if (triggeredMine && triggeredMine.r === r && triggeredMine.c === c) {
              cellEl.dataset.glyph = 'explosion'; // themed glyph for the mine that caused loss
            } else {
              cellEl.dataset.glyph = 'bomb'; // themed glyph for other mines
            }
            // Do not add 'revealed' class for mines on loss; keep them covered
          }
        } else {
          // Non-mine cell
          if (cell.flagged) {
            // Wrong flag – replace with themed wrong glyph
            cell.flagged = false; // clear flag state
            delete cellEl.dataset.num;
            cellEl.textContent = '';
            cellEl.dataset.glyph = 'wrong';
            cellEl.classList.remove('flagged');
            cellEl.classList.add('revealed');
          } else if (cell.question) {
            // "?" was only a reminder – clear it on game over
            cell.question = false;
            cellEl.textContent = '';
            delete cellEl.dataset.glyph;
            cellEl.classList.remove('questioned');
          }
        }
      }
    }

    triggeredMine = null; // clear after processing mines
    gameEnded = true;
    // In LAN multiplayer a loss never ends the match on its own: the board
    // stays revealed locally while the opponent keeps playing. The match
    // result waits until both peers finish (or someone clears the board).
    if (multiplayer && typeof mpOnLocalFinish === 'function') {
      mpOnLocalFinish(false);
    }
    // Optionally could show visual cue, but modal already handles win case

  } else {
    gameEnded = true;
    updateStatusEmoji('won');
    if (multiplayer && typeof mpOnLocalFinish === 'function') {
      mpOnLocalFinish(true);
    } else {
      const timeSec = Math.floor((Date.now() - startTime) / 1000);
      // Prefill initials with the last stored name.
      if (typeof getStoredPlayerName === 'function') {
        const stored = getStoredPlayerName().toUpperCase().slice(0, 3);
        if (stored) $initialsInput.value = stored;
      }
      $modal.classList.remove('hidden');
      $submitScore.onclick = () => submitScore(timeSec);
    }
  }
}

function checkVictory() {
  const totalCells = ROWS * COLS;
  const nonMineCells = totalCells - MINES;
  if (revealedCount === nonMineCells) {
    updateStatusEmoji('won');
    gameOver(true);
  }
}
