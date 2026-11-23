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

test('per-item PLOT as SVG: the icon drawing, anchored at the item, in SVG_PLOT_UNIT per chart unit', () => {
  const def = normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'a|b|c' },
    style: { type: 'CHART|SYMBOL|PLOT|LINES|AREA|LASTPOP', linewidth: 6, symbols: 'none', fillopacity: '0.2' } });
  const rt = new LayerRuntime(def, { type: 'FeatureCollection', features: [] }, {});
  const U = G.SVG_PLOT_UNIT;
  const chart = rt._buildItemPlotIcon([0, 2, 1], { min: 0, max: 2 }, 2, [10, 20, 30], 0.2, U, 'sig');
  const g = G.itemPlotGeometry([0, 2, 1], { min: 0, max: 2 }, rt.style, rt.flags, 2);
  assert.ok(Math.abs(chart.ox - (0 - g.ink.x0) * U) < 1e-9 && Math.abs(chart.oy - g.ink.y1 * U) < 1e-9, 'the origin is the item position');
  assert.match(chart.markup, /fill="rgba\(10,20,30,0.2\)"/, 'AREA in fillopacity');
  assert.match(chart.markup, new RegExp(`stroke="rgb\\(10,20,30\\)" stroke-width="${+(6 / 30 * U).toFixed(2)}"`), 'LINES: linewidth / 30 of a step');
  assert.match(chart.markup, /<path d="M[^"]*A[^"]*Z" fill="rgb\(10,20,30\)"\/>/, 'LASTPOP: a filled circle');
  assert.deepEqual([...chart.ext], [0, 0, Math.max(2, Math.ceil((g.ink.x1 - g.ink.x0) * U)), Math.max(2, Math.ceil((g.ink.y1 - g.ink.y0) * U))]);
  // cached by its style: the same drawing again is the same object, another style another one
  assert.equal(rt._buildItemPlotIcon([0, 2, 1], { min: 0, max: 2 }, 2, [10, 20, 30], 0.2, U, 'sig'), chart);
  assert.notEqual(rt._buildItemPlotIcon([0, 2, 1], { min: 0, max: 2 }, 2, [10, 20, 30], 0.2, U, 'other'), chart);
});

test('grid PLOT as SVG: drawn centred in the 100-unit icon, flat\'s stroke width (no raster calibration)', () => {
  const def = normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'k' },
    style: { type: 'CHART|SYMBOL|PLOT|LINES|AREA|GRIDSIZE|CATEGORICAL|AGGREGATE', values: ['a', 'b', 'c'], linewidth: 3, colorscheme: ['#336699'] } });
  const rt = new LayerRuntime(def, { type: 'FeatureCollection', features: [] }, {});
  const chart = rt._buildPlotIcon([1, 3, 2], ['a', 'b', 'c'], ['a', 'b', 'c'], 3, 3, 0, false, 'sig');
  assert.equal(chart.ox, 50); assert.equal(chart.oy, 50);
  assert.match(chart.markup, /^<g><svg x="0" y="0" width="100" height="100" overflow="hidden">/);
  const stepX = (100 - 2 * 6) / 2;
  assert.match(chart.markup, new RegExp(`stroke="rgb\\(51,102,153\\)" stroke-width="${+(3 * stepX / 30).toFixed(2)}"`), 'linewidth × step / 30, uncalibrated');
  const [l, t, r, b] = chart.ext;
  assert.ok(l >= 0 && t >= 0 && r <= 100 && b <= 100 && r - l > 80 && b > t, 'picking on the curve box, inside the icon');
  // the raster icon of the same chart is a different cache entry (not drawn here: no canvas in the test)
  assert.equal(rt._buildPlotIcon([1, 3, 2], ['a', 'b', 'c'], ['a', 'b', 'c'], 3, 3, 0, false, 'sig'), chart);
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
