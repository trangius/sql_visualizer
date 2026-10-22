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
  'skole (no)': `# Skole
Elev
  Id
  Fornavn
  Etternavn
  Fødselsdato date
  Epost vc(100) unique
  Telefon vc(20)
  Adresse
  Postnummer vc(4)
  Poststed
Lærer
  Id
  Fornavn
  Etternavn
  Epost vc(100) unique
  Lønn int
Fag
  Id
  Navn vc(100)
Kurs
  Id
  Navn vc(100)
  Emnekode vc(10) unique
  Studiepoeng decimal(4,1)
  FagId -> Fag
  LærerId null -> Lærer
Påmelding
  ElevId -> Elev
  KursId -> Kurs
  Påmeldingsdato date
  Karakter char(1) null
  pk (ElevId, KursId)
`,
  'skole (da)': `# Skoledatabase
Elev
  Id
  Fornavn
  Efternavn
  Fødselsdato date
  CprNummer vc(11) unique
  Email vc(100) unique
  Telefon vc(11)
  Adresse
  Postnummer vc(4)
  By

Lærer
  Id
  Fornavn
  Efternavn
  Løn int
  Email vc(100) unique

Kursus
  Id
  Navn vc(100)
  Kursuskode vc(10) unique
  ECTS decimal(4,1)
  LærerId null -> Lærer [delete set null]
  LokaleId null -> Lokale

Lokale
  Id
  Navn vc(50)
  Pladser int
  Etage tinyint

# Hvilke elever går på hvilke kurser
Tilmelding
  ElevId -> Elev [delete cascade]
  KursusId -> Kursus [delete cascade]
  Tilmeldingsdato date
  Karakter vc(2) null
  pk (ElevId, KursusId)

Lærebog
  Id
  Titel
  Forfatter
  Udgivelsesår year
  Pris decimal(8,2)
  KursusId -> Kursus
`,
  'koulu (fi)': `# Koulu
Opettaja
  Id
  Etunimi
  Sukunimi
  Sahkoposti vc(100) unique
  Puhelin vc(20)
  Palkka decimal(8,2)

Oppilas
  Id
  Etunimi
  Sukunimi
  Henkilotunnus vc(11) unique
  Syntymaaika date
  Katuosoite
  Postinumero vc(5)
  Postitoimipaikka

Kurssi
  Id
  Nimi vc(100)
  Kurssikoodi vc(10)
  Opintopisteet int
  OpettajaId null -> Opettaja

Ilmoittautuminen
  OppilasId -> Oppilas
  KurssiId -> Kurssi
  Ilmoittautumispaiva date
  Arvosana int null
  pk (OppilasId, KurssiId)

Kirja
  Id
  Nimi vc(100)
  Kirjailija
  Julkaisuvuosi int
  Hinta decimal(6,2)
  KurssiId null -> Kurssi
`,
  'schule (de)': `# Schuldatenbank
Schüler
  Id
  Vorname
  Nachname
  Geburtsdatum date
  Versicherungsnummer vc(12) unique
  EMail vc(100) unique
  Telefon vc(20)
  Straße
  PLZ vc(5)
  Ort
  Bundesland

Lehrer
  Id
  Vorname
  Nachname
  Gehalt decimal(8,2)
  EMail vc(100) unique

Kurs
  Id
  Bezeichnung vc(100)
  Kurskürzel vc(10) unique
  Leistungspunkte decimal(4,1)
  LehrerId null -> Lehrer [delete set null]
  RaumId null -> Raum

Raum
  Id
  Bezeichnung vc(50)
  Sitzplätze int
  Stockwerk tinyint

# Welche Schüler welche Kurse belegen
Anmeldung
  SchülerId -> Schüler [delete cascade]
  KursId -> Kurs [delete cascade]
  Anmeldedatum date
  Note tinyint null
  pk (SchülerId, KursId)

Lehrbuch
  Id
  Titel
  Autor
  Erscheinungsjahr year
  Preis decimal(8,2)
  KursId -> Kurs
`,
  'ecole (fr)': `# Ecole
Professeur
  Id
  Prenom
  Nom
  Courriel vc(100) unique
  Telephone vc(20)
  Salaire decimal(8,2)

Eleve
  Id
  Prenom
  Nom
  DateNaissance date
  NumeroSecu char(15) unique
  Adresse
  CodePostal char(5)
  Ville

Matiere
  Id
  Libelle vc(100)

Cours
  Id
  Intitule vc(100)
  CodeCours vc(10) unique
  CreditsEcts int
  MatiereId -> Matiere
  ProfesseurId null -> Professeur

Inscription
  EleveId -> Eleve
  CoursId -> Cours
  DateInscription date
  Note decimal(4,2) null
  pk (EleveId, CoursId)

Manuel
  Id
  Titre vc(100)
  Auteur
  AnneeParution int
  Prix decimal(6,2)
  CoursId null -> Cours
`,
  'escuela (es)': `# Base de datos del colegio
Alumno
  Id
  Nombre
  Apellidos
  FechaNacimiento date
  DNI vc(9) unique
  Correo vc(100) unique
  Teléfono vc(11)
  Dirección
  CodigoPostal vc(5)
  Ciudad

Profesor
  Id
  Nombre
  Apellidos
  Sueldo decimal(8,2)
  Correo vc(100) unique

Curso
  Id
  Nombre vc(100)
  Código vc(10) unique
  Créditos decimal(4,1)
  ProfesorId null -> Profesor [delete set null]
  AulaId null -> Aula

Aula
  Id
  Nombre vc(50)
  Capacidad int
  Planta tinyint

# Qué alumnos están en qué cursos
Matrícula
  AlumnoId -> Alumno [delete cascade]
  CursoId -> Curso [delete cascade]
  FechaMatricula date
  Nota decimal(4,2) null
  pk (AlumnoId, CursoId)

Libro
  Id
  Título
  Autor
  AñoPublicación year
  Precio decimal(8,2)
  CursoId -> Curso
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
// a schema named "… (sv)" is written in that language, and the guess must say so
for (const [name, src] of Object.entries(MORE)) {
  const want = name.match(/\((\w+)\)$/)?.[1];
  if (!want) continue;
  const r = parseText(src);
  resolve(r.tables);
  if (schemaLang(r.tables) !== want) fail(name, 'guessed ' + schemaLang(r.tables));
}
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
