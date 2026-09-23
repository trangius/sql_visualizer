'use strict';

// ─── Small helpers ───────────────────────────────────────────────────────────

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('sqlviz.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sqlviz.' + k, JSON.stringify(v)); } catch {} },
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IDENT = /^[\p{L}_][\p{L}\p{N}_$]*$/u;
const isIdName = n => n.toLowerCase() === 'id';
const DEFAULT_VC = 128;
const INT_TYPES = new Set(['int', 'integer', 'bigint', 'smallint', 'mediumint', 'tinyint']);
const problem = (line, msg, level = 'error') => ({ line, msg, level });

// Canonical short form of a type: "VARCHAR(128)" → "vc", "varchar(50)" → "vc(50)", "INT(11)" → "int"
function normType(t) {
  if (!t) return null;
  let s = t.toLowerCase().replace(/\s+/g, ' ').replace(/\s*\(\s*/g, '(').replace(/\s*,\s*/g, ',').replace(/\s*\)/g, ')').trim();
  const m = s.match(/^(?:vc|varchar)(?:\((\d+)\))?(?=$|\s)(.*)$/);
  if (m) {
    const n = m[1] ? +m[1] : DEFAULT_VC;
    return (n === DEFAULT_VC ? 'vc' : `vc(${n})`) + m[2];
  }
  return s.replace(/^integer\b/, 'int').replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1');
}

function sqlType(t) {
  const m = t.match(/^vc(?:\((\d+)\))?(?=$|\s)(.*)$/);
  if (m) return `VARCHAR(${m[1] || DEFAULT_VC})` + m[2].toUpperCase();
  return t.toUpperCase();
}

// ─── Text syntax → model ─────────────────────────────────────────────────────
// model: { tables: [{ name, line, cols: [{ name, type, pk, nullable, unique, ref, line }] }] }

const FLAG = /^\(?(pk|null|unique)\)?$/i;

function parseText(src) {
  const tables = [], problems = [];
  let cur = null;
  src.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const code = raw.replace(/#.*$/, '');
    if (!code.trim()) return;

    if (!/^\s/.test(code)) {
      const name = code.trim().replace(/:$/, '');
      if (!IDENT.test(name)) {
        problems.push(problem(line, `"${name}" is not a valid table name`));
        cur = { name, cols: [] }; // swallow its columns silently
        return;
      }
      if (tables.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        problems.push(problem(line, `Table ${name} is defined twice`));
        cur = { name, cols: [] };
        return;
      }
      cur = { name, line, cols: [] };
      tables.push(cur);
      return;
    }

    if (!cur) {
      problems.push(problem(line, 'Column outside a table. Write a table name (without indentation) first.'));
      return;
    }

    const parts = code.split('->');
    if (parts.length > 2) { problems.push(problem(line, 'Only one -> per column')); return; }
    let ref = null;
    if (parts.length === 2) {
      const target = parts[1].trim();
      const m = target.match(/^([\p{L}_][\p{L}\p{N}_$]*)(?:\s*[.(]\s*([\p{L}_][\p{L}\p{N}_$]*)\s*\)?)?$/u);
      if (!target) problems.push(problem(line, 'Missing table name after ->'));
      else if (!m) problems.push(problem(line, `"${target}" is not a valid table name`));
      else if (m[2] && !isIdName(m[2])) problems.push(problem(line, `Arrows can only point to Id, not ${m[2]}`));
      else ref = m[1];
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
    const col = { name, type: null, pk: false, nullable: false, unique: false, ref, line };
    const typeParts = [];
    for (const t of toks) {
      const f = t.match(FLAG);
      if (!f) typeParts.push(t);
      else if (f[1].toLowerCase() === 'pk') col.pk = true;
      else if (f[1].toLowerCase() === 'null') col.nullable = true;
      else col.unique = true;
    }
    col.type = typeParts.join(' ') || null;
    cur.cols.push(col);
  });
  return { tables, problems };
}

// ─── Resolve: primary keys, arrows, default types ────────────────────────────

function defaultType(c) {
  if (isIdName(c.name)) return 'int';
  if (c.target) return effType(c.target.idCol);
  if (c.ref) return 'int';
  return 'vc';
}
function effType(c) { return c.type ? normType(c.type) : defaultType(c); }

function resolve(tables) {
  const problems = [];
  const exact = new Map(tables.map(t => [t.name, t]));
  const lower = new Map(tables.map(t => [t.name.toLowerCase(), t]));
  for (const t of tables) {
    t.idCol = t.cols.find(c => isIdName(c.name)) || null;
    const explicit = t.cols.filter(c => c.pk);
    t.pkCols = explicit.length ? explicit : t.idCol ? [t.idCol] : [];
  }
  for (const t of tables) {
    if (!t.cols.length) problems.push(problem(t.line, `${t.name} has no columns`, 'warn'));
    for (const c of t.cols) {
      c.target = null;
      c.refError = null;
      if (c.ref) {
        const tt = exact.get(c.ref) || lower.get(c.ref.toLowerCase());
        if (!tt) c.refError = `No table named ${c.ref}`;
        else if (!tt.idCol) c.refError = `${tt.name} has no Id column. Arrows can only point to Id.`;
        else c.target = tt;
        if (c.refError) problems.push(problem(c.line, c.refError));
      }
    }
  }
  for (const t of tables) {
    for (const c of t.cols) {
      c.effType = effType(c);
      c.isPk = t.pkCols.includes(c);
      c.autoInc = c.isPk && t.pkCols.length === 1 && isIdName(c.name) && INT_TYPES.has(c.effType.split(/[ (]/)[0]);
      if (c.isPk && c.nullable) problems.push(problem(c.line, `${c.name} is a primary key and can't be null`));
    }
  }
  return problems;
}

// ─── Model → text syntax ─────────────────────────────────────────────────────

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
    for (const c of t.cols) {
      const parts = [c.name];
      if (c.effType !== defaultType(c)) parts.push(c.effType);
      if (c.pk) parts.push('pk');
      if (c.nullable) parts.push('null');
      if (c.unique) parts.push('unique');
      if (c.ref) parts.push('-> ' + c.ref);
      out.push('  ' + parts.join(' '));
    }
  });
  return out.join('\n') + '\n';
}
