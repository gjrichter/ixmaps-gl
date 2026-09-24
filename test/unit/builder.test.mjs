// Real ixmaps-flat's remaining layer-builder methods (field, field100, geo,
// lookup, encoding, process, query, json): each must write the slot flat's
// themeConstruct writes, and normalizeTheme must read it as flat does.
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
const { normalizeTheme } = win.__ixmapsGlInternals;
const ixmaps = win.ixmaps;
const plain = v => JSON.parse(JSON.stringify(v));

test('field()/field100() → def.field/def.field100 (flat\'s slots)', () => {
  const def = ixmaps.layer('x').field('F').field100('P').definition();
  assert.equal(def.field, 'F');
  assert.equal(def.field100, 'P');
  const spec = normalizeTheme(def);
  assert.equal(spec.binding.value, 'F');
  assert.equal(spec.targets['theme.field100'], 'P');
});

test('a .binding() value wins over .field() (flat applies the binding later)', () => {
  assert.equal(normalizeTheme(ixmaps.layer('x').field('F').binding({ value: 'B' }).definition()).binding.value, 'B');
  assert.equal(normalizeTheme(ixmaps.layer('x').binding({ value: 'B' }).field('F').definition()).binding.value, 'B');
});

test('geo()/lookup() → def.style.lookupfield, read by flat\'s lookupfield rule', () => {
  const byGeo = ixmaps.layer('x').data({ url: 'u', type: 'csv' }).geo('la|lo').definition();
  assert.equal(byGeo.style.lookupfield, 'la|lo');
  assert.equal(normalizeTheme(byGeo).binding.position, 'la|lo');
  const byLookup = ixmaps.layer('x').data({ url: 'u', type: 'csv' }).lookup('code').definition();
  assert.equal(normalizeTheme(byLookup).binding.lookup, 'code');
});

test('query()/process() → def.data.query/process, whatever the order relative to .data()', () => {
  const a = ixmaps.layer('x').data({ url: 'u', type: 'csv' }).query('Q').process('P').definition();
  const b = ixmaps.layer('x').query('Q').process('P').data({ url: 'u', type: 'csv' }).definition();
  for (const def of [a, b]) assert.deepEqual(plain(def.data), { url: 'u', type: 'csv', query: 'Q', process: 'P' });
});

test('process(fn) keeps the function\'s source text, as flat does', () => {
  const def = ixmaps.layer('x').process(function (data) { return data; }).definition();
  assert.equal(typeof def.data.process, 'string');
  assert.match(def.data.process, /return data/);
});

test('without query/process, .data() is passed through unchanged (large inline tables are not copied)', () => {
  const d = { obj: [{ a: 1 }], type: 'json' };
  assert.equal(ixmaps.layer('x').data(d).definition().data, d);
});

test('encoding() merges into the binding: {k: {field}} and {k: value} forms', () => {
  const def = ixmaps.layer('x').binding({ geo: 'geometry' }).encoding({ value: { field: 'V' }, size: 'S' }).definition();
  assert.deepEqual(plain(def.binding), { geo: 'geometry', value: 'V', size: 'S' });
  const spec = normalizeTheme(def);
  assert.equal(spec.binding.value, 'V');
  assert.equal(spec.binding.size, 'S');
});

test('encoding() does not mutate the object the page passed to binding()', () => {
  const b = { geo: 'geometry' };
  ixmaps.layer('x').binding(b).encoding({ value: 'V' });
  assert.deepEqual(b, { geo: 'geometry' });
});

test('json() returns the definition', () => {
  const l = ixmaps.layer('x').type('DOT').binding({ geo: 'geometry' });
  assert.deepEqual(plain(l.json()), plain(l.definition()));
});
