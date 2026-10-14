// ixmaps.data.showFacets: the facet browser's delegated click/keyup
// handlers, wired once per container, must act on the theme id of the
// LATEST showFacets call into that container, not the first one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');

// a container that records its listeners; the rendered markup is ignored —
// the test dispatches events whose target resolves the [data-*] lookups
const listeners = {};
const container = { dataset: {}, innerHTML: '', addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); } };
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
  document: {
    styleSheets: [], head: { appendChild() {}, insertBefore() {}, firstChild: null },
    createElement: () => ({}),
    getElementById: id => (id === 'facets' ? container : null)
  } };
win.window = win; win.globalThis = win;
vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });

const facets = () => [{ id: 'kind', type: 'list', values: ['a'], valuesCount: { a: 1 }, nValuesSum: 1 }];
// a click on the value bar 'a' of facet field 'kind'
const valueClick = () => {
  const fieldEl = { dataset: { field: 'kind' } };
  const valueEl = { dataset: { value: 'a' }, closest: s => (s === '[data-field]' ? fieldEl : null) };
  return { target: { closest: s => (s === '[data-role="value"]' ? valueEl : null) } };
};

test('showFacets: a later call into the same container retargets the click handler to its theme id', () => {
  const calls = [];
  win.__setFacetFilter = (...a) => calls.push(a);
  win.ixmaps.data.showFacets('', 'facets', facets(), 'A');
  win.ixmaps.data.showFacets('', 'facets', facets(), 'B');
  assert.equal(listeners.click.length, 1, 'still wired once per container');
  listeners.click[0](valueClick());
  assert.deepEqual(calls, [['B', 'kind', 'a']], 'the filter goes to the theme now shown, not the first one');
});
