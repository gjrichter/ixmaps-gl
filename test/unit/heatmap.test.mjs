// .type("HEATMAP"): the colorRange deck.gl's HeatmapLayer takes from style.colorscheme, and the
// weight of one record (size field, else a numeric value field, else 1 — "$item$" or a text value).
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
const { heatmapColorRange, heatmapWeight } = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));

test('heatmap color range: always 6 RGBA steps, transparent first, opaque last', () => {
  for (const cs of [['#ff0000'], ['#ffffcc', '#fd8d3c', '#800026'], ['5', 'white', 'blue'], undefined]) {
    const r = plain(heatmapColorRange(cs));
    assert.equal(r.length, 6);
    assert.equal(r[0][3], 0, 'the lowest density is transparent');
    assert.equal(r[5][3], 255, 'the highest density is opaque');
    assert.ok(r.every(c => c.length === 4 && c.every(v => Number.isFinite(v) && v >= 0 && v <= 255)));
  }
});

test('heatmap color range: one color ends in it, a list in its last color', () => {
  assert.deepEqual(plain(heatmapColorRange(['#ff0000']))[5].slice(0, 3), [255, 0, 0]);
  assert.deepEqual(plain(heatmapColorRange(['#ffffcc', '#fd8d3c', '#800026']))[5].slice(0, 3), [128, 0, 38]);
  assert.deepEqual(plain(heatmapColorRange(['#ffffcc', '#fd8d3c', '#800026']))[0].slice(0, 3), [255, 255, 204]);
});

test('heatmap color range: a color it cannot read falls back to a default instead of failing', () => {
  const r = plain(heatmapColorRange(['not a color']));
  assert.equal(r.length, 6);
  assert.equal(r[5][3], 255);
});

test('heatmap weight: size field, else numeric value field, else 1', () => {
  const p = { n: '12', t: 'x', e: '' };
  assert.equal(heatmapWeight({ size: 'n' }, p), 12);
  assert.equal(heatmapWeight({ value: 'n' }, p), 12);
  assert.equal(heatmapWeight({ value: 'n', size: 'n' }, p), 12);
  assert.equal(heatmapWeight({ value: '$item$' }, p), 1);
  assert.equal(heatmapWeight({ value: 'n', size: '$item$' }, p), 1, 'a size of $item$ counts the record');
  assert.equal(heatmapWeight({}, p), 1);
});

test('heatmap weight: a text value field counts the record, a text SIZE field gives nothing', () => {
  const p = { n: '12', t: 'x' };
  assert.equal(heatmapWeight({ value: 't' }, p), 1);
  assert.equal(heatmapWeight({ value: 't', size: '$item$' }, p), 1);
  assert.equal(heatmapWeight({ value: 'n', size: 't' }, p), 0);
});

test('heatmap weight: zero and negative values give no weight; European numbers are read', () => {
  assert.equal(heatmapWeight({ size: 'n' }, { n: '0' }), 0);
  assert.equal(heatmapWeight({ size: 'n' }, { n: '-3' }), 0);
  assert.equal(heatmapWeight({ size: 'n' }, { n: '1.234,5' }), 1234.5);
});
