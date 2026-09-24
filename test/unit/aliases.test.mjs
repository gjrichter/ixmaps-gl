// Binding-alias resolution in normalizeTheme (flat's ~50 .binding() keys →
// 17 targets → this engine's names), and the generated alias table's sync
// with the shared grammar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { checkSections, DEFAULT_GRAMMAR } from '../sync-grammar.mjs';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');
function engine() {
  const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
    document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } } };
  win.window = win; win.globalThis = win;
  vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
  return win.__ixmapsGlInternals;
}
const { normalizeTheme } = engine();
const plain = v => JSON.parse(JSON.stringify(v));
const norm = (binding, style) => normalizeTheme({ layer: 'x', binding, style });

test('generated alias table is in sync with the grammar', { skip: !fs.existsSync(DEFAULT_GRAMMAR) && 'no sibling ixmaps-grammar checkout' }, () => {
  assert.deepEqual(checkSections(), [], 'run: node test/sync-grammar.mjs --write');
});

test('every alias of an implemented target reaches this engine\'s name', () => {
  for (const a of ['value', 'values', 'field', 'fields']) assert.equal(norm({ [a]: 'F' }).binding.value, 'F', a);
  for (const a of ['size', 'sizefield']) assert.equal(norm({ [a]: 'S' }).binding.size, 'S', a);
  for (const a of ['id', 'item', 'itemfield']) assert.equal(norm({ [a]: 'I' }).binding.id, 'I', a);
  for (const a of ['alpha', 'alphafield']) assert.equal(norm({ [a]: 'A' }).binding.alpha, 'A', a);
  for (const a of ['alpha100', 'alphafield100']) assert.equal(norm({ [a]: 'P' }).binding.alpha100, 'P', a);
  for (const a of ['text', 'valuetext', 'textvalue', 'valuefield']) assert.equal(norm({ [a]: 'T' }).style.valuefield, 'T', a);
});

test('a target given as a style key counts as the binding (flat: .style({sizefield}) ≡ .binding({size}))', () => {
  assert.equal(norm({}, { sizefield: 'S' }).binding.size, 'S');
  assert.equal(norm({}, { itemfield: 'I' }).binding.id, 'I');
  assert.equal(norm({}, { valuefield: 'V' }).style.valuefield, 'V');
});

test('a .binding() alias overrides the same target given as a style key', () => {
  assert.equal(norm({ size: 'B' }, { sizefield: 'S' }).binding.size, 'B');
  assert.equal(norm({ text: 'B' }, { valuefield: 'S' }).style.valuefield, 'B');
});

test('several aliases for one target: the last one in the object wins (flat\'s loop order)', () => {
  assert.equal(norm({ value: 'a', values: 'b' }).binding.value, 'b');
  assert.equal(norm({ values: 'b', value: 'a' }).binding.value, 'a');
  assert.equal(norm({ size: 'a', sizefield: 'b' }).binding.size, 'b');
});

// flat's lookupfield rule (maptheme.js getSelectionId): "a|b" = lat/lon,
// geometry-bearing data = embedded geometry, otherwise a join key
const withData = (binding, type, style) => normalizeTheme({ layer: 'x', binding, style, data: { url: 'u', type } });

test('lookupfield "a|b" → points (binding.position), whichever alias spells it', () => {
  for (const a of ['geo', 'georef', 'position', 'lookup', 'lookupfield', 'geo1', 'position1']) {
    const spec = withData({ [a]: 'la|lo' }, 'csv');
    assert.equal(spec.binding.position, 'la|lo', a);
    assert.equal(spec.binding.lookup, undefined, a);
    assert.equal(spec.geometry.kind, 'latlon', a);
  }
});

test('a single field on tabular data → join key (binding.lookup) — flat-style choropleth .binding({geo: "code"})', () => {
  for (const a of ['geo', 'position', 'lookup', 'lookupfield']) {
    const spec = withData({ [a]: 'code' }, 'csv');
    assert.equal(spec.binding.lookup, 'code', a);
    assert.equal(spec.binding.position, undefined, a);
    assert.equal(spec.geometry.kind, 'join', a);
  }
  assert.equal(norm({ lookup: 'code' }).binding.lookup, 'code', 'no data declared → join, as before');
});

test('the field "geometry" → embedded geometry whatever the data type (flat\'s convention)', () => {
  assert.equal(norm({ geo: 'geometry' }).binding.position, 'geometry');
  assert.equal(withData({ position: 'geometry' }, 'csv').geometry.kind, 'embedded');
});

test('GeoJSON/TopoJSON data → embedded geometry (binding.position)', () => {
  for (const type of ['geojson', 'topojson', 'TopoJSON']) {
    const spec = withData({ geo: 'geometry' }, type);
    assert.equal(spec.binding.position, 'geometry', type);
    assert.equal(spec.geometry.kind, 'embedded', type);
  }
});

test('lookupfield as a style key counts too; a binding alias overrides it', () => {
  assert.equal(withData({}, 'csv', { lookupfield: 'code' }).binding.lookup, 'code');
  assert.equal(withData({ geo: 'la|lo' }, 'csv', { lookupfield: 'code' }).binding.position, 'la|lo');
});

test('several lookupfield spellings: the last one wins, and exactly one of position/lookup is set', () => {
  assert.equal(withData({ geo: 'a|b', position: 'c|d' }, 'csv').binding.position, 'c|d');
  assert.equal(withData({ position: 'c|d', geo: 'a|b' }, 'csv').binding.position, 'a|b');
  const spec = withData({ position: 'la|lo', lookup: 'code' }, 'csv');
  assert.equal(spec.binding.lookup, 'code');
  assert.equal(spec.binding.position, undefined);
});

test('no lookupfield spelling → position/lookup untouched, spec.geometry null', () => {
  const spec = withData({ value: 'v', id: 'code' }, 'topojson');
  assert.equal(spec.binding.position, undefined);
  assert.equal(spec.binding.lookup, undefined);
  assert.equal(spec.geometry, null);
});

test('targets this engine does not implement are recorded in spec.targets, not applied', () => {
  const spec = norm({ title: 'name', color: 'c', time: 't', value100: 'v' });
  assert.deepEqual(plain(spec.targets), { 'style.titlefield': 'name', 'style.colorfield': 'c', 'style.timefield': 't', 'theme.field100': 'v' });
  assert.equal(spec.binding.value, undefined);
});

test('original binding keys are kept, including ones flat ignores', () => {
  const spec = norm({ geo: 'geometry', id: 'code', title: 'name', positon: 'typo' });
  assert.deepEqual(plain(spec.binding), { geo: 'geometry', id: 'code', title: 'name', positon: 'typo', position: 'geometry' });
});

test('the page\'s own binding and style objects are still never mutated', () => {
  const b = { values: 'F', size: 'S' }, s = { sizefield: 'X' };
  const before = JSON.stringify([b, s]);
  norm(b, s);
  assert.equal(JSON.stringify([b, s]), before);
});
