const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// SCORES_FILE lets Docker mount a persistent volume (e.g. -v scores:/app/data).
// Defaults to ./scores.json for plain `node server.js` runs.
const scoresFile = process.env.SCORES_FILE || path.join(__dirname, 'scores.json');
const initScoresFile = path.join(__dirname, 'init-scores.json');

// The scores file is an array of per-difficulty buckets, one per ranked
// preset, in the order the client numbers them (DIFFICULTIES in
// public/js/config.js is the source of truth for that order and for the names):
//
//   0  I'm Too Young To Die   9x9 / 10
//   1  Hey, Not Too Rough    16x16 / 40
//   2  Hurt Me Plenty        30x16 / 99
//   3  Ultra-Violence        30x30 / 225
//   4  Nightmare!            30x30 / 250
//
// Custom boards are not ranked, so they have no bucket.
const DIFFICULTY_COUNT = 5;
// Kept in step with the names above purely for logging, so a mismatch with the
// client shows up at boot instead of as a mislabelled leaderboard.
const DIFFICULTY_NAMES = [
  "I'm Too Young To Die",
  'Hey, Not Too Rough',
  'Hurt Me Plenty',
  'Ultra-Violence',
  'Nightmare!',
];
// Where scores from the old flat format land: Hurt Me Plenty, the preset the
// seeded dev entries were played on.
const LEGACY_BUCKET = 2;

// A scores file with one empty array per difficulty.
function emptyScoreBuckets() {
  const buckets = [];
  for (let i = 0; i < DIFFICULTY_COUNT; i++) buckets.push([]);
  return buckets;
}

// Ensure scores.json exists by copying init-scores.json if missing.
try {
  if (!fs.existsSync(scoresFile)) {
    if (fs.existsSync(initScoresFile)) {
      fs.copyFileSync(initScoresFile, scoresFile);
    } else {
      fs.writeFileSync(scoresFile, JSON.stringify(emptyScoreBuckets(), null, 2));
    }
  }
} catch (err) {
  console.error('Error initializing scores file:', err);
}

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
    fs.writeFileSync(scoresFile, JSON.stringify(emptyScoreBuckets(), null, 2));
  } catch (err) {
    console.error(`Error creating scores file (${scoresFile}):`, err.code || err);
    console.error('Hint: ensure the mounted data dir is writable by uid 1000 (e.g. chown -R 1000:1000 <host dataset path>)');
    scoresWritable = false;
  }
}

// The scores file is an array of per-difficulty buckets; see DIFFICULTY_COUNT
// at the top of this file for the bucket order. One score entry, dropping
// anything that isn't the expected shape.
function isValidScore(s) {
  return !!s && typeof s === 'object' && typeof s.playerInitials === 'string' &&
    s.playerInitials.length > 0 && typeof s.timeInSeconds === 'number' &&
    Number.isFinite(s.timeInSeconds) && s.timeInSeconds > 0;
}

// Coerces whatever is on disk into exactly DIFFICULTY_COUNT buckets of valid
// entries, so a malformed or older file can never crash a request.
function normalizeScores(data) {
  const buckets = [];
  for (let i = 0; i < DIFFICULTY_COUNT; i++) buckets.push([]);

  // A pre-difficulty file was a flat list of scores with no bucket of their own.
  // Those entries are kept rather than dropped, and filed under the preset their
  // times most likely came from, so an existing deployment (e.g. a Docker
  // volume) keeps its history through the upgrade.
  if (Array.isArray(data) && data.every(isValidScore)) {
    buckets[LEGACY_BUCKET] = data.slice();
    return { buckets, migratedLegacy: data.length > 0 };
  }

  if (Array.isArray(data)) {
    for (let i = 0; i < Math.min(DIFFICULTY_COUNT, data.length); i++) {
      if (Array.isArray(data[i])) buckets[i] = data[i].filter(isValidScore);
    }
  }
  return { buckets, migratedLegacy: false };
}

// Helper to read scores safely
function readScores() {
  try {
    const data = JSON.parse(fs.readFileSync(scoresFile, 'utf-8'));
    const { buckets, migratedLegacy } = normalizeScores(data);
    if (migratedLegacy) {
      // Rewrite once so the migration is not repeated on every request.
      console.log(
        `Migrated ${buckets[LEGACY_BUCKET].length} score(s) from the old flat ` +
          `format into "${DIFFICULTY_NAMES[LEGACY_BUCKET]}"`
      );
      writeScores(buckets);
    }
    return buckets;
  } catch (err) {
    console.error('Error reading scores:', err);
    return emptyScoreBuckets();
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

// Parses and range-checks a difficulty bucket index. The default keeps an
// unparameterised request working (an old bookmarked URL, say) rather than
// failing it.
function parseDifficulty(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n >= DIFFICULTY_COUNT) return null;
  return n;
}

// GET top 10 scores for one difficulty (sorted ascending by time)
app.get('/api/scores', (req, res) => {
  const difficulty = parseDifficulty(req.query.difficulty);
  if (difficulty === null) {
    return res.status(400).json({ error: `difficulty must be 0..${DIFFICULTY_COUNT - 1}` });
  }
  const top = readScores()[difficulty]
    .slice()
    .sort((a, b) => a.timeInSeconds - b.timeInSeconds)
    .slice(0, 10);
  res.json(top);
});

// POST a new score into one difficulty's bucket
app.post('/api/scores', (req, res) => {
  const { playerInitials, timeInSeconds, date } = req.body;
  if (
    typeof playerInitials !== 'string' ||
    playerInitials.length === 0 ||
    typeof timeInSeconds !== 'number' ||
    !Number.isFinite(timeInSeconds) ||
    timeInSeconds <= 0 ||
    typeof date !== 'string'
  ) {
    return res.status(400).json({ error: 'Invalid score payload' });
  }
  const difficulty = parseDifficulty(req.body.difficulty);
  if (difficulty === null) {
    return res.status(400).json({ error: `difficulty must be 0..${DIFFICULTY_COUNT - 1}` });
  }
  const scores = readScores();
  scores[difficulty].push({ playerInitials, timeInSeconds, date });
  // Sort and keep all entries (client can fetch top 10)
  scores[difficulty].sort((a, b) => a.timeInSeconds - b.timeInSeconds);
  if (!writeScores(scores)) {
    return res.status(500).json({ error: 'Failed to write scores' });
  }
  res.status(201).json({ message: 'Score recorded' });
});

// DELETE all scores, every difficulty (reset)
app.delete('/api/scores', (req, res) => {
  try {
    if (fs.existsSync(initScoresFile)) {
      fs.copyFileSync(initScoresFile, scoresFile);
    } else {
      fs.writeFileSync(scoresFile, JSON.stringify(emptyScoreBuckets(), null, 2));
    }
  } catch (err) {
    console.error('Error resetting scores file:', err);
    return res.status(500).json({ error: 'Failed to reset scores' });
  }
  res.status(200).json({ message: 'Scores reset' });
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
