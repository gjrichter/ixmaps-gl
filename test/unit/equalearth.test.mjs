// mapProjection "equalearth": the pseudo-Mercator plane (EE_PLANE), its inverse, the antimeridian
// cut and the ingest transform (projectFeaturesToPlane keeps the real geometry as _geo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');
function engine() {
  const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
    document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } } };
  win.window = win; win.globalThis = win;
  vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
  return win.__ixmapsGlInternals;
}
const { EE_PLANE, PLANES, planeOfName, planeGeometry, projectFeaturesToPlane, planeViewBounds, isEqualEarthName } = engine();
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);
// Web Mercator y (radians of a unit world) of a pseudo latitude
const mercY = lat => Math.asinh(Math.tan(lat * Math.PI / 180));

test('isEqualEarthName', () => {
  assert.ok(isEqualEarthName('equalearth') && isEqualEarthName('Equal Earth') && isEqualEarthName('equal-earth'));
  assert.ok(!isEqualEarthName('orthographic') && !isEqualEarthName(undefined));
});

test('forward: equator and meridian edge land where Equal Earth puts them', () => {
  const [x0, y0] = EE_PLANE.forward(0, 0);
  near(x0, 0); near(y0, 0);
  near(EE_PLANE.forward(180, 0)[0], 180);          // the plane is 360 pseudo-degrees wide
  near(EE_PLANE.forward(-180, 0)[0], -180);
  const [xs, ys] = EE_PLANE.forward(0, 90);        // pole: a line, not a point; x = 0 on the central meridian
  near(xs, 0);
  assert.ok(ys > 60 && ys < 70, `pole pseudo latitude ${ys}`);
});

test('forward: pseudo Mercator y is linear in the Equal Earth y (the plane is undistorted)', () => {
  // Equal Earth y of two latitudes, scaled by pi / xmax, equals the Mercator y of their pseudo latitudes
  const ee = (lat) => { const M = Math.sqrt(3) / 2, l = Math.asin(M * Math.sin(lat * Math.PI / 180)), l2 = l * l, l6 = l2 * l2 * l2;
    return l * (1.340264 - 0.081106 * l2 + l6 * (0.000893 + 0.003796 * l2)); };
  for (const lat of [-80, -45, -10, 0, 20, 60, 85]) near(mercY(EE_PLANE.forward(0, lat)[1]), ee(lat) * Math.PI / EE_PLANE.xmax, 1e-9);
});

test('inverse round-trips forward over the globe', () => {
  for (const lon of [-179, -120, -30, 0, 15, 90, 179]) for (const lat of [-89, -60, -20, 0, 33, 70, 89]) {
    const [px, py] = EE_PLANE.forward(lon, lat), r = EE_PLANE.inverse(px, py);
    assert.ok(r, `inverse null for ${lon},${lat}`);
    near(r[0], lon, 1e-6); near(r[1], lat, 1e-6);
  }
});

test('inverse: null outside the outline', () => {
  assert.equal(EE_PLANE.inverse(179, 60), null);   // right of the curved edge at 60°N
  assert.equal(EE_PLANE.inverse(0, 80), null);     // above the pole line
});

test('planeViewBounds: a view wholly outside the outline falls back to the world', () => {
  const b = planeViewBounds({ lat: 80, lng: 170 }, { lat: 84, lng: 179 });
  assert.deepEqual(JSON.parse(JSON.stringify(b)), [{ lat: -90, lng: -180 }, { lat: 90, lng: 180 }]);
});

test('Point: longitude beyond 180 wraps', () => {
  const a = planeGeometry({ type: 'Point', coordinates: [190, 10] }).coordinates, b = planeGeometry({ type: 'Point', coordinates: [-170, 10] }).coordinates;
  near(a[0], b[0]); near(a[1], b[1]);
});

test('LineString across the antimeridian is cut into two pieces ending on the outline', () => {
  const g = planeGeometry({ type: 'LineString', coordinates: [[170, 10], [-170, 10]] });
  assert.equal(g.type, 'MultiLineString');
  assert.equal(g.coordinates.length, 2);
  const xs = g.coordinates.map(part => part.map(c => c[0]));
  assert.ok(xs[0].every(x => x > 0) && xs[1].every(x => x < 0), 'one piece per side');
  const edge = EE_PLANE.forward(180, 10)[0];
  near(Math.max(...xs[0]), edge, 1e-6); near(Math.min(...xs[1]), -edge, 1e-6);
});

test('Polygon across the antimeridian becomes a MultiPolygon, each part inside the plane', () => {
  const g = planeGeometry({ type: 'Polygon', coordinates: [[[170, 0], [-170, 0], [-170, 10], [170, 10], [170, 0]]] });
  assert.equal(g.type, 'MultiPolygon');
  assert.equal(g.coordinates.length, 2);
  for (const poly of g.coordinates) for (const c of poly[0]) assert.ok(Math.abs(c[0]) <= 180 + 1e-9);
});

test('a polygon that does not cross is only mapped and densified (still a Polygon)', () => {
  const g = planeGeometry({ type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] });
  assert.equal(g.type, 'Polygon');
  assert.ok(g.coordinates[0].length > 5, 'long edges are split');
});

test('a pole-enclosing ring (Antarctica) stays one polygon along the pole line', () => {
  const ring = [[-180, -70], [-90, -72], [0, -75], [90, -72], [180, -70], [180, -90], [-180, -90], [-180, -70]];
  const g = planeGeometry({ type: 'Polygon', coordinates: [ring] });
  assert.equal(g.type, 'Polygon');
  const ys = g.coordinates[0].map(c => c[1]), poleY = EE_PLANE.forward(0, -90)[1];
  near(Math.min(...ys), poleY, 1e-6);
});

test('projectFeaturesToPlane keeps the real geometry as _geo and does not touch the input', () => {
  const geom = { type: 'Point', coordinates: [12, 41] };
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { a: 1 }, geometry: geom }] };
  const out = projectFeaturesToPlane(fc);
  assert.deepEqual(fc.features[0].geometry.coordinates, [12, 41]);
  assert.equal(out.features[0]._geo, geom);
  assert.notDeepEqual(out.features[0].geometry.coordinates, [12, 41]);
  assert.equal(projectFeaturesToPlane(out), out, 'already projected: returned as is');
});

// ---- Winkel (flat's own formula) on the same plane machinery ----
const WK = PLANES.winkel;
test('planeOfName: equalearth and winkel (tripel) spellings, nothing else', () => {
  assert.equal(planeOfName('winkel'), WK); assert.equal(planeOfName('Winkel Tripel'), WK); assert.equal(planeOfName('winkel-tripel'), WK);
  assert.equal(planeOfName('equalearth'), EE_PLANE);
  assert.equal(planeOfName('orthographic'), null); assert.equal(planeOfName(undefined), null);
});
test('winkel: plane is 360 pseudo-degrees wide, centred, poles are lines', () => {
  near(WK.forward(0, 0)[0], 0); near(WK.forward(0, 0)[1], 0);
  near(WK.forward(180, 0)[0], 180); near(WK.forward(-180, 0)[0], -180);
  assert.ok(WK.forward(0, 90)[1] > 40 && WK.forward(0, 90)[1] < 80);
  assert.notEqual(WK.xmax, EE_PLANE.xmax);
});
test('winkel: inverse round-trips forward over the globe', () => {
  for (const lon of [-179, -120, -30, 0, 15, 90, 179]) for (const lat of [-89, -60, -20, 0, 33, 70, 89]) {
    const [px, py] = WK.forward(lon, lat), r = WK.inverse(px, py);
    assert.ok(r, `inverse null for ${lon},${lat}`);
    near(r[0], lon, 1e-5); near(r[1], lat, 1e-5);
  }
});
test('winkel: inverse null outside the outline', () => {
  assert.equal(WK.inverse(179, 62), null);
});
test('winkel: ingest keeps _geo and an antimeridian line is cut', () => {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[170, 10], [-170, 12]] } }] };
  const out = projectFeaturesToPlane(fc, WK);
  assert.equal(out.features[0].geometry.type, 'MultiLineString');
  assert.deepEqual(JSON.parse(JSON.stringify(out.features[0]._geo)), fc.features[0].geometry);
  const eq = projectFeaturesToPlane(fc, EE_PLANE).features[0].geometry.coordinates[0][0];
  assert.notDeepEqual(eq, out.features[0].geometry.coordinates[0][0]);   // a different plane
});
test('winkel: planeViewBounds uses the given plane', () => {
  const b = planeViewBounds({ lat: -10, lng: -10 }, { lat: 10, lng: 10 }, WK);
  assert.ok(b[0].lng < 0 && b[1].lng > 0 && b[0].lat < 0 && b[1].lat > 0);
});
test('winkel is the true Winkel Tripel (cos φ1 = 2/π), not flat\'s radians quirk', () => {
  near(WK.xmax, (Math.PI + 2) / 2, 1e-12);                 // x(180°, 0) = (π + 2) / 2
  // pole line half-length = π/2·... : x(180°, 90°) = ½·λ·(2/π) = 1, y(·, 90°) = π/4 + ... = ½(π/2 + π/2)
  const [px, py] = WK.forward(180, 90);
  near(px / 180 * WK.xmax, 1, 1e-9); near(py, Math.atan(Math.sinh(Math.PI / 2 * Math.PI / WK.xmax)) * 180 / Math.PI, 1e-9);
});
