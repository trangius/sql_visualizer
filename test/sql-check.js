'use strict';

// Checks the generated SQL: every example and the schemas below are turned into a script,
// with sample data, and run on a MariaDB server when a client is found (MYSQL=path/to/mysql,
// otherwise mysql on the PATH or XAMPP's). Schemas MariaDB would refuse must be reported
// as problems instead. Uses a database named sqlviz_check, made and dropped for each script.
// Run: node test/sql-check.js

const fs = require('fs'), path = require('path'), vm = require('vm'), { spawnSync } = require('child_process');
const js = f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8');

// Simple syntax or SQL (starts with CREATE), and the problem it must report, if any
const CASES = {
  'fk to a column without an index': [`Owner
  Id
  Email
Pet
  Id
  OwnerEmail -> Owner.Email
`],
  'fk to the second column of a key': [`OrderLine
  OrderNo int
  LineNo int
  pk (OrderNo, LineNo)
Shipment
  Id
  LineNo -> OrderLine.LineNo
`],
  'fk of another integer type': [`Owner
  Id
Pet
  Id
  OwnerId bigint -> Owner
`, 'OwnerId is bigint but Owner.Id is int'],
  'fk of another sign': [`Owner
  Id int unsigned
Pet
  Id
  OwnerId int -> Owner
`, 'OwnerId is int but Owner.Id is int unsigned'],
  'fk to a text column': [`Tag
  Id
  Body text unique
Note
  Id
  TagBody -> Tag.Body
`, "Tag.Body is text, which can't be part of a foreign key"],
  'fk between strings of different lengths': [`Country
  Code char(2) pk
City
  Id
  Country vc(2) -> Country
`],
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
};

function findClient() {
  for (const c of [process.env.MYSQL, 'mysql', 'mariadb', '/Applications/XAMPP/xamppfiles/bin/mysql'].filter(Boolean)) {
    if (!spawnSync(c, ['--version']).error) return c;
  }
  return null;
}
const client = findClient(), user = process.env.MYSQL_USER ?? 'root';
const db = sql => spawnSync(client, ['-u' + user, '--batch'], { input: sql, encoding: 'utf8' }); // a password goes in MYSQL_PWD

const ctx = { console, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, onSampleData() {}, state: { sampleLang: null } };
vm.createContext(ctx);
vm.runInContext(['model', 'sql', 'examples', 'sample/kinds', 'sample/en', 'sample/sv', 'sample'].map(js).join('\n') +
  '\nloadScript = async () => {}; // the sample files are already loaded', ctx);

(async () => {
  let failures = 0;
  const fail = (where, msg) => { failures++; console.log('FAIL', where + ':', msg); };
  const ping = client && db('SELECT 1'), run = ping && !ping.status;
  if (!client) console.log('No MariaDB client found: the scripts are only generated, not run.');
  else if (!run) console.log('Could not connect to MariaDB:', ping.stderr.trim());
  const all = { ...Object.fromEntries(Object.entries(vm.runInContext('EXAMPLES', ctx)).map(([k, v]) => [k, [v]])), ...CASES };
  for (const [name, [src, expect]] of Object.entries(all)) {
    const sql = /^\s*CREATE\b/i.test(src);
    const r = vm.runInContext('(src, sql) => { const r = sql ? parseSQL(src) : parseText(src); r.problems.push(...resolve(r.tables)); return r; }', ctx)(src, sql);
    const errors = r.problems.filter(p => p.level === 'error').map(p => p.msg);
    if (expect) {
      if (!errors.some(m => m.includes(expect))) fail(name, `expected the problem "${expect}", got ${JSON.stringify(errors)}`);
      continue;
    }
    if (errors.length) fail(name, 'unexpected problems ' + JSON.stringify(errors));
    const script = ctx.genSQL(r.tables) + '\n' + await ctx.sampleInserts(r.tables);
    if (name === 'enum keeps its case' && !script.includes("ENUM('Small','Large')")) fail(name, 'enum values changed case');
    if (/\b\w{65,}\b/.test(script.replace(/'[^']*'/g, ''))) fail(name, 'a name longer than 64 characters');
    if (!run) continue;
    const res = db(`DROP DATABASE IF EXISTS sqlviz_check; CREATE DATABASE sqlviz_check; USE sqlviz_check;\n${script}\nDROP DATABASE sqlviz_check;`);
    if (res.status) fail(name, res.stderr.trim() + '\n' + script);
  }
  console.log(failures ? failures + ' problems' : `sql ok: ${Object.keys(all).length} schemas${run ? ', run on MariaDB' : ''}`);
  process.exitCode = failures ? 1 : 0;
})();
