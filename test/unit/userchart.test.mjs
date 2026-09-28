// USER charts: flat's ixmaps.formatValue (ui/js/tools/format.js), which
// user chart scripts call for their value labels. (The chart drawing
// itself needs a DOM and is checked against flat in the browser.)
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

test('formatValue: rounds to the precision (arrow labels "+4%", "-5%")', () => {
  assert.equal(G.flatFormatValue(3.5296, 0, ' '), '4');
  assert.equal(G.flatFormatValue(-4.698, 0, ' '), '-5');
  assert.equal(G.flatFormatValue(0, 2), '0');
});

test('formatValue: thousands separated by ".", decimals after ","; BLANK uses &nbsp; and "."', () => {
  assert.equal(G.flatFormatValue(1234567.891, 2), '1.234.567,89');
  assert.equal(G.flatFormatValue(1234567.891, 2, 'BLANK'), '1&nbsp;234&nbsp;567.89');
});

test('formatValue: a small value keeps a significant digit; CEIL / FLOOR', () => {
  assert.equal(G.flatFormatValue(0.05, 1), '0,05');
  assert.equal(G.flatFormatValue(2.41, 1, 'CEIL'), '2,5');
  assert.equal(G.flatFormatValue(2.49, 1, 'FLOOR'), '2,4');
});

test('formatValue: a page gets flat\'s as ixmaps.formatValue', () => {
  assert.equal(win.ixmaps.formatValue(1234.5, 1), '1.234,5');
});
