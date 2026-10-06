// The handle API — flat's mapApi/themeApi (htmlgui_flat.js 1283, 1112) as
// the main interface (map("name").theme("theme").changeStyle(...)) — and the
// global compat wrappers' arity dispatch between flat's canonical
// theme-first signatures and the older map-first pages (PNRR's leading
// null). Arity only is checked here; the runtime behavior of the dispatched
// call is covered by the browser-checked ports.
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

test('map(): no-arg returns the default handle, a name a handle bound to that name', () => {
  const d = win.ixmaps.map();
  assert.equal(win.ixmaps.map(), d, 'the default handle is stable');
  const named = win.ixmaps.map('map_b');
  assert.notEqual(named, d);
  assert.equal(win.ixmaps.map('map_b'), named, 'a named handle is cached');
  for (const m of ['changeThemeStyle', 'setThemeVisible', 'view', 'options', 'getThemeObj', 'theme']) {
    assert.equal(typeof named[m], 'function', `named handle has ${m}`);
  }
});

test('map().theme(name): the themeApi handle, bound to the map and the theme (htmlgui_flat.js 1112)', () => {
  const th = win.ixmaps.map('map_a').theme('mytheme');
  assert.equal(th.szMap, 'map_a');
  assert.equal(th.szTheme, 'mytheme');
  const bare = win.ixmaps.map().theme();
  assert.equal(bare.szMap, null);
  assert.equal(bare.szTheme, null);
});

test('themeApi: the flat surface, all chainable', () => {
  const th = win.ixmaps.map().theme('airbnb_listings');
  for (const [m, args] of [['changeStyle', ['scale:2', 'factor']], ['markClass', [1]], ['unmarkClass', [1]],
    ['show', []], ['hide', []], ['toggle', []], ['remove', []], ['replace', [{}, 'silent']]]) {
    assert.equal(th[m](...args), th, `${m} returns the handle`);
  }
});

test('themeStyleArgs: flat canonical (szThemeName, szStyle, szFlag) passes through (htmlgui.js 2050)', () => {
  const a = G.themeStyleArgs(['airbnb_listings', 'filter:WHERE "neighbourhood" = "Dorsoduro"', 'set']);
  assert.deepEqual(a, ['airbnb_listings', 'filter:WHERE "neighbourhood" = "Dorsoduro"', 'set']);
});

test('themeStyleArgs: 4-arg map-first (null|szMap, szId, szStyle, szFlag) shifts — PNRR (htmlgui.js 173 form)', () => {
  assert.deepEqual(G.themeStyleArgs([null, 'chart', 'scale:1.2', 'factor']), ['chart', 'scale:1.2', 'factor']);
  assert.deepEqual(G.themeStyleArgs(['map_airbnb_all_hosts', 'chart', 'scale:1.2', 'factor']), ['chart', 'scale:1.2', 'factor']);
});

test('themeStyleArgs: flat\'s duplicate-leading shift (htmlgui.js 2052)', () => {
  assert.deepEqual(G.themeStyleArgs(['theme', 'theme', 'scale:2', 'factor']), ['theme', 'scale:2', 'factor']);
});

test('removeTheme / setBasemapOpacity: both arities dispatch on arguments.length', () => {
  // flat's canonical removeTheme(szThemeId) (htmlgui.js 1884); the map-first
  // pages call (null|szMap, szId) — a 2-arg call must not lose the id
  let seen;
  const h = win.ixmaps.map();
  const orig = h.remove;
  win.ixmaps.map().remove = (...a) => { seen = a; };
  win.ixmaps.removeTheme('mytheme');
  assert.equal(seen && seen[0], 'mytheme', '1-arg: the theme id reaches the handle');
  win.ixmaps.removeTheme(null, 'mytheme');
  assert.equal(seen && seen[0], 'mytheme', '2-arg null-leading: the theme id reaches the handle');
  win.ixmaps.map().remove = orig;
});

test('the Map callback object: flat\'s mapApi handle methods on the builder (htmlgui_flat.js 904-935)', () => {
  const Builder = G.MapBuilder;
  const b = new Builder('map-div', { name: 'map_airbnb_all_hosts' });
  // flat page calls on __map: setView (zoom_to_city), replace (onCityChange)
  for (const m of ['setView', 'replace', 'add', 'remove', 'removeTheme', 'replaceTheme',
    'changeThemeStyle', 'refreshTheme', 'setBasemapOpacity', 'setMapType', 'resize',
    'setThemeVisible', 'show', 'hide', 'getZoom', 'getThemeObj', 'getThemes', 'theme']) {
    assert.equal(typeof b[m], 'function', `builder has handle method ${m}`);
  }
  // the builder's own methods keep their (different) semantics
  for (const m of ['view', 'options', 'layer', 'attribution', 'on']) {
    assert.equal(typeof b[m], 'function', `builder keeps its own ${m}`);
  }
  // the theme handle reached through the builder binds the map's own name
  const th = b.theme('airbnb_listings');
  assert.equal(th.szMap, 'map_airbnb_all_hosts');
  assert.equal(th.szTheme, 'airbnb_listings');
  // delegation goes to the named map's handle (no map yet: the calls defer, no throw)
  b.setView([41.9, 12.5], 12);
  b.replace('airbnb_listings', {});
});

test('setProjection: the projection-only swap, on the handle and the builder — no project machinery', () => {
  assert.equal(typeof win.ixmaps.map().setProjection, 'function', 'handle has setProjection');
  const b = new G.MapBuilder('map-div', {});
  assert.equal(typeof b.setProjection, 'function', 'builder delegates setProjection');
});
