'use strict';

// ─── Data helpers ────────────────────────────────────────────────────────────
// Explicit rows from @data blocks. Tables without an @data block stay empty.

// Seeded randomness: the same key always gives the same number in [0, 1)
function rand(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (list, key) => list[Math.floor(rand(key) * list.length)];
// The i-th item of a seeded shuffle: different rows get different items while the list lasts
const nth = (list, key, i) => [...list].map((v, j) => [rand(key + j), v]).sort((a, b) => a[0] - b[0])[i % list.length][1];
const between = (lo, hi, key) => lo + Math.floor(rand(key) * (hi - lo + 1));
const digits = (n, key) => Array.from({ length: n }, (_, i) => between(0, 9, key + i)).join('');
const pad2 = n => String(n).padStart(2, '0');

// Word lists: [English, Swedish]
const W = {
  first: [['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Lucas', 'Mia', 'Ethan', 'Sophia', 'Oliver', 'Isla', 'Jack'],
    ['Alice', 'Elsa', 'Maja', 'Astrid', 'Wilma', 'Oscar', 'William', 'Hugo', 'Elias', 'Saga', 'Nils', 'Ebba']],
  last: [['Smith', 'Johnson', 'Brown', 'Taylor', 'Wilson', 'Davies', 'Evans', 'Clark', 'Walker', 'Hall'],
    ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Lindberg']],
  city: [['London', 'Manchester', 'Leeds', 'Bristol', 'York', 'Oxford', 'Cambridge'],
    ['Stockholm', 'Göteborg', 'Malmö', 'Uppsala', 'Umeå', 'Lund', 'Västerås', 'Örebro']],
  street: [['Main Street', 'High Street', 'Park Road', 'Church Lane', 'Mill Road', 'Station Road'],
    ['Storgatan', 'Kungsgatan', 'Drottninggatan', 'Skolgatan', 'Kyrkvägen', 'Parkvägen']],
  country: [['Sweden', 'Norway', 'Denmark', 'Finland', 'Germany', 'France'],
    ['Sverige', 'Norge', 'Danmark', 'Finland', 'Tyskland', 'Frankrike']],
  color: [['red', 'blue', 'green', 'black', 'white', 'yellow'], ['röd', 'blå', 'grön', 'svart', 'vit', 'gul']],
  gender: [['female', 'male', 'other'], ['kvinna', 'man', 'annan']],
  job: [['Developer', 'Teacher', 'Manager', 'Designer', 'Analyst', 'Nurse'],
    ['Utvecklare', 'Lärare', 'Chef', 'Designer', 'Analytiker', 'Sjuksköterska']],
  book: [['The Silent Sea', 'Winter Light', 'Night Train', 'The Last Garden', 'Paper Moon', 'Salt and Stone'],
    ['Tyst hav', 'Vinterljus', 'Nattåg', 'Den sista trädgården', 'Pappersmånen', 'Salt och sten']],
  text: [['Works well.', 'Needs a follow-up.', 'Ordered online.', 'Very popular.', 'Bought as a gift.', 'Check again next week.'],
    ['Fungerar bra.', 'Behöver följas upp.', 'Beställd på nätet.', 'Mycket populär.', 'Köpt som present.', 'Kolla igen nästa vecka.']],
  postcode: [['SW1A 1AA', 'M1 1AE', 'LS1 4AP', 'BS1 5TR', 'OX1 2JD'], null],
};

// Names for things, chosen by what the table (or the column's prefix) is about
const THINGS = [
  [/course|subject|kurs|ämne|amne/, ['Mathematics', 'History', 'Biology', 'Chemistry', 'English', 'Physics', 'Art', 'Music'],
    ['Matematik', 'Historia', 'Biologi', 'Kemi', 'Svenska', 'Fysik', 'Bild', 'Musik']],
  [/categor|genre|kategori/, ['Clothes', 'Shoes', 'Accessories', 'Sports', 'Outdoor'],
    ['Kläder', 'Skor', 'Accessoarer', 'Sport', 'Friluft']],
  [/status|state|tillstånd/, ['New', 'Pending', 'Shipped', 'Delivered', 'Cancelled'],
    ['Ny', 'Väntar', 'Skickad', 'Levererad', 'Avbruten']],
  [/breed|race|ras$/, ['Labrador', 'Beagle', 'Poodle', 'Border Collie', 'Dachshund', 'Boxer'],
    ['Labrador', 'Beagle', 'Pudel', 'Border collie', 'Tax', 'Boxer']],
  [/dog|^pets?$|^cats?$|animal|hund|katt|djur/, ['Bella', 'Max', 'Luna', 'Charlie', 'Molly', 'Rocky'],
    ['Sixten', 'Ludde', 'Bamse', 'Molly', 'Stella', 'Doris']],
  [/product|item|article|artikel|vara|varor|produkt|plagg/, ['T-shirt', 'Jeans', 'Hoodie', 'Sneakers', 'Jacket', 'Scarf', 'Cap'],
    ['T-shirt', 'Jeans', 'Luvtröja', 'Sneakers', 'Jacka', 'Halsduk', 'Keps']],
  [/compan|supplier|brand|företag|foretag|leverantör|leverantor|märke|marke/, ['Acme Ltd', 'Northwind', 'Contoso', 'Globex', 'Initech'],
    ['Nordbolaget AB', 'Svea Handel AB', 'Fjällbo AB', 'Kustfrakt AB', 'Solberg & Co']],
  [/department|dept|avdelning/, ['Sales', 'IT', 'Finance', 'HR', 'Marketing'], ['Försäljning', 'IT', 'Ekonomi', 'HR', 'Marknad']],
  [/school|skola/, ['Northside School', 'Riverside Academy', 'Hill Park School', 'Oak Grove School'],
    ['Norrskolan', 'Ekbackeskolan', 'Sjöviksskolan', 'Tallåsskolan']],
  [/project|projekt/, ['Website', 'Mobile app', 'Data warehouse', 'Intranet', 'CRM upgrade'],
    ['Webbplats', 'Mobilapp', 'Datalager', 'Intranät', 'Nytt CRM']],
  [/building|property|house|fastighet|byggnad|hus/, ['Oak House', 'Elm Court', 'Birch Hall', 'Pine Lodge', 'Ash Row'],
    ['Eken', 'Björken', 'Tallen', 'Linden', 'Aspen']],
  [/team|club|group|klubb|grupp|lag$/, ['Tigers', 'Eagles', 'Wolves', 'Sharks', 'Bears'],
    ['Tigrarna', 'Örnarna', 'Vargarna', 'Hajarna', 'Björnarna']],
  [/event|show|competition|utställning|utstallning|tävling|tavling/, ['Spring Show', 'Summer Cup', 'Autumn Fair', 'Winter Open'],
    ['Vårutställningen', 'Sommarcupen', 'Höstmässan', 'Vinterträffen']],
  [/city|town|stad|ort$/, W.city[0], W.city[1]],
  [/country|land$/, W.country[0], W.country[1]],
];
const PERSON = /student|pupil|teacher|owner|customer|client|employee|person|user|member|author|tenn?ant|janitor|caretaker|vaktmästare|patient|guest|staff|manager|contact|driver|player|judge|landlord|actor|elev|lärare|larare|ägare|agare|kund|anställd|anstalld|användare|anvandare|medlem|författare|forfattare|hyresgäst|hyresgast|gäst|gast|personal|chef|kontakt|förare|forare|spelare|domare|hyresvärd|hyresvard|mentor|coach|tränare|tranare/;
const SWEDISH = /[åäö]|namn|adress|stad|pris|datum|telefon|epost|född|fodd|elev|lärare|larare|kurs|kund|ägare|agare|hund|betyg|antal|beskrivning|avdelning|lön|postnummer|titel|färg|farg|storlek|vara|hyra|projekt|anställd|anstalld|utställning|lägenhet|lagenhet|klädaffär|företag/;

const low = s => s.toLowerCase();
const plain = s => low(s).replace(/[_\s-]/g, '');
const ascii = s => low(s).replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/é/g, 'e').replace(/[^a-z0-9]/g, '');

// What kind of column is this? First by name, then null (the type decides)
function columnKind(c) {
  const rules = [
    ['email', /e?mail|epost/], ['first', /^(first|fore|given)name|^fname|förnamn|fornamn/],
    ['last', /(last|sur|family)name|^lname|efternamn/], ['user', /username|login|användarnamn|anvandarnamn/],
    ['password', /password|lösenord|losenord|hash/], ['ssn', /^ssn$|person(al)?(nummer|nr|number)|^pnr$/],
    ['phone', /phone|telefon|mobile|mobil|^tel$|cell/], ['postcode', /zip|postal|postcode|postnr|postnummer/],
    ['address', /address|adress|street|gata/], ['city', /^(city|town|stad|ort|postort|hemstad|hometown)$/], ['country', /country$|^land$/],
    ['url', /url|website|webb|hemsida|homepage/], ['title', /title|titel|rubrik/],
    ['birth', /born|birth|dob|född|fodd/], ['year', /year|^år$|årtal|artal/],
    ['end', /^(end|slut|finish)|deadline|(end|slut)(date|datum)$/], ['date', /date|datum|created|updated|when|^start/],
    ['age', /^age$|ålder|alder/], ['credits', /credit|^hp$|högskolepoäng/],
    ['salary', /salary|lön$|^lon$|wage/], ['rent', /^(monthly)?rent|hyra/],
    ['money', /price|pris|cost|kostnad|amount|belopp|avgift|total|summa|balance|saldo/],
    ['qty', /quantity|qty|antal|count|stock|lager|^nr|^num/], ['grade', /grade|betyg/], ['score', /score|points|poäng|poang/],
    ['gender', /gender|kön|^kon$|^sex$/], ['color', /colou?r|färg|farg/], ['size', /size|storlek/],
    ['weight', /weight|vikt/], ['height', /height|längd|langd/], ['room', /room|^rum$|^sal$|classroom/],
    ['code', /code|kod|sku|isbn/], ['text', /description|beskrivning|comment|kommentar|note|anteckning|^text$|info|bio|content|innehåll|reason|orsak/],
    ['bool', /^(is|has|can)[A-ZÅÄÖ_]|^(active|aktiv|done|klar)$/],
    ['name', /name$|namn$/],
  ];
  for (const [k, re] of rules) if (re.test(k === 'bool' ? c.name : plain(c.name))) return k;
  return null;
}

function typeInfo(c) {
  const t = c.effType, base = t.split(/[ (]/)[0];
  const len = +(t.match(/^(?:vc|char|varchar)\((\d+)\)/)?.[1] ?? (base === 'vc' ? DEFAULT_VC : base === 'char' ? 1 : 0));
  return {
    base,
    len,
    int: INT_TYPES.has(base) || base === 'year',
    bool: base === 'bool' || base === 'boolean' || /^tinyint\(1\)/.test(t) || base === 'bit',
    dec: /^(decimal|dec|numeric|fixed|float|double|real)$/.test(base),
    options: base === 'enum' || base === 'set' ? [...t.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'")) : null,
  };
}
// Is a column's value written without quotes in SQL?
const isNumeric = c => { const ti = typeInfo(c); return ti.int || ti.bool || ti.dec; };

const dateStr = (y0, y1, key) => `${between(y0, y1, key + 'y')}-${pad2(between(1, 12, key + 'm'))}-${pad2(between(1, 28, key + 'd'))}`;
const timeStr = key => `${pad2(between(8, 17, key + 'h'))}:${pad2(between(0, 3, key + 'n') * 15)}:00`;

// One value (a string, or null) for column c of table t in row i, within the column's length
function sampleValue(t, c, i, sv, person) {
  const s = anyLengthValue(t, c, i, sv, person), n = typeInfo(c).len;
  return s != null && n ? s.slice(0, n) : s;
}
function anyLengthValue(t, c, i, sv, person) {
  const key = `${t.name}.${c.name}.${i}`, L = sv ? 1 : 0, ti = typeInfo(c);
  const kind = columnKind(c);
  const int = (lo, hi) => String(between(lo, hi, key));
  // money: whole numbers for an int column, else two decimals (also in a varchar, the default type)
  const money = (lo, hi) => ti.int ? String(between(lo, hi, key)) : (between(lo * 100, hi * 100, key) / 100).toFixed(2);
  if (ti.options) return ti.options.length ? pick(ti.options, key) : '';
  if (ti.bool || kind === 'bool') return String(between(0, 1, key));
  if (/^(date|datetime|timestamp|time)$/.test(ti.base)) {
    const d = kind === 'birth' ? dateStr(1960, 2008, key) : kind === 'end' ? dateStr(2024, 2025, key) : dateStr(2022, 2023, key);
    return ti.base === 'date' ? d : ti.base === 'time' ? timeStr(key) : `${d} ${timeStr(key)}`;
  }
  switch (kind) {
    case 'email': return `${ascii(person.first)}.${ascii(person.last)}@example.com`;
    case 'first': return person.first;
    case 'last': return person.last;
    case 'user': return ascii(person.first) + between(1, 99, key);
    case 'password': return Array.from({ length: 16 }, (_, j) => '0123456789abcdef'[between(0, 15, key + j)]).join('');
    case 'ssn': return `${dateStr(1960, 2008, key).replace(/-/g, '')}-${digits(4, key)}`;
    case 'phone': return sv ? `07${between(0, 9, key)}-${digits(3, key + 'a')} ${digits(2, key + 'b')} ${digits(2, key + 'c')}` : `07${digits(3, key)} ${digits(6, key + 'a')}`;
    case 'postcode': return sv ? `${between(100, 989, key)} ${digits(2, key)}` : pick(W.postcode[0], key);
    case 'address': return sv ? `${pick(W.street[1], key)} ${between(1, 80, key + 'n')}` : `${between(1, 80, key + 'n')} ${pick(W.street[0], key)}`;
    case 'city': return pick(W.city[L], key);
    case 'country': return pick(W.country[L], key);
    case 'url': return `https://example.com/${ascii(t.name)}/${i + 1}`;
    case 'title': return nth(PERSON.test(low(t.name)) ? W.job[L] : W.book[L], `${t.name}.${c.name}`, i);
    case 'color': return pick(W.color[L], key);
    case 'gender': return pick(W.gender[L], key);
    case 'text': return pick(W.text[L], key);
    case 'size': return pick(['XS', 'S', 'M', 'L', 'XL'], key);
    case 'room': return ti.int ? int(101, 320) : pick('ABC', key + 'r') + between(101, 320, key);
    case 'code': return ti.int ? int(1000, 9999) : pick('ABCDEFGH', key + 'a') + pick('KLMNPRST', key + 'b') + digits(4, key);
    case 'birth': return ti.int ? int(1960, 2008) : dateStr(1960, 2008, key);
    case 'date': return ti.int ? int(2022, 2023) : dateStr(2022, 2023, key);
    case 'end': return ti.int ? int(2024, 2025) : dateStr(2024, 2025, key);
    case 'year': return int(1995, 2025);
    case 'age': return PERSON.test(low(t.name)) ? int(18, 80) : int(1, 15);
    case 'credits': return pick(['5', '10', '15', '30'], key);
    case 'salary': return money(25000, 60000);
    case 'rent': return money(5000, 15000);
    case 'money': return money(5, 2000);
    case 'qty': return int(1, 20);
    case 'grade': return ti.int || ti.dec ? int(1, 5) : pick(['A', 'B', 'C', 'D', 'E', 'F'], key);
    case 'score': return int(0, 100);
    case 'weight': return ti.int ? int(2, 40) : (between(20, 400, key) / 10).toFixed(1);
    case 'height': return int(150, 195);
  }
  if (ti.int) return int(1, 100);
  if (ti.dec) return (between(100, 99999, key) / 100).toFixed(2);
  let s;
  switch (kind) {
    case 'name': {
      const prefix = low(c.name).replace(/_?(name|namn)$/, '');
      const about = prefix || low(t.name);
      const thing = THINGS.find(([re]) => re.test(about));
      if (thing) s = nth(thing[1 + L], `${t.name}.${c.name}`, i);
      else if (PERSON.test(about)) s = `${person.first} ${person.last}`;
      else s = `${t.name} ${i + 1}`;
      break;
    }
    default:
      s = `${c.name} ${i + 1}`;
  }
  return s;
}

// Sample rows for every table: Map table → [{ values: Map column → string | null }]
const sampleCache = new WeakMap();
function sampleData(tables) {
  if (sampleCache.has(tables)) return sampleCache.get(tables);
  const data = new Map();
  // Use rows written in the @data block. Values are mapped by column order,
  // which keeps the text format compact and predictable.
  for (const t of tables) {
    if (t.dataRows?.length) {
      data.set(t, t.dataRows.map(row => ({
        values: new Map(t.cols.map((c, i) => [c, row.values[i] ?? null])),
      })));
    } else data.set(t, []);
  }
  // Explicit rows are never rewritten. This keeps the Data view faithful to the
  // text, including foreign-key values that are intentionally NULL or incomplete.
  const done = new Set(), busy = new Set();
  const finish = t => {
    if (done.has(t) || busy.has(t)) return;
    if (t.dataRows?.length) { done.add(t); return; }
    busy.add(t);
    for (const c of t.cols) if (c.target && c.target !== t) finish(c.target);
    const rows = data.get(t), multiPk = t.pkCols.length > 1, keys = new Set();
    const kept = [];
    rows.forEach((r, i) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        for (const c of t.cols) {
          if (!c.target) continue;
          const key = `${t.name}.${c.name}.${i}.${attempt}`;
          let pool = data.get(c.target).map(o => o.values.get(c.targetCol)).filter(v => v != null);
          if (c.target === t) pool = pool.filter(v => v !== r.values.get(c.targetCol)); // not itself
          if (c.unique) pool = pool.filter(v => !kept.some(o => o.values.get(c) === v));
          const none = !pool.length || (c.nullable && rand(key + 'null') < 0.2);
          r.values.set(c, none ? null : pick(pool, key));
        }
        const k = t.pkCols.map(c => r.values.get(c)).join('\u0000');
        const bad = t.cols.some(c => c.target && !c.nullable && r.values.get(c) == null);
        if (!bad && (!multiPk || !keys.has(k))) { keys.add(k); kept.push(r); break; }
      }
    });
    data.set(t, kept);
    busy.delete(t);
    done.add(t);
  };
  tables.forEach(finish);
  sampleCache.set(tables, data);
  return data;
}

// INSERT statements for the explicit @data rows (appended to the MariaDB script)
function dataInserts(tables) {
  if (!tables.some(t => t.dataRows?.length)) return '';
  const data = sampleData(tables);
  const lit = (c, v) => v == null ? 'NULL' : isNumeric(c) ? v : `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  const out = ['-- Data from @data blocks', 'SET FOREIGN_KEY_CHECKS = 0;'];
  for (const t of topoOrder(tables.filter(t => t.cols.length)).order) {
    const rows = data.get(t);
    if (!rows.length) continue;
    out.push(`INSERT INTO ${q(t.name)} (${t.cols.map(c => q(c.name)).join(', ')}) VALUES`);
    out.push(rows.map(r => `  (${t.cols.map(c => lit(c, r.values.get(c))).join(', ')})`).join(',\n') + ';');
  }
  out.push('SET FOREIGN_KEY_CHECKS = 1;', '');
  return out.join('\n');
}
