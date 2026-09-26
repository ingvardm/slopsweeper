# Vendored JSMinesweeper engine

These files are copied **byte-for-byte** from
[JSMinesweeper](https://github.com/landtuna/jsminesweeper), so that the no-guess
board generator behaves exactly as it does upstream. Nothing here has been edited
— not even to add a licence header, so that each file can be compared against
upstream with `cmp`.

Do not reformat or "tidy" these files. If upstream is updated, re-copy the
files and re-run the comparison below.

## Licence

MIT, © 2022 David N Hill. The full text is in `../../../../THIRD-PARTY-NOTICES.md`,
and the About dialog in the app credits the author and links the project.

## What was taken, and from where

Everything comes from the upstream `Minesweeper/` directory:

| File here | Upstream path |
| --- | --- |
| `MinesweeperGame.js` | `Minesweeper/client/MinesweeperGame.js` |
| `solver_main.js` | `Minesweeper/client/solver_main.js` |
| `solver_probability_engine.js` | `Minesweeper/client/solver_probability_engine.js` |
| `Board.js` | `Minesweeper/client/Board.js` |
| `Tile.js` | `Minesweeper/client/Tile.js` |
| `SolutionCounter.js` | `Minesweeper/client/SolutionCounter.js` |
| `EfficiencyHelper.js` | `Minesweeper/client/EfficiencyHelper.js` |
| `FiftyFiftyHelper.js` | `Minesweeper/client/FiftyFiftyHelper.js` |
| `LongTermRiskHelper.js` | `Minesweeper/client/LongTermRiskHelper.js` |
| `Brute_force.js` | `Minesweeper/client/Brute_force.js` |
| `BruteForceAnalysis.js` | `Minesweeper/client/BruteForceAnalysis.js` |
| `PrimeSieve.js` | `Minesweeper/Utility/PrimeSieve.js` |
| `Binomial.js` | `Minesweeper/Utility/Binomial.js` |

Deliberately **not** taken: `client/main.js` and `client/main.css` (upstream's
own UI) and `client/LongTermRiskHelperOld.js` (superseded), plus
`Utility/Compression.js`, which the solver does not use.

Because the copies are unmodified, upstream's own logging comes along with them.
`noguess.js` passes `verbose: false`, which is not quite enough: `solver_main.js`
also calls `writeToConsole(text, true)` for messages it always wants printed, and
those ignore the flag. Rather than edit a vendored file, `noguess.js` mutes
`console.log`/`warn`/`info`/`debug` for the duration of the search and restores
them afterwards. `console.error` is left alone, so a genuine fault still shows.

## How the app uses it

`public/js/noguess.js` supplies the few globals the engine expects from its
original host page (`applyResults`, `GameState`, `PLAY_STYLE_NOFLAGS`, and the
same-named constants) and drives the generation loop from
`createNoGuessGame()` in `MinesweeperGame.js`. `public/index.html` loads the
files in the order `noguess.js` documents.

The engine proposes; it does not have the final say. See `public/js/board.js`
for why each proposed board is verified before use.

## Verifying these copies

With a checkout of JSMinesweeper at `$UP`:

```sh
cd public/js/vendor/jsminesweeper
for f in *.js; do
  case "$f" in
    PrimeSieve.js|Binomial.js) src="$UP/Minesweeper/Utility/$f" ;;
    *)                         src="$UP/Minesweeper/client/$f" ;;
  esac
  cmp "$f" "$src" || echo "MISMATCH: $f"
done
```

No output means every file matches upstream.
