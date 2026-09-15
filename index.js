
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

const scoresFile = path.join(__dirname, 'scores.json');

// Ensure scores.json exists
if (!fs.existsSync(scoresFile)) {
  fs.writeFileSync(scoresFile, JSON.stringify([]));
}

// Helper to read scores
function readScores() {
  try {
    const data = fs.readFileSync(scoresFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading scores:', err);
    return [];
  }
}

// Helper to write scores
function writeScores(scores) {
  try {
    fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 2));
  } catch (err) {
    console.error('Error writing scores:', err);
  }
}

// GET top 10 scores
app.get('/api/scores', (req, res) => {
  const scores = readScores();
  const top = scores
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
    return res.status(400).json({ error: 'Invalid score data' });
  }
  const scores = readScores();
  scores.push({ playerInitials, timeInSeconds, date });
  writeScores(scores);
  res.status(201).json({ message: 'Score recorded' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
