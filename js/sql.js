'use strict';

// One conversion shared by editor regeneration, share links and document transforms.
function sqlToText(sql, includeProblems = true, dialect = 'mariadb') {
  const r = parseSQL(sql, dialect);
  resolve(r.tables);
  return genText(r.tables, includeProblems ? r.problems : []);
}

// ─── Model → SQL ─────────────────────────────────────────────────────────────

// Reserved words in MariaDB (and MySQL 8): names like these must be quoted
const RESERVED = new Set(`ACCESSIBLE ADD ALL ALTER ANALYZE AND AS ASC ASENSITIVE BEFORE BETWEEN BIGINT BINARY
BLOB BOTH BY CALL CASCADE CASE CHANGE CHAR CHARACTER CHECK COLLATE COLUMN CONDITION CONSTRAINT CONTINUE CONVERT CREATE CROSS CUBE CUME_DIST
CURRENT_DATE CURRENT_ROLE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DATABASES DAY_HOUR
DAY_MICROSECOND DAY_MINUTE DAY_SECOND DEC DECIMAL DECLARE DEFAULT DELAYED DELETE DELETE_DOMAIN_ID DENSE_RANK DESC
DESCRIBE DETERMINISTIC DISTINCT DISTINCTROW DIV DOUBLE DO_DOMAIN_IDS DROP DUAL EACH ELSE ELSEIF EMPTY ENCLOSED ESCAPED
EXCEPT EXISTS EXIT EXPLAIN FALSE FETCH FIRST_VALUE FLOAT FLOAT4 FLOAT8 FOR FORCE FOREIGN FROM FULLTEXT FUNCTION
GENERAL GENERATED GRANT GROUP GROUPING GROUPS HAVING HIGH_PRIORITY HOUR_MICROSECOND HOUR_MINUTE HOUR_SECOND IF IGNORE
IGNORE_DOMAIN_IDS IGNORE_SERVER_IDS IN INDEX INFILE INNER INOUT INSENSITIVE INSERT INT INT1 INT2 INT3 INT4 INT8
INTEGER INTERSECT INTERVAL INTO IS ITERATE JOIN JSON_TABLE KEY KEYS KILL LAG LAST_VALUE LATERAL LEAD LEADING LEAVE
LEFT LIKE LIMIT LINEAR LINES LOAD LOCALTIME LOCALTIMESTAMP LOCK LONG LONGBLOB LONGTEXT LOOP LOW_PRIORITY
MASTER_HEARTBEAT_PERIOD MASTER_SSL_VERIFY_SERVER_CERT MATCH MAXVALUE MEDIUMBLOB MEDIUMINT MEDIUMTEXT MIDDLEINT
MINUTE_MICROSECOND MINUTE_SECOND MOD MODIFIES NATURAL NOT NO_WRITE_TO_BINLOG NTH_VALUE NTILE NULL NUMERIC OF OFFSET ON
OPTIMIZE OPTION OPTIONALLY OR ORDER OUT OUTER OUTFILE OVER PAGE_CHECKSUM PARSE_VCOL_EXPR PARTITION PERCENT_RANK
POSITION PRECISION PRIMARY PROCEDURE PURGE RANGE RANK READ READS READ_WRITE REAL RECURSIVE REFERENCES REF_SYSTEM_ID
REGEXP RELEASE RENAME REPEAT REPLACE REQUIRE RESIGNAL RESTRICT RETURN RETURNING REVOKE RIGHT RLIKE ROW ROWS ROW_NUMBER
SCHEMA SCHEMAS SECOND_MICROSECOND SELECT SENSITIVE SEPARATOR SET SHOW SIGNAL SLOW SMALLINT SPATIAL SPECIFIC SQL
SQLEXCEPTION SQLSTATE SQLWARNING SQL_BIG_RESULT SQL_CALC_FOUND_ROWS SQL_SMALL_RESULT SSL STARTING STATS_AUTO_RECALC
STATS_PERSISTENT STATS_SAMPLE_PAGES STORED STRAIGHT_JOIN SYSTEM TABLE TERMINATED THEN TINYBLOB TINYINT TINYTEXT TO
TRAILING TRIGGER TRUE UNDO UNION UNIQUE UNLOCK UNSIGNED UPDATE USAGE USE USING UTC_DATE UTC_TIME UTC_TIMESTAMP VALUES
VARBINARY VARCHAR VARCHARACTER VARYING VIRTUAL WHEN WHERE WHILE WINDOW WITH WRITE XOR YEAR_MONTH ZEROFILL`.split(/\s+/));
const q = n => RESERVED.has(n.toUpperCase()) ? '`' + n + '`' : n;

// SQLite's keywords: quoted wherever they are used as a name
const SQLITE_KEYWORDS = new Set(`ABORT ACTION ADD AFTER ALL ALTER ALWAYS ANALYZE AND AS ASC ATTACH AUTOINCREMENT BEFORE
BEGIN BETWEEN BY CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE
CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DEFERRABLE DEFERRED DELETE DESC DETACH DISTINCT DO DROP EACH ELSE END
ESCAPE EXCEPT EXCLUDE EXCLUSIVE EXISTS EXPLAIN FAIL FILTER FIRST FOLLOWING FOR FOREIGN FROM FULL GENERATED GLOB GROUP
GROUPS HAVING IF IGNORE IMMEDIATE IN INDEX INDEXED INITIALLY INNER INSERT INSTEAD INTERSECT INTO IS ISNULL JOIN KEY LAST
LEFT LIKE LIMIT MATCH MATERIALIZED NATURAL NO NOT NOTHING NOTNULL NULL NULLS OF OFFSET ON OR ORDER OTHERS OUTER OVER
PARTITION PLAN PRAGMA PRECEDING PRIMARY QUERY RAISE RANGE RECURSIVE REFERENCES REGEXP REINDEX RELEASE RENAME REPLACE
RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS SAVEPOINT SELECT SET TABLE TEMP TEMPORARY THEN TIES TO TRANSACTION TRIGGER
UNBOUNDED UNION UNIQUE UPDATE USING VACUUM VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH WITHOUT`.split(/\s+/));

// What differs between the databases the SQL is written for. state.dialect is one of these keys.
const DIALECTS = {
  mariadb: {
    name: 'MariaDB',
    q,
    fkOff: 'SET FOREIGN_KEY_CHECKS = 0;',
    fkOn: 'SET FOREIGN_KEY_CHECKS = 1;',
    dqIdent: false,      // "x" is a string
    backslash: true,     // \ escapes in strings
  },
  sqlite: {
    name: 'SQLite',
    q: n => SQLITE_KEYWORDS.has(n.toUpperCase()) ? '"' + n + '"' : n,
    fkOff: 'PRAGMA foreign_keys = OFF;',
    fkOn: 'PRAGMA foreign_keys = ON;', // SQLite only checks foreign keys when this is on
    dqIdent: true,       // "x" (and [x]) is a name
    backslash: false,
  },
};
const dialectOf = d => DIALECTS[d] ?? DIALECTS.mariadb;

function topoOrder(tables) {
  const deps = new Map(tables.map(t => [t, t.cols.filter(c => c.target && c.target !== t).map(c => c.target)]));
  const out = [], done = new Set();
  let progress = true;
  while (out.length < tables.length && progress) {
    progress = false;
    for (const t of tables) {
      if (!done.has(t) && deps.get(t).every(d => done.has(d))) { out.push(t); done.add(t); progress = true; }
    }
  }
  const cyclic = out.length < tables.length;
  for (const t of tables) if (!done.has(t)) out.push(t);
  return { order: out, cyclic };
}

// MariaDB names are at most 64 characters: a longer one is cut, with a hash of the whole to keep it unique
function name64(n) {
  if (n.length <= 64) return n;
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return n.slice(0, 57) + '_' + h.toString(36).padStart(6, '0').slice(-6);
}

// MariaDB needs an index on the column a foreign key points to. True when a key or index already starts with it.
function hasIndex(t, c) {
  return c.unique || t.pkCols[0] === c || t.multiUniques.some(u => u.cols[0] === c) ||
    (t.indexes ?? []).some(ix => ix.cols[0]?.toLowerCase() === c.name.toLowerCase());
}

// [default now] is today's date in a date column, otherwise the current time
function sqlDefault(c) {
  const d = c.default;
  if (d === 'now') return /^date\b/.test(c.effType) ? 'CURRENT_DATE' : 'CURRENT_TIMESTAMP';
  return /^(null|true|false)$/.test(d) ? d.toUpperCase() : d;
}

function genSQL(tables, dialect = 'mariadb') {
  return dialect === 'sqlite' ? genSQLite(tables) : genMariaDB(tables);
}

const fkActionsSQL = c => `${c.onDelete ? ' ON DELETE ' + c.onDelete.toUpperCase() : ''}${c.onUpdate ? ' ON UPDATE ' + c.onUpdate.toUpperCase() : ''}`;
const dropTables = (order, q) => [...order].reverse().map(t => `DROP TABLE IF EXISTS ${q(t.name)};`);

function genMariaDB(tables) {
  const { order, cyclic } = topoOrder(tables.filter(t => t.cols.length));
  const out = ['-- MariaDB / MySQL', ''];
  if (!order.length) return out.join('\n');
  if (cyclic) out.push('SET FOREIGN_KEY_CHECKS = 0;');
  out.push(...dropTables(order, q), '');
  const created = new Set(), deferred = [], targetIndexes = new Map();
  for (const t of order) {
    created.add(t);
    const w = Math.max(...t.cols.map(c => q(c.name).length));
    const defs = t.cols.map(c =>
      `  ${q(c.name).padEnd(w)} ${sqlType(c.effType)}${c.nullable ? ' NULL' : ' NOT NULL'}` +
      `${c.default != null ? ' DEFAULT ' + sqlDefault(c) : ''}` +
      `${c.autoInc ? ' AUTO_INCREMENT' : ''}${c.unique ? ' UNIQUE' : ''}`);
    if (t.pkCols.length) defs.push(`  PRIMARY KEY (${t.pkCols.map(c => q(c.name)).join(', ')})`);
    for (const u of t.multiUniques ?? []) defs.push(`  UNIQUE (${u.cols.map(c => q(c.name)).join(', ')})`);
    const pointedTo = new Set(tables.flatMap(o => o.cols.filter(c => c.target === t).map(c => c.targetCol)));
    for (const c of t.cols) {
      if (!pointedTo.has(c) || hasIndex(t, c)) continue;
      const name = name64(indexName(t.name, [c.name]));
      targetIndexes.set(t, [...targetIndexes.get(t) ?? [], name.toLowerCase()]);
      defs.push(`  INDEX ${q(name)} (${q(c.name)})`);
    }
    for (const c of t.cols) {
      if (!c.target) continue;
      const fk = `FOREIGN KEY (${q(c.name)}) REFERENCES ${q(c.target.name)}(${q(c.targetCol.name)})` + fkActionsSQL(c);
      if (created.has(c.target)) defs.push('  ' + fk);
      else deferred.push(`ALTER TABLE ${q(t.name)} ADD ${fk};`);
    }
    out.push(`CREATE TABLE ${q(t.name)} (\n${defs.join(',\n')}\n);`, '');
  }
  if (deferred.length) out.push(...deferred, '');
  const indexes = order.flatMap(t => {
    // names MariaDB gives the indexes it makes itself: a UNIQUE or FOREIGN KEY one is named after its first column
    const taken = new Set(['primary', ...t.cols.filter(c => c.unique || c.target).map(c => c.name.toLowerCase()),
      ...(t.multiUniques ?? []).map(u => u.cols[0].name.toLowerCase()), ...targetIndexes.get(t) ?? []]);
    return createIndexes(t, taken, q);
  });
  if (indexes.length) out.push(...indexes, '');
  if (cyclic) out.push('SET FOREIGN_KEY_CHECKS = 1;', '');
  return out.join('\n');
}

// CREATE INDEX for each of the table's indexes, with names not in `taken` (which it adds to)
function createIndexes(t, taken, q) {
  return (t.indexes ?? []).filter(ix => ix.cols.every(n => t.cols.some(c => c.name === n))).map(ix => {
    const base = name64(ix.name ?? indexName(t.name, ix.cols));
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = base.slice(0, 63 - String(i).length) + '_' + i;
    taken.add(name.toLowerCase());
    return `CREATE INDEX ${q(name)} ON ${q(t.name)} (${ix.cols.map(q).join(', ')});`;
  });
}

// SQLite takes the same type names (VARCHAR(50), DATE, DECIMAL(8,2)…) and only uses them as a hint,
// except: an Id that numbers itself is INTEGER PRIMARY KEY, and an enum is TEXT with a CHECK.
// Tables may point to tables made later, so they are made in key order only to read well.
function genSQLite(tables) {
  const { q: Q, fkOff, fkOn } = DIALECTS.sqlite;
  const { order, cyclic } = topoOrder(tables.filter(t => t.cols.length));
  const out = ['-- SQLite', cyclic ? fkOff : fkOn, ''];
  if (!order.length) return out.join('\n');
  out.push(...dropTables(order, Q), '');
  for (const t of order) {
    const w = Math.max(...t.cols.map(c => Q(c.name).length));
    const rowid = t.cols.find(c => c.autoInc);
    const defs = t.cols.map(c => {
      if (c === rowid) return `  ${Q(c.name).padEnd(w)} INTEGER PRIMARY KEY`;
      const en = c.effType.match(/^(enum|set)\((.*)\)$/);
      return `  ${Q(c.name).padEnd(w)} ${en ? 'TEXT' : sqlType(c.effType)}${c.nullable ? ' NULL' : ' NOT NULL'}` +
        `${c.default != null ? ' DEFAULT ' + sqlDefault(c) : ''}${c.unique ? ' UNIQUE' : ''}` +
        `${en?.[1] === 'enum' ? ` CHECK (${Q(c.name)} IN (${en[2]}))` : ''}`;
    });
    if (t.pkCols.length && !rowid) defs.push(`  PRIMARY KEY (${t.pkCols.map(c => Q(c.name)).join(', ')})`);
    for (const u of t.multiUniques ?? []) defs.push(`  UNIQUE (${u.cols.map(c => Q(c.name)).join(', ')})`);
    for (const c of t.cols) {
      if (c.target) defs.push(`  FOREIGN KEY (${Q(c.name)}) REFERENCES ${Q(c.target.name)}(${Q(c.targetCol.name)})` + fkActionsSQL(c));
    }
    out.push(`CREATE TABLE ${Q(t.name)} (\n${defs.join(',\n')}\n);`, '');
  }
  const taken = new Set(); // an index name is for the whole database, not per table
  const indexes = order.flatMap(t => createIndexes(t, taken, Q));
  if (indexes.length) out.push(...indexes, '');
  if (cyclic) out.push(fkOn, '');
  return out.join('\n');
}

// Problems that depend on the database: what it refuses about a foreign key
function dialectProblems(tables, dialect = 'mariadb') {
  const problems = [];
  for (const t of tables) {
    for (const c of t.cols) {
      if (!c.target || c.implicit) continue;
      const tt = c.target, tc = c.targetCol, where = `${tt.name}.${tc.name}`;
      if (!(tt.pkCols.length === 1 && tt.pkCols[0] === tc) && !tc.unique) {
        problems.push(dialect === 'sqlite'
          ? problem(c.line, `SQLite needs ${where} to be the primary key or unique`)
          : problem(c.line, `${where} is neither the primary key nor unique. The SQL adds an index on it, but normally it should be unique.`, 'warn'));
      }
      if (dialect === 'sqlite') continue; // SQLite doesn't compare the types
      const a = keyType(c.effType), b = keyType(tc.effType);
      if (a === null || b === null) {
        problems.push(problem(c.line, `${b === null ? where : c.name} is ${b === null ? tc.effType : c.effType}, ` +
          'which can\'t be part of a foreign key. Use vc instead.'));
      } else if (a !== b) {
        problems.push(problem(c.line, `${c.name} is ${c.effType} but ${where} is ${tc.effType}. ` +
          'A foreign key needs the same type on both sides.'));
      }
    }
  }
  return problems;
}

// ─── SQL → model ─────────────────────────────────────────────────────────────

function tokenizeSQL(src, dialect = 'mariadb') {
  const { dqIdent, backslash } = dialectOf(dialect);
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
      const name = p.qname();
      const acc = name && findAcc(name.v);
      if (!acc) { error(line, `ALTER TABLE on unknown table ${name?.v ?? ''}`); continue; }
      for (const clause of splitTop(st.slice(p.i))) {
        const c = new Cursor(clause);
        if (!c.eatW('ADD')) { warn(clause[0].line, `ALTER TABLE … ${clause[0].v} is not supported. Ignored.`); continue; }
        c.eatW('COLUMN');
        parseDef(c, acc, warn, error);
      }
    } else if (['DROP', 'SET', 'USE', 'INSERT', 'SELECT', 'UPDATE', 'DELETE', 'START', 'COMMIT', 'BEGIN',
                'LOCK', 'UNLOCK', 'TRUNCATE', 'DELIMITER', 'SHOW', 'DESCRIBE', 'PRAGMA', 'END', 'ROLLBACK',
                'SAVEPOINT', 'RELEASE', 'VACUUM', 'ANALYZE', 'REINDEX', 'ATTACH', 'DETACH'].includes(kw)) {
      // not part of the schema
    } else {
      warn(line, `Statement starting with "${st[0].v}" ignored`);
    }
  }
  return { tables: accs.map(a => finalizeTable(a, warn, error)), problems };
}

function parseDef(p, acc, warn, error) {
  const line = p.peek().line;
  if (p.eatW('CONSTRAINT') && !p.isW('PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK')) p.ident();
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
function readDefault(p) {
  if (p.isP('(')) return '(' + tokText(p.group()) + ')';
  const neg = p.isP('-') ? p.next().v : '', x = p.next();
  if (!x) return null;
  if (x.t === 'str') return tokText([x]);
  let v = neg + x.v;
  if (/^\d/.test(x.v) && p.isP('.')) { p.next(); v += '.' + (p.isW() ? p.next().v : ''); }
  const args = p.isP('(') ? p.group() : null; // NOW(), CURRENT_TIMESTAMP(3)
  if (/^-?\d/.test(v)) return v;
  if (['CURRENT_TIMESTAMP', 'NOW', 'LOCALTIMESTAMP', 'LOCALTIME', 'CURRENT_DATE', 'CURDATE'].includes(x.u)) return 'now';
  if (['NULL', 'TRUE', 'FALSE'].includes(x.u)) return x.u.toLowerCase();
  return '(' + v + (args ? '(' + tokText(args) + ')' : '') + ')';
}

const COLUMN_WORDS = ['NOT', 'NULL', 'PRIMARY', 'UNIQUE', 'DEFAULT', 'REFERENCES', 'CHECK', 'COLLATE', 'CONSTRAINT', 'GENERATED', 'AS'];

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
  if (typeTok && p.isP('(')) type += '(' + tokText(p.group()) + ')';
  while (typeTok && p.isW('UNSIGNED', 'SIGNED', 'ZEROFILL')) type += ' ' + p.next().v;
  const col = { name: nameTok.v, type, notNull: false, unique: false, pk: false, line };
  while (!p.done) {
    if (p.eatW('NOT')) { if (p.eatW('NULL')) col.notNull = true; continue; }
    if (p.eatW('NULL', 'AUTO_INCREMENT')) continue;
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
      if (values && /^(text|varchar|char)\b/i.test(col.type ?? 'text')) col.type = `enum(${values})`; // SQLite's enum
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

function finalizeTable(acc, warn, error) {
  const lc = n => n.toLowerCase();
  const pkNames = acc.pk ? acc.pk.cols : acc.cols.filter(c => c.pk).map(c => c.name);
  const pkSet = new Set(pkNames.map(lc));
  for (const n of pkNames) if (!acc.cols.some(c => lc(c.name) === lc(n))) error(acc.pk?.line ?? acc.line, `PRIMARY KEY column ${n} does not exist in ${acc.name}`);
  const id = acc.cols.find(c => isIdName(c.name));
  const idIsPk = id && pkSet.size === 1 && pkSet.has(lc(id.name));
  if (!pkSet.size && id) warn(acc.line, `${acc.name} has an Id column but no PRIMARY KEY. The diagram treats Id as the primary key.`);

  const cols = acc.cols.map(c => ({
    name: c.name,
    type: normType(c.type),
    pk: !idIsPk && pkSet.has(lc(c.name)),
    nullable: !c.notNull && !pkSet.has(lc(c.name)) && !(c === id && !pkSet.size),
    unique: c.unique,
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
