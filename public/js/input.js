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
//
// iPad mode (Settings -> Gameplay -> iPad mode):
// - Touch tap always chords on revealed numbers, reveals unrevealed cells.
// - Long-press (500 ms) flags/unflags an unrevealed cell.
// - "?" placement is disabled; the other gameplay options are overridden.

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
    if (cell.adjacent > 0 && (getControls().leftChord || getControls().iPadMode)) chordCell(r, c);
    else if (getControls().autoReveal && cell.adjacent > 0) chordCell(r, c);
    return;
  }
  if (getControls().iPadMode && cell.flagged) {
    toggleFlagOnCell(r, c);
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
  if (getControls().iPadMode) {
    toggleFlagOnCell(pos.r, pos.c);
    return;
  }
  const useQuestion = getControls().useQuestion;
  const cellEl = $grid.children[pos.r * COLS + pos.c];
  const flagEl = cellEl.querySelector('.cell-flag');
  const questionEl = cellEl.querySelector('.cell-question');
  if (!cell.flagged && !cell.question) {
    cell.flagged = true;
    if (flagEl) flagEl.classList.add('flagged');
    cellEl.classList.add('flagged');
    flagsLeft--;
  } else if (cell.flagged) {
    cell.flagged = false;
    flagsLeft++;
    if (useQuestion) {
      cell.question = true;
      if (flagEl) flagEl.classList.remove('flagged');
      cellEl.classList.remove('flagged');
      if (questionEl) questionEl.classList.add('questioned');
      cellEl.classList.add('questioned');
    } else {
      if (flagEl) flagEl.classList.remove('flagged');
      cellEl.classList.remove('flagged');
    }
  } else {
    cell.question = false;
    if (questionEl) questionEl.classList.remove('questioned');
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

// Toggle flag on a cell (iPad mode long-press + keyboard shortcut).
// Only cycles flag on/off — no "?" in iPad mode.
function toggleFlagOnCell(r, c) {
  if (gameEnded) return;
  const cell = grid[r][c];
  if (cell.revealed) return;
  const cellEl = $grid.children[r * COLS + c];
  const flagEl = cellEl.querySelector('.cell-flag');
  if (cell.flagged) {
    cell.flagged = false;
    if (flagEl) flagEl.classList.remove('flagged');
    cellEl.classList.remove('flagged');
    flagsLeft++;
  } else {
    cell.flagged = true;
    if (flagEl) flagEl.classList.add('flagged');
    cellEl.classList.add('flagged');
    flagsLeft--;
  }
  setMinesLeft(flagsLeft);
  if (getControls().iPadMode) showFlagBubble(r, c, cell.flagged);
}

let flagBubbleId = 0;

function showFlagBubble(r, c, activated) {
  const cellEl = $grid.children[r * COLS + c];
  const rect = cellEl.getBoundingClientRect();
  const gridRect = $grid.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 4.8;
  const color = activated ? 'var(--check-color)' : 'var(--flag-color)';
  const id = 'fbb' + (++flagBubbleId);
  const style = document.createElement('style');
  style.textContent = '@keyframes ' + id + '{0%{transform:translate(-50%,-50%) scale(0);opacity:.5}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}';
  document.head.appendChild(style);
  const bubble = document.createElement('div');
  bubble.className = 'flag-bubble';
  bubble.style.cssText = 'position:absolute;border-radius:50%;pointer-events:none;z-index:10;width:' + size + 'px;height:' + size + 'px;left:' + (rect.left - gridRect.left + rect.width / 2) + 'px;top:' + (rect.top - gridRect.top + rect.height / 2) + 'px;background:' + color + ';animation:' + id + ' 400ms ease-out forwards';
  $grid.appendChild(bubble);
  bubble.addEventListener('animationend', () => { bubble.remove(); style.remove(); });
}

// ---- iPad mode: touch long-press flags, tap chords ----
let touchStartXY = null;
let longPressTimer = null;
let longPressFired = false;

function onGridTouchStart(e) {
  if (!getControls().iPadMode || gameEnded) return;
  e.preventDefault();
  const touch = e.touches[0];
  const target = document.elementFromPoint(touch.clientX, touch.clientY);
  if (!target) return;
  const pos = parseCellTarget({ target });
  if (!pos) return;
  touchStartXY = { x: touch.clientX, y: touch.clientY };
  longPressFired = false;
  const ms = getControls().iPadLongPress || 180;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (touchStartXY) {
      longPressFired = true;
      toggleFlagOnCell(pos.r, pos.c);
    }
  }, ms);
}

function onGridTouchMove(e) {
  if (!touchStartXY) return;
  const touch = e.touches[0];
  const dx = touch.clientX - touchStartXY.x;
  const dy = touch.clientY - touchStartXY.y;
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    } else if (longPressFired) {
      longPressFired = false;
      const target = document.elementFromPoint(touchStartXY.x, touchStartXY.y);
      if (target) {
        const pos = parseCellTarget({ target });
        if (pos) toggleFlagOnCell(pos.r, pos.c);
      }
    }
    touchStartXY = null;
  }
}

function onGridTouchEnd(e) {
  if (!getControls().iPadMode) return;
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (longPressFired) {
    longPressFired = false;
    e.preventDefault();
    return;
  }
  if (touchStartXY && !gameEnded) {
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (target) {
      const pos = parseCellTarget({ target });
      if (pos) doLeftAction(pos.r, pos.c);
    }
  }
  touchStartXY = null;
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
  if (e.button === 0 && !getControls().leftChord && !getControls().iPadMode && isNumberedOpen(pos.r, pos.c)) {
    showPressPreview(pos.r, pos.c);
  }
}

if ($grid) {
  $grid.addEventListener('mousedown', onGridMouseDown);
  $grid.addEventListener('mouseleave', () => {
    downButtons = 0;
    clearPressPreview();
  });
  $grid.addEventListener('touchstart', onGridTouchStart, { passive: false });
  $grid.addEventListener('touchmove', onGridTouchMove, { passive: true });
  $grid.addEventListener('touchend', onGridTouchEnd, { passive: false });
  $grid.addEventListener('contextmenu', (e) => {
    if (getControls().iPadMode) e.preventDefault();
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
