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

const autoRevealVisited = new Set();

function chordCell(r, c) {
  const key = `${r},${c}`;
  if (!autoRevealVisited.has(key)) {
    autoRevealVisited.clear();
    autoRevealVisited.add(key);
  }
  const cell = grid[r][c];
  if (!cell.revealed || cell.adjacent === 0) return;
  const neighbors = getNeighbors(r, c);
  const flaggedCount = neighbors.filter(n => grid[n.r][n.c].flagged).length;
  if (flaggedCount !== cell.adjacent) return;
  neighbors.forEach(n => {
    const neighbor = grid[n.r][n.c];
    if (!neighbor.revealed && !neighbor.flagged) {
      revealCell(n.r, n.c);
    }
  });
  if (getControls().autoReveal) {
    neighbors.forEach(n => {
      const neighbor = grid[n.r][n.c];
      if (neighbor.revealed && neighbor.adjacent > 0 && !neighbor.mine) {
        const nNeighbors = getNeighbors(n.r, n.c);
        const nFlagged = nNeighbors.filter(nn => grid[nn.r][nn.c].flagged).length;
        const key = `${n.r},${n.c}`;
        if (nFlagged === neighbor.adjacent && !autoRevealVisited.has(key)) {
          autoRevealVisited.add(key);
          chordCell(n.r, n.c);
        }
      }
    });
  }
}

function clearTextNodes(el) {
  for (let i = el.childNodes.length - 1; i >= 0; i--) {
    if (el.childNodes[i].nodeType === 3) el.childNodes[i].remove();
  }
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
  const questionEl = cellEl.querySelector('.cell-question');
  if (questionEl) questionEl.classList.remove('questioned');
  delete cellEl.dataset.glyph;
  delete cellEl.dataset.num;
  // Clear text nodes but preserve child elements (e.g. .cell-flag overlay)
  for (let i = cellEl.childNodes.length - 1; i >= 0; i--) {
    const n = cellEl.childNodes[i];
    if (n.nodeType === 3) n.remove();
  }
  if (cell.mine) {
    // Record the mine that caused the loss
    triggeredMine = { r, c };
    cellEl.dataset.glyph = 'explosion'; // themed glyph for the triggered mine
    gameOver(false);
    return;
  }
  if (cell.adjacent > 0) {
    clearTextNodes(cellEl);
    cellEl.appendChild(document.createTextNode(cell.adjacent));
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
            const flagEl = cellEl.querySelector('.cell-flag');
            if (flagEl) flagEl.classList.add('flagged');
            cellEl.classList.add('flagged');
            // Do not reveal flagged mines on loss
          } else {
            // Unflagged mine – show bomb unless this is the triggered mine
            cell.question = false;
            const questionEl = cellEl.querySelector('.cell-question');
            if (questionEl) questionEl.classList.remove('questioned');
            cellEl.classList.remove('questioned');
            delete cellEl.dataset.num;
            clearTextNodes(cellEl);
            if (triggeredMine && triggeredMine.r === r && triggeredMine.c === c) {
              const explosionEl = cellEl.querySelector('.cell-explosion');
              if (explosionEl) explosionEl.classList.add('exploded');
              cellEl.classList.add('exploded');
            } else {
              cellEl.dataset.glyph = 'bomb'; // themed glyph for other mines
            }
          }
        } else {
          // Non-mine cell
          if (cell.flagged) {
            // Wrong flag – replace with themed wrong glyph
            cell.flagged = false;
            delete cellEl.dataset.num;
            const flagEl = cellEl.querySelector('.cell-flag');
            if (flagEl) flagEl.classList.remove('flagged');
            cellEl.classList.remove('flagged');
            cellEl.dataset.glyph = 'wrong';
            cellEl.classList.add('revealed');
          } else if (cell.question) {
            // "?" was only a reminder – clear it on game over
            cell.question = false;
            clearTextNodes(cellEl);
            const questionEl = cellEl.querySelector('.cell-question');
            if (questionEl) questionEl.classList.remove('questioned');
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

// Test cheat (console only): reveal every safe cell and win automatically.
// Disabled in multiplayer so match results stay legitimate. If the previous
// game already ended, a fresh solo board is started first. Usage: _boom_()
async function _boom_() {
  if (typeof mpIsMultiplayer === 'function' && mpIsMultiplayer()) {
    console.warn('_boom_() is disabled in multiplayer');
    return 'disabled in multiplayer';
  }
  if (gameEnded) initGrid();
  if (firstClick) {
    await generateFirstBoard(0, 0);
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!grid[r][c].mine && !grid[r][c].revealed) revealCell(r, c);
    }
  }
  return 'boom';
}
