# Third-Party Notices

Slopsweeper is distributed under the ISC License (see `package.json`). The
files below incorporate or adapt code from third-party projects, each of which
retains its own copyright and licence.

---

## JSMinesweeper

**Used by:** the difficulty and custom board model in `public/js/config.js` and
`public/js/board.js`, the no-guess generator in `public/js/noguess.js`, and the
whole of `public/js/vendor/jsminesweeper/`

**Author:** David N Hill
**Project:** <https://github.com/DavidNHill/JSMinesweeper>
**Upstream demo:** <https://davidnhill.github.io/JSMinesweeper/>

Two things come from JSMinesweeper.

**The board model.** The difficulty presets (Beginner 9x9/10, Intermediate
16x16/40, Expert 30x16/99), the custom board size model and its clamping rules,
the first-click mine exclusion scheme (safe start vs. "opening on start"), and
the exclusion-set / uniform-shuffle approach to mine placement were adapted for
this project's grid model.

**The solver engine, vendored whole.** Thirteen files under
`public/js/vendor/jsminesweeper/` are copied byte-for-byte from upstream,
including `MinesweeperGame.js`, `solver_main.js` and
`solver_probability_engine.js`. They are unmodified, including their debug
logging; the generation loop in `createNoGuessGame()` is reproduced in
`public/js/noguess.js`, and each proposed board is then verified independently by
`public/js/solver.js`. See
`public/js/vendor/jsminesweeper/PROVENANCE.md` for the file-by-file mapping,
what was deliberately left out, and how to re-check the copies against upstream.

Changes made in this project: the difficulty and size model was ported to
slopsweeper's own configuration and UI, mine placement was rewritten around
slopsweeper's grid, the generation loop was made non-blocking and bounded by a
time budget, and every generated board is verified before it is used.

```
MIT License

Copyright (c) 2022 David N Hill

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Bundled fonts

**Press Start 2P** and **Noto Color Emoji** (subset), both from Google Fonts,
are licensed under the SIL Open Font License 1.1:
<https://scripts.sil.org/OFL>
