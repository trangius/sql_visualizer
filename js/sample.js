'use strict';

// ─── Sample data ─────────────────────────────────────────────────────────────
// A few made-up rows per table, so a foreign key becomes something concrete:
// OwnerId = 3 is the owner in row 3. A table is recognised as a kind of thing (Product,
// Kurs, Hund…) and its rows are records of that kind (js/sample/), so a row hangs
// together: a person's email is made from their name, a postcode belongs to its city,
// an end date comes after the start date. In the language the names are written in.
// Every value is seeded by table, column and row, so the data stays put while you type.
// Keys hold: primary keys and unique columns (also over several columns) never repeat,
// and foreign keys only use values that exist in the table they point to.

const SAMPLE_ROWS = 5;
const TODAY = Date.UTC(2025, 5, 1); // ages and dates count from here, so they don't change from day to day
const DAY = 86400000;

// Seeded randomness: the same key always gives the same number in [0, 1)
function rand(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (list, key) => list[Math.floor(rand(key) * list.length)];
// The i-th item of a seeded shuffle: different rows get different items while the list lasts.
// The shuffles are kept, as the same ones are asked for row after row, keystroke after keystroke.
const shuffles = new Map();
function nth(list, key, i) {
  let order = shuffles.get(key)?.get(list);
  if (!order) {
    if (shuffles.size > 4000) shuffles.clear();
    if (!shuffles.has(key)) shuffles.set(key, new WeakMap()); // a hint's list is new on every parse
    order = list.map((v, j) => [rand(key + j), v]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
    shuffles.get(key).set(list, order);
  }
  return order[i % order.length];
}
const between = (lo, hi, key) => lo + Math.floor(rand(key) * (hi - lo + 1));
const digits = (n, key) => Array.from({ length: n }, (_, i) => between(0, 9, key + i)).join('');
const pad2 = n => String(n).padStart(2, '0');
const isoDate = ms => new Date(ms).toISOString().slice(0, 10);

const low = s => s.toLowerCase();
// å ä → a, ø ł → o l, æ → ae, ß → ss, and every other accent off: é → e, ç → c, ñ → n
const fold = s => low(s).replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/æ/g, 'ae').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const ascii = s => fold(s).replace(/[^a-z0-9]/g, '');
// "CustomerOrder", "order_line" → ["customer", "order"], ["order", "line"]
const words = s => s.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(ascii);

// ─── The data ────────────────────────────────────────────────────────────────
// js/sample/kinds.js says what tables and columns can be about, in every language, and
// js/sample/<lang>.js has one language's records. They are loaded the first time sample
// data is needed, and only the language a diagram is written in. Until they are there
// sampleData() has no rows; the diagram is drawn again when they arrive.

const loading = new Map(); // file → its promise
function loadScript(src) {
  if (!loading.has(src)) loading.set(src, new Promise(done => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = s.onerror = () => done();
    document.head.append(s);
  }));
  return loading.get(src);
}
let K = null; // SAMPLE_KINDS, made ready for use (see prepareKinds)
async function loadSampleKinds() {
  await loadScript('js/sample/kinds.js');
  if (!K && typeof SAMPLE_KINDS !== 'undefined') K = prepareKinds(SAMPLE_KINDS);
  return K;
}
const langData = lang => typeof SAMPLE_LANGS !== 'undefined' ? SAMPLE_LANGS[lang] : undefined;
async function loadSampleLang(lang) {
  await loadScript(`js/sample/${lang}.js`);
  return langData(lang);
}

// The kinds with everything worked out that is asked for again and again:
// { kinds, index: name → kind, langOf: name → languages, plurals, irregular, flags,
//   fields/person/generic: [[field, RegExp]], byLang: language → its column RegExps }
function prepareKinds(sk) {
  const langs = Object.keys(sk.languages);
  const kinds = [
    ...sk.people.map(p => ({ ...p, person: true, fields: [] })),
    ...sk.events.map(e => ({ ...e, fields: [] })),
    ...sk.kinds,
  ];
  // index: the first language's kind wins (English first); ownIndex: each language's own
  // (sanger is a song in Swedish, a singer in Danish)
  const index = new Map(), langOf = new Map(), ownIndex = Object.fromEntries(langs.map(l => [l, new Map()]));
  for (const l of langs) {
    for (const k of kinds) {
      for (const n of k.names[l] ?? []) {
        const a = ascii(n);
        if (!index.has(a)) index.set(a, k);
        if (!ownIndex[l].has(a)) ownIndex[l].set(a, k);
        if (!langOf.has(a)) langOf.set(a, new Set());
        langOf.get(a).add(l);
      }
    }
  }
  const all = by => Object.values(by).filter(Boolean).join('|');
  const columns = (group, end, only) => Object.entries(sk.columns[group]).map(([f, by]) => [f, only ? by[only] : all(by)])
    .filter(([, r]) => r).map(([f, r]) => [f, new RegExp(end ? `(${r})$` : r)]);
  // each language's own column words, tried before every language's (Note is a comment in English, a grade in German)
  const ownColumns = l => ({ fields: columns('fields', true, l), person: columns('person', false, l), generic: columns('generic', false, l) });
  return {
    langs, kinds, index, ownIndex, langOf,
    plurals: langs.flatMap(l => sk.languages[l].plurals),
    irregular: Object.assign({}, ...langs.map(l => sk.languages[l].irregular)),
    flags: new Set(langs.flatMap(l => sk.languages[l].flags)),
    letters: Object.fromEntries(langs.map(l => [l, sk.languages[l].letters])),
    headFirst: new Set(langs.filter(l => sk.languages[l].headFirst)),
    names: Object.fromEntries(langs.map(l => [l, sk.languages[l].name])),
    fields: columns('fields', true), person: columns('person'), generic: columns('generic'),
    own: Object.fromEntries(langs.map(l => [l, ownColumns(l)])),
    byLang: Object.fromEntries(langs.map(l => [l, Object.values(sk.columns).flatMap(g => Object.values(g).map(by => by[l]).filter(Boolean)).map(r => new RegExp(r))])),
  };
}

// A word and what it may be in singular: "categories" → category, "kurser" → kurs, "varor" → vara
function stems(w) {
  const out = [w, K.irregular[w]].filter(Boolean);
  for (const [end, put] of K.plurals) if (w.length > end.length + 2 && w.endsWith(end)) out.push(w.slice(0, -end.length) + put);
  return out;
}

// What a name is about: its last word decides (CustomerOrder is an order), and a compound
// by how it ends (hundägare is an ägare, kundorder an order); in a language that puts the
// head first, the first word (LigneCommande is a ligne). A word of the diagram's language
// goes before the same word in another one.
const kindCache = new Map();
function kindOf(name, lang) {
  if (!name) return null;
  const ck = lang + ':' + name;
  if (kindCache.has(ck)) return kindCache.get(ck);
  const ws = words(name), last = ws[ws.length - 1] ?? '', own = K.ownIndex[lang];
  const heads = K.headFirst.has(lang) && ws.length > 1 ? [ws[0], last] : [last];
  const exact = index => heads.flatMap(stems).map(s => index.get(s)).find(Boolean);
  // a compound by its longest known ending
  const ending = index => {
    let best = '';
    for (const s of stems(last)) {
      for (const n of index.keys()) if (n.length >= 3 && n.length > best.length && s.length - n.length >= 3 && s.endsWith(n)) best = n;
    }
    return best ? index.get(best) : null;
  };
  const found = (own && exact(own)) ?? exact(K.index) ?? (own && ending(own)) ?? ending(K.index) ?? null;
  kindCache.set(ck, found);
  return found;
}

// A kind's records in one language, as objects: { name: 'T-shirt', price: 199, … }
const recordCache = new Map();
function records(kind, lang) {
  const key = kind.id + '/' + lang;
  if (!recordCache.has(key)) recordCache.set(key, (langData(lang).kinds[kind.id] ?? []).map(r => Object.fromEntries(kind.fields.map((f, j) => [f, r[j]]))));
  return recordCache.get(key);
}
const kindById = id => K.kinds.find(k => k.id === id);

// ─── What a column holds ─────────────────────────────────────────────────────

// What a column holds is told by its name (ascii, without separators), with the words
// in kinds.js: K.fields by how the name ends ("ProductName", "Styckpris": a record's
// field; what is in front may name another kind, so "CourseName" is a course's name),
// K.person for what people have, K.generic for the rest.

function typeInfo(c) {
  const t = c.effType, { base, args: a, unsigned } = typeParts(t), args = a?.split(',').map(Number) ?? [];
  const len = /^(vc|char|varchar)$/.test(base) ? (args[0] || (base === 'vc' ? DEFAULT_VC : base === 'char' ? 1 : 0)) : 0;
  const bits = { tinyint: 7, smallint: 15, mediumint: 23, int: 31, integer: 31, bigint: 31 }[base];
  return {
    base,
    len,
    int: INT_TYPES.has(base) || base === 'year',
    max: bits ? 2 ** (bits + (unsigned ? 1 : 0)) - 1 : Infinity,
    bool: base === 'bool' || base === 'boolean' || /^tinyint\(1\)/.test(t) || base === 'bit',
    dec: /^(decimal|dec|numeric|fixed|float|double|real)$/.test(base),
    scale: /^(decimal|dec|numeric|fixed)$/.test(base) ? (args.length ? args[1] || 0 : 0) : 2,
    prec: /^(decimal|dec|numeric|fixed)$/.test(base) ? args[0] || 10 : 15,
    date: /^(date|datetime|timestamp)$/.test(base),
    time: base === 'time',
    options: base === 'enum' || base === 'set' ? enumOptions(t) : null,
  };
}
// Is a column's value written without quotes in SQL?
const isNumeric = c => { const ti = typeInfo(c); return ti.int || ti.bool || ti.dec; };

// How a column gets its values, worked out once per column:
// { from: 'hint' | 'record' | 'person' | 'generic', kind, field }
function columnPlan(t, c, tableKind, lang) {
  if (c.hint?.length) return { from: 'hint' };
  // the diagram's own language first, then English (the words other languages borrow), then any
  const name = ascii(c.name), ws = words(c.name), none = { person: [], fields: [], generic: [] };
  const own = [K.own[lang], lang !== 'en' && K.own.en].filter(Boolean).reduce((a, o) =>
    ({ person: [...a.person, ...o.person], fields: [...a.fields, ...o.fields], generic: [...a.generic, ...o.generic] }), none);
  for (const [field, re] of [...own.person, ...K.person]) if (re.test(name)) return { from: 'person', field };
  // "IsActive", "HarBetalat": yes or no
  if (ws.length > 1 && K.flags.has(ws[0])) return { from: 'generic', field: 'bool' };
  // where the words of the name start: a short ending counts only as a word of its own
  // ("Släppår" is a year, "Kommentar" is not; "StudentId" has no "tid" in it)
  const starts = new Set(ws.reduce((a, w) => [...a, a[a.length - 1] + w.length], [0]));
  for (const [field, re] of [...own.fields, ...K.fields]) {
    const m = name.match(re);
    if (!m || (m[0].length < 4 && !starts.has(m.index))) continue;
    const prefix = name.slice(0, m.index);
    const kind = (prefix.length >= 3 && kindOf(c.name.slice(0, c.name.length - m[0].length), lang)) || tableKind;
    const has = f => kind?.fields.includes(f);
    const f = has(field) ? field : field === 'name' && has('title') ? 'title' : field === 'title' && has('name') ? 'name' : null;
    if (f) return { from: 'record', kind, field: f };
    if (kind?.person && (field === 'name' || field === 'city' || field === 'country' || field === 'address' || field === 'salary' || field === 'title')) {
      return { from: 'person', field: field === 'title' ? 'job' : field, kind };
    }
    if (!prefix && (field === 'city' || field === 'country' || field === 'address')) return { from: 'person', field };
    if (field === 'name' && kind) return { from: 'person', field: 'name', kind }; // the name of a thing no record knows
    if (field !== 'name' && field !== 'title') return { from: 'generic', field };
    break;
  }
  for (const [field, re] of [...own.generic, ...K.generic]) if (re.test(name)) return { from: 'generic', field };
  // a column named after a role ("Kund", "Owner") holds that person's name
  const role = kindOf(c.name, lang);
  if (role?.person) return { from: 'person', field: 'name', kind: role };
  return { from: 'generic', field: null };
}

// ─── Rows ────────────────────────────────────────────────────────────────────

// A format of the language: # a digit, % a number 1–20, A a capital letter, {name} a value
function format(pattern, values, key) {
  let k = 0;
  return pattern.replace(/\{(\w+)\}|[#%A]/g, (m, name) => name ? String(values[name] ?? '')
    : m === '#' ? between(0, 9, key + k++) : m === '%' ? between(1, 20, key + k++) : pick('ABDEFGHJLNPQRSTUWXYZ', key + k++));
}

// One made-up person (also for rows that are not people: they still have an address)
function makePerson(lang, role, seed, i) {
  const D = langData(lang), P = D.people, key = seed + i, female = rand(key + 'g') < .5;
  const first = nth(female ? P.female : P.male, seed + 'f', i), last = nth(P.last, seed + 'l', i);
  const [a0, a1] = role?.age ?? [18, 80], age = between(a0, a1, key + 'a');
  const birth = TODAY - age * 365.25 * DAY - between(1, 360, key + 'b') * DAY, ymd = isoDate(birth).replace(/-/g, '');
  const city = nth(P.cities, seed + 'c', i), street = pick(P.streets, key + 's'), no = between(1, 120, key + 'n');
  const own = role && D.roles[role.id], job = kindById('job');
  const work = own ? { title: nth(own.jobs, seed + 'j', i), salary: Math.round(between(...own.pay, key + 'w') / 100) * 100 }
    : job && nth(records(job, lang), seed + 'j', i);
  return {
    first, last, female, age, birth,
    name: `${first} ${last}`,
    email: `${ascii(first)}.${ascii(last)}@${pick(P.domains, key + 'd')}`,
    user: ascii(first) + between(1, 99, key + 'u'),
    phone: format(D.formats.phone, {}, key + 'p'),
    // {birth} YYYYMMDD, {ddmmyy} DDMMYY, {yymm} YYMM, {century} the Finnish century sign (- for the 1900s, A from 2000),
    // {sex} 1 for a man, 2 for a woman (the French number starts so)
    ssn: format(D.formats.ssn, { birth: ymd, ddmmyy: ymd.slice(6) + ymd.slice(4, 6) + ymd.slice(2, 4), yymm: ymd.slice(2, 6),
      century: ymd < '2000' ? '-' : 'A', sex: female ? 2 : 1 }, key + 'x'),
    address: format(D.formats.address, { street, no }, key),
    postcode: format(D.formats.postcode, { code: city[1] }, key + 'q'),
    city: city[0], region: city[2], country: D.country,
    job: work?.title, salary: work?.salary,
    gender: D.gender[female ? 0 : 1],
  };
}

// One value (a string, or null) for column c in row i, fitted to the column's type
function sampleValue(t, c, i, ctx) {
  const ti = typeInfo(c), key = `${t.name}.${c.name}.${i}`;
  const v = rawValue(t, c, i, ctx, ti, key);
  return fitValue(v, ti, key);
}

// A value to the column's type: numbers within range and scale, text within its length
function fitValue(v, ti, key) {
  if (v == null) return null;
  if (ti.int || ti.dec) {
    let n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    if (!isFinite(n)) n = between(1, Math.min(100, ti.max), key);
    if (ti.int) {
      n = Math.round(n);
      if (n > ti.max) n = 1 + (n % ti.max);
      return String(n);
    }
    const lim = 10 ** (ti.prec - ti.scale) - 1;
    if (Math.abs(n) > lim) n = n % lim;
    return n.toFixed(ti.scale);
  }
  const s = String(v);
  return ti.len ? s.slice(0, ti.len).trimEnd() : s;
}

function rawValue(t, c, i, ctx, ti, key) {
  const plan = ctx.plans.get(c), D = langData(ctx.lang);
  // money in the language's currency (D.money: how many of it make a pound); whole numbers in an int column
  const money = (lo, hi) => { const k = D.money; return ti.int ? between(lo * k, hi * k, key) : between(lo * k * 100, hi * k * 100, key) / 100; };
  if (plan.from === 'hint') return nth(c.hint, `${t.name}.${c.name}`, i);
  if (ti.options) return ti.options.length ? pick(ti.options, key) : '';
  if (ti.bool || plan.field === 'bool') return String(between(0, 1, key));
  // values the database checks the form of
  const hex = (n, k) => Array.from({ length: n }, (_, j) => '0123456789abcdef'[between(0, 15, key + k + j)]).join('');
  if (ti.base === 'uuid') return `${hex(8, 'a')}-${hex(4, 'b')}-4${hex(3, 'c')}-8${hex(3, 'd')}-${hex(12, 'e')}`;
  if (ti.base === 'json') return JSON.stringify({ [c.name]: i + 1 });
  if (ti.base === 'inet4') return `10.0.${between(0, 255, key + 'a')}.${between(1, 254, key + 'b')}`;
  if (ti.base === 'inet6') return `2001:db8::${hex(4, 'a')}`;
  const person = ctx.person;
  if (ti.time) return `${pad2(between(8, 17, key + 'h'))}:${pad2(between(0, 3, key + 'n') * 15)}:00`;
  if (ti.date || plan.field === 'birth') {
    // an animal or a thing is born (made) a few years ago, a person when their age says
    const born = ctx.kind && !ctx.kind.person ? TODAY - between(200, 5000, key + 'born') * DAY : person.birth;
    const ms = plan.field === 'birth' ? born : plan.field === 'end' ? ctx.date + between(7, 120, key) * DAY : ctx.date;
    if (ti.int) return new Date(ms).getUTCFullYear();
    const d = isoDate(ms);
    return ti.base === 'date' || (!ti.date && plan.field === 'birth') ? d
      : `${d} ${pad2(between(8, 17, key + 'h'))}:${pad2(between(0, 3, key + 'n') * 15)}:00`;
  }
  if (ti.base === 'year') return between(1990, 2025, key);
  if (plan.from === 'record') return ctx.record(plan.kind, `${t.name}.${c.name}`)[plan.field];
  if (plan.from === 'person') {
    const p = plan.kind && !plan.kind.person && plan.field === 'name' ? null : plan.kind?.person && plan.kind !== ctx.kind ? ctx.other(plan.kind) : person;
    if (plan.field === 'salary' && !p?.salary) return money(1800, 5200);
    if (!p) return `${t.name} ${i + 1}`; // the name of something no record knows
    switch (plan.field) {
      case 'age': return ctx.kind?.person ? p.age : between(1, 15, key);
      case 'password': return Array.from({ length: 16 }, (_, j) => '0123456789abcdef'[between(0, 15, key + j)]).join('');
      case 'birth': return isoDate(p.birth);
      default: return p[plan.field] ?? null;
    }
  }
  // a field that is also a kind of its own (colour, genre, status, size…): one of its names
  const named = K.kinds.find(k => k.id === plan.field && k.fields[0] === 'name');
  if (named) return nth(records(named, ctx.lang), `${t.name}.${c.name}`, i).name;
  switch (plan.field) {
    case 'price': return money(5, 400);
    case 'budget': return money(5000, 500000);
    case 'year': return between(1990, 2025, key);
    case 'pages': return between(90, 720, key);
    case 'duration': return between(5, 180, key);
    case 'capacity': return between(4, 300, key);
    case 'area': return between(20, 180, key);
    case 'rooms': return between(1, 6, key);
    case 'floor': return between(0, 8, key);
    case 'population': return between(2000, 900000, key);
    case 'weight': return ti.int ? between(1, 40, key) : between(10, 400, key) / 10;
    case 'stars': case 'rating': return between(1, 5, key);
    case 'servings': return between(1, 8, key);
    case 'dose': return pick([5, 10, 20, 50, 100, 250, 500], key);
    case 'version': return `${between(1, 9, key)}.${between(0, 9, key + 'v')}.${between(0, 20, key + 'w')}`;
    case 'code': return ti.int ? between(1000, 9999, key) : pick('ABCDEFGH', key + 'a') + pick('KLMNPRST', key + 'b') + digits(4, key);
    case 'url': return `https://example.com/${ascii(t.name)}/${i + 1}`;
    case 'end': case 'date': return new Date(ctx.date).getUTCFullYear(); // an int column named like a date
    case 'qty': return between(1, 20, key);
    case 'grade': {
      if (!ti.int && !ti.dec) return pick(D.grades, key);
      // a number column takes the language's grades that are numbers (8,5 is 8.5), else 1–5
      const nums = D.grades.map(g => g.replace(',', '.')).filter(g => (ti.int ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/).test(g)).map(Number);
      return nums.length ? pick(nums, key) : between(1, 5, key);
    }
    case 'height': return between(150, 195, key);
    case 'room': return ti.int ? between(101, 320, key) : pick('ABC', key + 'r') + between(101, 320, key);
    case 'text': return pick(D.texts, key);
    case 'total': return ctx.total ?? (ti.int ? between(50, 5000, key) : between(500, 500000, key) / 100);
  }
  if (ti.int) return between(1, 100, key);
  if (ti.dec) return between(100, 99999, key) / 100;
  return `${c.name} ${i + 1}`;
}

// The rows of one table: every column that isn't a foreign key, row by row
function tableRows(t, n, lang, plans) {
  const kind = kindOf(t.name, lang);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const seed = t.name + '#';
    const recs = new Map(), others = new Map();
    const ctx = {
      lang, kind, plans,
      person: makePerson(lang, kind?.person ? kind : null, seed, i),
      date: TODAY - between(60, 1200, seed + i + 'date') * DAY, // the row's own date; end dates come after it
      // the row's record of a kind: its table's own kind row by row, another kind seeded by the column
      record: (k, colKey) => {
        const rk = k === kind ? '' : colKey;
        if (!recs.has(rk)) recs.set(rk, nth(records(k, lang), k === kind ? seed + 'rec' : rk, i));
        return recs.get(rk);
      },
      other: k => { if (!others.has(k)) others.set(k, makePerson(lang, k, seed + k.id, i)); return others.get(k); },
    };
    const values = new Map();
    const optional = c => c.nullable && !c.isPk && !c.unique && rand(`${t.name}.${c.name}.${i}null`) < .12;
    // quantity × price makes the total, when a row has all three
    const qty = t.cols.find(c => !c.target && plans.get(c).field === 'qty');
    const price = t.cols.find(c => !c.target && plans.get(c).field === 'price');
    for (const c of t.cols) {
      if (c.target || plans.get(c).field === 'total') continue;
      values.set(c, solePk(t, c) && typeInfo(c).int ? String(i + 1) : optional(c) ? null : sampleValue(t, c, i, ctx));
    }
    if (qty && price && values.get(qty) != null && values.get(price) != null) ctx.total = +values.get(qty) * +values.get(price);
    for (const c of t.cols) if (!c.target && plans.get(c).field === 'total') values.set(c, sampleValue(t, c, i, ctx));
    rows.push({ values, ctx });
  }
  return rows;
}

// The sets of columns whose values may not repeat: the primary key, unique columns, unique (…)
const uniqueSets = t => [
  ...(t.pkCols.length ? [t.pkCols] : []),
  ...t.cols.filter(c => c.unique && !solePk(t, c)).map(c => [c]),
  ...(t.multiUniques ?? []).map(u => u.cols),
];
const tupleKey = (r, cols) => cols.some(c => r.values.get(c) == null) ? null : cols.map(c => r.values.get(c)).join('\u0000');

// A repeated value in a set without foreign keys: one of its columns gets the row number added
function dedupe(t, rows) {
  for (const set of uniqueSets(t)) {
    const own = set.filter(c => !c.target);
    if (own.length !== set.length || !own.length) continue;
    const seen = new Set(), c = own.find(c => !typeInfo(c).options) ?? own[0];
    rows.forEach((r, i) => {
      let k = tupleKey(r, set);
      if (k != null && seen.has(k)) {
        const { int, len } = typeInfo(c), sfx = ` ${i + 1}`, v = r.values.get(c);
        // shortened to make room for the number, so it still fits in the column
        r.values.set(c, int ? String(1000 + i) : len ? (v.slice(0, Math.max(0, len - sfx.length)) + sfx).slice(-len) : v + sfx);
        k = tupleKey(r, set);
      }
      seen.add(k);
    });
  }
}

// A junction table (its key is all foreign keys) gets more rows, so the many-to-many shows
const isJunction = t => t.pkCols.length > 1 && t.pkCols.every(c => c.ref || c.implicit);

// The language of the whole diagram, from the names in it: their letters, the table names
// of each language, and the words of each language's column names. Asked for every table
// drawn, so it is worked out once per model.
const langCache = new WeakMap();
function schemaLang(tables) {
  if (!langCache.has(tables)) langCache.set(tables, guessLang(tables));
  return langCache.get(tables);
}
function guessLang(tables) {
  const score = Object.fromEntries(K.langs.map(l => [l, 0]));
  for (const n of tables.flatMap(t => [t.name, ...t.cols.map(c => c.name)])) {
    for (const l of K.langs) {
      if (K.letters[l] && new RegExp(`[${K.letters[l]}]`, 'i').test(n)) score[l] += 2;
      if (K.byLang[l].some(re => re.test(ascii(n)))) score[l]++;
    }
    for (const w of words(n)) for (const s of stems(w)) for (const l of K.langOf.get(s) ?? []) score[l]++;
  }
  return K.langs.reduce((a, b) => score[b] > score[a] ? b : a, 'en');
}

// The languages there is data for, [{ id, name }] (null until kinds.js is loaded),
// the one guessed from a diagram's names, and the one used: chosen in the Data view
// (state.sampleLang, per diagram) or else guessed. A language whose file is missing or
// fails falls back to English; the file isn't asked for again.
const failed = new Set();
const sampleLangs = () => K && K.langs.map(id => ({ id, name: K.names[id] }));
const sampleGuess = tables => K && schemaLang(tables);
function sampleLang(tables) {
  if (!K) return null;
  const lang = K.langs.includes(state.sampleLang) ? state.sampleLang : schemaLang(tables);
  return failed.has(lang) ? 'en' : lang;
}

// The language to make data in, if its data is loaded; otherwise null, and the loading
// starts (onSampleData() is called once when it is done, to draw the diagram again; it is
// asked for every table drawn meanwhile)
const waiting = new Set();
function whenLoaded(what, load) {
  if (failed.has(what) || waiting.has(what)) return;
  waiting.add(what);
  load().then(d => { waiting.delete(what); if (!d) failed.add(what); onSampleData(); });
}
function readyLang(tables) {
  if (!K) { whenLoaded('kinds', loadSampleKinds); return null; }
  const lang = sampleLang(tables);
  if (langData(lang)) return lang;
  whenLoaded(lang, () => loadSampleLang(lang));
  return null;
}

// Sample rows for every table: Map table → [{ values: Map column → string | null }].
// Empty until the data has arrived (the diagram is drawn again then).
const sampleCache = new WeakMap();
function sampleData(tables, n = SAMPLE_ROWS) {
  const lang = readyLang(tables);
  if (!lang) return new Map(tables.map(t => [t, []]));
  const cached = sampleCache.get(tables)?.get(n + lang);
  if (cached) return cached;
  const data = new Map(), plans = new Map();
  for (const t of tables) {
    const kind = kindOf(t.name, lang);
    for (const c of t.cols) plans.set(c, columnPlan(t, c, kind, lang));
    // the row's own name beside a first name is the surname (Prénom, Nom), beside a surname the first name (Nombre, Apellidos)
    const own = t.cols.map(c => plans.get(c)).filter(p => p.from === 'person' && (!p.kind || p.kind === kind));
    const has = f => own.some(p => p.field === f);
    for (const p of own) if (p.field === 'name') p.field = has('first') ? 'last' : has('last') ? 'first' : 'name';
  }
  for (const t of tables) {
    const rows = tableRows(t, isJunction(t) ? 2 * n : n, lang, plans);
    dedupe(t, rows);
    data.set(t, rows);
  }
  // Foreign keys: values that exist in the column they point to. A table is finished
  // (including rows dropped as duplicates) before the tables pointing to it use its values.
  // Some rows are picked more often than others, as in real data.
  const done = new Set(), busy = new Set();
  const finish = t => {
    if (done.has(t) || busy.has(t)) return;
    busy.add(t);
    for (const c of t.cols) if (c.target && c.target !== t) finish(c.target);
    const rows = data.get(t), sets = uniqueSets(t).filter(s => s.some(c => c.target)), seen = sets.map(() => new Set());
    // a price of its own is the price of what the row points to: an order line costs what its product does
    const field = c => plans.get(c).field;
    const copies = t.cols.filter(c => !c.target && field(c) === 'price' && plans.get(c).from === 'generic').flatMap(c => {
      const fk = t.cols.find(f => f.target && f.target.cols.some(o => o !== f.targetCol && field(o) === 'price'));
      return fk ? [[c, fk, fk.target.cols.find(o => field(o) === 'price')]] : [];
    });
    const qty = t.cols.find(c => !c.target && field(c) === 'qty'), totals = t.cols.filter(c => !c.target && field(c) === 'total');
    const kept = [];
    rows.forEach((r, i) => {
      for (let attempt = 0; attempt < 16; attempt++) {
        for (const c of t.cols) {
          if (!c.target) continue;
          const key = `${t.name}.${c.name}.${i}.${attempt}`;
          let pool = data.get(c.target).map(o => o.values.get(c.targetCol)).filter(v => v != null);
          if (c.target === t) pool = pool.filter(v => v !== r.values.get(c.targetCol)); // not itself
          const none = !pool.length || (c.nullable && rand(key + 'null') < 0.2);
          r.values.set(c, none ? null : pool[Math.floor(pool.length * rand(key) ** 1.6)]);
        }
        const keys = sets.map(s => tupleKey(r, s));
        const bad = t.cols.some(c => c.target && !c.nullable && r.values.get(c) == null);
        if (!bad && keys.every((k, j) => k == null || !seen[j].has(k))) {
          keys.forEach((k, j) => k != null && seen[j].add(k));
          for (const [c, fk, from] of copies) {
            const o = data.get(fk.target).find(o => o.values.get(fk.targetCol) === r.values.get(fk));
            if (o?.values.get(from) != null) r.values.set(c, fitValue(+o.values.get(from), typeInfo(c), ''));
          }
          if (copies.length && qty && r.values.get(qty) != null) {
            r.ctx.total = +r.values.get(qty) * +r.values.get(copies[0][0]);
            for (const c of totals) r.values.set(c, sampleValue(t, c, i, r.ctx));
          }
          kept.push(r);
          break;
        }
      }
    });
    data.set(t, kept);
    busy.delete(t);
    done.add(t);
  };
  tables.forEach(finish);
  if (!sampleCache.has(tables)) sampleCache.set(tables, new Map());
  sampleCache.get(tables).set(n + lang, data);
  return data;
}

// INSERT statements for the sample rows (appended to the SQL script), 20 per table
async function sampleInserts(tables, dialect = 'mariadb') {
  const D = dialectOf(dialect);
  if (await loadSampleKinds()) {
    const lang = sampleLang(tables);
    if (!(await loadSampleLang(lang))) { failed.add(lang); await loadSampleLang('en'); }
  }
  const data = sampleData(tables, 20);
  const lit = (c, v) => v == null ? 'NULL' : typeInfo(c).bool ? D.bool(v !== '0') : isNumeric(c) ? v
    : /^(var)?binary|blob$/.test(typeInfo(c).base) && D.bin ? D.bin(v) : D.typed?.(c, v) ?? D.str(v);
  const { order, cyclic } = topoOrder(tables.filter(t => t.cols.length));
  const out = ['-- Sample data (made up)', ...D.dataStart(order, cyclic)];
  for (const t of order) {
    const rows = data.get(t);
    if (!rows.length) continue;
    const [before, after] = D.dataTable?.(t) ?? [[], []];
    out.push(...before, `INSERT INTO ${D.q(t.name)} (${t.cols.map(c => D.q(c.name)).join(', ')}) VALUES`);
    out.push(rows.map(r => `  (${t.cols.map(c => lit(c, r.values.get(c))).join(', ')})`).join(',\n') + ';', ...after);
  }
  out.push(...D.dataEnd(order, cyclic), '');
  return out.join('\n');
}
