'use strict';

// ─── Layout: where the boxes go ──────────────────────────────────────────────
// Placing a single new table (the others stay put) uses a cost function; "Auto layout"
// arranges whole groups in columns instead (below).
// Cost of a spot = estimated length of its arrows
//                + a big penalty for arrows through boxes (or the box covering arrows)
//                + a penalty for crossing other arrows, and for tiny jogs (rows almost level)
//                + a small pull toward the rest of the diagram
//                + growth of the diagram's longer side (relative to the canvas shape), so it
//                  becomes a compact block instead of one long row.

const LAYOUT = { GAP_X: 60, GAP_Y: 40, STEP: 20, THROUGH_BOX: 600, CROSSING: 80, PULL: 0.15, GROW: 0.8, JOG: 60 };

// Width / height of the canvas; the diagram should roughly take that shape
function canvasAspect() {
  const r = svg.getBoundingClientRect();
  return r.width && r.height ? Math.min(2.5, Math.max(0.8, r.width / r.height)) : 1.5;
}
// The room a diagram has on the canvas at the current zoom, in diagram units (as fit() measures it)
function canvasRoom() {
  const r = svg.getBoundingClientRect();
  return r.width ? { w: (r.width - 96) / view.s, h: (r.height - CARD_TOP - CARD_BOTTOM - 30) / view.s } : null;
}

// FK arrows between different tables, with row offsets inside each box
function layoutEdges(tables) {
  const out = [];
  for (const t of tables) {
    shownCols(t).forEach((c, i) => {
      if (!c.target || c.target === t) return;
      out.push({ from: t, to: c.target, fy: rowY(i), ty: rowY(shownCols(c.target).indexOf(c.targetCol)) });
    });
  }
  return out;
}

// The route an arrow will roughly take, using the router's choice of sides: three segments
function estimateRoute(a, fy, b, ty) {
  const e = { a, b, sy: a.y + fy, ty: b.y + ty };
  chooseSides(e);
  // same direction in and out: through the gap between the boxes; otherwise a loop on one side
  const mid = e.outDir === e.inDir ? (e.sx + e.tx) / 2 : e.outDir === 1 ? Math.min(e.sx, e.tx) : Math.max(e.sx, e.tx);
  const segs = [[e.x1, e.sy, mid, e.sy], [mid, e.sy, mid, e.ty], [mid, e.ty, e.x2, e.ty]];
  return { segs, len: Math.abs(e.x1 - mid) + Math.abs(e.sy - e.ty) + Math.abs(mid - e.x2) };
}

function segHitsRect([x1, y1, x2, y2], r) {
  if (y1 === y2) return y1 > r.y && y1 < r.y + r.h && Math.max(x1, x2) > r.x && Math.min(x1, x2) < r.x + r.w;
  return x1 > r.x && x1 < r.x + r.w && Math.max(y1, y2) > r.y && Math.min(y1, y2) < r.y + r.h;
}

function segsCross(s, u) {
  const sh = s[1] === s[3], uh = u[1] === u[3];
  if (sh === uh) { // parallel: only counts when they run along the same line
    if (sh) return s[1] === u[1] && Math.max(s[0], s[2]) > Math.min(u[0], u[2]) && Math.min(s[0], s[2]) < Math.max(u[0], u[2]);
    return s[0] === u[0] && Math.max(s[1], s[3]) > Math.min(u[1], u[3]) && Math.min(s[1], s[3]) < Math.max(u[1], u[3]);
  }
  const [h, v] = sh ? [s, u] : [u, s];
  return h[1] > Math.min(v[1], v[3]) && h[1] < Math.max(v[1], v[3]) && v[0] > Math.min(h[0], h[2]) && v[0] < Math.max(h[0], h[2]);
}

const tooClose = (a, b) =>
  a.x < b.x + b.w + LAYOUT.GAP_X && a.x + a.w + LAYOUT.GAP_X > b.x &&
  a.y < b.y + b.h + LAYOUT.GAP_Y && a.y + a.h + LAYOUT.GAP_Y > b.y;

const centerOf = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function bboxOf(rects) {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, w: Math.max(...rects.map(r => r.x + r.w)) - x, h: Math.max(...rects.map(r => r.y + r.h)) - y };
}

// Best free spot for table t, given the boxes already placed (Map table → rect).
// anchor: where an unconnected table should go (defaults to the middle of what's placed).
function bestSpot(t, placed, dims, edges, anchor = null) {
  const { w, h } = dims.get(t);
  const mine = edges.filter(e => (e.from === t && placed.has(e.to)) || (e.to === t && placed.has(e.from)));
  const otherSegs = edges
    .filter(e => e.from !== t && e.to !== t && placed.has(e.from) && placed.has(e.to))
    .flatMap(e => estimateRoute(placed.get(e.from), e.fy, placed.get(e.to), e.ty).segs);
  const rects = [...placed.values()];
  if (!rects.length) return { x: snap((anchor?.x ?? 40 + w / 2) - w / 2), y: snap((anchor?.y ?? 40 + h / 2) - h / 2), cost: 0 };

  const linked = mine.map(e => placed.get(e.from === t ? e.to : e.from));
  const all = bboxOf(rects), aspect = canvasAspect();
  const extent = (x0, y0, x1, y1) => Math.max(x1 - x0, (y1 - y0) * aspect);
  const extent0 = extent(all.x, all.y, all.x + all.w, all.y + all.h);
  const pullTo = linked.length ? centerOf(bboxOf(linked)) : anchor ?? centerOf(bboxOf(rects));
  const pull = linked.length ? LAYOUT.PULL : 1;

  const cost = (x, y) => {
    const me = { x, y, w, h };
    for (const r of rects) if (tooClose(me, r)) return Infinity;
    let c = 0;
    for (const e of mine) {
      const a = e.from === t ? me : placed.get(e.from), b = e.to === t ? me : placed.get(e.to);
      const route = estimateRoute(a, e.fy, b, e.ty);
      c += route.len;
      const dy = Math.abs(a.y + e.fy - (b.y + e.ty));
      if (dy > 0 && dy < 24) c += LAYOUT.JOG;
      for (const s of route.segs) {
        for (const r of rects) if (r !== a && r !== b && segHitsRect(s, r)) c += LAYOUT.THROUGH_BOX;
        for (const u of otherSegs) if (segsCross(s, u)) c += LAYOUT.CROSSING;
      }
    }
    for (const u of otherSegs) if (segHitsRect(u, me)) c += LAYOUT.THROUGH_BOX;
    const m = centerOf(me);
    const grow = extent(Math.min(x, all.x), Math.min(y, all.y), Math.max(x + w, all.x + all.w), Math.max(y + h, all.y + all.h)) - extent0;
    return c + pull * (Math.abs(m.x - pullTo.x) + Math.abs(m.y - pullTo.y)) + LAYOUT.GROW * grow;
  };

  let best = { cost: Infinity };
  const around = linked.length ? bboxOf(linked) : anchor ? { x: anchor.x, y: anchor.y, w: 0, h: 0 } : bboxOf(rects);
  // besides the grid, try the heights where an arrow's two rows are exactly level (a straight arrow)
  const levelYs = mine.map(e => e.from === t ? placed.get(e.to).y + e.ty - e.fy : placed.get(e.from).y + e.fy - e.ty);
  for (let grow = 1; grow <= 8 && best.cost === Infinity; grow *= 2) {
    const mx = (w + 200) * grow, my = (h + 200) * grow;
    const ys = [...levelYs];
    for (let y = snap(around.y - my); y <= around.y + around.h + my - h; y += LAYOUT.STEP) ys.push(y);
    for (let x = snap(around.x - mx); x <= around.x + around.w + mx - w; x += LAYOUT.STEP) {
      for (const y of ys) {
        const c = cost(x, y);
        if (c < best.cost) best = { x, y, cost: c };
      }
    }
  }
  if (best.cost === Infinity) { // nowhere free nearby: to the right of everything
    const bb = bboxOf(rects);
    best = { x: snap(bb.x + bb.w + LAYOUT.GAP_X * 2), y: snap(bb.y), cost: 0 };
  }
  return best;
}

// ─── Auto layout: tables in columns by FK direction ─────────────────────────
// Referenced tables go right, the tables pointing to them to the left, so arrows run
// sideways between neighbouring columns (a junction table sits between its two tables).
// Within a column tables are ordered like their neighbours (fewer crossings) and moved
// up or down so an FK row lines up with its PK row (straight arrows). Gaps grow with the
// number of arrows passing through. Finally neighbouring tables in a column are swapped,
// and lookup tables tucked above or below the table pointing to them, while that gives
// better arrows as actually drawn, or a block that fits the canvas without zooming out.
const AUTO = { COL_GAP: 90, ROW_GAP: 50, LANE: 16, COMP_GAP: 120, POLISH_MS: 400, OVERFLOW: 3 };

function arrangeAll(tables, dims) {
  if (!tables.length) return;
  const edges = layoutEdges(tables);
  const old = tables.map(t => pos[t.name]).filter(Boolean);
  if (state.dataView) return moveTo(packTight(tables, dims), old);

  // connected groups of tables, each laid out on its own; single tables go in a row below
  const nbrs = new Map(tables.map(t => [t, new Set()]));
  for (const e of edges) { nbrs.get(e.from).add(e.to); nbrs.get(e.to).add(e.from); }
  const seen = new Set(), groups = [];
  for (const t of tables) {
    if (seen.has(t)) continue;
    const g = [], queue = [t];
    seen.add(t);
    while (queue.length) {
      const u = queue.shift();
      g.push(u);
      for (const v of nbrs.get(u)) if (!seen.has(v)) { seen.add(v); queue.push(v); }
    }
    groups.push(g);
  }
  const deadline = performance.now() + AUTO.POLISH_MS;
  const blocks = groups.filter(g => g.length > 1).sort((a, b) => b.length - a.length)
    .map(g => layoutGroup(g, dims, edges.filter(e => g.includes(e.from)), deadline));
  const singles = groups.filter(g => g.length === 1).map(g => g[0]);

  // blocks side by side, single tables in rows underneath
  const placed = new Map();
  let x = 0, bottom = 0;
  for (const b of blocks) {
    for (const [t, r] of b.placed) placed.set(t, { ...r, x: r.x + x });
    x += b.w + AUTO.COMP_GAP;
    bottom = Math.max(bottom, b.h);
  }
  const rowW = Math.max(x - AUTO.COMP_GAP, 900);
  let sx = 0, sy = blocks.length ? bottom + AUTO.COMP_GAP : 0, rowH = 0;
  for (const t of singles) {
    const { w, h } = dims.get(t);
    if (sx && sx + w > rowW) { sx = 0; sy += rowH + AUTO.ROW_GAP; rowH = 0; }
    placed.set(t, { x: sx, y: sy, w, h });
    sx += w + AUTO.COL_GAP;
    rowH = Math.max(rowH, h);
  }

  moveTo(placed, old);
}

// Keep the diagram where it was on the canvas; a brand new one goes in the middle of the view
function moveTo(placed, old) {
  const bb = bboxOf([...placed.values()]), mid = viewCenter();
  const origin = old.length ? { x: Math.min(...old.map(p => p.x)), y: Math.min(...old.map(p => p.y)) }
    : mid ? { x: mid.x - bb.w / 2, y: mid.y - bb.h / 2 } : { x: 40, y: 40 };
  const dx = snap(origin.x - bb.x), dy = snap(origin.y - bb.y);
  for (const [t, r] of placed) pos[t.name] = { x: snap(r.x) + dx, y: snap(r.y) + dy };
}

// Data view draws no arrows, so the boxes just go as close together as they fit:
// tallest first, each at the highest free spot (then leftmost) within a width, trying
// several widths and keeping the block closest to the canvas shape
function packTight(tables, dims) {
  const order = [...tables].sort((a, b) => dims.get(b).h - dims.get(a).h);
  const aspect = canvasAspect(), widest = Math.max(...order.map(t => dims.get(t).w));
  const total = order.reduce((sum, t) => sum + (dims.get(t).w + AUTO.COL_GAP) * (dims.get(t).h + AUTO.ROW_GAP), 0);
  let best = null;
  for (let f = 0.6; f <= 2; f += 0.1) {
    const W = Math.max(widest, Math.sqrt(total * aspect) * f);
    const placed = new Map();
    for (const t of order) {
      const { w, h } = dims.get(t);
      let spot = null;
      for (const x of [0, ...[...placed.values()].map(r => r.x + r.w + AUTO.COL_GAP)]) {
        if (x + w > W && x) continue;
        const y = Math.max(0, ...[...placed.values()]
          .filter(r => r.x < x + w + AUTO.COL_GAP && r.x + r.w + AUTO.COL_GAP > x)
          .map(r => r.y + r.h + AUTO.ROW_GAP));
        if (!spot || y < spot.y || (y === spot.y && x < spot.x)) spot = { x, y };
      }
      placed.set(t, { ...spot, w, h });
    }
    const bb = bboxOf([...placed.values()]), size = Math.max(bb.w, bb.h * aspect);
    if (!best || size < best.size) best = { placed, size };
  }
  return best.placed;
}

// Lay out one connected group. Returns { placed: Map table → rect, w, h }.
function layoutGroup(nodes, dims, edges, deadline) {
  // parents: the tables t points to. Cycles (A → B → A) are broken for the column choice.
  const parents = new Map(nodes.map(t => [t, new Set()])), children = new Map(nodes.map(t => [t, new Set()]));
  const mark = new Map();
  const visit = t => {
    mark.set(t, 1);
    for (const e of edges) {
      if (e.from !== t || e.to === t) continue;
      if (mark.get(e.to) === 1) continue; // back edge: ignored for the columns
      parents.get(t).add(e.to);
      children.get(e.to).add(t);
      if (!mark.has(e.to)) visit(e.to);
    }
    mark.set(t, 2);
  };
  for (const t of nodes) if (!mark.has(t)) visit(t);

  // layer 0: tables that point nowhere; a table is one layer past its furthest parent
  const layer = new Map();
  const layerOf = t => {
    if (!layer.has(t)) layer.set(t, Math.max(-1, ...[...parents.get(t)].map(layerOf)) + 1);
    return layer.get(t);
  };
  nodes.forEach(layerOf);
  // a table with more children than parents moves next to its children (shorter arrows)
  for (let round = 0; round < nodes.length; round++) {
    let moved = false;
    for (const t of nodes) {
      const ch = [...children.get(t)];
      if (!ch.length || ch.length <= parents.get(t).size) continue;
      const to = Math.min(...ch.map(c => layer.get(c))) - 1;
      if (to > layer.get(t)) { layer.set(t, to); moved = true; }
    }
    if (!moved) break;
  }
  const maxLayer = Math.max(...layer.values());
  const cols = Array.from({ length: maxLayer + 1 }, () => []);
  for (const t of nodes) cols[maxLayer - layer.get(t)].push(t); // referenced tables on the right
  // which column a table is in (kept up to date when the polish moves tables between columns)
  const colIdx = new Map();
  const reindex = () => {
    for (let c = cols.length - 1; c >= 0; c--) if (!cols[c].length) cols.splice(c, 1);
    cols.forEach((col, c) => col.forEach(t => colIdx.set(t, c)));
  };
  reindex();
  const colOf = t => colIdx.get(t);

  // order within columns: barycenter sweeps, keeping the order with the fewest crossings
  const links = new Map(nodes.map(t => [t, []]));
  for (const e of edges) if (e.from !== e.to) { links.get(e.from).push(e.to); links.get(e.to).push(e.from); }
  const crossings = () => {
    const idx = new Map(cols.flatMap(c => c.map((t, i) => [t, i])));
    let n = 0;
    for (let c = 0; c + 1 < cols.length; c++) {
      const es = edges.filter(e => Math.min(colOf(e.from), colOf(e.to)) === c && Math.abs(colOf(e.from) - colOf(e.to)) === 1)
        .map(e => colOf(e.from) === c ? [idx.get(e.from) * 1e4 + e.fy, idx.get(e.to) * 1e4 + e.ty] : [idx.get(e.to) * 1e4 + e.ty, idx.get(e.from) * 1e4 + e.fy]);
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
        if ((es[i][0] - es[j][0]) * (es[i][1] - es[j][1]) < 0) n++;
      }
    }
    return n;
  };
  let best = cols.map(c => [...c]), bestN = crossings();
  for (let it = 0; it < 12 && bestN > 0; it++) {
    const order = it % 2 ? [...cols.keys()].reverse() : [...cols.keys()];
    for (const c of order) {
      const frac = new Map(cols.flatMap(col => col.map((t, i) => [t, (i + .5) / col.length])));
      const bary = t => {
        const ns = links.get(t).filter(u => colOf(u) !== c);
        return ns.length ? ns.reduce((sum, u) => sum + frac.get(u), 0) / ns.length : frac.get(t);
      };
      const b = new Map(cols[c].map(t => [t, bary(t)]));
      cols[c].sort((p, q) => b.get(p) - b.get(q));
    }
    const n = crossings();
    if (n < bestN) { bestN = n; best = cols.map(col => [...col]); }
  }
  best.forEach((col, i) => { cols[i] = col; });

  const place = () => placeColumns(cols, colOf, dims, edges);
  let placed = place();
  // Lookup tables: point nowhere, and only one table points to them (Artist, Label, …).
  // Such a table may also sit right above or below that one table, in its column: to
  // leave the gap to the next column to a bigger table (AlbumToArtist → Album), or to
  // keep the block within the canvas at the current zoom (Course → Teacher on a tall canvas).
  const referrers = t => new Set(edges.filter(e => e.to === t && e.from !== t).map(e => e.from));
  const lookups = nodes.filter(t => !edges.some(e => e.from === t && e.to !== t) && referrers(t).size === 1);
  // polish: try swapping neighbours in a column, and moving lookup tables next to the
  // table that points to them; keep whatever makes the drawn arrows better
  if (!state.dataView) {
    const room = canvasRoom();
    const overflow = p => { // how far the block sticks out of the canvas, each way
      if (!room) return 0;
      const bb = bboxOf([...p.values()]);
      return Math.max(0, bb.w - room.w) + Math.max(0, bb.h - room.h);
    };
    const costOf = p => drawnCost(nodes, p) + AUTO.OVERFLOW * overflow(p);
    let cost = costOf(placed);
    const attempt = change => {
      const saved = cols.map(col => [...col]);
      change();
      reindex();
      const p = place(), c = costOf(p);
      if (c < cost) { cost = c; placed = p; return true; }
      cols.length = 0;
      cols.push(...saved);
      colIdx.clear();
      reindex();
      return false;
    };
    for (let round = 0; round < 3 && performance.now() < deadline; round++) {
      let better = false;
      for (const t of lookups) {
        const [child] = referrers(t);
        if (colOf(t) === colOf(child)) continue;
        for (const below of [false, true]) {
          if (performance.now() >= deadline) break;
          const moved = attempt(() => {
            cols[colOf(t)].splice(cols[colOf(t)].indexOf(t), 1);
            const col = cols[colOf(child)];
            col.splice(col.indexOf(child) + (below ? 1 : 0), 0, t);
          });
          if (moved) { better = true; break; }
        }
      }
      for (let c = 0; c < cols.length; c++) {
        for (let i = 0; i + 1 < cols[c].length && performance.now() < deadline; i++) {
          if (attempt(() => { const col = cols[c]; [col[i], col[i + 1]] = [col[i + 1], col[i]]; })) better = true;
        }
      }
      if (!better) break;
    }
  }
  const bb = bboxOf([...placed.values()]);
  for (const r of placed.values()) { r.x -= bb.x; r.y -= bb.y; }
  return { placed, w: bb.w, h: bb.h };
}

// x from the columns (gaps widen with the arrows passing through), y so FK rows line up
// with the rows they point to, keeping each column's order and spacing
function placeColumns(cols, colOf, dims, edges) {
  const through = cols.map(() => 0);
  for (const e of edges) {
    const a = colOf(e.from), b = colOf(e.to);
    for (let c = Math.min(a, b); c < Math.max(a, b); c++) through[c]++;
  }
  const xs = [];
  let x = 0;
  cols.forEach((col, c) => {
    xs[c] = x;
    x += Math.max(0, ...col.map(t => dims.get(t).w)) + AUTO.COL_GAP + AUTO.LANE * through[c];
  });
  const y = new Map();
  for (const col of cols) {
    let top = 0;
    for (const t of col) { y.set(t, top); top += dims.get(t).h + AUTO.ROW_GAP; }
  }
  // relax: each table moves toward where its arrows would be level
  const off = new Map(); // table → [{ other, dy }] with dy = the y difference that makes an arrow level
  for (const t of y.keys()) off.set(t, []);
  for (const e of edges) {
    if (e.from === e.to || colOf(e.from) === colOf(e.to)) continue; // same column: can't be level
    off.get(e.from).push({ other: e.to, dy: e.ty - e.fy });
    off.get(e.to).push({ other: e.from, dy: e.fy - e.ty });
  }
  for (let it = 0; it < 16; it++) {
    const order = it % 2 ? [...cols].reverse() : cols;
    for (const col of order) {
      const want = col.map(t => {
        const o = off.get(t);
        return o.length ? o.reduce((sum, { other, dy }) => sum + y.get(other) + dy, 0) / o.length : y.get(t);
      });
      // keep the order and gaps, then shift the column to be as close to what it wants as it can
      const got = [];
      col.forEach((t, i) => { got[i] = i ? Math.max(want[i], got[i - 1] + dims.get(col[i - 1]).h + AUTO.ROW_GAP) : want[i]; });
      const shift = got.reduce((sum, g, i) => sum + want[i] - g, 0) / col.length;
      col.forEach((t, i) => y.set(t, got[i] + Math.min(0, shift)));
    }
  }
  // last pass, right to left: line each table's first arrow up exactly with a table already
  // placed to its right (so that arrow is straight), as far as the column's spacing allows
  const done = new Set();
  for (let c = cols.length - 1; c >= 0; c--) {
    const col = cols[c];
    const want = col.map(t => {
      const o = off.get(t).find(({ other }) => done.has(other));
      return o ? y.get(o.other) + o.dy : snap(y.get(t));
    });
    col.forEach((t, i) => {
      const min = i ? y.get(col[i - 1]) + dims.get(col[i - 1]).h + AUTO.ROW_GAP : -Infinity;
      y.set(t, Math.max(want[i], snap(min + 9)));
    });
    col.forEach(t => done.add(t));
  }
  // and left to right: a table none of whose arrows is straight moves to make one straight,
  // if that fits between its neighbours in the column
  const level = t => off.get(t).some(({ other, dy }) => y.get(t) === y.get(other) + dy);
  cols.forEach(col => col.forEach((t, i) => {
    if (!off.get(t).length || level(t)) return;
    const lo = i ? y.get(col[i - 1]) + dims.get(col[i - 1]).h + AUTO.ROW_GAP : -Infinity;
    const hi = i + 1 < col.length ? y.get(col[i + 1]) - AUTO.ROW_GAP - dims.get(t).h : Infinity;
    const fit = off.get(t).map(({ other, dy }) => y.get(other) + dy).find(v => v >= lo && v <= hi);
    if (fit !== undefined) y.set(t, fit);
  }));
  const placed = new Map();
  cols.forEach((col, c) => col.forEach(t => placed.set(t, { x: xs[c], y: y.get(t), ...dims.get(t) })));
  return placed;
}

// How long two orthogonal segments run on top of each other
function sharedLength([[ax, ay], [bx, by]], [[cx, cy], [dx, dy]]) {
  const overlap = (a, b, c, d) => Math.max(0, Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d)));
  if (ay === by && cy === dy && ay === cy) return overlap(ax, bx, cx, dx);
  if (ax === bx && cx === dx && ax === cx) return overlap(ay, by, cy, dy);
  return 0;
}

// How the arrows come out when actually routed: jumps count most, then total length
function drawnCost(nodes, placed) {
  const boxes = new Map(nodes.map(t => [t, { ...placed.get(t), rows: [] }]));
  const edges = diagramEdges(nodes, boxes);
  if (!edges.length) return 0;
  routeEdges(edges, [...boxes.values()]);
  let cost = 0;
  const segs = edges.map(e => e.points.slice(1).map((q, i) => [e.points[i], q]));
  for (const [k, e] of edges.entries()) {
    cost += (e.jumps ?? 0) * 1000;
    for (const [p, q] of segs[k]) cost += Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
    // arrows to different rows running along the same line look like one arrow: very bad
    for (let j = k + 1; j < edges.length; j++) {
      if (edges[j].to === e.to) continue;
      for (const s of segs[k]) for (const u of segs[j]) cost += 40 * sharedLength(s, u);
    }
  }
  return cost;
}

// Which tables t is connected to; when this changes, a floating table is placed again
function linkSignature(t, tables) {
  const s = new Set();
  for (const c of t.cols) if (c.target && c.target !== t) s.add('>' + c.target.name + '.' + c.targetCol.name);
  for (const o of tables) for (const c of o.cols) if (c.target === t && o !== t) s.add('<' + o.name + '.' + c.targetCol.name);
  return [...s].sort().join(',');
}
