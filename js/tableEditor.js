'use strict';

// ─── Table dialog ────────────────────────────────────────────────────────────
// Creating or editing a table rewrites that table's lines in the text syntax,
// so the text stays the single source of truth (and ⌘Z undoes a dialog edit).

const TYPE_SUGGESTIONS = ['vc', 'vc(32)', 'vc(64)', 'vc(256)', 'int', 'bigint', 'tinyint', 'text', 'date', 'datetime', 'decimal(10,2)', 'bool'];
const SELF = '\u0000self'; // a foreign key to the table being edited, whatever its final name
const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1"/></svg>';

const dlgEl = $('#tableDlg'), tdName = $('#tdName'), tdCols = $('#tdCols'), tdError = $('#tdError');
$('#typeList').innerHTML = TYPE_SUGGESTIONS.map(t => `<option value="${t}">`).join('');

// dlg: { orig, at, nameComment, tables, fk, cols: [{ name, origName, type, pk, nullable, unique, ref, refCol, comment }] }
// dlg.fk: the open foreign-key chooser { row, table, usePk, col, filter }
let dlg = null;

const blankCol = () => ({ name: '', origName: null, type: '', pk: false, nullable: false, unique: false, ref: null, refCol: null, comment: '' });
const inlineComment = line => { const i = (line ?? '').indexOf('#'); return i >= 0 ? line.slice(i).trim() : ''; };
const snap = v => Math.round(v / 10) * 10;
const lc = s => s.toLowerCase();
const pointsToPk = c => c.target.pkCols.length === 1 && c.target.pkCols[0] === c.targetCol;

// The model of the text syntax, converting from SQL first if the SQL was edited last
function textModel() {
  if (state.textStale) {
    const r = parseSQL(state.sql);
    resolve(r.tables);
    state.text = genText(r.tables, r.problems);
    state.textStale = false;
  }
  const r = parseText(state.text);
  resolve(r.tables);
  return r;
}

// A table's lines: its name line up to the last indented line before the next table
function blockRange(lines, start) {
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const code = lines[i].replace(/#.*$/, '');
    if (code.trim() && !/^\s/.test(code)) break;
    if (/^\s/.test(lines[i]) && lines[i].trim()) end = i;
  }
  return [start, end];
}

function openTableEditor(name, at = null) {
  const { tables } = textModel();
  const t = name ? tables.find(t => t.name === name) : null;
  const lines = state.text.split('\n');
  dlg = { orig: t?.name ?? null, at, tables, fk: null, nameComment: t ? inlineComment(lines[t.line - 1]) : '' };
  dlg.cols = t
    ? t.cols.map(c => ({
        name: c.name, origName: c.name, type: c.type ?? '', pk: c.pk, nullable: c.nullable, unique: c.unique,
        ref: !c.ref ? null : c.target === t || (!c.target && lc(c.ref) === lc(t.name)) ? SELF : c.target?.name ?? c.ref,
        refCol: !c.ref ? null : !c.target ? c.refCol : pointsToPk(c) ? null : c.targetCol.name,
        comment: inlineComment(lines[c.line - 1]),
      }))
    : [{ ...blankCol(), name: 'Id' }, blankCol()];
  $('#tdTitle').textContent = t ? `Edit table ${t.name}` : 'New table';
  $('#tdDelete').hidden = !t;
  disarmDelete();
  tdName.value = t ? t.name : '';
  tdName.classList.remove('invalid');
  tdError.textContent = '';
  renderCols();
  dlgEl.hidden = false;
  if (t) tdName.select(); else tdName.focus();
}

function closeTableEditor() {
  dlgEl.hidden = true;
  dlg = null;
}

// ─── What a foreign key can point to ─────────────────────────────────────────

// Tables to choose from, alphabetically, with the table being edited as it is in the dialog right now
function targetTables() {
  const selfName = tdName.value.trim() || dlg.orig || 'this table';
  const explicitPk = dlg.cols.some(c => c.pk && c.name.trim());
  const self = {
    key: SELF, name: selfName, self: true,
    cols: dlg.cols.filter(c => c.name.trim()).map(c => ({
      name: c.name.trim(),
      type: c.type.trim() || (isIdName(c.name.trim()) || c.ref ? 'int' : 'vc'),
      isPk: c.pk || (!explicitPk && isIdName(c.name.trim())),
      unique: c.unique,
    })),
  };
  const others = dlg.tables.filter(t => t.name !== dlg.orig).map(t => ({
    key: t.name, name: t.name,
    cols: t.cols.map(c => ({ name: c.name, type: c.type ?? c.effType, isPk: c.isPk, unique: c.unique })),
  }));
  const all = [...others, self];
  for (const t of all) {
    const pks = t.cols.filter(c => c.isPk);
    t.pk = pks.length === 1 ? pks[0].name : null;
    t.pkNote = pks.length === 1 ? pks[0].name : pks.length ? 'several columns' : 'none';
  }
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function refLabel(c) {
  const t = targetTables().find(t => t.key === c.ref || (c.ref !== SELF && lc(t.name) === lc(c.ref)));
  const name = c.ref === SELF ? (tdName.value.trim() || 'this table') : c.ref;
  return name + '.' + (c.refCol ?? t?.pk ?? '?');
}

// ─── Column rows ─────────────────────────────────────────────────────────────

function renderCols() {
  tdCols.innerHTML = dlg.cols.map((c, i) => `
    <div class="col-row${dlg.fk?.row === i ? ' fk-open' : ''}" data-i="${i}">
      <input class="c-name" value="${esc(c.name)}" placeholder="Column name" spellcheck="false" autocomplete="off">
      <input class="c-type" value="${esc(c.type)}" list="typeList" spellcheck="false" autocomplete="off">
      <label class="chk" title="Primary key"><input type="checkbox" class="c-pk"${c.pk ? ' checked' : ''}></label>
      <label class="chk" title="May be NULL"><input type="checkbox" class="c-null"${c.nullable ? ' checked' : ''}></label>
      <label class="chk" title="UNIQUE"><input type="checkbox" class="c-unique"${c.unique ? ' checked' : ''}></label>
      <div class="c-fk">${c.ref
        ? `<button class="fk-chip" data-act="fk" title="Change what this points to">→ ${esc(refLabel(c))}</button>` +
          `<button class="icon-x" data-act="unlink" title="Not a foreign key">×</button>`
        : `<button class="icon-btn link" data-act="fk" title="Make this a foreign key">${LINK_ICON}</button>`}</div>
      <div class="c-actions">
        <button class="icon-x" data-act="up" title="Move up"${i ? '' : ' disabled'}>↑</button>
        <button class="icon-x" data-act="down" title="Move down"${i < dlg.cols.length - 1 ? '' : ' disabled'}>↓</button>
        <button class="icon-x" data-act="del" title="Remove column">×</button>
      </div>
    </div>${dlg.fk?.row === i ? fkPanelMarkup() : ''}`).join('');
  refreshHints();
  if (dlg.fk) renderFkPanel();
}

// Placeholders and checkboxes that depend on other fields (Id is the PK unless another column says pk)
function refreshHints() {
  const explicitPk = dlg.cols.some(c => c.pk && c.name.trim());
  for (const row of tdCols.querySelectorAll('.col-row')) {
    const c = dlg.cols[+row.dataset.i];
    const isId = isIdName(c.name.trim());
    const autoPk = !explicitPk && isId;
    const pk = row.querySelector('.c-pk');
    pk.checked = c.pk || autoPk;
    pk.disabled = autoPk;
    pk.parentNode.title = autoPk ? 'Id is the primary key automatically' : 'Primary key';
    const nul = row.querySelector('.c-null');
    nul.disabled = c.pk || autoPk;
    if (nul.disabled) { nul.checked = false; c.nullable = false; }
    row.querySelector('.c-type').placeholder = isId || c.ref ? 'int' : 'vc';
  }
}

tdCols.addEventListener('input', e => {
  if (e.target.id === 'fkFilter') { dlg.fk.filter = e.target.value; renderFkPanel(); return; }
  if (e.target.id === 'fkUsePk') { dlg.fk.usePk = e.target.checked; renderFkPanel(); return; }
  const row = e.target.closest('.col-row');
  if (!row) return;
  const c = dlg.cols[+row.dataset.i], cl = e.target.classList;
  if (cl.contains('c-name')) c.name = e.target.value;
  else if (cl.contains('c-type')) c.type = e.target.value;
  else if (cl.contains('c-pk')) c.pk = e.target.checked;
  else if (cl.contains('c-null')) c.nullable = e.target.checked;
  else if (cl.contains('c-unique')) c.unique = e.target.checked;
  e.target.classList.remove('invalid');
  refreshHints();
});

tdCols.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act.startsWith('fk-')) return fkPanelClick(b);
  const i = +b.closest('.col-row').dataset.i, cols = dlg.cols;
  switch (act) {
    case 'up': [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]]; dlg.fk = null; break;
    case 'down': [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]]; dlg.fk = null; break;
    case 'del': cols.splice(i, 1); dlg.fk = null; break;
    case 'unlink': cols[i].ref = cols[i].refCol = null; if (dlg.fk?.row === i) dlg.fk = null; break;
    case 'fk': return openFk(i);
  }
  renderCols();
});

function addColumn() {
  dlg.fk = null;
  dlg.cols.push(blankCol());
  renderCols();
  tdCols.querySelector(`.col-row[data-i="${dlg.cols.length - 1}"] .c-name`).focus();
}
$('#tdAdd').onclick = addColumn;

// ─── Foreign-key chooser: table list, then primary key or a specific column ──

function openFk(i) {
  if (dlg.fk?.row === i) return closeFk();
  const c = dlg.cols[i];
  dlg.fk = { row: i, table: c.ref, usePk: !c.refCol, col: c.refCol, filter: '' };
  renderCols();
  $('#fkFilter').focus();
}

function closeFk() {
  const row = dlg.fk?.row;
  dlg.fk = null;
  renderCols();
  if (row != null) tdCols.querySelector(`.col-row[data-i="${row}"] .c-name`)?.focus();
}

function fkPanelMarkup() {
  return `
    <div class="fk-panel">
      <div class="fk-left">
        <input id="fkFilter" placeholder="Find table…" spellcheck="false" autocomplete="off">
        <div class="fk-list" id="fkTables" role="listbox" aria-label="Tables"></div>
      </div>
      <div class="fk-right">
        <label class="fk-pk"><input type="checkbox" id="fkUsePk"> <span id="fkPkLabel">Primary key</span></label>
        <div class="fk-list" id="fkCols" role="listbox" aria-label="Columns"></div>
        <div class="fk-foot">
          <span id="fkPreview"></span>
          <span class="spacer"></span>
          <button data-act="fk-cancel">Cancel</button>
          <button data-act="fk-ok" id="fkOk" class="primary">OK</button>
        </div>
      </div>
    </div>`;
}

function fkState() {
  const fk = dlg.fk, tables = targetTables();
  const filter = lc(fk.filter.trim());
  const shown = tables.filter(t => !filter || lc(t.name).includes(filter));
  const table = tables.find(t => t.key === fk.table || (fk.table !== SELF && lc(t.name) === lc(fk.table ?? '')));
  const usePk = !!table?.pk && fk.usePk;
  const col = usePk ? table.pk : table?.cols.find(c => lc(c.name) === lc(fk.col ?? ''))?.name ?? null;
  return { tables, shown, table, usePk, col };
}

function renderFkPanel() {
  const fk = dlg.fk, { shown, table, usePk, col } = fkState();
  $('#fkTables').innerHTML = shown.length
    ? shown.map(t => `<button class="fk-item${t === table ? ' on' : ''}" data-act="fk-table" data-key="${esc(t.key === SELF ? '' : t.key)}" role="option" aria-selected="${t === table}">` +
        `${esc(t.name)}${t.self ? ' <em>(this table)</em>' : ''}</button>`).join('')
    : '<div class="fk-empty">No table matches</div>';

  const pkBox = $('#fkUsePk');
  pkBox.checked = usePk;
  pkBox.disabled = !table?.pk;
  $('#fkPkLabel').textContent = table ? `Primary key (${table.pkNote})` : 'Primary key';

  const colsEl = $('#fkCols');
  if (!table) colsEl.innerHTML = '<div class="fk-empty">Choose a table</div>';
  else if (usePk) colsEl.innerHTML = '<div class="fk-empty">Untick "Primary key" to point to another column</div>';
  else colsEl.innerHTML = table.cols.map(c => {
    const tags = (c.isPk ? ' <b>PK</b>' : '') + (c.unique ? ' <b>UNIQUE</b>' : '') + (!c.isPk && !c.unique ? ' <i>not unique</i>' : '');
    return `<button class="fk-item${c.name === col ? ' on' : ''}" data-act="fk-col" data-col="${esc(c.name)}" role="option" aria-selected="${c.name === col}">` +
      `${esc(c.name)}:${esc(c.type)}${tags}</button>`;
  }).join('') || '<div class="fk-empty">This table has no columns yet</div>';

  $('#fkPreview').textContent = table && col ? `→ ${table.name}.${col}` : '';
  $('#fkOk').disabled = !(table && col);
  $('#fkTables .fk-item.on')?.scrollIntoView({ block: 'nearest' });
}

function fkPanelClick(b) {
  const fk = dlg.fk;
  switch (b.dataset.act) {
    case 'fk-table': {
      const key = b.dataset.key || SELF;
      if (key !== fk.table) { fk.table = key; fk.col = null; fk.usePk = true; }
      renderFkPanel();
      break;
    }
    case 'fk-col': fk.col = b.dataset.col; renderFkPanel(); break;
    case 'fk-cancel': closeFk(); break;
    case 'fk-ok': applyFk(); break;
  }
}

function applyFk() {
  const { table, usePk, col } = fkState();
  if (!table || !col) return;
  const c = dlg.cols[dlg.fk.row];
  c.ref = table.key;
  c.refCol = usePk ? null : col;
  if (!c.name.trim()) { // name the column after what it points to
    const n = (table.self ? 'Parent' : table.name) + (usePk ? 'Id' : col);
    if (!dlg.cols.some(o => lc(o.name) === lc(n))) c.name = n;
  }
  closeFk();
}

// Arrow keys move through the table list; Enter picks / confirms; Esc closes the chooser
function fkKeydown(e) {
  const fk = dlg.fk, { shown, table, col } = fkState();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!shown.length) return;
    const i = shown.indexOf(table);
    const next = shown[e.key === 'ArrowDown' ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next !== table) { fk.table = next.key; fk.col = null; fk.usePk = true; }
    renderFkPanel();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.target.tagName === 'BUTTON') { e.target.click(); return; }
    if (table && col) applyFk();
    else if (!table && shown.length) { fk.table = shown[0].key; fk.usePk = true; renderFkPanel(); }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFk();
  }
}

// ─── Save / delete ───────────────────────────────────────────────────────────

function fail(input, msg) {
  input?.classList.add('invalid');
  input?.focus();
  tdError.textContent = msg;
}

const REF_RE = /->\s*[\p{L}_][\p{L}\p{N}_$]*(?:\s*[.(]\s*[\p{L}_][\p{L}\p{N}_$]*\s*\)?)?/u;

function saveTable() {
  if (dlg.fk) closeFk();
  const name = tdName.value.trim();
  if (!IDENT.test(name)) return fail(tdName, 'The table name must start with a letter or _, and contain only letters, digits and _.');
  const tables = dlg.tables;
  if (tables.some(t => t.name !== dlg.orig && lc(t.name) === lc(name))) {
    return fail(tdName, `There is already a table named ${name}.`);
  }

  const rows = [...tdCols.querySelectorAll('.col-row')];
  const seen = new Set(), cols = [];
  for (const [i, c] of dlg.cols.entries()) {
    const nameIn = rows[i].querySelector('.c-name'), typeIn = rows[i].querySelector('.c-type');
    const cn = c.name.trim(), ct = c.type.trim();
    if (!cn && !ct && !c.ref) continue; // empty row
    if (!IDENT.test(cn)) return fail(nameIn, cn ? `"${cn}" is not a valid column name.` : 'This column needs a name.');
    if (seen.has(lc(cn))) return fail(nameIn, `There are two columns named ${cn}.`);
    if (/#|->/.test(ct)) return fail(typeIn, 'The type can\'t contain # or ->.');
    seen.add(lc(cn));
    cols.push({ ...c, name: cn, type: ct });
  }

  // Columns renamed in the dialog: references to them (here and in other tables) follow along
  const renamed = new Map(cols.filter(c => c.origName && c.origName !== c.name).map(c => [lc(c.origName), c.name]));
  const toSelf = c => c.ref === SELF || (dlg.orig && c.ref && lc(c.ref) === lc(dlg.orig));

  const block = [name + (dlg.nameComment ? '  ' + dlg.nameComment : '')];
  for (const c of cols) {
    const parts = [c.name];
    if (c.type) parts.push(c.type);
    if (c.pk) parts.push('pk');
    if (c.nullable) parts.push('null');
    if (c.unique) parts.push('unique');
    if (c.ref) {
      const self = toSelf(c);
      const refCol = self && c.refCol ? renamed.get(lc(c.refCol)) ?? c.refCol : c.refCol;
      parts.push('-> ' + (self ? name : c.ref) + (refCol ? '.' + refCol : ''));
    }
    block.push('  ' + parts.join(' ') + (c.comment ? '  ' + c.comment : ''));
  }

  const lines = state.text.split('\n');
  let at;
  const t = dlg.orig && tables.find(t => t.name === dlg.orig);
  if (t) {
    for (const o of tables) {
      if (o === t) continue;
      for (const c of o.cols) {
        if (!c.ref || lc(c.ref) !== lc(dlg.orig)) continue;
        const refCol = c.refCol ? renamed.get(lc(c.refCol)) ?? c.refCol : null;
        if (name === dlg.orig && refCol === c.refCol) continue;
        lines[c.line - 1] = lines[c.line - 1].replace(REF_RE, '-> ' + name + (refCol ? '.' + refCol : ''));
      }
    }
    if (name !== dlg.orig && pos[dlg.orig]) { pos[name] = pos[dlg.orig]; delete pos[dlg.orig]; }
    const [s, e] = blockRange(lines, t.line - 1);
    const comments = lines.slice(s + 1, e + 1).filter(l => /^\s+#/.test(l)); // keep comment lines inside the table
    lines.splice(s, e - s + 1, block[0], ...comments, ...block.slice(1));
    at = s + 1;
  } else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push('');
    at = lines.length + 1;
    lines.push(...block, '');
    pos[name] = dlg.at ?? viewCenterSpot();
  }
  store.set('pos', pos);
  closeTableEditor();
  commitText(lines.join('\n'), at);
}

function deleteTable() {
  const btn = $('#tdDelete');
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Click again to delete';
    return;
  }
  const t = textModel().tables.find(t => t.name === dlg.orig);
  if (t) {
    const lines = state.text.split('\n');
    const [s, e] = blockRange(lines, t.line - 1);
    lines.splice(s, e - s + 1);
    while (s < lines.length && !lines[s].trim() && (s === 0 || !lines[s - 1].trim())) lines.splice(s, 1);
    delete pos[t.name];
    store.set('pos', pos);
    closeTableEditor();
    commitText(lines.join('\n'), null);
    toast(`Deleted ${t.name}`, 'Undo', undoLast);
  } else {
    closeTableEditor();
  }
}
function disarmDelete() {
  const btn = $('#tdDelete');
  btn.classList.remove('armed');
  btn.textContent = 'Delete table';
}

let undoText = null;
function undoLast() {
  if (undoText != null) commitText(undoText, null);
}

// Write new text into the editor. In text mode this goes through the textarea's own
// editing so ⌘Z works; in SQL mode the SQL is regenerated from the new text.
function commitText(text, line) {
  undoText = state.text;
  if (state.mode === 'text') {
    const top = ta.scrollTop;
    ta.focus();
    ta.select();
    insertText(text); // fires "input", which updates state and diagram
    ta.scrollTop = top;
    if (line) selectLine(line); else syncScroll();
  } else {
    state.text = text;
    const r = parseText(text);
    resolve(r.tables);
    state.sql = genSQL(r.tables);
    state.sqlStale = false;
    ta.value = state.sql;
    update();
    saveState();
  }
}

function viewCenterSpot() {
  const r = svg.getBoundingClientRect();
  const w = toWorld({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
  return { x: snap(w.x - 80), y: snap(w.y - 60) };
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

$('#newTableBtn').onclick = () => openTableEditor(null);
$('#tdSave').onclick = saveTable;
$('#tdCancel').onclick = closeTableEditor;
$('#tdDelete').onclick = deleteTable;
tdName.addEventListener('input', () => {
  tdName.classList.remove('invalid');
  if (dlg.fk) renderFkPanel(); // "this table" shows the new name
});
dlgEl.addEventListener('pointerdown', e => { if (e.target === dlgEl) closeTableEditor(); });

dlgEl.addEventListener('keydown', e => {
  if (e.target.closest('.fk-panel')) return fkKeydown(e);
  if (e.key === 'Escape') { e.preventDefault(); closeTableEditor(); return; }
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.type === 'checkbox') return;
  e.preventDefault();
  // Enter in the last column's name adds another column; anywhere else it saves
  const row = e.target.closest('.col-row');
  if (row && e.target.classList.contains('c-name') && +row.dataset.i === dlg.cols.length - 1 && e.target.value.trim()) addColumn();
  else saveTable();
});

svg.addEventListener('dblclick', e => {
  const g = e.target.closest('.tbl');
  if (g) {
    openTableEditor(g.dataset.t);
  } else {
    const w = toWorld(e);
    openTableEditor(null, { x: snap(w.x - 20), y: snap(w.y - 15) });
  }
});
