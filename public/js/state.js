// Shared mutable game state plus cached DOM references.
// Plain scripts share these via the global scope – load this file first.
//
// Board model: grid[r][c] = { mine, revealed, flagged, question, adjacent }
let grid = [];
let firstClick = true;
let revealedCount = 0;
let flagsLeft = MINES;
let lastR = null;
let lastC = null;
let gameEnded = false;
let triggeredMine = null; // Tracks the mine that caused the loss

let timerInterval;
let startTime = 0;

const $grid = document.getElementById('grid');
const $timer = document.getElementById('timer');
const $minesLeft = document.getElementById('mines-left');

const $statusEmoji = document.getElementById('status-emoji');
const $modal = document.getElementById('modal');
const $initialsInput = document.getElementById('initials');
const $submitScore = document.getElementById('submit-score');
const $scoresList = document.getElementById('scores-list');
const $mainWindow = document.querySelector('.main-window');
const $menuToggle = document.getElementById('menu-toggle');
const $popupMenu = document.getElementById('popup-menu');
const $themeSelect = document.getElementById('theme-select');
const $leaderboardModal = document.getElementById('leaderboard-modal');
const $leaderboardClose = document.getElementById('leaderboard-close');
const $leaderboardOk = document.getElementById('leaderboard-ok');
const $victoryClose = document.getElementById('victory-close');

// ---- LAN multiplayer (WebRTC, server lobby signaling) ----
// mpMode: 'solo' | 'host' | 'join'. In host/join both peers generate the
// identical board from mpSeed and pre-play cell (MP_FIRST_R, MP_FIRST_C).
// First to reveal all safe cells wins; if both hit mines, most revealed wins.
const MP_FIRST_R = 7;
const MP_FIRST_C = 15;
let mpMode = 'solo';
let mpIsHost = false;
let mpLocalName = '';
let mpRemoteName = '';
let mpSeed = null;
let mpPc = null;
let mpDc = null;
let mpConnected = false;
let mpMatchStarted = false;
let mpMatchOver = false;
let mpLocalStatus = 'playing'; // playing | won | lost
let mpRemoteStatus = 'playing';
let mpRemoteRevealed = 0;
let mpRemoteTimeMs = 0;
let mpLocalEndMs = 0;
let mpRemoteEndMs = 0;
let mpGameId = null; // server lobby game code (host + guest)

// ---- Persisted player name (localStorage) ----
// Single shared value: used for the multiplayer name, the victory modal
// (#initials) and Settings; last used name wins.
const PLAYER_NAME_KEY = 'slopsweeper.playerName';
function getStoredPlayerName() {
  try {
    return (localStorage.getItem(PLAYER_NAME_KEY) || '').trim().toUpperCase().slice(0, 16);
  } catch (e) {
    return '';
  }
}
function setStoredPlayerName(name) {
  try {
    const v = String(name || '').trim().toUpperCase().slice(0, 16);
    if (v) localStorage.setItem(PLAYER_NAME_KEY, v);
  } catch (e) {}
}

// ---- Lobby hosting guard (localStorage) ----
// Tracks this browser's actively-hosted waiting game so the join list can
// block joining (own game or any game) while hosting — works across tabs.
const HOSTING_GAME_KEY = 'slopsweeper.hostingGame';
function getHostingGame() {
  try {
    return (localStorage.getItem(HOSTING_GAME_KEY) || '').trim().toUpperCase() || null;
  } catch (e) {
    return null;
  }
}
function setHostingGame(id) {
  try {
    if (id) localStorage.setItem(HOSTING_GAME_KEY, String(id).toUpperCase());
    else localStorage.removeItem(HOSTING_GAME_KEY);
  } catch (e) {}
}
