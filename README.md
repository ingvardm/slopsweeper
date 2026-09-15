# Minesweeper Web Game

## Overview
A classic **Minesweeper** implementation running entirely in the browser with a tiny Express backend for persisting high‑scores.

## How It Works
- **Frontend** (`public/main.js`)
  - Generates a `ROWS × COLS` grid of clickable cells.
  - First click is safe – mines are placed after the first reveal, avoiding the clicked cell and its neighbours.
  - Left‑click reveals a cell (or “chords” when the number of surrounding flags matches the cell’s number).
  - Right‑click toggles a flag (`P`) and updates the mine counter.
  - Double‑click also triggers the chord behaviour.
  - A timer starts on the first move and stops on game over or victory.
  - **Keyboard shortcuts** – press **`x`** to simulate a left‑click and **`z`** to simulate a right‑click on the last hovered cell.

- **Backend** (`server.js`)
  - Serves static assets from `public/`.
  - Provides `/api/scores` endpoint (GET/POST) to read and write a simple JSON‑file‑based high‑score list (`scores.json`).

## Running the Project
```bash
npm install        # install dependencies
node server.js     # start the Express server (default port 3000)
open http://localhost:3000
```

## Development Notes
- `timerInterval` is declared globally to avoid `ReferenceError` when resetting the timer.
- The UI theme can be toggled with the button; the choice is persisted in `localStorage`.
- All game logic lives in the single `main.js` file – easy to extend or refactor.

## Extending
- Add difficulty presets (different grid sizes/mines).
- Store scores in a real database instead of a JSON file.
- Enhance UI/UX with animations, mobile‑friendly controls, or sound effects.
