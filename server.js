const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// SCORES_FILE lets Docker mount a persistent volume (e.g. -v scores:/app/data).
// Defaults to ./scores.json for plain `node server.js` runs.
const scoresFile = process.env.SCORES_FILE || path.join(__dirname, 'scores.json');

// Health check for Docker HEALTHCHECK / orchestrators. No dependencies.
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the public directory (no-cache: dev game server,
// so plain reloads always pick up the latest client assets)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (/\.(html|css|js)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

// Ensure scores.json exists (create parent dir too, for mounted volumes).
// Don't crash on EACCES (e.g. TrueNAS host-path bind mounted as root/568
// while we run as uid 1000 `node`). Fall back to /tmp so the app still starts;
// scores just won't persist until perms are fixed (chown -R 1000:1000 <hostpath>).
let scoresWritable = true;
try {
  fs.mkdirSync(path.dirname(scoresFile), { recursive: true });
} catch (err) {
  console.error('Error creating scores directory:', err);
  scoresWritable = false;
}
if (scoresWritable && !fs.existsSync(scoresFile)) {
  try {
    fs.writeFileSync(scoresFile, JSON.stringify([]));
  } catch (err) {
    console.error(`Error creating scores file (${scoresFile}):`, err.code || err);
    console.error('Hint: ensure the mounted data dir is writable by uid 1000 (e.g. chown -R 1000:1000 <host dataset path>)');
    scoresWritable = false;
  }
}

// Helper to read scores safely
function readScores() {
  try {
    const data = fs.readFileSync(scoresFile, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading scores:', err);
    return [];
  }
}

// Helper to write scores safely
function writeScores(scores) {
  try {
    fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 2));
    return true;
  } catch (err) {
    console.error('Error writing scores:', err);
    return false;
  }
}

// GET top 10 scores (sorted ascending by time)
app.get('/api/scores', (req, res) => {
  const scores = readScores();
  const top = scores
    .slice()
    .sort((a, b) => a.timeInSeconds - b.timeInSeconds)
    .slice(0, 10);
  res.json(top);
});

// POST a new score
app.post('/api/scores', (req, res) => {
  const { playerInitials, timeInSeconds, date } = req.body;
  if (
    typeof playerInitials !== 'string' ||
    playerInitials.length === 0 ||
    typeof timeInSeconds !== 'number' ||
    timeInSeconds <= 0 ||
    typeof date !== 'string'
  ) {
    return res.status(400).json({ error: 'Invalid score payload' });
  }
  const scores = readScores();
  scores.push({ playerInitials, timeInSeconds, date });
  // Sort and keep all entries (client can fetch top 10)
  scores.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
  if (!writeScores(scores)) {
    return res.status(500).json({ error: 'Failed to write scores' });
  }
  res.status(201).json({ message: 'Score recorded' });
});

// ---- LAN lobby: hosted games list + WebRTC signaling relay ----
// In-memory only (LAN play session). Host POSTs its offer, joiner GETs the
// list, picks a game and POSTs its answer; host polls until the answer
// appears. Gameplay itself stays peer-to-peer over the WebRTC DataChannel.
const games = new Map(); // id -> { id, hostName, seed, offer, answer, guestName, status, createdAt, updatedAt }
const GAME_TTL_MS = 15 * 60 * 1000;

function genGameId() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let id = '';
    for (let i = 0; i < 4; i++) id += chars[(Math.random() * chars.length) | 0];
    if (!games.has(id)) return id;
  }
  return String(Date.now() % 100000);
}

function validName(n) {
  return typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 16;
}

function validSignal(s) {
  return (
    s &&
    typeof s === 'object' &&
    (s.type === 'offer' || s.type === 'answer') &&
    typeof s.sdp === 'string' &&
    s.sdp.length >= 10 &&
    s.sdp.length <= 20000
  );
}

function publicGame(g) {
  return {
    id: g.id,
    hostName: g.hostName,
    seed: g.seed,
    status: g.status,
    hasGuest: !!g.answer,
    guestName: g.guestName || null,
    createdAt: g.createdAt,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [id, g] of games) {
    if (now - g.updatedAt > GAME_TTL_MS) games.delete(id);
  }
}, 60 * 1000).unref();

// Create a hosted game (host's WebRTC offer)
app.post('/api/games', (req, res) => {
  const { hostName, seed, offer } = req.body || {};
  if (!validName(hostName)) return res.status(400).json({ error: 'Invalid hostName' });
  if (!Number.isInteger(seed)) return res.status(400).json({ error: 'Invalid seed' });
  if (!validSignal(offer) || offer.type !== 'offer') {
    return res.status(400).json({ error: 'Invalid offer' });
  }
  const id = genGameId();
  const now = Date.now();
  games.set(id, {
    id,
    hostName: hostName.trim().slice(0, 16),
    seed: seed >>> 0,
    offer,
    answer: null,
    guestName: null,
    status: 'waiting',
    createdAt: now,
    updatedAt: now,
  });
  res.status(201).json({ id, seed: seed >>> 0 });
});

// List open games (waiting for a guest), newest first
app.get('/api/games', (req, res) => {
  const now = Date.now();
  const list = [...games.values()]
    .filter((g) => !g.answer && now - g.updatedAt <= GAME_TTL_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicGame);
  res.json(list);
});

// Game detail (offer for joiner, answer for host polling)
app.get('/api/games/:id', (req, res) => {
  const g = games.get(String(req.params.id).toUpperCase());
  if (!g) return res.status(404).json({ error: 'Game not found' });
  res.json({
    ...publicGame(g),
    offer: g.offer,
    answer: g.answer,
  });
});

// Join a game (guest's WebRTC answer)
app.post('/api/games/:id/join', (req, res) => {
  const g = games.get(String(req.params.id).toUpperCase());
  if (!g) return res.status(404).json({ error: 'Game not found' });
  if (g.answer) return res.status(409).json({ error: 'Game already has an opponent' });
  const { guestName, answer } = req.body || {};
  if (!validName(guestName)) return res.status(400).json({ error: 'Invalid guestName' });
  if (!validSignal(answer) || answer.type !== 'answer') {
    return res.status(400).json({ error: 'Invalid answer' });
  }
  g.answer = answer;
  g.guestName = guestName.trim().slice(0, 16);
  g.status = 'ready';
  g.updatedAt = Date.now();
  res.json({ ok: true, seed: g.seed, hostName: g.hostName });
});

// Remove a game (cancel / cleanup)
app.delete('/api/games/:id', (req, res) => {
  const id = String(req.params.id).toUpperCase();
  if (!games.has(id)) return res.status(404).json({ error: 'Game not found' });
  games.delete(id);
  res.json({ ok: true });
});

// Start the server
const APP_VERSION = require('./package.json').version;
app.listen(PORT, HOST, () => {
  let who = 'unknown';
  try {
    who = `uid=${process.getuid()} gid=${process.getgid()}`;
  } catch {}
  let scoresAccess = 'unknown';
  try {
    fs.accessSync(scoresFile, fs.constants.W_OK);
    scoresAccess = 'writable';
  } catch (err) {
    scoresAccess = `NOT writable (${err.code || err})`;
  }
  console.log(`Minesweeper server v${APP_VERSION} listening on http://${HOST}:${PORT} (${who}, scoresFile=${scoresFile} ${scoresAccess})`);
});
