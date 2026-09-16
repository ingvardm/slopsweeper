// Board configuration (Expert-style).
const ROWS = 16;
const COLS = 30;
const MINES = 99;

// First-click opening policy: the flood-revealed region from the first click
// must hold between OPENING_MIN_CELLS and OPENING_MAX_CELLS cells (>25, <40).
// Boards outside that range are invalid and regenerated.
const OPENING_MIN_CELLS = 26;
const OPENING_MAX_CELLS = 39;
