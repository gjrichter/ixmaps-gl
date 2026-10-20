// .type("KDE"): the pure parts — bandwidth by zoom, threshold levels, the points, the density grid
// (binning + separable Gaussian, checked against the brute-force sum the fire pages computed) and
// the bands (d3-contour output scaled to lng/lat; the contour generator is stubbed here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
  document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } },
  setTimeout, clearTimeout };   // the KDE theme schedules its computation with timers
win.window = win; win.globalThis = win;
vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
const { kdeBandwidthKm, kdeMaxCells, kdeLevels, kdePoints, kdeGrid, kdeBands, kdeBandColors, kdeWorkerSource, kdeCompute, kdeReset, ensureD3Contour, setDeckLayerClassesForTests, LayerRuntime } = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));

// a small deterministic generator, so the random points are the same on every run
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function randomPoints(n, seed, lng0 = 12.3, lat0 = 45.4, spanKm = 20) {
  const r = rng(seed), out = [];
  const dLat = spanKm / 111.3, dLng = spanKm / (111.3 * Math.cos(lat0 * Math.PI / 180));
  for (let i = 0; i < n; i++) out.push(lng0 + (r() - 0.5) * dLng, lat0 + (r() - 0.5) * dLat, 1 + Math.floor(r() * 5));
  return Float64Array.from(out);
}
// what the pages computed: Σ w · exp(−d² / 2h²), d in km
function bruteForce(points, bwKm, lng, lat) {
  const KM = 111.3;
  let s = Infinity, n = -Infinity;
  for (let i = 1; i < points.length; i += 3) { s = Math.min(s, points[i]); n = Math.max(n, points[i]); }
  const kmLng = KM * Math.cos(((s + n) / 2) * Math.PI / 180);
  let v = 0;
  for (let i = 0; i < points.length; i += 3) {
    const dx = (points[i] - lng) * kmLng, dy = (points[i + 1] - lat) * KM;
    v += points[i + 2] * Math.exp(-(dx * dx + dy * dy) / (2 * bwKm * bwKm));
  }
  return v;
}

test('kde bandwidth and cell budget follow the flat zoom, as the fire pages chose them', () => {
  assert.equal(kdeBandwidthKm(8.9), 24);
  assert.equal(kdeBandwidthKm(9), 10);
  assert.equal(kdeBandwidthKm(10), 5);
  assert.equal(kdeBandwidthKm(11), 2);
  assert.equal(kdeBandwidthKm(12), 0.8);
  assert.equal(kdeBandwidthKm(13), 0.3);
  assert.equal(kdeBandwidthKm(14), 0.12);
  assert.equal(kdeBandwidthKm(15), 0.08);
  assert.equal(kdeBandwidthKm(16), 0.04);
  assert.equal(kdeBandwidthKm(22), 0.04);
  assert.equal(kdeBandwidthKm(-3), 24);
  assert.equal(kdeMaxCells(8), 15000);
  assert.equal(kdeMaxCells(12.5), 100000);
  assert.equal(kdeMaxCells(18), 1000000);
});

test('kde levels: the default, an array, a string; unusable values give the default', () => {
  const L = st => plain(kdeLevels(st));
  assert.deepEqual(L({}), [0.15, 0.30, 0.50, 0.70]);
  assert.deepEqual(L(undefined), [0.15, 0.30, 0.50, 0.70]);
  assert.deepEqual(L({ kdelevels: [0.5, 0.2] }), [0.2, 0.5], 'ascending');
  assert.deepEqual(L({ kdelevels: '0.2, 0.4 0.8' }), [0.2, 0.4, 0.8]);
  assert.deepEqual(L({ kdelevels: [0.3, 0.3, 0.6] }), [0.3, 0.6], 'each once');
  assert.deepEqual(L({ kdelevels: [0, -1, 2, 'x'] }), [0.15, 0.30, 0.50, 0.70], 'nothing usable');
  assert.deepEqual(L({ kdelevels: [0, 0.4, 5] }), [0.4], 'keeps the usable ones');
});

test('kde points: [lng, lat, weight], inside the bbox, with a usable position and a weight above 0', () => {
  const f = (c, p) => ({ geometry: c && { type: 'Point', coordinates: c }, properties: p });
  const feats = [f([1, 2], { n: '3' }), f([5, 6], { n: '1' }), f(null, { n: '1' }), f([NaN, 1], { n: '1' }), f([2, 2], { n: '0' }), f([3, 3], { n: 'x' })];
  assert.deepEqual(Array.from(kdePoints(feats, { size: 'n' })), [1, 2, 3, 5, 6, 1]);
  assert.deepEqual(Array.from(kdePoints(feats, { size: 'n' }, [0, 0, 4, 4])), [1, 2, 3]);
  assert.deepEqual(Array.from(kdePoints(feats, { value: '$item$' })), [1, 2, 1, 5, 6, 1, 2, 2, 1, 3, 3, 1], '$item$: one each');
  assert.equal(Object.prototype.toString.call(kdePoints([], {})), '[object Float64Array]');
});

test('kde grid: fewer than five points have no density', () => {
  assert.equal(kdeGrid(Float64Array.from([12, 45, 1, 12.1, 45.1, 1, 12.2, 45.2, 1, 12.3, 45.3, 1]), 1, 10000), null);
  assert.equal(kdeGrid(new Float64Array(0), 1, 10000), null);
  assert.equal(kdeGrid(randomPoints(10, 1), 0, 10000), null, 'no bandwidth');
});

test('kde grid: the binned, blurred grid matches the brute-force sum within 3% of the maximum', () => {
  for (const [bw, cells] of [[2, 40000], [1, 90000], [4, 20000]]) {
    const pts = randomPoints(60, 7);
    const g = kdeGrid(pts, bw, cells);
    assert.ok(g && g.nx >= 5 && g.ny >= 5);
    assert.ok(g.nx * g.ny <= cells * 1.2, `cell budget (${g.nx * g.ny} for ${cells})`);
    let worst = 0, bfMax = 0;
    for (let j = 0; j < g.ny; j += 3) for (let i = 0; i < g.nx; i += 3) {
      const exact = bruteForce(pts, bw, g.w0 + (i + 0.5) * g.stepLng, g.s + (j + 0.5) * g.stepLat);
      bfMax = Math.max(bfMax, exact);
      worst = Math.max(worst, Math.abs(g.values[j * g.nx + i] - exact));
    }
    assert.ok(worst / bfMax < 0.03, `bw ${bw} km: worst difference ${(100 * worst / bfMax).toFixed(2)}% of the maximum`);
    assert.ok(Math.abs(g.max - bfMax) / bfMax < 0.05, `bw ${bw} km: maximum ${g.max} vs ${bfMax}`);
  }
});

test('kde grid: the peak sits on the cluster, the grid reaches beyond the outermost points', () => {
  const pts = [];
  const r = rng(3);
  for (let i = 0; i < 80; i++) pts.push(12.5 + (r() - 0.5) * 0.02, 45.5 + (r() - 0.5) * 0.02, 1);   // a tight cluster at 12.5, 45.5
  for (let i = 0; i < 6; i++) pts.push(12.0 + r() * 0.05, 45.0 + r() * 0.05, 1);                      // a few strays far away
  const g = kdeGrid(Float64Array.from(pts), 1, 50000);
  let at = 0;
  g.values.forEach((v, k) => { if (v > g.values[at]) at = k; });
  const lng = g.w0 + ((at % g.nx) + 0.5) * g.stepLng, lat = g.s + (Math.floor(at / g.nx) + 0.5) * g.stepLat;
  assert.ok(Math.abs(lng - 12.5) < 0.02 && Math.abs(lat - 45.5) < 0.02, `peak at ${lng}, ${lat}`);
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    minLng = Math.min(minLng, pts[i]); maxLng = Math.max(maxLng, pts[i]);
    minLat = Math.min(minLat, pts[i + 1]); maxLat = Math.max(maxLat, pts[i + 1]);
  }
  const kmLng = 111.3 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9 * 1000, `${msg}: ${a} vs ${b}`);
  near((minLng - g.w0) * kmLng, 3, 'west margin in km (3 bandwidths)');
  near((g.w0 + g.nx * g.stepLng - maxLng) * kmLng, 3, 'east margin in km');
  near((minLat - g.s) * 111.3, 3, 'south margin in km');
  near((g.s + g.ny * g.stepLat - maxLat) * 111.3, 3, 'north margin in km');
});

test('kde grid: a bandwidth finer than the cells still conserves the weights (binning, not sampling)', () => {
  const pts = randomPoints(40, 11, 12.3, 45.4, 200);   // 200 km wide on 5000 cells: cells far coarser than 0.1 km
  const g = kdeGrid(pts, 0.1, 5000);
  let sum = 0; g.values.forEach(v => { sum += v; });
  let total = 0; for (let i = 2; i < pts.length; i += 3) total += pts[i];
  assert.ok(Math.abs(sum - total) / total < 0.001, `sum ${sum} vs weights ${total}`);
  assert.ok(g.max > 0);
});

test('kde grid: weights count — a point of weight 4 beats four of weight 1 spread apart', () => {
  const heavy = [12.5, 45.5, 4, 12.9, 45.9, 1, 12.1, 45.1, 1, 12.9, 45.1, 1, 12.1, 45.9, 1];
  const g = kdeGrid(Float64Array.from(heavy), 2, 40000);
  const at = k => [g.w0 + ((k % g.nx) + 0.5) * g.stepLng, g.s + (Math.floor(k / g.nx) + 0.5) * g.stepLat];
  let top = 0; g.values.forEach((v, k) => { if (v > g.values[top]) top = k; });
  assert.ok(Math.abs(at(top)[0] - 12.5) < 0.03 && Math.abs(at(top)[1] - 45.5) < 0.03);
});

test('kde bands: thresholds are fractions of the maximum; coordinates are scaled with the cell centers at (i + 0.5)', () => {
  const grid = { values: new Float32Array(6), nx: 3, ny: 2, w0: 10, s: 40, stepLng: 0.5, stepLat: 0.25, max: 8 };
  const seen = {};
  const fake = () => {
    const gen = values => {
      seen.values = values;
      return seen.thresholds.map(t => ({ type: 'MultiPolygon', value: t,
        coordinates: t > 5 ? [] : [[[[0.5, 0.5], [2.5, 0.5], [2.5, 1.5], [0.5, 0.5]]]] }));
    };
    gen.size = v => { seen.size = v; return gen; };
    gen.thresholds = v => { seen.thresholds = v; return gen; };
    return gen;
  };
  const fc = plain(kdeBands(grid, [0.25, 0.5, 0.75], fake));
  assert.deepEqual(plain(seen.size), [3, 2]);
  assert.deepEqual(plain(seen.thresholds), [2, 4, 6]);
  assert.strictEqual(seen.values, grid.values);
  assert.equal(fc.features.length, 2, 'a threshold above every value gives no feature');
  assert.deepEqual(fc.features.map(f => f.properties.level), [0, 1]);
  assert.deepEqual(fc.features.map(f => f.properties.fraction), [0.25, 0.5]);
  assert.deepEqual(fc.features[0].geometry.coordinates[0][0], [[10.25, 40.125], [11.25, 40.125], [11.25, 40.375], [10.25, 40.125]]);
});

test('kde bands: no grid, no maximum or no levels give an empty collection', () => {
  const never = () => { throw new Error('contours must not run'); };
  assert.deepEqual(plain(kdeBands(null, [0.5], never)), { type: 'FeatureCollection', features: [] });
  assert.deepEqual(plain(kdeBands({ max: 0, values: [], nx: 1, ny: 1 }, [0.5], never)), { type: 'FeatureCollection', features: [] });
  assert.deepEqual(plain(kdeBands({ max: 3, values: [], nx: 1, ny: 1 }, [], never)), { type: 'FeatureCollection', features: [] });
});

test('kde band colors: one per band, lowest threshold first; the fire pages\' pink when nothing is readable', () => {
  assert.deepEqual(plain(kdeBandColors(['#336699'], 4)), Array(4).fill([51, 102, 153]));
  const ramp = plain(kdeBandColors(['#000000', '#ffffff'], 3));
  assert.deepEqual(ramp[0], [0, 0, 0]);
  assert.deepEqual(ramp[2], [255, 255, 255]);
  assert.ok(ramp[1].every(v => v === 127 || v === 128), `middle ${ramp[1]}`);
  assert.deepEqual(plain(kdeBandColors(['not a color'], 2)), [[221, 0, 136], [221, 0, 136]]);
  assert.deepEqual(plain(kdeBandColors(undefined, 1)), [[221, 0, 136]]);
});

// ── the worker path: the worker's source run in a fake worker scope ──
const same = (a, b) => assert.deepEqual(Array.from(a), Array.from(b));
function fakeWorkerEnv({ fail = false } = {}) {
  const made = [];
  win.Blob = class { constructor(parts) { this.parts = parts; } };
  win.URL = { createObjectURL: b => ({ src: b.parts[0] }) };
  win.Worker = class {
    constructor(url) {
      made.push(this);
      this.scope = { postMessage: m => queueMicrotask(() => this.onmessage({ data: m })) };
      vm.runInNewContext(url.src, { self: this.scope });
    }
    postMessage(m) { if (fail) setTimeout(() => this.onerror(new Error('boom')), 0); else this.scope.onmessage({ data: m }); }
    terminate() {}
  };
  return made;
}
function noWorkerEnv() { delete win.Worker; delete win.Blob; delete win.URL; }

test('kde worker source: answers {id, points, bwKm, maxCells} with the grid kdeGrid computes', async () => {
  const pts = randomPoints(40, 21), ref = kdeGrid(pts, 2, 30000);
  const scope = { postMessage: (m, transfer) => { scope.last = { m, transfer }; } };
  vm.runInNewContext(kdeWorkerSource(), { self: scope });
  scope.onmessage({ data: { id: 7, points: pts, bwKm: 2, maxCells: 30000 } });
  assert.equal(scope.last.m.id, 7);
  same(scope.last.m.grid.values, ref.values);
  assert.equal(scope.last.m.grid.nx, ref.nx);
  assert.equal(scope.last.transfer.length, 1, 'the values are handed back by transfer');
  scope.onmessage({ data: { id: 8, points: new Float64Array(6), bwKm: 2, maxCells: 100 } });
  assert.equal(scope.last.m.grid, null, 'too few points: no grid');
  assert.deepEqual(Array.from(scope.last.transfer), []);
});

test('kde compute: inline without a Worker, through one shared worker with one, inline again when it fails', async () => {
  const pts = randomPoints(40, 23), ref = kdeGrid(pts, 2, 30000);
  try {
    kdeReset(); noWorkerEnv();
    same((await kdeCompute(pts, 2, 30000)).values, ref.values);              // no Worker in this scope

    kdeReset(); const made = fakeWorkerEnv();
    same((await kdeCompute(pts, 2, 30000)).values, ref.values);              // through the worker
    same((await kdeCompute(pts, 2, 30000)).values, ref.values);
    assert.equal(made.length, 1, 'one worker for every computation');
    assert.equal(await kdeCompute(new Float64Array(0), 2, 100), null, 'too few points');

    kdeReset(); const broken = fakeWorkerEnv({ fail: true });
    same((await kdeCompute(pts, 2, 30000)).values, ref.values);              // the worker errors: computed here
    same((await kdeCompute(pts, 2, 30000)).values, ref.values);
    assert.equal(broken.length, 1, 'no new worker after a failure');
  } finally { kdeReset(); noWorkerEnv(); }
});

test('d3-contour is loaded privately: a failed fetch can be retried, the page\'s d3 stays untouched', async () => {
  const calls = [];
  win.d3 = { version: '3.5.17' };
  win.fetch = url => { calls.push(url); return Promise.resolve({ ok: false, text: () => Promise.resolve('') }); };
  await assert.rejects(ensureD3Contour(), /failed to load/);
  win.fetch = url => { calls.push(url); return Promise.resolve({ ok: true, text: () => Promise.resolve(
    url.includes('d3-array') ? "exports.bisect = 'from d3-array';"
      : "var a = require('d3-array'); exports.contours = function () { return a.bisect; };") }); };
  const contours = await ensureD3Contour();
  assert.equal(typeof contours, 'function');
  assert.equal(contours(), 'from d3-array', 'd3-contour got d3-array through require');
  assert.deepEqual(plain(win.d3), { version: '3.5.17' }, 'no window.d3 pollution');
  const before = calls.length;
  assert.strictEqual(await ensureD3Contour(), contours);
  assert.equal(calls.length, before, 'loaded once');
  assert.ok(calls.some(u => /d3-array@3\.2\.4/.test(u)) && calls.some(u => /d3-contour@4\.0\.2/.test(u)), 'pinned versions');
});

test('kde layer: a new deck.gl id for every set of bands, the same one between redraws (deck keeps buffers by id)', async () => {
  // d3-contour replaced by a stub that cuts one triangle per threshold; GeoJsonLayer by a recorder
  class FakeGeoJsonLayer { constructor(props) { this.props = props; } }
  setDeckLayerClassesForTests({ GeoJsonLayer: FakeGeoJsonLayer });
  win.fetch = url => Promise.resolve({ ok: true, text: () => Promise.resolve(
    url.includes('d3-array') ? 'exports.noop = 1;'
      : `exports.contours = function () {
           let thresholds = [];
           const gen = () => thresholds.map(t => ({ type: 'MultiPolygon', value: t, coordinates: [[[[1, 1], [3, 1], [3, 3], [1, 1]]]] }));
           gen.size = () => gen; gen.thresholds = v => { thresholds = v; return gen; };
           return gen;
         };`) });
  const lat0 = 45, lng0 = 12, pts = [];
  for (let i = 0; i < 8; i++) pts.push({ geometry: { type: 'Point', coordinates: [lng0 + i * 0.01, lat0 + (i % 3) * 0.01] }, properties: {} });
  const waiters = [];
  let redraws = 0;
  const rt = {
    name: 'kde', flags: new Set(['KDE']), features: pts, style: { colorscheme: ['#336699'] },
    binding: { position: 'lat|lon', value: '$item$' }, _dataGen: 3, _viewMoving: false,
    _dataLayerId: LayerRuntime.prototype._dataLayerId,
    _triggerRedraw() { redraws++; waiters.splice(0).forEach(r => r()); }
  };
  const build = bbox => LayerRuntime.prototype._buildKdeLayers.call(rt, 7, bbox, null);
  const nextRedraw = () => new Promise(r => waiters.push(r));
  const viewA = [11.9, 44.9, 12.2, 45.2], viewB = [11.95, 44.95, 12.25, 45.25], viewC = [11.0, 44.0, 12.0, 45.0];
  try {
    kdeReset(); noWorkerEnv();

    assert.equal(build(viewA).length, 0, 'no bands until they are computed');
    await nextRedraw();                                            // the computation, then the redraw it asks for
    const [a1] = build(viewA);
    assert.equal(a1.props.id, 'ix-kde-kde-b1-d3', 'generation 1 of this theme\'s data');
    const [a2] = build(viewA);
    assert.equal(a2.props.id, a1.props.id, 'redraws of the same bands keep the layer');
    assert.strictEqual(a2.props.data, a1.props.data);

    const [stale] = build(viewB);                                  // the view changed: the old bands stay until the new ones are in
    assert.equal(stale.props.id, a1.props.id);
    await nextRedraw();
    const [b1] = build(viewB);
    assert.equal(b1.props.id, 'ix-kde-kde-b2-d3', 'new bands, new layer id');
    assert.notStrictEqual(b1.props.data, a1.props.data);
    assert.equal(b1.props.opacity, 0.25, 'default opacity of the stacked bands');
    assert.deepEqual(plain(b1.props.getFillColor({ properties: { level: 0 } })), [51, 102, 153]);

    const before = redraws;                                        // while the map moves nothing is computed
    rt._viewMoving = true;
    assert.equal(build(viewC)[0].props.id, b1.props.id);
    await new Promise(r => setTimeout(r, 300));
    assert.equal(redraws, before, 'no computation while moving');
  } finally { kdeReset(); noWorkerEnv(); delete win.fetch; }
});
