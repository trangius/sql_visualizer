'use strict';

// ─── Model → SQL, for each database ──────────────────────────────────────────
// DIALECTS holds what differs between the databases: how a name is quoted, how the
// script is written (gen), what the database refuses (problems) and how sample rows go
// in (sampleInserts). state.dialect is one of its keys. Reading SQL is in sql.js.

// Reserved words in MariaDB (and MySQL 8): names like these must be quoted
const MARIADB_RESERVED = new Set(`ACCESSIBLE ADD ALL ALTER ANALYZE AND AS ASC ASENSITIVE BEFORE BETWEEN BIGINT BINARY
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

// MySQL 8.4 reserves a few more
const MYSQL_RESERVED = new Set([...MARIADB_RESERVED, 'MANUAL', 'PARALLEL', 'QUALIFY', 'TABLESAMPLE']);

const SQLITE_KEYWORDS = new Set(`ABORT ACTION ADD AFTER ALL ALTER ALWAYS ANALYZE AND AS ASC ATTACH AUTOINCREMENT BEFORE
BEGIN BETWEEN BY CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE
CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DEFERRABLE DEFERRED DELETE DESC DETACH DISTINCT DO DROP EACH ELSE END
ESCAPE EXCEPT EXCLUDE EXCLUSIVE EXISTS EXPLAIN FAIL FILTER FIRST FOLLOWING FOR FOREIGN FROM FULL GENERATED GLOB GROUP
GROUPS HAVING IF IGNORE IMMEDIATE IN INDEX INDEXED INITIALLY INNER INSERT INSTEAD INTERSECT INTO IS ISNULL JOIN KEY LAST
LEFT LIKE LIMIT MATCH MATERIALIZED NATURAL NO NOT NOTHING NOTNULL NULL NULLS OF OFFSET ON OR ORDER OTHERS OUTER OVER
PARTITION PLAN PRAGMA PRECEDING PRIMARY QUERY RAISE RANGE RECURSIVE REFERENCES REGEXP REINDEX RELEASE RENAME REPLACE
RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS SAVEPOINT SELECT SET TABLE TEMP TEMPORARY THEN TIES TO TRANSACTION TRIGGER
UNBOUNDED UNION UNIQUE UPDATE USING VACUUM VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH WITHOUT`.split(/\s+/));

const POSTGRES_RESERVED = new Set(`ALL ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC AUTHORIZATION BINARY BOTH CASE CAST
CHECK COLLATE COLLATION COLUMN CONCURRENTLY CONSTRAINT CREATE CROSS CURRENT_CATALOG CURRENT_DATE CURRENT_ROLE
CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER DEFAULT DEFERRABLE DESC DISTINCT DO ELSE END EXCEPT FALSE
FETCH FOR FOREIGN FREEZE FROM FULL GRANT GROUP HAVING ILIKE IN INITIALLY INNER INTERSECT INTO IS ISNULL JOIN LATERAL
LEADING LEFT LIKE LIMIT LOCALTIME LOCALTIMESTAMP NATURAL NOT NOTNULL NULL OFFSET ON ONLY OR ORDER OUTER OVERLAPS
PLACING PRIMARY REFERENCES RETURNING RIGHT SELECT SESSION_USER SIMILAR SOME SYMMETRIC SYSTEM_USER TABLE TABLESAMPLE
THEN TO TRAILING TRUE UNION UNIQUE USER USING VARIADIC VERBOSE WHEN WHERE WINDOW WITH`.split(/\s+/));

const MSSQL_RESERVED = new Set(`ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY
CASCADE CASE CHECK CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE
CONTINUE CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC
DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE EXCEPT
EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL FUNCTION GO GOTO
GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY
KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NONCLUSTERED NOT NULL NULLIF OF OFF OFFSETS ON OPEN OPENDATASOURCE
OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN PRECISION PRIMARY PRINT PROC PROCEDURE
PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK
ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT SEMANTICKEYPHRASETABLE SEMANTICSIMILARITYDETAILSTABLE
SEMANTICSIMILARITYTABLE SESSION_USER SET SETUSER SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN
TO TOP TRAN TRANSACTION TRIGGER TRUNCATE TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES
VARYING VIEW WAITFOR WHEN WHERE WHILE WITH WITHIN WRITETEXT`.split(/\s+/));

// Oracle's reserved words (V$RESERVED_WORDS); some are common column names, like Date, Level, Size and User
const ORACLE_RESERVED = new Set(`ACCESS ADD ALL ALTER AND ANY AS ASC AUDIT BETWEEN BY CHAR CHECK CLUSTER COLUMN COMMENT
COMPRESS CONNECT CREATE CURRENT DATE DECIMAL DEFAULT DELETE DESC DISTINCT DROP ELSE EXCLUSIVE EXISTS FILE FLOAT FOR FROM
GRANT GROUP HAVING IDENTIFIED IMMEDIATE IN INCREMENT INDEX INITIAL INSERT INTEGER INTERSECT INTO IS LEVEL LIKE LOCK LONG
MAXEXTENTS MINUS MLSLABEL MODE MODIFY NOAUDIT NOCOMPRESS NOT NOWAIT NULL NUMBER OF OFFLINE ON ONLINE OPTION OR ORDER
PCTFREE PRIOR PUBLIC RAW RENAME RESOURCE REVOKE ROW ROWID ROWNUM ROWS SELECT SESSION SET SHARE SIZE SMALLINT START
SUCCESSFUL SYNONYM SYSDATE TABLE THEN TO TRIGGER UID UNION UNIQUE UPDATE USER VALIDATE VALUES VARCHAR VARCHAR2 VIEW
WHENEVER WHERE WITH`.split(/\s+/));

const quoter = (words, open, close = open) => n => words.has(n.toUpperCase()) ? open + n + close : n;

// ─── Shared by the scripts ───────────────────────────────────────────────────

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

// A name the database takes: a longer one is cut, with a hash of the whole to keep it unique
function shortName(n, max) {
  if (n.length <= max) return n;
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return n.slice(0, max - 7) + '_' + h.toString(36).padStart(6, '0').slice(-6);
}

// A type as its parts: "decimal(8,2) unsigned" → { base: 'decimal', args: '8,2', unsigned: true }
function typeParts(t) {
  const m = t.match(/^(\w+)(?:\(([^)]*)\))?(.*)$/);
  return { base: m[1], args: m[2] ?? null, unsigned: /\bunsigned\b/.test(m[3]) };
}
const isBoolType = t => /^(bool|boolean|bit)\b/.test(t);
const enumValues = t => t.match(/^enum\((.*)\)$/)?.[1] ?? null;
const enumCheckSQL = (c, Q) => enumValues(c.effType) ? ` CHECK (${Q(c.name)} IN (${enumValues(c.effType)}))` : '';

// The DEFAULT of a column. [default now] is today's date in a date column, otherwise the current time.
function colDefault(c, D) {
  const d = c.default;
  if (d === 'now') return /^date\b/.test(c.effType) ? D.today : 'CURRENT_TIMESTAMP';
  if (isBoolType(c.effType) && /^(true|false|0|1)$/.test(d)) return D.bool(d === 'true' || d === '1');
  if (d === 'true' || d === 'false') return d === 'true' ? '1' : '0'; // in a number column
  if (d === 'null') return 'NULL';
  if (d[0] !== "'") return d;
  const s = d.slice(1, -1).replace(/''/g, "'");
  return D.typed?.(c, s) ?? D.str(s);
}
const defaultSQL = (c, D) => {
  if (c.default == null) return '';
  const v = colDefault(c, D);
  return ' DEFAULT ' + (D.defaultFor ? D.defaultFor(c, v) : v);
};

// D.action gives null for an action the database only has as its default (Oracle's NO ACTION)
const fkActionsSQL = (c, D) => [['DELETE', c.onDelete], ['UPDATE', c.onUpdate]]
  .map(([on, a]) => a && D.action(a) ? ` ON ${on} ${D.action(a)}` : '').join('');
const fkSQL = (c, D) => `FOREIGN KEY (${D.q(c.name)}) REFERENCES ${D.q(c.target.name)}(${D.q(c.targetCol.name)})` + fkActionsSQL(c, D);
const keyList = (cols, Q) => cols.map(c => Q(c.name)).join(', ');
const column = (c, w, Q, type, rest) => `  ${Q(c.name).padEnd(w)} ${type}${rest}`;
const nullSQL = c => c.nullable ? ' NULL' : ' NOT NULL';
const colWidth = (t, Q) => Math.max(...t.cols.map(c => Q(c.name).length));

// The table's indexes, [{ name, cols }], with names not in `taken` (which it adds to)
function namedIndexes(t, taken, D) {
  return (t.indexes ?? []).filter(ix => ix.cols.every(n => t.cols.some(c => c.name === n))).map(ix => {
    const base = shortName(ix.name ?? indexName(t.name, ix.cols), D.maxName);
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = base.slice(0, D.maxName - 1 - String(i).length) + '_' + i;
    taken.add(name.toLowerCase());
    return { name, cols: ix.cols };
  });
}
const createIndexes = (t, taken, D) => namedIndexes(t, taken, D).map(ix =>
  `CREATE INDEX ${D.q(ix.name)} ON ${D.q(t.name)} (${ix.cols.map(D.q).join(', ')});`);

const tablesOf = tables => topoOrder(tables.filter(t => t.cols.length));
const isKey = c => (c.target.pkCols.length === 1 && c.target.pkCols[0] === c.targetCol) || c.targetCol.unique;
const links = tables => tables.flatMap(t => t.cols.filter(c => c.target && !c.implicit).map(c => ({ t, c })));

// ─── MariaDB and MySQL ───────────────────────────────────────────────────────
// One script for both, with what differs in DIALECTS. UUID and INET are MariaDB 10.7+ only,
// and not in MySQL: text that holds one fits both.

const mariadbType = t => ({ uuid: 'CHAR(36)', inet4: 'VARCHAR(15)', inet6: 'VARCHAR(45)' })[typeParts(t).base] ?? sqlType(t);

// MariaDB needs an index on the column a foreign key points to. True when a key or index already starts with it.
function hasIndex(t, c) {
  return c.unique || t.pkCols[0] === c || t.multiUniques.some(u => u.cols[0] === c) ||
    (t.indexes ?? []).some(ix => ix.cols[0]?.toLowerCase() === c.name.toLowerCase());
}

// The indexes go inside CREATE TABLE: one a foreign key needs must be there before the key is made
function genMariaDB(tables, D) {
  const Q = D.q;
  const { order, cyclic } = tablesOf(tables);
  const out = ['-- ' + D.name, ''];
  if (!order.length) return out.join('\n');
  if (cyclic) out.push('SET FOREIGN_KEY_CHECKS = 0;');
  out.push(...[...order].reverse().map(t => `DROP TABLE IF EXISTS ${Q(t.name)};`), '');
  const created = new Set(), deferred = [];
  for (const t of order) {
    created.add(t);
    const w = colWidth(t, Q);
    const defs = t.cols.map(c => column(c, w, Q, mariadbType(c.effType),
      nullSQL(c) + defaultSQL(c, D) + (c.autoInc ? ' AUTO_INCREMENT' : '') + (c.unique ? ' UNIQUE' : '')));
    if (t.pkCols.length) defs.push(`  PRIMARY KEY (${keyList(t.pkCols, Q)})`);
    for (const u of t.multiUniques) defs.push(`  UNIQUE (${keyList(u.cols, Q)})`);
    // names MariaDB gives the indexes it makes itself: a UNIQUE or FOREIGN KEY one is named after its first column
    const taken = new Set(['primary', ...t.cols.filter(c => c.unique || c.target).map(c => c.name.toLowerCase()),
      ...t.multiUniques.map(u => u.cols[0].name.toLowerCase())]);
    const pointedTo = new Set(tables.flatMap(o => o.cols.filter(c => c.target === t).map(c => c.targetCol)));
    const needed = t.cols.filter(c => pointedTo.has(c) && !hasIndex(t, c))
      .map(c => ({ name: shortName(indexName(t.name, [c.name]), D.maxName), cols: [c.name] }));
    for (const ix of needed) taken.add(ix.name.toLowerCase());
    for (const ix of [...namedIndexes(t, taken, D), ...needed]) defs.push(`  INDEX ${Q(ix.name)} (${ix.cols.map(Q).join(', ')})`);
    for (const c of t.cols) {
      if (!c.target) continue;
      if (created.has(c.target)) defs.push('  ' + fkSQL(c, D));
      else deferred.push(`ALTER TABLE ${Q(t.name)} ADD ${fkSQL(c, D)};`);
    }
    out.push(`CREATE TABLE ${Q(t.name)} (\n${defs.join(',\n')}\n);`, '');
  }
  if (deferred.length) out.push(...deferred, '');
  if (cyclic) out.push('SET FOREIGN_KEY_CHECKS = 1;', '');
  return out.join('\n');
}

function mariadbProblems(tables) {
  const problems = links(tables).filter(({ c }) => !isKey(c)).map(({ c }) => problem(c.line,
    `${c.target.name}.${c.targetCol.name} is neither the primary key nor unique. The SQL adds an index on it, but normally it should be unique.`, 'warn'));
  return [...problems, ...sameTypeProblems(tables)];
}

// MySQL 8.4 only links to a key, can't make a key of TEXT, and a key is at most 3072 bytes (768 characters)
function mysqlProblems(tables) {
  const problems = [...keyProblems(tables, 'MySQL'), ...sameTypeProblems(tables)];
  for (const t of tables) {
    for (const c of t.cols) {
      const { base, args } = typeParts(c.effType);
      const keyed = c.isPk || c.unique || t.multiUniques.some(u => u.cols.includes(c)) || t.indexes?.some(ix => ix.cols.includes(c.name));
      if (!keyed) continue;
      if (/(text|blob)$|^json$/.test(base)) problems.push(problem(c.line, `MySQL can't make a key or index of ${c.name} (${c.effType}). Use vc instead.`));
      else if (/^(vc|varchar|char)$/.test(base) && +(args ?? DEFAULT_VC) > 768) {
        problems.push(problem(c.line, `MySQL keys are at most 768 characters, and ${c.name} can hold ${args}. Use a shorter vc.`));
      }
    }
  }
  return problems;
}

// MariaDB and MySQL: a foreign key's two sides need the same type, and TEXT can't be one
function sameTypeProblems(tables) {
  const problems = [];
  for (const { c } of links(tables)) {
    const tc = c.targetCol, where = `${c.target.name}.${tc.name}`;
    const a = keyType(c.effType), b = keyType(tc.effType);
    if (a === null || b === null) {
      problems.push(problem(c.line, `${b === null ? where : c.name} is ${b === null ? tc.effType : c.effType}, ` +
        'which can\'t be part of a foreign key. Use vc instead.'));
    } else if (a !== b) {
      problems.push(problem(c.line, `${c.name} is ${c.effType} but ${where} is ${tc.effType}. A foreign key needs the same type on both sides.`));
    }
  }
  return problems;
}

// ─── SQLite ──────────────────────────────────────────────────────────────────
// SQLite takes the same type names (VARCHAR(50), DATE, DECIMAL(8,2)…) and only uses them as a hint,
// except: an Id that numbers itself is INTEGER PRIMARY KEY, and an enum is TEXT with a CHECK.
// Tables may point to tables made later, so they are made in key order only to read well.

function genSQLite(tables) {
  const D = DIALECTS.sqlite, Q = D.q;
  const { order, cyclic } = tablesOf(tables);
  const out = ['-- SQLite', cyclic ? 'PRAGMA foreign_keys = OFF;' : 'PRAGMA foreign_keys = ON;', ''];
  if (!order.length) return out.join('\n');
  out.push(...[...order].reverse().map(t => `DROP TABLE IF EXISTS ${Q(t.name)};`), '');
  for (const t of order) {
    const w = colWidth(t, Q), rowid = t.cols.find(c => c.autoInc);
    const defs = t.cols.map(c => c === rowid
      ? column(c, w, Q, 'INTEGER PRIMARY KEY', '')
      : column(c, w, Q, /^(enum|set)\(/.test(c.effType) ? 'TEXT' : sqlType(c.effType),
        nullSQL(c) + defaultSQL(c, D) + (c.unique ? ' UNIQUE' : '') + enumCheckSQL(c, Q)));
    if (t.pkCols.length && !rowid) defs.push(`  PRIMARY KEY (${keyList(t.pkCols, Q)})`);
    for (const u of t.multiUniques) defs.push(`  UNIQUE (${keyList(u.cols, Q)})`);
    for (const c of t.cols) if (c.target) defs.push('  ' + fkSQL(c, D));
    out.push(`CREATE TABLE ${Q(t.name)} (\n${defs.join(',\n')}\n);`, '');
  }
  const taken = new Set(); // an index name is for the whole database, not per table
  const indexes = order.flatMap(t => createIndexes(t, taken, D));
  if (indexes.length) out.push(...indexes, '');
  if (cyclic) out.push('PRAGMA foreign_keys = ON;', '');
  return out.join('\n');
}

const keyProblems = (tables, db) => links(tables).filter(({ c }) => !isKey(c)).map(({ c }) =>
  problem(c.line, `${db} needs ${c.target.name}.${c.targetCol.name} to be the primary key or unique`));

// ─── PostgreSQL ──────────────────────────────────────────────────────────────
// Names are left unquoted (Postgres folds them to lower case) unless they are reserved.
// An Id that numbers itself is GENERATED BY DEFAULT AS IDENTITY, so the sample rows can
// give their own; the numbering then moves past them.

const PG_TYPES = { tinyint: 'SMALLINT', smallint: 'SMALLINT', mediumint: 'INT', int: 'INT', integer: 'INT', bigint: 'BIGINT',
  serial: 'BIGINT', bool: 'BOOLEAN', boolean: 'BOOLEAN', bit: 'BOOLEAN', float: 'REAL', double: 'DOUBLE PRECISION',
  real: 'DOUBLE PRECISION', tinytext: 'TEXT', text: 'TEXT', mediumtext: 'TEXT', longtext: 'TEXT', enum: 'TEXT', set: 'TEXT',
  json: 'JSONB', binary: 'BYTEA', varbinary: 'BYTEA', tinyblob: 'BYTEA', blob: 'BYTEA', mediumblob: 'BYTEA',
  longblob: 'BYTEA', datetime: 'TIMESTAMP', timestamp: 'TIMESTAMP', year: 'SMALLINT', uuid: 'UUID', inet4: 'INET',
  inet6: 'INET', geometry: 'TEXT', point: 'POINT', linestring: 'TEXT', polygon: 'TEXT' };
// an unsigned number needs the next size up
const PG_UNSIGNED = { tinyint: 'SMALLINT', smallint: 'INT', mediumint: 'INT', int: 'BIGINT', integer: 'BIGINT', bigint: 'NUMERIC(20)' };
function pgType(t) {
  const { base, unsigned } = typeParts(t);
  return (unsigned && PG_UNSIGNED[base]) || PG_TYPES[base] || sqlType(t).replace(/ (UN)?SIGNED| ZEROFILL/g, '');
}

// Shared with Oracle: D.type gives the column's type, D.dropTail what DROP TABLE ends with,
// D.defaultFirst puts DEFAULT before NOT NULL, D.skipIndexes(t) the indexes the database refuses
function genPostgres(tables, D) {
  const Q = D.q;
  const { order } = tablesOf(tables);
  const out = ['-- ' + D.name, ''];
  if (!order.length) return out.join('\n');
  out.push(...[...order].reverse().map(t => `DROP TABLE IF EXISTS ${Q(t.name)} ${D.dropTail};`), '');
  const created = new Set(), deferred = [];
  for (const t of order) {
    created.add(t);
    const w = colWidth(t, Q);
    const defs = t.cols.map(c => column(c, w, Q, D.type(c.effType), c.autoInc
      ? ' GENERATED BY DEFAULT AS IDENTITY'
      : (D.defaultFirst ? defaultSQL(c, D) + nullSQL(c) : nullSQL(c) + defaultSQL(c, D)) + (c.unique ? ' UNIQUE' : '') + enumCheckSQL(c, Q)));
    if (t.pkCols.length) defs.push(`  PRIMARY KEY (${keyList(t.pkCols, Q)})`);
    for (const u of t.multiUniques) defs.push(`  UNIQUE (${keyList(u.cols, Q)})`);
    for (const c of t.cols) {
      if (!c.target) continue;
      // a key to a table made later is added after it, and checked at COMMIT so sample rows can go in any order
      if (created.has(c.target)) defs.push('  ' + fkSQL(c, D));
      else deferred.push(`ALTER TABLE ${Q(t.name)} ADD ${fkSQL(c, D)} DEFERRABLE INITIALLY DEFERRED;`);
    }
    out.push(`CREATE TABLE ${Q(t.name)} (\n${defs.join(',\n')}\n);`, '');
  }
  if (deferred.length) out.push(...deferred, '');
  const taken = new Set(); // index names are for the whole schema
  const skip = D.skipIndexes?.(tables) ?? new Set();
  const indexes = order.flatMap(t => createIndexes({ ...t, indexes: (t.indexes ?? []).filter(ix => !skip.has(ix)) }, taken, D));
  if (indexes.length) out.push(...indexes, '');
  return out.join('\n');
}

// Postgres compares a foreign key's types loosely: any integer to any integer, any text to any text
const pgFamily = t => {
  const s = pgType(t);
  return /^(SMALLINT|INT|BIGINT)$/.test(s) ? 'integer' : /^(VARCHAR|CHAR|TEXT)\b/.test(s) ? 'text'
    : /^(NUMERIC|DECIMAL)\b/.test(s) ? 'numeric' : s.replace(/\(.*\)/, '');
};

function postgresProblems(tables) {
  const problems = keyProblems(tables, 'PostgreSQL');
  for (const { c } of links(tables)) {
    const tc = c.targetCol;
    if (pgFamily(c.effType) !== pgFamily(tc.effType)) {
      problems.push(problem(c.line, `${c.name} is ${c.effType} but ${c.target.name}.${tc.name} is ${tc.effType}. PostgreSQL can't link them.`));
    }
  }
  return problems;
}

// ─── SQL Server ──────────────────────────────────────────────────────────────
// Text is NVARCHAR, so any language fits. An Id that numbers itself is IDENTITY(1,1).
// A unique column that may be null is a filtered unique index: SQL Server's UNIQUE allows one NULL only.

const MSSQL_TYPES = { tinyint: 'TINYINT', smallint: 'SMALLINT', mediumint: 'INT', int: 'INT', integer: 'INT', bigint: 'BIGINT',
  serial: 'BIGINT', bool: 'BIT', boolean: 'BIT', bit: 'BIT', float: 'REAL', double: 'FLOAT', real: 'FLOAT',
  tinytext: 'NVARCHAR(MAX)', text: 'NVARCHAR(MAX)', mediumtext: 'NVARCHAR(MAX)', longtext: 'NVARCHAR(MAX)',
  json: 'NVARCHAR(MAX)', set: 'NVARCHAR(MAX)', tinyblob: 'VARBINARY(MAX)', blob: 'VARBINARY(MAX)',
  mediumblob: 'VARBINARY(MAX)', longblob: 'VARBINARY(MAX)', datetime: 'DATETIME2', timestamp: 'DATETIME2', year: 'SMALLINT',
  uuid: 'UNIQUEIDENTIFIER', inet4: 'NVARCHAR(15)', inet6: 'NVARCHAR(45)', geometry: 'NVARCHAR(MAX)', point: 'NVARCHAR(MAX)',
  linestring: 'NVARCHAR(MAX)', polygon: 'NVARCHAR(MAX)' };
const MSSQL_UNSIGNED = { smallint: 'INT', mediumint: 'INT', int: 'BIGINT', integer: 'BIGINT', bigint: 'DECIMAL(20,0)' };
function mssqlType(t) {
  const { base, args, unsigned } = typeParts(t);
  if (base === 'vc' || base === 'varchar') { const n = +(args ?? DEFAULT_VC); return n > 4000 ? 'NVARCHAR(MAX)' : `NVARCHAR(${n})`; }
  if (base === 'char') { const n = +(args ?? 1); return n > 4000 ? 'NVARCHAR(MAX)' : `NCHAR(${n})`; }
  if (base === 'enum') return `NVARCHAR(${Math.max(1, ...enumOptions(t).map(v => v.length))})`;
  return (unsigned && MSSQL_UNSIGNED[base]) || MSSQL_TYPES[base] || sqlType(t).replace(/ (UN)?SIGNED| ZEROFILL/g, '');
}
const enumOptions = t => [...(enumValues(t) ?? '').matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"));
const isMax = t => /\(MAX\)/.test(mssqlType(t));

function genMSSQL(tables) {
  const D = DIALECTS.mssql, Q = D.q;
  const { order } = tablesOf(tables);
  const out = ['-- SQL Server', ''];
  if (!order.length) return out.join('\n');
  // the keys added after their tables go first, or the tables they join can't be dropped
  const later = new Map(), made = new Set(); // column → its table
  for (const t of order) { made.add(t); for (const c of t.cols) if (c.target && !made.has(c.target)) later.set(c, t); }
  const fkNameOf = (t, c) => Q(shortName(`fk_${t.name}_${c.name}`, D.maxName));
  for (const [c, t] of later) out.push(`IF OBJECT_ID(N'${t.name}', N'U') IS NOT NULL ALTER TABLE ${Q(t.name)} DROP CONSTRAINT IF EXISTS ${fkNameOf(t, c)};`);
  out.push(...[...order].reverse().map(t => `DROP TABLE IF EXISTS ${Q(t.name)};`), '');
  const deferred = [], filtered = [], taken = new Set();
  const filteredUnique = (t, cols) => {
    const name = shortName(`uq_${t.name}_${cols.map(c => c.name).join('_')}`, D.maxName);
    taken.add(name.toLowerCase());
    filtered.push(`CREATE UNIQUE INDEX ${Q(name)} ON ${Q(t.name)} (${keyList(cols, Q)}) WHERE ${cols.map(c => Q(c.name) + ' IS NOT NULL').join(' AND ')};`);
  };
  // an FK may only point to a real UNIQUE constraint, so a nullable unique column that is pointed to keeps one
  const pointedTo = new Set(tables.flatMap(t => t.cols.filter(c => c.target).map(c => c.targetCol)));
  const plainUnique = c => c.unique && (!c.nullable || pointedTo.has(c));
  for (const t of order) {
    const w = colWidth(t, Q);
    const defs = t.cols.map(c => column(c, w, Q, mssqlType(c.effType),
      (c.autoInc ? ' IDENTITY(1,1)' : '') + nullSQL(c) + defaultSQL(c, D) + (plainUnique(c) ? ' UNIQUE' : '') + enumCheckSQL(c, Q)));
    if (t.pkCols.length) defs.push(`  PRIMARY KEY (${keyList(t.pkCols, Q)})`);
    for (const c of t.cols) if (c.unique && !plainUnique(c)) filteredUnique(t, [c]);
    for (const u of t.multiUniques) {
      if (u.cols.some(c => c.nullable)) filteredUnique(t, u.cols);
      else defs.push(`  UNIQUE (${keyList(u.cols, Q)})`);
    }
    for (const c of t.cols) {
      if (!c.target) continue;
      if (later.has(c)) deferred.push(`ALTER TABLE ${Q(t.name)} ADD CONSTRAINT ${fkNameOf(t, c)} ${fkSQL(c, D)};`);
      else defs.push('  ' + fkSQL(c, D));
    }
    out.push(`CREATE TABLE ${Q(t.name)} (\n${defs.join(',\n')}\n);`, '');
  }
  if (deferred.length) out.push(...deferred, '');
  const indexes = [...filtered, ...order.flatMap(t => createIndexes(t, taken, D))];
  if (indexes.length) out.push(...indexes, '');
  return out.join('\n');
}

function mssqlProblems(tables) {
  const problems = keyProblems(tables, 'SQL Server');
  const maxText = (c, what) => problems.push(problem(c.line, `SQL Server can't use ${c.name} (${c.effType}) ${what}. Use vc instead.`));
  for (const t of tables) {
    for (const c of t.cols) {
      if (isMax(c.effType) && (c.isPk || c.unique || t.multiUniques.some(u => u.cols.includes(c)))) maxText(c, 'in a key');
      else if (isMax(c.effType) && t.indexes?.some(ix => ix.cols.includes(c.name))) maxText(c, 'in an index');
      else if (/^NVARCHAR\((\d+)\)/.test(mssqlType(c.effType)) && +mssqlType(c.effType).match(/\d+/)[0] > 850 && (c.isPk || c.unique)) {
        problems.push(problem(c.line, `SQL Server keys are at most 1700 bytes, and ${c.name} can hold ${2 * +mssqlType(c.effType).match(/\d+/)[0]}. Use a shorter vc.`, 'warn'));
      }
    }
  }
  for (const { c } of links(tables)) {
    const tc = c.targetCol;
    if (isMax(c.effType) || isMax(tc.effType)) maxText(isMax(c.effType) ? c : tc, 'in a foreign key');
    else if (mssqlType(c.effType) !== mssqlType(tc.effType)) {
      problems.push(problem(c.line, `${c.name} is ${mssqlType(c.effType)} but ${c.target.name}.${tc.name} is ${mssqlType(tc.effType)}. ` +
        'SQL Server needs the same type and length on both sides.'));
    }
  }
  // "may cause cycles or multiple cascade paths": what a delete (or key update) starts may reach each table only once
  for (const action of ['onDelete', 'onUpdate']) {
    const children = t => links(tables).filter(({ c }) => c.target === t && /^(cascade|set null)$/.test(c[action] ?? ''));
    const bad = new Map(); // column → its table
    for (const start of tables) {
      const seen = new Set([start]), walk = t => {
        for (const { t: child, c } of children(t)) {
          if (seen.has(child)) { bad.set(c, child); continue; }
          seen.add(child);
          walk(child);
        }
      };
      walk(start);
    }
    for (const [c, t] of bad) {
      problems.push(problem(c.line, `SQL Server refuses [${action === 'onDelete' ? 'delete' : 'update'} ${c[action]}] here: ` +
        `it would reach ${t.name} a second time. Leave it out on one of the paths.`));
    }
  }
  return problems;
}

// ─── Oracle ──────────────────────────────────────────────────────────────────
// Oracle Database 23ai: BOOLEAN, multi-row VALUES and DROP TABLE IF EXISTS are new in it.
// Names are left unquoted (Oracle folds them to upper case) unless they are reserved.
// Text is VARCHAR2(n CHAR), so n is characters, not bytes. A date is written DATE '2024-01-31',
// whatever the session's date format is. There is no TIME type: a time of day is text.

const ORACLE_TYPES = { tinyint: 'NUMBER(3)', smallint: 'NUMBER(5)', mediumint: 'NUMBER(7)', int: 'NUMBER(10)',
  integer: 'NUMBER(10)', bigint: 'NUMBER(19)', serial: 'NUMBER(20)', bool: 'BOOLEAN', boolean: 'BOOLEAN', bit: 'BOOLEAN',
  float: 'BINARY_FLOAT', double: 'BINARY_DOUBLE', real: 'BINARY_DOUBLE', tinytext: 'CLOB', text: 'CLOB', mediumtext: 'CLOB',
  longtext: 'CLOB', set: 'VARCHAR2(255 CHAR)', json: 'JSON', tinyblob: 'BLOB', blob: 'BLOB', mediumblob: 'BLOB',
  longblob: 'BLOB', date: 'DATE', datetime: 'TIMESTAMP', timestamp: 'TIMESTAMP', time: 'VARCHAR2(8 CHAR)', year: 'NUMBER(4)',
  uuid: 'VARCHAR2(36 CHAR)', inet4: 'VARCHAR2(15 CHAR)', inet6: 'VARCHAR2(45 CHAR)', geometry: 'CLOB', point: 'CLOB', linestring: 'CLOB',
  polygon: 'CLOB' };
const ORACLE_UNSIGNED = { int: 'NUMBER(10)', integer: 'NUMBER(10)', bigint: 'NUMBER(20)' };
function oracleType(t) {
  const { base, args, unsigned } = typeParts(t);
  const text = n => n > 4000 ? 'CLOB' : `VARCHAR2(${n} CHAR)`;
  if (base === 'vc' || base === 'varchar') return text(+(args ?? DEFAULT_VC));
  if (base === 'char') return +(args ?? 1) > 2000 ? 'CLOB' : `CHAR(${args ?? 1} CHAR)`;
  if (base === 'enum') return text(Math.max(1, ...enumOptions(t).map(v => v.length)));
  if (/^(decimal|dec|numeric|fixed)$/.test(base)) return `NUMBER(${args ?? 10})`;
  if (base === 'binary' || base === 'varbinary') return `RAW(${Math.min(+(args ?? 1), 2000)})`;
  return (unsigned && ORACLE_UNSIGNED[base]) || ORACLE_TYPES[base] || sqlType(t);
}
const isClob = t => /^(CLOB|BLOB|JSON)$/.test(oracleType(t));

// an index on just what a key already covers is refused ("such column list already indexed")
function oracleSkipIndexes(tables) {
  const skip = new Set();
  for (const t of tables) {
    const keyed = [t.pkCols, ...t.multiUniques.map(u => u.cols), ...t.cols.filter(c => c.unique).map(c => [c])]
      .map(cols => cols.map(c => c.name.toLowerCase()).join());
    for (const ix of t.indexes ?? []) if (keyed.includes(ix.cols.map(n => n.toLowerCase()).join())) skip.add(ix);
  }
  return skip;
}

function oracleProblems(tables) {
  const problems = keyProblems(tables, 'Oracle');
  for (const t of tables) {
    for (const c of t.cols) {
      if (!isClob(c.effType)) continue;
      const keyed = c.isPk || c.unique || t.multiUniques.some(u => u.cols.includes(c)) || t.indexes?.some(ix => ix.cols.includes(c.name));
      if (keyed) problems.push(problem(c.line, `Oracle can't make a key or index of ${c.name} (${c.effType}). Use vc instead.`));
    }
  }
  for (const { c } of links(tables)) {
    const tc = c.targetCol, family = t => oracleType(t).replace(/\(.*\)/, ''); // lengths may differ, CHAR and VARCHAR2 may not
    if (isClob(c.effType) || isClob(tc.effType)) {
      const x = isClob(c.effType) ? c : tc;
      problems.push(problem(c.line, `Oracle can't link ${x.name} (${x.effType}). Use vc instead.`));
    } else if (family(c.effType) !== family(tc.effType)) {
      problems.push(problem(c.line, `${c.name} is ${c.effType} but ${c.target.name}.${tc.name} is ${tc.effType}. Oracle can't link them.`));
    }
    if (c.onUpdate) problems.push(problem(c.line, `Oracle has no [update ${c.onUpdate}]: a key isn't meant to change there. Leave it out.`));
  }
  return problems;
}

// ─── The databases ───────────────────────────────────────────────────────────
// dqIdent: "x" is a name, not a string. backslash: \ escapes in strings.
// Sample rows (sampleInserts): dataStart/dataEnd go around them, dataTable(t) around each table's.

const sqlStr = s => `'${s.replace(/'/g, "''")}'`;
const upperBool = b => b ? 'TRUE' : 'FALSE';
const DIALECTS = {
  mariadb: {
    name: 'MariaDB', q: quoter(MARIADB_RESERVED, '`'), maxName: 64, dqIdent: false, backslash: true,
    gen: tables => genMariaDB(tables, DIALECTS.mariadb), problems: mariadbProblems,
    str: s => sqlStr(s.replace(/\\/g, '\\\\')), bool: upperBool, today: 'CURRENT_DATE', action: a => a.toUpperCase(),
    dataStart: () => ['SET FOREIGN_KEY_CHECKS = 0;'], dataEnd: () => ['SET FOREIGN_KEY_CHECKS = 1;'],
  },
  mysql: {
    name: 'MySQL', q: quoter(MYSQL_RESERVED, '`'), maxName: 64, dqIdent: false, backslash: true,
    gen: tables => genMariaDB(tables, DIALECTS.mysql), problems: mysqlProblems,
    str: s => sqlStr(s.replace(/\\/g, '\\\\')), bool: upperBool, today: 'CURRENT_DATE', action: a => a.toUpperCase(),
    // a default other than a plain value, or on TEXT, BLOB or JSON, is an expression in parentheses
    defaultFor: (c, v) => v === 'CURRENT_DATE' || /(text|blob)$|^json$/.test(typeParts(c.effType).base) ? `(${v})` : v,
    dataStart: () => ['SET FOREIGN_KEY_CHECKS = 0;'], dataEnd: () => ['SET FOREIGN_KEY_CHECKS = 1;'],
  },
  sqlite: {
    name: 'SQLite', q: quoter(SQLITE_KEYWORDS, '"'), maxName: 64, dqIdent: true, backslash: false,
    gen: genSQLite, problems: tables => keyProblems(tables, 'SQLite'), // SQLite doesn't compare the types
    str: sqlStr, bool: upperBool, today: 'CURRENT_DATE', action: a => a.toUpperCase(),
    dataStart: () => ['PRAGMA foreign_keys = OFF;'], dataEnd: () => ['PRAGMA foreign_keys = ON;'],
  },
  postgres: {
    name: 'PostgreSQL', q: quoter(POSTGRES_RESERVED, '"'), maxName: 63, dqIdent: true, backslash: false,
    gen: tables => genPostgres(tables, DIALECTS.postgres), problems: postgresProblems, type: pgType, dropTail: 'CASCADE',
    str: sqlStr, bool: upperBool, today: 'CURRENT_DATE', action: a => a.toUpperCase(),
    // one transaction, so keys to tables made later are checked at the end; then numbering goes on after the sample Ids
    dataStart: () => ['BEGIN;'],
    dataEnd: order => ['COMMIT;', ...order.flatMap(t => t.cols.filter(c => c.autoInc).map(c => {
      const Q = DIALECTS.postgres.q, col = Q(c.name) === c.name ? c.name.toLowerCase() : c.name;
      return `SELECT setval(pg_get_serial_sequence('${Q(t.name)}', '${col}'), MAX(${Q(c.name)})) FROM ${Q(t.name)};`;
    }))],
  },
  mssql: {
    name: 'SQL Server', q: quoter(MSSQL_RESERVED, '[', ']'), maxName: 128, dqIdent: true, backslash: false, nPrefix: true,
    gen: genMSSQL, problems: mssqlProblems,
    str: s => 'N' + sqlStr(s), bool: b => b ? '1' : '0', today: 'CAST(GETDATE() AS DATE)',
    bin: s => `CONVERT(VARBINARY(MAX), ${sqlStr(s)})`, // text doesn't turn into bytes by itself here
    action: a => a === 'restrict' ? 'NO ACTION' : a.toUpperCase(), // no RESTRICT; NO ACTION is the same here
    dataStart: (order, cyclic) => cyclic ? order.map(t => `ALTER TABLE ${DIALECTS.mssql.q(t.name)} NOCHECK CONSTRAINT ALL;`) : [],
    dataEnd: (order, cyclic) => cyclic ? order.map(t => `ALTER TABLE ${DIALECTS.mssql.q(t.name)} WITH CHECK CHECK CONSTRAINT ALL;`) : [],
    // sample rows give their own Ids
    dataTable: t => t.cols.some(c => c.autoInc) ? [[`SET IDENTITY_INSERT ${DIALECTS.mssql.q(t.name)} ON;`], [`SET IDENTITY_INSERT ${DIALECTS.mssql.q(t.name)} OFF;`]] : [[], []],
  },
};
DIALECTS.oracle = {
  name: 'Oracle', q: quoter(ORACLE_RESERVED, '"'), maxName: 128, dqIdent: true, backslash: false,
  gen: tables => genPostgres(tables, DIALECTS.oracle), problems: oracleProblems,
  type: oracleType, dropTail: 'CASCADE CONSTRAINTS', defaultFirst: true, skipIndexes: oracleSkipIndexes,
  str: sqlStr, bool: upperBool, today: 'TRUNC(SYSDATE)',
  action: a => /^(cascade|set null)$/.test(a) ? a.toUpperCase() : null, // RESTRICT and NO ACTION are what it does anyway
  typed: (c, s) => /^date\b/.test(c.effType) ? `DATE ${sqlStr(s)}` : /^(datetime|timestamp)\b/.test(c.effType) ? `TIMESTAMP ${sqlStr(s)}` : undefined,
  bin: s => `UTL_RAW.CAST_TO_RAW(${sqlStr(s)})`,
  // one transaction, so keys to tables made later are checked at the end; then numbering goes on after the sample Ids
  dataStart: () => [],
  dataEnd: order => ['COMMIT;', ...order.flatMap(t => t.cols.filter(c => c.autoInc).map(c =>
    `ALTER TABLE ${DIALECTS.oracle.q(t.name)} MODIFY ${DIALECTS.oracle.q(c.name)} GENERATED BY DEFAULT AS IDENTITY (START WITH LIMIT VALUE);`))],
};
const dialectOf = d => DIALECTS[d] ?? DIALECTS.mariadb;

function genSQL(tables, dialect = 'mariadb') { return dialectOf(dialect).gen(tables); }
// What the database refuses (or warns about) in the diagram
function dialectProblems(tables, dialect = 'mariadb') { return dialectOf(dialect).problems(tables); }
