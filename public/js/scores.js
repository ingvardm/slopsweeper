// High-score API client: submit a victory time and render the leaderboard.
//
// Each ranked difficulty has its own top-10 list on the server, addressed by
// the index of the preset (see DIFFICULTY_ORDER in config.js). Custom boards
// are not ranked, so they neither read nor write a list.

// Relabels the leaderboard so it is always clear which difficulty the times
// belong to — times from a 9x9 and a 30x30 are not comparable.
function updateScoresHeading() {
  const $legend = document.querySelector('#leaderboard .groupbox legend');
  if ($legend) $legend.textContent = `Fastest times — ${currentDifficultyLabel()}`;
}

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
      loadScores({ playerInitials: initials, timeInSeconds: timeSec });
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

// highlight (optional): the just-submitted { playerInitials, timeInSeconds }.
// It is shown in red; when it missed the top 10 it is appended as an
// unranked row (no rank number) instead.
//
// Always renders the list for the difficulty currently being played.
function loadScores(highlight) {
  const difficulty = currentDifficultyIndex();
  updateScoresHeading();
  if (difficulty < 0) {
    // Custom: nothing is ranked, so say so rather than showing another
    // difficulty's times.
    $scoresList.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'scores-notice';
    li.textContent = 'Custom boards are not ranked. Pick one of the five presets to keep a time.';
    $scoresList.appendChild(li);
    return;
  }
  fetch(`/api/scores?difficulty=${difficulty}`)
    .then(res => res.json())
    .then(scores => {
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
    })
    .catch(() => {});
}

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
        loadScores();
      })
      .catch(err => alert('Error resetting scores'));
  };
  $confirmNo.onclick = closeConfirm;
  if ($confirmClose) $confirmClose.onclick = closeConfirm;
}

const $leaderboardReset = document.getElementById('leaderboard-reset');
if ($leaderboardReset) $leaderboardReset.addEventListener('click', resetScores);
