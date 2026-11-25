// CHART|BAR|OFFSETMEAN with ZEROISNOTVALUE: a zero is not a value (flatNumber → NaN), so it must not
// enter the per-field mean the bars are offset from — one such record made the whole field's mean NaN
// and every chart drew that field's bar at zero. Runs the real builder up to its stats against a stub
// deck (the stub's layer classes can't draw, so the build stops after the stats are cached).
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

test('bar OFFSETMEAN|ZEROISNOTVALUE: the per-field mean skips non-values', () => {
  const pt = (a, b, lng) => ({ type: 'Feature', properties: { a, b, n: 'x' + lng }, geometry: { type: 'Point', coordinates: [lng, 45] } });
  const def = G.normalizeTheme({ layer: 'x', binding: { value: 'a|b', title: 'n' }, style: { type: 'CHART|BAR|OFFSETMEAN|ZEROISNOTVALUE', colorscheme: ['#f00', '#00f'] } });
  const rt = new G.LayerRuntime(def, { type: 'FeatureCollection', features: [pt(2, 0, 9), pt(4, 6, 10), pt(6, 8, 11)] }, {});
  try { rt.buildDeckLayers(6, [-180, -85, 180, 85]); } catch (e) { /* the stub deck can't draw */ }
  assert.ok(rt._barStatsCache, 'the stats were computed');
  assert.deepEqual([...rt._barStatsCache.means], [4, 7]);
});
