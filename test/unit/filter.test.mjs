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

// a per-item PLOT (several value fields) draws only the filtered records,
// as every other renderer does
test('filter: a per-item PLOT chart follows the facet and the runtime WHERE filter', () => {
  const pt = (p, x, y) => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [x, y] } });
  const feats = [pt({ r: 'Lazio', a: 1, b: 2, c: 3 }, 12, 42), pt({ r: 'Puglia', a: 4, b: 5, c: 6 }, 16, 41), pt({ r: 'Lazio', a: 2, b: 2, c: 2 }, 12.5, 41.8)];
  const rt = new G.LayerRuntime(G.normalizeTheme({ layer: 'x', binding: { value: 'a|b|c' }, style: { type: 'CHART|PLOT|LINES', colorscheme: ['#00f'] } }), { type: 'FeatureCollection', features: feats }, {});
  assert.ok(rt._isItemPlot());
  // the drawn items reach _boxRows before any deck.gl layer is built
  const drawn = () => {
    let got;
    rt._boxRows = items => { got = items; throw 'stop'; };
    try { rt._buildItemPlotLayers(6); } catch (e) { if (e !== 'stop') throw e; }
    return got.map(d => d.properties.raw.r).join(',');
  };
  assert.equal(drawn(), 'Lazio,Puglia,Lazio');
  rt.setFacetFilter('r', 'Lazio');
  assert.equal(drawn(), 'Lazio,Lazio', 'facet');
  rt.clearAllFacetFilters();
  rt.setRuntimeFilter('WHERE "r" == "Puglia"');
  assert.equal(drawn(), 'Puglia', 'runtime WHERE');
});
