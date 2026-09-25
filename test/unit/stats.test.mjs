// Pure per-theme statistics (computeX) and per-item lookups (resolveX)
// extracted from LayerRuntime, plus the aggregation value math. Hand-checked
// small inputs; ctx objects stand in for the runtime.
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
const plain = v => JSON.parse(JSON.stringify(v));
const feat = props => ({ type: 'Feature', properties: props, geometry: null });
const flags = (...f) => new Set(f);

// ---- range classes
test('computeRangeClasses: min/max/median, equal interval by default, labels via the formatter', () => {
  const r = G.computeRangeClasses([1, 2, 3, 4, 5, 'x'].map(v => feat({ v })), { value: 'v' }, { classes: 2 }, flags(), x => `#${x}`);
  assert.equal(r._valueMin, 1);
  assert.equal(r._valueMax, 5);
  assert.equal(r._valueMedian, 3);
  assert.deepEqual(plain(r.partsA), [{ min: 1, max: 3 }, { min: 3, max: 5 }]);
  assert.deepEqual(plain(r.categoryLabels), ['#1 - #3', '#3 - #5']);
  assert.equal(r.categoryColorsRgb.length, 2);
  assert.equal(r._rangeClassed, true);
});

test('computeRangeClasses: QUANTILE and NATURAL pick their break functions', () => {
  const fs_ = [1, 2, 3, 10, 11, 12].map(v => feat({ v }));
  const q = G.computeRangeClasses(fs_, { value: 'v' }, { classes: 2 }, flags('QUANTILE'), String);
  assert.deepEqual(plain(q.partsA), plain(G.quantileBreaks([1, 2, 3, 10, 11, 12], 2)));
  const n = G.computeRangeClasses(fs_, { value: 'v' }, { classes: 2 }, flags('NATURAL'), String);
  assert.deepEqual(plain(n.partsA), plain(G.naturalBreaks([1, 2, 3, 10, 11, 12], 2)));
});

test('computeRangeClasses: no numeric value at all → null (the runtime keeps nothing)', () => {
  assert.equal(G.computeRangeClasses([feat({ v: 'a' })], { value: 'v' }, {}, flags(), String), null);
});

// ---- multi-field / DOMINANT
test('computeMultiFieldClasses: fields from the piped value; style.values relabels when lengths match', () => {
  const r = G.computeMultiFieldClasses({ value: 'a|b' }, { values: ['A', 'B'] });
  assert.deepEqual(plain(r._multiFields), ['a', 'b']);
  assert.deepEqual(plain(r.categoryLabels), ['A', 'B']);
  assert.deepEqual(plain(G.computeMultiFieldClasses({ value: 'a|b' }, { values: ['only one'] }).categoryLabels), ['a', 'b']);
});

test('computeDominantStats: per-field mean/min/stddev, zeros and NaN skipped (flat\'s truthy pooling)', () => {
  const r = G.computeDominantStats([feat({ a: 2, b: 0 }), feat({ a: 4, b: 6 }), feat({ a: 'x', b: 10 })], { value: 'a|b' }, {});
  assert.deepEqual(plain(r._dominantMeans), [3, 8]);
  assert.deepEqual(plain(r._dominantMins), [2, 6]);
  assert.deepEqual(plain(r._dominantStdDevs), [1, 2]);
});

test('resolveDominantClass: plain = highest raw value; PERCENTOFMEAN / DEVIATION rank relative to the field', () => {
  const ctx = { _multiFields: ['a', 'b'], _dominantMeans: [10, 100], _dominantMins: [1, 1], _dominantStdDevs: [1, 50], flags: flags() };
  assert.deepEqual(plain(G.resolveDominantClass(ctx, { a: 20, b: 50 })), { index: 1, value: 50 });
  ctx.flags = flags('PERCENTOFMEAN');   // a: 200 %, b: 50 %
  assert.equal(G.resolveDominantClass(ctx, { a: 20, b: 50 }).index, 0);
  ctx.flags = flags('DEVIATION');       // a: (20-10)/1 = 10, b: (50-100)/50 < 0
  assert.equal(G.resolveDominantClass(ctx, { a: 20, b: 50 }).index, 0);
  assert.equal(G.resolveDominantClass(ctx, { a: 0.5, b: 0.5 }), null, 'below every field minimum → no class');
});

// ---- COMPOSECOLOR
test('computeComposeColorStats + resolveComposedColor: additive blend, peak-normalized', () => {
  const stats = G.computeComposeColorStats([feat({ r: 1, g: 0 }), feat({ r: 0, g: 2 })], { value: 'r|g' }, { colorscheme: ['#ff0000', '#00ff00'] });
  assert.equal(stats._composeColorMax, 2);
  const ctx = Object.assign({ flags: flags(), style: {} }, stats);
  assert.deepEqual(plain(G.resolveComposedColor(ctx, { r: 2, g: 0 })), [255, 0, 0]);
  const mix = G.resolveComposedColor(ctx, { r: 2, g: 2 });
  assert.equal(mix[0], mix[1], 'equal weights → equal red and green');
  assert.equal(mix[2], 0);
});

test('resolveComposedColor SUBTRACTIVE: stronger values darken toward the complement', () => {
  const stats = G.computeComposeColorStats([feat({ c: 1 })], { value: 'c' }, { colorscheme: ['#00ffff'] });
  const ctx = Object.assign({ flags: flags('SUBTRACTIVE'), style: {} }, stats);
  const [r, g, b] = G.resolveComposedColor(ctx, { c: 1 });
  assert.ok(r < g && r < b, `cyan's complement (red) is removed: ${[r, g, b]}`);
});

// ---- alpha / DOPACITY
test('computeAlphaStats: plain alpha field, alpha100 ratio, no alpha binding → null', () => {
  const a = feat({ x: 5 }), b = feat({ x: 10 });
  const r = G.computeAlphaStats([a, b], { alpha: 'x' });
  assert.equal(r._alphaMax, 10);
  assert.equal(r._alphaByFeature.get(a), 5);
  const c = feat({ x: 5, tot: 50 });
  assert.equal(G.computeAlphaStats([c], { alpha: 'x', alpha100: 'tot' })._alphaByFeature.get(c), 10);
  assert.equal(G.computeAlphaStats([a], {}), null);
});

test('resolveDopacityAlpha: DOPACITYMAX is linear from min to max, capped at the base opacity', () => {
  const ctx = { style: {}, binding: {}, flags: flags('DOPACITYMAX'), _valueMin: 0, _valueMax: 10, _valueMedian: 5 };
  assert.equal(G.resolveDopacityAlpha(ctx, null, 10, 0.8), 0.8);
  assert.equal(G.resolveDopacityAlpha(ctx, null, 5, 0.8), 0.4);
  assert.equal(G.resolveDopacityAlpha(ctx, null, 0, 0.8), 0);
  assert.equal(G.resolveDopacityAlpha(ctx, null, NaN, 0.8), null);
});

test('resolveDopacityAlpha with an alpha binding reads the precomputed per-feature alpha', () => {
  const f = feat({});
  const ctx = { style: {}, binding: { alpha: 'x' }, flags: flags(), _alphaByFeature: new WeakMap([[f, 5]]), _alphaMax: 10 };
  assert.equal(G.resolveDopacityAlpha(ctx, f, NaN, 0.9), 0.5);
  assert.equal(G.resolveDopacityAlpha(ctx, feat({}), NaN, 0.9), null, 'feature without an alpha value');
});

// ---- aggregation value math
test('resolveAggregateValue: size field, else SUM of the value field, else a count of 1', () => {
  assert.equal(G.resolveAggregateValue({ size: 's' }, flags(), { s: '4' }), 4);
  assert.equal(G.resolveAggregateValue({ size: 's' }, flags(), { s: 'x' }), 0);
  assert.equal(G.resolveAggregateValue({ value: 'v' }, flags('SUM'), { v: 3 }), 3);
  assert.equal(G.resolveAggregateValue({ value: 'v' }, flags(), { v: 3 }), 1);
});

test('cellAggregatedValues: sums, or means with MEAN', () => {
  const cell = { sums: [10, 6], counts: [2, 3] };
  assert.deepEqual(plain(G.cellAggregatedValues(cell, flags())), [10, 6]);
  assert.deepEqual(plain(G.cellAggregatedValues(cell, flags('MEAN'))), [5, 2]);
});

test('oneHot places the value at the category index', () => {
  assert.deepEqual(plain(G.oneHot(1, 7, 3)), [0, 7, 0]);
});

test('groupCoLocated: points in the same grid cell merge; per-category values and record counts add up', () => {
  const pt = (lng, lat, cat, value, point_count) => ({ geometry: { coordinates: [lng, lat] }, properties: { cat, value, point_count } });
  const groups = G.groupCoLocated([pt(9.19, 45.46, 0, 2), pt(9.19, 45.46, 1, 3, 4), pt(-70, -30, 0, 1)], 10, 2, 2, flags());
  assert.equal(groups.length, 2);
  const milan = groups.find(g => g.properties.total === 5);
  assert.deepEqual(plain(milan.properties.counts), [2, 3]);
  assert.deepEqual(plain(milan.properties.recordCounts), [1, 4]);
});

// ---- class count (flat: number of classes = number of colors in the scheme)
test('colorSchemeClassCount: explicit list → its length; generator ["N", …] → N; function/none → unknown', () => {
  assert.equal(G.colorSchemeClassCount(['#a', '#b', '#c', '#d', '#e', '#f']), 6);
  assert.equal(G.colorSchemeClassCount(['#a']), 1);
  assert.equal(G.colorSchemeClassCount(['7', '#36A6B1', '#b94023', '3colors', '#DDA729']), 7);
  assert.equal(G.colorSchemeClassCount('function (t) {}'), null);
  assert.equal(G.colorSchemeClassCount(['none']), null);
  assert.equal(G.colorSchemeClassCount(undefined), null);
});

test('computeRangeClasses: without style.classes the class count follows the colors (flat); classes still wins', () => {
  const fs_ = Array.from({ length: 30 }, (_, i) => feat({ v: i }));
  assert.equal(G.computeRangeClasses(fs_, { value: 'v' }, { colorscheme: ['#1', '#2', '#3', '#4', '#5', '#6'] }, flags('QUANTILE'), String).partsA.length, 6);
  assert.equal(G.computeRangeClasses(fs_, { value: 'v' }, { colorscheme: ['7', '#a', '#b', '3colors', '#c'] }, flags(), String).partsA.length, 7);
  assert.equal(G.computeRangeClasses(fs_, { value: 'v' }, { classes: 3, colorscheme: ['#1', '#2', '#3', '#4', '#5', '#6'] }, flags(), String).partsA.length, 3);
  assert.equal(G.computeRangeClasses(fs_, { value: 'v' }, { colorscheme: 'function (t) {}' }, flags(), String).partsA.length, 5, 'unknown count → default 5');
});
