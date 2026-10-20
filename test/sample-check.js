'use strict';

// Checks the sample data of every example (js/examples.js) and of the schemas below, in
// every language: no key repeats, every foreign key value exists where it points,
// and values fit their columns.
// Run: node test/sample-check.js

const vm = require('vm');

const MORE = {
  'shop (en)': `Student
  Id
  FirstName
  LastName
  Email vc(100) unique
  BirthDate date
  Age int
  City
  Postcode
Teacher
  Id
  Name vc(100)
  Email
  Salary decimal(8,2)
  Title
Course
  Id
  Name vc(100)
  Code vc(10)
  Credits decimal(4,1)
  TeacherId -> Teacher
  unique (Name, Credits)
Enrollment
  StudentId -> Student
  CourseId -> Course
  EnrollmentDate date
  EndDate date null
  Grade int
  pk (StudentId, CourseId)
Product
  Id
  Name
  Brand
  Price decimal(6,2)
  Colour  # e.g. Red, Green, Blue
CustomerOrder
  Id
  OrderDate datetime
  ShippedDate date null
  CustomerName
OrderLine
  OrderId -> CustomerOrder
  ProductId -> Product
  Quantity tinyint
  UnitPrice decimal(6,2)
  Total decimal(8,2)
  pk (OrderId, ProductId)
Dog
  Id
  Name
  Breed
  Age tinyint
  OwnerId -> Owner
Owner
  Id
  Name
  Phone
  Address
`,
  'skola (sv)': `Elev
  Id
  Förnamn
  Efternamn
  Personnummer vc(13)
  Epost
  Postnummer
  Ort
Lärare
  Id
  Namn
  Lön int
Kurs
  Id
  Namn
  Kurskod vc(10)
  Poäng int
  LärarId -> Lärare
Betyg
  ElevId -> Elev
  KursId -> Kurs
  Betyg char(1)
  Datum date
  pk (ElevId, KursId)
Hundar
  Id
  Namn
  Ras
  Född date
  ÄgareId -> Hundägare
Hundägare
  Id
  Namn
  Telefon
  Adress
Produkt
  Id
  Benämning
  Styckpris decimal(8,2)
  Färg
  Kategori
Kundorder
  Id
  Kund
  Orderdatum date
  Leveransdatum date null
Orderrad
  OrderId -> Kundorder
  ProduktId -> Produkt
  Antal int
  Pris decimal(8,2)
  Summa decimal(10,2)
  pk (OrderId, ProduktId)
Lägenheter
  Id
  Namn
  Rum tinyint
  Yta int
  Hyra int
  Våning tinyint
Kommentar
  Id
  Text
  Skapad datetime
`,
  'keys': `Room
  Id
  Name vc(5)
  Capacity tinyint
  Size enum('small','large')
Seat
  Id
  RoomId -> Room
  Number tinyint
  unique (RoomId, Number)
Employee
  Id
  Name
  ManagerId null -> Employee
  DeskId unique null -> Desk
Desk
  Id
  Label  # e.g. A1, A2, B1, B2, C1, C2
Gizmo
  Id
  Name
  Weight decimal(3,1)
  Price decimal(4,2)
  Thing vc(3)
  Flag bool
  Released year
`,
};

const ctx = require('./load')({ process, MORE });
vm.runInContext(`
K = prepareKinds(SAMPLE_KINDS);
let failures = 0;
const fail = (where, msg) => { failures++; console.log('FAIL', where + ':', msg); };
for (const [name, src] of Object.entries({ ...EXAMPLES, ...MORE })) for (const chosen of [null, ...K.langs]) {
  state.sampleLang = chosen; // guessed, and each language chosen in the Data view
  const r = parseText(src);
  resolve(r.tables);
  for (const n of [SAMPLE_ROWS, 20]) {
    const data = sampleData(r.tables, n);
    for (const t of r.tables) {
      const rows = data.get(t), where = name + ' (' + sampleLang(r.tables) + ') ' + t.name;
      if (!rows.length && t.cols.length) fail(where, 'no rows');
      for (const set of uniqueSets(t)) {
        const keys = rows.map(row => tupleKey(row, set)).filter(k => k != null);
        if (new Set(keys).size !== keys.length) fail(where, 'repeated ' + set.map(c => c.name).join(', '));
      }
      for (const c of t.cols) {
        const ti = typeInfo(c);
        for (const row of rows) {
          const v = row.values.get(c);
          if (v == null) { if (!c.nullable) fail(where, c.name + ' is NULL'); continue; }
          if (c.target && !data.get(c.target).some(o => o.values.get(c.targetCol) === v)) fail(where, c.name + ' = ' + v + ' points nowhere');
          if (ti.len && v.length > ti.len) fail(where, c.name + ' = ' + v + ' is too long');
          if ((ti.int || ti.dec) && !/^-?\\d+(\\.\\d+)?$/.test(v)) fail(where, c.name + ' = ' + v + ' is not a number');
          if (ti.base === 'date' && !/^\\d{4}-\\d\\d-\\d\\d$/.test(v)) fail(where, c.name + ' = ' + v + ' is not a date');
        }
      }
    }
  }
}
console.log(failures ? failures + ' problems' : 'sample data ok: ' + Object.keys({ ...EXAMPLES, ...MORE }).length + ' schemas');
process.exitCode = failures ? 1 : 0;
`, ctx);
