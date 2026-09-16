// Player input: mouse buttons on cells plus keyboard shortcuts.
//
// Standard scheme (all configurable via Settings -> Gameplay, see controls.js):
// - Left click on an unopened cell reveals it.
// - Left press on a revealed number previews (depresses neighbours); with
//   "Left click chording" the click chords instead.
// - Right click cycles unmarked -> flag -> ? -> unmarked ("?" optional).
// - Middle click, or left+right together ("Emulate middle button"), on a
//   revealed number chords.
// - Keyboard shortcuts act on the last hovered cell.

// Suppress the click/contextmenu that the browser fires after a
// both-buttons (emulated middle) chord already acted.
let suppressClick = false;
let suppressContextMenu = false;

// Buttons currently held down on the board (bitmask: 1 = left, 2 = right).
let downButtons = 0;

function parseCellTarget(e) {
  const t = (e && e.target && e.target.dataset) || {};
  const r = Number(t.r);
  const c = Number(t.c);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

function isNumberedOpen(r, c) {
  const cell = grid[r][c];
  return cell.revealed && cell.adjacent > 0;
}

function doLeftAction(r, c) {
  const cell = grid[r][c];
  if (gameEnded) return;
  if (firstClick) {
    generateBoardSafe(r, c);
    startTimer();
    firstClick = false;
  }
  if (cell.revealed) {
    // Revealed number: chord only when enabled, otherwise the press
    // preview (shown on mousedown) is all that happens.
    if (cell.adjacent > 0 && getControls().leftChord) chordCell(r, c);
    return;
  }
  revealCell(r, c);
}

function onCellClick(e) {
  // Stray clicks (e.g. middle button, or press/release on different cells)
  // must not act.
  if (e && typeof e.button === 'number' && e.button !== 0) return;
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const pos = parseCellTarget(e);
  if (!pos) return;
  doLeftAction(pos.r, pos.c);
}

// Right-click cycles: unmarked -> flag -> question mark -> unmarked.
// Without "Use ?" the cycle is unmarked -> flag -> unmarked.
// Only flags count against the mines-left counter; "?" is just a reminder.
// Glyphs are pure CSS (cell[data-glyph] + theme vars); JS only sets state.
function onCellRightClick(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  if (suppressContextMenu) {
    suppressContextMenu = false;
    return;
  }
  const pos = parseCellTarget(e);
  if (!pos || gameEnded) return;
  const cell = grid[pos.r][pos.c];
  if (cell.revealed) return;
  const useQuestion = getControls().useQuestion;
  const cellEl = $grid.children[pos.r * COLS + pos.c];
  if (!cell.flagged && !cell.question) {
    cell.flagged = true;
    cellEl.textContent = '';
    cellEl.dataset.glyph = 'flag';
    cellEl.classList.add('flagged');
    flagsLeft--;
  } else if (cell.flagged) {
    cell.flagged = false;
    flagsLeft++;
    if (useQuestion) {
      cell.question = true;
      cellEl.textContent = '';
      cellEl.dataset.glyph = 'question';
      cellEl.classList.remove('flagged');
      cellEl.classList.add('questioned');
    } else {
      cellEl.textContent = '';
      delete cellEl.dataset.glyph;
      cellEl.classList.remove('flagged');
    }
  } else {
    cell.question = false;
    cellEl.textContent = '';
    delete cellEl.dataset.glyph;
    cellEl.classList.remove('questioned');
  }
  setMinesLeft(flagsLeft);
}

function onCellDoubleClick(e) {
  if (gameEnded) return;
  const pos = parseCellTarget(e);
  if (!pos) return;
  const cell = grid[pos.r][pos.c];
  if (cell.revealed && cell.adjacent > 0) {
    chordCell(pos.r, pos.c);
  } else {
    revealCell(pos.r, pos.c);
  }
}

// Press preview: while the left button is held on a revealed number, the
// covered unflagged neighbours render depressed (purely visual).
function showPressPreview(r, c) {
  clearPressPreview();
  for (const n of getNeighbors(r, c)) {
    const neighbor = grid[n.r][n.c];
    if (!neighbor.revealed && !neighbor.flagged) {
      $grid.children[n.r * COLS + n.c].classList.add('preview');
    }
  }
}

function clearPressPreview() {
  const pressed = $grid.querySelectorAll('.cell.preview');
  for (const el of pressed) el.classList.remove('preview');
}

function onGridMouseDown(e) {
  if (gameEnded) return;
  const pos = parseCellTarget(e);
  if (!pos) return;
  if (e.button === 1) {
    // Middle click on a revealed number chords (prevent autoscroll).
    e.preventDefault();
    if (isNumberedOpen(pos.r, pos.c)) chordCell(pos.r, pos.c);
    return;
  }
  if (e.button !== 0 && e.button !== 2) return;
  // Track held buttons so left+right together can emulate the middle button.
  // e.buttons already includes the button going down, but OR it in anyway
  // for browsers that report the pre-press state here.
  downButtons |= (1 << e.button) | (e.buttons || 0);
  const bothDown = (downButtons & 3) === 3;
  if (bothDown && getControls().emulateMiddle && isNumberedOpen(pos.r, pos.c)) {
    clearPressPreview();
    chordCell(pos.r, pos.c);
    // Swallow the click + contextmenu the release sequence will produce.
    suppressClick = true;
    suppressContextMenu = true;
    downButtons = 0;
    return;
  }
  if (e.button === 0 && !getControls().leftChord && isNumberedOpen(pos.r, pos.c)) {
    showPressPreview(pos.r, pos.c);
  }
}

if ($grid) {
  $grid.addEventListener('mousedown', onGridMouseDown);
  $grid.addEventListener('mouseleave', () => {
    downButtons = 0;
    clearPressPreview();
  });
}

document.addEventListener('mouseup', () => {
  // Any release ends the held-button gesture and the press preview.
  downButtons = 0;
  clearPressPreview();
});
window.addEventListener('blur', () => {
  downButtons = 0;
  clearPressPreview();
});

// Suspense emoji while the left button (or the left-action key) is held down.
document.addEventListener('mousedown', e => { if (e.button === 0 && !gameEnded) updateStatusEmoji('key'); });
document.addEventListener('mouseup', e => { if (e.button === 0 && !gameEnded) updateStatusEmoji('default'); });
document.addEventListener('keydown', e => {
  if (e.repeat || gameEnded) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
  if (typeof e.key !== 'string' || e.key.toUpperCase() !== getControls().keyLeft) return;
  updateStatusEmoji('key');
});
document.addEventListener('keyup', e => {
  if (typeof e.key !== 'string' || e.key.toUpperCase() !== getControls().keyLeft) return;
  if (!gameEnded) updateStatusEmoji('default');
});

// Keyboard shortcuts act on the last hovered cell:
// left key = left click, right key = right click, middle key = chord.
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // Ignore when typing in form fields, and when modifiers are held
  // (so e.g. Ctrl+C still copies).
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (typeof e.key !== 'string' || e.key.length !== 1) return;
  if (lastR === null || lastC === null) return;
  if (lastR < 0 || lastR >= ROWS || lastC < 0 || lastC >= COLS) return;
  const key = e.key.toUpperCase();
  const controls = getControls();
  if (key === controls.keyLeft) {
    doLeftAction(lastR, lastC);
  } else if (key === controls.keyRight) {
    const mockEvent = { target: { dataset: { r: String(lastR), c: String(lastC) } }, preventDefault: () => {} };
    onCellRightClick(mockEvent);
  } else if (key === controls.keyMiddle) {
    if (!gameEnded && isNumberedOpen(lastR, lastC)) chordCell(lastR, lastC);
  }
});
