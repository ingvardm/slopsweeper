// Presentation layer: status emoji, timer, mine counter, number colors,
// and theme switching. No game rules live here.

function updateStatusEmoji(state) {
  const $status = document.getElementById('status-emoji');
  // Pure-CSS faces: JS only sets data-face, the theme owns the glyph.
  if (state === 'won') $status.dataset.face = 'won'; // Victory / Won
  else if (state === 'lost') $status.dataset.face = 'lost'; // Game Over / Lost
  else if (state === 'key') $status.dataset.face = 'suspense'; // Clicking / Suspense
  else $status.dataset.face = 'smile'; // Normal / Playing
}

function formatTime(seconds) {
  const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

// Win98-style 3-digit counter: 000..999, clamped. Used for the header LCDs.
function formatCounterValue(n) {
  const clamped = Math.max(0, Math.min(999, Math.floor(n)));
  return String(clamped).padStart(3, '0');
}

function setTimer(seconds) {
  const $timer = document.getElementById('timer');
  $timer.textContent = formatCounterValue(seconds);
}

// Start the game timer and update the displayed clock emoji
function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    if (seconds >= 999) {
      setTimer(999);
      stopTimer();
      return;
    }
    setTimer(seconds);
  }, 1000);
}

// Stop the timer when the game ends
function stopTimer() {
  clearInterval(timerInterval);
}

function setMinesLeft(count) {
  const $mines = document.getElementById('mines-left');
  // Win98 mine counter: 3 chars, supports over-flagging as "-01".."−99".
  const n = Math.floor(count);
  if (n < 0) {
    const clamped = Math.max(-99, n);
    $mines.textContent = '-' + String(Math.abs(clamped)).padStart(2, '0');
  } else {
    $mines.textContent = formatCounterValue(n);
  }
}

// Board number colors are pure CSS (.cell[data-num] + --num-* theme vars).
// Kept as a helper for any non-DOM callers; revealed cells no longer need
// inline colors, so a mid-game theme switch just works.
function getNumberColor(num) {
  return `var(--num-${num}, var(--num-default))`;
}

// Theme engine (pure CSS): JS only switches documentElement.dataset.theme.
// Available themes are the <option> values of the settings dropdown.
const THEME_STORAGE_KEY = 'slopsweeper.theme';
const DEFAULT_THEME = 'classic-light';

function availableThemes() {
  if ($themeSelect) return Array.from($themeSelect.options).map((o) => o.value);
  return ['classic-light', 'classic-dark', 'litterbox', 'fallout', 'glacier', 'sakura', 'terminal', 'grape'];
}

function normalizeTheme(t) {
  const themes = availableThemes();
  if (themes.includes(t)) return t;
  // Migrate the legacy 'theme' key ('light'/'dark' + body.dark-theme class).
  if (t === 'classic-light' || t === 'classic-dark' || t === 'litterbox' || t === 'fallout' || t === 'glacier' || t === 'sakura' || t === 'terminal' || t === 'grape') return t;
  if (t === 'light') return 'classic-light';
  if (t === 'dark') return 'classic-dark';
  return DEFAULT_THEME;
}

function currentTheme() {
  return normalizeTheme(document.documentElement.dataset.theme || DEFAULT_THEME);
}

function refreshThemeSelect() {
  if ($themeSelect) $themeSelect.value = currentTheme();
}

function setTheme(theme) {
  const next = normalizeTheme(theme);
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch (e) {}
  // Legacy cleanup: theme used to be body.dark-theme + 'theme' key.
  document.body.classList.remove('dark-theme');
  try {
    localStorage.removeItem('theme');
  } catch (e) {}
  refreshThemeSelect();
  refreshRevealedColors();
}

// Re-applies number bindings to already-revealed cells (their colors come
// from CSS via data-num, so re-setting the attribute picks up the new theme).
function refreshRevealedColors() {
  if (!Array.isArray(grid) || !$grid) return;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = grid[r] && grid[r][c];
      if (!cell || !cell.revealed || cell.mine || cell.adjacent <= 0) continue;
      const cellEl = $grid.children[r * COLS + c];
      if (cellEl) cellEl.dataset.num = String(cell.adjacent);
    }
  }
}

if ($themeSelect) $themeSelect.addEventListener('change', (e) => setTheme(e.target.value));

// Initialize theme on load based on persisted choice (default: classic light)
(function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem('theme');
  } catch (e) {}
  // Honor a server-rendered data-theme only if nothing was persisted.
  const initial = stored || document.documentElement.dataset.theme || DEFAULT_THEME;
  document.documentElement.dataset.theme = normalizeTheme(initial);
  document.body.classList.remove('dark-theme');
  refreshThemeSelect();
})();

// Make the face button start a new game (same seed rematch in multiplayer)
$statusEmoji.addEventListener('click', () => {
  if (typeof mpIsMultiplayer === 'function' && mpIsMultiplayer() && mpSeed !== null) {
    if (typeof mpStartSeededMatch === 'function') {
      mpStartSeededMatch(mpSeed);
      return;
    }
  }
  initGrid();
  gameEnded = false;
});

// High-scores pop-up (Win98 window) open/close wiring
function openLeaderboard() {
  loadScores();
  $leaderboardModal.classList.remove('hidden');
}

function closeLeaderboard() {
  $leaderboardModal.classList.add('hidden');
}

$leaderboardClose.addEventListener('click', closeLeaderboard);
$leaderboardOk.addEventListener('click', closeLeaderboard);
$leaderboardModal.addEventListener('click', (e) => {
  if (e.target === $leaderboardModal) closeLeaderboard();
});

// ---- "+" popup menu (Win98 style) ----
let pendingMenuAction = null; // 'host' | 'join' while waiting for initials

function isMenuOpen() {
  return $popupMenu && !$popupMenu.classList.contains('hidden');
}

function openMenu() {
  if (!$popupMenu) return;
  $popupMenu.classList.remove('hidden');
  $menuToggle.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  if (!$popupMenu) return;
  $popupMenu.classList.add('hidden');
  $menuToggle.setAttribute('aria-expanded', 'false');
}

if ($menuToggle) {
  $menuToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isMenuOpen()) closeMenu();
    else openMenu();
  });
}

document.addEventListener('click', (e) => {
  if (isMenuOpen() && $popupMenu && !$popupMenu.contains(e.target)) closeMenu();
});

if ($popupMenu) {
  $popupMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.popup-item');
    if (!item) return;
    const act = item.dataset.act;
    closeMenu();
    menuAction(act);
  });
}

function menuAction(act) {
  if (act === 'scores') {
    openLeaderboard();
  } else if (act === 'settings') {
    openSettings();
  } else if (act === 'host' || act === 'join') {
    if (typeof mpBusy === 'function' && mpBusy()) {
      alert('You are already in a multiplayer game.');
      return;
    }
    const name = (typeof mpLocalName === 'string' && mpLocalName) ||
      (typeof getStoredPlayerName === 'function' && getStoredPlayerName()) || '';
    if (!name) {
      pendingMenuAction = act;
      promptForName();
      return;
    }
    if (typeof mpUseName === 'function') mpUseName(name);
    else mpLocalName = name;
    if (act === 'host') mpDoHost();
    else mpDoJoin();
  }
}

// ---- Initials prompt (used when the menu needs a name) ----
function promptForName() {
  const $m = document.getElementById('name-modal');
  const $in = document.getElementById('name-prompt-input');
  if ($in) $in.value = (typeof getStoredPlayerName === 'function' && getStoredPlayerName()) || '';
  if ($m) $m.classList.remove('hidden');
  if ($in) $in.focus();
}

function closeNamePrompt() {
  const $m = document.getElementById('name-modal');
  if ($m) $m.classList.add('hidden');
  pendingMenuAction = null;
}

function submitNamePrompt() {
  const $in = document.getElementById('name-prompt-input');
  const name = (($in && $in.value) || '').trim().toUpperCase().slice(0, 16);
  if (!name) {
    alert('Enter your initials.');
    return;
  }
  const act = pendingMenuAction;
  pendingMenuAction = null;
  const $m = document.getElementById('name-modal');
  if ($m) $m.classList.add('hidden');
  if (typeof mpUseName === 'function') mpUseName(name);
  else mpLocalName = name;
  if (act === 'host' && typeof mpDoHost === 'function') mpDoHost();
  else if (act === 'join' && typeof mpDoJoin === 'function') mpDoJoin();
}

const $nameOk = document.getElementById('name-prompt-ok');
const $nameCancel = document.getElementById('name-prompt-cancel');
const $nameClose = document.getElementById('name-prompt-close');
const $nameInput = document.getElementById('name-prompt-input');
const $nameModal = document.getElementById('name-modal');
if ($nameOk) $nameOk.addEventListener('click', submitNamePrompt);
if ($nameCancel) $nameCancel.addEventListener('click', closeNamePrompt);
if ($nameClose) $nameClose.addEventListener('click', closeNamePrompt);
if ($nameInput) $nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitNamePrompt();
});
if ($nameModal) $nameModal.addEventListener('click', (e) => {
  if (e.target === $nameModal) closeNamePrompt();
});

// ---- Settings modal ----
// Window size (same behaviour as the old title-bar maximize button):
// "Normal" is the restored fixed 800x600-era window, "Large" fills the
// viewport. Persisted in localStorage, pure window chrome — the expert
// board itself never changes.
function currentWindowSize() {
  return $mainWindow.classList.contains('restored') ? 'normal' : 'large';
}

function setWindowSize(size) {
  $mainWindow.classList.toggle('restored', size === 'normal');
  try {
    localStorage.setItem('windowState', size === 'normal' ? 'restored' : 'maximized');
  } catch (e) {}
  refreshSizeButtons();
}

function refreshSizeButtons() {
  const cur = currentWindowSize();
  const $n = document.getElementById('settings-size-normal');
  const $l = document.getElementById('settings-size-large');
  if ($n) {
    $n.classList.toggle('active', cur === 'normal');
    $n.title = 'Normal window (fixed size)';
  }
  if ($l) {
    $l.classList.toggle('active', cur === 'large');
    $l.title = 'Large window (fills the viewport)';
  }
}

// Initialize window size on load (default: large / maximized)
try {
  if (localStorage.getItem('windowState') === 'restored') {
    $mainWindow.classList.add('restored');
  }
} catch (e) {}

function openSettings() {
  refreshThemeSelect();
  refreshSizeButtons();
  refreshControlsForm();
  const $in = document.getElementById('settings-initials');
  if ($in) {
    $in.value = (typeof mpLocalName === 'string' && mpLocalName) ||
      (typeof getStoredPlayerName === 'function' && getStoredPlayerName()) || '';
  }
  const $m = document.getElementById('settings-modal');
  if ($m) $m.classList.remove('hidden');
}

function closeSettings() {
  const $m = document.getElementById('settings-modal');
  if ($m) $m.classList.add('hidden');
}

const $setNormal = document.getElementById('settings-size-normal');
const $setLarge = document.getElementById('settings-size-large');
if ($setNormal) $setNormal.addEventListener('click', () => setWindowSize('normal'));
if ($setLarge) $setLarge.addEventListener('click', () => setWindowSize('large'));
// Commit the Player initials staged in the settings form. Empty input means
// "no change" (the field may simply never have been filled), so it closes
// without touching the stored name instead of blocking with an alert.
function saveSettingsName() {
  const $in = document.getElementById('settings-initials');
  const v = (($in && $in.value) || '').trim().toUpperCase().slice(0, 16);
  if (!v) return;
  if (typeof setStoredPlayerName === 'function') setStoredPlayerName(v);
  mpLocalName = v;
  if (typeof mpUpdateHud === 'function') mpUpdateHud();
  // Tell the opponent about the new name, if connected.
  if (typeof mpSendHello === 'function') mpSendHello();
}

function submitSettings() {
  saveSettingsName();
  closeSettings();
}
// ---- Settings: Gameplay (button scheme) + Keyboard shortcuts ----
function refreshControlsForm() {
  const c = getControls();
  const $ipad = document.getElementById('ctl-ipad-mode');
  const $ipadLP = document.getElementById('ctl-ipad-longpress');
  const $q = document.getElementById('ctl-use-question');
  const $l = document.getElementById('ctl-left-chord');
  const $m = document.getElementById('ctl-emulate-middle');
  const $kl = document.getElementById('ctl-key-left');
  const $kr = document.getElementById('ctl-key-right');
  const $km = document.getElementById('ctl-key-middle');
  if ($ipad) $ipad.checked = c.iPadMode;
  if ($ipadLP) $ipadLP.value = c.iPadLongPress;
  if ($q) $q.checked = c.useQuestion;
  if ($l) $l.checked = c.leftChord;
  if ($m) $m.checked = c.emulateMiddle;
  if ($kl) $kl.value = c.keyLeft;
  if ($kr) $kr.value = c.keyRight;
  if ($km) $km.value = c.keyMiddle;
  applyGameplayDisabled(c.iPadMode);
}

function applyGameplayDisabled(ipadMode) {
  document.querySelectorAll('.gameplay-opt').forEach(el => {
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.disabled = ipadMode;
  });
  document.querySelectorAll('.ipad-only').forEach(el => {
    const ctrl = el.querySelector('select, input');
    if (ctrl) ctrl.disabled = !ipadMode;
    el.style.opacity = ipadMode ? '' : '0.45';
  });
}

const $ctlIPad = document.getElementById('ctl-ipad-mode');
const $ctlIPadLP = document.getElementById('ctl-ipad-longpress');
const $ctlQuestion = document.getElementById('ctl-use-question');
const $ctlLeftChord = document.getElementById('ctl-left-chord');
const $ctlEmulateMiddle = document.getElementById('ctl-emulate-middle');
if ($ctlIPad) $ctlIPad.addEventListener('change', (e) => {
  setControls({ iPadMode: e.target.checked });
  applyGameplayDisabled(e.target.checked);
});
if ($ctlIPadLP) $ctlIPadLP.addEventListener('change', (e) => setControls({ iPadLongPress: e.target.value }));
if ($ctlQuestion) $ctlQuestion.addEventListener('change', (e) => setControls({ useQuestion: e.target.checked }));
if ($ctlLeftChord) $ctlLeftChord.addEventListener('change', (e) => setControls({ leftChord: e.target.checked }));
if ($ctlEmulateMiddle) $ctlEmulateMiddle.addEventListener('change', (e) => setControls({ emulateMiddle: e.target.checked }));

// Single-char shortcut inputs: applied on change, validated (one
// alphanumeric char, unique across the three actions).
function wireControlKeyInput(id, field) {
  const $el = document.getElementById(id);
  if (!$el) return;
  $el.addEventListener('change', () => {
    const v = ($el.value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]$/.test(v)) {
      alert('Shortcut must be a single letter or digit.');
      refreshControlsForm();
      return;
    }
    const cur = getControls();
    const others = { keyLeft: cur.keyLeft, keyRight: cur.keyRight, keyMiddle: cur.keyMiddle };
    delete others[field];
    if (Object.values(others).includes(v)) {
      alert('That key is already used by another action.');
      refreshControlsForm();
      return;
    }
    setControls({ [field]: v });
    refreshControlsForm();
  });
}
wireControlKeyInput('ctl-key-left', 'keyLeft');
wireControlKeyInput('ctl-key-right', 'keyRight');
wireControlKeyInput('ctl-key-middle', 'keyMiddle');

const $setOk = document.getElementById('settings-ok');
const $setCancel = document.getElementById('settings-cancel');
const $setClose = document.getElementById('settings-close');
const $setModal = document.getElementById('settings-modal');
if ($setOk) $setOk.addEventListener('click', submitSettings);
if ($setCancel) $setCancel.addEventListener('click', closeSettings);
if ($setClose) $setClose.addEventListener('click', closeSettings);
if ($setModal) $setModal.addEventListener('click', (e) => {
  if (e.target === $setModal) closeSettings();
});
// Enter in the initials field accepts the dialog (OK), like Win98 dialogs.
const $setInitials = document.getElementById('settings-initials');
if ($setInitials) $setInitials.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitSettings();
});

// Victory dialog close — dismiss without submitting. The won board stays
// put (gameEnded remains true); a fresh board only starts via the face
// button. Multiplayer rematch flow is unchanged.
function dismissVictoryModal() {
  $modal.classList.add('hidden');
  if (typeof mpIsMultiplayer === 'function' && mpIsMultiplayer() && mpSeed !== null) {
    if (typeof mpStartSeededMatch === 'function') mpStartSeededMatch(mpSeed);
    gameEnded = false;
  }
}
$victoryClose.addEventListener('click', dismissVictoryModal);
$modal.addEventListener('click', (e) => {
  if (e.target === $modal) dismissVictoryModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $leaderboardModal.classList.add('hidden');
    closeMenu();
    closeSettings();
    closeNamePrompt();
  }
});
