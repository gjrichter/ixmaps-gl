// data loading edge cases: quantized TopoJSON points, a raw jsonDB .data({obj}),
// multi-URL CSVs whose headers differ, and the choropleth join of missing ids
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
// timers for the .data({query}) timeouts
win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
// a minimal stand-in for data.js's CSV import (Data.object(...).import(cb)):
// a Table-shaped {table, fields: [{id}], records: [[...]]}, as data.js makes it
win.Data = {
  object: ({ source }) => ({
    import(cb) {
      const lines = source.trim().split('\n').map(l => l.split(','));
      cb({ table: { records: lines.length - 1, fields: lines[0].length }, fields: lines[0].map(id => ({ id })), records: lines.slice(1) });
    }
  })
};
const csvFiles = { 'a.csv': 'lat,lon,v\n45,9,1\n', 'b.csv': 'v,lon,lat,extra\n2,10,46,x\n', 'c.csv': 'lat,lon,v\n47,11,3\n' };
win.fetch = async u => ({ ok: true, status: 200, text: async () => csvFiles[u] });
vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
const G = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));

test('topojson: quantized Point / MultiPoint positions are decoded with the transform, as arcs are', async () => {
  const topo = { type: 'Topology', transform: { scale: [0.001, 0.001], translate: [9, 45] }, arcs: [],
    objects: { c: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [500, 1000] }, { type: 'MultiPoint', coordinates: [[0, 0], [1000, 2000]] }] } } };
  const fc = await G.fetchLayerData({ obj: topo, type: 'topojson' }, {});
  assert.deepEqual(plain(fc.features.map(f => f.geometry.coordinates)), [[9.5, 46], [[9, 45], [10, 47]]]);
  // unquantized: positions as they are
  const raw = { type: 'Topology', arcs: [], objects: { c: { type: 'Point', coordinates: [9.5, 46] } } };
  assert.deepEqual(plain((await G.fetchLayerData({ obj: raw, type: 'topojson' }, {})).features[0].geometry.coordinates), [9.5, 46]);
});

test('.data({obj}): a raw jsonDB object ({fields, records}) loads without process', async () => {
  const db = { table: { records: 2, fields: 3 }, fields: [{ id: 'lat' }, { id: 'lon' }, { id: 'v' }], records: [['45', '9', '1'], ['46', '10', '2']] };
  const fc = await G.fetchLayerData({ obj: db, type: 'jsondb' }, { position: 'lat|lon' });
  assert.deepEqual(plain(fc.features.map(f => [f.geometry.coordinates, f.properties.v])), [[[9, 45], '1'], [[10, 46], '2']]);
});

test('.data({urls}) csv through data.js: each file\'s columns are aligned by name, not by position', async () => {
  const fc = await G.fetchLayerData({ urls: ['a.csv', 'b.csv', 'c.csv'], type: 'csv' }, { position: 'lat|lon' });
  assert.deepEqual(plain(fc.features.map(f => f.properties)), [
    { lat: '45', lon: '9', v: '1' },
    { lat: '46', lon: '10', v: '2', extra: 'x' },
    { lat: '47', lon: '11', v: '3' },
  ]);
  assert.deepEqual(plain(fc.features.map(f => f.geometry.coordinates)), [[9, 45], [10, 46], [11, 47]]);
});

test('choropleth: a polygon without id and a row without lookup value do not join ("undefined" ≠ a key)', () => {
  const sq = [[[0, 0], [1, 0], [1, 1], [0, 0]]];
  const rts = [{ name: 'L', flags: new Set(['FEATURE']), binding: { id: 'id' }, features: [
    { type: 'Feature', properties: { id: 'A' }, geometry: { type: 'Polygon', coordinates: sq } },
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: sq } },
    { type: 'Feature', properties: { id: null }, geometry: { type: 'Polygon', coordinates: sq } }] }];
  const table = { rows: [{ k: 'A', v: 1 }, { v: 99 }, { k: null, v: 98 }] };
  for (const type of [['CHOROPLETH'], ['CHOROPLETH', 'CATEGORICAL', 'AGGREGATE']]) {
    const fc = G.joinChoroplethFeatures({ name: 'L', flags: new Set(type), binding: { lookup: 'k', value: 'v' }, style: {} }, table, rts);
    assert.deepEqual(plain(fc.features.map(f => f.properties.v ?? null)), [1, null, null], type.join('|'));
  }
});

// .data({query}): queries run in parallel, each handed its own options
// object, which the query passes back with ixmaps.setExternalData
test('.data({query}): parallel queries get their own data, by options object, name or oldest; timeouts, throws and null fail cleanly', async () => {
  const set = (d, o) => win.ixmaps.setExternalData(d, o);
  const table = v => ({ json: () => [{ k: v }] });
  const rowsOf = r => r.rows.map(x => x.k);
  const hold = {};
  const q = (key, fn) => G.fetchLayerData({ query: (theme, options) => { hold[key] = options; if (fn) fn(options); } , name: key }, { lookup: 'k' }, {});
  // two in flight, answered in reverse order, each with its own options object
  const a = q('A'), b = q('B');
  set(table('b'), hold.B);
  set(table('a'), hold.A);
  assert.deepEqual(rowsOf(await a), ['a']);
  assert.deepEqual(rowsOf(await b), ['b']);
  // a new options object naming the query's data
  const c = q('C'), d = q('D');
  set(table('d'), { name: 'D' });
  set(table('c'), { name: 'C' });
  assert.deepEqual([rowsOf(await c), rowsOf(await d)], [['c'], ['d']]);
  // neither: the only pending one gets it
  const e = q('E');
  set(table('e'), { type: 'dbtable' });
  assert.deepEqual(rowsOf(await e), ['e']);
  // null, a throwing query function, a timeout: each rejects, nothing stays pending
  const n = q('N');
  set(null, hold.N);
  await assert.rejects(n, /handed over no data/);
  await assert.rejects(q('T', () => { throw new Error('boom'); }), /boom/);
  G.QUERY_HANDOFF.timeoutMs = 30;
  try { await assert.rejects(q('W'), /no data handed over/); } finally { G.QUERY_HANDOFF.timeoutMs = 0; }
  const late = q('L');
  set(table('l'), {});
  assert.deepEqual(rowsOf(await late), ['l'], 'the timed-out query left no stale entry');
});
