// rt._dataSourceKey (themeDataSourceKey): which themes share one dataset, so
// a facet filter on one reaches the others (setFacetFilter → siblingRuntimes).
// The Map() build and themes added later (map.add / define) use the same key.
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

const spec = (name, data, type) => G.normalizeTheme({ layer: name, data, binding: { geo: 'geometry', value: 'v' }, style: { type: type || 'CHART|DOT' } });
const csv = { url: 'https://example.org/a.csv', type: 'csv' };

test('a deferred (out of scale) theme shares the key of a loaded theme on the same data', () => {
  const loaded = G.themeDataSourceKey(spec('charts', csv), { sourceKey: G.dataSourceKey(csv) });
  const deferred = G.themeDataSourceKey(spec('base', csv, 'FEATURE'), { deferred: true });
  assert.equal(deferred, loaded);
});

test('a deferred theme on other data does not', () => {
  const other = { url: 'https://example.org/b.csv', type: 'csv' };
  assert.notEqual(G.themeDataSourceKey(spec('base', other, 'FEATURE'), { deferred: true }), G.dataSourceKey(csv));
});

test('named data, WMS and in-memory (.obj) themes keep keys of their own', () => {
  assert.equal(G.themeDataSourceKey(spec('n', { name: 'feed', type: 'ext' }), { named: true }), 'name:feed');
  assert.equal(G.themeDataSourceKey(spec('w', { url: 'https://example.org/MapServer' }, 'WMS'), { wms: true }), 'wms:w');
  assert.equal(G.themeDataSourceKey(spec('o', { obj: { type: 'FeatureCollection', features: [] }, type: 'geojson' }), {}), 'obj:o');
  // an .obj theme is its own data even while out of scale
  assert.equal(G.themeDataSourceKey(spec('o', { obj: { type: 'FeatureCollection', features: [] }, type: 'geojson' }, 'FEATURE'), { deferred: true }), 'obj:o');
});

test('a loaded theme uses the data cache\'s source key', () => {
  assert.equal(G.themeDataSourceKey(spec('charts', csv), { sourceKey: 'k' }), 'k');
});
