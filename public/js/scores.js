// High-score API client: submit a victory time and render the leaderboard.

function submitScore(timeSec, boardState) {
  const initials = $initialsInput.value.trim().toUpperCase().slice(0, 3);
  if (!initials) return alert('Enter initials');
  if (typeof setStoredPlayerName === 'function') setStoredPlayerName(initials);
  const body = { playerInitials: initials, timeInSeconds: timeSec, date: new Date().toISOString() };
  if (boardState) body.boardState = boardState;
  fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(res => {
      if (!res.ok) throw new Error('Failed');
      return res.json();
    })
    .then(() => {
      $modal.classList.add('hidden');
      // The won board stays put — a new game only starts via the face button.
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
  li.classList.add('score-viewable');
  li.style.cursor = 'pointer';
  li.title = 'Click to view this game state';
  li.addEventListener('click', () => {
    try {
      if (s.boardState && typeof restoreBoardState === 'function') {
        restoreBoardState(s.boardState);
      }
      $leaderboardModal.classList.add('hidden');
    } catch (e) {
      console.error('Failed to restore board state:', e);
    }
  });
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
