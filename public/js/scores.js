// High-score API client: submit a victory time and render the leaderboard.
//
// Each ranked difficulty has its own top-10 list on the server, addressed by
// the index of the preset (see DIFFICULTY_ORDER in config.js). The leaderboard
// shows all of them as tabs, with the difficulty being played selected. Custom
// boards are not ranked, so they have no tab: winning one preselects the first
// difficulty instead.

function submitScore(timeSec) {
  const difficulty = currentDifficultyIndex();
  // Only reachable from the ranked flow, but guard anyway: a Custom win must
  // never be filed under a preset it was not played on.
  if (difficulty < 0) {
    $modal.classList.add('hidden');
    return;
  }
  const initials = $initialsInput.value.trim().toUpperCase().slice(0, 3);
  if (!initials) return alert('Enter initials');
  if (typeof setStoredPlayerName === 'function') setStoredPlayerName(initials);
  fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerInitials: initials, timeInSeconds: timeSec, date: new Date().toISOString(), difficulty })
  })
    .then(res => {
      if (!res.ok) throw new Error('Failed');
      return res.json();
    })
    .then(() => {
      $modal.classList.add('hidden');
      // The submitted difficulty's list just changed, so drop it from the cache
      // and show that tab with the new time highlighted.
      scoreCache.delete(difficulty);
      showScoreTab(difficulty, { playerInitials: initials, timeInSeconds: timeSec });
      $leaderboardModal.classList.remove('hidden');
    })
    .catch(err => alert('Error submitting score'));
}

const SCORE_MEDALS = ['🥇', '🥈', '🥉'];

function appendScoreRow(s, rankText, extraClass) {
  const li = document.createElement('li');
  if (extraClass) li.classList.add(extraClass);
  const rank = document.createElement('span');
  rank.className = 'score-rank';
  rank.textContent = rankText;
  const name = document.createElement('span');
  name.className = 'score-name';
  name.textContent = s.playerInitials;
  const time = document.createElement('span');
  time.className = 'score-time';
  time.textContent = formatTime(s.timeInSeconds);
  li.append(rank, name, time);
  $scoresList.appendChild(li);
  return li;
}

// highlight (optional): the just-submitted { playerInitials, timeInSeconds } for
// the tab being shown. It is marked in red; when it missed the top 10 it is
// appended as an unranked row (no rank number) instead.
//
// The difficulty currently being played is selected, or the first difficulty
// when the board is Custom, since Custom has no leaderboard of its own.
function loadScores(highlight) {
  const current = currentDifficultyIndex();
  showScoreTab(current >= 0 ? current : 0, highlight);
}

// Fetched lists, keyed by difficulty index, so flipping between tabs does not
// re-request the same board over and over. Invalidated by submitScore and the
// reset button, the only things that change the data.
const scoreCache = new Map();

// Renders one difficulty's list into #scores-list, fetching it if needed.
function renderScoreTab(index, highlight) {
  const draw = scores => {
    $scoresList.innerHTML = '';
    // An empty list is left empty on purpose: the stylesheet's
    // .scores-list:empty::after already renders "No scores yet".
    if (!Array.isArray(scores)) return;
    let marked = false;
    scores.forEach((s, i) => {
      const isNew = !!highlight && !marked &&
        s.playerInitials === highlight.playerInitials &&
        s.timeInSeconds === highlight.timeInSeconds;
      if (isNew) marked = true;
      const li = appendScoreRow(
        s,
        i < 3 ? SCORE_MEDALS[i] : `${i + 1}`,
        isNew ? 'score-new' : null
      );
      if (i < 3) li.classList.add('top-three', `rank-${i + 1}`);
    });
    if (highlight && !marked) {
      appendScoreRow(highlight, '', 'score-new');
    }
  };

  if (scoreCache.has(index)) {
    draw(scoreCache.get(index));
    return;
  }
  fetch(`/api/scores?difficulty=${index}`)
    .then(res => res.json())
    .then(scores => {
      const list = Array.isArray(scores) ? scores : [];
      scoreCache.set(index, list);
      // Only paint if this tab is still the one on screen; the player may have
      // clicked another while the request was in flight.
      if (selectedScoreTab === index) draw(list);
    })
    .catch(() => {});
}

let selectedScoreTab = -1;

// Selects a difficulty tab and shows its times.
function showScoreTab(index, highlight) {
  const total = DIFFICULTY_ORDER.length;
  if (total === 0) return;
  const clamped = Math.max(0, Math.min(total - 1, index));
  selectedScoreTab = clamped;
  for (const btn of $scoresTabs.querySelectorAll('.tab98')) {
    const isSelected = Number(btn.dataset.index) === clamped;
    btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    // Roving tabindex: only the selected tab is in the tab order, so Tab moves
    // on to the list rather than through five tabs.
    btn.tabIndex = isSelected ? 0 : -1;
  }
  renderScoreTab(clamped, highlight);
}

// Builds one tab per ranked difficulty, once. The names come from DIFFICULTIES
// so a tab can never disagree with the preset it stands for.
function populateScoreTabs() {
  $scoresTabs.textContent = '';
  DIFFICULTY_ORDER.forEach((key, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab98';
    tab.dataset.index = String(index);
    tab.dataset.key = key;
    tab.id = `scores-tab-${index}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = -1;
    const preset = DIFFICULTIES[key];
    tab.textContent = preset.label;
    // The full line (name and board) as a tooltip, since the tab is too narrow
    // to show it.
    tab.title = difficultyOptionLabel(key);
    tab.setAttribute('aria-controls', 'scores-list');
    tab.addEventListener('click', () => showScoreTab(index));
    $scoresTabs.appendChild(tab);
  });

  // Left/right (and Home/End) move between tabs, as a tab strip should.
  $scoresTabs.addEventListener('keydown', e => {
    const keys = { ArrowLeft: -1, ArrowRight: 1 };
    let next = null;
    if (e.key in keys) {
      next = (selectedScoreTab + keys[e.key] + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length;
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = DIFFICULTY_ORDER.length - 1;
    }
    if (next === null) return;
    e.preventDefault();
    showScoreTab(next);
    const target = $scoresTabs.querySelector(`.tab98[data-index="${next}"]`);
    if (target) target.focus();
  });
}

populateScoreTabs();

function resetScores() {
  const $confirmModal = document.getElementById('confirm-modal');
  const $confirmMessage = document.getElementById('confirm-message');
  const $confirmYes = document.getElementById('confirm-yes');
  const $confirmNo = document.getElementById('confirm-no');
  const $confirmClose = document.getElementById('confirm-close');
  if (!$confirmModal) return;
  $confirmMessage.textContent = 'Reset all scores? This cannot be undone.';
  $confirmModal.classList.remove('hidden');
  $confirmModal.onclick = function (e) {
    if (e.target === $confirmModal) closeConfirm();
  };
  function closeConfirm() {
    $confirmModal.classList.add('hidden');
    $confirmYes.onclick = null;
    $confirmNo.onclick = null;
    if ($confirmClose) $confirmClose.onclick = null;
  }
  $confirmYes.onclick = function () {
    closeConfirm();
    fetch('/api/scores', { method: 'DELETE' })
      .then(res => {
        if (!res.ok) throw new Error('Failed');
        // Every cached list is stale now, on every tab.
        scoreCache.clear();
        loadScores();
      })
      .catch(err => alert('Error resetting scores'));
  };
  $confirmNo.onclick = closeConfirm;
  if ($confirmClose) $confirmClose.onclick = closeConfirm;
}

const $leaderboardReset = document.getElementById('leaderboard-reset');
if ($leaderboardReset) $leaderboardReset.addEventListener('click', resetScores);
