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
test('computeRangeClasses: min/max/median, equal interval by default (flat range rules), labels via the formatter', () => {
  const r = G.computeRangeClasses([1, 2, 3, 4, 5, 'x'].map(v => feat({ v })), { value: 'v' }, { classes: 2 }, flags(), x => `#${x}`);
  assert.equal(r._valueMin, 1);
  assert.equal(r._valueMax, 5);
  assert.equal(r._valueMedian, 3);
  // flat: max 5 → 5.00005 (max/100000), step 2.000025 floored to 2, last max + 0.001
  assert.deepEqual(plain(r.partsA), [{ min: 1, max: 3 }, { min: 3, max: 5.00105 }]);
  assert.deepEqual(plain(r.categoryLabels), ['#1 - #3', '#3 - #5.00105']);
  assert.equal(r.categoryColorsRgb.length, 2);
  assert.equal(r._rangeClassed, true);
});

test('computeRangeClasses: QUANTILE and NATURAL pick their break functions', () => {
  const fs_ = [1, 2, 3, 10, 11, 12].map(v => feat({ v }));
  // flat: the break algorithm's classes, the last max being the adjusted max
  const lastMax = 12 + 12 / 100000 + 0.001;
  const withFlatMax = parts => { parts[parts.length - 1].max = lastMax; return parts; };
  const q = G.computeRangeClasses(fs_, { value: 'v' }, { classes: 2 }, flags('QUANTILE'), String);
  assert.deepEqual(plain(q.partsA), withFlatMax(plain(G.quantileBreaks([1, 2, 3, 10, 11, 12], 2))));
  const n = G.computeRangeClasses(fs_, { value: 'v' }, { classes: 2 }, flags('NATURAL'), String);
  assert.deepEqual(plain(n.partsA), withFlatMax(plain(G.naturalBreaks([1, 2, 3, 10, 11, 12], 2))));
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

test('computeDominantStats: mean/min over every finite value incl. 0 (mean ÷ item count); stddev over non-zero values only — as flat', () => {
  const r = G.computeDominantStats([feat({ a: 2, b: 0 }), feat({ a: 4, b: 6 }), feat({ a: 'x', b: 10 })], { value: 'a|b' }, {});
  assert.deepEqual(plain(r._dominantMeans), [2, 16 / 3], 'flat nMeanA = nSumA / nCount (all 3 items)');
  assert.deepEqual(plain(r._dominantMins), [2, 0], 'flat nMinA includes 0');
  assert.deepEqual(plain(r._dominantStdDevs), [1, 2], 'flat getDeviationOfArray over the truthy pool [2,4] / [6,10]');
  const withUnjoined = G.computeDominantStats([feat({ a: 2, b: 0 }), feat({ a: 4, b: 6 }), feat({ a: 'x', b: 10 }), feat({})], { value: 'a|b' }, {});
  assert.deepEqual(plain(withUnjoined._dominantMeans), [2, 16 / 3], 'a polygon without a joined record is not an item');
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

test('resolveDominantClass: the min filter applies in plain DOMINANT too (flat: nValue > (nFilterA[i] || 0))', () => {
  const ctx = { _multiFields: ['a', 'b'], _dominantMeans: [0, 0], _dominantMins: [5, 1], _dominantStdDevs: [1, 1], flags: flags() };
  assert.equal(G.resolveDominantClass(ctx, { a: 5, b: 3 }).index, 1, 'a equals its min → excluded, b wins');
  assert.equal(G.resolveDominantClass(ctx, { a: 4, b: 1 }), null);
  ctx._dominantMins = [-3, -3];
  assert.equal(G.resolveDominantClass(ctx, { a: -1, b: -2 }), null, 'negative values pass the filter but never beat the 0 start');
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
test('resolveAggregateValue (the cell SIZE): size field; CATEGORICAL → count; value-based → the value, SUM or not (flat)', () => {
  assert.equal(G.resolveAggregateValue({ size: 's' }, flags(), { s: '4' }), 4);
  assert.equal(G.resolveAggregateValue({ size: 's' }, flags(), { s: 'x' }), 0);
  assert.equal(G.resolveAggregateValue({ value: 'v' }, flags('SUM'), { v: 3 }), 3);
  assert.equal(G.resolveAggregateValue({ value: 'v' }, flags(), { v: 3 }), 3, 'flat aggregates by sum by default');
  assert.equal(G.resolveAggregateValue({ value: 'v' }, flags(), { v: 'x' }), 0);
  assert.equal(G.resolveAggregateValue({ value: 'cat' }, flags('CATEGORICAL'), { cat: 'A' }), 1, 'CATEGORICAL: count per category');
  assert.equal(G.resolveAggregateValue({ value: 'cat', size: 's' }, flags('CATEGORICAL'), { cat: 'A', s: 5 }), 5);
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

// ---- AGGREGATE grid (flat: snap to the grid, one item per cell)
const pt = (lng, lat, value) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { value, raw: {} } });

test('aggregateOnGrid: records in one cell become one item with the summed value', () => {
  // two records ~1 m apart and one far away, 10px cells at zoom 12
  const items = G.aggregateOnGrid([pt(9.19, 45.46, 2), pt(9.19001, 45.46001, 3), pt(9.3, 45.5, 7)], 12, 10, flags('RECT'));
  assert.equal(items.length, 2);
  const merged = items.find(f => f.properties.cluster);
  assert.equal(merged.properties.point_count, 2);
  assert.equal(merged.properties.value, 5);
  assert.equal(items.find(f => !f.properties.cluster).properties.value, 7, 'a single-record cell keeps its own properties');
});

test('aggregateField100: flat\'s post-aggregation field100 on the cell sums (maptheme.js 11000-11052)', () => {
  const f = (...x) => flags('AGGREGATE', ...x);
  assert.equal(G.aggregateField100(5, 20, f(), {}), 25, 'percent of the sums');
  assert.equal(G.aggregateField100(5, 0, f(), {}), 0, 'v100 not above field100min (0) → 0');
  assert.equal(G.aggregateField100(5, 20, f(), { field100min: 25 }), 0, 'field100min');
  assert.equal(G.aggregateField100(30, 20, f('RELATIVE'), {}), 50);
  assert.equal(G.aggregateField100(5, 20, f('INVERT'), {}), 75);
  assert.equal(G.aggregateField100(5, 20, f('FRACTION'), { fractionscale: 2 }), 0.5);
  assert.equal(G.aggregateField100(5, 0, f('FRACTION'), {}), 0);
  assert.equal(G.aggregateField100(5, 20, f('PERMILLE'), {}), 250);
  assert.equal(G.aggregateField100(5, 20, f('PRODUCT'), {}), 100);
  assert.equal(G.aggregateField100(33, 50, f('CALCVAL'), {}), 17);
  assert.equal(G.aggregateField100(12, 20, f('DIFFERENCE'), {}), -8);
  assert.equal(G.aggregateField100(30, 20, f('DIFFERENCE', 'RELATIVE'), {}), 50, 'DIFFERENCE|RELATIVE → the percent branch');
});

test('aggregateOnGrid with post: the cell\'s value is converted from the SUMS, single-record cells too', () => {
  const r = (lng, lat, value, value100) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { value, value100, raw: {} } });
  const post = (v, v100) => G.aggregateField100(v, v100, flags('AGGREGATE'), {});
  const items = G.aggregateOnGrid([r(9.19, 45.46, 1, 10), r(9.19001, 45.46001, 3, 30), r(9.3, 45.5, 2, 4)], 12, 10, flags('RECT'), post);
  assert.equal(items.find(f => f.properties.cluster).properties.value, 10, '(1+3)/(10+30)·100 — not 10 % + 10 % = 20');
  const single = items.find(f => !f.properties.cluster);
  assert.equal(single.properties.value, 50);
  const raw = r(9.3, 45.5, 2, 4);
  G.aggregateOnGrid([raw], 12, 10, flags('RECT'), post);
  assert.equal(raw.properties.value, 2, 'the record itself is not changed');
});

test('applyField100 leaves AGGREGATE themes to the aggregation (flat computes field100 on the sums)', () => {
  const fs_ = [feat({ a: 5, T: 20 })];
  assert.equal(G.applyField100(fs_, { value: 'a', field100: 'T' }, flags('AGGREGATE'), {}), fs_);
  assert.equal(G.field100Binding({ value: 'a|b' }, flags('AGGREGATE', 'DIFFERENCE')).value, 'a|b');
});

test('aggregateOnGrid without a grid width: only identical coordinates merge (flat keys by exact position)', () => {
  const items = G.aggregateOnGrid([pt(9.19, 45.46, 1), pt(9.19, 45.46, 1), pt(9.19001, 45.46, 1)], 12, null, flags());
  assert.equal(items.length, 2);
  assert.equal(items.find(f => f.properties.cluster).properties.point_count, 2);
});

test('aggregateOnGrid: the item sits at the cell center, with RELOCATE at the mean of its records', () => {
  const recs = [pt(9.19, 45.46, 1), pt(9.19002, 45.46002, 1)];
  const center = G.aggregateOnGrid(recs, 12, 50, flags('RECT'))[0].geometry.coordinates;
  const mean = G.aggregateOnGrid(recs, 12, 50, flags('RECT', 'RELOCATE'))[0].geometry.coordinates;
  assert.ok(Math.abs(mean[0] - 9.19001) < 1e-7 && Math.abs(mean[1] - 45.46001) < 1e-7, `mean ${mean}`);
  assert.ok(Math.abs(center[0] - 9.19001) > 1e-6, 'cell center differs from the records\' mean');
});

test('GridAggregateIndex: getClusters(bbox, zoom) filters one per-zoom aggregation by bbox', () => {
  const idx = new G.GridAggregateIndex(10, flags('RECT')).load([pt(9.19, 45.46, 2), pt(9.19001, 45.46001, 3), pt(20, 50, 1)]);
  assert.equal(idx.getClusters([-180, -85, 180, 85], 12).length, 2);
  assert.equal(idx.getClusters([9, 45, 10, 46], 12).length, 1);
});

// ---- flat's range adjustments (values from real ixmaps-flat via --flat-oracle)
const near = (a, b) => Math.abs(a - b) < 1e-9;
test('flatRangeParts: equal interval 0..81 in 5 → steps floored to 16, last max 81.00181 (flat)', () => {
  const p = G.flatRangeParts([0, 81], 0, 81, 5, flags());
  assert.deepEqual(plain(p.slice(0, 4)), [{ min: 0, max: 16 }, { min: 16, max: 32 }, { min: 32, max: 48 }, { min: 48, max: 64 }]);
  assert.equal(p[4].min, 64);
  assert.ok(near(p[4].max, 81.00181), `last max ${p[4].max}`);
});

test('flatRangeParts: QUANTILE last max = max + max/100000 + 0.001 (flat: 6.7797 → 6.780768)', () => {
  const p = G.flatRangeParts([0, 1, 2, 3, 6.7797], 0, 6.7797, 2, flags('QUANTILE'));
  assert.ok(Math.abs(p[1].max - 6.780768) < 1e-6, `last max ${p[1].max}`);
});

test('flatRangeParts: a range above 1000 rounds min/max outward to nPreClip and floors the step', () => {
  // range 4990 → nPreClip 10: min 3 → 0, max 4993 → 5000, step 1000
  const p = G.flatRangeParts([3, 4993], 3, 4993, 5, flags());
  assert.deepEqual(plain(p.map(x => x.min)), [0, 1000, 2000, 3000, 4000]);
  assert.equal(p[4].max, 5000.001);
});

test('flatRangeParts: all values equal → one class', () => {
  const p = G.flatRangeParts([1, 1, 1], 1, 1, 5, flags());
  assert.equal(p.length, 1);
  assert.equal(p[0].min, 1);
});

// ---- AGGREGATE class value (flat: cells are classed by the summed value field)
test('classValueSeparate: only where the class sum differs from the size sum', () => {
  assert.equal(G.classValueSeparate({ value: 'v' }, flags()), false, 'no size: the value sum sizes AND classes the cell');
  assert.equal(G.classValueSeparate({ value: 'v' }, flags('SUM')), false);
  assert.equal(G.classValueSeparate({ value: 'v', size: 'v' }, flags()), false);
  assert.equal(G.classValueSeparate({ value: 'v', size: 's' }, flags()), true);
  assert.equal(G.classValueSeparate({ size: 's' }, flags()), false, 'no value field: nothing to class by');
});

test('aggregateOnGrid / groupCoLocated sum a separate classValue alongside the size value', () => {
  const rec = (lng, lat, value, classValue) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { value, classValue, raw: {} } });
  const [cell] = G.aggregateOnGrid([rec(9.19, 45.46, 1, 5), rec(9.19001, 45.46001, 1, 7)], 12, 10, flags('RECT'));
  assert.equal(cell.properties.value, 2, 'size: record count');
  assert.equal(cell.properties.classValue, 12, 'class: sum of the value field');
  const [group] = G.groupCoLocated([{ ...cell, properties: { ...cell.properties, cat: 0 } }], 12, 10, 1, flags('RECT'));
  assert.equal(group.properties.classTotal, 12);
  const [plainCell] = G.aggregateOnGrid([pt(9.19, 45.46, 2), pt(9.19001, 45.46001, 3)], 12, 10, flags('RECT'));
  assert.equal(plainCell.properties.classValue, undefined, 'no classValue unless the records carry one');
});

// ---- NOOUTLIER (flat: mean over all items, deviation over the non-zero ones)
test('flatOutlierStats: mean incl. zeros, stddev over the non-zero values around their own mean', () => {
  const { mean, threshold } = G.flatOutlierStats([0, 0, 2, 4], 3);
  assert.equal(mean, 1.5, 'mean over all 4 items');
  assert.equal(threshold, 3, 'stddev of [2,4] = 1, × 3');
  // zeros don't shrink the deviation: [0 × 8, 10, 30] → pool stddev 10
  assert.equal(G.flatOutlierStats([0, 0, 0, 0, 0, 0, 0, 0, 10, 30], 3).threshold, 30);
});

// ---- range-class legend numbers (flat: partsA nCount / nSum, legend.js 644-720)
test('rangeClassLegendTotals: CHART → the drawn items per class; SUM shows the sum, else the count', () => {
  const parts = [{ min: 0, max: 5 }, { min: 5, max: 10 }];
  const rt = f => ({ categoryLabels: ['a', 'b'], flags: flags(...f), features: [], _resolvePartsClass: v => G.resolvePartsClass(v, parts),
    _legendItems: [{ cat: 0, value: 1 }, { cat: 0, value: 3 }, { cat: 1, value: 8 }] });
  const bbox = [-180, -85, 180, 85];
  assert.deepEqual(plain(G.rangeClassLegendTotals(rt(['CHART', 'SUM']), bbox, null)), [4, 8]);
  assert.deepEqual(plain(G.rangeClassLegendTotals(rt(['CHART', 'SUM', 'PERCENT']), bbox, null)), [100 * 4 / 12, 100 * 8 / 12]);
  assert.deepEqual(plain(G.rangeClassLegendTotals(rt(['CHART', 'SUM', 'MEAN']), bbox, null)), [2, 8]);
  assert.deepEqual(plain(G.rangeClassLegendTotals(rt(['CHART', 'SUM', 'COUNT']), bbox, null)), [2, 1], 'SUM|COUNT counts');
  assert.deepEqual(plain(G.rangeClassLegendTotals(rt(['CHART']), bbox, null)), [2, 1]);
});

test('rangeClassLegendTotals: CHOROPLETH → every polygon, classed by its value', () => {
  const parts = [{ min: 0, max: 5 }, { min: 5, max: 10 }];
  const poly = v => ({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { v } });
  const rt = { categoryLabels: ['a', 'b'], flags: flags('CHOROPLETH'), binding: { value: 'v' }, features: [poly(1), poly(6), poly(7), poly('x')],
    _resolvePartsClass: v => G.resolvePartsClass(v, parts) };
  assert.deepEqual(plain(G.rangeClassLegendTotals(rt, [0, 0, 0, 0], null)), [1, 2]);
});

// ---- field100 (flat: values relative to the field100 value, maptheme.js 9044-9085)
test('applyField100: percent of field100 by default; FRACTION, PERMILLE, RELATIVE, INVERT, "!" as flat', () => {
  const fs_ = [feat({ a: 25, b: 0, T: 50 }), feat({ a: 5, b: 10, T: 0 })];
  const pct = G.applyField100(fs_, { value: 'a|b', field100: 'T' }, flags(), {});
  assert.deepEqual(plain(pct.map(f => [f.properties.a, f.properties.b])), [[50, 0], [500, 1000]], 'v100 0 → 1; a 0 value stays 0');
  assert.equal(fs_[0].properties.a, 25, 'the page\'s data is not changed');
  assert.equal(G.applyField100(fs_, { value: 'a', field100: 'T' }, flags('PERMILLE'), {})[0].properties.a, 500);
  assert.equal(G.applyField100(fs_, { value: 'a', field100: 'T' }, flags('FRACTION'), { fractionscale: 10 })[0].properties.a, 5);
  assert.equal(G.applyField100(fs_, { value: 'a', field100: 'T' }, flags('RELATIVE'), {})[0].properties.a, -50);
  assert.equal(G.applyField100(fs_, { value: 'a', field100: 'T' }, flags('INVERT'), {})[0].properties.a, 50);
  assert.equal(G.applyField100(fs_, { value: '!a', field100: 'T' }, flags(), {})[0].properties['!a'], 25, '"!a" → T - a');
  assert.equal(G.applyField100(fs_, { value: 'a' }, flags(), {}), fs_, 'no field100 → the same features');
});

test('applyField100: DIFFERENCE (one value field) → v − field100; with RELATIVE the percent change (flat 9062)', () => {
  const fs_ = [feat({ today: 120, yesterday: 100 }), feat({ today: 0, yesterday: 30 })];
  const b = { value: 'today', field100: 'yesterday' };
  assert.deepEqual(plain(G.applyField100(fs_, b, flags('DIFFERENCE'), {}).map(f => f.properties.today)), [20, 0], '0 stays 0');
  assert.deepEqual(plain(G.applyField100(fs_, b, flags('DIFFERENCE', 'ZEROISVALUE'), {}).map(f => f.properties.today)), [20, -30], 'ZEROISVALUE: 0 − 30');
  assert.deepEqual(plain(G.applyField100(fs_, b, flags('DIFFERENCE', 'RELATIVE'), {}).map(f => f.properties.today)), [20, 0], 'RELATIVE: 120/100·100 − 100');
});

test('applyField100: CALCVAL/CALC100 → round(v·v100/100), PRODUCT → v·v100; v when v100 is 0 (flat 9052-9058)', () => {
  const fs_ = [feat({ p: 33, n: 50 }), feat({ p: 7, n: 0 })];
  const b = { value: 'p', field100: 'n' };
  assert.deepEqual(plain(G.applyField100(fs_, b, flags('CALCVAL'), {}).map(f => f.properties.p)), [17, 7], 'round(16.5) = 17');
  assert.deepEqual(plain(G.applyField100(fs_, b, flags('CALC100'), {}).map(f => f.properties.p)), [17, 7]);
  assert.deepEqual(plain(G.applyField100(fs_, b, flags('PRODUCT'), {}).map(f => f.properties.p)), [1650, 7]);
});

test('applyField100: AUTO100 → each value in % of the item\'s sum, not with AGGREGATE (flat 9013-9023)', () => {
  const fs_ = [feat({ a: 1, b: 3 }), feat({ a: 0, b: 0 })];
  const b = { value: 'a|b' };
  assert.deepEqual(plain(G.applyField100(fs_, b, flags('AUTO100'), {}).map(f => [f.properties.a, f.properties.b])), [[25, 75], [0, 0]]);
  assert.equal(G.applyField100(fs_, b, flags('AUTO100', 'AGGREGATE'), {}), fs_, 'AGGREGATE: unchanged (flat: __fAuto100 excludes it)');
});

test('applyField100 + field100Binding: DIFFERENCE over several fields → next minus each, last dropped (flat 9096-9112)', () => {
  const fs_ = [feat({ d1: 10, d2: 15, d3: 12 }), feat({ d1: 0, d2: 4, d3: 4 })];
  const b = { value: 'd1|d2|d3' };
  const out = G.applyField100(fs_, b, flags('DIFFERENCE'), {});
  assert.deepEqual(plain(out.map(f => [f.properties.d1, f.properties.d2])), [[5, -3], [4, 0]]);
  assert.equal(out[0].properties.d3, 12, 'the dropped field keeps its original value');
  const rel = G.applyField100(fs_, b, flags('DIFFERENCE', 'RELATIVE'), {});
  assert.deepEqual(plain(rel.map(f => [f.properties.d1, f.properties.d2])), [[50, -20], [100, 0]], 'RELATIVE: % of the earlier value; from 0 → 100');
  assert.equal(G.field100Binding(b, flags('DIFFERENCE')).value, 'd1|d2');
  assert.equal(G.field100Binding({ value: 'a', field100: 'b' }, flags('DIFFERENCE')).value, 'a', 'one field: unchanged');
  assert.equal(G.field100Binding(b, flags()), b);
});

test('normalizeTheme routes value100 / field100 to binding.field100', () => {
  const spec = G.normalizeTheme({ layer: 'x', binding: { value: 'a', value100: 'T', position: 'geometry' }, style: { type: 'CHOROPLETH' } });
  assert.equal(spec.binding.field100, 'T');
});

// ---- negative values and signs (flat: NEGATIVEISVALUE is the default; SIGN)
test('valueRadius: a negative value is sized by its absolute value, as flat (maptheme.js 20720)', () => {
  const style = { normalsizevalue: 100 }, opts = { objectscaling: 'fixed' };
  assert.equal(G.valueRadius(-50, 10, style, opts, flags(), 100), G.valueRadius(50, 10, style, opts, flags(), 100));
  assert.ok(G.valueRadius(-50, 10, style, opts, flags(), 100) > G.valueRadius(0, 10, style, opts, flags(), 100));
});

test('formatBubbleValue: DIFFERENCE / RELATIVE / SIGN put "+" before positive and "+/-" before zero values', () => {
  const st = { valuedecimals: 0 };
  assert.equal(G.formatBubbleValue(12, st, flags('SIGN')), '+12');
  assert.equal(G.formatBubbleValue(0, st, flags('DIFFERENCE')), '+/-0');
  assert.equal(G.formatBubbleValue(-7, st, flags('RELATIVE')), '-7');
  assert.equal(G.formatBubbleValue(12, st, flags()), '12', 'no sign without the flags');
  assert.equal(G.formatBubbleValue(12, { valuedecimals: 0, units: '%' }, flags('SIGN')), '+12%');
});
