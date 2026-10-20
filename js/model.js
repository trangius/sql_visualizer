'use strict';

// ─── Small helpers ───────────────────────────────────────────────────────────

const $ = s => document.querySelector(s);
// localStorage, under "sqlviz.*" keys. set() returns false when it couldn't save (e.g. storage full).
const store = {
  get(k, d) { try { const v = localStorage.getItem('sqlviz.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sqlviz.' + k, JSON.stringify(v)); return true; } catch { return false; } },
  remove(k) { try { localStorage.removeItem('sqlviz.' + k); } catch {} },
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IDENT = /^[\p{L}_][\p{L}\p{N}_$]*$/u;
const isIdName = n => n.toLowerCase() === 'id';
const DEFAULT_VC = 128;
const INT_TYPES = new Set(['int', 'integer', 'bigint', 'smallint', 'mediumint', 'tinyint']);
const problem = (line, msg, level = 'error') => ({ line, msg, level });
const snap = v => Math.round(v / 10) * 10; // the diagram's 10px grid
// Where a line's # comment starts, -1 for none. A # inside 'quotes' is text: [default '#fff']
function commentAt(line) {
  const code = line.match(/^(?:[^#']|'(?:[^']|'')*'?)*/)[0];
  return code.length < line.length ? code.length : -1;
}
const stripComment = line => { const i = commentAt(line); return i < 0 ? line : line.slice(0, i); };

// Applies f to a type outside its 'quoted' values, so enum('Small','Large') keeps its case
const outsideQuotes = (t, f) => t.replace(/'(?:[^']|'')*'?|[^']+/g, m => m[0] === "'" ? m : f(m));

// Canonical short form of a type: "VARCHAR(128)" → "vc", "varchar(50)" → "vc(50)", "INT(11)" → "int"
function normType(t) {
  if (!t) return null;
  let s = outsideQuotes(t, s => s.toLowerCase()).replace(/\s+/g, ' ').replace(/\s*\(\s*/g, '(').replace(/\s*,\s*/g, ',').replace(/\s*\)/g, ')').trim();
  const m = s.match(/^(?:vc|varchar)(?:\((\d+)\))?(?=$|\s)(.*)$/);
  if (m) {
    const n = m[1] ? +m[1] : DEFAULT_VC;
    return (n === DEFAULT_VC ? 'vc' : `vc(${n})`) + m[2];
  }
  return s.replace(/^integer\b/, 'int').replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1');
}

// A type as its parts: "decimal(8,2) unsigned" → { base: 'decimal', args: '8,2', rest: ' unsigned', unsigned: true }
function typeParts(t) {
  const m = t.match(/^(\w+)(?:\(([^)]*)\))?(.*)$/);
  return { base: m[1], args: m[2] ?? null, rest: m[3], unsigned: /\bunsigned\b/.test(m[3]) };
}
// The values of enum('S','M','L') or set(…), unquoted
const enumOptions = t => [...(t.match(/^(enum|set)\((.*)\)$/)?.[2] ?? '').matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"));

function sqlType(t) {
  const m = t.match(/^vc(?:\((\d+)\))?(?=$|\s)(.*)$/);
  const up = s => outsideQuotes(s, s => s.toUpperCase());
  if (m) return `VARCHAR(${m[1] || DEFAULT_VC})` + up(m[2]);
  return up(t);
}

// ─── Text syntax → model ─────────────────────────────────────────────────────
// model: { tables: [{ name, line, cols: [{ name, type, pk, nullable, unique, ref, refCol, line }], pkLine, uniques }] }
// ref/refCol: "-> Table" (its primary key, refCol null) or "-> Table.Column"
// pkLine / uniques: keys over several columns, written on their own line: "pk (A, B)", "unique (A, B)"

const FLAG = /^\(?(pk|null|unique)\)?$/i;
const KEY_LINE = /^\s+(pk|unique)\s*\(([^)]*)\)?\s*$/i;
// The name an index gets in the SQL when none was given
const indexName = (table, cols) => `idx_${table}_${cols.join('_')}`;

// "# e.g. Volvo, Saab, Audi" after a column: the values its sample data takes
function sampleHint(line) {
  const m = line.match(/#\s*(?:e\.\s?g\.?|ex\.|t\.\s?ex\.?|example|exempel)[:\s]+(.+)$/i);
  return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : null;
}

// What [ … ] after a column can say: what happens to it when the row it points to is deleted or
// its key updated, and the value it gets when an INSERT leaves it out
const FK_ACTIONS = ['cascade', 'set null', 'restrict', 'no action'];
const splitOpts = s => (s.match(/(?:'(?:[^']|'')*'?|\([^)]*\)?|[^,'(])+/g) ?? []).map(x => x.trim()).filter(Boolean);
const DEFAULT_VALUE = /^(-?\d+(\.\d+)?|'(?:[^']|'')*'|null|true|false|now|\(.*\))$/i;

function parseOpts(s, col, line, problems) {
  for (const item of splitOpts(s)) {
    const m = item.match(/^(delete|update|default)\b\s*(.*)$/i);
    if (!m) { problems.push(problem(line, `"${item}" in [ ] means nothing. Write delete …, update … or default …`)); continue; }
    const what = m[1].toLowerCase(), v = m[2].trim();
    if (what === 'default') {
      if (!v) problems.push(problem(line, 'Write the value after default: [default 0]'));
      else if (!DEFAULT_VALUE.test(v)) problems.push(problem(line, `Write text in quotes: [default '${v.replace(/'/g, "''")}']`));
      else if (/^null$/i.test(v) && !col.nullable) problems.push(problem(line, `${col.name} can't default to null unless it is null`));
      else if (!/^null$/i.test(v)) col.default = /^(true|false|now)$/i.test(v) ? v.toLowerCase() : v; // null goes without saying
      continue;
    }
    const a = v.toLowerCase().replace(/\s+/g, ' ');
    if (!col.ref) problems.push(problem(line, `[${what} …] is for a foreign key: write -> Table first`));
    else if (!FK_ACTIONS.includes(a)) problems.push(problem(line, `Write ${what} cascade, ${what} set null or ${what} restrict`));
    else if (a === 'set null' && !col.nullable) problems.push(problem(line, `${what} set null needs ${col.name} to be null`));
    else col[what === 'delete' ? 'onDelete' : 'onUpdate'] = a;
  }
}

// The [ … ] of a column, as genText and the table dialog write it
function optsItems(c) {
  return [c.ref && c.onDelete && 'delete ' + c.onDelete, c.ref && c.onUpdate && 'update ' + c.onUpdate,
    c.default != null && 'default ' + c.default].filter(Boolean);
}

function parseText(src) {
  const tables = [], problems = [];
  let cur = null;
  src.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const code = stripComment(raw);
    if (!code.trim()) return;

    if (!/^\s/.test(code)) {
      const name = code.trim().replace(/:$/, '');
      if (!IDENT.test(name)) {
        problems.push(problem(line, `"${name}" is not a valid table name`));
        cur = { name, cols: [], indexes: [] }; // swallow its columns silently
        return;
      }
      if (tables.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        problems.push(problem(line, `Table ${name} is defined twice`));
        cur = { name, cols: [], indexes: [] };
        return;
      }
      cur = { name, line, cols: [], indexes: [], pkLine: null, uniques: [] };
      tables.push(cur);
      return;
    }

    if (!cur) {
      problems.push(problem(line, 'Column outside a table. Write a table name (without indentation) first.'));
      return;
    }

    if (/^\s+index\b\s*(?:[\p{L}_][\p{L}\p{N}_$]*\s*)?\(/iu.test(code)) {
      problems.push(problem(line, 'Indexes are not supported in Simple mode.'));
      return;
    }

    const key = code.match(KEY_LINE);
    if (key) {
      const names = key[2].split(',').map(n => n.trim());
      if (!/\)\s*$/.test(code)) problems.push(problem(line, 'Missing ) after the column names'));
      else if (names.some(n => !IDENT.test(n))) {
        problems.push(problem(line, `Write ${key[1].toLowerCase()} (Column, Column) with the columns that together form the key`));
      } else if (key[1].toLowerCase() === 'unique') cur.uniques.push({ cols: names, line });
      else if (cur.pkLine) problems.push(problem(line, `${cur.name} already has a pk (…) line on line ${cur.pkLine.line}`));
      else cur.pkLine = { cols: names, line };
      return;
    }

    // "[delete cascade, default 0]" last on the line
    const bi = code.indexOf('['), opts = bi >= 0 ? code.slice(bi + 1) : null;
    if (opts != null && !/\]\s*$/.test(opts)) {
      problems.push(problem(line, opts.includes(']') ? 'Write [ … ] last on the line' : 'Missing ] after the options'));
      return;
    }
    const parts = (bi >= 0 ? code.slice(0, bi) : code).split('->');
    if (parts.length > 2) { problems.push(problem(line, 'Only one -> per column')); return; }
    let ref = null, refCol = null;
    if (parts.length === 2) {
      const target = parts[1].trim();
      const m = target.match(/^([\p{L}_][\p{L}\p{N}_$]*)(?:\s*[.(]\s*([\p{L}_][\p{L}\p{N}_$]*)\s*\)?)?$/u);
      if (!target) problems.push(problem(line, 'Missing table name after ->'));
      else if (!m) problems.push(problem(line, `"${target}" is not a valid table or Table.Column`));
      else { ref = m[1]; refCol = m[2] ?? null; }
    }

    const toks = parts[0].trim().match(/[^\s(]+(?:\([^)]*\)?)?|\([^)]*\)?/g) || [];
    let name = toks.shift();
    if (!name) { problems.push(problem(line, 'Missing column name')); return; }
    if (name.includes(':')) { // tolerate the diagram form "Name:type"
      const [a, b] = name.split(/:(.*)/);
      name = a;
      if (b) toks.unshift(b);
    }
    if (!IDENT.test(name)) { problems.push(problem(line, `"${name}" is not a valid column name`)); return; }
    if (cur.cols.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      problems.push(problem(line, `Column ${name} is defined twice in ${cur.name}`));
      return;
    }
    const col = { name, type: null, pk: false, nullable: false, unique: false, ref, refCol, line, hint: sampleHint(raw),
      onDelete: null, onUpdate: null, default: null };
    const typeParts = [];
    for (const t of toks) {
      if (/^\(?index\)?$/i.test(t)) {
        problems.push(problem(line, 'Indexes are not supported in Simple mode.'));
        continue;
      }
      const f = t.match(FLAG);
      if (!f) typeParts.push(t);
      else if (f[1].toLowerCase() === 'pk') col.pk = true;
      else if (f[1].toLowerCase() === 'null') col.nullable = true;
      else col.unique = true;
    }
    col.type = typeParts.join(' ') || null;
    if (opts != null) parseOpts(opts.replace(/\]\s*$/, ''), col, line, problems);
    cur.cols.push(col);
  });
  // pk on several columns reads like several keys; a key over several columns is written pk (A, B)
  for (const t of tables) {
    const pks = t.cols.filter(c => c.pk);
    if (pks.length > 1) problems.push(problem(pks[1].line, `${pks.map(c => c.name).join(' and ')} are ${pks.length > 2 ? 'all' : 'both'} marked pk, ` +
      `which makes them one primary key together. Write pk (${pks.map(c => c.name).join(', ')}) if you mean that, ` +
      'otherwise mark only one column pk.', 'warn'));
  }
  return { tables, problems };
}

// ─── Resolve: primary keys, arrows, default types ────────────────────────────

// Is c on its own the primary key of t? A foreign key to such a column is written "-> Table"
const solePk = (t, c) => t.pkCols.length === 1 && t.pkCols[0] === c;
const pointsToPk = c => solePk(c.target, c.targetCol);

// An FK column without a type gets the type of the column it points to
function defaultType(c, seen = new Set()) {
  if (isIdName(c.name)) return 'int';
  if (c.targetCol && !c.implicit && !seen.has(c)) { seen.add(c); return effType(c.targetCol, seen); }
  if (c.ref) return 'int';
  return 'vc';
}
function effType(c, seen) { return c.type ? normType(c.type) : defaultType(c, seen); }

// ─── Types ───────────────────────────────────────────────────────────────────
// A written type must be a real MariaDB type (plus our vc), so typos don't slip through:
// "Name vc uniqie" would otherwise quietly become a column of type "vc uniqie".

const SQL_TYPE_NAMES = new Set(`vc tinyint smallint mediumint int integer bigint decimal dec numeric fixed float
double real bit bool boolean serial char varchar binary varbinary tinytext text mediumtext longtext tinyblob
blob mediumblob longblob enum set date datetime timestamp time year json uuid inet4 inet6 geometry point
linestring polygon`.split(/\s+/));
const TYPE_MODIFIERS = new Set(['unsigned', 'signed', 'zerofill', 'precision']);
const FLAG_WORDS = ['pk', 'null', 'unique'];

// What a foreign key compares: integers by size and sign, decimals by precision and scale,
// strings without their length. null for TEXT, BLOB and JSON, which can't be keys at all.
const INT_SIZE = { tinyint: 'tinyint', bool: 'tinyint', boolean: 'tinyint', smallint: 'smallint',
  mediumint: 'mediumint', int: 'int', integer: 'int', bigint: 'bigint', serial: 'bigint' };
function keyType(t) {
  const { base, args, rest, unsigned } = typeParts(t);
  if (base in INT_SIZE) return INT_SIZE[base] + (base === 'serial' || unsigned ? ' unsigned' : '');
  if (/^(decimal|dec|numeric|fixed)$/.test(base)) return `decimal(${(args ?? '10').replace(/^(\d+)$/, '$1,0')})` + rest;
  if (/^(vc|varchar|char)$/.test(base)) return 'string';
  if (/^(binary|varbinary)$/.test(base)) return 'binary';
  if (/(text|blob)$|^json$/.test(base)) return null;
  return base + rest;
}

// Levenshtein distance, for "did you mean …?"
function editDistance(a, b) {
  let row = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
function closest(word, candidates) {
  let best = null, dist = Infinity;
  for (const c of candidates) { const d = editDistance(word, c); if (d < dist) { best = c; dist = d; } }
  return dist <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
}

// null if the type is fine, otherwise the problem to report
function typeProblem(type) {
  const words = type.toLowerCase().replace(/\([^)]*\)/g, '').trim().split(/\s+/);
  const bad = [words[0], ...words.slice(1)].find((w, i) => !(i === 0 ? SQL_TYPE_NAMES.has(w) : TYPE_MODIFIERS.has(w)));
  if (!bad) return null;
  const orig = type.match(new RegExp(bad.replace(/[^\p{L}\p{N}_]/gu, ''), 'iu'))?.[0] ?? bad;
  const guess = closest(bad, FLAG_WORDS) ?? closest(bad, [...SQL_TYPE_NAMES, ...TYPE_MODIFIERS]);
  return `Unknown type ${orig}` + (guess ? `. Did you mean ${guess}?` : '');
}

// With the "Implicit links" toggle on, a column without "->" whose name is a table name + Id
// ("OwnerId", "owner_id", "CategoryId" → Categories) gets an arrow to that table's primary key.
// It only affects the diagram: the text, the SQL and the column's type are left as they are.
function implicitTarget(c, lower) {
  const m = c.name.match(/^(.+?)(?:Id|ID|_id|_ID)$/);
  if (!m) return null;
  const s = m[1].toLowerCase();
  for (const n of [s, s + 's', s + 'es', s.replace(/y$/, 'ies')]) {
    const t = lower.get(n);
    if (t && t.pkCols.length === 1 && t.pkCols[0] !== c) return t;
  }
  return null;
}

const colNamed = (t, n) => t.cols.find(c => c.name.toLowerCase() === n.toLowerCase());

function resolve(tables, implicit = false) {
  const problems = [];
  const exact = new Map(tables.map(t => [t.name, t]));
  const lower = new Map(tables.map(t => [t.name.toLowerCase(), t]));
  for (const t of tables) {
    t.idCol = t.cols.find(c => isIdName(c.name)) || null;
    const explicit = t.cols.filter(c => c.pk);
    if (t.pkLine) { // "pk (A, B)": as if pk were written on each of them
      if (explicit.length) problems.push(problem(t.pkLine.line, 'Write the primary key either as pk (…) or as pk on a column, not both', 'warn'));
      for (const n of t.pkLine.cols) {
        const c = colNamed(t, n);
        if (!c) problems.push(problem(t.pkLine.line, `${t.name} has no column ${n}`));
        else if (!explicit.includes(c)) explicit.push(c);
      }
    }
    t.pkCols = explicit.length ? explicit : t.idCol ? [t.idCol] : [];
    if (t.idCol && t.pkCols.length && !t.pkCols.includes(t.idCol)) {
      const key = t.pkCols.map(c => c.name).join(', ');
      problems.push(problem(t.idCol.line, `${t.idCol.name} is not the primary key here, ${t.pkCols.length > 1 ? `(${key})` : key} is. ` +
        `Remove ${t.idCol.name}, or make it the key and write unique (${key}) instead.`, 'warn'));
    }
    // "unique (A, B)": the combination is unique. Over one column it is just the flag.
    t.multiUniques = [];
    for (const u of t.uniques ?? []) {
      const cols = u.cols.map(n => colNamed(t, n));
      const missing = u.cols.find((n, i) => !cols[i]);
      if (missing) problems.push(problem(u.line, `${t.name} has no column ${missing}`));
      else if (cols.length === 1) cols[0].unique = true;
      else t.multiUniques.push({ cols, line: u.line });
    }
  }
  // A key over several columns adds nothing when part of it is already unique by itself
  for (const t of tables) {
    const keys = [...(t.pkCols.length > 1 ? [{ cols: t.pkCols, line: t.pkLine?.line ?? t.pkCols[1].line, what: 'pk' }] : []),
      ...t.multiUniques.map(u => ({ ...u, what: 'unique' }))];
    for (const k of keys) {
      const alone = k.cols.find(c => c.unique || solePk(t, c));
      const hasPk = k.what === 'unique' && t.pkCols.length > 1 && t.pkCols.every(c => k.cols.includes(c));
      if (alone || hasPk) problems.push(problem(k.line, `${alone ? alone.name : 'The primary key'} is already unique by itself, ` +
        `so ${k.what} (${k.cols.map(c => c.name).join(', ')}) adds nothing`, 'warn'));
    }
  }
  for (const t of tables) {
    if (!t.cols.length) problems.push(problem(t.line, `${t.name} has no columns`, 'warn'));
    for (const c of t.cols) {
      c.target = c.targetCol = c.refError = null;
      c.implicit = false;
      if (!c.ref) {
        const tt = implicit && implicitTarget(c, lower);
        if (tt) { c.target = tt; c.targetCol = tt.pkCols[0]; c.implicit = true; }
        continue;
      }
      const tt = exact.get(c.ref) || lower.get(c.ref.toLowerCase());
      if (!tt) c.refError = `No table named ${c.ref}`;
      else if (c.refCol) {
        const col = tt.cols.find(o => o.name.toLowerCase() === c.refCol.toLowerCase());
        if (col) { c.target = tt; c.targetCol = col; }
        else c.refError = `${tt.name} has no column ${c.refCol}`;
      } else if (tt.pkCols.length === 1) {
        c.target = tt;
        c.targetCol = tt.pkCols[0];
      } else {
        c.refError = tt.pkCols.length
          ? `${tt.name} has a primary key of several columns. Write -> ${tt.name}.Column`
          : `${tt.name} has no primary key. Write -> ${tt.name}.Column`;
      }
      if (c.refError) problems.push(problem(c.line, c.refError)); // what the database says about it: dialectProblems()
    }
  }
  for (const t of tables) {
    for (const c of t.cols) {
      c.effType = effType(c);
      if (c.type) {
        const bad = typeProblem(c.type);
        if (bad) problems.push(problem(c.line, bad));
      }
      c.isPk = t.pkCols.includes(c);
      c.indexed = false;
      c.autoInc = solePk(t, c) && isIdName(c.name) && INT_TYPES.has(typeParts(c.effType).base);
      if (c.isPk && c.nullable) problems.push(problem(c.line, `${c.name} is a primary key and can't be null`));
    }
  }
  // Indexes: a one-column index is shown as a flag on its column, a longer one below the columns
  for (const t of tables) {
    t.indexes ??= [];
    t.multiIndexes = [];
    const named = new Map(); // the index's name in the SQL, lower case → index
    t.indexes = t.indexes.filter(ix => {
      const cols = ix.cols.map(n => t.cols.find(c => c.name.toLowerCase() === n.toLowerCase()));
      const missing = ix.cols.find((n, i) => !cols[i]);
      if (missing) { problems.push(problem(ix.line, `${t.name} has no column ${missing}`)); return true; }
      ix.cols = cols.map(c => c.name);
      const key = (ix.name ?? indexName(t.name, ix.cols)).toLowerCase(), prev = named.get(key);
      if (prev) { // MariaDB refuses two indexes with the same name
        problems.push(prev.cols.join() === ix.cols.join()
          ? problem(ix.line, `This index is already on line ${prev.line}`, 'warn')
          : problem(ix.line, `Two indexes are named ${ix.name ?? key}`));
        return false;
      }
      named.set(key, ix);
      if (cols.length === 1) cols[0].indexed = true;
      else t.multiIndexes.push(ix);
      return true;
    });
  }
  return problems;
}

// ─── Model → text syntax ─────────────────────────────────────────────────────

// "-> Table" when it points to the table's (single) primary key, otherwise "-> Table.Column"
function refText(c) {
  if (!c.target) return c.ref + (c.refCol ? '.' + c.refCol : '');
  return c.target.name + (pointsToPk(c) ? '' : '.' + c.targetCol.name);
}

function genText(tables, notes) {
  const out = [];
  if (notes.length) {
    out.push('# Converted from SQL. Some things could not be represented:');
    for (const n of notes) out.push(`#   ${n.msg}`);
    out.push('');
  }
  tables.forEach((t, i) => {
    if (i) out.push('');
    out.push(t.name);
    const pkLine = t.pkCols.length > 1; // only an explicit key can span several columns
    for (const c of t.cols) {
      const parts = [c.name];
      if (c.effType !== defaultType(c)) parts.push(c.effType);
      if (c.isPk && !pkLine && (c.pk || t.pkLine)) parts.push('pk');
      if (c.nullable) parts.push('null');
      if (c.unique) parts.push('unique');
      if (c.ref) parts.push('-> ' + refText(c));
      const opts = optsItems(c);
      if (opts.length) parts.push(`[${opts.join(', ')}]`);
      out.push('  ' + parts.join(' '));
    }
    if (pkLine) out.push(`  pk (${t.pkCols.map(c => c.name).join(', ')})`);
    for (const u of t.multiUniques) out.push(`  unique (${u.cols.map(c => c.name).join(', ')})`);
  });
  return out.join('\n') + '\n';
}
