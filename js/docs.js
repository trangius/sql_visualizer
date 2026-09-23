'use strict';

// ─── Tabs: several diagrams ──────────────────────────────────────────────────
// Each tab is one diagram, stored under its own key (see "Saving" in app.js).
// Switching tabs saves the current diagram and loads the other one into `state`/`pos`.
// The undo history lives in memory, one per tab.

const docHistory = new Map(); // id → { undo, redo }
const activeDoc = () => docs.list.find(d => d.id === docs.active);

function renderTabs() {
  $('#tabs').innerHTML = docs.list.map(d => {
    const on = d.id === docs.active;
    return `<div class="tab${on ? ' on' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-id="${d.id}" title="${esc(d.name)} (double-click to rename)">` +
      `<span class="tab-name">${esc(d.name)}</span>` +
      `<button class="tab-close" data-close title="Close" aria-label="Close ${esc(d.name)}">` +
      `<svg width="12" height="12" class="ico" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg></button></div>`;
  }).join('');
  document.title = `${activeDoc().name} · SQL Visualizer`;
  if (document.activeElement !== nameInput) nameInput.value = activeDoc().name;
  $('#tabs .tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateTabScroll();
}

// ‹ › at the ends of the tab bar, only when the tabs don't fit
function updateTabScroll() {
  const el = $('#tabs'), over = el.scrollWidth > el.clientWidth + 1;
  $('#tabsLeft').hidden = $('#tabsRight').hidden = !over;
  $('#tabsLeft').disabled = el.scrollLeft <= 0;
  $('#tabsRight').disabled = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
}
const scrollTabs = dir => { const el = $('#tabs'); el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' }); };
$('#tabsLeft').onclick = () => scrollTabs(-1);
$('#tabsRight').onclick = () => scrollTabs(1);
$('#tabs').addEventListener('scroll', updateTabScroll);
window.addEventListener('resize', updateTabScroll);
document.fonts.ready.then(updateTabScroll); // tab widths change when the font arrives

// The name field above the text renames the active tab as you type
const nameInput = $('#docName');
nameInput.addEventListener('input', () => {
  activeDoc().name = nameInput.value.trim() || 'Untitled';
  persist('docs', docs);
  renderTabs();
});
nameInput.addEventListener('blur', () => { nameInput.value = activeDoc().name; });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); ta.focus(); } });

function switchDoc(id) {
  if (id === docs.active || !docs.list.some(d => d.id === id)) return;
  histCommit();
  clearTimeout(saveTimer);
  saveDoc();
  docHistory.set(docs.active, { undo: hist.undo, redo: hist.redo });
  docs.active = id;
  persist('docs', docs);
  const h = docHistory.get(id);
  hist.undo = h?.undo ?? [];
  hist.redo = h?.redo ?? [];
  readDoc(id);
  prevNames = [];
  setHelp(false);
  loadEditor();
  if (docView) { Object.assign(view, docView); applyView(); } else fit();
  renderTabs();
  updateHistButtons();
}

// A name not used by another tab: "Untitled", "Untitled 2", …
function uniqueName(base) {
  const used = new Set(docs.list.map(d => d.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// Open a new diagram in a tab right after the current one
function newDoc(name, text) {
  const id = newDocId();
  persist(docKey(id), { ...DOC_DEFAULTS, text, base: text, pos: {} });
  const i = docs.list.findIndex(d => d.id === docs.active);
  docs.list.splice(i + 1, 0, { id, name: uniqueName(name) });
  switchDoc(id);
  showStorageNotice();
}

// Has the diagram got work in it: text that isn't empty and isn't the untouched example?
function hasWork(id) {
  const d = id === docs.active ? state : store.get(docKey(id), {});
  return d.textStale || (!!d.text?.trim() && d.text !== d.base);
}

// Close a tab. A diagram with work in it asks first (it only exists in this browser).
// The diagram is deleted from storage, but the toast can bring it back.
async function closeDoc(id) {
  const i = docs.list.findIndex(d => d.id === id);
  if (i < 0) return;
  if (id === docs.active) { histCommit(); saveDoc(); }
  if (hasWork(id)) {
    const name = docs.list[i].name;
    const ok = await confirmBox({
      title: `Close “${name}”?`,
      body: 'Closing deletes this diagram. It is only saved in this browser, not on your disk, ' +
        'so there is no other copy. To keep it, use <b>Export</b> first.',
      ok: 'Close and delete',
      cancel: 'Keep it open',
    });
    if (!ok) return;
  }
  const entry = docs.list[i], data = store.get(docKey(id), null), history = docHistory.get(id);
  if (docs.list.length === 1) newDoc('Untitled', ''); // never zero tabs
  else if (id === docs.active) switchDoc(docs.list[i + 1]?.id ?? docs.list[i - 1].id);
  docs.list.splice(docs.list.indexOf(entry), 1);
  docHistory.delete(id);
  store.remove(docKey(id));
  persist('docs', docs);
  renderTabs();
  toast(`Closed “${entry.name}”`, 'Undo', () => {
    persist(docKey(id), data);
    if (history) docHistory.set(id, history);
    docs.list.splice(Math.min(i, docs.list.length), 0, entry);
    switchDoc(id);
    renderTabs();
  });
}

// Double-click a tab to rename it: Enter or clicking elsewhere keeps the name, Esc cancels
function renameDoc(tab) {
  const d = docs.list.find(x => x.id === tab.dataset.id), label = tab.querySelector('.tab-name');
  const input = document.createElement('input');
  input.className = 'tab-rename';
  input.value = d.name;
  input.setAttribute('aria-label', 'Diagram name');
  label.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = keep => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (keep && name && name !== d.name) { d.name = name; persist('docs', docs); }
    renderTabs();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
}

const tabsEl = $('#tabs');
tabsEl.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab || e.target.closest('.tab-rename')) return;
  if (e.target.closest('[data-close]')) closeDoc(tab.dataset.id);
  else switchDoc(tab.dataset.id);
});
tabsEl.addEventListener('auxclick', e => { // middle-click closes, as in browsers
  const tab = e.target.closest('.tab');
  if (tab && e.button === 1) { e.preventDefault(); closeDoc(tab.dataset.id); }
});
tabsEl.addEventListener('dblclick', e => {
  const tab = e.target.closest('.tab');
  if (tab && !e.target.closest('[data-close], .tab-rename')) renameDoc(tab);
});
tabsEl.addEventListener('keydown', e => { // arrow keys move between tabs
  const tab = e.target.closest('.tab');
  if (!tab || e.target.closest('.tab-rename')) return;
  const i = docs.list.findIndex(d => d.id === tab.dataset.id);
  const next = e.key === 'ArrowRight' ? docs.list[i + 1] : e.key === 'ArrowLeft' ? docs.list[i - 1] : null;
  if (next) { e.preventDefault(); switchDoc(next.id); $('#tabs .tab.on').focus(); }
  if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); renameDoc(tab); }
});
$('#newTabBtn').onclick = () => newDoc('Untitled', '');

// A small confirmation dialog. Resolves true for the OK button; Cancel (the default), Esc
// or clicking outside resolve false.
function confirmBox({ title, body, ok, cancel }) {
  const dlgBox = $('#confirmDlg');
  $('#cfTitle').textContent = title;
  $('#cfBody').innerHTML = body;
  $('#cfOk').textContent = ok;
  $('#cfCancel').textContent = cancel;
  dlgBox.hidden = false;
  $('#cfCancel').focus();
  return new Promise(resolve => {
    const done = answer => {
      dlgBox.hidden = true;
      dlgBox.onkeydown = dlgBox.onpointerdown = $('#cfOk').onclick = $('#cfCancel').onclick = null;
      resolve(answer);
    };
    $('#cfOk').onclick = () => done(true);
    $('#cfCancel').onclick = () => done(false);
    dlgBox.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    dlgBox.onpointerdown = e => { if (e.target === dlgBox) done(false); };
  });
}

// "Only saved in this browser": shown when a new diagram is created, until dismissed once
function showStorageNotice() {
  if (!store.get('storageNoticeSeen', false)) $('#storageNotice').hidden = false;
}
$('#noticeOk').onclick = () => {
  store.set('storageNoticeSeen', true);
  $('#storageNotice').hidden = true;
};

renderTabs();
