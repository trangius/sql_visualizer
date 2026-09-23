'use strict';

// ─── Undo / redo ─────────────────────────────────────────────────────────────
// The history stores changes, not snapshots. Every action that changes the document
// is wrapped in histBegin() … histCommit(). At commit, the state before and after is
// compared and only the difference is kept:
//   • text / SQL: the one stretch that changed  { at, del, ins }
//   • box positions: before/after for just the boxes that moved
//   • flags: Text/SQL mode and which side needs regenerating, if they changed
// A burst of typing is one entry. So is a drag, an auto layout, or a dialog save
// (text and positions together).
//
// "Silent" entries record things that happen on the side (switching Text/SQL can
// regenerate the other side). They are not undo steps of their own: each belongs to
// the next real step (trailing ones to the last), and undo/redo take them along.
// That keeps later text offsets valid, and undo returns you to the mode you were in.

const hist = { undo: [], redo: [], open: null, depth: 0, timer: 0, LIMIT: 500 };
const HIST_FLAGS = ['mode', 'textStale', 'sqlStale'];
const TYPING_PAUSE = 800; // ms without typing that ends a burst

function histCapture() {
  const p = {};
  for (const [k, v] of Object.entries(pos)) p[k] = { ...v };
  return { text: state.text, sql: state.sql, mode: state.mode, textStale: state.textStale, sqlStale: state.sqlStale, pos: p };
}

// The changed stretch between two strings: common start and end trimmed off
function textDelta(a, b) {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let s = 0, e = 0;
  while (s < max && a[s] === b[s]) s++;
  while (e < max - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { at: s, del: a.slice(s, a.length - e), ins: b.slice(s, b.length - e) };
}

function applyDelta(s, d, dir) {
  return dir > 0
    ? s.slice(0, d.at) + d.ins + s.slice(d.at + d.del.length)
    : s.slice(0, d.at) + d.del + s.slice(d.at + d.ins.length);
}

// Start recording an action. Nested begin/commit pairs join the outer action.
function histBegin(kind, { silent = false } = {}) {
  if (hist.open?.kind === 'typing' && kind !== 'typing') histCommit(); // an action ends a typing burst
  if (hist.open) { hist.depth++; return; }
  hist.open = { kind, silent, before: histCapture() };
}

function histCommit() {
  if (hist.depth > 0) { hist.depth--; return; }
  const t = hist.open;
  if (!t) return;
  clearTimeout(hist.timer);
  hist.open = null;
  const b = t.before, a = histCapture();
  const entry = { kind: t.kind, silent: t.silent };
  for (const doc of ['text', 'sql']) {
    const d = textDelta(b[doc], a[doc]);
    if (d) entry[doc] = d;
  }
  const moved = {};
  for (const k of new Set([...Object.keys(b.pos), ...Object.keys(a.pos)])) {
    if (JSON.stringify(b.pos[k]) !== JSON.stringify(a.pos[k])) moved[k] = [b.pos[k] ?? null, a.pos[k] ?? null];
  }
  if (Object.keys(moved).length) entry.pos = moved;
  const flags = {};
  for (const k of HIST_FLAGS) if (b[k] !== a[k]) flags[k] = [b[k], a[k]];
  if (Object.keys(flags).length) entry.flags = flags;
  if (!entry.text && !entry.sql && !entry.pos && !entry.flags) return;
  hist.undo.push(entry);
  if (hist.undo.length > hist.LIMIT) hist.undo.shift();
  hist.redo.length = 0;
  updateHistButtons();
}

// Typing in the editor: the burst stays open until a pause (or another action)
function histTyping() {
  if (hist.open?.kind !== 'typing') histBegin('typing');
  clearTimeout(hist.timer);
  hist.timer = setTimeout(histCommit, TYPING_PAUSE);
  updateHistButtons();
}

// Shortcut for a one-off action
function histRecord(kind, fn) {
  histBegin(kind);
  try { fn(); } finally { histCommit(); }
}

function applyEntry(e, dir) {
  const pick = ([before, after]) => dir < 0 ? before : after;
  if (e.text) state.text = applyDelta(state.text, e.text, dir);
  if (e.sql) state.sql = applyDelta(state.sql, e.sql, dir);
  if (e.flags) for (const [k, v] of Object.entries(e.flags)) state[k] = pick(v);
  if (e.pos) {
    for (const [k, v] of Object.entries(e.pos)) {
      const p = pick(v);
      if (p) pos[k] = { ...p }; else delete pos[k];
    }
  }
}

function histUndo() { histStep(-1); }
function histRedo() { histStep(1); }

function histStep(dir) {
  histCommit(); // finish a typing burst first, so it can be undone
  const from = dir < 0 ? hist.undo : hist.redo, to = dir < 0 ? hist.redo : hist.undo;
  const top = () => from[from.length - 1];
  if (!from.some(e => !e.silent)) return;
  const move = () => { const e = from.pop(); applyEntry(e, dir); to.push(e); return e; };
  // undo: trailing silent entries, the real step, then the silent ones that led up to it
  // redo: the silent ones leading up to the real step, the step, and trailing ones if it was the last
  while (top()?.silent) move();
  const real = move();
  if (dir < 0 || !from.some(e => !e.silent)) while (top()?.silent) move();
  refreshAfterHistory(real, dir);
  updateHistButtons();
}

// Show the restored state: editor text, caret at the change, diagram, storage
function refreshAfterHistory(e, dir) {
  const top = ta.scrollTop;
  ta.value = state.mode === 'text' ? state.text : state.sql;
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  update();
  ta.scrollTop = top;
  const d = e[state.mode];
  if (d) {
    const end = d.at + (dir < 0 ? d.del.length : d.ins.length);
    ta.focus();
    ta.setSelectionRange(end, end);
  }
  syncScroll();
  store.set('pos', pos);
  saveState();
}

function updateHistButtons() {
  $('#undoBtn').disabled = !hist.undo.some(e => !e.silent) && hist.open?.kind !== 'typing';
  $('#redoBtn').disabled = !hist.redo.some(e => !e.silent);
}

// ⌘Z / ⇧⌘Z / Ctrl+Y everywhere, except in the dialog's own input fields
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  if (e.target.closest?.('#tableDlg')) return;
  e.preventDefault();
  if (k === 'y' || e.shiftKey) histRedo(); else histUndo();
});
// Edit menu → Undo/Redo inside the editor
ta.addEventListener('beforeinput', e => {
  if (e.inputType === 'historyUndo') { e.preventDefault(); histUndo(); }
  if (e.inputType === 'historyRedo') { e.preventDefault(); histRedo(); }
});
$('#undoBtn').onclick = histUndo;
$('#redoBtn').onclick = histRedo;
updateHistButtons();
