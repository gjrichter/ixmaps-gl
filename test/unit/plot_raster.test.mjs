// Per-item PLOT icons: drawn only over their ink (itemPlotGeometry().ink) at a resolution that follows
// the chart's on-screen size (plotRasterPx). 270 shared-range sparklines (ports/EU_NUTS2_GDP
// …_change_sparklines_plot.html) drawn over the whole range at a fixed 24 px per step overflowed WebGL's
// max texture size in the icon atlas.
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
const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('plot ink: a series high in a shared range draws far less than the range (bbox stays the whole range)', () => {
  // shared range −60 … +60, this series climbs 0 → 10: its ink is a thin band, the bbox the whole 120
  const g = G.itemPlotGeometry([0, 2, 5, 10], { min: -60, max: 60 }, { linewidth: 3, symbols: 'none' }, flags('PLOT', 'LINES', 'AREA'), 1);
  const inkH = g.ink.y1 - g.ink.y0, boxH = g.bbox.y1 - g.bbox.y0;
  assert.ok(boxH > 3 * inkH, `bbox ${boxH} vs ink ${inkH}`);
  // the area fills down to the 0 level: the ink reaches the base, not the range's bottom
  assert.ok(g.ink.y0 <= g.baseY && g.ink.y0 > g.baseY - 0.2, 'ink bottom just under the 0 level');
  const top = Math.max(...g.points.map(p => p.y));
  assert.ok(g.ink.y1 >= top && g.ink.y1 < top + 0.2, 'ink top just over the highest point');
  near(g.ink.x0, g.bbox.x0, 'same left edge');
});

test('plot ink: covers markers, LASTPOP and LASTARROW', () => {
  const g = G.itemPlotGeometry([1, 3], { min: 0, max: 3 }, { linewidth: 6, markersize: 2 }, flags('PLOT', 'LINES', 'LASTPOP', 'LASTARROW', 'FIXSIZE'), 3);
  const inside = (x, y) => x >= g.ink.x0 && x <= g.ink.x1 && y >= g.ink.y0 && y <= g.ink.y1;
  for (const p of g.points) assert.ok(inside(p.x - p.r, p.y - p.r) && inside(p.x + p.r, p.y + p.r), 'marker inside');
  assert.ok(inside(g.lastPop.x + g.lastPop.r, g.lastPop.y + g.lastPop.r), 'LASTPOP inside');
  for (const [x, y] of g.lastArrow) assert.ok(inside(x, y), 'arrow inside');
});

test('plot ink: no drawn point falls back to the bbox', () => {
  const g = G.itemPlotGeometry([NaN, NaN], { min: 0, max: 1 }, {}, flags('PLOT', 'LINES'), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(g.ink)), JSON.parse(JSON.stringify(g.bbox)));
});

test('plotRasterPx: the device px per step, the nearest power of 2, 2 … 24', () => {
  assert.equal(G.plotRasterPx(2.2, 1), 2, 'a 2 px step: 2');
  assert.equal(G.plotRasterPx(1, 1), 2, 'never under 2');
  assert.equal(G.plotRasterPx(4, 1), 4);
  assert.equal(G.plotRasterPx(4, 2), 8, 'retina doubles it');
  assert.equal(G.plotRasterPx(10, 1), 8);
  assert.equal(G.plotRasterPx(30, 1), 24, 'capped at the former fixed 24');
  assert.equal(G.plotRasterPx(0, 1), 24, 'no step size: the former 24');
  assert.equal(G.plotRasterPx(5, undefined), 4, 'no devicePixelRatio: 1');
  // stable across a zoom inside one power-of-2 band (no icon rebuild per frame)
  assert.equal(G.plotRasterPx(3, 1), G.plotRasterPx(5, 1));
});
