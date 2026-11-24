// CHART|PLOT|GRIDSIZE reads its cells from the shared parts processor
// (_prepareParts / _partsItems / _partsOf), like pie, bar and waffle: one
// record set -> items with parts, whatever the chart type. A cell's curve is
// its parts: one per value field (wide data) or per category (long data).
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
const { normalizeTheme, LayerRuntime } = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));
const pt = (props, x = 10, y = 45) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [x, y] } });
const WORLD = [-180, -90, 180, 90];
const runtime = (binding, style, features) => new LayerRuntime(normalizeTheme({ layer: 't', binding, style }), { type: 'FeatureCollection', features }, {});
const cells = rt => plain(rt._partsItems(4, WORLD).map(f => ({ n: f.properties.agg.n, parts: rt._partsOf(f.properties.agg).parts })));

test('grid plot: it is a parts theme (wide AGGREGATE, long CATEGORICAL), a plain GRIDSIZE PLOT is not aggregated', () => {
  const wide = runtime({ value: 'a|b|c' }, { type: 'CHART|SYMBOL|PLOT|LINES|AREA|MAX|AGGREGATE|RECT|GRIDSIZE', gridwidthpx: '100' }, []);
  assert.equal(wide._isGridPlot(), true);
  assert.equal(wide._hasAggregatedParts(), true);
  assert.deepEqual(plain(wide._partsFields), ['a', 'b', 'c']);
  const plot = runtime({ value: 'a|b' }, { type: 'CHART|SYMBOL|PLOT|LINES' }, []);
  assert.equal(plot._isGridPlot(), false, 'a per-item PLOT has no grid');
});

test('grid plot, wide data: a cell holds the MAX of its records per value field', () => {
  const rt = runtime({ value: 'y1|y2|y3' }, { type: 'CHART|SYMBOL|PLOT|LINES|AREA|MAX|AGGREGATE|RECT|GRIDSIZE', gridwidthpx: '100' },
    [pt({ y1: 1, y2: 5, y3: 2 }), pt({ y1: 4, y2: 2, y3: 2 }), pt({ y1: 0, y2: 1, y3: 9 })]);
  assert.deepEqual(cells(rt).map(c => c.parts), [[4, 5, 9]], 'one cell (MAX keeps no record count)');
});

test('grid plot, wide data: SUM adds, MEAN divides by the cell\'s records, records of other cells stay apart', () => {
  const feats = [pt({ y1: 1, y2: 5 }), pt({ y1: 3, y2: 1 }), pt({ y1: 7, y2: 7 }, 60, -30)];
  const sum = runtime({ value: 'y1|y2' }, { type: 'CHART|SYMBOL|PLOT|AGGREGATE|RECT|GRIDSIZE', gridwidthpx: '100' }, feats);
  assert.deepEqual(cells(sum).map(c => c.parts).sort(), [[4, 6], [7, 7]]);
  const mean = runtime({ value: 'y1|y2' }, { type: 'CHART|SYMBOL|PLOT|AGGREGATE|MEAN|RECT|GRIDSIZE', gridwidthpx: '100' }, feats);
  assert.deepEqual(cells(mean).map(c => c.parts).sort(), [[2, 3], [7, 7]]);
});

test('grid plot, long data: one part per category of style.values, summed per cell', () => {
  const rt = runtime({ value: 'year', size: 'n' }, { type: 'CHART|SYMBOL|PLOT|LINES|CATEGORICAL|AGGREGATE|RECT|SUM|GRIDSIZE', gridwidthpx: '100', values: ['2019', '2020', '2021'] },
    [pt({ year: '2019', n: 2 }), pt({ year: '2021', n: 1 }), pt({ year: '2019', n: 3 })]);
  assert.deepEqual(plain(rt.categoryLabels), ['2019', '2020', '2021']);
  assert.deepEqual(cells(rt), [{ n: 3, parts: [5, 0, 1] }]);
});

test('grid plot, long data: style.xaxis is the ordered category list when there is no style.values', () => {
  const rt = runtime({ value: 'year', size: 'n' }, { type: 'CHART|SYMBOL|PLOT|CATEGORICAL|AGGREGATE|RECT|GRIDSIZE', gridwidthpx: '100', xaxis: ['2020', '2019'] },
    [pt({ year: '2019', n: 2 }), pt({ year: '2020', n: 7 })]);
  assert.deepEqual(plain(rt.categoryLabels), ['2020', '2019']);
  assert.deepEqual(cells(rt), [{ n: 2, parts: [7, 2] }]);
});

test('grid plot: the grid width comes from the processor — gridwidth "150px" like gridwidthpx', () => {
  const rt = runtime({ value: 'y1|y2' }, { type: 'CHART|SYMBOL|PLOT|AGGREGATE|RECT|GRIDSIZE', gridwidth: '150px' }, [pt({ y1: 1, y2: 2 })]);
  rt._ensureClusterIndices(4);
  assert.equal(rt._clusterRadiusPx, 150);
  assert.equal(rt._clusterUsesFixedZoom, false);
});

// ---------------------------------------------------------------- flat's auto-fit of a PLOT into its cell
const { chartBoxLayout, gestureScaleProps, itemPlotGeometry } = win.__ixmapsGlInternals;
const near = (a, b, msg, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
// a GRIDSIZE PLOT theme's size rule (_plotSizing) on a cell of `cell` px — the only thing GRIDSIZE changes
const gridPlot = (cell, scale) => {
  const rt = new LayerRuntime(normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'k' },
    style: { type: 'CHART|SYMBOL|PLOT|LINES|GRIDSIZE|CATEGORICAL|AGGREGATE', values: ['a', 'b'], scale } }), { type: 'FeatureCollection', features: [] }, {});
  rt._clusterRadiusPx = cell; rt._clusterUsesFixedZoom = false;
  return rt;
};
const curveSpan = (cell, scale, n) => { const { step } = gridPlot(cell, scale)._plotSizing(10, n); return n > 1 ? (n - 1) * step : step; };

test('plot fit: the curve spans (n-1)/n of cell x scale, as flat measured', () => {
  near(curveSpan(150, 0.85, 48), 124.8, 'EU temperatures: 48 values, 127.5 px cell (flat 125 px)');
  near(curveSpan(100, 1, 3), 66.7, 'plot_curves: 3 values, 100 px cell (flat 67 px)');
  near(curveSpan(100, 1, 2), 50, 'two values: half the cell');
  near(curveSpan(100, 1, 1), 66.7, 'one value falls back to 2/3');
  const { off } = gridPlot(100, 1)._plotSizing(10, 3);
  assert.deepEqual(plain(off), [-50, 50], 'the chart moves by half the cell left and down (flat 18564): it fills its cell');
});

test('plot stroke: linewidth / 30 of one X step, so more values mean a thinner line', () => {
  // the geometry's line width (chart units of one step) × the size rule's px per step
  const screenPx = (lw, n, cell, scale) => itemPlotGeometry([1, 2], { min: 0, max: 2 }, { linewidth: lw }, new Set(['PLOT', 'LINES']), 2).lineWidth
    * gridPlot(cell, scale)._plotSizing(10, n).step;
  near(screenPx(1.5, 3, 100, 1), 1.67, 'plot_curves: linewidth 1.5, 3 values (flat 1.67 px)', 0.1);
  near(screenPx(20, 48, 150, 0.85), 1.77, 'EU temperatures: linewidth 20, 48 values (flat 1.77 px)', 0.1);
});

// ---------------------------------------------------------------- flat's colour by value (style.ranges)
test('plot colour by value: ranges give one class per interval, a break belongs to the class below, the colours are the scheme sweep', () => {
  const scheme = ['10', '#04A3F4', '#FF8506', '3colors', '#C4C4B0'];
  const rt = runtime({ value: 'a|b' }, { type: 'CHART|SYMBOL|PLOT|LINES|AREA|AGGREGATE|RECT|GRIDSIZE', colorscheme: scheme,
    ranges: ['-5', '-4', '-3', '-2', '-1', '0', '1', '2', '3', '4', '5'] }, []);
  const c = rt._plotValueClasses();
  assert.equal(c.colors.length, 10);
  assert.deepEqual(plain(c.colors[4]), [174, 192, 183], 'flat: -1..0');
  assert.deepEqual(plain(c.colors[5]), [217, 199, 168], 'flat: 0..1');
  assert.deepEqual(plain(c.colors[9]), [255, 133, 6]);
  assert.equal(c.classOf(-0.73), 4);
  assert.equal(c.classOf(0.5), 5);
  assert.equal(c.classOf(1), 5, 'a break value belongs to the class below');
  assert.equal(c.classOf(1.2), 6);
  assert.equal(c.classOf(-9), 0);
  assert.equal(c.classOf(9), 9);
});

test('plot colour by value: no ranges, or a single interval, keeps one colour', () => {
  assert.equal(runtime({ value: 'a|b' }, { type: 'CHART|SYMBOL|PLOT|GRIDSIZE' }, [])._plotValueClasses(), null);
  assert.equal(runtime({ value: 'a|b' }, { type: 'CHART|SYMBOL|PLOT|GRIDSIZE', ranges: [0, 5] }, [])._plotValueClasses(), null);
  const str = runtime({ value: 'a|b' }, { type: 'CHART|SYMBOL|PLOT|GRIDSIZE', ranges: '0|5|10', colorscheme: ['#00f', '#f00'] }, []);
  assert.equal(str._plotValueClasses().colors.length, 2, 'a "|" string works too');
});

// ---------------------------------------------------------------- flat's y axis (GRID)
const { plotYAxis } = win.__ixmapsGlInternals;
const axis = (a, b) => { const r = plotYAxis(a, b); return r && plain({ step: r.step, min: r.min, max: r.max, labels: r.ticks.map(t => t.label) }); };

test('plot y axis: flat rounds the step and the range (EU temperatures -2..4 -> lines at -2, 0, 2, 4)', () => {
  assert.deepEqual(axis(-2, 4), { step: 2, min: -2, max: 4, labels: ['-2.00', '0', '2.00', '4.00'] });
});

test('plot y axis: whole-number labels above a rounded max of 5, tenths for a 0..1 range', () => {
  assert.deepEqual(axis(0, 10), { step: 2, min: 0, max: 10, labels: ['0', '2', '4', '6', '8', '10'] });
  assert.deepEqual(axis(0, 1).labels, ['0', '0.20', '0.40', '0.60', '0.80', '1.00']);
});

test('plot y axis: an empty or invalid range has no axis', () => {
  assert.equal(plotYAxis(3, 3), null);
  assert.equal(plotYAxis(5, 1), null);
  assert.equal(plotYAxis(NaN, 1), null);
});

// ---------------------------------------------------------------- flat's AREA baseline: the value-0 level
test('plot area baseline: the value-0 level, as flat — a range from 0 closes at the bottom, a negative minimum lifts it', () => {
  const g = (vals, min, max) => itemPlotGeometry(vals, { min, max }, {}, new Set(['PLOT', 'AREA', 'ZEROISVALUE']), 1);
  const from0 = g([0, 10], 0, 10);
  near(from0.baseY, from0.points[0].y, 'range from 0: the bottom level of the curve', 1e-9);
  const eu = g([-2, 4], -2, 4);
  near((eu.baseY - eu.points[0].y) / (eu.points[1].y - eu.points[0].y), 1 / 3, 'EU -2..4: zero a third up the range', 1e-9);
  const pos = g([3, 5], 3, 5);
  assert.ok(pos.baseY < pos.points[0].y, 'all-positive range above zero: the area reaches below the curve, as flat');
});

// ---------------------------------------------------------------- flat's chart position (align / offsetx / offsety)
const { flatChartAlignOffset } = win.__ixmapsGlInternals;
const off = (style, g) => plain(flatChartAlignOffset(style, g));

test('chart position, PLOT: offsetx / offsety in flat units, no symbol scale — the chart moves by -ptNull', () => {
  // EU temperatures: offsetx -20, 1 unit = 0.0886 px -> +1.77 px right; offsety is up-positive, so +10 moves down
  const o = off({ offsetx: -20 }, { kind: 'plot', unit: 0.0886, symbolScale: 3, width: 100 });
  near(o[0], 1.772, 'offsetx -20', 1e-9);
  assert.equal(o[1], 0);
  assert.deepEqual(off({ offsety: 10 }, { kind: 'plot', unit: 2, width: 100 }), [0, 20]);
});

test('chart position, PLOT align: the width keywords overwrite the offset, the vertical ones do nothing', () => {
  const g = { kind: 'plot', unit: 1, width: 100, half: 15 };
  assert.deepEqual(off({ align: 'center', offsetx: 7 }, g), [-50, 50], 'center: half the width left, half down');
  assert.deepEqual(off({ align: 'center top' }, g), [-50, 0]);
  assert.deepEqual(off({ align: 'right' }, g), [-100, 0]);
  assert.deepEqual(off({ align: '23right' }, g), [-66, 0]);
  assert.deepEqual(off({ align: '10%left' }, g), [-10, 0]);
  assert.deepEqual(off({ align: 'above', offsety: 5 }, g), [0, 5], 'above is not a PLOT keyword');
});

test('chart position, non-PLOT: the symbol scale applies, and a gridx layout takes only center / right / 23right', () => {
  assert.deepEqual(off({ offsetx: 4 }, { unit: 2, symbolScale: 3, half: 10 }), [-24, 0]);
  const g = { unit: 1, half: 10, gridx: 2, width: 60 };
  assert.deepEqual(off({ align: 'center' }, g), [-30, 0]);
  assert.deepEqual(off({ align: 'right' }, g), [-60, 0]);
  assert.deepEqual(off({ align: 'top' }, g), [0, 0], 'top is not a gridx keyword');
});

// ---------------------------------------------------------------- the box margin of a grid PLOT
test('plot box margin: boxmargin x flat\'s unit (one X step / 30), not iconSize / 30', () => {
  // EU temperatures: 48 values, icon 141.87 px, boxmargin 50 -> flat's margin is 8.86 px a side
  const iconSize = 141.87, step = iconSize * 0.88 / 47, u = step / 30;
  const L = chartBoxLayout([-iconSize / 2, -iconSize / 2, iconSize / 2, iconSize / 2], { unit: u, margin: 50 });
  near(L.margin, 8.86, 'margin', 0.05);
  near(L.rect[2] - L.rect[0], iconSize + 2 * 8.86, 'box width');
});

test('chartBoxLayout square (flat 18912): GRIDSIZE/AUTOSIZE boxes are squared upward only when wider than tall', () => {
  // EU temperatures: content 139.8 x 110 px, margin 8.86 -> a 157.5 square, bottom unchanged
  const wide = chartBoxLayout([0, 0, 139.8, 110], { unit: 0.0886, margin: 50, square: true });
  near(wide.rect[2] - wide.rect[0], 157.5, 'width', 0.1);
  near(wide.rect[3] - wide.rect[1], 157.5, 'height = width', 0.1);
  near(wide.rect[3], 110 + 8.86, 'bottom stays', 0.05);
  // taller than wide (a larger rangescale): natural box, no squaring
  const tall = chartBoxLayout([0, 0, 100, 140], { unit: 0.0886, margin: 50, square: true });
  near(tall.rect[3] - tall.rect[1], 140 + 2 * 8.86, 'natural height', 0.05);
  // without the option (no GRIDSIZE/AUTOSIZE) a wide content stays wide
  const plain = chartBoxLayout([0, 0, 139.8, 110], { unit: 0.0886, margin: 50 });
  near(plain.rect[3] - plain.rect[1], 110 + 2 * 8.86, 'plain height', 0.05);
});

test('gesture scale: sizes and px offsets grow by f = 2^(live zoom - build zoom), the rest is untouched', () => {
  const f = 2;
  const constant = gestureScaleProps({ getPixelOffset: [3, -4] }, f);
  assert.deepEqual(plain(constant.getPixelOffset), [6, -8]);
  assert.equal(constant.sizeScale, 2);
  // an accessor stays an accessor, scaled, and re-evaluates through its updateTrigger
  const acc = gestureScaleProps({ sizeScale: 1.5, updateTriggers: { getSize: [1] }, getPixelOffset: d => [d.x, d.y] }, f);
  assert.equal(acc.sizeScale, 3);
  assert.deepEqual(plain(acc.getPixelOffset({ x: 1, y: 2 })), [2, 4]);
  assert.deepEqual(plain(acc.updateTriggers), { getSize: [1], getPixelOffset: [2] });
  // no offsets: only the size scale
  assert.deepEqual(Object.keys(gestureScaleProps({}, 0.5)), ['sizeScale']);
});
