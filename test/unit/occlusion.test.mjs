// Chart value texts under later-drawn charts (chartTextTransmittance): flat
// draws each chart as one SVG group (symbol, text) in draw order, so
// a later chart's symbol covers the texts beneath it.
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
const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

const chart = (x, y, r, alpha = 1) => ({ x, y, parts: [{ dx: 0, dy: 0, r, shape: 'circle', alpha }] });
const text = (order, x, y, w = 4, h = 4) => ({ order, x, y, w, h });

test('occlusion: only a LATER chart covers a text — the text of the chart on top stays', () => {
  const charts = [chart(0, 0, 10), chart(2, 0, 20)];
  const t = G.chartTextTransmittance(charts, [text(0, 0, 0), text(1, 2, 0)]);
  assert.deepEqual(Array.from(t), [0, 1]);
});

test('occlusion: a partly covered text keeps the share of its sample points outside', () => {
  // the box's right half lies inside the later chart, its center on the edge
  const charts = [chart(-100, 0, 1), chart(50, 0, 50)];
  const t = G.chartTextTransmittance(charts, [text(0, 0, 0, 20, 10)]);
  near(t[0], 2 / 5, 'center and the two right samples covered: the two left show');
});

test('occlusion: translucent symbols compose as Π(1 − α)', () => {
  const charts = [chart(0, 0, 1), chart(0, 0, 10, 0.5), chart(0, 0, 10, 0.5)];
  near(G.chartTextTransmittance(charts, [text(0, 0, 0)])[0], 0.25, 'two half-opaque symbols');
});

test('occlusion: symbol shapes as drawSymbolPath draws them', () => {
  assert.ok(G.insideSymbolShape('squarefull', 9, 9, 10), 'squarefull: side 2r');
  assert.ok(!G.insideSymbolShape('square', 9, 0, 10), 'square: side r·√2');
  assert.ok(!G.insideSymbolShape('diamond', 6, 6, 10), 'diamond: |dx| + |dy| ≤ r');
  assert.ok(!G.insideSymbolShape('empty', 0, 0, 10), 'empty: no fill');
  assert.ok(G.insideSymbolShape('circle', 6, 6, 10) && !G.insideSymbolShape('circle', 8, 8, 10), 'circle');
});

test('occlusion: charts far from the texts, or none, change nothing', () => {
  assert.deepEqual(Array.from(G.chartTextTransmittance([chart(0, 0, 1), chart(500, 500, 30)], [text(0, 0, 0)])), [1]);
  assert.deepEqual(Array.from(G.chartTextTransmittance([], [])), []);
});
