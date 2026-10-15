// A symbol FILE (.svg/.png/.jpeg) in `symbols` is flat's <image> symbol: the
// plain (non-SEQUENCE) CHART|SYMBOL resolves it to a URL, never folds it to
// 'circle' like an unknown shape name.
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
const { LayerRuntime } = win.__ixmapsGlInternals;
const rt = style => Object.assign(Object.create(LayerRuntime.prototype), { style });

test('_urlSymbolOf: svg/png/jpeg files (query/hash allowed), not shape names', () => {
  const r = rt({});
  assert.equal(r._urlSymbolOf(' https://x/y/car.svg '), 'https://x/y/car.svg');
  assert.equal(r._urlSymbolOf('a.PNG?v=2'), 'a.PNG?v=2');
  assert.equal(r._urlSymbolOf('a.jpeg#x'), 'a.jpeg#x');
  assert.equal(r._urlSymbolOf('square'), null);
  assert.equal(r._urlSymbolOf(undefined), null);
});

test('_resolveSymbolUrl: per class, the last entry repeating (no symbolfield)', () => {
  const r = rt({ symbols: ['a.svg', 'square'] });
  assert.equal(r._resolveSymbolUrl({ cat: 0 }), 'a.svg');
  assert.equal(r._resolveSymbolUrl({ cat: 1 }), null);
  assert.equal(r._resolveSymbolUrl({ cat: 5 }), null);
  assert.equal(rt({ symbols: ['a.svg'] })._resolveSymbolUrl({ cat: 3 }), 'a.svg');
  assert.equal(rt({})._resolveSymbolUrl({ cat: 0 }), null);
});

test('_resolveSymbolUrl: symbolfield/symbolvalues picks the file by record value', () => {
  const r = rt({ symbolfield: 'k', symbolvalues: ['bus', 'car'], symbols: ['bus.svg', 'car.png'] });
  assert.equal(r._resolveSymbolUrl({ raw: { k: 'car' } }), 'car.png');
  assert.equal(r._resolveSymbolUrl({ raw: { k: 'bus' } }), 'bus.svg');
  assert.equal(r._resolveSymbolUrl({ raw: { k: 'tram' } }), null);
});
