// flat's data cache (maptheme.js 2457-2500): a source once loaded is reused by
// later themes of the same map; data.cache false reloads. And SHOW / ZOOMTO's
// extent (flat MapTheme.zoomTo): the bounds of every feature coordinate.
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
// every fetch is counted and answers the same small CSV (no data.js loaded:
// the engine parses it itself)
let fetches = 0;
win.fetch = async () => { fetches++; return { ok: true, status: 200, text: async () => 'name,lat,lon,v\na,45,9,1\nb,46,10,2\n' }; };
vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
const G = win.__ixmapsGlInternals;
// values from inside the VM: other realm's Array prototype → compare as plain JSON
const plain = v => JSON.parse(JSON.stringify(v));

const csv = { url: 'https://example.org/d.csv', type: 'csv' };
const pos = { position: 'lat|lon', value: 'v' };

test('same source, cache default: loaded once, shared by later themes', async () => {
  fetches = 0;
  const cache = new Map();
  const a = await G.cachedLayerData(cache, csv, pos, {}).promise;
  const b = await G.cachedLayerData(cache, csv, pos, {}).promise;
  assert.equal(fetches, 1);
  assert.equal(a, b);
  assert.equal(a.features.length, 2);
});

test('cache: false / "false" reloads every time, and the fresh result replaces the cached one', async () => {
  for (const off of [false, 'false', ' FALSE ']) {
    fetches = 0;
    const cache = new Map();
    const first = await G.cachedLayerData(cache, csv, pos, {}).promise;
    const fresh = await G.cachedLayerData(cache, Object.assign({ cache: off }, csv), pos, {}).promise;
    assert.equal(fetches, 2, JSON.stringify(off));
    assert.notEqual(first, fresh);
    assert.equal(await G.cachedLayerData(cache, csv, pos, {}).promise, fresh, 'later themes get the reloaded data');
    assert.equal(fetches, 2);
  }
});

test('cache: true / "true" is the default behaviour', async () => {
  fetches = 0;
  const cache = new Map();
  await G.cachedLayerData(cache, Object.assign({ cache: 'true' }, csv), pos, {}).promise;
  await G.cachedLayerData(cache, Object.assign({ cache: true }, csv), pos, {}).promise;
  assert.equal(fetches, 1);
});

test('reload (refreshTheme) loads again even with cache on', async () => {
  fetches = 0;
  const cache = new Map();
  await G.cachedLayerData(cache, csv, pos, {}).promise;
  await G.cachedLayerData(cache, csv, pos, {}, { reload: true }).promise;
  assert.equal(fetches, 2);
});

test('one URL read as table (lookup) and as points (position) are two cache entries', async () => {
  fetches = 0;
  const cache = new Map();
  const table = await G.cachedLayerData(cache, csv, { lookup: 'name', value: 'v' }, {}).promise;
  const points = await G.cachedLayerData(cache, csv, pos, {}).promise;
  assert.equal(table.type, 'Table');
  assert.equal(points.type, 'FeatureCollection');
  assert.equal(fetches, 2);
});

test('a failed load is not cached', async () => {
  const cache = new Map();
  const failing = { url: 'https://example.org/missing.csv', type: 'csv' };
  const ok = win.fetch;
  win.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  await assert.rejects(G.cachedLayerData(cache, failing, pos, {}).promise);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(cache.size, 0);
  win.fetch = ok;
});

test('featuresBounds: every coordinate of every geometry type', () => {
  const f = g => ({ type: 'Feature', geometry: g, properties: {} });
  assert.deepEqual(plain(G.featuresBounds([f({ type: 'Point', coordinates: [9, 45] }), f({ type: 'Point', coordinates: [11, 44] })])), [[9, 44], [11, 45]]);
  assert.deepEqual(plain(G.featuresBounds([f({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 3], [0, 0]]] })])), [[0, 0], [2, 3]]);
  assert.deepEqual(plain(G.featuresBounds([f({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 1], [0, 0]]], [[[5, -2], [6, 0], [5, -2]]]] })])), [[0, -2], [6, 1]]);
  assert.deepEqual(plain(G.featuresBounds([f({ type: 'GeometryCollection', geometries: [{ type: 'LineString', coordinates: [[1, 2], [3, 4]] }] })])), [[1, 2], [3, 4]]);
  assert.equal(G.featuresBounds([]), null);
  assert.equal(G.featuresBounds([f(null), f({ type: 'Point', coordinates: [NaN, 1] })]), null);
});

test('SHOW and ZOOMTO both ask for the zoom to the extent', () => {
  assert.equal(G.wantsZoomToExtent(new Set(['CHART', 'SYMBOL', 'SHOW'])), true);
  assert.equal(G.wantsZoomToExtent(new Set(['FEATURE', 'ZOOMTO'])), true);
  assert.equal(G.wantsZoomToExtent(new Set(['CHART', 'SYMBOL'])), false);
  assert.equal(G.normalizeTheme({ layer: 'x', style: { type: 'CHART|SYMBOL|SHOW' } }).flags.has('SHOW'), true);
});
