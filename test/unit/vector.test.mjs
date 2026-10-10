// CHART|VECTOR / CHART|BEZIER: flat's flow items (loadAndAggregateValuesOfTheme
// with a second position), the Bézier curve and arrow head of maptheme.js
// chartMap's BEZIER branch, and its GRADIENT / FADEIN stops. The expected
// curve numbers were measured on real ixmaps-flat (the twin page
// examples/vector_bezier_aggregate_svg.html, the Afghanistan → Iran flow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
  document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } } };
win.window = win; win.globalThis = win;
vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
const { flatVectorItems, vectorArcHeight, pathBackIndex, greatCircleMeters, cameraOptions, bezierVectorLayout, cubicBezierPoints, arrowMarkerTriangle, fadeGradientStops, flatToArray, hashUnit, normalizeTheme } = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

const A = [10, 50], B = [20, 40], C = [30, 30];
const rec = (p1, p2, size, cat = null, value) => ({ p1, p2, size, cat, value, raw: { size } });

test('vector items: without AGGREGATE every record is an item, its size as it is', () => {
  const items = flatVectorItems([rec(A, B, 5), rec(A, B, -3), rec(A, B, NaN)], {});
  assert.deepEqual(plain(items.map(i => i.nSize)), [5, -3, 0], 'negative kept (BEZIER reverses it), no number → 0');
});

test('vector items: AGGREGATE sums the |sizes| per origin–destination pair (VECTOR)', () => {
  const items = flatVectorItems([rec(A, B, 5), rec(A, B, -3), rec(A, C, 2), rec(B, A, 1)], { aggregate: true, vectorKey: true });
  assert.deepEqual(plain(items.map(i => [i.p1, i.p2, i.nSize, i.count])), [[A, B, 8, 2], [A, C, 2, 1], [B, A, 1, 1]]);
});

test('vector items: a BEZIER without VECTOR aggregates by the origin alone (the first record\'s flow)', () => {
  const items = flatVectorItems([rec(A, B, 5), rec(A, C, 2)], { aggregate: true, vectorKey: false });
  assert.deepEqual(plain(items.map(i => [i.p2, i.nSize])), [[B, 7]]);
});

test('vector items: CATEGORICAL keeps each category its own item; a value that is none of them is category 0', () => {
  const items = flatVectorItems([rec(A, B, 1, 0), rec(A, B, 1, 1), rec(A, B, 1, -1), rec(A, B, 4, 0)], { aggregate: true, vectorKey: true, multiParts: true });
  assert.deepEqual(plain(items.map(i => [i.cat, i.nSize])), [[0, 5], [1, 1], [-1, 1]]);
});

test('vector items: aggregating leaves out records without a size (and 0 / negative ones when told)', () => {
  const o = { aggregate: true, vectorKey: true };
  assert.deepEqual(plain(flatVectorItems([rec(A, B, NaN), rec(A, C, 0)], o).map(i => i.nSize)), [0], 'NaN out, 0 is a value');
  assert.equal(flatVectorItems([rec(A, C, 0)], Object.assign({ zeroIsNotValue: true }, o)).length, 0);
  assert.equal(flatVectorItems([rec(A, C, -2)], Object.assign({ negativeIsNotValue: true }, o)).length, 0);
  assert.deepEqual(plain(flatVectorItems([rec(A, B, 3), rec(A, B, 7), rec(A, B, 5)], Object.assign({ max: true }, o)).map(i => i.nSize)), [7]);
});

// flat, Afghanistan → Iran (sum 3 431 680, normalsizevalue 500000, sizepow
// 1.5, rangescale 4, markersize 1): screen ends (757.09, 348.99) →
// (671.36, 364.2); path "M0,0 C-49.629,41.966 -104.962,51.782
// -221.332,39.266" in map units, scaled 0.21333 to pixels; arrow marker 2.6384
const W = 10 / Math.pow(500000, 1 / 1.5) * Math.pow(3431680, 1 / 1.5);
const CTM = 0.2133333444595337;

test('bezier: flat\'s curve — control points from the unshortened vector, the end an arrow length short', () => {
  near(W, 36.115, 1e-3, 'width');
  const l = bezierVectorLayout(671.36 - 757.09, 364.2 - 348.99, { w: W, ll: W + 3, unit: 1, oz: 1, bow: 4, t: 'CHART|VECTOR|BEZIER|POINTER|FADEIN', marker: 1 });
  near(l.end[0], -221.33181 * CTM, 0.01, 'end x'); near(l.end[1], 39.26596 * CTM, 0.01, 'end y');
  near(l.c1[0], -49.62943 * CTM, 0.01, 'c1 x'); near(l.c1[1], 41.96575 * CTM, 0.01, 'c1 y');
  near(l.c2[0], -104.96238 * CTM, 0.01, 'c2 x'); near(l.c2[1], 51.78224 * CTM, 0.01, 'c2 y');
  assert.deepEqual(plain(l.start), [0, 0]);
});

test('bezier: without an arrow the curve ends on the second position; SHORT and GAP', () => {
  const l = bezierVectorLayout(100, 0, { w: 2, ll: 5, unit: 1, oz: 1, bow: 5, t: 'CHART|BEZIER' });
  assert.deepEqual(plain(l.end), [100, 0]);
  assert.deepEqual(plain(l.c1), [25, -10], 'bow: (dy, −dx) / 50 · 5');
  const s = bezierVectorLayout(100, 0, { w: 2, ll: 5, unit: 1, oz: 2, bow: 5, t: 'CHART|BEZIER|SHORT' });
  assert.deepEqual(plain(s.c1), [25, -50], 'SHORT: 5 · bow chart units, whatever the length');
  const g = bezierVectorLayout(100, 0, { w: 2, ll: 22, unit: 1, oz: 1, bow: 5, t: 'CHART|BEZIER|GAP', gap: 20 });
  assert.deepEqual(plain(g.start), [20, near0(-0.44 / 100 * 20)], 'GAP: starts gapsize units off');
  function near0(v) { return Math.abs(v) < 1e-12 ? 0 : v; }
});

test('bezier: the curve points', () => {
  const pts = cubicBezierPoints([0, 0], [1, 1], [2, 1], [3, 0], 2);
  assert.deepEqual(plain(pts), [[0, 0], [1.5, 0.75], [3, 0]]);
});

test('arrow head: flat\'s marker triangle around its reference point', () => {
  const s = Math.min(5, 2.5 + 5 / W);
  near(s, 2.638445, 1e-5, 'flat\'s markerWidth');
  const tri = arrowMarkerTriangle([0, 0], 1, 0, 10, s, s / 1.7, s / 2);
  near(tri[1][0], (s - s / 1.7) * 10, 1e-9, 'tip ahead of the end');
  near(tri[0][0], -s / 1.7 * 10, 1e-9, 'base behind it');
  near(tri[0][1] - tri[2][1], s * 10, 1e-9, 'base width s · line width');
  const v = arrowMarkerTriangle([5, 5], 0, 0, 2, 4, 4, 2);
  assert.deepEqual(plain(v[1]), [5, 5], 'VECTOR: the tip on the end; no direction points right');
});

test('fade gradient: 0.2 at the start\'s side, full at the end\'s, whichever way the flow runs', () => {
  const right = fadeGradientStops([[0, 0], [5, 1], [10, 0]], 10, 0, 0.2);
  assert.deepEqual(plain(right.map(s => Math.round(s.alpha * 1e9) / 1e9)), [0.2, 0.6, 1]);
  const left = fadeGradientStops([[0, 0], [-5, 1], [-10, 0]], -10, 0, 0.2);
  assert.deepEqual(plain(left.map(s => Math.round(s.alpha * 1e9) / 1e9)), [0.2, 0.6, 1]);
  const up = fadeGradientStops([[0, 0], [1, -10]], 1, -10, 2);
  assert.deepEqual(plain(up.map(s => s.alpha)), [1, 1], 'GRADIENT: stop opacity 2 clamps to 1');
  assert.deepEqual(plain(up.map(s => s.k)), [0, 1]);
});

test('flat style lists and a fixed stand-in for Math.random', () => {
  assert.deepEqual(plain(flatToArray('red,blue')), ['red', 'blue']);
  assert.deepEqual(plain(flatToArray('RGB(1,2,3)')), ['RGB(1,2,3)']);
  assert.deepEqual(plain(flatToArray(['a'])), ['a']);
  const h = hashUnit('10,50&20,40');
  assert.ok(h >= 0 && h < 1);
  assert.equal(hashUnit('10,50&20,40'), h);
});

test('theme: EXACT is CATEGORICAL; position2 is the second position', () => {
  const spec = normalizeTheme({ layer: 'w', binding: { position: 'A', position2: 'B', value: 'v' }, style: { type: 'CHART|VECTOR|BEZIER|EXACT' } });
  assert.ok(spec.flags.has('CATEGORICAL'));
  assert.equal(spec.binding.lookup2, 'B');
  assert.equal(spec.binding.lookup, 'A');
});

test('3D vectors: the arc is a half sine over the flow — ground at both ends, ratio · length on top', () => {
  const chord = 10000, last = 32;
  near(vectorArcHeight(0, last, chord, 0.3), 0, 1e-9, 'start on the ground');
  near(vectorArcHeight(last, last, chord, 0.3), 0, 1e-9, 'end on the ground');
  near(vectorArcHeight(last / 2, last, chord, 0.3), 3000, 1e-6, 'top = 0.3 · 10 km');
  near(vectorArcHeight(last / 2, last, chord, 0.5), 5000, 1e-6, 'archeight 0.5');
  assert.equal(vectorArcHeight(0, 0, chord, 0.3), 0, 'a single vertex stays on the ground');
});

test('3D vectors: great-circle meters between the two positions', () => {
  near(greatCircleMeters([0, 0], [0, 1]), 111195, 50, 'one degree of latitude');
  near(greatCircleMeters([9.19, 45.47], [9.19, 45.47]), 0, 1e-9, 'same point');
  near(greatCircleMeters([-73.99, 40.73], [-73.96, 40.75]), 3000, 400, 'a Citi Bike trip, about 3 km');
});

test('3D vectors: the 3D flag and style.archeight', () => {
  const t = normalizeTheme({ layer: 'L', style: { type: 'CHART|VECTOR|BEZIER|3D', archeight: '0.45' } });
  assert.equal(t.flags.has('3D'), true);
  assert.equal(t.style.archeight, 0.45, 'archeight is a number key');
});

test('camera: pitch / bearing from .options() or the Map() options, maxPitch raised to the pitch', () => {
  assert.deepEqual(plain(cameraOptions({}, {})), {}, 'nothing asked: MapLibre defaults');
  assert.deepEqual(plain(cameraOptions({ pitch: '55', bearing: 20 }, {})), { pitch: 55, maxPitch: 60, bearing: 20 });
  assert.deepEqual(plain(cameraOptions({}, { pitch: 70 })), { pitch: 70, maxPitch: 70 }, 'the Map() option');
  assert.deepEqual(plain(cameraOptions({ pitch: 40 }, { pitch: 70 })), { pitch: 40, maxPitch: 60 }, '.options() wins');
  assert.deepEqual(plain(cameraOptions({ pitch: 99 }, {})), { pitch: 85, maxPitch: 85 }, 'clamped to MapLibre\'s 85');
  assert.deepEqual(plain(cameraOptions({ pitch: 'x', bearing: '' }, {})), {}, 'not a number: ignored');
});

test('3D vectors: an arrow head base sits on the arc where the line is that far back', () => {
  const pts = [[0, 0], [10, 0], [20, 0], [30, 0]];
  near(pathBackIndex(pts, 0), 3, 1e-9, 'at the end');
  near(pathBackIndex(pts, 10), 2, 1e-9, 'one segment back');
  near(pathBackIndex(pts, 15), 1.5, 1e-9, 'half a segment further');
  near(pathBackIndex(pts, 100), 0, 1e-9, 'longer than the path: the start');
  near(pathBackIndex([[0, 0], [0, 0]], 5), 0, 1e-9, 'a zero-length path');
});

test('Equal Earth: invert undoes project (the plane flat computes its flows in)', () => {
  const proj = win.__ixmapsGlInternals.flatSvgProjectionOf('https://x/maps/svg/maps/generic/equalearth.svg');
  assert.equal(typeof proj.invert, 'function');
  for (const [lat, lon] of [[0, 0], [45.47, 9.19], [-33.9, 151.2], [71, -150], [-60, 179], [89, 20], [40.7, -74]]) {
    const [la, lo] = proj.invert(...proj.project(lat, lon));
    near(la, lat, 1e-7, `lat ${lat}`); near(lo, lon, 1e-7, `lon ${lon}`);
  }
});

test('orthographic plane: project / invert round-trip, the face the viewer sees', () => {
  const o = win.__ixmapsGlInternals.orthographicPlane(70, 10);
  for (const [lat, lon] of [[70, 10], [51, 9], [40.7, -74], [35, 105], [80, -120]]) {
    if (!o.inFront([lon, lat])) continue;
    const [la, lo] = o.invert(...o.project(lat, lon));
    near(la, lat, 1e-7, `lat ${lat}`); near(lo, lon, 1e-7, `lon ${lon}`);
  }
  assert.equal(o.inFront([10, 70]), true, 'the center faces the viewer');
  assert.equal(o.inFront([-170, -60]), false, 'the far side does not');
  assert.ok(Number.isNaN(o.invert(1.2, 0)[0]), 'outside the disc');
  near(o.project(70, 10)[0], 0, 1e-12, 'the center projects to the origin');
});

test('orthographic framing: the view zoom 2.5 of a 768 px map shows flat\'s disc (338.6 px), the globe radius of the perspective inverts', () => {
  const G = win.__ixmapsGlInternals;
  const o = { orthographic: true, scaleConstant: 1 };
  const z = G.flatViewToMapLibreZoom(2.5, 70, 10, 1024, 768, o);
  // MapLibre's globe radius at that zoom, and the disc it draws (perspective, f = 1.5 · height)
  const R = 512 * Math.pow(2, z) / (2 * Math.PI * Math.cos(70 * Math.PI / 180));
  near(R / Math.sqrt(1 + 2 * R / (1.5 * 768)), 338.6, 0.5, 'the disc radius');
  const z3 = G.flatViewToMapLibreZoom(3.5, 70, 10, 1024, 768, o);
  const R3 = 512 * Math.pow(2, z3) / (2 * Math.PI * Math.cos(70 * Math.PI / 180));
  near(R3 / Math.sqrt(1 + 2 * R3 / (1.5 * 768)), 677.2, 1, 'doubles per view zoom level');
});
