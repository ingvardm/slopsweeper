# Minesweeper Web Game

## Overview
A classic **Minesweeper** implementation running entirely in the browser with a tiny Express backend for persisting high‑scores.

## How It Works
- **Frontend** (`public/js/`, plain `<script>` files loaded in dependency order – no build step)
  - `config.js` – board dimensions and mine count.
  - `state.js` – shared mutable game state and cached DOM references.
  - `solver.js` – logical solver that decides if a board needs no guessing.
  - `board.js` – grid construction plus the no‑guess board generator (random placement + mine‑relocation repair).
  - `gameplay.js` – revealing, chording, win/loss handling.
  - `controls.js` – configurable button/keyboard scheme (persisted in `localStorage`).
  - `ui.js` – status emoji, timer, mine counter, number colors, theme switching.
  - `scores.js` – high‑score API client.
  - `input.js` – mouse and keyboard input.
  - `main.js` – entry point: builds the grid and loads the leaderboard.
  - Generates a `ROWS × COLS` grid of clickable cells.
  - First click is safe – mines are placed after the first reveal, avoiding the clicked cell and its neighbours.
  - Left‑click reveals a cell. Pressing the left button on a revealed number previews (depresses) its neighbours; with “Left click chording” the click chords instead.
  - Right‑click cycles unmarked → flag (🚩) → question mark (❓) → unmarked and updates the mine counter (“?” can be disabled via “Use ?”).
  - Middle‑click, or left + right buttons together (“Emulate middle button”), on a revealed number chords; double‑click also triggers the chord behaviour.
  - A timer starts on the first move and stops on game over or victory.
  - **Keyboard shortcuts** (configurable, single character each, defaults in brackets) act on the last hovered cell: left click (**`x`**), right click (**`z`**), middle click / chord (**`c`**).

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
- Shared state lives in `public/js/state.js`; keep `<script>` order in `index.html` (config → state → … → main).

## Extending
- Add difficulty presets (different grid sizes/mines).
- Store scores in a real database instead of a JSON file.
- Enhance UI/UX with animations, mobile‑friendly controls, or sound effects.
