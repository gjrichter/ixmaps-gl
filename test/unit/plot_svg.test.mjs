// SVG PLOT charts: the PLOT icon drawings recorded as SVG (SvgContext2D) for the chart pane, used while at
// most SVG_PLOT_MAX_CHARTS charts are in view (svgPlotFits); more fall back to the deck.gl icons.
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
const { SvgContext2D, normalizeTheme, LayerRuntime } = G;
const plain = v => JSON.parse(JSON.stringify(v));
const pt = (x, y) => ({ geometry: { type: 'Point', coordinates: [x, y] } });

test('SvgContext2D: paths, a full circle, fill and stroke as SVG', () => {
  const c = new SvgContext2D();
  c.strokeStyle = 'rgb(1,2,3)'; c.lineWidth = 2; c.lineJoin = 'round'; c.setLineDash([4, 2]);
  c.beginPath(); c.moveTo(0, 10); c.lineTo(5, 0); c.bezierCurveTo(6, 0, 7, 1, 8, 2); c.stroke();
  c.fillStyle = 'rgba(10,20,30,0.5)';
  c.beginPath(); c.arc(5, 5, 2, 0, 2 * Math.PI); c.fill();
  const m = c.markup(20, 10);
  assert.match(m, /<path d="M0 10L5 0C6 0 7 1 8 2" fill="none" stroke="rgb\(1,2,3\)" stroke-width="2" stroke-linecap="butt" stroke-linejoin="round" stroke-dasharray="4 2"\/>/);
  assert.match(m, /<path d="M7 5A2 2 0 1 0 3 5A2 2 0 1 0 7 5Z" fill="rgba\(10,20,30,0.5\)"\/>/, 'a full circle: two half arcs');
  assert.match(m, /^<g><svg x="0" y="0" width="20" height="10" overflow="hidden">/, 'clipped to the canvas it stands for');
});

test('SvgContext2D: scale, save/restore, text, rects and gradients', () => {
  const c = new SvgContext2D();
  c.scale(2, 2);
  c.save(); c.setLineDash([1, 1]); c.restore();
  c.font = '8px arial'; c.textAlign = 'right'; c.fillStyle = '#888';
  c.fillText('a<b', 10, 4);
  c.fillRect(0, 0, 3, 3);
  const g = c.createLinearGradient(0, 0, 0, 10);
  g.addColorStop(0, 'rgba(1,1,1,1)'); g.addColorStop(1, 'rgba(1,1,1,0.1)');
  c.fillStyle = g; c.beginPath(); c.rect(0, 0, 1, 1); c.fill();
  c.strokeStyle = 'red'; c.beginPath(); c.moveTo(0, 0); c.lineTo(1, 1); c.stroke();
  const m = c.markup(10, 10);
  assert.match(m, /<text x="20" y="8" font-size="16" font-family="arial" text-anchor="end" fill="#888">a&lt;b<\/text>/, 'scaled, escaped, right-aligned');
  assert.match(m, /<rect x="0" y="0" width="6" height="6" fill="#888"\/>/);
  assert.match(m, /<linearGradient id="(ixpg\w+)" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="20"><stop offset="0" stop-color="rgba\(1,1,1,1\)"\/><stop offset="1" stop-color="rgba\(1,1,1,0.1\)"\/><\/linearGradient>/);
  const id = /linearGradient id="(\w+)"/.exec(m)[1];
  assert.ok(m.includes(`fill="url(#${id})"`), 'the gradient fills by reference');
  assert.ok(!m.includes('stroke-dasharray'), 'restore() dropped the dash');
  assert.match(m, /width="20" height="20"/, 'the clip follows the scale');
});

test('svgPlotFits: at most SVG_PLOT_MAX_CHARTS charts in the view', () => {
  const max = G.SVG_PLOT_MAX_CHARTS;
  assert.equal(max, 2000);
  const inside = Array.from({ length: max }, () => pt(1, 1));
  const bbox = [0, 0, 2, 2];
  assert.equal(G.svgPlotFits(inside, bbox), true, '2000 in view: SVG');
  assert.equal(G.svgPlotFits(inside.concat([pt(1, 1)]), bbox), false, '2001 in view: icons');
  assert.equal(G.svgPlotFits(inside.concat(Array.from({ length: 500 }, () => pt(50, 50))), bbox), true, 'charts outside the view do not count');
  assert.equal(G.svgPlotFits(inside.concat([pt(1, 1)]), null), false, 'no view: all count');
});

test('PLOT as SVG: the chart drawing, anchored at the item, in SVG_PLOT_UNIT per chart unit', () => {
  const def = normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'a|b|c' },
    style: { type: 'CHART|SYMBOL|PLOT|LINES|AREA|LASTPOP', linewidth: 6, symbols: 'none', fillopacity: '0.2', colorscheme: ['#0a141e'] } });
  const rt = new LayerRuntime(def, { type: 'FeatureCollection', features: [] }, {});
  const U = G.SVG_PLOT_UNIT;
  const look = rt._plotLook(['x', 'y', 'z']);
  const chart = rt._buildPlotChart([1, 2, 1.5], { min: 0, max: 2 }, 2, look, U, 'sig');
  const g = G.itemPlotGeometry([1, 2, 1.5], { min: 0, max: 2 }, rt.style, rt.flags, 2, look);
  assert.ok(Math.abs(chart.ox - (0 - g.ink.x0) * U) < 1e-9 && Math.abs(chart.oy - g.ink.y1 * U) < 1e-9, 'the origin is the item position');
  assert.match(chart.markup, /fill="rgba\(10,20,30,0.2\)"/, 'AREA in fillopacity');
  assert.match(chart.markup, new RegExp(`stroke="rgb\\(10,20,30\\)" stroke-width="${+(6 / 30 * U).toFixed(2)}"`), 'LINES: linewidth / 30 of a step, no raster calibration');
  assert.match(chart.markup, /<path d="M[^"]*A[^"]*Z" fill="rgb\(10,20,30\)"\/>/, 'LASTPOP: a filled circle');
  // cached by its style: the same drawing again is the same object, another style another one
  assert.equal(rt._buildPlotChart([1, 2, 1.5], { min: 0, max: 2 }, 2, look, U, 'sig'), chart);
  assert.notEqual(rt._buildPlotChart([1, 2, 1.5], { min: 0, max: 2 }, 2, look, U, 'other'), chart);
});

test('PLOT is one chart type: with GRIDSIZE the same values draw the same chart (only the size rule differs)', () => {
  const mk = type => new LayerRuntime(normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'a|b|c' },
    style: { type, linewidth: 3, colorscheme: ['#336699'], ranges: [0, 1.5, 4], fillopacity: '0.3' } }), { type: 'FeatureCollection', features: [] }, {});
  const item = mk('CHART|SYMBOL|PLOT|LINES|AREA|FADE|BOX|GRID'), grid = mk('CHART|SYMBOL|PLOT|LINES|AREA|FADE|BOX|GRID|GRIDSIZE|AGGREGATE');
  const draw = rt => rt._buildPlotChart([1, 3, 2], { min: 0, max: 3 }, 3, rt._plotLook(['a', 'b', 'c']), G.SVG_PLOT_UNIT, 'sig').markup;
  assert.equal(draw(grid), draw(item), 'geometry, axes, FADE and colour by value: identical');
  assert.match(draw(item), /<text [^>]*text-anchor="end"[^>]*>0<\/text>/, 'per item too: flat\'s coordinate grid with BOX + GRID');
  assert.match(draw(item), /stroke="rgb\(/, 'colour by value per segment');
  const sItem = item._plotSizing(10, 3), sGrid = Object.assign(grid, { _clusterRadiusPx: 90, _clusterUsesFixedZoom: false })._plotSizing(10, 3);
  assert.deepEqual(plain(sItem.off), [0, 0], 'per item: anchored at the item');
  assert.deepEqual(plain(sGrid.off), [-45, 45], 'GRIDSIZE: fills its cell');
  assert.ok(Math.abs(sGrid.step - 30) < 1e-9, 'GRIDSIZE: 3 steps in the 90 px cell');
});

test('BOX of SVG charts: an SVG rect with its title, under the chart, not pickable', () => {
  const def = normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'a|b' },
    style: { type: 'CHART|SYMBOL|PLOT|LINES|BOX|TITLE', boxcolor: '#ffffff', boxopacity: '0.5', bordercolor: '#123456', borderstyle: 'solid', borderradius: 1, textcolor: '#333333' } });
  const rt = new LayerRuntime(def, { type: 'FeatureCollection', features: [] }, {});
  const d = { geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} };
  const rows = [{ d, rect: [-10, -20, 30, 5], w: 30, title: { x: -10, baseline: -12, f: 6, anchor: 'start', lines: ['Alpha', 'B<c'] } }];
  const box = rt._svgBoxCharts(rows, 2, () => [3, 4]).get(d);
  assert.equal(box.pick, false, 'the box answers no hover (as the icon box)');
  assert.deepEqual(box.off, [3, 4]);
  assert.equal(box.s, 1, 'drawn in px');
  assert.match(box.chart.markup, /<rect x="-10" y="-20" width="40" height="25" rx="1" fill="#ffffff" fill-opacity="0.5" stroke="#123456" stroke-opacity="1" stroke-width="0.2"\/>/,
    'rect, corner borderradius × min(unit, w / 30), stroke borderwidth × 0.2 × w / 30, solid border opaque');
  assert.match(box.chart.markup, /<text x="-10" y="-12" font-family="arial" font-size="6" text-anchor="start" fill="rgb\(51,51,51\)"[^>]*><tspan x="-10">Alpha<\/tspan><tspan x="-10" dy="6">B&lt;c<\/tspan><\/text>/,
    'the title, one tspan per line, escaped');
  assert.ok(box.chart.markup.indexOf('<rect') < box.chart.markup.indexOf('<text'), 'title over its box');
  assert.equal(rt._svgBoxCharts(null, 2, () => [0, 0]).size, 0, 'no box rows: no boxes');
});

test('tooltip curve: svgPlotTipMarkup enlarges the drawing to 240 px, lines as on the map (1.2 … 3 px)', () => {
  const chart = { markup: '<g><svg><path d="M0 0L10 5" stroke="red" stroke-width="2"/><path d="M0 0" stroke-width="0.01"/></svg></g>', ext: [0, 0, 100, 50] };
  const m = G.svgPlotTipMarkup(chart, 0.5);
  assert.match(m, /^<svg class="ix-tip-chart" width="240" height="\d+" viewBox="-4 -4 108 58"/, '4 % margin around the extent');
  const k = 240 / 108;
  const widths = [...m.matchAll(/stroke-width="([\d.]+)"/g)].map(x => +x[1] * k);
  assert.ok(Math.abs(widths[0] - 1.2) < 0.01, `2 units × 0.5 px = 1 px on the map → at least 1.2 px: ${widths[0]}`);
  assert.ok(Math.abs(widths[1] - 1.2) < 0.01, 'a hairline too');
  assert.ok(Math.abs(+(/height="(\d+)"/.exec(m)[1]) - Math.round(58 * k)) <= 1, 'height in proportion');
  const wide = G.svgPlotTipMarkup({ markup: '<path stroke-width="10"/>', ext: [0, 0, 100, 50] }, 1);
  assert.ok(Math.abs(+/stroke-width="([\d.]+)"/.exec(wide)[1] * k - 3) < 0.01, 'never more than 3 px');
});

test('tooltip curve: a PLOT item\'s {{theme.item.chart}} is its chart with flat\'s coordinate grid, over the values table', () => {
  const def = normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'a|b|c' },
    style: { type: 'CHART|SYMBOL|PLOT|LINES|AREA', linewidth: 6, colorscheme: ['#336699'] } });
  const rt = new LayerRuntime(def, { type: 'FeatureCollection', features: [] }, {});
  assert.equal(rt._plotTipChartHtml([1, 2, 3]), '', 'before the first drawing: no curve');
  rt._plotTip = { rangeFor: () => ({ min: 0, max: 3 }), sizeMax: 3, labels: ['2019', '2020', '2021'] };
  const html = rt._renderItemChartHtml({ values: [1, 2, 3], raw: {} });
  assert.match(html, /^<svg class="ix-tip-chart" width="240"/, 'the curve first');
  assert.match(html, /stroke="rgb\(51,102,153\)"/);
  assert.match(html, /<text [^>]*>2020<\/text>/, 'the x labels, though the theme has no GRID');
  assert.match(html, /<text [^>]*text-anchor="end"[^>]*>3.00<\/text>/, 'the y labels (flat: two decimals up to a range of 5)');
  assert.ok(html.indexOf('</svg>') < html.lastIndexOf('<'), 'then the values table');
  assert.equal(rt._plotTipChartHtml([NaN, null]), '', 'nothing to draw: no curve');
});

test('SVG gradient ids follow the chart, not the drawing order (stable snapshots)', () => {
  const mk = () => {
    const def = normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'a|b|c' },
      style: { type: 'CHART|SYMBOL|PLOT|LINES|AREA|FADE', colorscheme: ['#336699'] } });
    return new LayerRuntime(def, { type: 'FeatureCollection', features: [] }, {});
  };
  const a = mk(), b = mk();
  const draw = (rt, v) => rt._buildPlotChart(v, { min: 0, max: 3 }, 3, rt._plotLook(['a', 'b', 'c']), G.SVG_PLOT_UNIT, 's');
  draw(b, [3, 1, 2]);   // another chart first
  const ma = draw(a, [1, 2, 3]).markup;
  const mb = draw(b, [1, 2, 3]).markup;
  assert.match(ma, /linearGradient id="g\w+"/, 'FADE gradients');
  assert.equal(ma, mb, 'the same chart, the same markup');
});

test('tooltip curve: the item\'s own range, as tall as wide, a 2 px line, AREA down to the axis only', () => {
  const def = normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'a|b|c' },
    style: { type: 'CHART|SYMBOL|PLOT|LINES|AREA|LASTPOP', linewidth: 45, rangescale: 5, colorscheme: ['#336699'] } });
  const rt = new LayerRuntime(def, { type: 'FeatureCollection', features: [] }, {});
  rt._plotTip = { rangeFor: () => ({ min: -100, max: 100 }), sizeMax: 600, labels: ['a', 'b', 'c'] };
  const html = rt._plotTipChartHtml([342, 591, 584]);
  const labels = [...html.matchAll(/text-anchor="end"[^>]*>([^<]+)</g)].map(m => +m[1]);
  assert.ok(Math.min(...labels) >= 300 && Math.max(...labels) <= 600, `own range, not the shared −100 … 100: ${labels}`);
  const [, , vw, vh] = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(html).slice(1).map(Number);
  assert.ok(vh / vw < 1.4, `about as tall as wide, rangescale left out: ${vw} × ${vh}`);
  const w = +/stroke="rgb\(51,102,153\)" stroke-width="([\d.]+)"/.exec(html)[1] * 240 / vw;
  assert.ok(w > 1.5 && w < 2.5, `a ~2 px line, not the map's linewidth 45: ${w}`);
  const area = /<path d="M([\d.]+) ([\d.]+)L[^"]*Z" fill="rgba\(51,102,153/.exec(html);
  assert.ok(area && +area[2] < vh + 1, 'the area stops at the axis, not at the far value-0 level');
});

const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
test('chartDepthScaler: the SVG chart pane shrinks charts with depth as deck.gl billboards (center / item ground span per px)', () => {
  // a mock tilted camera: one screen px spans (1 + y / 400) × 1e-3 degrees of longitude on row y (Mercator x
  // is proportional to longitude) — farther rows (smaller y) span less, here the row at y 400 is the center
  const map = (pitch, globe) => ({
    getPitch: () => pitch,
    getProjection: () => ({ type: globe ? 'globe' : 'mercator' }),
    getCenter: () => ({ lng: 0, lat: 0 }),
    project: () => ({ x: 500, y: 400 }),
    unproject: ([x, y]) => ({ lng: x * (1 + y / 400) * 1e-3, lat: 0 })
  });
  assert.equal(G.chartDepthScaler(map(0)), null, 'no tilt: no depth scale');
  const k = G.chartDepthScaler(map(60));
  near(k({ x: 500, y: 400 }), 1, 'the center: 1', 1e-9);
  near(k({ x: 100, y: 1200 }), 2 / 4, 'twice as deep (span 4 vs 2): half the size', 1e-9);
  near(k({ x: 100, y: 0 }), 2, 'half as deep: twice the size', 1e-9);
  near(G.chartDepthScaler(map(60, true))({ x: 10, y: 1200 }), 0.5, 'globe: the same from meters', 1e-6);
  // a point beyond the horizon (no ground under it) keeps its size
  const sky = Object.assign(map(60), { unproject: ([x, y]) => (y < 0 ? { lng: NaN, lat: NaN } : { lng: x * 1e-3, lat: 0 }) });
  assert.equal(G.chartDepthScaler(sky)({ x: 5, y: -10 }), 1);
});
