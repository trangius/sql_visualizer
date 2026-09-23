'use strict';

// ─── Model → SQL (MariaDB) ───────────────────────────────────────────────────

const RESERVED = new Set(`ADD ALL ALTER ANALYZE AND AS ASC BETWEEN BY CASE CHANGE CHECK COLUMN CONDITION CONSTRAINT
CREATE CROSS DATABASE DEFAULT DELETE DESC DISTINCT DROP ELSE EXISTS FALSE FOR FOREIGN FROM FULLTEXT GRANT GROUP
HAVING IF IGNORE IN INDEX INNER INSERT INTERVAL INTO IS JOIN KEY KEYS KILL LEFT LIKE LIMIT LOCK MATCH NATURAL NOT
NULL ON OPTION OR ORDER OUTER PRIMARY PROCEDURE RANGE READ REFERENCES REGEXP RENAME REPEAT REPLACE REQUIRE RESTRICT
RETURN REVOKE RIGHT ROW ROWS SCHEMA SELECT SET SHOW TABLE THEN TO TRIGGER TRUE UNION UNIQUE UNLOCK UPDATE USAGE USE
USING VALUES WHEN WHERE WHILE WITH WRITE`.split(/\s+/));
const q = n => RESERVED.has(n.toUpperCase()) ? '`' + n + '`' : n;

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

function genSQL(tables) {
  const { order, cyclic } = topoOrder(tables.filter(t => t.cols.length));
  const out = ['-- MariaDB / MySQL', "SET sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION';", ''];
  if (!order.length) return out.join('\n');
  if (cyclic) out.push('SET FOREIGN_KEY_CHECKS = 0;');
  for (const t of [...order].reverse()) out.push(`DROP TABLE IF EXISTS ${q(t.name)};`);
  out.push('');
  const created = new Set(), deferred = [];
  for (const t of order) {
    created.add(t);
    const w = Math.max(...t.cols.map(c => q(c.name).length));
    const defs = t.cols.map(c =>
      `  ${q(c.name).padEnd(w)} ${sqlType(c.effType)}${c.nullable ? ' NULL' : ' NOT NULL'}` +
      `${c.autoInc ? ' AUTO_INCREMENT' : ''}${c.unique ? ' UNIQUE' : ''}`);
    if (t.pkCols.length) defs.push(`  PRIMARY KEY (${t.pkCols.map(c => q(c.name)).join(', ')})`);
    for (const c of t.cols) {
      if (!c.target) continue;
      const fk = `FOREIGN KEY (${q(c.name)}) REFERENCES ${q(c.target.name)}(${q(c.target.idCol.name)})`;
      if (created.has(c.target)) defs.push('  ' + fk);
      else deferred.push(`ALTER TABLE ${q(t.name)} ADD ${fk};`);
    }
    out.push(`CREATE TABLE ${q(t.name)} (\n${defs.join(',\n')}\n);`, '');
  }
  if (deferred.length) out.push(...deferred, '');
  if (cyclic) out.push('SET FOREIGN_KEY_CHECKS = 1;', '');
  return out.join('\n');
}

// ─── SQL → model ─────────────────────────────────────────────────────────────

function tokenizeSQL(src) {
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
    if (ch === '`') {
      const start = line;
      let v = '';
      i++;
      while (i < src.length && src[i] !== '`') { if (src[i] === '\n') line++; v += src[i++]; }
      i++;
      toks.push({ t: 'id', v, line: start });
      continue;
    }
    if (ch === "'" || ch === '"') {
      const start = line;
      let v = '';
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { v += src[i + 1] ?? ''; i += 2; continue; }
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

function parseSQL(src) {
  const problems = [];
  const warn = (line, msg) => problems.push(problem(line, msg, 'warn'));
  const error = (line, msg) => problems.push(problem(line, msg));
  const accs = [];
  const findAcc = n => accs.find(a => a.name === n) || accs.find(a => a.name.toLowerCase() === n.toLowerCase());

  const statements = splitTop(tokenizeSQL(src), ';');
  for (const st of statements) {
    const p = new Cursor(st);
    const line = st[0].line;
    const kw = st[0].u;
    if (kw === 'CREATE') {
      p.next();
      p.eatW('OR'); p.eatW('REPLACE'); p.eatW('TEMPORARY');
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
      const acc = { name: name.v, line: name.line, cols: [], pk: null, fks: [], uniques: [] };
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
                'LOCK', 'UNLOCK', 'TRUNCATE', 'DELIMITER', 'SHOW', 'DESCRIBE'].includes(kw)) {
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
    const rt = p.qname();
    acc.fks.push({ cols, rt: rt?.v, rcols: p.identList(), line });
  } else if (p.eatW('UNIQUE')) {
    p.eatW('KEY', 'INDEX');
    if (!p.isP('(')) p.ident();
    acc.uniques.push({ cols: p.identList(), line });
  } else if (p.isW('KEY', 'INDEX', 'FULLTEXT', 'SPATIAL')) {
    // plain indexes are not part of the diagram
  } else if (p.isW('CHECK')) {
    warn(line, 'CHECK constraints are not shown. Ignored.');
  } else {
    parseColumn(p, acc, warn, error);
  }
}

function skipAction(p) { // ON DELETE / ON UPDATE <action>
  if (p.eatW('SET', 'NO')) p.next();
  else p.next();
}

function parseColumn(p, acc, warn, error) {
  const nameTok = p.ident();
  const line = nameTok?.line ?? p.peek()?.line;
  const typeTok = p.ident();
  if (!nameTok || !typeTok) { error(line, 'Could not read column definition'); return; }
  let type = typeTok.v;
  if (p.isP('(')) type += '(' + tokText(p.group()) + ')';
  while (p.isW('UNSIGNED', 'SIGNED', 'ZEROFILL')) type += ' ' + p.next().v;
  const col = { name: nameTok.v, type, notNull: false, unique: false, pk: false, line };
  while (!p.done) {
    if (p.eatW('NOT')) { if (p.eatW('NULL')) col.notNull = true; continue; }
    if (p.eatW('NULL', 'AUTO_INCREMENT')) continue;
    if (p.eatW('UNIQUE')) { p.eatW('KEY'); col.unique = true; continue; }
    if (p.eatW('PRIMARY')) { p.eatW('KEY'); col.pk = true; continue; }
    if (p.eatW('KEY')) { col.pk = true; continue; }
    if (p.eatW('DEFAULT')) {
      if (!p.group()) { if (p.isP('-')) p.next(); p.next(); p.group(); }
      continue;
    }
    if (p.eatW('ON')) { p.eatW('UPDATE', 'DELETE'); skipAction(p); continue; }
    if (p.eatW('COMMENT', 'CHARSET', 'COLLATE')) { p.next(); continue; }
    if (p.eatW('CHARACTER')) { p.eatW('SET'); p.next(); continue; }
    if (p.eatW('REFERENCES')) {
      const rt = p.qname();
      acc.fks.push({ cols: [col.name], rt: rt?.v, rcols: p.identList(), line });
      continue;
    }
    if (p.eatW('CHECK')) { p.group(); warn(line, 'CHECK constraints are not shown. Ignored.'); continue; }
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
    line: c.line,
  }));
  const find = n => cols.find(c => lc(c.name) === lc(n));

  for (const u of acc.uniques) {
    if (u.cols.length === 1 && find(u.cols[0])) find(u.cols[0]).unique = true;
    else warn(u.line, `UNIQUE (${u.cols.join(', ')}) over several columns can't be shown. Ignored.`);
  }
  for (const fk of acc.fks) {
    if (fk.cols.length !== 1) { error(fk.line, `Composite foreign key (${fk.cols.join(', ')}) can't be drawn as one arrow`); continue; }
    const col = find(fk.cols[0]);
    if (!col) { error(fk.line, `Foreign key column ${fk.cols[0]} does not exist in ${acc.name}`); continue; }
    if (fk.rcols.length && !isIdName(fk.rcols[0])) {
      error(fk.line, `${acc.name}.${col.name} references ${fk.rt}(${fk.rcols[0]}). Arrows can only point to Id.`);
      continue;
    }
    col.ref = fk.rt;
  }
  return { name: acc.name, line: acc.line, cols };
}
