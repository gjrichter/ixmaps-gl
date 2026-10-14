// The {type:"Sphere"} ocean backdrop (applySphereBackdrop): a Sphere theme
// defined after build, while the map's tiles are still loading, must still
// get its color — MapLibre's isStyleLoaded() is false then although the
// style itself loaded, and 'style.load' does not fire again.
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

function fakeMap({ styleLoaded, tilesLoading }) {
  const calls = { paint: [], once: [] };
  const layers = new Map();
  return {
    calls,
    style: { _loaded: styleLoaded },
    isStyleLoaded: () => styleLoaded && !tilesLoading,
    once: (ev, cb) => calls.once.push([ev, cb]),
    getLayer: id => layers.get(id),
    getStyle: () => ({ layers: [] }),
    addLayer: l => layers.set(l.id, l),
    setPaintProperty: (id, k, v) => calls.paint.push([id, k, v])
  };
}

test('Sphere backdrop: painted at once when the style loaded but tiles are still loading', () => {
  const map = fakeMap({ styleLoaded: true, tilesLoading: true });
  G.applySphereBackdrop(map, { colorscheme: ['#aaddff'], fillopacity: 0.5 });
  assert.deepEqual(map.calls.once, []);
  assert.deepEqual(map.calls.paint.map(p => p.slice(1)), [['background-color', '#aaddff'], ['background-opacity', 0.5]]);
});

test('Sphere backdrop: waits for style.load while the style itself is not loaded', () => {
  const map = fakeMap({ styleLoaded: false, tilesLoading: false });
  G.applySphereBackdrop(map, { colorscheme: '#aaddff' });
  assert.deepEqual(map.calls.paint, []);
  assert.equal(map.calls.once.length, 1);
  assert.equal(map.calls.once[0][0], 'style.load');
  map.style._loaded = true;
  map.calls.once[0][1]();
  assert.deepEqual(map.calls.paint.map(p => p.slice(1)), [['background-color', '#aaddff'], ['background-opacity', 1]]);
});
