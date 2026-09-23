'use strict';

// ─── Editor ──────────────────────────────────────────────────────────────────

const ta = $('#src'), hl = $('#hl'), gutter = $('#gutter'), problemsEl = $('#problems');

function hlTextLine(line) {
  const hash = line.indexOf('#');
  const code = hash >= 0 ? line.slice(0, hash) : line;
  const com = hash >= 0 ? `<span class="h-com">${esc(line.slice(hash))}</span>` : '';
  if (!code.trim()) return esc(code) + com;
  if (!/^\s/.test(code)) return `<span class="h-tbl">${esc(code)}</span>` + com;
  const ai = code.indexOf('->');
  const left = ai >= 0 ? code.slice(0, ai) : code;
  const m = left.match(/^(\s*)(\S*)([\s\S]*)$/);
  let h = esc(m[1]) + `<span class="h-col">${esc(m[2])}</span>`;
  h += m[3].split(/(\s+)/).map(p =>
    !p.trim() ? esc(p) : FLAG.test(p) ? `<span class="h-flag">${esc(p)}</span>` : `<span class="h-type">${esc(p)}</span>`).join('');
  if (ai >= 0) h += `<span class="h-arrow">-&gt;</span><span class="h-ref">${esc(code.slice(ai + 2))}</span>`;
  return h + com;
}

const SQL_KW = new Set(`CREATE TABLE PRIMARY KEY FOREIGN REFERENCES NOT NULL AUTO_INCREMENT UNIQUE DROP IF EXISTS SET
ALTER ADD CONSTRAINT DEFAULT INDEX ON DELETE UPDATE CASCADE COLUMN ENGINE CHARSET COLLATE CHECK`.split(/\s+/));
function hlSqlLine(line) {
  let out = '', last = 0;
  const re = /(--.*$|#.*$)|('(?:[^'\\]|\\.|'')*'?)|(`[^`]*`?)|([\p{L}_][\p{L}\p{N}_$]*)/gu;
  for (const m of line.matchAll(re)) {
    out += esc(line.slice(last, m.index));
    if (m[1]) out += `<span class="h-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="h-str">${esc(m[2])}</span>`;
    else if (m[4] && SQL_KW.has(m[4].toUpperCase())) out += `<span class="h-kw">${esc(m[4])}</span>`;
    else out += esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(line.slice(last));
}

function decorateEditor(problems) {
  const byLine = new Map();
  for (const p of problems) {
    const prev = byLine.get(p.line);
    if (!prev || (prev.level === 'warn' && p.level === 'error')) byLine.set(p.line, p);
  }
  const lines = ta.value.split('\n');
  const hlLine = state.mode === 'text' ? hlTextLine : hlSqlLine;
  hl.innerHTML = lines.map((l, i) => {
    const p = byLine.get(i + 1);
    const h = hlLine(l);
    if (!p || !l.trim()) return h;
    const lead = l.match(/^\s*/)[0];
    return lead + `<span class="h-${p.level}">${h.slice(lead.length)}</span>`;
  }).join('\n') + '\n ';
  gutter.innerHTML = lines.map((_, i) => {
    const p = byLine.get(i + 1);
    return p ? `<div class="${p.level}" title="${esc(p.msg)}">${i + 1}</div>` : `<div>${i + 1}</div>`;
  }).join('');
  problemsEl.innerHTML = [...problems].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)).map(p =>
    `<div class="prob ${p.level}" data-line="${p.line ?? ''}"><b>${p.line ? 'Line ' + p.line : p.level}</b><span>${esc(p.msg)}</span></div>`).join('');
  syncScroll();
}

function syncScroll() {
  hl.scrollTop = ta.scrollTop;
  hl.scrollLeft = ta.scrollLeft;
  gutter.scrollTop = ta.scrollTop;
}

function selectLine(n) {
  const lines = ta.value.split('\n');
  if (!n || n > lines.length) return;
  let start = 0;
  for (let i = 0; i < n - 1; i++) start += lines[i].length + 1;
  ta.focus();
  ta.setSelectionRange(start, start + lines[n - 1].length);
  const lh = 20;
  const top = (n - 1) * lh;
  if (top < ta.scrollTop || top > ta.scrollTop + ta.clientHeight - 3 * lh) ta.scrollTop = Math.max(0, top - 3 * lh);
  syncScroll();
}

function insertText(s) {
  if (!document.execCommand('insertText', false, s)) {
    ta.setRangeText(s, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }
}

ta.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    insertText('  ');
  } else if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && state.mode === 'text') {
    // auto-indent: after a table name, indent; inside a table, keep the indentation
    const before = ta.value.slice(0, ta.selectionStart);
    const cur = before.slice(before.lastIndexOf('\n') + 1);
    const code = cur.replace(/#.*$/, '');
    const indent = !code.trim() ? cur.match(/^\s*/)[0] : /^\s/.test(code) ? code.match(/^\s*/)[0] : '  ';
    e.preventDefault();
    insertText('\n' + indent);
  }
});
ta.addEventListener('scroll', syncScroll);
ta.addEventListener('input', () => {
  histTyping();
  if (state.mode === 'text') { state.text = ta.value; state.sqlStale = true; }
  else { state.sql = ta.value; state.textStale = true; }
  update();
  saveState();
});
problemsEl.addEventListener('click', e => {
  const el = e.target.closest('.prob');
  if (el && el.dataset.line) selectLine(+el.dataset.line);
});

// ─── State ───────────────────────────────────────────────────────────────────

const state = Object.assign({
  mode: 'text', text: EXAMPLES.school, sql: '', textStale: false, sqlStale: true, style: 'classic', leftW: null,
}, store.get('state', {}));
let pos = store.get('pos', {});
let model = { tables: [] };
let prevNames = [];

let saveTimer = 0;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set('state', state), 250);
}

function parseCurrent() {
  const r = state.mode === 'text' ? parseText(ta.value) : parseSQL(ta.value);
  r.problems.push(...resolve(r.tables));
  return r;
}

function update() {
  const r = parseCurrent();
  model = r;
  decorateEditor(r.problems);
  drawDiagram();
}

// Bring the text (or SQL) up to date after the other side was edited.
// Recorded as a silent history entry: later edits are stored as offsets into the new text.
function regenerate(which) {
  if (which === 'sql' ? !state.sqlStale : !state.textStale) return;
  histBegin('regenerate', { silent: true });
  if (which === 'sql') {
    const r = parseText(state.text);
    resolve(r.tables);
    state.sql = genSQL(r.tables);
    state.sqlStale = false;
  } else {
    const r = parseSQL(state.sql);
    resolve(r.tables);
    state.text = genText(r.tables, r.problems);
    state.textStale = false;
  }
  histCommit();
}

function setMode(mode) {
  if (mode === state.mode) return;
  histBegin('mode', { silent: true });
  regenerate(mode);
  state.mode = mode;
  loadEditor();
  histCommit();
  saveState();
}

function loadEditor() {
  ta.value = state.mode === 'text' ? state.text : state.sql;
  ta.scrollTop = 0;
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  update();
}

$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });

// ─── Theme ───────────────────────────────────────────────────────────────────
// Follows the system until the user clicks the toggle. Toggling back to what the
// system says drops the override, so the page follows the system again.

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light')) === 'dark';

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  $('#themeBtn').title = isDark() ? 'Switch to light mode' : 'Switch to dark mode';
}
applyTheme(store.get('theme', 'auto'));
systemDark.addEventListener('change', () => applyTheme(store.get('theme', 'auto')));
$('#themeBtn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  const theme = next === (systemDark.matches ? 'dark' : 'light') ? 'auto' : next;
  store.set('theme', theme);
  applyTheme(theme);
});

// ─── Examples, help, splitter, toast ─────────────────────────────────────────

let toastTimer = 0;
function toast(msg, actLabel, act) {
  $('#toastMsg').textContent = msg;
  const b = $('#toastAct');
  b.hidden = !act;
  b.textContent = actLabel || '';
  b.onclick = () => { act(); $('#toast').hidden = true; };
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 7000);
}

$('#examples').addEventListener('change', e => {
  const key = e.target.value;
  e.target.selectedIndex = 0;
  histRecord('example', () => {
    state.text = EXAMPLES[key];
    state.textStale = false;
    state.sqlStale = true;
    state.mode = 'text';
    // lay the example out fresh
    const r = parseText(state.text);
    for (const t of r.tables) delete pos[t.name];
    loadEditor();
  });
  fit();
  saveState();
  toast('Example loaded', 'Undo', () => { histUndo(); fit(); });
});

$('#helpBtn').onclick = () => { $('#help').hidden = !$('#help').hidden; };
$('#helpClose').onclick = () => { $('#help').hidden = true; };

const left = $('#left'), split = $('#split');
if (state.leftW) left.style.width = state.leftW + 'px';
split.addEventListener('pointerdown', e => {
  split.setPointerCapture(e.pointerId);
  split.classList.add('active');
  const move = ev => {
    state.leftW = Math.max(280, Math.min(window.innerWidth - 300, ev.clientX));
    left.style.width = state.leftW + 'px';
  };
  const up = () => {
    split.classList.remove('active');
    split.removeEventListener('pointermove', move);
    split.removeEventListener('pointerup', up);
    saveState();
  };
  split.addEventListener('pointermove', move);
  split.addEventListener('pointerup', up);
});

// ─── Start ───────────────────────────────────────────────────────────────────

applyStyle();
loadEditor();
fit();
