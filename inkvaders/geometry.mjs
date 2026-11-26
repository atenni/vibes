// Pure 2D helpers: segments, circles, reflection and polylines.

/** @typedef {{ x: number, y: number }} Point */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/**
 * Closest point on segment AB to point P. `t` is the position along AB (0…1).
 * @returns {{ x: number, y: number, t: number }}
 */
export function closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return { x: ax + dx * t, y: ay + dy * t, t };
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const c = closestOnSegment(px, py, ax, ay, bx, by);
  return Math.hypot(px - c.x, py - c.y);
}

/** Does segment AB touch the circle (cx, cy, r)? Tangent counts as a hit. */
export function segmentHitsCircle(ax, ay, bx, by, cx, cy, r) {
  const d = distToSegment(cx, cy, ax, ay, bx, by);
  return d <= r + 1e-9;
}

/** Unit normal of segment AB (left-hand side). Zero-length gives (0, -1). */
export function segmentNormal(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy);
  if (l === 0) return { x: 0, y: -1 };
  return { x: -dy / l, y: dx / l };
}

/** Reflect velocity v about the unit normal n: v − 2(v·n)n. */
export function reflect(vx, vy, nx, ny) {
  const d = vx * nx + vy * ny;
  return { x: vx - 2 * d * nx, y: vy - 2 * d * ny };
}

/** Circle against an axis-aligned box centred at (bx, by). */
export function circleHitsBox(cx, cy, r, bx, by, w, h) {
  return Math.abs(cx - bx) <= w / 2 + r && Math.abs(cy - by) <= h / 2 + r;
}

/** @param {Point[]} points */
export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  return total;
}

/**
 * Drop points closer than `minDist` to the previously kept point. The first
 * point is always kept; the last is kept only with `keepLast`.
 * @param {Point[]} points
 * @param {number} [minDist]
 * @param {boolean} [keepLast]
 * @returns {Point[]}
 */
export function simplify(points, minDist = 6, keepLast = false) {
  /** @type {Point[]} */
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist(last.x, last.y, p.x, p.y) >= minDist) out.push(p);
  }
  if (
    keepLast &&
    points.length > 1 &&
    out[out.length - 1] !== points[points.length - 1]
  ) {
    out.push(points[points.length - 1]);
  }
  return out;
}
