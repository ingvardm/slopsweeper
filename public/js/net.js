// LAN multiplayer via WebRTC with server lobby signaling.
// The server hosts a game list (create/list/join) and relays the WebRTC
// offer/answer; gameplay itself stays peer-to-peer over a 'game' DataChannel.
// Both peers play their own identical board (shared seed) with the first move
// pre-played at (MP_FIRST_R, MP_FIRST_C). First to clear wins; if both hit a
// mine, most revealed cells wins.

function mpIsMultiplayer() {
  return mpMode === 'host' || mpMode === 'join';
}

function mpElapsedMs() {
  if (!mpMatchStarted || !startTime) return 0;
  if (mpLocalStatus !== 'playing' && mpLocalEndMs) return mpLocalEndMs;
  return Date.now() - startTime;
}

function mpWaitIceComplete(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') finish();
    });
    pc.addEventListener('icecandidate', (e) => {
      if (!e.candidate) finish();
    });
    // Safety timeout: host candidates are enough on LAN.
    setTimeout(finish, 4000);
  });
}

let _mpPollTimer = null;
let _mpListTimer = null;
let _mpJoinTimer = null;
let mpJoiningId = null; // game code with a join currently in progress
let _mpAnswerApplied = false; // host: guest answer received + applied
let _mpAnswerAt = 0;
let _mpConnWarned = false;
let _mpSelectedGameId = null; // currently selected game in the list
let _mpRematchRequested = false; // true after this player clicks Rematch
let _mpRemoteRematchRequested = false; // true when remote player sent rematch-request

function mpStopPolling() {
  if (_mpPollTimer) {
    clearInterval(_mpPollTimer);
    _mpPollTimer = null;
  }
}

function mpStopListRefresh() {
  if (_mpListTimer) {
    clearInterval(_mpListTimer);
    _mpListTimer = null;
  }
}

async function mpApi(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {}
  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function mpCloseConnection() {
  mpStopPolling();
  mpStopListRefresh();
  if (_mpJoinTimer) {
    clearTimeout(_mpJoinTimer);
    _mpJoinTimer = null;
  }
  mpJoiningId = null;
  _mpAnswerApplied = false;
  _mpAnswerAt = 0;
  _mpConnWarned = false;
  _mpRematchRequested = false;
  _mpRemoteRematchRequested = false;
  try {
    if (mpDc) mpDc.close();
  } catch (e) {}
  try {
    if (mpPc) mpPc.close();
  } catch (e) {}
  mpDc = null;
  mpPc = null;
  mpConnected = false;
  mpStopHeartbeat();
}

function mpWireDataChannel(dc) {
  mpDc = dc;
  mpDc.onopen = () => {
    mpConnected = true;
    mpSendHello();
    mpUpdateHud();
    mpSetNetStatus('Connected — exchanging names…');
    mpTryStart();
    mpStartHeartbeat();
  };
  mpDc.onmessage = (e) => {
    try {
      mpOnRemoteMessage(JSON.parse(e.data));
    } catch (err) {
      console.warn('Bad net message', err);
    }
  };
  mpDc.onclose = () => {
    mpConnected = false;
    mpStopHeartbeat();
    mpUpdateHud();
    mpSetNetStatus('Disconnected.');
  };
  mpDc.onerror = () => {
    mpSetNetStatus('Connection error.');
  };
}

function mpSendHello() {
  if (!mpDc || mpDc.readyState !== 'open') return;
  const msg = { t: 'hello', name: mpLocalName };
  if (mpIsHost && mpSeed !== null) msg.seed = mpSeed >>> 0;
  mpDc.send(JSON.stringify(msg));
}

// Shared entry points used by both the entry modal and the "+" menu.
function mpUseName(name) {
  mpLocalName = name;
  if (typeof setStoredPlayerName === 'function') setStoredPlayerName(name);
}

// True while hosting/joining/playing a multiplayer game (menu guards on it).
function mpBusy() {
  return mpIsMultiplayer() && (!!mpGameId || (mpMatchStarted && !mpMatchOver));
}

async function mpDoHost() {
  mpSeed = mpFreshSeed();
  mpShowPane('host');
  try {
    await mpHostCreate();
  } catch (e) {
    console.warn(e);
    mpSetNetStatus('Failed to host.');
  }
}

function mpDoJoin() {
  mpIsHost = false;
  mpMode = 'join';
  mpShowPane('join');
  mpResetSteps();
  mpSetNetStatus('Pick a hosted game to join.');
  mpRefreshGamesList();
  mpStopListRefresh();
  _mpListTimer = setInterval(() => {
    if (!mpConnected && !mpMatchStarted && !mpJoiningId) mpRefreshGamesList();
  }, 4000);
}

function mpSend(msg) {
  if (!mpDc || mpDc.readyState !== 'open') return false;
  try {
    mpDc.send(JSON.stringify(msg));
    return true;
  } catch (e) {
    return false;
  }
}

// Fresh random seed that is never equal to the previous one, so consecutive
// hosted games / rematches never repeat the same board.
function mpFreshSeed() {
  let s;
  do {
    s = (Math.random() * 0xffffffff) >>> 0;
  } while (s === mpSeed);
  return s;
}

// Rematch: both players must click Rematch before a new game starts.
// Each side sends a 'rematch-request' and waits. When the host sees both
// sides have requested, it generates a fresh seed and deals it to the guest.
function mpRequestRematch() {
  if (!mpIsMultiplayer() || mpSeed === null || _mpRematchRequested) return;
  _mpRematchRequested = true;
  mpSend({ t: 'rematch-request' });
  const $x = document.getElementById('mp-result-text');
  if ($x) $x.textContent = 'Waiting for opponent...';
  const $btn = document.getElementById('mp-result-ok');
  if ($btn) $btn.disabled = true;
  // If the remote player already requested before us, start immediately.
  if (_mpRemoteRematchRequested && mpIsHost) {
    _mpStartRematch();
  }
}

function _mpStartRematch() {
  _mpRematchRequested = false;
  _mpRemoteRematchRequested = false;
  const seed = mpFreshSeed();
  mpSend({ t: 'rematch', seed });
  mpHideResult();
  mpStartSeededMatch(seed);
}

async function mpCancelRematch() {
  mpSend({ t: 'rematch-cancel' });
  _mpRematchRequested = false;
  _mpRemoteRematchRequested = false;
  await mpLeaveLobby();
  mpMode = 'solo';
  mpIsHost = false;
  mpSeed = null;
  mpMatchStarted = false;
  mpMatchOver = false;
  mpHideResult();
  mpUpdateHud();
}

function mpOnRemoteMessage(msg) {
  if (!msg || typeof msg.t !== 'string') return;
  if (msg.t === 'hello') {
    if (typeof msg.name === 'string' && msg.name) {
      mpRemoteName = msg.name.toUpperCase().slice(0, 16);
    }
    if (!mpIsHost && Number.isInteger(msg.seed)) {
      mpSeed = msg.seed >>> 0;
    }
    // Host echoes hello back in case joiner opened first (already sent on open).
    mpUpdateHud();
    mpTryStart();
  } else if (msg.t === 'rematch' && Number.isInteger(msg.seed)) {
    if (!mpIsMultiplayer()) return;
    _mpRematchRequested = false;
    _mpRemoteRematchRequested = false;
    mpHideResult();
    mpStartSeededMatch(msg.seed >>> 0);
  } else if (msg.t === 'rematch-request') {
    if (!mpIsMultiplayer() || !mpMatchOver) return;
    _mpRemoteRematchRequested = true;
    if (mpIsHost && _mpRematchRequested) {
      _mpStartRematch();
    }
  } else if (msg.t === 'rematch-cancel') {
    if (!mpIsMultiplayer()) return;
    _mpRematchRequested = false;
    _mpRemoteRematchRequested = false;
    mpHideResult();
    mpLeaveLobby();
    mpMode = 'solo';
    mpIsHost = false;
    mpSeed = null;
    mpMatchStarted = false;
    mpMatchOver = false;
    mpUpdateHud();
  } else if (msg.t === 'state') {
    mpRemoteRevealed = Number.isInteger(msg.revealed) ? msg.revealed : 0;
    if (msg.status === 'won' || msg.status === 'lost' || msg.status === 'playing') {
      const was = mpRemoteStatus;
      mpRemoteStatus = msg.status;
      if (msg.status !== 'playing' && was === 'playing') {
        mpRemoteEndMs = Number.isInteger(msg.timeMs) ? msg.timeMs : mpElapsedMs();
      } else if (msg.status === 'playing') {
        mpRemoteTimeMs = Number.isInteger(msg.timeMs) ? msg.timeMs : 0;
      }
    }
    mpUpdateHud();
    mpDecideResult();
  }
}

function mpTryStart() {
  if (mpMatchStarted || !mpConnected || !mpRemoteName || mpSeed === null) return;
  mpMatchStarted = true; // reserve: blocks re-entry during the connect beat
  if (_mpJoinTimer) {
    clearTimeout(_mpJoinTimer);
    _mpJoinTimer = null;
  }
  mpJoiningId = null;
  if (typeof setHostingGame === 'function') setHostingGame(null);
  mpSetNetStatus('Connected — starting game…');
  mpSetHostStep(3);
  mpSetJoinStep(3);
  mpUpdateHud();
  // Brief beat so both players actually see the "Connected" state before
  // the modal closes and the boards appear.
  setTimeout(() => {
    mpHideNetModal();
    mpStartSeededMatch(mpSeed);
  }, 900);
}

function mpStartSeededMatch(seed) {
  mpSeed = seed >>> 0;
  mpMatchStarted = true;
  mpMatchOver = false;
  mpLocalStatus = 'playing';
  mpRemoteStatus = 'playing';
  mpRemoteRevealed = 0;
  mpLocalEndMs = 0;
  mpRemoteEndMs = 0;
  mpHideResult();
  initGrid();
  gameEnded = false;
  generateBoardSafe(MP_FIRST_R, MP_FIRST_C, mpSeed);
  startTimer();
  firstClick = false; // board already generated; further clicks must not regen
  revealCell(MP_FIRST_R, MP_FIRST_C);
  // revealCell may have finished instantly in theory; status already updated
  // via mpOnLocalFinish. Otherwise broadcast the opening.
  mpUpdateHud();
  mpBroadcast(true);
}

// Called from gameplay after each reveal (throttled) and on finish.
let _mpLastBroadcast = 0;
function mpOnLocalProgress() {
  if (!mpIsMultiplayer()) return;
  mpUpdateHud();
  const now = Date.now();
  if (now - _mpLastBroadcast > 300) {
    _mpLastBroadcast = now;
    mpBroadcast(false);
  }
}

function mpOnLocalFinish(won) {
  if (!mpIsMultiplayer()) return;
  mpLocalStatus = won ? 'won' : 'lost';
  mpLocalEndMs = Date.now() - startTime;
  mpBroadcast(true);
  mpUpdateHud();
  mpDecideResult();
}

function mpBroadcast(force) {
  if (!mpConnected || !mpDc || mpDc.readyState !== 'open') return;
  if (!force) {
    const now = Date.now();
    if (now - _mpLastBroadcast < 300) return;
    _mpLastBroadcast = now;
  } else {
    _mpLastBroadcast = Date.now();
  }
  mpDc.send(JSON.stringify({
    t: 'state',
    revealed: revealedCount,
    status: mpLocalStatus,
    timeMs: mpElapsedMs(),
  }));
}

let _mpHeartbeat = null;
function mpStartHeartbeat() {
  mpStopHeartbeat();
  _mpHeartbeat = setInterval(() => {
    if (mpConnected && mpMatchStarted && !mpMatchOver) mpBroadcast(true);
    mpUpdateHud();
  }, 1000);
}

function mpStopHeartbeat() {
  if (_mpHeartbeat) {
    clearInterval(_mpHeartbeat);
    _mpHeartbeat = null;
  }
}

function mpDecideResult() {
  if (!mpIsMultiplayer() || !mpMatchStarted || mpMatchOver) return;
  const localDone = mpLocalStatus !== 'playing';
  const remoteDone = mpRemoteStatus !== 'playing';

  if (mpLocalStatus === 'won' && mpRemoteStatus === 'won') {
    // Both cleared: earlier finisher wins, exact tie is a draw.
    if (mpLocalEndMs === mpRemoteEndMs) {
      mpEndMatch('draw', 'Draw!', `Both cleared in ${formatTime(Math.floor(mpLocalEndMs / 1000))}.`);
    } else if (mpLocalEndMs < mpRemoteEndMs) {
      mpEndMatch('local', 'You win!', `${mpLocalName} cleared first!`);
    } else {
      mpEndMatch('remote', `${mpRemoteName} wins!`, `${mpRemoteName} cleared first.`);
    }
    return;
  }
  if (mpLocalStatus === 'won') {
    mpEndMatch('local', 'You win!', `${mpLocalName} cleared the board first!`);
    return;
  }
  if (mpRemoteStatus === 'won') {
    mpEndMatch('remote', `${mpRemoteName} wins!`, `${mpRemoteName} cleared the board first.`);
    return;
  }
  if (localDone && remoteDone) {
    // Both hit mines: most revealed cells wins.
    if (revealedCount === mpRemoteRevealed) {
      mpEndMatch('draw', 'Draw!', `Both hit mines with ${revealedCount} cells uncovered.`);
    } else if (revealedCount > mpRemoteRevealed) {
      mpEndMatch('local', 'You win!', `Both hit mines — ${mpLocalName} uncovered ${revealedCount} vs ${mpRemoteRevealed}.`);
    } else {
      mpEndMatch('remote', `${mpRemoteName} wins!`, `Both hit mines — ${mpRemoteRevealed} vs your ${revealedCount}.`);
    }
  }
  // Otherwise the match continues (one loss alone never ends it).
}

function mpEndMatch(outcome, title, text) {
  mpMatchOver = true;
  _mpRematchRequested = false;
  _mpRemoteRematchRequested = false;
  stopTimer();
  updateStatusEmoji(outcome === 'local' ? 'won' : outcome === 'remote' ? 'lost' : 'default');
  mpUpdateHud();
  const $t = document.getElementById('mp-result-title');
  const $icon = document.getElementById('mp-result-icon');
  const $x = document.getElementById('mp-result-text');
  const $m = document.getElementById('mp-result-modal');
  if ($t) $t.textContent = title;
  // Pure-CSS result glyph: trophy for a local win, no icon otherwise.
  if ($icon) {
    if (outcome === 'local') $icon.dataset.icon = 'trophy';
    else delete $icon.dataset.icon;
  }
  if ($x) $x.textContent = text;
  const $btn = document.getElementById('mp-result-ok');
  if ($btn) $btn.disabled = false;
  if ($m) $m.classList.remove('hidden');
}

// ---- Hosting / joining (server lobby signaling for LAN) ----
// Host: creates a WebRTC offer, POSTs it as a game; polls until a guest
// POSTs an answer. Guest: picks a game from the list, creates an answer,
// POSTs it, then both connect peer-to-peer.

async function mpHostCreate() {
  mpCloseConnection();
  mpIsHost = true;
  mpMode = 'host';
  if (mpSeed === null) mpSeed = mpFreshSeed();
  mpMatchStarted = false;
  mpMatchOver = false;
  mpRemoteName = '';
  mpRemoteStatus = 'playing';
  mpRemoteRevealed = 0;
  mpConnected = false;
  mpGameId = null;
  if (typeof setHostingGame === 'function') setHostingGame(null);
  mpResetSteps();

  mpPc = new RTCPeerConnection();
  const dc = mpPc.createDataChannel('game');
  mpWireDataChannel(dc);
  mpSetNetStatus('Step 1/3 — creating game…');
  const seedEl = document.getElementById('net-seed-value');
  if (seedEl) seedEl.textContent = String(mpSeed >>> 0);
  mpUpdateHud();
  try {
    const offer = await mpPc.createOffer();
    await mpPc.setLocalDescription(offer);
    await mpWaitIceComplete(mpPc);
    const created = await mpApi('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        hostName: mpLocalName,
        seed: mpSeed >>> 0,
        offer: mpPc.localDescription.toJSON(),
      }),
    });
    mpGameId = created.id;
    if (typeof setHostingGame === 'function') setHostingGame(mpGameId);
    const $code = document.getElementById('host-code');
    if ($code) $code.textContent = mpGameId;
    mpSetHostStep(1);
    mpSetNetStatus(`Hosted as ${mpGameId} — step 2/3: waiting for an opponent…`);
    mpUpdateHud();
    mpStopPolling();
    _mpPollTimer = setInterval(mpHostPollAnswer, 2000);
  } catch (e) {
    console.warn(e);
    mpSetNetStatus('Failed to host. Is the server reachable?');
  }
}

async function mpHostPollAnswer() {
  if (!mpGameId || !mpPc) return;
  if (_mpAnswerApplied && !mpConnected && !_mpConnWarned && Date.now() - _mpAnswerAt > 15000) {
    _mpConnWarned = true;
    mpSetNetStatus('Opponent joined but we could not connect (LAN blocked?) — still trying, or Cancel and re-host.');
    return;
  }
  if (mpConnected) return;
  try {
    const g = await mpApi(`/api/games/${encodeURIComponent(mpGameId)}`);
    if (g.answer) {
      mpStopPolling();
      await mpPc.setRemoteDescription(g.answer);
      _mpAnswerApplied = true;
      _mpAnswerAt = Date.now();
      if (g.guestName) {
        mpRemoteName = String(g.guestName).toUpperCase().slice(0, 16);
        mpUpdateHud();
      }
      mpSetHostStep(2);
      mpSetNetStatus('Opponent joined — step 3/3: connecting…');
    }
  } catch (e) {
    if (e.status === 404) {
      mpStopPolling();
      mpSetNetStatus('Game was removed.');
    }
    // Otherwise keep polling (server hiccup / LAN lag).
  }
}

async function mpRefreshGamesList() {
  const $list = document.getElementById('games-list');
  if (!$list) return;
  // Hosting guard: while this browser hosts a waiting game, joining is
  // blocked entirely (own game or any other). The flag is cross-tab via
  // localStorage; verify it against the server so stale flags self-heal.
  let hostingActive = null;
  if (typeof getHostingGame === 'function') {
    const hid = getHostingGame();
    if (hid) {
      try {
        const hg = await mpApi(`/api/games/${encodeURIComponent(hid)}`);
        if (!hg.answer) hostingActive = hid;
        else setHostingGame(null);
      } catch (e) {
        if (e.status === 404) setHostingGame(null);
        else hostingActive = hid; // server hiccup: fail closed, keep blocking
      }
    }
  }
  try {
    const games = await mpApi('/api/games');
    const prevSelected = _mpSelectedGameId;
    $list.innerHTML = '';
    if (hostingActive) {
      const note = document.createElement('li');
      note.className = 'games-notice';
      note.textContent = `You are hosting ${hostingActive} — cancel it to join another game.`;
      $list.appendChild(note);
    }
    if (!games.length) {
      const li = document.createElement('li');
      li.className = 'games-empty';
      li.textContent = 'No hosted games — ask a friend to Host one.';
      $list.appendChild(li);
      return;
    }
    games.forEach((g) => {
      const li = document.createElement('li');
      li.className = 'game-row';
      const own = g.id === mpGameId;
      const blocked = hostingActive || own || mpJoiningId;
      if (!blocked) li.classList.add('selectable');
      const label = document.createElement('span');
      const age = Math.max(0, Math.round((Date.now() - g.createdAt) / 1000));
      label.textContent = `${String(g.hostName).toUpperCase()} · ${g.id} · ${age}s ago${own ? ' (yours)' : ''}`;
      li.appendChild(label);
      if (!blocked) {
        li.dataset.gameId = g.id;
        li.addEventListener('click', () => _mpSelectGame(g.id));
      }
      $list.appendChild(li);
    });
    // Restore selection if the previously selected game is still in the list.
    if (prevSelected && games.some((g) => g.id === prevSelected)) {
      _mpSelectGame(prevSelected);
    } else {
      _mpSelectedGameId = null;
      _mpUpdateJoinBtn();
    }
  } catch (e) {
    console.warn(e);
    $list.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'games-empty';
    li.textContent = 'Could not load games. Is the server reachable?';
    $list.appendChild(li);
  }
}

function _mpSelectGame(id) {
  _mpSelectedGameId = id;
  const $list = document.getElementById('games-list');
  if ($list) {
    $list.querySelectorAll('.game-row').forEach((li) => {
      li.classList.toggle('selected', li.dataset.gameId === id);
    });
  }
  _mpUpdateJoinBtn();
}

function _mpUpdateJoinBtn() {
  const $btn = document.getElementById('btn-join-game');
  if (!$btn) return;
  $btn.disabled = !_mpSelectedGameId || !!mpJoiningId;
}

async function mpJoinGame(id) {
  mpCloseConnection();
  mpIsHost = false;
  mpMode = 'join';
  mpMatchStarted = false;
  mpMatchOver = false;
  mpRemoteName = '';
  mpRemoteStatus = 'playing';
  mpRemoteRevealed = 0;
  mpConnected = false;
  mpGameId = String(id).toUpperCase();
  mpJoiningId = mpGameId;
  mpResetSteps();
  // Freeze the list while joining so nothing else can be clicked mid-flow.
  $listFreeze(true);
  mpSetNetStatus(`Step 1/3 — joining ${mpGameId}, fetching offer…`);
  mpUpdateHud();
  // Give up with a clear message if the P2P link never establishes.
  if (_mpJoinTimer) clearTimeout(_mpJoinTimer);
  _mpJoinTimer = setTimeout(() => {
    if (!mpConnected && !mpMatchStarted && mpJoiningId) {
      mpJoiningId = null;
      $listFreeze(false);
      mpSetNetStatus('Connection timed out — the host may have left. Pick another game.');
      mpRefreshGamesList();
      mpUpdateHud();
    }
  }, 15000);
  try {
    const g = await mpApi(`/api/games/${encodeURIComponent(mpGameId)}`);
    if (g.answer) {
      mpSetNetStatus('That game was just taken — pick another.');
      mpRefreshGamesList();
      return;
    }
    mpSeed = g.seed >>> 0;
    mpRemoteName = (g.hostName || '').toUpperCase();
    mpSetJoinStep(1);
    mpSetNetStatus('Step 1/3 — offer received, creating answer…');
    mpPc = new RTCPeerConnection();
    mpPc.ondatachannel = (e) => mpWireDataChannel(e.channel);
    await mpPc.setRemoteDescription(g.offer);
    const answer = await mpPc.createAnswer();
    await mpPc.setLocalDescription(answer);
    await mpWaitIceComplete(mpPc);
    mpSetNetStatus('Step 2/3 — sending answer…');
    await mpApi(`/api/games/${encodeURIComponent(mpGameId)}/join`, {
      method: 'POST',
      body: JSON.stringify({
        guestName: mpLocalName,
        answer: mpPc.localDescription.toJSON(),
      }),
    });
    mpStopListRefresh();
    mpSetJoinStep(2);
    mpSetNetStatus('Answer sent — step 3/3: connecting to host…');
    mpUpdateHud();
  } catch (e) {
    console.warn(e);
    if (_mpJoinTimer) {
      clearTimeout(_mpJoinTimer);
      _mpJoinTimer = null;
    }
    mpJoiningId = null;
    $listFreeze(false);
    if (e.status === 409) {
      mpSetNetStatus('That game was just taken — pick another.');
      mpRefreshGamesList();
    } else if (e.status === 404) {
      mpSetNetStatus('That game no longer exists.');
      mpRefreshGamesList();
    } else {
      mpSetNetStatus('Failed to join. Is the server reachable?');
    }
    mpUpdateHud();
  }
}

// Disable/enable the list and Join button (used while a join is running).
function $listFreeze(frozen) {
  const $btn = document.getElementById('btn-join-game');
  if ($btn) $btn.disabled = !!frozen;
  if (frozen) _mpSelectedGameId = null;
}

async function mpLeaveLobby() {
  mpStopPolling();
  mpStopListRefresh();
  if (typeof setHostingGame === 'function') setHostingGame(null);
  mpResetSteps();
  if (mpGameId && mpIsHost) {
    const id = mpGameId;
    mpGameId = null;
    try {
      await mpApi(`/api/games/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {}
  } else {
    mpGameId = null;
  }
  mpCloseConnection();
}

// ---- UI wiring ----

function mpSetNetStatus(text) {
  const el = document.getElementById('host-status');
  if (el) el.textContent = text;
}

// Stepper: marks the first `done` items and highlights the next as active.
function mpSetStep(listId, done) {
  const ol = document.getElementById(listId);
  if (!ol) return;
  ol.classList.remove('hidden');
  Array.from(ol.children).forEach((li, i) => {
    li.classList.toggle('done', i < done);
    li.classList.toggle('active', i === done);
  });
}
function mpSetHostStep(n) { mpSetStep('host-steps', n); }
function mpSetJoinStep(n) { mpSetStep('join-steps', n); }
function mpResetSteps() {
  ['host-steps', 'join-steps'].forEach((id) => {
    const ol = document.getElementById(id);
    if (!ol) return;
    ol.classList.add('hidden');
    Array.from(ol.children).forEach((li) => li.classList.remove('done', 'active'));
  });
}

function mpShowPane(which) {
  const $host = document.getElementById('host-modal');
  const $join = document.getElementById('join-modal');
  if ($host) $host.classList.toggle('hidden', which !== 'host');
  if ($join) $join.classList.toggle('hidden', which !== 'join');
}

function mpHideNetModal() {
  const $host = document.getElementById('host-modal');
  const $join = document.getElementById('join-modal');
  if ($host) $host.classList.add('hidden');
  if ($join) $join.classList.add('hidden');
  mpStopListRefresh();
}

function mpHideResult() {
  const $m = document.getElementById('mp-result-modal');
  if ($m) $m.classList.add('hidden');
}

function mpUpdateHud() {
  // Matchup lives in the window title bar (icon is a pure-CSS theme glyph):
  // "Slopsweeper - ALI VS BOB" (solo: plain title).
  const solo = !mpIsMultiplayer();
  // The face button starts an unsynced local board, which breaks match
  // state — disable it in multiplayer, re-enable in solo.
  if (typeof $statusEmoji !== 'undefined' && $statusEmoji) {
    $statusEmoji.disabled = !solo;
    $statusEmoji.title = solo ? 'New game' : 'New game (disabled in multiplayer)';
  }
  const $title = document.getElementById('board-title-text');
  if (!$title) return;
  $title.textContent = solo
    ? 'Slopsweeper'
    : `Slopsweeper - ${mpLocalName || 'You'} VS ${mpRemoteName || '…'}`;
}

function mpWireUI() {
  const $hostCancel = document.getElementById('btn-host-cancel');
  const $hostClose = document.getElementById('btn-host-close');
  const $joinCancel = document.getElementById('btn-join-cancel');
  const $joinClose = document.getElementById('btn-join-close');
  const $refresh = document.getElementById('btn-refresh-games');
  const $joinGame = document.getElementById('btn-join-game');
  const $resultOk = document.getElementById('mp-result-ok');
  const $resultCancel = document.getElementById('mp-result-cancel');

  // Another tab started/stopped hosting: refresh the list immediately.
  window.addEventListener('storage', (e) => {
    if (e.key === HOSTING_GAME_KEY) {
      const $join = document.getElementById('join-modal');
      if ($join && !$join.classList.contains('hidden') && !mpJoiningId) {
        mpRefreshGamesList();
      }
    }
  });

  if ($refresh) $refresh.addEventListener('click', mpRefreshGamesList);
  if ($joinGame) $joinGame.addEventListener('click', () => {
    if (_mpSelectedGameId && !mpJoiningId) mpJoinGame(_mpSelectedGameId);
  });

  const netCancel = async () => {
    await mpLeaveLobby();
    mpMode = 'solo';
    mpIsHost = false;
    mpSeed = null;
    mpMatchStarted = false;
    _mpSelectedGameId = null;
    mpHideNetModal();
    mpUpdateHud();
  };
  if ($hostCancel) $hostCancel.addEventListener('click', netCancel);
  if ($hostClose) $hostClose.addEventListener('click', netCancel);
  if ($joinCancel) $joinCancel.addEventListener('click', netCancel);
  if ($joinClose) $joinClose.addEventListener('click', netCancel);

  if ($resultOk) $resultOk.addEventListener('click', () => {
    mpRequestRematch();
  });
  if ($resultCancel) $resultCancel.addEventListener('click', () => {
    mpCancelRematch();
  });
}
