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

test('scaleDenominatorAt: flat\'s own map scale of the displayed view, from a MapLibre zoom', () => {
  // the scale flat shows (and compares featureupper, chartupper, aggregation
  // brackets … with) is 442 913 385 / 2^zoom, at any latitude — read off
  // flat's scale bar: 1:54 067 at zoom 13 (Leipzig and Milano), 1:108 133
  // at 12, 1:142 683 at 11.6
  const shown = { 13: 54067, 12: 108133, 11.6: 142683 };
  for (const [z, s] of Object.entries(shown)) {
    assert.equal(Math.round(G.scaleDenominatorAt(G.flatToMapLibreZoom(Number(z)))), s, `flat zoom ${z}`);
  }
  near(G.scaleDenominatorAt(null), 442913385 / Math.pow(2, 10), 'default reference = flat zoom 10');
});

test('resolveZoomReference: the zoom at which FLAT\'s object scale equals normalSizeScale (read from a real flat page)', () => {
  // flat: nTrueMapScale 236 220 472 × nZoomScale → 108 133.15 at flat zoom 12,
  // i.e. 442 913 385 / 2^zoom (mapscript2.js 2849 compares it with normalSizeScale)
  const flatScaleAt = mlZoom => 442913385 / Math.pow(2, G.mapLibreToFlatZoom(mlZoom));
  near(flatScaleAt(G.flatToMapLibreZoom(12)), 108133.15, 'the measured flat scale at zoom 12');
  near(flatScaleAt(G.resolveZoomReference({ normalSizeScale: '259302' })), 259302, 'round trip');
  near(flatScaleAt(G.resolveZoomReference({})), 177165354, 'no normalSizeScale → flat\'s nMapScale (mapscript.js 2124)');
});

test('normalSizeScale: any key spelling, as flat (htmlgui.js /normalSizeScale/i)', () => {
  near(G.resolveZoomReference({ normalsizescale: '259302' }), G.resolveZoomReference({ normalSizeScale: '259302' }), 'lowercase key');
  near(G.resolveZoomReference({ NormalSizeScale: 259302 }), G.resolveZoomReference({ normalSizeScale: '259302' }), 'other spelling');
  assert.equal(G.normalSizeScaleOf({ normalsizescale: '1', normalSizeScale: '2' }), '2', 'the last matching key wins');
  near(G.objectZoomFactor(3, { objectscaling: 'dynamic', normalsizescale: '10000000' }),
    G.objectZoomFactor(3, { objectscaling: 'dynamic', normalSizeScale: '10000000' }), 'object zoom factor');
});

// flat's equalearth.svg on a 1024×748 map at view([12, 10], z), measured on
// flat (2026-10-09): screen px per degree of longitude on the equator, and
// flat's map scale (nTrueMapScale · nZoomScale) / nDynamicObjectScale with
// normalSizeScale 1e7
const EE_FLAT = { 2: [4.425, 38594698, 0.6375], 3: [5.625, 30246348, 0.6915], 4: [12.425, 13687734, 0.9007], 5: [23.675, 7180199, 1.1167] };
const EE_URL = 'https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-flat@1/maps/svg/maps/generic/equalearth.svg';

test('flatSvgProjectionOf: equalearth / winkel maps, none for mercator and orthographic', () => {
  assert.ok(G.flatSvgProjectionOf(EE_URL));
  assert.ok(G.flatSvgProjectionOf('maps/svg/maps/generic/winkel.svg'));
  for (const u of ['maps/svg/maps/generic/mercator.svg', 'maps/svg/maps/generic/orthographic.svg', '', undefined]) assert.equal(G.flatSvgProjectionOf(u), null, String(u));
});

test('flatViewToMapLibreZoom: frames a flat Equal Earth view as flat fits it', () => {
  const ee = G.flatSvgProjectionOf(EE_URL);
  const dx = lat => ee.project(lat, 10.5)[0] - ee.project(lat, 9.5)[0];
  for (const [z, [pxPerDegEquator]] of Object.entries(EE_FLAT)) {
    const ml = G.flatViewToMapLibreZoom(Number(z), 12, 10, 1024, 748, ee);
    // MapLibre's px per degree = flat's at the center latitude
    const expected = pxPerDegEquator * dx(12) / dx(0);
    const got = 512 * Math.pow(2, ml) / 360;
    assert.ok(Math.abs(got / expected - 1) < 0.006, `flat zoom ${z}: ${got} vs ${expected}`);
    near(G.mapLibreToFlatViewZoom(ml, 12, 10, 1024, 748, ee), Number(z), `inverse at ${z}`);
  }
  // no flat SVG projection: the plain zoom convention
  assert.equal(G.flatViewToMapLibreZoom(4, 12, 10, 1024, 748, null), 3);
  assert.equal(G.mapLibreToFlatViewZoom(3, 12, 10, 1024, 748, null), 4);
});

test('objectZoomFactor under a flat Equal Earth map: flat\'s dynamic object scale at the same on-screen size', () => {
  const opts = { objectscaling: 'dynamic', normalsizescale: '10000000' };
  G.flatSvgProjectionByOptions.set(opts, G.flatSvgProjectionOf(EE_URL));
  for (const [z, [pxPerDegEquator, , dynObj]] of Object.entries(EE_FLAT)) {
    const ml = Math.log2(pxPerDegEquator * 360 / 512);
    const f = G.objectZoomFactor(ml, opts);
    assert.ok(Math.abs(f / dynObj - 1) < 0.01, `flat zoom ${z}: ${f} vs ${dynObj}`);
  }
  // a Mercator page is unchanged: flat's Mercator scale 442 913 385 / 2^zoom
  near(G.objectZoomFactor(1, { objectscaling: 'dynamic', normalSizeScale: '10000000' }), Math.pow(1e7 / (442913385 / 4), 1 / 3), 'Mercator');
});

test('resolveAggregationPx / valuesHiddenByScale compare thresholds with the displayed scale', () => {
  const agg = ['1:1', '3px', '1:500000', '1px'];
  // flat's scale: flat zoom 12.5 = 1:76 468 → 3px; 1:500000 is crossed at
  // flat zoom 9.79 — 9.7 = 1:532 555 → 1px, 9.9 = 1:463 612 → 3px
  assert.equal(G.resolveAggregationPx(agg, G.flatToMapLibreZoom(12.5), 8).px, 3);
  assert.equal(G.resolveAggregationPx(agg, G.flatToMapLibreZoom(9.7), 8).px, 1);
  assert.equal(G.resolveAggregationPx(agg, G.flatToMapLibreZoom(9.9), 8).px, 3);
  assert.equal(G.valuesHiddenByScale({ valueupper: '1:500000' }, G.flatToMapLibreZoom(9.7)), true);
  assert.equal(G.valuesHiddenByScale({ valueupper: '1:500000' }, G.flatToMapLibreZoom(9.9)), false);
});
