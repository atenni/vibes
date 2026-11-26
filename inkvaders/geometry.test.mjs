import test from "node:test";
import assert from "node:assert/strict";
import {
  polylineLength,
  reflect,
  segmentHitsCircle,
  segmentNormal,
  simplify,
} from "./geometry.mjs";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);

test("segment–circle: hit, miss, endpoint, tangent", () => {
  assert.ok(segmentHitsCircle(0, 0, 10, 0, 5, 2, 3));
  assert.ok(!segmentHitsCircle(0, 0, 10, 0, 5, 5, 3));
  assert.ok(segmentHitsCircle(0, 0, 10, 0, 12, 0, 2.5)); // near the end cap
  assert.ok(!segmentHitsCircle(0, 0, 10, 0, 14, 0, 2.5));
  assert.ok(segmentHitsCircle(0, 0, 10, 0, 5, 3, 3)); // tangent
});

test("reflection: 45°, perpendicular, parallel", () => {
  const n = segmentNormal(0, 0, 10, 10); // 45° line
  const r = reflect(0, -1, n.x, n.y);
  near(r.x, -1);
  near(r.y, 0);
  const p = reflect(0, 5, 0, 1);
  near(p.x, 0);
  near(p.y, -5);
  const par = reflect(3, 0, 0, 1);
  near(par.x, 3);
  near(par.y, 0);
});

test("polyline length", () => {
  assert.equal(polylineLength([]), 0);
  assert.equal(polylineLength([{ x: 0, y: 0 }]), 0);
  near(
    polylineLength([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 3, y: 10 },
    ]),
    11,
  );
});

test("simplify drops close points", () => {
  const pts = [0, 2, 4, 7, 8, 14].map((x) => ({ x, y: 0 }));
  assert.deepEqual(
    simplify(pts, 6).map((p) => p.x),
    [0, 7, 14],
  );
  assert.deepEqual(
    simplify(pts, 6, true).map((p) => p.x),
    [0, 7, 14],
  );
  assert.deepEqual(
    simplify(pts.slice(0, 3), 6, true).map((p) => p.x),
    [0, 4],
  );
});
