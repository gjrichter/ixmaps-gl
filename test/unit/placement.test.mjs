// Chart placement on FEATURE layers, flat's aggregation grid origin,
// aggregation by scale (px / meters / field), DIFFERENCE on the cell sums,
// and the chart/feature/box scale gates — against flat's own rules and
// values read from flat.
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
const G = win.__ixmapsGlInternals;
const flags = (...f) => new Set(f);
const plain = v => JSON.parse(JSON.stringify(v));
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

// a FEATURE runtime stand-in: joinChartPositions reads name, flags, binding.id, features
const featureRt = (name, id, features) => ({ name, flags: flags('FEATURE'), binding: { id }, features });
const pt = (props, lng, lat) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lng, lat] } });
const poly = (props, ring) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
const square = [[10, 44], [12, 44], [12, 46], [10, 46], [10, 44]];

test('placement: the first shape of an id stays (a point has no area), as flat — the comuni sit on their urban centroid', () => {
  const rts = [featureRt('L', 'PRO_COM', [pt({ PRO_COM: 1001 }, 7.7686, 45.36343)]), featureRt('L', 'PRO_COM', [poly({ PRO_COM: 1001 }, square)])];
  const spec = { name: 'L', flags: flags('CHART'), binding: { lookup: 'k' }, style: {} };
  const fc = G.joinChartPositions(spec, { rows: [{ k: '1001', v: 1 }] }, rts);
  assert.deepEqual(plain(fc.features.map(f => f.geometry.coordinates)), [[7.7686, 45.36343]], 'measured on flat: distance 0 to the point');
});

test('placement: a polygon is placed at flat\'s shape center, the vertex mean in Mercator', () => {
  const c = G.flatShapeCenter({ type: 'Polygon', coordinates: [square] });
  near(c[0], (10 + 12 + 12 + 10 + 10) / 5, 'lon: vertex mean');
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const my = (merc(44) * 3 + merc(46) * 2) / 5;
  near(c[1], (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI, 'lat: mean in Mercator');
});

test('placement: the lookup key is padded to lookupdigits and read as a number with lookuptonumber; records without a shape are left out', () => {
  const rts = [featureRt('L', 'PRO_COM', [pt({ PRO_COM: 1001 }, 7, 45)])];
  const spec = style => ({ name: 'L', flags: flags('CHART'), binding: { lookup: 'k' }, style });
  const rows = { rows: [{ k: '1001' }, { k: '9999' }] };
  assert.equal(G.joinChartPositions(spec({ lookupdigits: '6', lookuptonumber: true }), rows, rts).features.length, 1, '"001001" → 1001');
  assert.equal(G.joinChartPositions(spec({ lookupdigits: '6' }), rows, rts).features.length, 0, '"001001" is not 1001');
  assert.equal(G.flatLookupKey('ab', { lookuptoupper: 'true' }), 'AB');
});

test('placement: a theme on "a|b" is placed on each layer; a DIFFERENCE theme only on the last (flat empties the earlier layers\' values)', () => {
  const rts = [featureRt('a', 'id', [pt({ id: 'x' }, 1, 1)]), featureRt('b', 'id', [pt({ id: 'x' }, 2, 2)])];
  const rows = { rows: [{ k: 'x' }] };
  const both = G.joinChartPositions({ name: 'a|b', flags: flags('CHART'), binding: { lookup: 'k' }, style: {} }, rows, rts);
  assert.deepEqual(plain(both.features.map(f => f.geometry.coordinates)), [[1, 1], [2, 2]]);
  const last = G.joinChartPositions({ name: 'a|b', flags: flags('CHART', 'DIFFERENCE'), binding: { lookup: 'k' }, style: {} }, rows, rts);
  assert.deepEqual(plain(last.features.map(f => f.geometry.coordinates)), [[2, 2]]);
});

test('grid: flat\'s origin — the equator and lon -50.8192 (flat\'s map x = 1355.178 + 26.667·lon)', () => {
  const z = 5.2768;
  const world = 512 * Math.pow(2, z);
  const ox = (-50.81917438040 + 180) / 360 * world, oy = world / 2;
  const s = G.snapToAggregationGrid(ox + 37.4, oy - 12.2, 25, flags('RECT'), z);
  near(s.x, ox + 25, 'x rounds to origin + n·cell', 1e-6);
  near(s.y, oy - 0, 'y rounds to the equator + n·cell', 1e-6);
});

test('aggregation scale: the last matching bracket wins; a field name groups by that field, "0" is no grid', () => {
  const agg = ['1:1', 'PROCOM.1', '1:10000', '50px', '1:2000000', '25px', '1:7000000', 'REGIONE.1'];
  const at = flatZoom => G.resolveAggregationPx(agg, G.flatToMapLibreZoom(flatZoom), null, 0);
  assert.deepEqual([at(6.28).px, at(6.28).field], [25, null], 'flat zoom 6.28 = 1:5.7M → 25px (flat)');
  assert.deepEqual([at(5.8).field, at(5.8).matched], ['REGIONE.1', true], 'flat zoom 5.8 = 1:7.9M → REGIONE.1 (flat)');
  const small = ['1:1', '0', '1:10000', '50px'];
  assert.equal(G.resolveAggregationPx(small, G.flatToMapLibreZoom(15), null, 0).px, 50, '1:13 517 is above 1:10 000 → 50px');
  assert.equal(G.resolveAggregationPx(small, G.flatToMapLibreZoom(16), null, 0).px, 0, '1:6 758 → "0", no grid');
  assert.equal(G.resolveAggregationPx(null, 8, null, 0).matched, false);
});

test('aggregation by field: one cell per value, at the members\' mean position; DIFFERENCE|RELATIVE on the cell sums', () => {
  const f = (region, lng, s1, s2) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, 45] }, properties: { value: 0, series: [s1, s2], raw: { REG: region } } });
  const fl = flags('AGGREGATE', 'DIFFERENCE', 'RELATIVE');
  const post = (v, v100, series) => (series ? G.cellAggregatedValues({ sums: series, counts: [1, 1] }, fl, {})[0] : v);
  const cells = G.aggregateOnGrid([f('A', 9, 100, 110), f('A', 11, 300, 270), f('B', 12, 50, 50)], 6, null, fl, post, 'REG');
  const a = cells.find(c => c.properties.point_count === 2);
  near(a.geometry.coordinates[0], 10, 'mean lng');
  near(a.properties.value, 100 / 400 * (380 - 400), '(Σv2 − Σv1) in % of Σv1 = −5');
  assert.equal(cells.length, 2);
});

test('scale gates: chartupper / chartlower (flat: hidden above upper, at or below lower), layerupper as their stand-in', () => {
  const ml = flatZoom => G.flatToMapLibreZoom(flatZoom);
  // flat zoom 6.28 ≈ 1:5.7M, 10 = 1:432 533, 12 = 1:108 133
  assert.equal(G.chartHiddenByScale({ chartupper: '1:500000' }, ml(6.28)), true);
  assert.equal(G.chartHiddenByScale({ chartupper: '1:500000' }, ml(10)), false);
  assert.equal(G.chartHiddenByScale({ chartlower: '1:150000' }, ml(12)), true);
  assert.equal(G.chartHiddenByScale({ chartlower: '1:150000' }, ml(10)), false);
  assert.equal(G.chartHiddenByScale({ layerupper: '1:500000' }, ml(6.28)), true);
  assert.equal(G.featuresHiddenByScale({ featureupper: '1:150000' }, ml(12)), false);
  assert.equal(G.boxHiddenByScale({ boxupper: '1:200000' }, ml(10)), true);
});

test('range classes: rangecentervalue makes the range symmetric around it (flat: 2 classes split at −0.45 for ±15.45)', () => {
  const values = [-15.1205, 15.4465];
  const parts = G.flatRangeParts(values, -15.1205, 15.4465, 2, flags(), 0);
  near(parts[0].min, -15.4465, 'symmetric min', 1e-3);
  near(parts[0].max, -0.4465, 'flat\'s split', 1e-3);
});

test('shadow gate: style.shadow true, at most maxshadow (1000) shapes, within shadowupper / shadowlower — as flat', () => {
  const ml = flatZoom => G.flatToMapLibreZoom(flatZoom);
  assert.equal(G.flatShadowOn({ shadow: true }, 21, ml(6.28)), true);
  assert.equal(G.flatShadowOn({ shadow: 'true' }, 21, ml(6.28)), true);
  assert.equal(G.flatShadowOn({}, 21, ml(6.28)), false);
  assert.equal(G.flatShadowOn({ shadow: true }, 1001, ml(6.28)), false, 'flat: nToDraw > nMaxShadowCharts');
  assert.equal(G.flatShadowOn({ shadow: true, maxshadow: 5000 }, 1001, ml(6.28)), true);
  assert.equal(G.flatShadowOn({ shadow: true, shadowupper: '1:1000000' }, 21, ml(6.28)), false, '1:5.7M is above 1:1M');
  assert.equal(G.flatShadowOn({ shadow: true, shadowlower: '1:1000000' }, 21, ml(12)), false, '1:108 133 is below 1:1M');
});
