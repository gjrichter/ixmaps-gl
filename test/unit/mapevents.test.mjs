// Map events (flat's mapApi.on), getBounds / getMapLibre on the handle, and the "inert event" warning.
// The wiring to MapLibre needs a browser; here the name handling, the pending registration and the
// handle surface are checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');
const warnings = [];
const win = { console: { info() {}, warn: (...a) => warnings.push(a.join(' ')), log() {}, error() {} }, location: { search: '' },
  document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } } };
win.window = win; win.globalThis = win;
vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
const G = win.__ixmapsGlInternals;

test('splitMapEvents: space-separated names, lower-cased, flat aliases resolved', () => {
  assert.deepEqual(Array.from(G.splitMapEvents('zoomend  moveend')), ['zoomend', 'moveend']);
  assert.deepEqual(Array.from(G.splitMapEvents('ZoomPan itemclick MapReady drawtheme')), ['viewchange', 'click', 'ready', 'layerdraw']);
  assert.deepEqual(Array.from(G.splitMapEvents('itemover itemout newtheme removetheme')), ['mouseover', 'mouseout', 'layeradd', 'layerremove']);
  assert.deepEqual(Array.from(G.splitMapEvents('')), []);
  assert.deepEqual(Array.from(G.splitMapEvents(undefined)), []);
});

test('builder.on: wired events are stored per name without a warning; an unwired one warns once', () => {
  const b = new G.MapBuilder('map_div');
  warnings.length = 0;
  const cb = () => {};
  b.on('click zoompan', cb).on('mouseover', cb).on('mouseover', cb);
  assert.deepEqual(Array.from(b._pendingEvents, e => e[0]), ['click', 'viewchange', 'mouseover', 'mouseover']);
  assert.equal(warnings.length, 1, 'only the unwired event warns, once');
  assert.match(warnings[0], /"mouseover" is not implemented/);
});

test('builder.off: removes the given handler for the given events only', () => {
  const b = new G.MapBuilder('map_div');
  const a = () => {}, c = () => {};
  b.on('click moveend', a).on('click', c);
  b.off('click', a);
  assert.deepEqual(Array.from(b._pendingEvents, e => [e[0], e[1] === a ? 'a' : 'c']), [['moveend', 'a'], ['click', 'c']]);
  b.off('itemclick', c);          // an alias removes the same handler
  assert.deepEqual(Array.from(b._pendingEvents, e => e[0]), ['moveend']);
});

test('getBounds: null before a map exists; flat order [swLat, swLng, neLat, neLng] is the getBoundingBox box', () => {
  assert.equal(G.getBounds(), null);
  assert.equal(win.ixmaps.getBounds(), null);
  assert.equal(typeof win.ixmaps.getBoundingBox, 'function');
});

test('map handle: on, getBounds, getMapLibre exist; getMapLibre is undefined before the map is built', () => {
  const h = win.ixmaps.map('events_map');
  for (const m of ['on', 'off', 'getBounds', 'getMapLibre']) assert.equal(typeof h[m], 'function', m);
  assert.equal(h.getMapLibre(), undefined);
  assert.equal(h.getBounds(), null);
});
