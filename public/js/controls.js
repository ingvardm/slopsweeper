// Configurable button/keyboard scheme (the classic scheme is non-standard,
// so every deviation from it lives here). Persisted in localStorage.
// Plain scripts share these via the global scope – load after state.js.
//
// - iPadMode: touch-optimised scheme — single tap always chords, long-press
//   flags, "?" is disabled, and the other gameplay options are overridden.
// - iPadLongPress: long-press duration in iPad mode ('fast'=200, 'medium'=300, 'slow'=450)
// - useQuestion: right-click cycle includes "?" (unmarked -> flag -> ? -> unmarked)
// - leftChord: left-click on a revealed number chords (otherwise it previews)
// - emulateMiddle: pressing left+right together on a revealed number chords
// - keyLeft/keyRight/keyMiddle: single-char shortcuts acting on the last hovered cell
const CONTROLS_KEY = 'slopsweeper.controls';
const DEFAULT_CONTROLS = {
  iPadMode: false,
  iPadLongPress: 'medium',
  useQuestion: true,
  leftChord: false,
  emulateMiddle: true,
  keyLeft: 'X',
  keyRight: 'Z',
  keyMiddle: 'C',
};

// Single alphanumeric char, uppercased; anything else falls back to `fallback`.
function sanitizeControlKey(v, fallback) {
  if (typeof v === 'string') {
    const c = v.trim().toUpperCase();
    if (/^[A-Z0-9]$/.test(c)) return c;
  }
  return fallback;
}

function sanitizeControls(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const longPressValues = ['fast', 'medium', 'slow'];
  return {
    iPadMode: typeof src.iPadMode === 'boolean' ? src.iPadMode : DEFAULT_CONTROLS.iPadMode,
    iPadLongPress: longPressValues.includes(src.iPadLongPress) ? src.iPadLongPress : DEFAULT_CONTROLS.iPadLongPress,
    useQuestion: typeof src.useQuestion === 'boolean' ? src.useQuestion : DEFAULT_CONTROLS.useQuestion,
    leftChord: typeof src.leftChord === 'boolean' ? src.leftChord : DEFAULT_CONTROLS.leftChord,
    emulateMiddle: typeof src.emulateMiddle === 'boolean' ? src.emulateMiddle : DEFAULT_CONTROLS.emulateMiddle,
    keyLeft: sanitizeControlKey(src.keyLeft, DEFAULT_CONTROLS.keyLeft),
    keyRight: sanitizeControlKey(src.keyRight, DEFAULT_CONTROLS.keyRight),
    keyMiddle: sanitizeControlKey(src.keyMiddle, DEFAULT_CONTROLS.keyMiddle),
  };
}

function getControls() {
  try {
    const raw = localStorage.getItem(CONTROLS_KEY);
    if (!raw) return { ...DEFAULT_CONTROLS };
    return sanitizeControls(JSON.parse(raw));
  } catch (e) {
    return { ...DEFAULT_CONTROLS };
  }
}

function setControls(patch) {
  const next = sanitizeControls({ ...getControls(), ...(patch || {}) });
  try {
    localStorage.setItem(CONTROLS_KEY, JSON.stringify(next));
  } catch (e) {}
  return next;
}
