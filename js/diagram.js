'use strict';

// ─── Diagram geometry ────────────────────────────────────────────────────────

const HEAD_H = 30, ROW_H = 26, PAD_X = 10, TOP_PAD = 4, BOTTOM_PAD = 6, MIN_W = 130;
const FONT = '14px Helvetica, Arial, sans-serif';
const measureCtx = document.createElement('canvas').getContext('2d');
measureCtx.font = FONT;
const widthCache = new Map();
function textW(s) {
  if (!widthCache.has(s)) widthCache.set(s, measureCtx.measureText(s).width);
  return widthCache.get(s);
}

function rowLabel(c) {
  let s = `${c.name}:${c.type ?? c.effType}`;
  if (c.isPk) s += ' (PK)';
  if (c.nullable) s += ' (NULL)';
  if (c.unique) s += ' (UNIQUE)';
  return s;
}

function measureTable(t) {
  const labels = t.cols.map(rowLabel);
  const w = Math.ceil(Math.max(MIN_W, textW(t.name) + 48, ...labels.map(l => textW(l) + 2 * PAD_X + 4)));
  const h = HEAD_H + TOP_PAD + Math.max(1, t.cols.length) * ROW_H + BOTTOM_PAD;
  return { w, h, labels };
}
const rowY = i => HEAD_H + TOP_PAD + i * ROW_H + ROW_H / 2;

// Positions for tables that don't have one yet (see layout.js for how a spot is chosen).
// The newest auto-placed table "floats": until it is dragged or another table is added,
// it moves to a better spot whenever its arrows change (e.g. while its FKs are being typed).
let revealName = null;

function ensurePositions(tables, dims) {
  const names = new Set(tables.map(t => t.name));
  let changed = false;
  if (tables.length && !tables.some(t => pos[t.name])) {
    arrangeAll(tables, dims);
    changed = true;
  } else {
    // a renamed table keeps the spot of the name it replaced
    tables.forEach((t, i) => {
      const old = prevNames[i];
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
  if (changed) store.set('pos', pos);
}

// Arrows leave the FK row horizontally and enter the Id row horizontally.
// In between they are routed orthogonally around the boxes (A* on a grid),
// with a cost for every bend. An arrow may never run through another arrow's end point, and running
// along a lane used by an arrow to a *different* Id is very expensive (it would look like it points there).
const ROUTE = { GAP: 30, MARGIN: 10, STUB: 20, GRID: 10, BEND: 40, SHARE_OTHER: 60, CROSS: 30 };

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

function routeEdges(edges, boxes) {
  if (!edges.length) return;
  edges.forEach(e => chooseSides(e));
  const { MARGIN, GRID, BEND, SHARE_OTHER, CROSS } = ROUTE;
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
  const g = new Float64Array(size), prev = new Int32Array(size);

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
  for (const e of edges) e.d = pathD(e.points);

  function astar(s, t, e) {
    const dir0 = e.outDir, dirEnd = e.inDir, myT = 'T:' + e.to;
    const shareCost = key => {
      const u = used.get(key);
      if (u) for (const to of u) if (to !== e.to) return SHARE_OTHER;
      return 0;
    };
    const crossCost = n => {
      const u = usedNodes.get(n);
      if (u) for (const to of u) if (to !== e.to) return CROSS;
      return 0;
    };
    g.fill(Infinity);
    const tx = xs[t % nx], ty = ys[Math.floor(t / nx)];
    const h = n => Math.abs(xs[n % nx] - tx) + Math.abs(ys[Math.floor(n / nx)] - ty);
    const heap = new MinHeap();
    const s0 = s * 4 + dir0;
    g[s0] = 0;
    prev[s0] = -1;
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
        const cost = gc + len * (1 + shareCost(segKey(n, m))) + crossCost(m) + (nd === d ? 0 : BEND);
        relax(st, m * 4 + nd, cost, h(m));
      }
    }
    return null;

    function relax(from, to, cost, hh) {
      if (cost >= g[to]) return;
      g[to] = cost;
      prev[to] = from;
      heap.push(cost + hh, to);
    }
  }
}

function pathD(points) {
  // drop points in the middle of straight runs
  const p = points.filter((q, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const a = points[i - 1], b = points[i + 1];
    return !((a[0] === q[0] && q[0] === b[0]) || (a[1] === q[1] && q[1] === b[1]));
  });
  return 'M' + p.map(q => q[0] + ',' + q[1]).join('L');
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

// Colors come from the page's --d-* variables (dark mode). A standalone export
// has no such variables, so it always falls back to the light, print-ready values.
const DIAGRAM_CSS = `
.bg { fill: var(--d-box, #fff); }
.head { fill: var(--d-head, #fff); }
.outline { fill: none; stroke: var(--d-stroke, #000); stroke-width: 1; }
.sep { stroke: var(--d-stroke, #000); stroke-width: 1; }
.ico { fill: var(--d-box, #fff); stroke: var(--d-ico, #999); stroke-width: 1; }
.ico-l { stroke: var(--d-ico, #666); stroke-width: 1; }
text { font: ${FONT}; fill: var(--d-text, #000); dominant-baseline: central; }
.title { text-anchor: middle; }
.row.bad text { fill: var(--d-bad, #d93025); }
.row .hit { fill: transparent; }
.row.hl .hit { fill: var(--d-hl-row, rgba(15, 148, 136, .14)); }
.edge { fill: none; stroke: var(--d-stroke, #000); stroke-width: 1.2; }
.edge.hl { stroke: var(--d-hl, #0f9488); stroke-width: 2.4; }
.edge-hit { fill: none; stroke: transparent; stroke-width: 9; }
.arrowhead { fill: var(--d-stroke, #000); }
.arrowhead.hl { fill: var(--d-hl, #0f9488); }
.style-green .head { fill: var(--d-green-head, #d5e8d4); }
.style-green .outline, .style-green .sep { stroke: var(--d-green-stroke, #82b366); }
`;
const DEFS = `
<marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
  <path class="arrowhead" d="M0,0 L10,5 L0,10 L3,5 z"/></marker>
<marker id="ah-hl" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
  <path class="arrowhead hl" d="M0,0 L10,5 L0,10 L3,5 z"/></marker>`;

const svg = $('#canvas'), vp = $('#vp');
$('#diagramCss').textContent = DIAGRAM_CSS;
$('#defs').innerHTML = DEFS;

let geometry = { boxes: new Map(), edges: [] };

function computeGeometry() {
  const tables = model.tables;
  const dims = new Map(tables.map(t => [t, measureTable(t)]));
  ensurePositions(tables, dims);
  const boxes = new Map(tables.map(t => {
    const d = dims.get(t);
    return [t, { x: pos[t.name].x, y: pos[t.name].y, w: d.w, h: d.h, labels: d.labels }];
  }));
  const edges = [];
  for (const t of tables) {
    t.cols.forEach((c, i) => {
      if (!c.target) return;
      const a = boxes.get(t), b = boxes.get(c.target);
      edges.push({
        a, b,
        from: t.name + '.' + c.name,
        to: c.target.name + '.' + c.targetCol.name,
        sy: a.y + rowY(i),
        ty: b.y + rowY(c.target.cols.indexOf(c.targetCol)),
      });
    });
  }
  routeEdges(edges, [...boxes.values()]);
  geometry = { boxes, edges, dims };
}

function diagramMarkup(interactive) {
  let s = '';
  for (const [t, b] of geometry.boxes) {
    s += `<g class="tbl" data-t="${esc(t.name)}" transform="translate(${b.x},${b.y})">`;
    s += `<rect class="bg" width="${b.w}" height="${b.h}"/>`;
    s += `<rect class="head" width="${b.w}" height="${HEAD_H}"/>`;
    s += `<line class="sep" x1="0" y1="${HEAD_H}" x2="${b.w}" y2="${HEAD_H}"/>`;
    s += `<rect class="ico" x="6.5" y="6.5" width="9" height="9"/><line class="ico-l" x1="8.5" y1="11" x2="13.5" y2="11"/>`;
    s += `<text class="title" x="${b.w / 2}" y="${HEAD_H / 2}">${esc(t.name)}</text>`;
    t.cols.forEach((c, i) => {
      const bad = c.ref && !c.target;
      s += `<g class="row${bad ? ' bad' : ''}" data-key="${esc(t.name + '.' + c.name)}" data-line="${c.line}">`;
      if (bad) s += `<title>${esc(c.refError)}</title>`;
      if (interactive) s += `<rect class="hit" x="1" y="${rowY(i) - ROW_H / 2}" width="${b.w - 2}" height="${ROW_H}"/>`;
      s += `<text x="${PAD_X}" y="${rowY(i)}">${esc(b.labels[i])}</text></g>`;
    });
    s += `<rect class="outline" x="0.5" y="0.5" width="${b.w - 1}" height="${b.h - 1}"/></g>`;
  }
  for (const e of geometry.edges) {
    s += `<g class="edge-g" data-from="${esc(e.from)}" data-to="${esc(e.to)}">`;
    if (interactive) s += `<path class="edge-hit" d="${e.d}"/>`;
    s += `<path class="edge" d="${e.d}" marker-end="url(#ah)"/></g>`;
  }
  return s;
}

function drawDiagram() {
  computeGeometry();
  vp.innerHTML = diagramMarkup(true);
  if (revealName) { reveal(revealName); revealName = null; }
}

// Hovering a row or an arrow highlights the arrow and both ends
function setHighlight(keys, edgeEls) {
  vp.querySelectorAll('.hl').forEach(el => el.classList.remove('hl'));
  vp.querySelectorAll('.edge[marker-end="url(#ah-hl)"]').forEach(el => el.setAttribute('marker-end', 'url(#ah)'));
  for (const g of edgeEls) {
    const p = g.querySelector('.edge');
    p.classList.add('hl');
    p.setAttribute('marker-end', 'url(#ah-hl)');
    g.parentNode.appendChild(g); // bring to front
  }
  for (const k of keys) vp.querySelectorAll(`.row[data-key="${CSS.escape(k)}"]`).forEach(r => r.classList.add('hl'));
}
svg.addEventListener('mouseover', e => {
  if (drag) return;
  const row = e.target.closest('.row'), edge = e.target.closest('.edge-g');
  if (edge) {
    setHighlight([edge.dataset.from, edge.dataset.to], [edge]);
  } else if (row) {
    const k = row.dataset.key;
    const els = [...vp.querySelectorAll('.edge-g')].filter(g => g.dataset.from === k || g.dataset.to === k);
    setHighlight(new Set([k, ...els.flatMap(g => [g.dataset.from, g.dataset.to])]), els);
  } else {
    setHighlight([], []);
  }
});

// ─── Pan, zoom, drag ─────────────────────────────────────────────────────────

const view = { tx: 0, ty: 0, s: 1 };
function applyView() {
  vp.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.s})`);
  svg.style.backgroundSize = `${20 * view.s}px ${20 * view.s}px`;
  svg.style.backgroundPosition = `${view.tx}px ${view.ty}px`;
}
function toWorld(e) {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.tx) / view.s, y: (e.clientY - r.top - view.ty) / view.s };
}
function zoomAt(cx, cy, k) {
  const s = Math.min(4, Math.max(0.15, view.s * k));
  view.tx = cx - (cx - view.tx) * (s / view.s);
  view.ty = cy - (cy - view.ty) * (s / view.s);
  view.s = s;
  applyView();
}
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
  const m = 30, top = 50; // keep clear of the toolbar
  const x0 = b.x * view.s + view.tx, y0 = b.y * view.s + view.ty;
  const x1 = x0 + b.w * view.s, y1 = y0 + b.h * view.s;
  if (x0 < m) view.tx += m - x0; else if (x1 > r.width - m) view.tx -= Math.min(x1 - (r.width - m), x0 - m);
  if (y0 < top) view.ty += top - y0; else if (y1 > r.height - m) view.ty -= Math.min(y1 - (r.height - m), y0 - top);
  applyView();
}

function contentBounds(pad) {
  const bs = [...geometry.boxes.values()];
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map(b => b.x)) - pad, y0 = Math.min(...bs.map(b => b.y)) - pad;
  const x1 = Math.max(...bs.map(b => b.x + b.w)) + pad, y1 = Math.max(...bs.map(b => b.y + b.h)) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function fit() {
  const bb = contentBounds(50);
  const r = svg.getBoundingClientRect();
  if (!bb || !r.width) return;
  view.s = Math.min(1.4, r.width / bb.w, (r.height - 40) / bb.h);
  view.tx = (r.width - bb.w * view.s) / 2 - bb.x * view.s;
  view.ty = 40 + (r.height - 40 - bb.h * view.s) / 2 - bb.y * view.s;
  applyView();
}

let drag = null, frame = 0;
svg.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const g = e.target.closest('.tbl');
  svg.setPointerCapture(e.pointerId);
  if (g) {
    const w = toWorld(e), p = pos[g.dataset.t];
    drag = { kind: 'box', name: g.dataset.t, dx: w.x - p.x, dy: w.y - p.y, sx: e.clientX, sy: e.clientY,
             moved: false, line: e.target.closest('[data-line]')?.dataset.line ?? null };
  } else {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
    svg.classList.add('panning');
  }
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    view.tx = drag.tx + e.clientX - drag.sx;
    view.ty = drag.ty + e.clientY - drag.sy;
    applyView();
    return;
  }
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  drag.moved = true;
  const w = toWorld(e);
  pos[drag.name] = { x: Math.round((w.x - drag.dx) / 10) * 10, y: Math.round((w.y - drag.dy) / 10) * 10 };
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; drawDiagram(); });
});
function endDrag() {
  if (!drag) return;
  if (drag.kind === 'box') {
    if (drag.moved) store.set('pos', pos);
    else if (drag.line) selectLine(+drag.line);
    else {
      const t = model.tables.find(t => t.name === drag.name);
      if (t) selectLine(t.line);
    }
  }
  svg.classList.remove('panning');
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

const zoomCenter = k => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, k); };
$('#zoomIn').onclick = () => zoomCenter(1.2);
$('#zoomOut').onclick = () => zoomCenter(1 / 1.2);
$('#fitBtn').onclick = fit;
$('#layoutBtn').onclick = () => {
  arrangeAll(model.tables, geometry.dims);
  store.set('pos', pos);
  drawDiagram();
  fit();
};

// ─── Style and export ────────────────────────────────────────────────────────

function applyStyle() {
  svg.classList.toggle('style-green', state.style === 'green');
  document.querySelectorAll('#styleSeg button').forEach(b => b.classList.toggle('on', b.dataset.style === state.style));
}
$('#styleSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  state.style = b.dataset.style;
  applyStyle();
  saveState();
});

function exportMarkup() {
  const bb = contentBounds(30);
  if (!bb) return null;
  return {
    bb,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${bb.w}" height="${bb.h}" viewBox="${bb.x} ${bb.y} ${bb.w} ${bb.h}"` +
      ` class="${state.style === 'green' ? 'style-green' : ''}"><style>${DIAGRAM_CSS}</style><defs>${DEFS}</defs>` +
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
const exportName = ext => (model.tables[0]?.name ?? 'diagram').toLowerCase() + '-diagram.' + ext;
$('#svgBtn').onclick = () => {
  const m = exportMarkup();
  if (m) download(new Blob([m.svg], { type: 'image/svg+xml' }), exportName('svg'));
};
$('#pngBtn').onclick = () => {
  const m = exportMarkup();
  if (!m) return;
  const img = new Image();
  img.onload = () => {
    const k = 2, c = document.createElement('canvas');
    c.width = m.bb.w * k;
    c.height = m.bb.h * k;
    const ctx = c.getContext('2d');
    ctx.scale(k, k);
    ctx.drawImage(img, 0, 0);
    c.toBlob(b => download(b, exportName('png')));
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(m.svg);
};
