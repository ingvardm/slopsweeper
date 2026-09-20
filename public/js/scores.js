// High-score API client: submit a victory time and render the leaderboard.

function submitScore(timeSec) {
  const initials = $initialsInput.value.trim().toUpperCase().slice(0, 3);
  if (!initials) return alert('Enter initials');
  if (typeof setStoredPlayerName === 'function') setStoredPlayerName(initials);
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
function loadScores(highlight) {
  fetch('/api/scores')
    .then(res => res.json())
    .then(scores => {
      $scoresList.innerHTML = '';
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
