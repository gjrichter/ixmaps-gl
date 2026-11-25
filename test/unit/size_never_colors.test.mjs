// A bound size field is a size source only: it must never shape the color classes, which come from
// the value field (or its aggregates). The INGV earthquake page colors by depth and sizes by magnitude
// or energy; sized by magnitude, the class range used to end at the largest magnitude, so a 400 km
// quake fell outside every class and was painted as the shallowest. Runs the real builders up to their
// stats against a stub deck (its layer classes can't draw, so a build stops after the classes are set).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
  document: { styleSheets: [], createElement: () => ({ getContext: () => null, style: {} }), head: { appendChild() {} } } };
win.window = win; win.globalThis = win;
win.deck = new Proxy({}, { get: () => class { constructor(p) { this.props = p; } } });
vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
const G = win.__ixmapsGlInternals;

// depth (km), magnitude
const QUAKES = [[5, 2.1], [10, 2.5], [8, 1.8], [12, 3.0], [30, 2.2], [60, 2.8], [120, 3.1], [250, 3.5], [400, 2.9], [599, 4.0], [2, 1.5], [15, 2.0], [7, 2.4]];
const quakes = () => ({ type: 'FeatureCollection', features: QUAKES.map(([d, m], i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [9 + i * 0.5, 45] },
  properties: { depth: d, mag: m, energy: Math.pow(10, 1.5 * m + 4.8) } })) });
const build = rt => { try { rt.buildDeckLayers(6, [-180, -85, 180, 85]); } catch (e) { /* the stub deck can't draw */ } };
const breaks = rt => rt.partsA.map(p => [p.min, p.max]);

for (const type of ['CHART|BUBBLE|QUANTILE|VALUES|COUNT', 'CHART|BUBBLE|QUANTILE|COUNT|AGGREGATE|SUM']) {
  test(`${type}: the size field (magnitude or energy) does not change the depth classes`, () => {
    const runtimeBy = size => {
      const rt = new G.LayerRuntime(G.normalizeTheme({ layer: 'q', binding: { value: 'depth', position: 'geometry', size },
        style: { type, colorscheme: ['7', 'RGB(245,41,38)', 'RGB(74,74,255)', 'dynamic'], gridwidth: '2px' } }), quakes(), {});
      build(rt);
      return rt;
    };
    const byMag = runtimeBy('mag'), byEnergy = runtimeBy('energy');
    assert.deepEqual(breaks(byMag), breaks(byEnergy));
    for (const rt of [byMag, byEnergy]) {
      assert.ok(breaks(rt)[6][1] > 599, 'the last class reaches the deepest quake');
      assert.deepEqual([400, 599].map(d => rt._resolvePartsClass(d)), [6, 6]);
    }
  });
}

test('aggregated value-field pie with a size field: its classes span the part values, not the sizes', () => {
  const fc = { type: 'FeatureCollection', features: [[10, 1000], [20, 5000], [30, 2000], [40, 9000], [50, 3000]].map(([v, s], i) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [9 + i, 45] }, properties: { v, s } })) };
  const rt = new G.LayerRuntime(G.normalizeTheme({ layer: 'p', binding: { value: 'v', position: 'geometry', size: 's' },
    style: { type: 'CHART|PIE|AGGREGATE|SUM', colorscheme: ['5', '#ffffff', '#ff0000'], gridwidth: '2px' } }), fc, {});
  build(rt);
  assert.ok(rt.partsA && rt.partsA.length, 'classes were computed');
  assert.equal(rt.partsA[0].min, 10);
  assert.ok(rt.partsA[rt.partsA.length - 1].max <= 50.01, `last class ends at the largest part value, got ${rt.partsA[rt.partsA.length - 1].max}`);
});
