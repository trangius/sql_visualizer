'use strict';

// ─── Table dialog ────────────────────────────────────────────────────────────
// Creating or editing a table rewrites that table's lines in the text syntax,
// so the text stays the single source of truth (and ⌘Z undoes a dialog edit).

const TYPE_SUGGESTIONS = ['vc', 'vc(32)', 'vc(64)', 'vc(256)', 'int', 'bigint', 'tinyint', 'text', 'date', 'datetime', 'decimal(10,2)', 'bool'];
const SELF = '\u0000self'; // a foreign key to the table being edited, whatever its final name
const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1"/></svg>';
const GRIP_ICON = '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>';
const MOVE_KEYS = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform ?? navigator.platform) ? '⌥↑ / ⌥↓' : 'Alt+↑ / Alt+↓';
// the column's yes/no options, as pills: [field, label]
const FLAGS = [['pk', 'PK'], ['nullable', 'NULL'], ['unique', 'UNIQUE'], ['auto', 'AUTO']];

const dlgEl = $('#tableDlg'), tdName = $('#tdName'), tdCols = $('#tdCols');
$('#typeList').innerHTML = TYPE_SUGGESTIONS.map(t => `<option value="${t}">`).join('');

// dlg: { orig, at, nameComment, tables, fk, start, cols: [{ name, origName, type, pk, nullable, unique, auto, ref, refCol, comment }] }
// dlg.fk: the open foreign-key chooser { row, table, usePk, col, filter }
// dlg.start: the dialog as it opened (see snapshot), to tell whether closing loses anything
let dlg = null;

const blankCol = () => ({ name: '', origName: null, type: '', pk: false, nullable: false, unique: false, auto: false, ref: null, refCol: null, comment: '' });
const inlineComment = line => { const i = commentAt(line ?? ''); return i >= 0 ? line.slice(i).trim() : ''; };
const lc = s => s.toLowerCase();
const keyed = (cls, h) => ` class="${cls}${h == null ? '' : ' h-hue'}"${h == null ? '' : ` style="--h:${h}"`}`; // an element in a key's colour

// The key colours of the diagram (see keyHues), so the dialog shows what the diagram shows
const tableOf = key => key === SELF ? dlg.tables.find(t => t.name === dlg.orig) : dlg.tables.find(t => lc(t.name) === lc(key ?? ''));
const tableHue = key => tableOf(key)?.hue ?? null;
// what an arrow to a table (refCol null: its primary key) or one of its columns gets
function refHue(key, refCol) {
  const t = tableOf(key);
  if (!t) return null;
  if (!refCol) return t.pkCols.length === 1 ? t.hue : null;
  const col = t.cols.find(c => lc(c.name) === lc(refCol));
  if (!col) return null;
  if (solePk(t, col)) return t.hue;
  for (const o of dlg.tables) for (const c of o.cols) if (c.targetCol === col) return c.keyHue;
  return null;
}

// The model of the text syntax, converting from SQL first if the SQL was edited last
function textModel() {
  regenerate('text');
  const r = parseText(state.text);
  resolve(r.tables);
  keyHues(r.tables);
  return r;
}

// A table's lines: its name line up to the last indented line before the next table
function blockRange(lines, start) {
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const code = stripComment(lines[i]);
    if (code.trim() && !/^\s/.test(code)) break;
    if (/^\s/.test(lines[i]) && lines[i].trim()) end = i;
  }
  return [start, end];
}

// col: the column to start on (the one double-clicked in the diagram), else the table name
function openTableEditor(name, at = null, col = null) {
  const { tables } = textModel();
  const t = name ? tables.find(t => t.name === name) : null;
  const lines = state.text.split('\n');
  dlg = { orig: t?.name ?? null, at, tables, fk: null, nameComment: t ? inlineComment(lines[t.line - 1]) : '' };
  dlg.cols = t
    ? t.cols.map(c => ({
        name: c.name, origName: c.name, type: c.type ?? '', pk: c.pk || (!!t.pkLine && c.isPk), nullable: c.nullable, unique: c.unique, auto: c.auto,
        ref: !c.ref ? null : c.target === t || (!c.target && lc(c.ref) === lc(t.name)) ? SELF : c.target?.name ?? c.ref,
        refCol: !c.ref ? null : !c.target ? c.refCol : pointsToPk(c) ? null : c.targetCol.name,
        onDelete: c.onDelete, onUpdate: c.onUpdate, default: c.default, indexed: c.indexed, // kept as they are: the dialog doesn't edit them
        comment: inlineComment(lines[c.line - 1]),
      }))
    : [{ ...blankCol(), name: 'Id' }, blankCol()];
  $('#tdTitle').textContent = t ? `Edit table ${t.name}` : 'New table';
  $('#tdDelete').hidden = !t;
  disarmDelete();
  tdName.value = t ? t.name : '';
  clearError();
  renderCols();
  dlg.start = snapshot();
  dlgEl.hidden = false;
  const colIn = col != null && tdCols.querySelector(`.col-row[data-i="${dlg.cols.findIndex(c => c.name === col)}"] .c-name`);
  if (colIn) { colIn.select(); colIn.scrollIntoView({ block: 'nearest' }); }
  else if (t) tdName.select();
  else tdName.focus();
}

function closeTableEditor() {
  dlgEl.hidden = true;
  dlg = null;
}

// The name and the columns that would be saved (empty rows aren't)
const snapshot = () => JSON.stringify([tdName.value, dlg.cols.filter(c => c.name.trim() || c.type.trim() || c.ref)]);

// Esc and a click outside ask before throwing edits away (Cancel says what it does, so it doesn't)
async function requestClose() {
  if (snapshot() === dlg.start) return closeTableEditor();
  const focus = document.activeElement;
  const ok = await confirmBox({
    title: 'Discard changes?',
    body: dlg.orig ? `Your changes to <b>${esc(dlg.orig)}</b> aren't saved.` : 'The new table isn\'t saved.',
    ok: 'Discard', cancel: 'Keep editing',
  });
  if (ok) closeTableEditor(); else focus?.focus();
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
  tdCols.innerHTML = dlg.cols.map((c, i) => {
    const target = c.ref && refLabel(c);
    return `
    <div class="col-row${dlg.fk?.row === i ? ' fk-open' : ''}" data-i="${i}">
      <span class="grip" title="Drag to move (${MOVE_KEYS})">${GRIP_ICON}</span>
      <input class="c-name" value="${esc(c.name)}" placeholder="Column name" spellcheck="false" autocomplete="off">
      <input class="c-type" value="${esc(c.type)}" list="typeList" spellcheck="false" autocomplete="off">
      <div class="c-flags">${FLAGS.map(([f, label]) => `<button class="pill" data-act="flag" data-f="${f}">${label}</button>`).join('')}</div>
      <div class="c-fk">${c.ref
        ? `<div${keyed('fk-chip', refHue(c.ref, c.refCol))}>` +
            `<button class="fk-label" data-act="fk" title="Points to ${esc(target)}. Click to change">→ ${esc(target)}</button>` +
            `<button class="fk-unlink" data-act="unlink" title="Not a foreign key" aria-label="Not a foreign key">×</button></div>`
        : `<button class="icon-btn link" data-act="fk" title="Make this a foreign key">${LINK_ICON}</button>`}</div>
      <div class="c-actions"><button class="icon-x" data-act="del" title="Remove column">×</button></div>
    </div>${dlg.fk?.row === i ? fkPanelMarkup() : ''}`;
  }).join('');
  refreshHints();
  if (dlg.fk) renderFkPanel();
}

// on: filled; locked: on because of the name, not a choice; gone: can't apply to this column
function setPill(b, on, { locked = false, gone = false, title }) {
  b.setAttribute('aria-pressed', on);
  b.disabled = locked || gone;
  b.classList.toggle('gone', gone);
  b.title = title;
}

// Placeholders and pills that depend on other fields (Id is the PK unless another column says pk)
function refreshHints() {
  const explicitPk = dlg.cols.some(c => c.pk && c.name.trim());
  const pkCount = dlg.cols.filter(c => c.pk && c.name.trim()).length;
  for (const row of tdCols.querySelectorAll('.col-row')) {
    const c = dlg.cols[+row.dataset.i];
    const pill = f => row.querySelector(`.pill[data-f="${f}"]`);
    const isId = isIdName(c.name.trim());
    const autoPk = !explicitPk && isId;
    const isPk = c.pk || autoPk;
    setPill(pill('pk'), isPk, { locked: autoPk, title: autoPk ? 'Id is the primary key automatically' : 'Primary key' });
    // a primary key column in the table's colour, as in the diagram
    const hue = isPk ? tableHue(SELF) : null;
    for (const el of [pill('pk'), row.querySelector('.c-name')]) {
      el.classList.toggle('h-hue', hue != null);
      el.style.setProperty('--h', hue ?? '');
    }
    // a primary key is never NULL
    if (isPk) c.nullable = false;
    setPill(pill('nullable'), c.nullable, { gone: isPk, title: 'May be NULL' });
    setPill(pill('unique'), c.unique, { title: 'UNIQUE' });
    // auto_increment: only an integer column that is the primary key on its own; such an Id has it already
    const canAuto = (autoPk || (c.pk && pkCount === 1)) && INT_TYPES.has(typeParts(normType(c.type.trim() || 'int')).base);
    const implied = canAuto && isId;
    if (!canAuto) c.auto = false;
    setPill(pill('auto'), canAuto && (c.auto || implied), {
      locked: implied, gone: !canAuto, title: implied ? 'Id is numbered by the database automatically' : 'AUTO_INCREMENT',
    });
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
  if (cl.contains('invalid')) clearError();
  refreshHints();
});

tdCols.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act.startsWith('fk-')) return fkPanelClick(b);
  const i = +b.closest('.col-row').dataset.i, cols = dlg.cols;
  switch (act) {
    case 'flag': cols[i][b.dataset.f] = b.getAttribute('aria-pressed') !== 'true'; return refreshHints();
    case 'del': cols.splice(i, 1); dlg.fk = null; break;
    case 'unlink': cols[i].ref = cols[i].refCol = null; if (dlg.fk?.row === i) dlg.fk = null; break;
    case 'fk': return openFk(i);
  }
  renderCols();
});

// ─── Moving a column: drag its grip, or Alt+↑/↓ in the row ───────────────────

function moveCol(i, to) {
  if (to < 0 || to >= dlg.cols.length || to === i) return false;
  dlg.cols.splice(to, 0, ...dlg.cols.splice(i, 1));
  dlg.fk = null;
  renderCols();
  return true;
}

tdCols.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.target.closest('.grip')) return;
  e.preventDefault();
  const from = +e.target.closest('.col-row').dataset.i;
  clearError();
  if (dlg.fk) { dlg.fk = null; renderCols(); } // the rows alone, nothing between them
  const row = tdCols.querySelector(`.col-row[data-i="${from}"]`);
  row.classList.add('dragging');
  tdCols.classList.add('reordering');
  tdCols.setPointerCapture(e.pointerId); // on the list, which stays while the row moves in it
  // the row goes before the first other row whose middle is below the pointer
  const move = ev => {
    const before = [...tdCols.children].find(r => r !== row && ev.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2) ?? null;
    if (row.nextElementSibling !== before) tdCols.insertBefore(row, before);
  };
  const end = () => {
    tdCols.removeEventListener('pointermove', move);
    tdCols.removeEventListener('pointerup', end);
    tdCols.removeEventListener('pointercancel', end);
    tdCols.classList.remove('reordering');
    dlg.cols = [...tdCols.children].map(r => dlg.cols[+r.dataset.i]);
    renderCols();
  };
  tdCols.addEventListener('pointermove', move);
  tdCols.addEventListener('pointerup', end);
  tdCols.addEventListener('pointercancel', end);
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
          <button data-act="fk-cancel" class="btn-outline">Cancel</button>
          <button data-act="fk-ok" id="fkOk" class="btn-primary">OK</button>
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
        `<span${keyed('', tableHue(t.key))}>${esc(t.name)}</span>${t.self ? ' <em>(this table)</em>' : ''}</button>`).join('')
    : '<div class="fk-empty">No table matches</div>';

  const pkBox = $('#fkUsePk');
  pkBox.checked = usePk;
  pkBox.disabled = !table?.pk;
  $('#fkPkLabel').textContent = table ? `Primary key (${table.pkNote})` : 'Primary key';

  const colsEl = $('#fkCols');
  if (!table) colsEl.innerHTML = '<div class="fk-empty">Choose a table</div>';
  else if (usePk) colsEl.innerHTML = '<div class="fk-empty">Untick "Primary key" to point to another column</div>';
  else colsEl.innerHTML = table.cols.map(c => {
    const tag = ` <b${keyed('', refHue(table.key, c.name))}>`;
    const tags = (c.isPk ? tag + 'PK</b>' : '') + (c.unique ? tag + 'UNIQUE</b>' : '') + (!c.isPk && !c.unique ? ' <i>not unique</i>' : '');
    return `<button class="fk-item${c.name === col ? ' on' : ''}" data-act="fk-col" data-col="${esc(c.name)}" role="option" aria-selected="${c.name === col}">` +
      `${esc(c.name)}:${esc(c.type)}${tags}</button>`;
  }).join('') || '<div class="fk-empty">This table has no columns yet</div>';

  const preview = $('#fkPreview'), hue = table && col ? refHue(table.key, usePk ? null : col) : null;
  preview.textContent = table && col ? `→ ${table.name}.${col}` : '';
  preview.classList.toggle('h-hue', hue != null);
  preview.style.setProperty('--h', hue ?? '');
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

// Why Save didn't, under the field it is about (lined up with it)
function fail(input, msg) {
  clearError();
  input.classList.add('invalid');
  input.focus();
  const at = input.closest('.col-row, .field');
  const err = document.createElement('div');
  err.className = 'field-error';
  err.textContent = msg;
  err.style.paddingLeft = input.getBoundingClientRect().left - at.getBoundingClientRect().left + 'px';
  at.after(err);
}

function clearError() {
  for (const el of dlgEl.querySelectorAll('.field-error')) el.remove();
  for (const el of dlgEl.querySelectorAll('.invalid')) el.classList.remove('invalid');
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
  const pkLine = cols.filter(c => c.pk).length > 1; // a key over several columns gets its own line
  for (const c of cols) {
    const parts = [c.name];
    if (c.type) parts.push(c.type);
    if (c.pk && !pkLine) parts.push('pk');
    if (c.nullable) parts.push('null');
    if (c.unique) parts.push('unique');
    if (c.indexed) parts.push('index');
    if (c.auto && !isIdName(c.name)) parts.push('auto_increment');
    if (c.ref) {
      const self = toSelf(c);
      const refCol = self && c.refCol ? renamed.get(lc(c.refCol)) ?? c.refCol : c.refCol;
      parts.push('-> ' + (self ? name : c.ref) + (refCol ? '.' + refCol : ''));
    }
    const opts = optsItems(c);
    if (opts.length) parts.push(`[${opts.join(', ')}]`);
    block.push('  ' + parts.join(' ') + (c.comment ? '  ' + c.comment : ''));
  }
  if (pkLine) block.push(`  pk (${cols.filter(c => c.pk).map(c => c.name).join(', ')})`);

  histBegin(dlg.orig ? 'edit table' : 'new table');
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
    // and the unique (…) and index (…) lines, following renamed columns; columns deleted in the dialog leave them
    const keyLines = (word, keys) => keys.filter(u => u.cols.length > 1)
      .map(u => ({ cols: u.cols.map(n => renamed.get(lc(n)) ?? n), comment: inlineComment(lines[u.line - 1]) }))
      .filter(u => u.cols.every(n => seen.has(lc(n))))
      .map(u => `  ${word} (${u.cols.join(', ')})` + (u.comment ? '  ' + u.comment : ''));
    lines.splice(s, e - s + 1, block[0], ...comments, ...block.slice(1), ...keyLines('unique', t.uniques), ...keyLines('index', t.multiIndexes));
    at = s + 1;
  } else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push('');
    at = lines.length + 1;
    lines.push(...block, '');
    // double-click on the canvas: exactly there; otherwise the layout picks the best spot
    if (dlg.at) pos[name] = { ...dlg.at };
    else delete pos[name];
  }
  saveDoc();
  closeTableEditor();
  commitText(lines.join('\n'), at);
  histCommit();
}

function deleteTable() {
  const btn = $('#tdDelete');
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Click again to delete';
    return;
  }
  const name = dlg.orig;
  closeTableEditor();
  deleteTables([name]);
}
function disarmDelete() {
  const btn = $('#tdDelete');
  btn.classList.remove('armed');
  btn.textContent = 'Delete table';
}

// ─── Deleting and duplicating tables (the dialog, the keys for the selected tables) ──

// Their lines go, from the bottom up so the line numbers of the others still hold; Undo in the toast
function deleteTables(names) {
  const doomed = textModel().tables.filter(t => names.includes(t.name)).sort((a, b) => b.line - a.line);
  if (!doomed.length) return;
  histBegin(doomed.length > 1 ? 'delete tables' : 'delete table');
  const lines = state.text.split('\n');
  for (const t of doomed) {
    const [s, e] = blockRange(lines, t.line - 1);
    lines.splice(s, e - s + 1);
    while (s < lines.length && !lines[s].trim() && (s === 0 || !lines[s - 1].trim())) lines.splice(s, 1);
    delete pos[t.name];
  }
  saveDoc();
  setSelected([...selected].filter(n => !names.includes(n)));
  commitText(lines.join('\n'), null);
  histCommit();
  toast(doomed.length > 1 ? `Deleted ${doomed.length} tables` : `Deleted ${doomed[0].name}`, 'Undo', histUndo);
}

// A table a foreign key points to but that isn't there yet ({ table, col, type } of the problem):
// at the end of the text with an Id, and the column it points to if that is another one
function createTable({ table, col, type }) {
  const { tables } = textModel();
  if (tables.some(t => lc(t.name) === lc(table))) return;
  histBegin('new table');
  const lines = state.text.split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length) lines.push('');
  const at = lines.length + 1;
  lines.push(table, '  Id');
  if (col && !isIdName(col)) lines.push(`  ${col}${type ? ' ' + type : ''} unique`);
  lines.push('');
  delete pos[table];
  saveDoc();
  commitText(lines.join('\n'), at);
  histCommit();
}

// Copies at the end of the text, named TableCopy (TableCopy2, …), placed like new tables and selected.
// A foreign key to a table copied along points to its copy (so a self-reference stays one).
function duplicateTables(names) {
  const { tables } = textModel();
  const originals = tables.filter(t => names.includes(t.name));
  if (!originals.length) return;
  const taken = new Set(tables.map(t => lc(t.name))), copyOf = new Map();
  for (const t of originals) {
    let n = t.name + 'Copy';
    for (let k = 2; taken.has(lc(n)); k++) n = t.name + 'Copy' + k;
    taken.add(lc(n));
    copyOf.set(lc(t.name), n);
  }
  histBegin(originals.length > 1 ? 'duplicate tables' : 'duplicate table');
  const lines = state.text.split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  for (const t of originals) {
    const [s, e] = blockRange(lines, t.line - 1);
    const block = lines.slice(s, e + 1), copy = copyOf.get(lc(t.name));
    block[0] = copy + block[0].slice(block[0].indexOf(t.name) + t.name.length);
    for (const c of t.cols) {
      const to = c.ref && copyOf.get(lc(c.ref));
      if (to) block[c.line - 1 - s] = block[c.line - 1 - s].replace(REF_RE, '-> ' + to + (c.refCol ? '.' + c.refCol : ''));
    }
    if (lines.length) lines.push('');
    lines.push(...block);
    delete pos[copy];
  }
  lines.push('');
  saveDoc();
  commitText(lines.join('\n'), null);
  histCommit();
  setSelected([...copyOf.values()]);
}

// Write new text into the editor (in SQL mode the SQL is regenerated from it).
// Undo is handled by the app's history, which records the caller's action.
function commitText(text, line) {
  state.text = text;
  state.sqlStale = true;
  if (state.mode === 'text') {
    const top = ta.scrollTop;
    ta.value = text;
    update();
    ta.scrollTop = top;
    if (line) selectLine(line); else syncScroll();
    saveState();
  } else {
    const r = parseText(text);
    resolve(r.tables);
    state.sql = genSQL(r.tables, state.dialect);
    state.sqlStale = false;
    ta.value = state.sql;
    update();
    saveState();
  }
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

$('#newTableBtn').onclick = () => openTableEditor(null);
$('#tdSave').onclick = saveTable;
$('#tdCancel').onclick = closeTableEditor;
$('#tdDelete').onclick = deleteTable;
tdName.addEventListener('input', () => {
  if (tdName.classList.contains('invalid')) clearError();
  if (dlg.fk) renderFkPanel(); // "this table" shows the new name
});
dlgEl.addEventListener('pointerdown', e => { if (e.target === dlgEl) requestClose(); });

// Esc closes the chooser if it is open, else the dialog: from anywhere, since the focus leaves
// the dialog when the row it was in is re-rendered (the chooser's own keys are handled below)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || dlgEl.hidden || !$('#confirmDlg').hidden || e.target.closest('.fk-panel')) return;
  e.preventDefault();
  if (dlg.fk) closeFk(); else requestClose();
});

dlgEl.addEventListener('keydown', e => {
  if (e.target.closest('.fk-panel')) return fkKeydown(e);
  const row = e.target.closest('.col-row');
  if (row && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    // the same field of the moved row keeps the focus
    const i = +row.dataset.i, to = i + (e.key === 'ArrowUp' ? -1 : 1);
    const k = [...row.querySelectorAll('input, button')].indexOf(e.target);
    if (moveCol(i, to)) tdCols.querySelectorAll(`.col-row[data-i="${to}"] :is(input, button)`)[k]?.focus();
    return;
  }
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  // Enter in the last column's name adds another column; anywhere else it saves
  if (row && e.target.classList.contains('c-name') && +row.dataset.i === dlg.cols.length - 1 && e.target.value.trim()) addColumn();
  else saveTable();
});

// The table a selection of one is, if it still exists
const selectedTable = () => selected.size === 1 ? model.tables.find(t => selected.has(t.name)) ?? null : null;

// ↵ (edit), ⌫ / Delete and ⌘D act on the tables selected in the diagram, unless you are typing
document.addEventListener('keydown', e => {
  if (!selected.size || !dlgEl.hidden || !$('#confirmDlg').hidden || e.target.closest('input, textarea, [contenteditable]')) return;
  const mod = e.metaKey || e.ctrlKey;
  if ((e.key === 'Backspace' || e.key === 'Delete') && !mod && !e.altKey) {
    e.preventDefault();
    closeMenus();
    deleteTables([...selected]);
  } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
    e.preventDefault(); // not the browser's bookmark
    closeMenus();
    duplicateTables([...selected]);
  } else if (e.key === 'Enter' && !mod && selectedTable() && !e.target.closest('button, a, select')) {
    e.preventDefault();
    closeMenus();
    openTableEditor(selectedTable().name);
  }
});

// ─── Right-click menu of a table ─────────────────────────────────────────────

const tableMenu = $('#tableMenu');
const tableMenuItems = () => [...tableMenu.querySelectorAll('button')].filter(b => !b.hidden);

svg.addEventListener('contextmenu', e => {
  const g = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tbl');
  if (!g) return; // the empty canvas keeps the browser's menu
  e.preventDefault();
  if (!selected.has(g.dataset.t)) setSelected([g.dataset.t]);
  closeMenus();
  // several selected: only what works on all of them
  const n = selected.size;
  for (const el of tableMenu.querySelectorAll('.one')) el.hidden = n > 1;
  $('#tmDup').textContent = n > 1 ? `Duplicate ${n} tables` : 'Duplicate';
  $('#tmDel').textContent = n > 1 ? `Delete ${n} tables` : 'Delete';
  tableMenu.hidden = false;
  const r = tableMenu.getBoundingClientRect();
  tableMenu.style.left = Math.max(8, Math.min(e.clientX, innerWidth - r.width - 8)) + 'px';
  tableMenu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - r.height - 8)) + 'px';
  tableMenu.focus(); // for ↓ ↑ and the shortcuts; Esc closes it
});

tableMenu.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); return closeMenus(); } // the menu only, the selection stays
  const items = tableMenuItems(), i = items.indexOf(document.activeElement);
  const to = { ArrowDown: i + 1, ArrowUp: i < 0 ? -1 : i - 1, Home: 0, End: items.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  items[(to + items.length) % items.length].focus();
});

tableMenu.addEventListener('click', e => {
  const cmd = e.target.closest('[data-cmd]')?.dataset.cmd, t = selectedTable();
  if (!cmd) return;
  closeMenus();
  if (cmd === 'dup') duplicateTables([...selected]);
  else if (cmd === 'del') deleteTables([...selected]);
  else if (!t) return;
  else if (cmd === 'edit') openTableEditor(t.name);
  else if (cmd === 'addcol') { openTableEditor(t.name); addColumn(); }
  else if (cmd === 'show') selectLine(t.line);
});

svg.addEventListener('dblclick', e => {
  // the canvas captures the pointer on mousedown (for dragging), so the event's target
  // is the canvas itself: ask what is really under the pointer
  const el = document.elementFromPoint(e.clientX, e.clientY), g = el?.closest('.tbl');
  if (g) {
    const key = el.closest('.row')?.dataset.key; // "Table.Column"
    openTableEditor(g.dataset.t, null, key ? key.slice(g.dataset.t.length + 1) : null);
  } else {
    const w = toWorld(e);
    openTableEditor(null, { x: snap(w.x - 20), y: snap(w.y - 15) });
  }
});
