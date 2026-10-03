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

test('glow gate: glowupper / glowlower (flat: the halo at scales <= glowupper and >= glowlower, both inclusive)', () => {
  const ml = flatZoom => G.flatToMapLibreZoom(flatZoom);
  // flat zoom 10 = 1:432 533, 12 = 1:108 133, 13 = 1:54 067
  assert.equal(G.glowHiddenByScale({}, ml(13)), false, 'no gate: always');
  assert.equal(G.glowHiddenByScale({ glowlower: '1:100000' }, ml(12)), false, '1:108 133 >= 1:100 000: glow');
  assert.equal(G.glowHiddenByScale({ glowlower: '1:100000' }, ml(13)), true, '1:54 067 < 1:100 000: no glow');
  assert.equal(G.glowHiddenByScale({ glowupper: '1:200000' }, ml(10)), true, '1:432 533 > 1:200 000: no glow');
  assert.equal(G.glowHiddenByScale({ glowupper: '1:200000' }, ml(12)), false);
});

test('CHART|LABEL routes to the symbol chart pipeline (flat: the BUBBLE/SQUARE/LABEL branch)', () => {
  assert.equal(G.isSymbolChart(flags('CHART', 'LABEL', 'VALUES', 'TEXTONLY')), true);
  assert.equal(G.isSymbolChart(flags('CHART', 'SYMBOL')), true);
  assert.equal(G.isSymbolChart(flags('CHART', 'USER')), true);
  assert.equal(G.isSymbolChart(flags('LABEL')), false, 'CHART is required');
  assert.equal(G.isSymbolChart(flags('CHART', 'PIE')), false);
});

test('chart position: align / offsetx / offsety, as measured on flat (the chart group moved by -ptNull)', () => {
  const off = (style, g) => plain(G.flatChartAlignOffset(style, g));
  // flat's bbox radii include the stroke
  const nearPair = (a, b, msg) => { near(a[0], b[0], msg + ' x', 0.15); near(a[1], b[1], msg + ' y', 0.15); };
  const u = 14.357; // flat's normalX(1) on screen at the test view (nDynamicObjectScale)
  // TEXTONLY label (concessioni_demaniali "2left"): +2r, flat's translate 54.23 units x 0.718
  nearPair(off({ align: '2left' }, { unit: u, half: 10, orig: 10 }), [20, 0], 'TEXTONLY 2left');
  // BUBBLE r = 119.04: ptNull.y left by the branch is r + 5 units
  const bub = r => ({ unit: u, half: r, orig: r + 5 * u });
  nearPair(off({ align: 'left' }, bub(119.04)), [190.72, 0], 'BUBBLE left (flat 190.72)');
  nearPair(off({ align: '2left' }, bub(119.04)), [309.76, 0], 'BUBBLE 2left (flat 309.76)');
  nearPair(off({ offsetx: 10 }, bub(119.04)), [-143.57, 0], 'BUBBLE offsetx 10 (flat -143.57)');
  nearPair(off({ offsety: 5 }, bub(119.04)), [0, 71.79], 'BUBBLE offsety 5 (flat 71.79)');
  nearPair(off({ align: '2left', offsetx: 10, offsety: 5 }, bub(119.04)), [309.76, 71.79], 'align overrides offsetx, keeps offsety');
  // SYMBOL: h is the normal radius (15 units), the offsets scale with r / chart size
  const sym = r => ({ unit: u, half: 15 * u, orig: r + 5 * u, symbolScale: r / (30 * u) });
  nearPair(off({ align: '2left' }, sym(118.4)), [405.55, 0], 'SYMBOL 2left (flat 405.55)');
  nearPair(off({ align: '23right' }, sym(119.04)), [-143.57, 0], 'SYMBOL 23right (flat -143.57)');
  nearPair(off({ offsetx: 10, offsety: 5 }, sym(119.04)), [-39.68, 19.84], 'SYMBOL offsets (flat -39.68, 19.84)');
  nearPair(off({ align: 'above' }, bub(10)), [0, -(10 + 5 * u)], 'above: moved up');
  assert.deepEqual(off({}, bub(10)), [0, 0]);
  assert.equal(G.flatChartBranch(flags('CHART', 'SYMBOL')), 'symbol');
  const bubbleFlags = flags('CHART', 'BUBBLE', 'SYMBOL'); Object.defineProperty(bubbleFlags, 'typeString', { value: 'CHART|BUBBLE' });
  assert.equal(G.flatChartBranch(bubbleFlags), 'bubble');
  assert.equal(G.flatChartBranch(flags('CHART', 'LABEL', 'TEXTONLY')), 'bubble');
});

test('flat chart colors: ColorScheme.getDerivateColor / ChartColors.textColor (colorscheme.js 46-116)', () => {
  assert.deepEqual(plain(G.flatDerivateRgb([200, 100, 50], 0.7)), [140, 70, 35]);
  assert.deepEqual(plain(G.flatDerivateRgb([10, 100, 200], 1.5)), [135, 150, 255], 'brighten: channels lifted to 90 first, capped at 255');
  assert.deepEqual(plain(G.flatDerivateRgb([255, 10, 10], 3)), [255, 243, 243], 'a channel >= 250: factor max(0.9 f, 1.1) = 2.7');
  assert.deepEqual(plain(G.flatChartTextRgb([221, 221, 221])), [132, 132, 132], 'light: x 0.6');
  assert.deepEqual(plain(G.flatChartTextRgb([30, 60, 90])), [255, 255, 255], 'dark: x 3');
});

test('chart value text: valuefield value, flat grouping, unit with its leading space', () => {
  const st = { valuefield: 'canone', units: '€', valuedecimals: '0' };
  // read off flat: "339 296 €", "352 €"
  assert.equal(G.flatValueText({ canone: '339296' }, null, 1, st, flags()), '339 296 €');
  assert.equal(G.flatValueText({ canone: '352.4' }, null, 1, st, flags()), '352 €');
  assert.equal(G.flatValueText({ canone: '0.42' }, null, 1, st, flags()), '0.4 €', 'valuedecimals 0 is flat\'s `||` default: 1 decimal below 1');
  assert.equal(G.flatValueText({ canone: 'n.d.' }, null, 1, st, flags()), 'n.d.', 'a non-number prints as is');
  assert.equal(G.flatValueText({}, null, 1234, { units: '.km' }, flags()), '1 234.km', 'a unit starting with "." gets no space');
  assert.equal(G.flatValueText({}, null, 5, { units: 'abcdef' }, flags()), '5', 'units over 5 characters are left out');
  assert.equal(G.flatValueText({}, 'Rimini', 5, { valuefield: '$title$' }, flags()), 'Rimini');
  assert.equal(G.flatValueText({}, null, 3, {}, flags('SIGN')), '+3');
  assert.equal(G.flatValueText(null, null, 0, { valuedecimals: 2 }, flags()), '0', 'flat prints 0 as is');
  assert.equal(G.flatValueText(null, null, 2021, {}, flags(), { noBreaks: true }), '2021', 'NOBREAKS (years)');
  assert.equal(G.flatValueText(null, null, 0.5, {}, flags(), { maxValue: 1 }), '0.5');
  assert.equal(G.flatValueText(null, null, 1, {}, flags(), { maxValue: 1 }), '1.0', 'max value <= 1: one decimal');
  assert.equal(G.flatNoBreaks(1990, 2023), true);
  assert.equal(G.flatNoBreaks(Infinity, -Infinity), false, 'no numeric values (a text value field): breaks');
});

test('CATEGORICAL bubble VALUES: the size value when size is bound to a field (flat)', () => {
  const binding = { value: 'type', size: 'canone' };
  const v = G.resolveAggregateValue(binding, flags('CHART', 'BUBBLE', 'CATEGORICAL'), { type: 'TURISTICO', canone: '40850' });
  assert.equal(v, 40850);
  assert.equal(G.flatValueText({ type: 'TURISTICO', canone: '40850' }, null, v, { units: '€' }, flags('CATEGORICAL')), '40 850 €');
});

test('CATEGORICAL VALUES with valuefield = the categorical field: the class name, also for an aggregated part', () => {
  const st = { valuefield: 'type', units: '€' }, binding = { value: 'type', size: 'canone' }, f = flags('CHART', 'BUBBLE', 'CATEGORICAL', 'AGGREGATE');
  const labels = ['TURISTICO RICREATIVO', 'VARIO'];
  assert.equal(G.flatValueText({ type: 'VARIO', canone: '120' }, null, 120, st, f), 'VARIO', 'a record prints its own valuefield value');
  const rec = G.categoryValueRecord(st, binding, f, labels, 1);
  assert.equal(G.flatValueText(rec, null, 4200, st, f), 'VARIO', 'an aggregated part prints its class name');
  assert.equal(G.categoryValueRecord({}, binding, f, labels, 1), null, 'no valuefield: the value');
  assert.equal(G.categoryValueRecord({ valuefield: 'canone' }, binding, f, labels, 1), null, 'another valuefield: not the class');
  assert.equal(G.flatValueText(null, null, 4200, {}, f), '4 200');
});

test('marked legend classes on a group (flat isolate): only the marked parts, own size, at the center', () => {
  const counts = [6, 3, 1];
  const full = G.computeBubblePackLayout(counts, 64);
  const iso = G.isolatedBubblePackLayout(counts, 64, new Set([1]));
  assert.deepEqual(plain(iso.present.map(p => p.i)), [1], 'the other categories are hidden');
  near(iso.radii[0], full.radii[1], 'the marked part keeps its size');
  near(iso.fitScale, full.fitScale, 'and the group scale');
  assert.deepEqual(plain(iso.offsets), [{ x: 0, y: 0 }], 'at the group center');
  const two = G.isolatedBubblePackLayout(counts, 64, new Set([2, 0]));
  assert.deepEqual(plain(two.present.map(p => p.i)), [0, 2], 'biggest first, the smaller on top');
  assert.equal(G.isolatedBubblePackLayout([6, 0, 1], 64, new Set([1])), null, 'no marked category in the group');
});

test('SEQUENCE|STAR layout, as measured on flat (PNRR regions, Lombardia, radius / object scale)', () => {
  // flat chart_reg: normalsizevalue 2e9, SIZEP2, max radius 15 units; parts in units of the object scale
  // M1..M6 from flat's radii / object scale (14.63, 29.01, 20.41, 26.06, 15.21, 17.27): v = 2e9 · (r / 15)²
  const counts = [14.63, 29.01, 20.41, 26.06, 15.21, 17.27].map(r => 2e9 * (r / 15) ** 2);
  const f = flags('CHART', 'SYMBOL', 'SEQUENCE', 'STAR', 'SORT', 'DOWN', 'SIZEP2', 'CATEGORICAL', 'AGGREGATE');
  const radiusOf = v => 15 * Math.sqrt(v / 2e9);
  const parts = G.sequenceLayout(counts, f, radiusOf, { maxRadius: 15 });
  assert.deepEqual(plain(parts.map(p => p.i)), [1, 3, 2, 5, 4, 0], 'SORT DOWN: biggest first, it is the center');
  assert.deepEqual([parts[0].x, parts[0].y], [0, 0]);
  near(parts[0].r, 29.01, 'center radius (flat 9.04 / 0.3116)', 0.05);
  // the next part touches the center at the half angle it spans: flat (15.1, 8.1) / 0.3116
  near(parts[1].x, 48.5, 'first satellite x', 0.3);
  near(parts[1].y, 26.0, 'first satellite y', 0.3);
  near(Math.hypot(parts[1].x, parts[1].y), parts[0].r + parts[1].r, 'tangent');
  const ex = G.sequenceLayout(counts, new Set([...f, 'EXPAND']), radiusOf, { maxRadius: 15 });
  near(Math.hypot(ex[1].x, ex[1].y), 1.5 * (ex[0].r + ex[1].r), 'EXPAND: 1.5 × the distance');
  const noStar = G.sequenceLayout([0, 2, 1], flags('SEQUENCE'), v => v, {});
  assert.deepEqual(plain(noStar), [{ i: 1, v: 2, r: 2, x: 0, y: 0 }, { i: 2, v: 1, r: 1, x: 0, y: 0 }], 'no layout flag: on the center, zero parts left out');
  const horz = G.sequenceLayout([1, 2], flags('SEQUENCE', 'HORZ'), v => v, {});
  assert.deepEqual(plain(horz.map(p => p.x)), [1, 4], 'HORZ: side by side');
});

test('SEQUENCE on a field aggregation: the categories of one field value form one chart', () => {
  // two categories of one comune, each at the (float) mean of its own records
  const feats = [
    { geometry: { type: 'Point', coordinates: [12.4963655, 41.9027835] }, properties: { cat: 0, value: 5, point_count: 2, aggKey: 'f:058091' } },
    { geometry: { type: 'Point', coordinates: [12.4963655000001, 41.9027834999999] }, properties: { cat: 2, value: 7, point_count: 3, aggKey: 'f:058091' } },
    { geometry: { type: 'Point', coordinates: [12.4963655000001, 41.9027834999999] }, properties: { cat: 1, value: 1, aggKey: 'f:058032' } },
  ];
  const groups = G.groupCoLocated(feats, 9, null, 3, flags('CHART', 'SYMBOL', 'SEQUENCE', 'CATEGORICAL', 'AGGREGATE'));
  assert.equal(groups.length, 2, 'merged by the field value, not by position');
  const roma = groups.find(g => g.properties.counts[0] === 5);
  assert.deepEqual(plain(roma.properties.counts), [5, 0, 7]);
  assert.deepEqual(plain(roma.properties.recordCounts), [2, 0, 3]);
});

test('CHOROPLETH|DOMINANT|CATEGORICAL|AGGREGATE: a polygon takes the class of its biggest category sum (flat)', () => {
  const binding = { value: 'missione', size: 'importo' };
  const f = flags('CHOROPLETH', 'DOMINANT', 'CATEGORICAL', 'AGGREGATE', 'SUM', 'DOPACITYMAX');
  assert.equal(G.isAggregatedCategoricalChoropleth({ flags: f, binding }), true);
  assert.equal(G.isAggregatedCategoricalChoropleth({ flags: f, binding: { value: 'a|b' } }), false, 'multi-field DOMINANT is the other mode');
  const idx = new Map([['M1', 0], ['M2', 1], ['M3', 2]]);
  const rows = [{ missione: 'M1', importo: '10' }, { missione: 'M2', importo: '7' }, { missione: 'M2', importo: '8' }, { missione: 'M9', importo: '99' }];
  const agg = G.aggregatedCategoricalClass(rows, binding, f, idx, 3);
  assert.deepEqual(plain(agg.parts), [10, 15, 0], 'sum of the size field per category, unknown values left out');
  assert.equal(agg.index, 1);
  assert.equal(G.aggregatedCategoricalClass([{ missione: 'M1', importo: '0' }], binding, f, idx, 3), null, 'no part above 0: no item');
  // flat: dopacityscale · (v / max)^(1/dopacitypow), at most 0.9
  near(G.dominantDopacityAlpha({ dopacityscale: 0.5, dopacitypow: 3 }, f, 1e6, 8e9), 0.5 * Math.cbrt(1e6 / 8e9), 'DOPACITYMAX');
  assert.equal(G.dominantDopacityAlpha({ dopacityscale: 2 }, f, 8e9, 8e9), 0.9, 'capped');
});

test('MULTIQUAD: items at one position fill quads, then rows of gridx upward (flat, PNRR "details")', () => {
  const at = (x, y) => ({ geometry: { type: 'Point', coordinates: [x, y] } });
  const items = Array.from({ length: 405 }, () => at(12.49, 41.9)).concat([at(9.19, 45.46)]);
  // flat: r = 17.17 px, steps 37.8 px = 2 · r · rangescale 1.1
  const { offset, index, extent } = G.multiQuadOffsets(items, 17.17, 1.1, 20);
  const step = 2 * 17.17 * 1.1;
  const cell = i => plain(offset.get(items[i]).map(v => Math.round(v / step)));
  assert.deepEqual([cell(0), cell(1), cell(2), cell(3)], [[0, 0], [0, -1], [1, -1], [1, 0]], 'measured on flat: (0,0) (0,-1) (1,-1) (1,0)');
  assert.deepEqual(cell(4), [0, -2], 'the next quad starts on top');
  assert.deepEqual(cell(400), [0, -20], 'from 20 x 20 on: rows of gridx upward');
  assert.deepEqual(cell(404), [4, -20]);
  assert.equal(index.get(items[405]), 0, 'another position starts again');
  near(offset.get(items[3])[0], 37.774, 'step = 2 r rangescale', 0.01);
  // the BOX encloses the whole grid of a position: 20 columns, 21 rows up
  assert.deepEqual(plain(extent.get(items[0]).map(v => Math.round(v / step))), [0, -20, 19, 0], 'grid extent at the first item');
  assert.deepEqual(plain(extent.get(items[405])), [0, 0, 0, 0], 'a single item: no extent');
  assert.equal(extent.get(items[1]), undefined, 'only the first item of a position carries it');
});

test('pixelOffsetLngLat: pixel offsets as lng/lat in Web Mercator (512 px world)', () => {
  near(G.pixelOffsetLngLat([0, 0], [256, 0], 0)[0], 180, 'half the world at zoom 0', 1e-9);
  near(G.pixelOffsetLngLat([12.49, 41.9], [0, 0], 14)[1], 41.9, 'no offset: same latitude', 1e-9);
  const up = G.pixelOffsetLngLat([12.49, 41.9], [0, -1000], 14), down = G.pixelOffsetLngLat([12.49, 41.9], [0, 1000], 14);
  assert.ok(up[1] > 41.9 && down[1] < 41.9, 'y down on screen is south');
  // 1000 px at zoom 14 ≈ 1000 · 360 / (512 · 2^14) · cos(lat) degrees of latitude
  near(up[1] - 41.9, 1000 * 360 / (512 * 2 ** 14) * Math.cos(41.9 * Math.PI / 180), 'mercator scale', 2e-4);
});

test('FIXSIZE: one radius for every symbol, the normal radius / normalsizevalue (flat)', () => {
  const f = flags('CHART', 'SYMBOL', 'FIXSIZE', 'CATEGORICAL');
  const st = { scale: 0.1, normalsizevalue: 1 }, opts = { objectscaling: 'fixed' };
  assert.equal(G.valueRadius(5, 10, st, opts, f, 1), G.valueRadius(5e6, 10, st, opts, f, 1), 'independent of the value');
  near(G.valueRadius(5e6, 10, st, opts, f, 1), 1.5, 'normal radius 15 · scale 0.1');
  const plot = flags('CHART', 'SYMBOL', 'PLOT', 'FIXSIZE', 'GRIDSIZE');
  assert.notEqual(G.valueRadius(5, 10, st, opts, plot, 1), G.valueRadius(5e6, 10, st, opts, plot, 1), 'PLOT/GRIDSIZE size their markers themselves');
});

test('polygon data is handed to deck.gl as the same object until its inputs change (pan speed)', () => {
  const rt = { features: [{ id: 1 }] };
  const fc = G.LayerRuntime.prototype._featureCollection;
  const a = fc.call(rt);
  assert.equal(fc.call(rt), a, 'same features: same FeatureCollection');
  rt.features = [{ id: 2 }];
  assert.notEqual(fc.call(rt), a, 'new features: new FeatureCollection');
  const cached = G.LayerRuntime.prototype._cachedPolygonData;
  let builds = 0;
  const build = () => ({ n: ++builds });
  const src = [];
  const d1 = cached.call(rt, '_slot', [src, 'style'], build);
  assert.equal(cached.call(rt, '_slot', [src, 'style'], build), d1, 'equal key: no rebuild');
  assert.notEqual(cached.call(rt, '_slot', [src, 'other'], build), d1, 'changed key entry: rebuilt');
  assert.notEqual(cached.call(rt, '_slot', [[], 'other'], build).n, 2, 'new source array: rebuilt');
  assert.equal(builds, 3);
});
