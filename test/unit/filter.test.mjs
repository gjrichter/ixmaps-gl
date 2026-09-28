// .filter(...) — flat's filter grammar (maptheme.js filterValues): WHERE
// clauses joined by AND, flat's operators, a regex without WHERE.
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

const rows = [
  { id: 'a', 'P1.1': '40', 'P1.2': '60', name: 'Monte Rosa', code: '8888888' },
  { id: 'b', 'P1.1': '60', 'P1.2': '70', name: 'Milano', code: '1234' },
  { id: 'c', 'P1.1': '1.200,5', 'P1.2': '80', name: 'San Remo', code: '' },
];
const ids = expr => G.applyWhereFilter({ type: 'Table', rows }, expr).rows.map(r => r.id);

test('filter: numeric comparisons joined by AND (the censimenti page\'s "WHERE P1.1 > 50 AND P1.2 > 50")', () => {
  assert.deepEqual(ids('WHERE P1.1 > 50 AND P1.2 > 50'), ['b', 'c'], '"1.200,5" reads 1200.5, as flat\'s __scanValue');
  assert.deepEqual(ids('WHERE P1.2 <= 60'), ['a']);
  assert.deepEqual(ids('WHERE P1.2 BETWEEN 60 AND 70'), ['a', 'b']);
});

test('filter: = / != compare as text or as numbers; a quoted value may hold spaces', () => {
  assert.deepEqual(ids('WHERE P1.2 = 60.0'), ['a'], 'numbers equal');
  assert.deepEqual(ids('WHERE name = "Monte Rosa"'), ['a']);
  assert.deepEqual(ids('WHERE id != a'), ['b', 'c']);
  assert.deepEqual(ids('WHERE id <> a'), ['b', 'c']);
});

test('filter: NOT / LIKE / IN / unknown operators are flat\'s regex tests, case-insensitive', () => {
  assert.deepEqual(ids('WHERE code NOT 8888888'), ['b', 'c'], 'the page\'s "WHERE SEZ21_ID NOT 8888888"');
  assert.deepEqual(ids('WHERE name LIKE "san%"'), ['c'], 'SQL % wildcard, case-insensitive');
  assert.deepEqual(ids('WHERE code LIKE "*"'), ['a', 'b'], 'LIKE "*": not empty (the page\'s "PROCOM like \\"*\\"")');
  assert.deepEqual(ids('WHERE id IN (a,c)'), ['a', 'c']);
  assert.deepEqual(ids('WHERE name == ila'), ['b'], '"==" is no operator in flat: a regex match');
});

test('filter: a value "$field$" is another column; without WHERE a regex over the whole row', () => {
  assert.deepEqual(ids('WHERE P1.1 < $P1.2$'), ['a', 'b']);
  assert.deepEqual(ids('milano'), ['b']);
});

test('filter: features are filtered by their properties', () => {
  const fc = { type: 'FeatureCollection', features: rows.map(r => ({ type: 'Feature', geometry: null, properties: r })) };
  assert.deepEqual(G.applyWhereFilter(fc, 'WHERE P1.1 > 50').features.map(f => f.properties.id), ['b', 'c']);
});
