'use strict';

// ─── Diagram geometry ────────────────────────────────────────────────────────

// Box anatomy (from the design): 40px header, rows of 30px starting 4px below it
const HEAD_H = 40, ROW_H = 30, ROWS_TOP = 44, PAD_X = 12, BADGE_W = 20, GAP = 8, MIN_W = 190;
const UI_FONT = "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO_FONT = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const FONTS = {
  head: `600 13.5px ${UI_FONT}`,
  name: `400 13px ${UI_FONT}`,
  pk: `600 13px ${UI_FONT}`,
  key: `600 9.5px ${MONO_FONT}`,
  flags: `400 10.5px ${MONO_FONT}`,
  type: `400 11.5px ${MONO_FONT}`,
};
const measureCtx = document.createElement('canvas').getContext('2d');
const widthCache = new Map();
function textW(s, font) {
  const k = font + '\u0000' + s;
  if (!widthCache.has(k)) { measureCtx.font = font; widthCache.set(k, measureCtx.measureText(s).width); }
  return widthCache.get(k);
}

// How a type is shown in a box: vc spelled out as varchar(n)
function displayType(c) {
  const t = c.type ? normType(c.type) : c.effType;
  const m = t.match(/^vc(?:\((\d+)\))?(?=$|\s)(.*)$/);
  return m ? `varchar(${m[1] || DEFAULT_VC})${m[2]}` : t;
}

function rowInfo(c) {
  return {
    key: c.isPk ? 'PK' : c.ref || c.implicit ? 'FK' : '',
    name: c.name,
    bold: c.isPk,
    flags: [c.nullable && 'null', c.unique && 'unique', c.indexed && 'index'].filter(Boolean).join(' '),
    type: displayType(c),
  };
}

// The rows a box shows: every column, or with "Keys only" just the primary keys, the
// foreign keys and the columns they point to
const shownCols = t => t.shown ?? t.cols;
function markShown(tables) {
  const targeted = new Set(tables.flatMap(t => t.cols.map(c => c.targetCol).filter(Boolean)));
  for (const t of tables) t.shown = state.keysOnly ? t.cols.filter(c => c.isPk || c.ref || c.target || targeted.has(c)) : t.cols;
}

// Indexes over several columns are listed below the rows: "index (ProductId, StartDate)"
const FOOT_H = 22;
const footLines = t => (t.multiIndexes ?? []).map(ix => `(${ix.cols.join(', ')})`);
const footTop = n => ROWS_TOP + Math.max(1, n) * ROW_H + 6;

// Data view: the box is a real table, column names across and a few sample rows below
// (see sample.js). Instead of arrows, colours link the rows: each row of a referenced
// table has a colour, and a foreign key value gets the colour of the row it points to.
const COLHEAD_H = 26, DATA_H = 26, CELL_GAP = 18, CELL_MAX = 24;
const FONT_DHEAD = `600 11px ${UI_FONT}`;
const dataRowY = k => HEAD_H + 6 + COLHEAD_H + k * DATA_H + DATA_H / 2;
const cellText = v => v == null ? 'NULL' : v.length > CELL_MAX ? v.slice(0, CELL_MAX - 1) + '…' : v;

// Every referenced row in the diagram gets its own hue. Hues step by the golden angle,
// so neighbours (the rows of one table, and the next table's rows) are far apart on the wheel.
const hueCache = new WeakMap();
function rowHues(tables) {
  if (hueCache.has(tables)) return hueCache.get(tables);
  const data = sampleData(tables), hues = new Map();
  const targeted = new Set(tables.flatMap(t => t.cols.map(c => c.target).filter(Boolean)));
  let i = 0;
  for (const t of tables) {
    if (targeted.has(t)) data.get(t).forEach((_, k) => hues.set(`${t.name}#${k}`, Math.round((20 + i++ * 137.508) % 360)));
  }
  hueCache.set(tables, hues);
  return hues;
}

// cell: { text, key, hue }. key names the row a coloured cell belongs to ("Owner#2"),
// so hovering one lights up every cell with the same key.
function measureData(t) {
  const data = sampleData(model.tables), cols = shownCols(t), rows = data.get(t) ?? [];
  const targeted = new Set(model.tables.flatMap(o => o.cols.map(c => c.targetCol).filter(Boolean)));
  const hues = rowHues(model.tables);
  const cells = rows.map((r, k) => cols.map(c => {
    const v = r.values.get(c), cell = { text: cellText(v) };
    if (c.target && v != null) {
      const j = data.get(c.target).findIndex(o => o.values.get(c.targetCol) === v);
      if (j >= 0) cell.key = `${c.target.name}#${j}`;
    } else if (targeted.has(c)) cell.key = `${t.name}#${k}`;
    if (cell.key) cell.hue = hues.get(cell.key) ?? 0;
    return cell;
  }));
  const cws = cols.map((c, i) => Math.max(textW(c.name, FONT_DHEAD), ...cells.map(row => textW(row[i].text, FONTS.type))));
  const xs = cws.map((_, i) => PAD_X + cws.slice(0, i).reduce((a, b) => a + b + CELL_GAP, 0));
  const w = Math.max(MIN_W, textW(t.name, FONTS.head) + 2 * PAD_X + 12, 2 * PAD_X + cws.reduce((a, b) => a + b, 0) + CELL_GAP * Math.max(0, cols.length - 1));
  return { w: Math.ceil(w / 10) * 10, h: dataRowY(rows.length + 1) - DATA_H / 2 + 6, rows: [], data: { cols, cells, xs, cws } };
}

function measureTable(t) {
  if (state.dataView) return measureData(t);
  const rows = shownCols(t).map(rowInfo), foot = footLines(t);
  const w = Math.max(MIN_W, textW(t.name, FONTS.head) + 2 * PAD_X + 12, ...rows.map(r =>
    PAD_X + BADGE_W + GAP + textW(r.name, r.bold ? FONTS.pk : FONTS.name) + 16 +
    (r.flags ? textW(r.flags, FONTS.flags) + 6 : 0) + textW(r.type, FONTS.type) + PAD_X),
    ...foot.map(f => 2 * PAD_X + textW('index ', FONTS.flags) + textW(f, FONTS.type)));
  const h = footTop(rows.length) + (foot.length ? foot.length * FOOT_H + 6 : 0);
  return { w: Math.ceil(w / 10) * 10, h, rows };
}
const rowY = i => ROWS_TOP + i * ROW_H + ROW_H / 2;

// Positions for tables that don't have one yet (see layout.js for how a spot is chosen).
// The newest auto-placed table "floats": until it is dragged or another table is added,
// it moves to a better spot whenever its arrows change (e.g. while its FKs are being typed).
let revealName = null;

// Is a box (at least its middle) inside the visible canvas?
function onScreen(p, d) {
  const r = svg.getBoundingClientRect();
  if (!r.width) return true;
  const x = (p.x + d.w / 2) * view.s + view.tx, y = (p.y + d.h / 2) * view.s + view.ty;
  return x >= 0 && x <= r.width && y >= 0 && y <= r.height;
}

function ensurePositions(tables, dims) {
  const names = new Set(tables.map(t => t.name));
  let changed = false;
  // A table that just appeared may have an old spot from an earlier table with the same
  // name. If that spot is off screen, forget it, so the table is placed where you look.
  // (prevNames is null right after loading or switching tabs: then every spot is kept.)
  if (prevNames) {
    const before = new Set(prevNames);
    for (const t of tables) if (!before.has(t.name) && pos[t.name] && !onScreen(pos[t.name], dims.get(t))) delete pos[t.name];
  }
  if (tables.length && !tables.some(t => pos[t.name])) {
    arrangeAll(tables, dims);
    revealName = tables[0].name; // placed mid-view, but make sure it shows
    changed = true;
  } else {
    // a renamed table keeps the spot of the name it replaced
    tables.forEach((t, i) => {
      const old = prevNames?.[i];
      if (!pos[t.name] && old && !names.has(old) && pos[old]) { pos[t.name] = pos[old]; changed = true; }
    });
    const edges = layoutEdges(tables);
    for (const t of tables) {
      const p = pos[t.name], sig = linkSignature(t, tables);
      if (p && !(p.float && p.sig !== sig)) continue;
      if (!p) for (const q of Object.values(pos)) delete q.float; // only the newest one floats
      const placed = new Map(tables.filter(o => o !== t && pos[o.name]).map(o => [o, { ...pos[o.name], ...dims.get(o) }]));
      const s = bestSpot(t, placed, dims, edges, viewCenter());
      pos[t.name] = { x: s.x, y: s.y, float: true, sig };
      revealName = t.name;
      changed = true;
    }
  }
  prevNames = [...names];
  if (changed) saveDoc();
}

// Arrows leave the FK row horizontally and enter the Id row horizontally.
// In between they are routed orthogonally around the boxes (A* on a grid),
// with a cost for every bend. An arrow may never run through another arrow's end point, and running
// along a lane used by an arrow to a *different* Id is very expensive (it would look like it points there).
const ROUTE = { GAP: 30, MARGIN: 10, STUB: 20, GRID: 10, BEND: 40, SHARE_OTHER: 60, CROSS: 30, MERGE: 0.5 };

// side: force a same-side loop ('L' or 'R'); used to try both sides of a self-reference
function chooseSides(e, side = null) {
  const a = e.a, b = e.b;
  let out, inn; // side of a the arrow leaves from, side of b it enters
  if (side) { out = inn = side; }
  else if (a !== b && b.x >= a.x + a.w + ROUTE.GAP) { out = 'R'; inn = 'L'; }
  else if (a !== b && b.x + b.w <= a.x - ROUTE.GAP) { out = 'L'; inn = 'R'; }
  else {
    // boxes overlap horizontally: leave and enter on the same side
    const lx = Math.min(a.x, b.x), rx = Math.max(a.x + a.w, b.x + b.w);
    out = inn = a === b || (a.x - lx) + (b.x - lx) <= (rx - a.x - a.w) + (rx - b.x - b.w) ? 'L' : 'R';
  }
  e.x1 = out === 'R' ? a.x + a.w : a.x;
  e.x2 = inn === 'R' ? b.x + b.w : b.x;
  e.outDir = out === 'R' ? 0 : 1;     // 0 E, 1 W, 2 S, 3 N
  e.inDir = inn === 'L' ? 0 : 1;      // direction of travel when entering b
  e.sx = e.x1 + (out === 'R' ? ROUTE.STUB : -ROUTE.STUB);
  e.tx = e.x2 + (inn === 'L' ? -ROUTE.STUB : ROUTE.STUB);
}

function simplePath(e) {
  const X = Math.round((e.sx + e.tx) / 2);
  return [[e.x1, e.sy], [X, e.sy], [X, e.ty], [e.x2, e.ty]];
}

// The router's search arrays, kept between calls (it runs on every keystroke and drag frame).
// A cell's cost counts only if it was set in the current search (seen === stamp), so the
// arrays don't have to be cleared before each search.
const routeBuf = { g: new Float64Array(0), prev: new Int32Array(0), seen: new Uint32Array(0), stamp: 0 };

function routeEdges(edges, boxes) {
  if (!edges.length) return;
  edges.forEach(e => chooseSides(e));
  const { MARGIN, GRID, BEND, SHARE_OTHER, CROSS, MERGE } = ROUTE;
  // a self-reference can loop around either side: both are tried, the cheaper one wins
  const SIDE_KEYS = ['x1', 'x2', 'outDir', 'inDir', 'sx', 'tx'];
  const variants = e => e.a !== e.b ? [e] : ['L', 'R'].map(side => {
    const v = { ...e };
    chooseSides(v, side);
    return v;
  });
  const allVariants = edges.flatMap(variants);

  // Grid lines: every GRID px, plus the exact stub and row coordinates
  const pad = 80;
  const x0 = Math.min(...boxes.map(b => b.x)) - pad, x1 = Math.max(...boxes.map(b => b.x + b.w)) + pad;
  const y0 = Math.min(...boxes.map(b => b.y)) - pad, y1 = Math.max(...boxes.map(b => b.y + b.h)) + pad;
  let step = GRID;
  while (((x1 - x0) / step) * ((y1 - y0) / step) > 60000) step *= 2;
  const coords = (lo, hi, extra) => {
    const s = new Set(extra);
    for (let v = Math.floor(lo / step) * step; v <= hi; v += step) s.add(v);
    return [...s].sort((p, q) => p - q);
  };
  const xs = coords(x0, x1, allVariants.flatMap(e => [e.sx, e.tx]));
  const ys = coords(y0, y1, edges.flatMap(e => [e.sy, e.ty]));
  const nx = xs.length, ny = ys.length;
  const xi = new Map(xs.map((v, i) => [v, i])), yi = new Map(ys.map((v, i) => [v, i]));

  const blocked = new Uint8Array(nx * ny);
  for (const b of boxes) {
    for (let i = 0; i < nx; i++) {
      if (xs[i] <= b.x - MARGIN || xs[i] >= b.x + b.w + MARGIN) continue;
      for (let j = 0; j < ny; j++) {
        if (ys[j] > b.y - MARGIN && ys[j] < b.y + b.h + MARGIN) blocked[j * nx + i] = 1;
      }
    }
  }

  // The stub points next to each FK row and Id row belong to their arrows only
  const reserved = new Map();
  for (const e of allVariants) {
    reserved.set(yi.get(e.sy) * nx + xi.get(e.sx), 'S:' + e.from);
    reserved.set(yi.get(e.ty) * nx + xi.get(e.tx), 'T:' + e.to);
  }
  const used = new Map(); // "nodeA-nodeB" → set of targets whose arrows use that grid segment
  const usedNodes = new Map(); // node → set of targets whose arrows pass it (crossing it costs a little)
  const segKey = (p, q) => p < q ? p + '-' + q : q + '-' + p;
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1], REV = [1, 0, 3, 2];
  const size = nx * ny * 4;
  if (routeBuf.g.length < size) {
    Object.assign(routeBuf, { g: new Float64Array(size), prev: new Int32Array(size), seen: new Uint32Array(size), stamp: 0 });
  }
  const { g, prev, seen } = routeBuf;

  // short arrows first, so they get the direct lanes; self-references last, to see what's taken
  const len = e => e.a === e.b ? Infinity : Math.abs(e.sx - e.tx) + Math.abs(e.sy - e.ty);
  const order = [...edges].sort((p, q) => len(p) - len(q));
  for (const e of order) {
    let best = null;
    for (const v of variants(e)) {
      const s = yi.get(v.sy) * nx + xi.get(v.sx), t = yi.get(v.ty) * nx + xi.get(v.tx);
      const r = !blocked[s] && !blocked[t] ? astar(s, t, v) : null;
      if (r && (!best || r.cost < best.cost)) best = { ...r, v };
    }
    if (!best) { e.points = simplePath(e); continue; }
    for (const k of SIDE_KEYS) e[k] = best.v[k];
    const path = best.nodes;
    for (let k = 1; k < path.length; k++) {
      const key = segKey(path[k - 1], path[k]);
      if (!used.has(key)) used.set(key, new Set());
      used.get(key).add(e.to);
    }
    for (const n of path) {
      if (!usedNodes.has(n)) usedNodes.set(n, new Set());
      usedNodes.get(n).add(e.to);
    }
    const pts = [[e.x1, e.sy], ...path.map(n => [xs[n % nx], ys[Math.floor(n / nx)]]), [e.x2, e.ty]];
    e.points = pts;
  }
  addJumps(edges);

  function astar(s, t, e) {
    const dir0 = e.outDir, dirEnd = e.inDir, myT = 'T:' + e.to;
    // Running along an arrow to the same row is cheap (they merge into one line, drawn
    // thicker); along one to another row is very expensive. Passing through a point another
    // arrow uses, without running along it, is a crossing (a jump), whatever its target.
    const shareCost = key => {
      const u = used.get(key);
      if (!u) return 0;
      for (const to of u) if (to !== e.to) return SHARE_OTHER;
      return -MERGE;
    };
    const crossCost = (n, key) => {
      if (used.get(key)?.has(e.to)) return 0;
      return usedNodes.get(n)?.size ? CROSS : 0;
    };
    if (++routeBuf.stamp === 0xffffffff) { seen.fill(0); routeBuf.stamp = 1; }
    const stamp = routeBuf.stamp;
    const tx = xs[t % nx], ty = ys[Math.floor(t / nx)];
    const h = n => Math.abs(xs[n % nx] - tx) + Math.abs(ys[Math.floor(n / nx)] - ty);
    const heap = new MinHeap();
    const s0 = s * 4 + dir0;
    g[s0] = 0;
    prev[s0] = -1;
    seen[s0] = stamp;
    heap.push(h(s), s0);
    while (heap.size) {
      const st = heap.pop();
      const n = st >> 2, d = st & 3, gc = g[st];
      if (n === t && d === dirEnd) {
        const nodes = [];
        for (let c = st; c !== -1; c = prev[c]) if (!nodes.length || nodes[nodes.length - 1] !== c >> 2) nodes.push(c >> 2);
        return { nodes: nodes.reverse(), cost: gc };
      }
      if (n === t) { // turn in place to leave the stub in the entry direction
        relax(st, t * 4 + dirEnd, gc + BEND, 0);
        continue;
      }
      const i = n % nx, j = Math.floor(n / nx);
      for (let nd = 0; nd < 4; nd++) {
        if (nd === REV[d]) continue;
        const ii = i + DX[nd], jj = j + DY[nd];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const m = jj * nx + ii;
        if (blocked[m]) continue;
        const r = reserved.get(m);
        if (r && m !== t && r !== myT) continue;
        const len = Math.abs(xs[ii] - xs[i]) + Math.abs(ys[jj] - ys[j]);
        const key = segKey(n, m);
        const cost = gc + len * (1 + shareCost(key)) + crossCost(m, key) + (nd === d ? 0 : BEND);
        relax(st, m * 4 + nd, cost, h(m));
      }
    }
    return null;

    function relax(from, to, cost, hh) {
      if (seen[to] === stamp && cost >= g[to]) return;
      seen[to] = stamp;
      g[to] = cost;
      prev[to] = from;
      heap.push(cost + hh, to);
    }
  }
}

// Points of a route without the ones in the middle of straight runs
function simplify(points) {
  return points.filter((q, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const a = points[i - 1], b = points[i + 1];
    return !((a[0] === q[0] && q[0] === b[0]) || (a[1] === q[1] && q[1] === b[1]));
  });
}

// Where arrows cross, the horizontal line jumps over the vertical one with a small arch.
// Only real crossings count: a line that just ends on another (merging into the same
// Id row) is not a crossing. Next to a corner, the corner's rounding shrinks to make room.
const JUMP_R = 5;
function addJumps(edges) {
  const simple = edges.map(e => simplify(e.points));
  const verticals = simple.flatMap((p, k) => p.slice(1).flatMap((q, i) =>
    p[i][0] === q[0] ? [{ k, x: q[0], y0: Math.min(p[i][1], q[1]), y1: Math.max(p[i][1], q[1]) }] : []));
  edges.forEach((e, k) => {
    const p = simple[k], jumps = [];
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i];
      if (ay !== by) { jumps.push([]); continue; }
      const lo = Math.min(ax, bx) + JUMP_R + 1, hi = Math.max(ax, bx) - JUMP_R - 1;
      const xs = verticals
        .filter(v => v.k !== k && v.x > lo && v.x < hi && ay > v.y0 + 1 && ay < v.y1 - 1)
        .map(v => v.x)
        .sort((u, w) => (bx > ax ? u - w : w - u))
        .filter((x, j, arr) => !j || Math.abs(x - arr[j - 1]) > 2 * JUMP_R + 2); // no overlapping jumps
      jumps.push(xs);
    }
    e.jumps = jumps.reduce((n, xs) => n + xs.length, 0);
    e.d = pathD(p, jumps);
  });
}

// Orthogonal path with rounded corners (radius 9, smaller on short segments),
// and jumps[i] = x positions where segment i (from point i to i+1) hops over another line
function pathD(p, jumps = [], r = 9) {
  const hop = (i, y, dir) => (jumps[i] ?? []).map(x =>
    `L${x - JUMP_R * dir},${y}A${JUMP_R},${JUMP_R} 0 0 ${dir > 0 ? 1 : 0} ${x + JUMP_R * dir},${y}`).join('');
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1];
    const d1 = Math.hypot(x1 - x0, y1 - y0), d2 = Math.hypot(x2 - x1, y2 - y1);
    // a jump right next to this corner: round the corner less so they don't overlap
    const near = [...(y0 === y1 ? jumps[i - 1] ?? [] : []), ...(y1 === y2 ? jumps[i] ?? [] : [])]
      .map(x => Math.abs(x - x1) - JUMP_R);
    const rr = Math.max(0, Math.min(r, d1 / 2, d2 / 2, ...near));
    if (y0 === y1) d += hop(i - 1, y0, Math.sign(x1 - x0));
    d += `L${x1 + (x0 - x1) / d1 * rr},${y1 + (y0 - y1) / d1 * rr}Q${x1},${y1} ${x1 + (x2 - x1) / d2 * rr},${y1 + (y2 - y1) / d2 * rr}`;
  }
  const n = p.length, [lx, ly] = p[n - 1];
  if (p[n - 2][1] === ly) d += hop(n - 2, ly, Math.sign(lx - p[n - 2][0]));
  return d + `L${lx},${ly}`;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}


// ─── Diagram rendering ───────────────────────────────────────────────────────

// Colors come from the page's theme variables (themes.js); an export sets them itself.
const DIAGRAM_CSS = `
.box { fill: var(--box-bg, #fffcf5); filter: var(--box-shadow, none); }
.head { fill: var(--box-head, #fffcf5); }
.sep, .outline { fill: none; stroke: var(--box-border, #d3cab2); stroke-width: 1; }
.tbl:hover .outline { stroke: var(--accent, #3a4658); }
.tbl.sel .outline { stroke: var(--accent, #3a4658); stroke-width: 2; }
.marquee { fill: var(--accent, #3a4658); fill-opacity: .08; stroke: var(--accent, #3a4658); stroke-width: 1; stroke-dasharray: 4 3; }
text { dominant-baseline: central; }
.title { font: ${FONTS.head}; letter-spacing: -.005em; fill: var(--box-head-fg, #1c1812); }
.row .hit { fill: transparent; }
.row:hover .hit { fill: var(--row-hover, #f5efe2); }
.key { font: ${FONTS.key}; letter-spacing: .02em; fill: var(--accent, #3a4658); }
.key.fk { fill: var(--tok-ref, #525e1e); }
.name { font: ${FONTS.name}; fill: var(--fg, #1c1812); }
.row.pk .name { font-weight: 600; }
.flags { font: ${FONTS.flags}; fill: var(--tok-flag, #6e3a2e); }
.type { font: ${FONTS.type}; fill: var(--muted, #5e5440); }
.row.bad .name, .row.bad .key { fill: var(--err, #7a2e22); }
.dhead { font: ${FONT_DHEAD}; fill: var(--muted, #5e5440); }
.dhead.pk, .dcell.pk { fill: var(--accent, #3a4658); }
.dhead.fk, .dcell.fk { fill: var(--tok-ref, #525e1e); }
.dcell { font: ${FONTS.type}; fill: var(--fg, #1c1812); }
.dcell.pk { font-weight: 600; }
.dcell.null { fill: var(--muted, #5e5440); font-style: italic; }
.drow .hit { fill: transparent; }
.drow:hover .hit { fill: var(--row-hover, #f5efe2); }
.dmark { stroke: none; }
.dmark.hl { stroke: var(--fg, #1c1812); stroke-width: 1.5; }
.dmark { fill: hsl(var(--h) var(--dv-s, 70%) var(--dv-l, 84%)); }
.dmark ~ .dcell.pk, .dmark ~ .dcell.fk { fill: var(--fg, #1c1812); }
.edge { fill: none; stroke: var(--edge, #5e5440); stroke-width: 1.4; stroke-linejoin: round; }
.bundle { stroke: var(--edge, #5e5440); stroke-linecap: round; pointer-events: none; }
.ahead { fill: var(--edge, #5e5440); }
.start { fill: var(--canvas, #fff); stroke: var(--edge, #5e5440); stroke-width: 1.5; }
.edge-g.hl .edge { stroke: var(--accent, #3a4658); stroke-width: 2; }
.edge-g.hl .ahead { fill: var(--accent, #3a4658); }
.edge-g.hl .start { stroke: var(--accent, #3a4658); }
.sym { fill: none; stroke: var(--edge, #5e5440); stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.sym-o { fill: var(--canvas, #fff); stroke: var(--edge, #5e5440); stroke-width: 1.4; }
.mult { font: 500 11px ${MONO_FONT}; fill: var(--muted, #5e5440); dominant-baseline: auto; }
.edge-g.hl .sym, .edge-g.hl .sym-o { stroke: var(--accent, #3a4658); stroke-width: 2; }
.edge-g.hl .mult { fill: var(--accent, #3a4658); font-weight: 600; }
.edge-hit { fill: none; stroke: transparent; stroke-width: 9; }
`;

const svg = $('#canvas'), vp = $('#vp');
$('#diagramCss').textContent = DIAGRAM_CSS;

let geometry = { boxes: new Map(), edges: [] };

function computeGeometry() {
  const tables = model.tables;
  markShown(tables);
  const dims = new Map(tables.map(t => [t, measureTable(t)]));
  ensurePositions(tables, dims);
  const boxes = new Map(tables.map(t => {
    const d = dims.get(t);
    return [t, { x: pos[t.name].x, y: pos[t.name].y, w: d.w, h: d.h, rows: d.rows, data: d.data }];
  }));
  const edges = state.dataView ? [] : diagramEdges(tables, boxes);
  routeEdges(edges, [...boxes.values()]);
  if ((state.notation === 'uml' || state.notation === 'ratio') && !state.dataView) placeLabels(edges);
  geometry = { boxes, edges, dims, bundles: bundles(edges) };
}

// Where several arrows run along the same stretch, that stretch is drawn thicker:
// 2 arrows twice the width, 3 three times, and so on. Returns [{ x1, y1, x2, y2, n }].
// A stretch stops short of the arrowheads and start circles, so they stay visible.
function bundles(edges) {
  const lines = new Map(); // "h:y" / "v:x" → [{ a, b, k }] intervals along that line
  const ends = new Set(edges.flatMap(e => [e.points[0], e.points[e.points.length - 1]].map(p => p.join(','))));
  edges.forEach((e, k) => {
    const p = simplify(e.points);
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i];
      const [key, a, b] = ay === by ? ['h:' + ay, ax, bx] : ['v:' + ax, ay, by];
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({ a: Math.min(a, b), b: Math.max(a, b), k });
    }
  });
  const out = [], TRIM = 10;
  for (const [key, ivs] of lines) {
    if (ivs.length < 2) continue;
    const horiz = key[0] === 'h', at = +key.slice(2);
    const cuts = [...new Set(ivs.flatMap(v => [v.a, v.b]))].sort((p, q) => p - q);
    let run = null;
    const flush = () => {
      if (!run || run.n < 2) return;
      const pt = v => (horiz ? [v, at] : [at, v]).join(',');
      const a = run.a + (ends.has(pt(run.a)) ? TRIM : 0), b = run.b - (ends.has(pt(run.b)) ? TRIM : 0);
      if (b > a) out.push(horiz ? { x1: a, y1: at, x2: b, y2: at, n: run.n } : { x1: at, y1: a, x2: at, y2: b, n: run.n });
    };
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i];
      const n = new Set(ivs.filter(v => v.a <= a && v.b >= b).map(v => v.k)).size;
      if (run && run.n === n && run.b === a) run.b = b;
      else { flush(); run = { a, b, n }; }
    }
    flush();
  }
  return out;
}

// The arrows between boxes (Map table → box), before routing
function diagramEdges(tables, boxes) {
  const edges = [];
  for (const t of tables) {
    shownCols(t).forEach((c, i) => {
      if (!c.target) return;
      const a = boxes.get(t), b = boxes.get(c.target);
      edges.push({
        a, b,
        fromTable: t.name, toTable: c.target.name,
        // what the schema guarantees: a unique FK (or one that is the whole PK) makes it 1-1,
        // a nullable FK means a row may have no parent
        unique: c.unique || (c.isPk && t.pkCols.length === 1),
        nullable: c.nullable,
        implicit: c.implicit,
        from: t.name + '.' + c.name,
        to: c.target.name + '.' + c.targetCol.name,
        sy: a.y + rowY(i),
        ty: b.y + rowY(shownCols(c.target).indexOf(c.targetCol)),
      });
    });
  }
  // In the ER notations each arrow's "one" end has its own symbol, so arrows that point
  // at the same row are spread a little apart instead of meeting in one point
  if (state.notation !== 'arrows') {
    const byTarget = new Map();
    for (const e of edges) (byTarget.get(e.to) ?? byTarget.set(e.to, []).get(e.to)).push(e);
    for (const group of byTarget.values()) {
      if (group.length < 2) continue;
      const step = Math.min(8, 22 / (group.length - 1));
      group.sort((p, q) => p.sy - q.sy);
      group.forEach((e, i) => {
        const off = (i - (group.length - 1) / 2) * step;
        e.ty += off;
        e.small = true;
      });
    }
  }
  return edges;
}

function dataBoxBody(t, b, interactive) {
  const { cols, cells, xs, cws } = b.data, ch = HEAD_H + 6 + COLHEAD_H / 2;
  const kind = c => c.isPk ? ' pk' : c.target ? ' fk' : '';
  let s = cols.map((c, i) => `<text class="dhead${kind(c)}" x="${xs[i]}" y="${ch}">` +
    (c.target ? `<title>${esc(c.name)} → ${esc(c.target.name)}.${esc(c.targetCol.name)}</title>` : '') + `${esc(c.name)}</text>`).join('');
  s += `<line class="sep" x1="${PAD_X}" y1="${HEAD_H + 6 + COLHEAD_H - .5}" x2="${b.w - PAD_X}" y2="${HEAD_H + 6 + COLHEAD_H - .5}"/>`;
  const addY = dataRowY(0);
  s += `<g class="drow empty-data-row" data-row="-1">`;
  if (interactive) s += `<rect class="hit" x="1" y="${addY - DATA_H / 2}" width="${b.w - 2}" height="${DATA_H}"/>`;
  s += `<text class="dcell null" x="${PAD_X}" y="${addY}">+ Add row</text></g>`;
  if (!cells.length) return s;
  cells.forEach((row, k) => {
    const y = dataRowY(k + 1);
    s += `<g class="drow" data-row="${k}">`;
    if (interactive) s += `<rect class="hit" x="1" y="${y - DATA_H / 2}" width="${b.w - 2}" height="${DATA_H}"/>`;
    row.forEach((cell, i) => {
      if (cell.key) s += `<rect class="dmark" style="--h:${cell.hue}" data-k="${esc(cell.key)}" x="${xs[i] - 5}" y="${y - DATA_H / 2 + 3}" width="${cws[i] + 10}" height="${DATA_H - 6}" rx="4"/>`;
      s += `<text class="dcell${kind(cols[i])}${cell.text === 'NULL' ? ' null' : ''}" x="${xs[i]}" y="${y}">${esc(cell.text)}</text>`;
    });
    s += '</g>';
  });
  return s;
}

function boxMarkup(t, b, interactive) {
  const { w, h } = b, r = 9;
  let s = `<g class="tbl${interactive && selected.has(t.name) ? ' sel' : ''}" data-t="${esc(t.name)}" transform="translate(${b.x},${b.y})">`;
  s += `<rect class="box" width="${w}" height="${h}" rx="${r}"/>`;
  s += `<path class="head" d="M0,${r}A${r},${r} 0 0 1 ${r},0H${w - r}A${r},${r} 0 0 1 ${w},${r}V${HEAD_H}H0Z"/>`;
  s += `<line class="sep" x1="0" y1="${HEAD_H + .5}" x2="${w}" y2="${HEAD_H + .5}"/>`;
  s += `<text class="title" x="${PAD_X}" y="${HEAD_H / 2}">${esc(t.name)}</text>`;
  if (b.data) return s + dataBoxBody(t, b, interactive) +
    `<rect class="outline" x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${r - .5}"/></g>`;
  shownCols(t).forEach((c, i) => {
    const row = b.rows[i], y = rowY(i);
    const cls = 'row' + (c.isPk ? ' pk' : '') + (c.ref && !c.target ? ' bad' : '');
    s += `<g class="${cls}" data-key="${esc(t.name + '.' + c.name)}" data-line="${c.line}">`;
    if (c.ref && !c.target) s += `<title>${esc(c.refError)}</title>`;
    if (interactive) s += `<rect class="hit" x="1" y="${y - ROW_H / 2}" width="${w - 2}" height="${ROW_H}"/>`;
    if (row.key) s += `<text class="key${row.key === 'FK' ? ' fk' : ''}" x="${PAD_X}" y="${y}">${row.key}</text>`;
    s += `<text class="name" x="${PAD_X + BADGE_W + GAP}" y="${y}">${esc(row.name)}</text>`;
    s += `<text class="type" x="${w - PAD_X}" y="${y}" text-anchor="end">${esc(row.type)}</text>`;
    if (row.flags) {
      const fx = w - PAD_X - textW(row.type, FONTS.type) - 6;
      s += `<text class="flags" x="${fx}" y="${y}" text-anchor="end">${row.flags}</text>`;
    }
    s += '</g>';
  });
  const foot = footLines(t), fy = footTop(b.rows.length);
  if (foot.length) s += `<line class="sep" x1="0" y1="${fy + .5}" x2="${w}" y2="${fy + .5}"/>`;
  foot.forEach((f, k) => {
    const y = fy + 3 + (k + .5) * FOOT_H;
    s += `<text class="flags" x="${PAD_X}" y="${y}">index</text>` +
      `<text class="type" x="${PAD_X + textW('index ', FONTS.flags)}" y="${y}">${esc(f)}</text>`;
  });
  s += `<rect class="outline" x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${r - .5}"/></g>`;
  return s;
}

// An arrow: rounded path, a hollow circle at the FK row, a filled 9×9 arrowhead at the target
// Notations. Every one connects the FK row to the referenced row; they differ only in
// what is drawn at the two ends. The FK end is the "many" side, the referenced end the "one".
const NOTATIONS = {
  arrows: 'Arrows (SQL)',
  crowsfoot: "Crow's foot",
  uml: 'UML',
  ratio: '1 : N',
};
// A small picture of each notation, for its button and menu
const NOTATION_ICONS = {
  arrows: '<path d="M1.5 8h12"/><path d="M10.5 5 13.5 8l-3 3"/>',
  crowsfoot: '<path d="M1.5 8h13M4 5v6M10 8l4.5-4M10 8l4.5 4"/>',
  uml: '<path d="M1.5 11.5h13"/><text x="1.5" y="8.5">1</text><text x="10" y="11" class="big">*</text>',
  ratio: '<text x="8" y="11" text-anchor="middle">1:N</text>',
};
const notationIcon = n => `<svg width="16" height="16" class="ico thin notation-ico" aria-hidden="true">${NOTATION_ICONS[n]}</svg>`;

// Crow's foot symbols at an end: x,y on the box edge, d = direction away from the box,
// h = half height (smaller when several arrows end on the same row)
const crowOne = (x, y, d, h) => `M${x + 6 * d},${y - h}V${y + h}M${x + 10 * d},${y - h}V${y + h}`;       // ||  exactly one
const crowZeroOne = (x, y, d, h) => `M${x + 7 * d},${y - h}V${y + h}`;                                     // o|  (ring added below)
const crowMany = (x, y, d, h) => `M${x},${y - h}L${x + 10 * d},${y}L${x},${y + h}`;                       // <   (ring added below)
const ring = (x, y, d, h) => `<circle class="sym-o" cx="${x + 15 * d}" cy="${y}" r="${h > 4 ? 3.5 : 2.5}"/>`;

// UML / 1 : N labels. Each end's label tries above and below its line (then a bit
// further out) and takes the first spot that touches no line and no other label.
function labelTexts(e) {
  return state.notation === 'uml'
    ? [e.nullable ? '0..1' : '1', e.unique ? '0..1' : '*']      // referenced end, FK end
    : ['1', e.unique ? '1' : 'N'];
}
function placeLabels(edges) {
  const CHAR_W = 6.8, H = 11;
  const segs = edges.flatMap(e => e.points.slice(1).map((p, i) => [e.points[i], p]));
  const hitsSeg = r => segs.some(([[x1, y1], [x2, y2]]) =>
    Math.max(x1, x2) >= r.x && Math.min(x1, x2) <= r.x + r.w && Math.max(y1, y2) >= r.y && Math.min(y1, y2) <= r.y + r.h);
  const taken = [];
  const overlaps = r => taken.some(q => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
  for (const e of edges) {
    const pts = e.points, n = pts.length;
    const [target, fk] = labelTexts(e);
    e.labels = [[pts[n - 1], pts[n - 2], target], [pts[0], pts[1], fk]].map(([[x, y], [nx], text]) => {
      const d = Math.sign(nx - x) || 1, w = text.length * CHAR_W;
      const spot = (dx, above) => {
        const lx = x + dx * d, ly = above ? y - 8 : y + 15;
        return { x: lx, y: ly, anchor: d > 0 ? 'start' : 'end', text, box: { x: d > 0 ? lx : lx - w, y: ly - H + 2, w, h: H } };
      };
      const tries = [spot(9, true), spot(9, false), spot(24, true), spot(24, false)];
      const l = tries.find(t => !hitsSeg(t.box) && !overlaps(t.box)) ?? tries.find(t => !overlaps(t.box)) ?? tries[0];
      taken.push(l.box);
      return l;
    });
  }
}

function endMarks(e) {
  const pts = e.points, n = pts.length;
  const [sx, sy] = pts[0], [tx, ty] = pts[n - 1];
  const sd = Math.sign(pts[1][0] - sx) || 1, td = Math.sign(pts[n - 2][0] - tx) || -1;
  const labels = () => e.labels.map(l =>
    `<text class="mult" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}">${l.text}</text>`).join('');
  switch (state.dataView ? 'arrows' : state.notation) {
    case 'crowsfoot': {
      const th = e.small ? 3.5 : 6;
      // referenced end: exactly one, or zero-or-one when the FK may be NULL
      let s = `<path class="sym" d="${e.nullable ? crowZeroOne(tx, ty, td, th) : crowOne(tx, ty, td, th)}"/>`;
      if (e.nullable) s += ring(tx, ty, td, th);
      // FK end: zero-or-many, or zero-or-one when the FK is unique (1-1)
      s += `<path class="sym" d="${e.unique ? crowZeroOne(sx, sy, sd, 6) : crowMany(sx, sy, sd, 6)}"/>` + ring(sx, sy, sd, 6);
      return s;
    }
    case 'uml':
      return labels();
    case 'ratio':
      return labels();
    default: { // arrows: a hollow circle at the FK row, an arrowhead at the referenced row
      return `<path class="ahead" d="M${tx},${ty}L${tx + 9 * td},${ty - 4.5}L${tx + 9 * td},${ty + 4.5}Z"/>` +
        `<circle class="start" cx="${sx}" cy="${sy}" r="3"/>`;
    }
  }
}

function edgeMarkup(e, interactive) {
  let s = `<g class="edge-g" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-ft="${esc(e.fromTable)}" data-tt="${esc(e.toTable)}">`;
  if (interactive) s += `<path class="edge-hit" d="${e.d}"/>`;
  s += `<path class="edge${e.implicit ? ' implicit' : ''}" d="${e.d}"/>` + endMarks(e) + '</g>';
  return s;
}

function diagramMarkup(interactive) {
  let s = '';
  for (const [t, b] of geometry.boxes) s += boxMarkup(t, b, interactive);
  for (const e of geometry.edges) s += edgeMarkup(e, interactive);
  for (const l of geometry.bundles ?? []) {
    s += `<line class="bundle" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke-width="${1.4 * l.n}"/>`;
  }
  return s;
}

function drawDiagram() {
  computeGeometry();
  vp.innerHTML = diagramMarkup(true);
  $('#emptyState').hidden = model.tables.length > 0;
  if (hoverTable) highlightTable(hoverTable);
  showSelectHint();
  if (revealName) { reveal(revealName); revealName = null; }
}

// Hovering a table highlights its arrows (drawn on top); hovering an arrow highlights it
let hoverTable = null;
function setHighlight(edgeEls) {
  vp.querySelectorAll('.edge-g.hl').forEach(el => el.classList.remove('hl'));
  for (const g of edgeEls) {
    g.classList.add('hl');
    g.parentNode.appendChild(g); // bring to front
  }
}
function highlightTable(name) {
  setHighlight([...vp.querySelectorAll('.edge-g')].filter(g => g.dataset.ft === name || g.dataset.tt === name));
}
svg.addEventListener('mouseover', e => {
  if (drag) return;
  const tbl = e.target.closest('.tbl'), edge = e.target.closest('.edge-g');
  hoverTable = tbl ? tbl.dataset.t : null;
  // data view: hovering a row outlines its coloured cells and every cell with the same colour key
  const keys = new Set([...(e.target.closest('.drow')?.querySelectorAll('.dmark') ?? [])].map(m => m.dataset.k));
  vp.querySelectorAll('.dmark').forEach(m => m.classList.toggle('hl', keys.has(m.dataset.k)));
  if (edge) setHighlight([edge]);
  else if (tbl) highlightTable(tbl.dataset.t);
  else setHighlight([]);
});
svg.addEventListener('mouseleave', () => { hoverTable = null; setHighlight([]); });

// ─── Pan, zoom, drag ─────────────────────────────────────────────────────────

const view = { tx: 0, ty: 0, s: 1 };
const ZOOM_MIN = 0.25, ZOOM_MAX = 2.5;
const CARD_TOP = 64, CARD_BOTTOM = 56; // room kept for the floating toolbars

function applyView() {
  vp.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.s})`);
  svg.style.backgroundSize = `${20 * view.s}px ${20 * view.s}px`;
  svg.style.backgroundPosition = `${view.tx}px ${view.ty}px`;
  $('#zoomLabel').textContent = Math.round(view.s * 100) + '%';
  saveState(); // each diagram remembers its pan/zoom (the save is debounced)
}
function toWorld(e) {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.tx) / view.s, y: (e.clientY - r.top - view.ty) / view.s };
}
function zoomTo(s, cx, cy) {
  s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
  view.tx = cx - (cx - view.tx) * (s / view.s);
  view.ty = cy - (cy - view.ty) * (s / view.s);
  view.s = s;
  applyView();
}
const zoomAt = (cx, cy, k) => zoomTo(view.s * k, cx, cy);

// The middle of what's on screen, in diagram coordinates (where unconnected new tables go)
function viewCenter() {
  const r = svg.getBoundingClientRect();
  if (!r.width) return null;
  return { x: (r.width / 2 - view.tx) / view.s, y: (r.height / 2 - view.ty) / view.s };
}

// Pan just enough to show a table's box
function reveal(name) {
  const t = model.tables.find(t => t.name === name), b = t && geometry.boxes.get(t);
  const r = svg.getBoundingClientRect();
  if (!b || !r.width) return;
  const m = 30;
  const x0 = b.x * view.s + view.tx, y0 = b.y * view.s + view.ty;
  const x1 = x0 + b.w * view.s, y1 = y0 + b.h * view.s;
  if (x0 < m) view.tx += m - x0; else if (x1 > r.width - m) view.tx -= Math.min(x1 - (r.width - m), x0 - m);
  if (y0 < CARD_TOP) view.ty += CARD_TOP - y0;
  else if (y1 > r.height - CARD_BOTTOM) view.ty -= Math.min(y1 - (r.height - CARD_BOTTOM), y0 - CARD_TOP);
  applyView();
}

function contentBounds(pad) {
  const bs = [...geometry.boxes.values()];
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map(b => b.x)) - pad, y0 = Math.min(...bs.map(b => b.y)) - pad;
  const x1 = Math.max(...bs.map(b => b.x + b.w)) + pad, y1 = Math.max(...bs.map(b => b.y + b.h)) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// Is the whole diagram on screen (clear of the floating toolbars)?
function diagramVisible() {
  const bb = contentBounds(0), r = svg.getBoundingClientRect();
  if (!bb || !r.width) return false;
  const x0 = bb.x * view.s + view.tx, y0 = bb.y * view.s + view.ty;
  return x0 >= 0 && y0 >= CARD_TOP - 20 && x0 + bb.w * view.s <= r.width && y0 + bb.h * view.s <= r.height - CARD_BOTTOM + 20;
}

function fit(maxZoom = 1.25) {
  const r = svg.getBoundingClientRect();
  const bb = contentBounds(20);
  if (!r.width) return;
  if (!bb) { view.s = 1; view.tx = 40; view.ty = 80; applyView(); return; }
  view.s = Math.max(ZOOM_MIN, Math.min(maxZoom, (r.width - 96) / bb.w, (r.height - CARD_TOP - CARD_BOTTOM - 30) / bb.h));
  view.tx = (r.width - bb.w * view.s) / 2 - bb.x * view.s;
  view.ty = CARD_TOP + (r.height - CARD_TOP - CARD_BOTTOM - bb.h * view.s) / 2 - bb.y * view.s;
  applyView();
}

// Selected tables move together. Shift/⌘-click toggles a table; shift-drag the canvas
// selects every table the box touches; a plain click (or Escape) clears the selection.
let selected = new Set();
function setSelected(names) {
  selected = new Set(names);
  vp.querySelectorAll('.tbl').forEach(g => g.classList.toggle('sel', selected.has(g.dataset.t)));
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && selected.size) setSelected([]); });

// One-time hint about moving and selecting tables, once there's more than one table
function showSelectHint() {
  $('#selectHint').hidden = store.get('selectHintSeen', false) || model.tables.length < 2 || !$('#storageNotice').hidden;
}
$('#selectHintOk').onclick = () => { store.set('selectHintSeen', true); $('#selectHint').hidden = true; };

let drag = null, frame = 0;
svg.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  closeMenus();
  const g = e.target.closest('.tbl'), multi = e.shiftKey || e.metaKey || e.ctrlKey;
  svg.setPointerCapture(e.pointerId);
  if (g && multi) {
    const n = g.dataset.t, s = new Set(selected);
    s.has(n) ? s.delete(n) : s.add(n);
    setSelected(s);
    drag = { kind: 'none' };
  } else if (g) {
    const w = toWorld(e), name = g.dataset.t;
    if (!selected.has(name)) setSelected([]);
    const names = selected.has(name) ? [...selected].filter(n => pos[n]) : [name];
    drag = { kind: 'box', name, w, start: Object.fromEntries(names.map(n => [n, { ...pos[n] }])),
             sx: e.clientX, sy: e.clientY, moved: false, line: e.target.closest('[data-line]')?.dataset.line ?? null };
  } else if (multi) {
    const m = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    m.setAttribute('class', 'marquee');
    svg.appendChild(m);
    drag = { kind: 'marquee', w: toWorld(e), el: m, base: new Set(selected) };
  } else {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
    svg.classList.add('panning');
  }
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) >= 4) drag.moved = true;
    view.tx = drag.tx + e.clientX - drag.sx;
    view.ty = drag.ty + e.clientY - drag.sy;
    applyView();
    return;
  }
  if (drag.kind === 'marquee') {
    const a = drag.w, b = toWorld(e);
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const at = { x: x0 * view.s + view.tx, y: y0 * view.s + view.ty, width: (x1 - x0) * view.s, height: (y1 - y0) * view.s };
    for (const k in at) drag.el.setAttribute(k, at[k]);
    const hit = [...geometry.boxes].filter(([, r]) => r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0).map(([t]) => t.name);
    setSelected([...drag.base, ...hit]);
    return;
  }
  if (drag.kind !== 'box') return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  if (!drag.moved) { histBegin('move'); svg.classList.add('dragging'); }
  drag.moved = true;
  const w = toWorld(e);
  const dx = Math.round((w.x - drag.w.x) / 10) * 10, dy = Math.round((w.y - drag.w.y) / 10) * 10;
  for (const [n, p] of Object.entries(drag.start)) pos[n] = { x: p.x + dx, y: p.y + dy };
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; drawDiagram(); });
});
function endDrag() {
  if (!drag) return;
  if (drag.kind === 'box') {
    if (drag.moved) { saveDoc(); histCommit(); }
    else {
      if (drag.line) selectLine(+drag.line);
      else {
        const t = model.tables.find(t => t.name === drag.name);
        if (t) selectLine(t.line);
      }
    }
  } else if (drag.kind === 'marquee') drag.el.remove();
  else if (drag.kind === 'pan' && !drag.moved) setSelected([]);
  svg.classList.remove('panning', 'dragging');
  drag = null;
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);
svg.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const r = svg.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
  } else {
    view.tx -= e.deltaX;
    view.ty -= e.deltaY;
    applyView();
  }
}, { passive: false });

const viewMiddle = () => { const r = svg.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
$('#zoomIn').onclick = () => zoomTo(view.s * 1.2, ...viewMiddle());
$('#zoomOut').onclick = () => zoomTo(view.s / 1.2, ...viewMiddle());
$('#zoomLabel').onclick = () => zoomTo(1, ...viewMiddle());
$('#fitBtn').onclick = () => fit(presentView ? 2 : undefined);
// Rearrange every table (the Auto layout button, loading an example, repairing overlaps)
function autoLayout() {
  histRecord('layout', () => arrangeAll(model.tables, geometry.dims));
  saveDoc();
  drawDiagram();
}
$('#layoutBtn').onclick = () => { autoLayout(); fit(); };

// Do any two boxes overlap? (e.g. positions saved while boxes had other sizes)
function boxesOverlap() {
  const bs = [...geometry.boxes.values()];
  return bs.some((p, i) => bs.slice(i + 1).some(q =>
    p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y));
}

// ─── Export ──────────────────────────────────────────────────────────────────

// The fonts, embedded, so an exported SVG/PNG looks the same without Geist installed.
// Only the latin subsets (covers å ä ö). Fetched once; without network the export
// simply falls back to system fonts.
let fontCssPromise = null;
function embeddedFontCss() {
  fontCssPromise ??= (async () => {
    try {
      const css = await (await fetch('https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Geist+Mono:wght@400;600&display=swap')).text();
      const faces = css.split('/*').filter(b => /^\s*latin(-ext)?\s*\*\//.test(b)).map(b => b.slice(b.indexOf('@font-face')));
      const out = await Promise.all(faces.map(async face => {
        const url = face.match(/url\((https:[^)]+)\)/)?.[1];
        if (!url) return '';
        const buf = await (await fetch(url)).arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return face.replace(url, 'data:font/woff2;base64,' + btoa(bin));
      }));
      return out.join('\n');
    } catch {
      return '';
    }
  })();
  return fontCssPromise;
}

// An export uses the light variant of the chosen theme on white (print-ready)
const exportVars = () => Object.entries({ ...themeVars(themeKey(), false), canvas: '#fff' }).map(([k, v]) => `--${k}: ${v};`).join(' ');

async function exportMarkup() {
  const bb = contentBounds(30);
  if (!bb) return null;
  const fonts = await embeddedFontCss();
  return {
    bb,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${bb.w}" height="${bb.h}" viewBox="${bb.x} ${bb.y} ${bb.w} ${bb.h}"` +
      `><style>${fonts}svg { ${exportVars()} }${DIAGRAM_CSS}</style>` +
      `<rect x="${bb.x}" y="${bb.y}" width="${bb.w}" height="${bb.h}" fill="#fff"/>${diagramMarkup(false)}</svg>`,
  };
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// files are named after the tab: "School database" → school-database.svg
const exportName = ext => ((activeDoc()?.name ?? 'diagram').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'diagram') + '.' + ext;

async function exportSvg() {
  const m = await exportMarkup();
  if (!m) return toast('Nothing to export yet');
  const name = exportName('svg');
  download(new Blob([m.svg], { type: 'image/svg+xml' }), name);
  toast(`Saved ${name}`);
}
// The diagram as a PNG at 2× (for crisp slides)
async function pngBlob() {
  const m = await exportMarkup();
  if (!m) return null;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(m.svg);
  await img.decode();
  const k = 2, c = document.createElement('canvas');
  c.width = m.bb.w * k;
  c.height = m.bb.h * k;
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  ctx.drawImage(img, 0, 0);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
async function exportPng() {
  const b = await pngBlob();
  if (!b) return toast('Nothing to export yet');
  const name = exportName('png');
  download(b, name);
  toast(`Saved ${name}`);
}
// Copy the PNG to the clipboard, for pasting into slides. The blob is handed over as a
// promise so Safari still counts it as part of the click.
async function copyImage() {
  if (!model.tables.length) return toast('Nothing to copy yet');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
    toast('Image copied to clipboard');
  } catch {
    toast('Could not copy. Use Export → PNG image instead.');
  }
}
