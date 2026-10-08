// CHART|PIE / DONUT: flat's slice layout (maptheme.js drawChart's PIE
// branch, piechart.js DonutChart.realize), its leader-line value labels
// (drawDonutText) and the theme statistics a pie theme gets (_preparePie).
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
const { pieSliceLayout, pieValueLabelLayout, normalizeTheme, LayerRuntime } = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));
const angles = l => plain(l.slices.map(s => [s.i, Math.round(s.start * 1000) / 1000, Math.round(s.sweep * 1000) / 1000]));

test('pie: slices clockwise from 12 o\'clock, their share of the parts\' sum', () => {
  assert.deepEqual(angles(pieSliceLayout([1, 1, 2], 'CHART|PIE')), [[0, 0, 90], [1, 90, 90], [2, 180, 180]]);
  const one = pieSliceLayout([5], 'CHART|PIE');
  assert.deepEqual(angles(one), [[0, 0, 360]], 'a single part is the full circle');
  assert.equal(one.inner, 0);
});

test('pie: no pie without a sum (flat returns null)', () => {
  assert.equal(pieSliceLayout([0, 0], 'CHART|PIE'), null);
  assert.equal(pieSliceLayout([NaN, 0], 'CHART|PIE'), null, 'a missing value counts 0');
  assert.deepEqual(angles(pieSliceLayout([-2, 1], 'CHART|PIE')), [[1, 0, 360]], 'a sum other than 0 draws: the positive part alone is the full circle');
});

test('pie: negative parts are no slice; 0 parts are a slice without angle (not drawn, but counted as a donut part)', () => {
  assert.deepEqual(angles(pieSliceLayout([3, -1, 1], 'CHART|PIE')), [[0, 0, 270], [2, 270, 90]]);
  const z = pieSliceLayout([1, 0, 1], 'CHART|PIE');
  assert.deepEqual(angles(z), [[0, 0, 180], [2, 180, 180]]);
  assert.deepEqual(plain(z.slices.map(s => s.k)), [0, 2], 'k: flat\'s donut part index, the 0 part included');
  assert.deepEqual(plain(pieSliceLayout([1, 0, 1], 'CHART|PIE|ZEROISNOTVALUE').slices.map(s => s.k)), [0, 1]);
});

test('pie: SORT biggest first; REVERSE takes flat\'s index n − i literally (the first part is lost)', () => {
  assert.deepEqual(angles(pieSliceLayout([1, 3, 2], 'CHART|PIE|SORT')).map(a => a[0]), [1, 2, 0]);
  assert.deepEqual(angles(pieSliceLayout([1, 2, 3], 'CHART|PIE|REVERSE')), [[2, 0, 216], [1, 216, 144]]);
});

test('pie: DONUT hole 0.42 of the radius, THICK 0.25, THIN 0.66, XTHIN 0.95', () => {
  assert.equal(pieSliceLayout([1, 1], 'CHART|PIE|DONUT').inner, 0.42);
  assert.equal(pieSliceLayout([1, 1], 'CHART|PIE|DONUT|THICK').inner, 0.25);
  assert.equal(pieSliceLayout([1, 1], 'CHART|PIE|DONUT|THIN').inner, 0.66);
  assert.equal(pieSliceLayout([1, 1], 'CHART|PIE|DONUT|XTHIN').inner, 0.95);
  assert.equal(pieSliceLayout([1], 'CHART|PIE|DONUT').inner, 0.42, 'a record\'s 1-part donut keeps its hole (flat: no nCount)');
  assert.equal(pieSliceLayout([1], 'CHART|PIE|DONUT', { itemCount: 1 }).inner, 0, 'an aggregated 1-record item of 1 part: no hole');
});

test('pie: CENTER — the center part is a disc of √(value / sum · 2) radius, the others the ring around it', () => {
  const l = pieSliceLayout([1, 2, 1], 'CHART|PIE|CENTER');
  assert.deepEqual(plain(l.center), { i: 1, value: 2, size: 100 }, 'default: the biggest part');
  assert.ok(Math.abs(l.inner - 1) < 1e-12);
  assert.deepEqual(angles(l), [[0, 0, 180], [2, 180, 180]]);
  assert.equal(pieSliceLayout([1, 2, 1], 'CHART|PIE|CENTER', { centerPart: 'first' }).center.i, 0);
  assert.equal(pieSliceLayout([1, 2, 3], 'CHART|PIE|CENTER', { centerPart: 'min' }).center.i, 0);
  assert.equal(pieSliceLayout([1, 2, 3], 'CHART|PIE|CENTER', { centerPart: 'last' }).center.i, 2);
  assert.equal(pieSliceLayout([1, 2, 3], 'CHART|PIE|CENTERVALUE').center.i, 2, 'CENTERVALUE contains CENTER (flat tests substrings)');
  const d = pieSliceLayout([1, 2, 1], 'CHART|PIE|DONUT|CENTER');
  assert.equal(d.center, null, 'DONUT|CENTER: every part is a slice, no disc');
  assert.equal(d.slices.length, 3);
});

test('pie: SYMMETRIC centers the first part on 12 o\'clock, HALF spreads 180° from 270°', () => {
  assert.deepEqual(angles(pieSliceLayout([1, 3], 'CHART|PIE|SYMMETRIC')), [[0, 315, 90], [1, 45, 270]]);
  assert.deepEqual(angles(pieSliceLayout([1, 1], 'CHART|PIE|HALF')), [[0, 270, 90], [1, 0, 90]]);
  assert.deepEqual(angles(pieSliceLayout([1, 1], 'CHART|PIE|HALFPLUS10')), [[0, 260, 100], [1, 0, 100]]);
});

test('pie: AUTOCOMPLETE completes values below 100 (percentages) with a no-data part', () => {
  const l = pieSliceLayout([20, 30], 'CHART|PIE|AUTOCOMPLETE');
  assert.deepEqual(plain(l.slices.map(s => [s.i, s.percent, !!s.complement])), [[0, 20, false], [1, 30, false], [-1, 50, true]]);
  assert.deepEqual(plain(pieSliceLayout([60, 60], 'CHART|PIE|AUTOCOMPLETE').slices.map(s => s.percent)), [50, 50], 'above 100: shares, as without');
});

test('pie VALUES: a label per slice right or left of the pie, leader line from the rim (drawDonutText)', () => {
  const l = pieSliceLayout([1, 1], 'CHART|PIE');
  const labels = pieValueLabelLayout(l.slices, 10, 5, 1, 4);
  assert.equal(labels.length, 2);
  const right = labels.find(x => x.anchor === 'start'), left = labels.find(x => x.anchor === 'end');
  assert.equal(right.slice.i, 0);
  assert.equal(left.slice.i, 1);
  // text at R + 2u + 3.5u, the leader line starting on the rim
  assert.ok(Math.abs(right.x - 15.5) < 1e-9 && Math.abs(left.x + 15.5) < 1e-9);
  assert.ok(Math.abs(right.segments[0][0] - 10) < 1e-9, 'from the rim at 3 o\'clock');
  assert.equal(pieValueLabelLayout(l.slices, 10, 5, 1, 1).length, 1, 'only flat\'s first min(50, classes) donut parts');
});

test('pie theme: classes over every part value, as many as colors; nMin/nMax of the parts (flat partsA, --flat-oracle)', () => {
  const spec = normalizeTheme({ layer: 'c', binding: { value: 'a|b', size: 'p' }, style: { type: 'CHART|PIE|SIZE', colorscheme: ['#ff0000', '#00ff00', '#0000ff'] } });
  const pt = (props, i) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [i, 45] } });
  const rt = new LayerRuntime(spec, { type: 'FeatureCollection', features: [pt({ a: 1, b: 2, p: 10 }, 1), pt({ a: 0, b: 9.5, p: 20 }, 2)] }, {});
  assert.equal(rt._isPieChart(), true);
  assert.equal(rt._valueMin, 0);
  assert.equal(rt._valueMax, 9.5);
  assert.deepEqual(plain(rt.partsA.map(p => [p.min, Math.round(p.max * 1e6) / 1e6])), [[0, 3], [3, 6], [6, 9.501095]]);
  assert.deepEqual(plain(rt.categoryLabels), ['a', 'b'], 'one legend row per field');
  assert.equal(rt._maxSizeValue, 20);
  assert.equal(rt._isMultiFieldChart(), true);
  const agg = new LayerRuntime(normalizeTheme({ layer: 'c', binding: { value: 'a|b' }, style: { type: 'CHART|PIE|AGGREGATE' } }), { type: 'FeatureCollection', features: [] }, {});
  assert.equal(agg._isPieChart(), false, 'an AGGREGATE pie has no renderer yet');
  const cat = new LayerRuntime(normalizeTheme({ layer: 'c', binding: { value: 'a' }, style: { type: 'CHART|PIE|CATEGORICAL' } }), { type: 'FeatureCollection', features: [] }, {});
  assert.equal(cat._isPieChart(), false, 'nor a CATEGORICAL one');
});
