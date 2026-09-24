// projectThemeToDefinition: a theme from a real ixmaps-flat project JSON
// (older shape: data source in style.dbtable*, value field at the top level)
// → the definition normalizeTheme takes. Synthetic themes with the same
// structure as real project files (no project content is copied here).
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
const { projectThemeToDefinition: toDef, normalizeTheme } = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));

test('style.dbtable* keys → data{} (flat\'s own table, reversed); dbtableUrl used as is', () => {
  const def = toDef({ layer: 'L', field: 'v', style: { type: 'CHART|BUBBLE', dbtable: 'T', dbtableUrl: 'https://x/t.csv', dbtableType: 'csv', datacache: 'true', scale: 2 } });
  assert.deepEqual(plain(def.data), { name: 'T', url: 'https://x/t.csv', type: 'csv', cache: 'true' });
  assert.deepEqual(plain(def.style), { type: 'CHART|BUBBLE', scale: 2 });
  assert.equal(def.field, 'v');
  assert.equal(def.layer, 'L');
});

test('ext/process/query/obj keys are carried as data — never run', () => {
  const def = toDef({ layer: 'L', style: { dbtable: 'T', dbtableType: 'ext', dbtableExt: 'broker.js', dbtableProcess: 'function(d){return d}', dbtableQuery: 'Q', dbtableObj: [1] } });
  assert.deepEqual(plain(def.data), { name: 'T', type: 'ext', ext: 'broker.js', process: 'function(d){return d}', query: 'Q', obj: [1] });
});

test('flat\'s oldest one-string form "name type (url) (ext)"', () => {
  assert.deepEqual(plain(toDef({ style: { dbtable: 'T csv (u.csv)' } }).data), { name: 'T', type: 'csv', url: 'u.csv' });
  assert.deepEqual(plain(toDef({ style: { dbtable: 'T csv (u.csv) (b.js)' } }).data), { name: 'T', type: 'csv', url: 'u.csv', ext: 'b.js' });
  assert.deepEqual(plain(toDef({ style: { dbtable: 'T (u.json)' } }).data), { name: 'T', type: 'jsonDB', url: 'u.json' });
});

test('a modern data{} block wins over the style keys; "data" aliases "obj"; data.field → def.field', () => {
  const def = toDef({ field: 'top', style: { dbtableUrl: 'old.csv', dbtableType: 'csv' }, data: { url: 'new.csv', data: [1], field: 'fromData' } });
  assert.equal(def.data.url, 'new.csv');
  assert.equal(def.data.type, 'csv');
  assert.deepEqual(plain(def.data.obj), [1]);
  assert.equal(def.data.data, undefined);
  assert.equal(def.field, 'fromData');
});

test('a top-level type overrides style.type; field100 is carried', () => {
  const def = toDef({ type: 'CHOROPLETH', field100: 'tot', style: { type: 'FEATURES' } });
  assert.equal(def.style.type, 'CHOROPLETH');
  assert.equal(def.field100, 'tot');
});

test('no data keys → data undefined; the project theme object is not mutated', () => {
  const t = { layer: 'L', style: { type: 'FEATURES', dbtable: 'T' } };
  const before = JSON.stringify(t);
  assert.equal(toDef({ layer: 'L', style: { type: 'DOT' } }).data, undefined);
  toDef(t);
  assert.equal(JSON.stringify(t), before);
});

test('end to end: a project theme normalizes like the equivalent builder layer', () => {
  const spec = normalizeTheme(toDef({ layer: 'comuni', field: 'v2024', style: { type: 'CHOROPLETH|QUANTILE', dbtable: 'T', dbtableUrl: 'd.csv', dbtableType: 'csv', lookupfield: 'code' } }));
  assert.equal(spec.binding.value, 'v2024');
  assert.equal(spec.binding.lookup, 'code');
  assert.equal(spec.data.url, 'd.csv');
  assert.ok(spec.flags.has('QUANTILE'));
});

test('"$item$" (flat: count the items) binds no value field', () => {
  const spec = normalizeTheme(toDef({ layer: 'L', field: '$item$', style: { type: 'FEATURES' } }));
  assert.equal(spec.binding.value, undefined);
  assert.equal(spec.targets['theme.field'], '$item$');
});
