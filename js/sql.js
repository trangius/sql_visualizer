'use strict';

// One conversion shared by editor regeneration, share links and document transforms.
function sqlToText(sql, includeProblems = true, dialect = 'mariadb') {
  const r = parseSQL(sql, dialect);
  resolve(r.tables);
  return genText(r.tables, includeProblems ? r.problems : []);
}

// ─── SQL → model ─────────────────────────────────────────────────────────────

function tokenizeSQL(src, dialect = 'mariadb') {
  const { dqIdent, backslash, nPrefix } = dialectOf(dialect);
  if (dialect === 'mssql') src = src.replace(/^[ \t]*GO(?:[ \t]+\d+)?[ \t]*$/gim, ';'); // GO ends a batch
  const toks = [];
  let i = 0, line = 1;
  const wordCh = /[\p{L}\p{N}_$]/u;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if ((ch === '-' && src[i + 1] === '-') || ch === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (ch === '`' || (dqIdent && (ch === '"' || ch === '['))) { // a quoted name
      const start = line, close = ch === '[' ? ']' : ch;
      let v = '';
      i++;
      while (i < src.length) {
        if (src[i] === close) { if (close !== ']' && src[i + 1] === close) { v += close; i += 2; continue; } break; }
        if (src[i] === '\n') line++;
        v += src[i++];
      }
      i++;
      toks.push({ t: 'id', v, line: start });
      continue;
    }
    if (nPrefix && (ch === 'N' || ch === 'n') && src[i + 1] === "'") { i++; continue; } // N'text'
    if (ch === "'" || ch === '"') {
      const start = line;
      let v = '';
      i++;
      while (i < src.length) {
        if (backslash && src[i] === '\\') { v += src[i + 1] ?? ''; i += 2; continue; }
        if (src[i] === ch) { if (src[i + 1] === ch) { v += ch; i += 2; continue; } break; }
        if (src[i] === '\n') line++;
        v += src[i++];
      }
      i++;
      toks.push({ t: 'str', v, line: start });
      continue;
    }
    if (wordCh.test(ch)) {
      let v = '';
      while (i < src.length && wordCh.test(src[i])) v += src[i++];
      toks.push({ t: 'w', v, u: v.toUpperCase(), line });
      continue;
    }
    toks.push({ t: 'p', v: ch, line });
    i++;
  }
  return toks;
}

class Cursor {
  constructor(toks) { this.t = toks; this.i = 0; }
  get done() { return this.i >= this.t.length; }
  peek() { return this.t[this.i]; }
  next() { return this.t[this.i++]; }
  isW(...w) { const x = this.peek(); return !!x && x.t === 'w' && (!w.length || w.includes(x.u)); }
  eatW(...w) { return this.isW(...w) ? this.next() : null; }
  isP(c) { const x = this.peek(); return !!x && x.t === 'p' && x.v === c; }
  ident() { const x = this.peek(); if (x && (x.t === 'w' || x.t === 'id')) { this.i++; return x; } return null; }
  qname() { // db.table → table
    let a = this.ident();
    while (a && this.isP('.')) { this.i++; a = this.ident() || a; }
    return a;
  }
  group() { // consumes "( … )" and returns the tokens inside
    if (!this.isP('(')) return null;
    this.i++;
    const out = [];
    let depth = 1;
    while (!this.done) {
      const x = this.next();
      if (x.t === 'p' && x.v === '(') depth++;
      if (x.t === 'p' && x.v === ')' && --depth === 0) return out;
      out.push(x);
    }
    return out;
  }
  identList() {
    const g = this.group();
    return g ? splitTop(g).map(p => p.find(x => x.t === 'w' || x.t === 'id')).filter(Boolean).map(x => x.v) : [];
  }
}

function splitTop(toks, sep = ',') {
  const parts = [[]];
  let depth = 0;
  for (const x of toks) {
    if (x.t === 'p' && x.v === '(') depth++;
    if (x.t === 'p' && x.v === ')') depth--;
    if (depth === 0 && x.t === 'p' && x.v === sep) { parts.push([]); continue; }
    parts[parts.length - 1].push(x);
  }
  return parts.filter(p => p.length);
}

const tokText = toks => toks.map(x => x.t === 'str' ? `'${x.v.replace(/'/g, "''")}'` : x.v).join('');

function parseSQL(src, dialect = 'mariadb') {
  const problems = [];
  const warn = (line, msg) => problems.push(problem(line, msg, 'warn'));
  const error = (line, msg) => problems.push(problem(line, msg));
  const accs = [];
  const findAcc = n => accs.find(a => a.name === n) || accs.find(a => a.name.toLowerCase() === n.toLowerCase());

  const statements = splitTop(tokenizeSQL(src, dialect), ';');
  for (const st of statements) {
    const p = new Cursor(st);
    const line = st[0].line;
    const kw = st[0].u;
    if (kw === 'CREATE') {
      p.next();
      p.eatW('OR'); p.eatW('REPLACE'); p.eatW('TEMPORARY');
      const kind = p.eatW('UNIQUE', 'FULLTEXT', 'SPATIAL')?.u;
      if (p.eatW('INDEX', 'KEY')) { createIndex(p, kind, line, findAcc, warn, error); continue; }
      if (!p.eatW('TABLE')) {
        if (!p.isW('DATABASE', 'SCHEMA')) warn(line, `CREATE ${p.peek()?.v ?? ''} is not shown in the diagram. Ignored.`);
        continue;
      }
      if (p.eatW('IF')) { p.eatW('NOT'); p.eatW('EXISTS'); }
      const name = p.qname();
      if (!name) { error(line, 'CREATE TABLE without a name'); continue; }
      const body = p.group();
      if (!body) { warn(line, `CREATE TABLE ${name.v} without a column list. Ignored.`); continue; }
      if (findAcc(name.v)) { error(name.line, `Table ${name.v} is created twice`); continue; }
      const acc = { name: name.v, line: name.line, cols: [], pk: null, fks: [], uniques: [], indexes: [] };
      accs.push(acc);
      for (const def of splitTop(body)) parseDef(new Cursor(def), acc, warn, error);
    } else if (kw === 'ALTER') {
      p.next();
      p.eatW('IGNORE');
      if (!p.eatW('TABLE')) { warn(line, 'ALTER statement ignored'); continue; }
      p.eatW('ONLY'); // pg_dump
      const name = p.qname();
      if (p.eatW('WITH')) p.eatW('CHECK', 'NOCHECK'); // SQL Server Management Studio
      const acc = name && findAcc(name.v);
      if (!acc) { error(line, `ALTER TABLE on unknown table ${name?.v ?? ''}`); continue; }
      for (const clause of splitTop(st.slice(p.i))) {
        const c = new Cursor(clause);
        if (c.isW('CHECK', 'NOCHECK', 'OWNER')) continue; // turns checking on or off, or names an owner
        if (!c.eatW('ADD')) { warn(clause[0].line, `ALTER TABLE … ${clause[0].v} is not supported. Ignored.`); continue; }
        c.eatW('COLUMN');
        parseDef(c, acc, warn, error);
      }
    } else if (['DROP', 'SET', 'USE', 'INSERT', 'SELECT', 'UPDATE', 'DELETE', 'START', 'COMMIT', 'BEGIN',
                'LOCK', 'UNLOCK', 'TRUNCATE', 'DELIMITER', 'SHOW', 'DESCRIBE', 'PRAGMA', 'END', 'ROLLBACK',
                'SAVEPOINT', 'RELEASE', 'VACUUM', 'ANALYZE', 'REINDEX', 'ATTACH', 'DETACH', 'IF', 'EXEC', 'PRINT',
                'COMMENT', 'GRANT', 'REVOKE'].includes(kw)) {
      // not part of the schema
    } else {
      warn(line, `Statement starting with "${st[0].v}" ignored`);
    }
  }
  return { tables: accs.map(a => finalizeTable(a, warn, error, dialect)), problems };
}

function parseDef(p, acc, warn, error) {
  const line = p.peek().line;
  if (p.eatW('CONSTRAINT') && !p.isW('PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK')) p.ident();
  if (p.eatW('DEFAULT')) { // SQL Server: [CONSTRAINT name] DEFAULT value FOR column
    const d = readDefault(p), col = p.eatW('FOR') && p.ident();
    const c = col && acc.cols.find(c => c.name.toLowerCase() === col.v.toLowerCase());
    if (c && d !== 'null') c.default = d;
    return;
  }
  if (p.eatW('PRIMARY')) {
    p.eatW('KEY');
    if (!p.isP('(')) p.ident();
    acc.pk = { cols: p.identList(), line };
  } else if (p.eatW('FOREIGN')) {
    p.eatW('KEY');
    if (!p.isP('(')) p.ident();
    const cols = p.identList();
    if (!p.eatW('REFERENCES')) { warn(line, 'FOREIGN KEY without REFERENCES. Ignored.'); return; }
    const rt = p.qname(), rcols = p.identList();
    acc.fks.push({ cols, rt: rt?.v, rcols, line, ...fkActions(p) });
  } else if (p.eatW('UNIQUE')) {
    p.eatW('KEY', 'INDEX');
    if (!p.isP('(')) p.ident();
    acc.uniques.push({ cols: p.identList(), line });
  } else if (p.eatW('FULLTEXT', 'SPATIAL')) {
    // search indexes are not part of the diagram
  } else if (p.eatW('KEY', 'INDEX')) {
    const name = p.isP('(') ? null : p.ident();
    if (p.eatW('USING')) p.next();
    acc.indexes.push({ name: name?.v ?? null, cols: p.identList(), line });
  } else if (p.isW('CHECK')) {
    warn(line, 'CHECK constraints are not shown. Ignored.');
  } else {
    parseColumn(p, acc, warn, error);
  }
}

// CREATE [UNIQUE] INDEX name ON table (cols). A UNIQUE one counts as a unique constraint.
function createIndex(p, kind, line, findAcc, warn, error) {
  if (p.eatW('IF')) { p.eatW('NOT'); p.eatW('EXISTS'); }
  const name = p.isW('ON') ? null : p.ident();
  if (!p.eatW('ON')) { error(line, 'CREATE INDEX without ON table'); return; }
  const t = p.qname(), acc = t && findAcc(t.v);
  if (!acc) { error(line, `CREATE INDEX on unknown table ${t?.v ?? ''}`); return; }
  if (p.eatW('USING')) p.next();
  const cols = p.identList();
  if (!cols.length) { error(line, 'CREATE INDEX without columns'); return; }
  if (kind === 'UNIQUE') acc.uniques.push({ cols, line });
  else if (!kind) acc.indexes.push({ name: name?.v ?? null, cols, line });
}

function skipAction(p) { // ON UPDATE CURRENT_TIMESTAMP and the like
  if (p.eatW('SET', 'NO')) p.next();
  else p.next();
}

// ON DELETE / ON UPDATE after REFERENCES: { onDelete: 'cascade', onUpdate: 'set null' }
function fkActions(p) {
  const a = {};
  while (p.isW('ON') && ['DELETE', 'UPDATE'].includes(p.t[p.i + 1]?.u)) {
    p.next();
    const key = p.next().u === 'DELETE' ? 'onDelete' : 'onUpdate';
    const w = p.next();
    a[key] = w?.u === 'SET' || w?.u === 'NO' ? `${w.v} ${p.next()?.v ?? ''}`.toLowerCase() : w?.v.toLowerCase();
  }
  return a;
}

// The value after DEFAULT, as Simple writes it: 0, 'text', null, true, now, or (an expression)
const NOW_WORDS = ['CURRENT_TIMESTAMP', 'NOW', 'LOCALTIMESTAMP', 'LOCALTIME', 'CURRENT_DATE', 'CURDATE', 'GETDATE',
  'SYSDATETIME', 'GETUTCDATE', 'SYSUTCDATETIME', 'SYSDATE', 'SYSTIMESTAMP'];
function readDefault(p) {
  if (p.isP('(')) { // SQL Server writes ((0)) and (getdate())
    const g = p.group(), inner = new Cursor(g), v = g.length ? readDefault(inner) : null;
    return inner.done && v != null ? v : '(' + tokText(g) + ')';
  }
  const neg = p.isP('-') ? p.next().v : '', x = p.next();
  if (!x) return null;
  if (x.t === 'str') return tokText([x]);
  if (['DATE', 'TIMESTAMP', 'TIME'].includes(x.u) && p.peek()?.t === 'str') return tokText([p.next()]); // DATE '2024-01-31'
  let v = neg + x.v;
  if (/^\d/.test(x.v) && p.isP('.')) { p.next(); v += '.' + (p.isW() ? p.next().v : ''); }
  const args = p.isP('(') ? p.group() : null; // NOW(), CURRENT_TIMESTAMP(3)
  if (/^-?\d/.test(v)) return v;
  if (NOW_WORDS.includes(x.u) || (['CAST', 'TRUNC'].includes(x.u) && NOW_WORDS.includes(args?.[0]?.u))) return 'now'; // CAST(GETDATE() AS DATE), TRUNC(SYSDATE)
  if (['NULL', 'TRUE', 'FALSE'].includes(x.u)) return x.u.toLowerCase();
  return '(' + v + (args ? '(' + tokText(args) + ')' : '') + ')';
}

const COLUMN_WORDS = ['NOT', 'NULL', 'PRIMARY', 'UNIQUE', 'DEFAULT', 'REFERENCES', 'CHECK', 'COLLATE', 'CONSTRAINT', 'GENERATED', 'AS', 'IDENTITY'];

// CHECK (Size IN ('S', 'M', 'L')): the values, as an enum's "'S','M','L'"; null for any other check
function enumCheck(toks, name) {
  if (!toks) return null;
  const p = new Cursor(toks), col = p.ident();
  if (!col || col.v.toLowerCase() !== name.toLowerCase() || !p.eatW('IN')) return null;
  const vals = p.group(), parts = vals && splitTop(vals);
  if (!p.done || !parts?.length || !parts.every(x => x.length === 1 && x[0].t === 'str')) return null;
  return parts.map(x => tokText(x)).join(',');
}

function parseColumn(p, acc, warn, error) {
  const nameTok = p.ident();
  const line = nameTok?.line ?? p.peek()?.line;
  // SQLite lets a column go without a type: "Name NOT NULL", "Name,"
  const typeTok = p.isW(...COLUMN_WORDS) ? null : p.ident();
  if (!nameTok || (!typeTok && !p.done && !p.isW(...COLUMN_WORDS))) { error(line, 'Could not read column definition'); return; }
  let type = typeTok?.v ?? null;
  while (typeTok && p.isW('VARYING', 'PRECISION')) type += ' ' + p.next().v; // CHARACTER VARYING(50), DOUBLE PRECISION
  if (typeTok && p.isP('(')) type += '(' + tokText(p.group()) + ')';
  while (typeTok && p.isW('UNSIGNED', 'SIGNED', 'ZEROFILL')) type += ' ' + p.next().v;
  const col = { name: nameTok.v, type, notNull: false, unique: false, pk: false, autoInc: false, line };
  while (!p.done) {
    if (p.eatW('NOT')) { if (p.eatW('NULL')) col.notNull = true; continue; }
    if (p.eatW('NULL')) continue;
    if (p.eatW('AUTO_INCREMENT', 'AUTOINCREMENT')) { col.autoInc = true; continue; } // MariaDB/MySQL, SQLite
    if (p.eatW('IDENTITY')) { col.autoInc = true; p.group(); continue; } // SQL Server's IDENTITY(1,1)
    if (p.eatW('GENERATED')) { // Postgres: GENERATED … AS IDENTITY, or a computed column GENERATED ALWAYS AS (…)
      while (!p.done && !p.isW('IDENTITY') && !p.isP('(')) p.next();
      if (p.eatW('IDENTITY')) col.autoInc = true;
      p.group();
      continue;
    }
    if (p.eatW('UNIQUE')) { p.eatW('KEY'); col.unique = true; continue; }
    if (p.eatW('PRIMARY')) { p.eatW('KEY'); col.pk = true; continue; }
    if (p.eatW('KEY')) { col.pk = true; continue; }
    if (p.eatW('DEFAULT')) { const d = readDefault(p); if (d !== 'null') col.default = d; continue; } // null goes without saying
    if (p.eatW('ON')) { p.eatW('UPDATE', 'DELETE'); skipAction(p); continue; }
    if (p.eatW('COMMENT', 'CHARSET', 'COLLATE')) { p.next(); continue; }
    if (p.eatW('CHARACTER')) { p.eatW('SET'); p.next(); continue; }
    if (p.eatW('REFERENCES')) {
      const rt = p.qname(), rcols = p.identList();
      acc.fks.push({ cols: [col.name], rt: rt?.v, rcols, line, ...fkActions(p) });
      continue;
    }
    if (p.eatW('CHECK')) {
      const values = enumCheck(p.group(), col.name);
      if (values && /^(text|n?varchar2?|n?char)\b/i.test(col.type ?? 'text')) col.type = `enum(${values})`; // how the others write an enum
      else warn(line, 'CHECK constraints are not shown. Ignored.');
      continue;
    }
    p.next(); // attribute we don't care about
  }
  if (acc.cols.some(c => c.name.toLowerCase() === col.name.toLowerCase())) {
    error(line, `Column ${col.name} is defined twice in ${acc.name}`);
    return;
  }
  acc.cols.push(col);
}

// Types as the other databases write them, in the names Simple uses
const READ_TYPES = {
  postgres: [[/^bytea$/, 'blob'], [/^jsonb$/, 'json'], [/^(timestamptz|timestamp with(out)? time zone)$/, 'timestamp'],
    [/^timetz$/, 'time'], [/^int2$/, 'smallint'], [/^int4$/, 'int'], [/^(int8|bigserial)$/, 'bigint'], [/^serial$/, 'int'],
    [/^smallserial$/, 'smallint'], [/^(float4|real)$/, 'float'], [/^float8$/, 'double'], [/^character varying\b/, 'varchar'],
    [/^character\b/, 'char'], [/^inet$/, 'inet6'], [/^money$/, 'decimal(19,2)'], [/^numeric(?=$|\()/, 'decimal']],
  mssql: [[/^n?varchar\(max\)$/, 'text'], [/^nvarchar\b/, 'varchar'], [/^nchar\b/, 'char'], [/^n?text$/, 'text'],
    [/^(varbinary\(max\)|image)$/, 'blob'], [/^(datetime2|datetimeoffset|smalldatetime)(\(\d+\))?$/, 'datetime'],
    [/^bit$/, 'bool'], [/^uniqueidentifier$/, 'uuid'], [/^money$/, 'decimal(19,4)'], [/^smallmoney$/, 'decimal(10,4)'],
    [/^float(\(\d+\))?$/, 'double'], [/^real$/, 'float'], [/^xml$/, 'text'], [/^sysname$/, 'vc']],
  oracle: [[/^n?varchar2?\((\d+)\s*(char|byte)?\)$/, 'varchar($1)'], [/^n?char\((\d+)\s*(char|byte)?\)$/, 'char($1)'],
    // NUMBER(p): the integer that holds p digits; NUMBER(p,s) a decimal; NUMBER alone, mostly a whole number
    [/^number\((\d+)\)$/, (m, p) => [[3, 'tinyint'], [4, 'year'], [5, 'smallint'], [7, 'mediumint'], [10, 'int'], [19, 'bigint']].find(([n]) => +p <= n)?.[1] ?? `decimal(${p})`],
    [/^number\((\d+),(\d+)\)$/, 'decimal($1,$2)'], [/^(number|integer|int)$/, 'int'], [/^binary_float$/, 'float'],
    [/^binary_double$/, 'double'], [/^(n?clob|long)$/, 'text'], [/^(long raw|bfile)$/, 'blob'], [/^raw\((\d+)\)$/, 'varbinary($1)'],
    [/^timestamp\(\d+\)$/, 'timestamp'], [/^timestamp( with( local)? time zone)?$/, 'timestamp']],
};
function readType(t, dialect) {
  if (!t) return t;
  const s = t.toLowerCase().replace(/\s+/g, ' ');
  const hit = (READ_TYPES[dialect] ?? []).find(([re]) => re.test(s));
  return hit ? s.replace(hit[0], hit[1]) : t;
}

function finalizeTable(acc, warn, error, dialect) {
  const lc = n => n.toLowerCase();
  const pkNames = acc.pk ? acc.pk.cols : acc.cols.filter(c => c.pk).map(c => c.name);
  const pkSet = new Set(pkNames.map(lc));
  for (const n of pkNames) if (!acc.cols.some(c => lc(c.name) === lc(n))) error(acc.pk?.line ?? acc.line, `PRIMARY KEY column ${n} does not exist in ${acc.name}`);
  const id = acc.cols.find(c => isIdName(c.name));
  const idIsPk = id && pkSet.size === 1 && pkSet.has(lc(id.name));
  if (!pkSet.size && id) warn(acc.line, `${acc.name} has an Id column but no PRIMARY KEY. The diagram treats Id as the primary key.`);

  const cols = acc.cols.map(c => ({
    name: c.name,
    type: normType(readType(c.type, dialect)),
    pk: !idIsPk && pkSet.has(lc(c.name)),
    nullable: !c.notNull && !pkSet.has(lc(c.name)) && !(c === id && !pkSet.size),
    unique: c.unique,
    // SQLite: a lone INTEGER PRIMARY KEY written on the column is the rowid, numbered by the database
    auto: c.autoInc || (dialect === 'sqlite' && c.pk && pkSet.size === 1 && /^integer$/i.test(c.type ?? '')),
    ref: null,
    refCol: null,
    onDelete: null,
    onUpdate: null,
    default: c.default ?? null,
    line: c.line,
  }));
  const find = n => cols.find(c => lc(c.name) === lc(n));

  for (const fk of acc.fks) {
    if (fk.cols.length !== 1) { error(fk.line, `Composite foreign key (${fk.cols.join(', ')}) can't be drawn as one arrow`); continue; }
    const col = find(fk.cols[0]);
    if (!col) { error(fk.line, `Foreign key column ${fk.cols[0]} does not exist in ${acc.name}`); continue; }
    col.ref = fk.rt;
    col.refCol = fk.rcols[0] ?? null; // genText writes just "-> Table" when this is the table's primary key
    col.onDelete = fk.onDelete ?? null;
    col.onUpdate = fk.onUpdate ?? null;
  }
  return { name: acc.name, line: acc.line, cols, indexes: acc.indexes, uniques: acc.uniques }; // resolve() checks the uniques
}
