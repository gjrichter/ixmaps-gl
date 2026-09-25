// Zoom convention: ixmaps API zooms are flat's (Leaflet, 256px tiles),
// MapLibre's are one level lower for the same view; map scales follow
// the displayed zoom.
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
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

test('flat zoom z ↔ MapLibre zoom z - 1', () => {
  assert.equal(G.flatToMapLibreZoom(12.5), 11.5);
  assert.equal(G.mapLibreToFlatZoom(11.5), 12.5);
});

test('scaleDenominatorAt: the scale of the displayed view, from a MapLibre zoom', () => {
  // flat at zoom 12.5 (= MapLibre 11.5): 559082264.028 / 2^12.5
  near(G.scaleDenominatorAt(11.5), 559082264.028 / Math.pow(2, 12.5), 'MapLibre 11.5');
  near(G.scaleDenominatorAt(null), 559082264.028 / Math.pow(2, 10), 'default reference = flat zoom 10');
});

test('resolveZoomReference: normalSizeScale → the MapLibre zoom showing that scale', () => {
  const z = G.resolveZoomReference({ normalSizeScale: '259302' });
  near(G.scaleDenominatorAt(z), 259302, 'round trip');
  near(G.resolveZoomReference({}), 9, 'no normalSizeScale → flat 10 = MapLibre 9');
});

test('resolveAggregationPx / valuesHiddenByScale compare thresholds with the displayed scale', () => {
  const agg = ['1:1', '3px', '1:500000', '1px'];
  // flat zoom 12.5 ≈ 1:98800 → 3px; flat zoom 10 ≈ 1:546000 → 1px
  assert.equal(G.resolveAggregationPx(agg, G.flatToMapLibreZoom(12.5), 8).px, 3);
  assert.equal(G.resolveAggregationPx(agg, G.flatToMapLibreZoom(10), 8).px, 1);
  // 1:500000 is crossed between flat zoom 10 (546k) and 10.2 (476k)
  assert.equal(G.valuesHiddenByScale({ valueupper: '1:500000' }, G.flatToMapLibreZoom(10)), true);
  assert.equal(G.valuesHiddenByScale({ valueupper: '1:500000' }, G.flatToMapLibreZoom(10.2)), false);
});
