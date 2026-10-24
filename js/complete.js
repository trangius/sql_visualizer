'use strict';

// ─── Suggestions while typing (Simple syntax) ────────────────────────────────
// After -> the tables, after -> Table. its columns; after a column name its type and flags.
// ↑ ↓ choose, Tab or ↵ takes one, Esc closes. ↵ on a word already typed in full is a new line.

const FLAG_HINTS = [['pk', 'primary key'], ['null', 'may be NULL'], ['unique', 'UNIQUE'], ['index', 'INDEX'], ['auto_increment', 'numbered by the database']];
const NAME = '[\\p{L}_][\\p{L}\\p{N}_$]*';
const REF_TABLE = new RegExp(`->\\s*(${NAME})?$`, 'u'), REF_COL = new RegExp(`->\\s*(${NAME})\\.([\\p{L}\\p{N}_$]*)$`, 'u');

const cpl = document.createElement('div');
cpl.className = 'complete';
cpl.setAttribute('role', 'listbox');
cpl.hidden = true;
document.body.appendChild(cpl);
// where the word being completed starts, what is typed of it, the suggestions [{ text, hint }], the one chosen
let cplAt = 0, cplWord = '', cplItems = [], cplOn = 0;

// What can go where the caret is: { at, word, items } or null
function suggestions() {
  if (state.mode !== 'text' || ta.selectionStart !== ta.selectionEnd) return null;
  const caret = ta.selectionStart, before = ta.value.slice(0, caret);
  const line = before.slice(before.lastIndexOf('\n') + 1);
  // a column line, not in a comment or [options], nor a pk (…) / unique (…) / index (…) line
  if (!/^\s/.test(line) || commentAt(line) >= 0 || line.includes('[') || /^\s+(pk|unique|index)\s*\(/i.test(line)) return null;
  const tables = model?.tables ?? [];
  let m, word, items;
  if ((m = line.match(REF_COL))) {
    const t = tables.find(t => lc(t.name) === lc(m[1]));
    word = m[2];
    items = (t?.cols ?? []).map(c => ({ text: c.name, hint: c.effType ?? c.type ?? '' }));
  } else if ((m = line.match(REF_TABLE))) {
    word = m[1] ?? '';
    items = tables.map(t => ({ text: t.name, hint: t.cols.length + ' columns' }))
      .sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
  } else {
    // a type or flag: the word after the column name, or a later one before any ->
    m = line.match(/^\s+\S+((?:\s+\S+)*)\s+(\S+)$/);
    if (!m || line.includes('->')) return null;
    word = m[2];
    const used = new Set(m[1].trim().split(/\s+/).map(lc));
    const flags = FLAG_HINTS.filter(([f]) => !used.has(f)).map(([f, hint]) => ({ text: f, hint }));
    items = m[1].trim() ? flags : [...TYPE_SUGGESTIONS.map(t => ({ text: t, hint: '' })), ...flags];
    if (!word) return null;
  }
  // names that start with it first, then those that have it
  const w = lc(word);
  const starts = items.filter(i => lc(i.text).startsWith(w)), has = items.filter(i => !lc(i.text).startsWith(w) && lc(i.text).includes(w));
  items = [...starts, ...has];
  if (!items.length || (items.length === 1 && items[0].text === word)) return null; // nothing to add
  return { at: caret - word.length, word, items };
}

function closeComplete() { cpl.hidden = true; }

function showComplete() {
  const s = suggestions();
  if (!s) return closeComplete();
  ({ at: cplAt, word: cplWord, items: cplItems } = s);
  cplOn = 0;
  cpl.innerHTML = cplItems.map((it, i) =>
    `<div class="cpl-item${i ? '' : ' on'}" data-i="${i}" role="option" aria-selected="${!i}">` +
    `<span>${esc(it.text)}</span><span class="hint">${esc(it.hint)}</span></div>`).join('');
  const p = caretPoint(cplAt);
  if (!p) return closeComplete();
  cpl.hidden = false;
  const h = cpl.offsetHeight;
  cpl.style.left = Math.min(p.x - 8, innerWidth - cpl.offsetWidth - 8) + 'px';
  cpl.style.top = (p.y + p.h + h + 4 > innerHeight ? p.y - h - 4 : p.y + p.h + 2) + 'px'; // above the line near the bottom
}

// Where a character of the text is on screen, measured on the highlight layer (it wraps as the text does)
function caretPoint(offset) {
  const before = ta.value.slice(0, offset), row = before.split('\n').length - 1, col = offset - before.lastIndexOf('\n') - 1;
  const div = hl.children[row];
  if (!div) return null;
  const walk = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let left = col, node;
  while ((node = walk.nextNode()) && left > node.length) left -= node.length;
  const range = document.createRange();
  if (node) range.setStart(node, left); else range.selectNodeContents(div);
  range.collapse(true);
  const r = range.getBoundingClientRect(), box = ta.getBoundingClientRect();
  if (r.bottom < box.top || r.top > box.bottom) return null; // scrolled out of sight
  return { x: r.left, y: r.top, h: lineHeight() };
}

function pickComplete(i) {
  const it = cplItems[i];
  closeComplete();
  if (!it) return;
  ta.setSelectionRange(cplAt, cplAt + cplWord.length);
  insertText(it.text);
}

function moveComplete(d) {
  cplOn = (cplOn + d + cplItems.length) % cplItems.length;
  cpl.querySelectorAll('.cpl-item').forEach((el, i) => {
    el.classList.toggle('on', i === cplOn);
    el.setAttribute('aria-selected', String(i === cplOn));
  });
  cpl.children[cplOn].scrollIntoView({ block: 'nearest' });
}

// Typing opens or updates it; deleting only updates it once open
ta.addEventListener('input', e => {
  if (e.inputType?.startsWith('insert') && e.inputType !== 'insertLineBreak' && e.inputType !== 'insertFromPaste') showComplete();
  else if (!cpl.hidden && e.inputType?.startsWith('delete')) showComplete();
  else closeComplete();
});
// before the editor's own keys (Tab indents, ↵ indents the new line)
ta.addEventListener('keydown', e => {
  if (cpl.hidden || e.isComposing) return;
  const take = e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && cplItems[cplOn].text !== cplWord);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') moveComplete(e.key === 'ArrowDown' ? 1 : -1);
  else if (take) pickComplete(cplOn);
  else if (e.key === 'Escape') closeComplete();
  else {
    if (!/^.$/u.test(e.key) && e.key !== 'Backspace' && e.key !== 'Shift') closeComplete(); // ← → Home, ↵ …
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
ta.addEventListener('blur', closeComplete);
ta.addEventListener('scroll', () => { if (!cpl.hidden) showComplete(); }); // follows the line, closes once it is out of sight
ta.addEventListener('pointerdown', closeComplete);
cpl.addEventListener('pointerdown', e => {
  e.preventDefault(); // the text keeps the focus
  const it = e.target.closest('.cpl-item');
  if (it) pickComplete(+it.dataset.i);
});
window.addEventListener('resize', closeComplete);
