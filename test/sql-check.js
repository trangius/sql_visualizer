'use strict';

// Checks the generated SQL: every example and the schemas below are turned into a script for
// each database, with sample data, and run where a client is found (a database named
// sqlviz_check is made and dropped for each script):
//   MariaDB     MYSQL=path/to/mysql, otherwise mysql or mariadb on the PATH, or XAMPP's; MYSQL_USER (root)
//   MySQL       MYSQL8=path/to/its mysql and MYSQL8_SOCKET, as root without a password
//   SQLite      sqlite3, in memory
//   PostgreSQL  psql, as the current user
//   SQL Server  sqlcmd (or /opt/mssql-tools18/bin/sqlcmd) as sa, with the password in SQLCMDPASSWORD
//   Oracle      SQLPLUS=path/to/sqlplus, as SYSTEM with the password in ORACLE_PWD, on //localhost/FREEPDB1;
//               each script runs as a new user, sqlviz_check
// What a database would refuse must be reported as a problem instead. Reading a generated
// script back and writing it again must give the same script, and for MariaDB and SQLite
// the same Simple text. test/linux-setup.sh installs five of them on Ubuntu, test/oracle-setup.sh
// Oracle on Oracle Linux.
// Run: node test/sql-check.js

const fs = require('fs'), path = require('path'), vm = require('vm'), { spawnSync } = require('child_process');

// Simple syntax or SQL (MariaDB's unless a third item says which), and the problem it must
// report, if any: the same for every database, or { mariadb, sqlite, postgres, mssql }
const CASES = {
  'indexes': [`Order
  Id
  CustomerId int index
  Created datetime
  Total int
  index (CustomerId, Created, Total)
`],
  'fk to a column without an index': [`Owner
  Id
  Email
Pet
  Id
  OwnerEmail -> Owner.Email
`, { oracle: 'Oracle needs Owner.Email', mysql: 'MySQL needs Owner.Email', sqlite: 'SQLite needs Owner.Email to be the primary key or unique', postgres: 'PostgreSQL needs Owner.Email', mssql: 'SQL Server needs Owner.Email' }],
  'fk to the second column of a key': [`OrderLine
  OrderNo int
  LineNo int
  pk (OrderNo, LineNo)
Shipment
  Id
  LineNo -> OrderLine.LineNo
`, { oracle: 'Oracle needs OrderLine.LineNo', mysql: 'MySQL needs OrderLine.LineNo', sqlite: 'SQLite needs OrderLine.LineNo', postgres: 'PostgreSQL needs', mssql: 'SQL Server needs' }],
  'fk of another integer type': [`Owner
  Id
Pet
  Id
  OwnerId bigint -> Owner
`, { mariadb: 'OwnerId is bigint but Owner.Id is int', mysql: 'OwnerId is bigint but Owner.Id is int', mssql: 'SQL Server needs the same type' }],
  'fk of another sign': [`Owner
  Code int unsigned pk
Pet
  Id
  OwnerCode int -> Owner
`, { mariadb: 'OwnerCode is int but Owner.Code is int unsigned', mysql: 'OwnerCode is int but Owner.Code is int unsigned', mssql: 'SQL Server needs the same type' }],
  'fk to a text column': [`Tag
  Id
  Body text unique
Note
  Id
  TagBody -> Tag.Body
`, { mariadb: "Tag.Body is text, which can't be part of a foreign key", mysql: "MySQL can't make a key or index of Body", oracle: "Oracle can't make a key or index of Body", mssql: "SQL Server can't make a key or index of Body" }],
  'fk between strings of different lengths': [`Country
  Code char(2) pk
City
  Id
  Country vc(2) -> Country
`, { mssql: 'SQL Server needs the same type', oracle: "Oracle can't link them" }],
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
`, { mssql: 'SQL Server refuses [delete set null] here', oracle: 'Oracle has no [update cascade]' }],
  'cascades': [`Owner
  Id
  Name
Pet
  Id
  OwnerId -> Owner [delete cascade, update cascade]
  Born date [default now]
Visit
  Id
  PetId -> Pet [delete cascade]
  At datetime [default now]
  Paid bool [default false]
  Fee decimal(6,2) [default 0]
`, { oracle: 'Oracle has no [update cascade]' }],
  'cascade to itself': [`Person
  Id
  ParentId null -> Person [delete set null]
`, { mssql: 'SQL Server refuses [delete set null] here' }],
  'every type': [`Thing
  Id
  A tinyint
  B smallint
  C mediumint
  D bigint
  E int unsigned
  F decimal(8,2)
  G float
  H double
  I bool
  J char(3)
  K vc(40)
  L text
  M date
  N datetime
  O timestamp
  P time
  Q year
  R enum('x','y')
  S json null
  T uuid null
  U blob null
  V bit
  W vc(5000) null
`],
  'unique columns that may be null': [`Person
  Id
  Email vc(60) null unique
  Code vc(5) null
  Nick vc(20) null
  unique (Code, Nick)
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
`, { oracle: 'Oracle needs', mysql: 'MySQL needs', sqlite: 'SQLite needs', postgres: 'PostgreSQL needs', mssql: 'SQL Server needs' }],
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
CREATE INDEX ix_name2 ON "Order" (AuthorId);`, { oracle: "Oracle can't make a key or index of Name", mysql: "MySQL can't make a key or index of Name", mssql: "SQL Server can't make a key or index of Name" }, 'sqlite'],
  'PostgreSQL script': [`SET statement_timeout = 0;
SELECT pg_catalog.set_config('search_path', '', false);
CREATE TABLE public.author (
    id integer NOT NULL GENERATED BY DEFAULT AS IDENTITY,
    name character varying(100) NOT NULL,
    bio text,
    born date DEFAULT CURRENT_DATE,
    active boolean DEFAULT true NOT NULL,
    data jsonb
);
ALTER TABLE public.author OWNER TO postgres;
ALTER TABLE ONLY public.author ADD CONSTRAINT author_pkey PRIMARY KEY (id);
CREATE TABLE public.book (
    id serial PRIMARY KEY,
    title character varying(200) NOT NULL,
    author_id integer REFERENCES public.author(id) ON DELETE CASCADE,
    price numeric(8,2) DEFAULT 0.00,
    added timestamp with time zone DEFAULT now(),
    weight double precision
);
CREATE INDEX book_title_idx ON public.book USING btree (title);`, null, 'postgres'],
  'SQL Server script': [`SET ANSI_NULLS ON
GO
CREATE TABLE [dbo].[Customer](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Name] [nvarchar](100) NOT NULL,
	[Email] [nvarchar](200) NULL,
	[Created] [datetime2](7) NOT NULL,
	[Vip] [bit] NOT NULL,
 CONSTRAINT [PK_Customer] PRIMARY KEY CLUSTERED ([Id] ASC) WITH (PAD_INDEX = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
CREATE TABLE [dbo].[Order](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[CustomerId] [int] NOT NULL,
	[Note] [nvarchar](max) NULL,
	[Total] [money] NOT NULL,
 CONSTRAINT [PK_Order] PRIMARY KEY CLUSTERED ([Id] ASC)
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
ALTER TABLE [dbo].[Customer] ADD  CONSTRAINT [DF_Customer_Created]  DEFAULT (getdate()) FOR [Created]
GO
ALTER TABLE [dbo].[Customer] ADD  DEFAULT ((0)) FOR [Vip]
GO
ALTER TABLE [dbo].[Order]  WITH CHECK ADD  CONSTRAINT [FK_Order_Customer] FOREIGN KEY([CustomerId])
REFERENCES [dbo].[Customer] ([Id])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[Order] CHECK CONSTRAINT [FK_Order_Customer]
GO`, null, 'mssql'],
};

function findClient() {
  for (const c of [process.env.MYSQL, 'mysql', 'mariadb', '/Applications/XAMPP/xamppfiles/bin/mysql'].filter(Boolean)) {
    if (!spawnSync(c, ['--version']).error) return c;
  }
  return null;
}
const has = c => !spawnSync(c, ['-?']).error;
const sqlcmd = ['sqlcmd', '/opt/mssql-tools18/bin/sqlcmd'].find(has);
const client = findClient(), sqlite = has('sqlite3'), psql = has('psql'), user = process.env.MYSQL_USER ?? 'root';
const db = sql => spawnSync(client, ['-u' + user, '--batch'], { input: sql, encoding: 'utf8' }); // a password goes in MYSQL_PWD

const ctx = require('./load')();
const DIALECTS = vm.runInContext('DIALECTS', ctx), DBS = Object.keys(DIALECTS), NAME = d => DIALECTS[d].name;
const LOSSY = new Set(['every type']); // types written another way: uuid is CHAR(36) in MariaDB
const parse = vm.runInContext(`(src, sql, dialect) => {
  const r = sql ? parseSQL(src, dialect) : parseText(src);
  r.problems.push(...resolve(r.tables), ...dialectProblems(r.tables, dialect));
  return r;
}`, ctx);
const toText = vm.runInContext('(sql, dialect) => sqlToText(sql, false, dialect)', ctx);
const regen = vm.runInContext('(sql, dialect) => { const r = parseSQL(sql, dialect); resolve(r.tables); return genSQL(r.tables, dialect); }', ctx);
const textOf = vm.runInContext('(src) => { const r = parseText(src); resolve(r.tables); return genText(r.tables, []); }', ctx);
const strip = t => t.replace(/#.*$/gm, '').replace(/[ \t]+$/gm, '').trim().split(/\n\n+/).sort().join('\n\n'); // the SQL orders tables by their keys

// Runs a script in a fresh database; { status, out } with what went wrong
const tmp = path.join(require('os').tmpdir(), 'sqlviz_check.sql');
const RUN = {
  mariadb: script => db(`DROP DATABASE IF EXISTS sqlviz_check; CREATE DATABASE sqlviz_check; USE sqlviz_check;\n${script}\nDROP DATABASE sqlviz_check;`),
  mysql: script => spawnSync(process.env.MYSQL8, ['-uroot', '--socket=' + process.env.MYSQL8_SOCKET, '--batch'], { input:
    `DROP DATABASE IF EXISTS sqlviz_check; CREATE DATABASE sqlviz_check; USE sqlviz_check;\n${script}\nDROP DATABASE sqlviz_check;`, encoding: 'utf8' }),
  sqlite: script => spawnSync('sqlite3', ['-bail', ':memory:'], { input: script + '\nPRAGMA foreign_key_check;\n', encoding: 'utf8' }),
  postgres: script => {
    const env = { ...process.env, PGOPTIONS: '-c client_min_messages=warning' }; // not the NOTICEs of DROP TABLE IF EXISTS
    const ps = (d, input) => spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', d], { input, encoding: 'utf8', env });
    const made = ps('postgres', 'DROP DATABASE IF EXISTS sqlviz_check;\nCREATE DATABASE sqlviz_check;\n');
    return made.status ? made : ps('sqlviz_check', script);
  },
  mssql: script => {
    const sc = args => spawnSync(sqlcmd, ['-S', 'localhost', '-U', 'sa', '-C', '-b', '-I', '-l', '60', '-f', '65001', ...args], { encoding: 'utf8' });
    const made = sc(['-Q', "IF DB_ID('sqlviz_check') IS NOT NULL DROP DATABASE sqlviz_check; CREATE DATABASE sqlviz_check;"]);
    if (made.status) return made;
    fs.writeFileSync(tmp, script);
    const res = sc(['-d', 'sqlviz_check', '-i', tmp]);
    return { status: res.status, stderr: res.status ? res.stdout + res.stderr : '' }; // sqlcmd writes its errors to stdout
  },
  oracle: script => {
    const at = '@//localhost:1521/FREEPDB1', pw = process.env.ORACLE_PWD;
    // DEFINE OFF: & in the sample data is text, not a variable to ask for
    const sp = (login, input) => spawnSync(process.env.SQLPLUS, ['-S', '-L', login], { encoding: 'utf8',
      input: `SET DEFINE OFF\nWHENEVER SQLERROR EXIT FAILURE\n${input}\nEXIT\n`, env: { ...process.env, NLS_LANG: '.AL32UTF8' } });
    const made = sp(`system/${pw}${at}`, `DROP USER IF EXISTS sqlviz_check CASCADE;\nCREATE USER sqlviz_check IDENTIFIED BY "${pw}" QUOTA UNLIMITED ON USERS;\nGRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE TO sqlviz_check;`);
    const res = made.status ? made : sp(`sqlviz_check/"${pw}"${at}`, script);
    return { status: res.status, stderr: res.status ? res.stdout + res.stderr : '' }; // sqlplus writes its errors to stdout
  },
};

(async () => {
  let failures = 0;
  const fail = (where, msg) => { failures++; console.log('FAIL', where + ':', msg); };
  const ping = client && db('SELECT 1');
  const run = { mariadb: ping && !ping.status, mysql: !!process.env.MYSQL8 && has(process.env.MYSQL8), sqlite, postgres: psql, mssql: !!sqlcmd && !!process.env.SQLCMDPASSWORD,
    oracle: !!process.env.SQLPLUS && !!process.env.ORACLE_PWD };
  for (const d of DBS) if (!run[d]) console.log(`${NAME(d)}: no server or client found, its scripts are only generated, not run.`);
  const only = process.argv[2]; // a part of a schema's name, to check just those
  const all = Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(vm.runInContext('EXAMPLES', ctx)).map(([k, v]) => [k, [v]])), ...CASES })
    .filter(([k]) => !only || k.includes(only)));
  for (const [name, [src, expects, from = 'mariadb']] of Object.entries(all)) {
    const sql = /^\s*(CREATE|PRAGMA|SET)\b/i.test(src);
    for (const dialect of DBS) {
      const where = `${name} (${NAME(dialect)})`, expect = typeof expects === 'string' ? expects : expects?.[dialect];
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
      if (regen(schema, dialect) !== schema) fail(where, 'reading the script and writing it again changed it:\n' + regen(schema, dialect));
      if (!sql && ['mariadb', 'mysql', 'sqlite'].includes(dialect) && !LOSSY.has(name) && strip(toText(schema, dialect)) !== strip(textOf(src))) {
        fail(where, 'SQL and back changed it:\n' + toText(schema, dialect));
      }
      if (name === 'enum keeps its case' && !/'Small','Large'/.test(script)) fail(where, 'enum values changed case');
      const max = vm.runInContext(`dialectOf('${dialect}').maxName`, ctx);
      if (new RegExp(`\\b\\w{${max + 1},}\\b`).test(script.replace(/'[^']*'/g, ''))) fail(where, `a name longer than ${max} characters`);
      if (!run[dialect]) continue;
      const res = RUN[dialect](script);
      if (res.status || res.stderr?.trim()) fail(where, res.stderr.trim() + '\n' + script);
      else if (dialect === 'sqlite' && res.stdout.trim()) fail(where, 'sample data breaks a foreign key: ' + res.stdout.trim());
    }
  }
  const ran = DBS.filter(d => run[d]).map(NAME);
  console.log(failures ? failures + ' problems' : `sql ok: ${Object.keys(all).length} schemas${ran.length ? ', run on ' + ran.join(', ') : ''}`);
  process.exitCode = failures ? 1 : 0;
})();
