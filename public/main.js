// Minesweeper frontend logic
const ROWS = 16;
const COLS = 30;
const MINES = 99;

let grid = [];
let firstClick = true;
let revealedCount = 0;
let flagsLeft = MINES;
let lastR = null;
let lastC = null;
let gameEnded = false;

let timerInterval;

const $grid = document.getElementById('grid');
  $timer = document.getElementById('timer');
  $minesLeft = document.getElementById('mines-left');
  // Remove initial text set in initGrid (will be set via setTimer/setMinesLeft)

const $themeToggle = document.getElementById('theme-toggle');
const $statusEmoji = document.getElementById('status-emoji');
const $modal = document.getElementById('modal');
const $initialsInput = document.getElementById('initials');
const $submitScore = document.getElementById('submit-score');
const $scoresList = document.getElementById('scores-list');

function initGrid() {
  grid = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0,
    }))
  );
  $grid.innerHTML = '';
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const cellEl = document.createElement('div');
    cellEl.classList.add('cell');
    cellEl.dataset.r = r;
    cellEl.dataset.c = c;
    cellEl.addEventListener('click', onCellClick);
    cellEl.addEventListener('dblclick', e => {
      e.preventDefault();
      onCellDoubleClick(e);
    });
    cellEl.addEventListener('contextmenu', onCellRightClick);
    // Track last hovered cell for keyboard shortcuts
    cellEl.addEventListener('mouseover', () => {
      lastR = r;
      lastC = c;
    });
    $grid.appendChild(cellEl);
  }
}
  flagsLeft = MINES;
    setMinesLeft(flagsLeft);
  revealedCount = 0;
  firstClick = true;
  clearInterval(timerInterval);
  setTimer(0);
  updateStatusEmoji('default');
}

// Start the game timer and update the displayed clock emoji
function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    setTimer(seconds);
  }, 1000);
}

// Stop the timer when the game ends
function stopTimer() {
  clearInterval(timerInterval);
}

function placeMines(excludeR, excludeC) {
  let placed = 0;
  while (placed < MINES) {
    const r = Math.floor(Math.random() * ROWS);
    const c = Math.floor(Math.random() * COLS);
    // Skip excluded cell and its neighbors for first-click safety
    if (Math.abs(r - excludeR) <= 1 && Math.abs(c - excludeC) <= 1) continue;
    if (!grid[r][c].mine) {
      grid[r][c].mine = true;
      placed++;
    }
  }
  // Compute adjacent counts
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].mine) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc].mine) {
            count++;
          }
        }
      }
      grid[r][c].adjacent = count;
    }
  }
}

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


function updateStatusEmoji(state) {
  const $status = document.getElementById('status-emoji');
  if (state === 'won') $status.textContent = '😎'; // cool sunglasses
  else if (state === 'lost') $status.textContent = '💀'; // dead
  else if (state === 'key') $status.textContent = '😲'; // shocked for key/button down
  else $status.textContent = '😊'; // default smiling
}

// Replace timer update to include clock emoji and no label
function formatTime(seconds) {
  const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function setTimer(seconds) {
  const $timer = document.getElementById('timer');
  $timer.textContent = formatTime(seconds);
}

// Replace mines-left update to include bomb emoji
function setMinesLeft(count) {
  const $mines = document.getElementById('mines-left');
  const txt = count < 10 ? String(count).padStart(2, '0') : String(count);
  $mines.textContent = txt;
}

function revealCell(r, c) {
  const cell = grid[r][c];
  if (cell.revealed || cell.flagged) return;
  cell.revealed = true;
  revealedCount++;
  const cellEl = $grid.children[r * COLS + c];
  cellEl.classList.add('revealed');
  if (cell.mine) {
          cellEl.textContent = '💣';
    gameOver(false);
    return;
  }
  if (cell.adjacent > 0) {
    cellEl.textContent = cell.adjacent;
    cellEl.style.color = getNumberColor(cell.adjacent);
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
}

function getNumberColor(num) {
  const colors = {
    1: 'blue',
    2: 'green',
    3: 'red',
    4: 'navy',
    5: 'maroon',
    6: 'teal',
    7: 'black',
    8: 'gray',
  };
  return colors[num] || 'black';
}

function onCellClick(e) {
  const r = Number(e.target.dataset.r);
  const c = Number(e.target.dataset.c);
  const cell = grid[r][c];
  if (gameEnded) return;
  if (firstClick) {
    placeMines(r, c);
    startTimer();
    firstClick = false;
  }
  // Update status emoji for key/button down (mouse click)
  updateStatusEmoji('key');
  if (cell.revealed && cell.adjacent > 0) {
    chordCell(r, c);
  } else {
    revealCell(r, c);
  }
}

function onCellRightClick(e) {
  e.preventDefault();
  const r = Number(e.target.dataset.r);
  const c = Number(e.target.dataset.c);
  const cell = grid[r][c];
  if (gameEnded) return;
  if (cell.revealed) return;
  cell.flagged = !cell.flagged;
  const cellEl = $grid.children[r * COLS + c];
  if (cell.flagged) {
    cellEl.textContent = '🚩';
    cellEl.style.color = 'red';
    cellEl.classList.add('flagged');
    flagsLeft--;
  } else {
    cellEl.textContent = '';
    cellEl.style.color = '';
    cellEl.classList.remove('flagged');
    flagsLeft++;
  }
  setMinesLeft(flagsLeft);
  // Update status emoji for key/button down (right click)
  updateStatusEmoji('key');
}

function onCellDoubleClick(e) {
  if (gameEnded) return;
  const r = Number(e.target.dataset.r);
  const c = Number(e.target.dataset.c);
  const cell = grid[r][c];
  if (cell.revealed && cell.adjacent > 0) {
    chordCell(r, c);
  } else {
    revealCell(r, c);
  }
}
function gameOver(won) {
  stopTimer();
  if (!won) {
    updateStatusEmoji('lost');
    // Game over - reveal all mines as bomb emoji
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c].mine) {
          const cellEl = $grid.children[r * COLS + c];
          cellEl.textContent = '💣';
          cellEl.classList.add('revealed');
        }
      }
    }
    // Remove alert and set gameEnded flag
    gameEnded = true;
    // Optionally could show visual cue, but modal already handles win case

  } else {
    updateStatusEmoji('won');
    const timeSec = Math.floor((Date.now() - startTime) / 1000);
    $modal.classList.remove('hidden');
    $submitScore.onclick = () => submitScore(timeSec);
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

function submitScore(timeSec) {
  const initials = $initialsInput.value.trim().toUpperCase().slice(0, 3);
  if (!initials) return alert('Enter initials');
  fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerInitials: initials, timeInSeconds: timeSec, date: new Date().toISOString() })
  })
    .then(res => {
      if (!res.ok) throw new Error('Failed');
      return res.json();
    })
    .then(() => {
      $modal.classList.add('hidden');
      loadScores();
      initGrid();
    })
    .catch(err => alert('Error submitting score'));
}

function loadScores() {
  fetch('/api/scores')
    .then(res => res.json())
    .then(scores => {
      $scoresList.innerHTML = '';
      scores.forEach(s => {
        const li = document.createElement('li');
        li.textContent = `${s.playerInitials} – ${s.timeInSeconds}s`;
        $scoresList.appendChild(li);
      });
    })
    .catch(() => {});
}

// Remove new-game button handling (now handled by clicking the status emoji)
// const $newGame = document.getElementById('new-game');
// $newGame.addEventListener('click', () => {
//   initGrid();
//   gameEnded = false;
// });


// Theme toggle click handler – switches dark/light mode and updates button emoji
$themeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  // Update button emoji: sun for dark mode, moon for light mode
  $themeToggle.textContent = isDark ? '☀️' : '🌙';
});

// Initialize theme button emoji on load based on persisted theme
if (localStorage.getItem('theme') === 'dark') {
  $themeToggle.textContent = '☀️';
} else {
  $themeToggle.textContent = '🌙';
}

// Make the status emoji clickable to start a new game
$statusEmoji.style.cursor = 'pointer';
$statusEmoji.addEventListener('click', () => {
  initGrid();
  gameEnded = false;
});

// Initialize game
initGrid();
loadScores();

// Keyboard shortcuts: 'x' for reveal/chord (left click), 'z' for flag (right click)
document.addEventListener('keydown', (e) => {
  // Ignore when typing in inputs or textareas
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

  if (lastR === null || lastC === null) return;
  const key = e.key.toLowerCase();
  if (key === 'x') {
    // Simulate left click
    const mockEvent = { target: { dataset: { r: String(lastR), c: String(lastC) } } };
    onCellClick(mockEvent);
  } else if (key === 'z') {
    // Simulate right click (flag)
    const mockEvent = { target: { dataset: { r: String(lastR), c: String(lastC) } }, preventDefault: () => {} };
    onCellRightClick(mockEvent);
  }
});
