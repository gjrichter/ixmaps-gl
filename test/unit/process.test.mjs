// .data({process}) — flat's data processing hook, run against the REAL
// data.js (loaded from a sibling checkout; skipped when it is missing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_JS = [path.resolve(HERE, '..', '..', '..', 'data.js', 'data.js'), path.join(os.homedir(), 'Repositories/GitHub/data.js/data.js')].find(p => fs.existsSync(p));
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
  document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} }, getElementsByTagName: () => [] } };
win.window = win; win.globalThis = win; win.self = win;
vm.createContext(win);
if (DATA_JS) vm.runInContext(fs.readFileSync(DATA_JS, 'utf8'), win, { filename: 'data.js' });
vm.runInContext(fs.readFileSync(path.resolve(HERE, '..', '..', 'ixmaps-gl.js'), 'utf8'), win, { filename: 'ixmaps-gl.js' });
const G = win.__ixmapsGlInternals;
const skip = !DATA_JS && 'no sibling data.js checkout';

// the roma page's own process function, verbatim in shape
const romaProcess = function (data) {
  const iVittime = data.column('Vittime').index;
  const iFeriti = data.column('Feriti').index;
  data.addColumn({ destination: 'Pericolosita' }, row => (parseInt(row[iVittime]) || 0) * 9 + (parseInt(row[iFeriti]) || 0) * 3);
  return data;
};
const rows = [
  { lat: '41.9', lon: '12.5', Vittime: '0', Feriti: '2' },
  { lat: '41.8', lon: '12.4', Vittime: '1', Feriti: '0' },
];

test('process (a stringified function, as pages pass it) adds computed columns before the features are built', { skip }, async () => {
  const fc = await G.fetchLayerData({ obj: rows, type: 'json', process: romaProcess.toString() }, { position: 'lat|lon' });
  assert.deepEqual(Array.from(fc.features, f => f.properties.Pericolosita), [6, 9]);
});

test('process gets a data.js Table; returning nothing keeps the (mutated) input table, as flat', { skip }, async () => {
  let seen = null;
  const fn = function (data) { seen = typeof data.addColumn; data.addColumn({ destination: 'x' }, () => 1); };
  const fc = await G.fetchLayerData({ obj: rows, type: 'json', process: fn }, { position: 'lat|lon' });
  assert.equal(seen, 'function');
  assert.deepEqual(Array.from(fc.features, f => f.properties.x), [1, 1]);
});

test('without process the data is untouched', { skip }, async () => {
  const fc = await G.fetchLayerData({ obj: rows, type: 'json' }, { position: 'lat|lon' });
  assert.equal(fc.features[0].properties.Pericolosita, undefined);
});
