# Minesweeper Web Game

## Overview
A classic **Minesweeper** implementation running entirely in the browser with a tiny Express backend for persisting high‑scores.

## How It Works
- **Frontend** (`public/js/`, plain `<script>` files loaded in dependency order – no build step)
  - `config.js` – difficulty presets, custom board sizing, the first‑click exclusion policy and the live `ROWS`/`COLS`/`MINES` (persisted in `localStorage`).
  - `state.js` – shared mutable game state and cached DOM references.
  - `solver.js` – logical solver that decides if a board can be finished by deduction alone.
  - `vendor/jsminesweeper/` – the vendored [JSMinesweeper](https://github.com/DavidNHill/JSMinesweeper) solver engine (MIT, unmodified; see its `PROVENANCE.md`).
  - `noguess.js` – drives that engine to propose no‑guess boards.
  - `board.js` – grid construction plus the board generator (random placement + no‑guess generation and verification).
  - `gameplay.js` – revealing, chording, win/loss handling.
  - `controls.js` – configurable button/keyboard scheme (persisted in `localStorage`).
  - `ui.js` – status emoji, timer, mine counter, number colors, theme switching, settings dialog.
  - `scores.js` – high‑score API client.
  - `input.js` – mouse and keyboard input.
  - `main.js` – entry point: builds the grid and loads the leaderboard.
  - Generates a `ROWS × COLS` grid of clickable cells.
  - First click is safe – mines are placed after the first reveal, avoiding the clicked cell. With **Opening on start** the whole 3×3 neighbourhood is kept mine‑free too; small boards that cannot spare the 3×3 fall back to the plain safe start.
  - Left‑click reveals a cell. Pressing the left button on a revealed number previews (depresses) its neighbours; with “Left click chording” the click chords instead.
  - Right‑click cycles unmarked → flag (🚩) → question mark (❓) → unmarked and updates the mine counter (“?” can be disabled via “Use ?”).
  - Middle‑click, or left + right buttons together (“Emulate middle button”), on a revealed number chords; double‑click also triggers the chord behaviour.
  - A timer starts on the first move and stops on game over or victory.
  - **Keyboard shortcuts** (configurable, single character each, defaults in brackets) act on the last hovered cell: left click (**`x`**), right click (**`z`**), middle click / chord (**`c`**).

- **Backend** (`server.js`)
  - Serves static assets from `public/`.
  - Provides `/api/scores` (GET/POST/DELETE) for a JSON‑file‑based high‑score
    list (`scores.json`). See [High scores](#high-scores).

## High scores

`scores.json` is an array of per‑difficulty buckets, one per ranked preset, and
each bucket is a list of `{ playerInitials, timeInSeconds, date }` sorted fastest
first. The bucket index is the difficulty's position in `DIFFICULTIES`
(`public/js/config.js`), which is the single source of truth for both the order
and the names:

| Index | Difficulty | Board |
| --- | --- | --- |
| 0 | I'm Too Young To Die | 9×9 / 10 |
| 1 | Hey, Not Too Rough | 16×16 / 40 |
| 2 | Hurt Me Plenty | 30×16 / 99 |
| 3 | Ultra-Violence | 30×30 / 225 |
| 4 | Nightmare! | 30×30 / 250 |

The leaderboard shows all five as a Windows 98 style tab strip, built from
`DIFFICULTIES` by `populateScoreTabs()` in `public/js/scores.js` so a tab can never
disagree with the preset it stands for. The tab for the difficulty being played is
selected when the board opens; arrow keys, Home and End move between tabs, and only
the selected tab is in the tab order. Switching tabs reuses a per‑difficulty cache
(`scoreCache`), which the submit and reset paths clear when the data changes.

- `GET /api/scores?difficulty=N` returns that bucket's top 10. An out‑of‑range
  index is a `400`; omitting it means `0`.
- `POST /api/scores` takes the same `difficulty` in the body and appends to that
  bucket only.
- `DELETE /api/scores` resets every bucket by copying `init-scores.json`.

**Custom boards are not ranked.** Their size is arbitrary, so a time would not be
comparable with a preset's; winning one shows a "Board cleared" dialog instead of
the initials prompt. Since there is no Custom tab, the leaderboard preselects the
first difficulty instead.

Older deployments may still have a flat list from before scores were split by
difficulty (for example a Docker volume). The server migrates that shape on first
read, keeping the entries under **Hurt Me Plenty** and logging what it moved, so
no history is lost on upgrade. Malformed or partially written files are read
defensively: invalid entries are dropped and missing buckets come back empty
rather than failing the request.

## Board Generation

Settings → Board controls the board shape and how it is generated. All of it is
persisted in `localStorage` under `slopsweeper.boardConfig`, and any change
starts a fresh board.

- **Difficulty** – one of five presets or Custom:

  | Preset | Size | Mines |
  | --- | --- | --- |
  | I'm Too Young To Die | 9×9 | 10 |
  | Hey, Not Too Rough | 16×16 | 40 |
  | Hurt Me Plenty | 30×16 | 99 |
  | Ultra-Violence | 30×30 | 225 |
  | Nightmare! | 30×30 | 250 |

  The preset list lives in `DIFFICULTIES` in `config.js` and the settings
  dropdown is generated from it, so the labels and the sizes cannot drift apart.
  Custom accepts 1–250 per axis; the mine count is clamped to what is left of
  the board once the first‑click zone is reserved. The choice, the custom size
  and both generation options are saved to `localStorage` and restored on the
  next visit. The window and grid tracks follow the board through the
  `--board-cols` / `--board-rows` custom properties, so nothing in the CSS is
  hardcoded to 30×16.
- **No‑guess boards** – when the option is on, a board is *proposed* by the
  vendored JSMinesweeper engine, which relocates mines where deduction stalls,
  and then *verified* by `solver.js` before it is used. With the option off the
  first draw is taken as is and the game starts instantly.
- **Opening on start** – the first click is guaranteed a mine‑free 3×3 area
  rather than just a safe cell.
- **Multi‑threaded generation** – off by default. When on, the propose‑and‑verify
  work runs in web workers racing each other instead of one candidate at a time on
  the main thread. It needs *No‑guess boards*, since with that off there is
  nothing to parallelise; **Workers** sets how many to start (1–32, default 8)
  and is dimmed while the feature is off.

Why both halves. Proposing by relocating mines is what makes dense boards
possible at all: on a 30×30 board with 250 mines, *no* randomly placed layout is
solvable by pure deduction (measured 0 of 25), so searching for one by redrawing
cannot succeed. Verifying separately is what makes the promise true: the
engine's internal model is rewritten by every relocation, so it reaches “solved”
using information a player never gets. Roughly half of its candidates survive an
independent check, so a few attempts per board are normal.

### Multi-threaded generation

`gen-worker.js` is a classic worker that `importScripts` the same vendored engine,
`noguess.js` and `solver.js` the main thread runs — the same files, not a second
copy free to drift. Each worker owns the whole pipeline for one attempt,
verification included, because verifying on the main thread would block the very
UI the workers exist to keep responsive. A worker only reports a board after
`solver.js` has confirmed it, so the first message the main thread receives is
final: it is applied immediately and every other worker is `terminate()`d
mid-search.

A worker retries while the overall budget allows rather than giving up after its
first candidate, which is what makes the race worth having — on a large board a
single attempt routinely needs longer than `GENERATION_CANDIDATE_BUDGET_MS`, and
without the retry every worker failed at the same instant. Boards so small that
no no-guess layout exists (2×2/1) hit the engine's board limit instead and stop
at once. If no worker wins, no worker can be created, or a worker faults, the
click still lands on a valid random board as before.

Measured on 18 cores with the identical pipeline in N OS threads, median of
three:

| Board | 1 thread | 2 | 4 | 8 |
| --- | --- | --- | --- | --- |
| 30×30/250 (Nightmare!) | 1814 ms | 499 ms | 599 ms | **326 ms** |
| 60×40/700 | 20043 ms | 20054 ms | 20059 ms | 20073 ms |
| 100×100/2000 | 20038 ms | 15862 ms | 9494 ms | 13986 ms |

Read that honestly. On the presets, where a verified board normally lands in a few
hundred milliseconds, workers cut the wait several‑fold — that is the case the
setting is for. On 60×40/700 nothing verifies at any thread count, so the workers
burn the full budget and the random fallback is used, exactly as the
single‑threaded path does after one candidate: same board, but the wait is the
whole budget rather than one candidate slice. On 100×100/2000 the result is
genuinely better with workers (one 8‑thread run found a verified board in 3.5 s
where a single thread never did) but the spread is wide, because it depends on
whether a lucky attempt comes up. The app bounds all of this with
`GENERATION_BUDGET_MS`, so a first click can never wait longer than that.

The search is bounded by `GENERATION_BUDGET_MS` and
`GENERATION_CANDIDATE_BUDGET_MS` in `config.js`, and it yields to the event loop
while it works, so a first click can never hang the page. Measured over ten first
clicks each, the presets and ordinary custom boards never approach the limit
(30×30/250 averages 246 ms, 50×40/400 averages 85 ms). Only an extreme board
like 100×100/2000 does, and then roughly one first click in five exhausts the
budget: the board is still valid and playable, just not guaranteed guess‑free,
and the reason is logged to the console.

## Credits

The board generation model — the difficulty presets, the custom board sizing
rules and the safe / “opening on start” first‑click exclusion scheme — is
adapted from [JSMinesweeper](https://github.com/DavidNHill/JSMinesweeper) by
David N Hill, used under the MIT License. Its solver engine is vendored in full,
byte‑for‑byte and unmodified, under `public/js/vendor/jsminesweeper/`, and
`noguess.js` reproduces that project's own no‑guess generation loop. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for the full text and
`public/js/vendor/jsminesweeper/PROVENANCE.md` for the file‑by‑file mapping.

## Running the Project
```bash
npm install        # install dependencies
node server.js     # start the Express server (default port 3000)
open http://localhost:3000
```

Environment variables: `PORT` (default `3000`), `HOST` (default `0.0.0.0`),
`SCORES_FILE` (default `./scores.json`). Health check: `GET /health` → `{"ok":true}`.

## Docker

```bash
# Build
docker build -t slopsweeper:latest .

# Run (persists high-scores in a named volume)
docker run -d --name slopsweeper -p 3000:3000 -v scores:/app/data slopsweeper:latest
open http://localhost:3000

# Or with Compose
docker compose up --build -d
```

### TrueNAS: EACCES on /app/data/scores.json

With **host-path** storage plus a forced non-root run-as user (e.g. `568`),
`POST /api/scores` fails with `EACCES`: the container never runs as root, so
its boot-time ownership repair cannot run, and a root-owned dataset stays
unwritable. Fix ownership on the host once (replace UID and path with yours):

```bash
# On the TrueNAS shell:
sudo chown -R 568:568 /mnt/<pool>/slopsweeper-data
```

Image `1.0.2+` prints the exact UID at startup — look for these lines in the
app log and match the dataset owner to the printed `uid`:

```
docker-entrypoint: uid=568 gid=568, SCORES_FILE=/app/data/scores.json
Minesweeper server v1.0.2 listening on ... (uid=568 gid=568, scoresFile=/app/data/scores.json NOT writable (EACCES))
```

Alternative: remove the run-as override so the container starts as root —
the entrypoint then chowns `/app/data` to `node` and drops privileges itself.

### Push to a registry

For future pushes, use this command:

```bash
docker buildx build --push --platform linux/amd64,linux/arm64 -t ingvardm/minesweeper:VERSION -t ingvardm/minesweeper:latest .
```

Pull/run anywhere with Docker:

```bash
docker run -d --name slopsweeper -p 3000:3000 -v scores:/app/data ingvardm/minesweeper:latest
```

## Development Notes
- `timerInterval` is declared globally to avoid `ReferenceError` when resetting the timer.
- The UI theme can be toggled with the button; the choice is persisted in `localStorage`.
- Shared state lives in `public/js/state.js`; keep `<script>` order in `index.html` (config → state → … → main).
- `ROWS`/`COLS`/`MINES` are `let` globals in `config.js`, not `const` — the difficulty selector rewrites them. Read them at call time, never cache them at load time.
- The Board groupbox is disabled during a LAN multiplayer match, since both peers must generate the same board.
- `MAX_GENERATION_WORKERS` lives in `config.js`, not `board.js`, on purpose: the board-config sanitizer reads it and runs during `config.js`'s own load, so a `const` in the later `board.js` would be in its temporal dead zone and throw.
- Anything the worker needs must reach it as data. `gen-worker.js` cannot read `config.js` (it touches the DOM), so budgets and board dimensions are sent in the `generate` message and installed as the globals the vendored engine and `solver.js` already expect.
- Adding a sixth difficulty means touching four places, not one: `DIFFICULTIES` in `config.js` (which both the board dropdown and the leaderboard tab strip are generated from), `DIFFICULTY_COUNT` and `DIFFICULTY_NAMES` in `server.js`, and the bucket count in both `init-scores.json` and `scores.json`. The score bucket index is the difficulty's position in `DIFFICULTIES`, so the two orders must stay in step or times get filed under the wrong name.
- `npm test` is a placeholder; there is no test harness in the repo.

## Extending
- Store scores in a real database instead of a JSON file.
- Make no‑guess boards shareable by seeding mine placement (a seed is already exchanged in multiplayer, but nothing consumes it yet, so peers currently generate *different* boards).
- Enhance UI/UX with animations, mobile‑friendly controls, or sound effects.
