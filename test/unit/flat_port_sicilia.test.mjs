// Engine behaviors found porting ports/Sicilia/Sicilia_Rifiuti_OnePage from flat: a CHART type wins over a
// CHOROPLETH(E) flag, style.ranges class without the RANGES flag, style.aggregationfield groups records
// (aggregationupper / aggregationlower switch it off), PLOTVAR is drawn as PLOT, field100 applied to an
// aggregated item's sums, and a PLOT of several curves (style.gridx, STACKED) with its legend rows.
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
const { normalizeTheme, LayerRuntime, itemPlotGeometry, flatPieRecord, flatPartsAccumulate, flatPartsItemValues, flatValueRules, computeMultiFieldClasses } = G;
const plain = v => JSON.parse(JSON.stringify(v));
const flags = (...f) => new Set(f);
const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const typeOf = t => normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'v' }, style: { type: t } }).flags;

test('normalizeTheme: CHART wins over CHOROPLETH(E) (flat realize: chartMap before paintMap); PLOTVAR is a PLOT', () => {
  const f = typeOf('CHART|SYMBOL|SIZE|CHOROPLETHE|EQUIDISTANT');
  assert.equal(f.has('CHOROPLETH'), false, 'symbols, not a choropleth');
  assert.equal(f.has('CHART'), true);
  assert.equal(typeOf('CHART|SYMBOL|CHOROPLETH').has('CHOROPLETH'), false, 'the exact word too');
  assert.equal(typeOf('CHOROPLETHE|EQUIDISTANT').has('CHOROPLETH'), true, 'without CHART: a choropleth (substring)');
  assert.equal(typeOf('CHART|SYMBOL|SEQUENCE|PLOTVAR|GRIDSIZE').has('PLOT'), true, 'PLOTVAR: flat tests /PLOT/');
});

test('style.ranges: explicit breaks with or without RANGES (flat newTheme 1413), not with CATEGORICAL', () => {
  const r = [0, 5, 10, 100];
  assert.deepEqual(plain(G.explicitRangeBreaks({ ranges: r }, flags('CHART', 'SYMBOL', 'EQUIDISTANT'))), r);
  assert.deepEqual(plain(G.explicitRangeBreaks({ ranges: '0,5,10,100' }, flags('CHOROPLETH', 'RANGES'))), r);
  assert.equal(G.explicitRangeBreaks({ ranges: r }, flags('CHOROPLETH', 'CATEGORICAL')), null);
});

test('aggregationfield groups an AGGREGATE theme by the field; aggregationlower switches it off when zoomed in', () => {
  const recs = [['A', 10, 40], ['A', 11, 41], ['B', 14, 38]].map(([prov, lng, lat]) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { PROVINCIA: prov, a: 1, b: 2 } }));
  const mk = style => {
    const def = normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'a|b' },
      style: Object.assign({ type: 'CHART|PIE|AGGREGATE|SUM', colorscheme: ['#ff0000', '#0000ff'] }, style) });
    return new LayerRuntime(def, { type: 'FeatureCollection', features: recs }, {});
  };
  const rt = mk({ aggregationfield: 'PROVINCIA', aggregation: 'sum' });
  rt._ensureClusterIndices(6);
  assert.equal(rt._clusterField, 'PROVINCIA', 'style.aggregation "sum" is the mode, not the field');
  assert.equal(rt._clusterRadiusPx, null, 'no grid: the field groups');
  // 1:500 000 lower bound: at zoom 6 (≈ 1:9 M) still aggregated, at zoom 14 (≈ 1:36 000) not
  const gated = mk({ aggregationfield: 'PROVINCIA', aggregationlower: '1:500000' });
  gated._ensureClusterIndices(6);
  assert.equal(gated._clusterField, 'PROVINCIA');
  gated._ensureClusterIndices(14);
  assert.equal(gated._clusterField, null, 'below 1:500 000: each record its own item');
  // a matching aggregationscale bracket overrides the field
  const scaled = mk({ aggregationfield: 'PROVINCIA', aggregationscale: ['1:100', '40px'] });
  scaled._ensureClusterIndices(6);
  assert.equal(scaled._clusterField, null);
  assert.equal(scaled._clusterRadiusPx, 40);
});

test('field100 on an aggregated item: summed with the parts, applied to the sums (FRACTION, %), MEAN skipped', () => {
  const rules = flatValueRules('CHART|PLOT|AGGREGATE|FRACTION', 2);
  const o = { rules, fields: ['x', 'y'], fields100: ['pop'] };
  const recs = [{ x: '100', y: '50', pop: '10' }, { x: '300', y: '150', pop: '30' }].map(r => flatPieRecord(r, o));
  assert.deepEqual(plain(recs[0].parts100), [10, 10], 'one field100 for every part (the last repeated)');
  const fl = flags('CHART', 'PLOT', 'AGGREGATE', 'FRACTION');
  const item = recs.reduce((it, r) => flatPartsAccumulate(it, r, fl), null);
  assert.deepEqual(plain(item.parts100), [40, 40]);
  assert.deepEqual(plain(flatPartsItemValues(item, 'CHART|PLOT|AGGREGATE|FRACTION').parts), [10, 5], 'Σx / Σpop, not Σ(x / pop)');
  assert.deepEqual(plain(flatPartsItemValues(item, 'CHART|PLOT|AGGREGATE|FRACTION|MEAN').parts), [10, 5], 'no MEAN after field100');
  assert.deepEqual(plain(flatPartsItemValues(item, 'CHART|PLOT|AGGREGATE|FRACTION', { fractionScale: 1000 }).parts), [10000, 5000]);
  assert.deepEqual(plain(flatPartsItemValues(item, 'CHART|PIE|AGGREGATE').parts), [1000, 500], 'default: in % of the field100 sum');
  assert.deepEqual(plain(flatPartsItemValues(item, 'CHART|PIE|AGGREGATE', { field100Min: 50 }).parts), [0, 0], 'field100 under field100min: 0');
  // without field100 the parts are as before
  const plainItem = [{ x: '1', y: '2' }, { x: '3', y: '4' }].map(r => flatPieRecord(r, { rules, fields: ['x', 'y'] }))
    .reduce((it, r) => flatPartsAccumulate(it, r, fl), null);
  assert.equal(plainItem.parts100, undefined);
  assert.deepEqual(plain(flatPartsItemValues(plainItem, 'CHART|PLOT|AGGREGATE|MEAN').parts), [2, 3]);
});

test('gridx PLOT: value i on curve i % gx at x ⌊i / gx⌋, the y scale gx / span · rangescale (flat nScale)', () => {
  // 2 x positions × 3 curves, x-major: [c0, c1, c2] at x 0, then at x 1
  const v = [1, 2, 3, 4, 5, 6];
  const g = itemPlotGeometry(v, { min: 0, max: 10 }, { gridx: 3, linewidth: 3, symbols: 'none' }, flags('PLOT', 'LINES'), 1);
  assert.equal(g.curves.length, 3);
  assert.deepEqual(plain(g.curves.map(c => c.points.map(p => p.v))), [[1, 4], [2, 5], [3, 6]]);
  assert.deepEqual(plain(g.curves[0].points.map(p => p.x)), [0, 1]);
  const k = 3 / 10, h = 10 * k;
  near(g.curves[2].points[1].y, 6 * k + h / 20, 'y = (v − min) · k + h / 20');
  near(g.lineWidth, 3 / 30, 'linewidth / 30');
  assert.ok(g.bbox.x1 < 1.2 && g.bbox.x0 > -0.2, 'width: the x positions, not the 6 values');
  // one curve (no gridx) is unchanged
  assert.equal(itemPlotGeometry(v, { min: 0, max: 10 }, {}, flags('PLOT', 'LINES'), 1).curves, undefined);
});

test('gridx PLOT STACKED|AREA: each curve on the running sum, a band down to the curve below, 1-unit lines', () => {
  const v = [1, 2, 3, 4, 5, 6];
  const g = itemPlotGeometry(v, { min: 0, max: 20 }, { gridx: 3, linewidth: 3, symbols: 'none' }, flags('PLOT', 'LINES', 'AREA', 'STACKED'), 1);
  const k = 3 / 20, h = 20 * k, y = s => s * k + h / 20;
  near(g.curves[0].points[0].y, y(1), 'curve 0 at x 0: 1');
  near(g.curves[1].points[0].y, y(1 + 2), 'curve 1 on curve 0: 1 + 2');
  near(g.curves[2].points[1].y, y(4 + 5 + 6), 'curve 2 at x 1: 4 + 5 + 6');
  near(g.lineWidth, 1 / 30, 'STACKED lines: one raw unit');
  // the band of curve 1: its top (x 0, 1), then the top of curve 0 back (x 1, 0)
  const b = g.curves[1].band;
  assert.equal(b.length, 4);
  near(b[0][1], y(3), 'top at x 0'); near(b[1][1], y(9), 'top at x 1');
  near(b[2][1], y(4), 'curve 0 at x 1'); near(b[3][1], y(1), 'curve 0 at x 0');
  near(g.curves[0].band[3][1], y(0), 'the first curve stands on 0');
});

test('gridx PLOT with BOX + GRID: the coordinate grid sized by the x positions (not by every value)', () => {
  const v = new Array(50).fill(0).map((_, i) => i % 10 + 1);
  const g = itemPlotGeometry(v, { min: 0, max: 300 }, { gridx: 10 }, flags('PLOT', 'LINES'), 1,
    { axes: true, xaxis: ['2020', '2021', '2022', '2023', '2024'] });
  near(g.axes.right, 4, 'five x positions');
  near(g.axes.fs, 5 * 20 / 600, 'font: max(5, 3) × 20 raw');
  assert.equal(g.axes.xTicks.length, 5);
});

test('computeMultiFieldClasses: fewer labels than fields name the first rows, as many legend rows (flat legend.js 645)', () => {
  const fields = ['u20', 'v20', 'u21', 'v21'];
  const r = computeMultiFieldClasses({ value: fields.join('|') }, { label: ['Umido', 'Verde'], colorscheme: ['#ff0000', '#00ff00', '#ff0000', '#00ff00'] });
  assert.deepEqual(plain(r.categoryDisplayLabels), ['Umido', 'Verde', 'u21', 'v21']);
  assert.equal(r._legendRowCount, 2);
  const all = computeMultiFieldClasses({ value: 'a|b' }, { label: ['A', 'B'], colorscheme: ['#ff0000', '#00ff00'] });
  assert.equal(all._legendRowCount, null, 'a label per field: every field a row');
});

test('plotVarStats: per field the records\' mean (or MEDIAN of the items), the items\' population deviation of non-zero values', () => {
  const items = [[10, 0, 4], [20, 6, 4], [30, 6, 4]];
  const s = G.plotVarStats(items, [12, 3, 4], false);
  assert.deepEqual(plain(s.mean), [12, 3, 4], 'the records\' means as given (flat nSumA / nCount)');
  near(s.dev[0], Math.sqrt(200 / 3), 'population σ of 10, 20, 30');
  near(s.dev[1], 0, 'the 0 is left out: σ of 6, 6');
  const m = G.plotVarStats(items, null, true);
  assert.deepEqual(plain(m.mean), [30, 6, 4], 'MEDIAN: sorted non-zero values, the element at round(n / 2)');
  assert.deepEqual(plain(G.plotVarStats(items, null, false).mean), [20, 6, 4], 'no record means: the items\' mean');
});

test('PLOTVAR geometry: with LINES a σ band and the dotted means (flat 22946-22972); without LINES σ bars (23065-23113)', () => {
  const pv = { mean: [5, 6], dev: [1, 2] };
  const k = 1 / 10, h = 1, y = v => v * k + h / 20;
  const g = itemPlotGeometry([4, 8], { min: 0, max: 10 }, { linewidth: 3 }, flags('PLOT', 'LINES', 'PLOTVAR'), 1, { plotVar: pv });
  assert.equal(g.plotVar.lines, true);
  near(g.plotVar.bars[1].yMean, y(6), 'mean');
  near(g.plotVar.bars[1].yLo, y(4), 'mean − σ'); near(g.plotVar.bars[1].yHi, y(8), 'mean + σ');
  assert.deepEqual(plain(g.plotVar.band.map(p => p[0])), [0, 1, 1, 0], 'the band: mean + σ along, mean − σ back');
  near(g.plotVar.band[1][1], y(8), 'upper edge at x 1'); near(g.plotVar.band[3][1], y(4), 'lower edge at x 0');
  assert.deepEqual(plain(g.plotVar.dash), [10 / 600, 80 / 600], 'dashes 10, gaps 80 raw');
  near(g.plotVar.w2, 2 / 30, 'the mean line: 2 units');
  const b = itemPlotGeometry([4, 8], { min: 0, max: 10 }, {}, flags('PLOT', 'PLOTVAR'), 1, { plotVar: pv });
  assert.equal(b.plotVar.lines, false); assert.equal(b.plotVar.band, null);
  near(b.plotVar.tickDev, 80 / 600, 'without LINES: σ ticks ±80 raw');
  assert.ok(b.ink.x0 <= -80 / 600 + 1e-9, 'the ticks are inside the drawing');
  assert.equal(itemPlotGeometry([4, 8], { min: 0, max: 10 }, {}, flags('PLOT', 'LINES'), 1).plotVar, null, 'without stats: none');
});
