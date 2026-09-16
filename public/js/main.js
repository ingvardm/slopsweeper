// Application entry point: build an empty grid and fetch the leaderboard.
// All other files above only define functions and wire event listeners.

initGrid();
loadScores();

// Multiplayer entry points live in the "+" menu (hosting prompts for a name
// when none is stored). The page loads straight into a playable solo board.
if (typeof mpWireUI === 'function') mpWireUI();
if (typeof mpUpdateHud === 'function') mpUpdateHud();

// Prefill victory-modal initials from the last stored value.
(function prefillPlayerName() {
  const stored = typeof getStoredPlayerName === 'function' ? getStoredPlayerName() : '';
  if (!stored) return;
  if (typeof $initialsInput !== 'undefined' && $initialsInput && !$initialsInput.value) {
    $initialsInput.value = stored.toUpperCase().slice(0, 3);
  }
})();
