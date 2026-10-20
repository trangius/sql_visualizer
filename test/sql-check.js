'use strict';

// Checks the generated SQL: every example and the schemas below are turned into a script for
// each database, with sample data, and run where a client is found: MariaDB (MYSQL=path/to/mysql,
// otherwise mysql on the PATH or XAMPP's; a database named sqlviz_check is made and dropped)
// and SQLite (sqlite3, in memory). What a database would refuse must be reported as a problem
// instead. Going through the SQL tab and back must give the same Simple text.
// Run: node test/sql-check.js

const fs = require('fs'), path = require('path'), vm = require('vm'), { spawnSync } = require('child_process');
const js = f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8');

// Simple syntax or SQL (starts with CREATE; MariaDB's unless a third item says which), and the
// problem it must report, if any: the same for both databases, or { mariadb, sqlite }
const CASES = {
  'fk to a column without an index': [`Owner
  Id
  Email
Pet
  Id
  OwnerEmail -> Owner.Email
`, { sqlite: 'SQLite needs Owner.Email to be the primary key or unique' }],
  'fk to the second column of a key': [`OrderLine
  OrderNo int
  LineNo int
  pk (OrderNo, LineNo)
Shipment
  Id
  LineNo -> OrderLine.LineNo
`, { sqlite: 'SQLite needs OrderLine.LineNo' }],
  'fk of another integer type': [`Owner
  Id
Pet
  Id
  OwnerId bigint -> Owner
`, { mariadb: 'OwnerId is bigint but Owner.Id is int' }],
  'fk of another sign': [`Owner
  Code int unsigned pk
Pet
  Id
  OwnerCode int -> Owner
`, { mariadb: 'OwnerCode is int but Owner.Code is int unsigned' }],
  'fk to a text column': [`Tag
  Id
  Body text unique
Note
  Id
  TagBody -> Tag.Body
`, { mariadb: "Tag.Body is text, which can't be part of a foreign key" }],
  'fk between strings of different lengths': [`Country
  Code char(2) pk
City
  Id
  Country vc(2) -> Country
`],
  'delete, update and default': [`Owner
  Id
  Name vc(50) [default 'Anna ''Ann'' #1']  # comment
  Code char(2) unique
Pet
  Id
  OwnerId -> Owner [delete cascade]
  OwnerCode null -> Owner.Code [delete set null, update cascade]
  Born date [default now]
  Added datetime [default now]
  Weight decimal(5,2) [default -1.50]
  Alive bool [default true]
  Tag vc(20) null [default null]
`],
  'set null on a column that is not null': [`Owner
  Id
Pet
  Id
  OwnerId -> Owner [delete set null]
`, 'delete set null needs OwnerId to be null'],
  'default text without quotes': [`Pet
  Id
  Kind vc [default dog]  # 'a' comment
`, "Write text in quotes: [default 'dog']"],
  'delete without a foreign key': [`Pet
  Id
  Name [delete cascade]
`, 'is for a foreign key'],
  'enum keeps its case': [`Shirt
  Id
  Size enum('Small','Large')
`],
  'long names': [`AVeryLongTableNameThatGoesOnAndOnAndOnForever
  Id
  AnotherExtremelyLongColumnNameNumberOne int
  AnotherExtremelyLongColumnNameNumberTwo int
  unique (AnotherExtremelyLongColumnNameNumberOne, AnotherExtremelyLongColumnNameNumberTwo)
Other
  Id
  Ref int -> AVeryLongTableNameThatGoesOnAndOnAndOnForever.AnotherExtremelyLongColumnNameNumberTwo
`, { sqlite: 'SQLite needs' }],
  'keywords as names': [`Order
  Id
  Group vc(20) unique
  Select int
  Values text null
Index
  Id
  OrderGroup vc(20) -> Order.Group
`],
  'cycle': [`Person
  Id
  BestFriendId null -> Person
  HomeId null -> House
House
  Id
  OwnerId -> Person
`],
  'indexes named like keys': [`CREATE TABLE P (Id INT PRIMARY KEY);
CREATE TABLE Q (Id INT PRIMARY KEY, Email VARCHAR(50) UNIQUE, Name VARCHAR(50), PId INT,
  FOREIGN KEY (PId) REFERENCES P(Id), KEY Email (Email, Name), KEY PId (Name),
  INDEX (Name, Email));
CREATE INDEX AVeryLongIndexNameThatGoesOnAndOnAndOnForeverAndEverAndEverAndEver ON Q (Name, PId);`],
  'phpMyAdmin dump': [`CREATE TABLE Teacher (Id int(11) NOT NULL, Name varchar(100) NOT NULL) ENGINE=InnoDB;
CREATE TABLE Course (Id int(11) NOT NULL, Name varchar(100) NOT NULL, TeacherId int(11) NOT NULL) ENGINE=InnoDB;
ALTER TABLE Teacher ADD PRIMARY KEY (Id);
ALTER TABLE Course ADD PRIMARY KEY (Id), ADD KEY TeacherId (TeacherId);
ALTER TABLE Course ADD CONSTRAINT course_ibfk_1 FOREIGN KEY (TeacherId) REFERENCES Teacher (Id);`],
  'SQLite script': [`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS "Author" ("Id" INTEGER PRIMARY KEY AUTOINCREMENT, [Name] TEXT NOT NULL, "Note", Born DATE DEFAULT CURRENT_DATE);
CREATE TABLE "Order" (Id INTEGER PRIMARY KEY, "Group" TEXT NOT NULL CHECK ("Group" IN ('a', 'b''c')), AuthorId INTEGER REFERENCES Author(Id) ON DELETE CASCADE) WITHOUT ROWID;
CREATE INDEX ix_name ON Author (Name);
CREATE INDEX ix_name2 ON "Order" (AuthorId);`, null, 'sqlite'],
};

function findClient() {
  for (const c of [process.env.MYSQL, 'mysql', 'mariadb', '/Applications/XAMPP/xamppfiles/bin/mysql'].filter(Boolean)) {
    if (!spawnSync(c, ['--version']).error) return c;
  }
  return null;
}
const client = findClient(), sqlite = !spawnSync('sqlite3', ['--version']).error, user = process.env.MYSQL_USER ?? 'root';
const db = sql => spawnSync(client, ['-u' + user, '--batch'], { input: sql, encoding: 'utf8' }); // a password goes in MYSQL_PWD

const ctx = { console, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, onSampleData() {}, state: { sampleLang: null } };
vm.createContext(ctx);
vm.runInContext(['model', 'sql', 'examples', 'sample/kinds', 'sample/en', 'sample/sv', 'sample'].map(js).join('\n') +
  '\nloadScript = async () => {}; // the sample files are already loaded', ctx);

const DIALECTS = ['mariadb', 'sqlite'];
const parse = vm.runInContext(`(src, sql, dialect) => {
  const r = sql ? parseSQL(src, dialect) : parseText(src);
  r.problems.push(...resolve(r.tables), ...dialectProblems(r.tables, dialect));
  return r;
}`, ctx);
const toText = vm.runInContext('(sql, dialect) => sqlToText(sql, false, dialect)', ctx);
const textOf = vm.runInContext('(src) => { const r = parseText(src); resolve(r.tables); return genText(r.tables, []); }', ctx);
const strip = t => t.replace(/#.*$/gm, '').replace(/[ \t]+$/gm, '').trim().split(/\n\n+/).sort().join('\n\n'); // the SQL orders tables by their keys

(async () => {
  let failures = 0;
  const fail = (where, msg) => { failures++; console.log('FAIL', where + ':', msg); };
  const ping = client && db('SELECT 1'), run = { mariadb: ping && !ping.status, sqlite };
  if (!client) console.log('No MariaDB client found: its scripts are only generated, not run.');
  else if (!run.mariadb) console.log('Could not connect to MariaDB:', ping.stderr.trim());
  if (!sqlite) console.log('No sqlite3 found: its scripts are only generated, not run.');
  const all = { ...Object.fromEntries(Object.entries(vm.runInContext('EXAMPLES', ctx)).map(([k, v]) => [k, [v]])), ...CASES };
  for (const [name, [src, expects, from = 'mariadb']] of Object.entries(all)) {
    const sql = /^\s*(CREATE|PRAGMA)\b/i.test(src);
    for (const dialect of DIALECTS) {
      const where = `${name} (${dialect})`, expect = typeof expects === 'string' ? expects : expects?.[dialect];
      // SQL is read as written, then written for each database
      const r = parse(src, sql, sql ? from : dialect);
      if (sql && from !== dialect) r.problems.push(...vm.runInContext('dialectProblems', ctx)(r.tables, dialect));
      const errors = r.problems.filter(p => p.level === 'error').map(p => p.msg);
      if (expect) {
        if (!errors.some(m => m.includes(expect))) fail(where, `expected the problem "${expect}", got ${JSON.stringify(errors)}`);
        continue;
      }
      if (errors.length) { fail(where, 'unexpected problems ' + JSON.stringify(errors)); continue; }
      const schema = ctx.genSQL(r.tables, dialect), script = schema + '\n' + await ctx.sampleInserts(r.tables, dialect);
      if (!sql && strip(toText(schema, dialect)) !== strip(textOf(src))) fail(where, 'SQL and back changed it:\n' + toText(schema, dialect));
      if (sql && strip(toText(schema, dialect)) !== strip(toText(src, from))) fail(where, 'SQL and back changed it:\n' + toText(schema, dialect));
      if (name === 'enum keeps its case' && !/'Small','Large'/.test(script)) fail(where, 'enum values changed case');
      if (/\b\w{65,}\b/.test(script.replace(/'[^']*'/g, ''))) fail(where, 'a name longer than 64 characters');
      if (!run[dialect]) continue;
      const res = dialect === 'mariadb'
        ? db(`DROP DATABASE IF EXISTS sqlviz_check; CREATE DATABASE sqlviz_check; USE sqlviz_check;\n${script}\nDROP DATABASE sqlviz_check;`)
        : spawnSync('sqlite3', ['-bail', ':memory:'], { input: script + '\nPRAGMA foreign_key_check;\n', encoding: 'utf8' });
      if (res.status || res.stderr.trim()) fail(where, res.stderr.trim() + '\n' + script);
      else if (dialect === 'sqlite' && res.stdout.trim()) fail(where, 'sample data breaks a foreign key: ' + res.stdout.trim());
    }
  }
  const ran = DIALECTS.filter(d => run[d]).map(d => d === 'sqlite' ? 'SQLite' : 'MariaDB');
  console.log(failures ? failures + ' problems' : `sql ok: ${Object.keys(all).length} schemas${ran.length ? ', run on ' + ran.join(' and ') : ''}`);
  process.exitCode = failures ? 1 : 0;
})();
