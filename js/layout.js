'use strict';

// ─── Layout: where the boxes go ──────────────────────────────────────────────
// One cost function drives both placing a single new table (the others stay put)
// and "Auto layout" (place the tables one by one, then improve each in turn).
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

// FK arrows between different tables, with row offsets inside each box
function layoutEdges(tables) {
  const out = [];
  for (const t of tables) {
    t.cols.forEach((c, i) => {
      if (c.target && c.target !== t) out.push({ from: t, to: c.target, fy: rowY(i), ty: rowY(c.target.cols.indexOf(c.targetCol)) });
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
// current: a spot to consider as well (used when improving an existing layout).
function bestSpot(t, placed, dims, edges, anchor = null, current = null) {
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

  let best = current ? { x: current.x, y: current.y, cost: cost(current.x, current.y) } : { cost: Infinity };
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

// Arrange every table: most connected first, then whatever is most connected to the placed ones.
// Afterwards, each table in turn is lifted out and put back at its best spot, a few rounds.
function arrangeAll(tables, dims) {
  if (!tables.length) return;
  const edges = layoutEdges(tables);
  const degree = new Map(tables.map(t => [t, 0]));
  for (const e of edges) { degree.set(e.from, degree.get(e.from) + 1); degree.set(e.to, degree.get(e.to) + 1); }

  const old = tables.map(t => pos[t.name]).filter(Boolean);
  const origin = old.length ? { x: Math.min(...old.map(p => p.x)), y: Math.min(...old.map(p => p.y)) } : { x: 40, y: 40 };

  const placed = new Map(), order = [], left = new Set(tables);
  while (left.size) {
    let pick = null, score = -1;
    for (const t of left) {
      const links = edges.filter(e => (e.from === t && placed.has(e.to)) || (e.to === t && placed.has(e.from))).length;
      const s = links * 1000 + degree.get(t);
      if (s > score) { pick = t; score = s; }
    }
    left.delete(pick);
    order.push(pick);
    const s = bestSpot(pick, placed, dims, edges);
    placed.set(pick, { x: s.x, y: s.y, ...dims.get(pick) });
  }

  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (const t of order) {
      const cur = placed.get(t);
      placed.delete(t);
      const s = bestSpot(t, placed, dims, edges, null, cur);
      placed.set(t, { x: s.x, y: s.y, ...dims.get(t) });
      if (s.x !== cur.x || s.y !== cur.y) moved = true;
    }
    if (!moved) break;
  }

  // keep the diagram where it was on the canvas
  const bb = bboxOf([...placed.values()]);
  const dx = snap(origin.x - bb.x), dy = snap(origin.y - bb.y);
  for (const [t, r] of placed) pos[t.name] = { x: r.x + dx, y: r.y + dy };
}

// Which tables t is connected to; when this changes, a floating table is placed again
function linkSignature(t, tables) {
  const s = new Set();
  for (const c of t.cols) if (c.target && c.target !== t) s.add('>' + c.target.name + '.' + c.targetCol.name);
  for (const o of tables) for (const c of o.cols) if (c.target === t && o !== t) s.add('<' + o.name + '.' + c.targetCol.name);
  return [...s].sort().join(',');
}
