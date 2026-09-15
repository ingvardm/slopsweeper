const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Ensure scores.json exists
const scoresFile = path.join(__dirname, 'scores.json');
if (!fs.existsSync(scoresFile)) {
  fs.writeFileSync(scoresFile, JSON.stringify([]));
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

// Start the server
app.listen(PORT, () => {
  console.log(`Minesweeper server listening on port ${PORT}`);
});
