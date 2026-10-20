// .type("MLHEATMAP"): the pure parts of MapLibre's native heatmap layer — the source points, the
// weight that counts 1, the radius by zoom (checked against the engine's own object scaling,
// objectZoomFactor, by evaluating MapLibre's exponential interpolation) and the paint.
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
const { mlHeatmapPoints, mlHeatmapWeightMax, mlHeatmapRadius, mlHeatmapPaint, typeStyleNumbers, syncNativeHeatmaps, mlHeatLayerId } = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));

const feat = (coordinates, props) => ({ geometry: coordinates && { type: 'Point', coordinates }, properties: props });
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// MapLibre's exponential interpolation of a two-stop ['interpolate', ['exponential', b], ['zoom'], z0, y0, z1, y1]
function evalRadius(expr, zoom) {
  const base = expr[1][1], z0 = expr[3], y0 = expr[4], z1 = expr[5], y1 = expr[6];
  if (zoom <= z0) return y0;
  if (zoom >= z1) return y1;
  const t = base === 1 ? (zoom - z0) / (z1 - z0) : (Math.pow(base, zoom - z0) - 1) / (Math.pow(base, z1 - z0) - 1);
  return y0 + (y1 - y0) * t;
}
// the engine's object scaling of a symbol radius, clamped as the layer clamps it
const ideal = (radiusPx, zoomRef, pow, zoom) => Math.max(0.5, Math.min(400, radiusPx * Math.pow(2, (zoom - zoomRef) / pow)));

test('mlheatmap points: GeoJSON points with the weight w; no position or weight ≤ 0 is left out', () => {
  const feats = [feat([1, 2], { n: '3' }), feat([5, 6], { n: '1.5' }), feat(null, { n: '1' }), feat([NaN, 1], { n: '1' }), feat([2, 2], { n: '0' }), feat([4, 4], { n: '-2' }), feat([3, 3], { n: 'x' })];
  const fc = plain(mlHeatmapPoints(feats, { size: 'n' }));
  assert.equal(fc.type, 'FeatureCollection');
  assert.deepEqual(fc.features.map(f => [f.geometry.coordinates, f.properties.w]), [[[1, 2], 3], [[5, 6], 1.5]]);
  assert.ok(fc.features.every(f => f.type === 'Feature' && f.geometry.type === 'Point'));
  assert.deepEqual(plain(mlHeatmapPoints(feats, { value: '$item$' })).features.map(f => f.properties.w), [1, 1, 1, 1, 1], '$item$: one each (the zero-weight record counts too)');
  assert.deepEqual(plain(mlHeatmapPoints([], {})), { type: 'FeatureCollection', features: [] });
});

test('mlheatmap weight max: style.weightmax, else the largest weight; 1 for none', () => {
  const feats = [feat([1, 2], { n: '3' }), feat([5, 6], { n: '7.5' }), feat(null, { n: '99' }), feat([2, 2], { n: '-4' })];
  assert.equal(mlHeatmapWeightMax(feats, { size: 'n' }, {}), 7.5, 'a record without a position does not count');
  assert.equal(mlHeatmapWeightMax(feats, { size: 'n' }, { weightmax: 6 }), 6, 'given');
  assert.equal(mlHeatmapWeightMax(feats, { size: 'n' }, { weightmax: 0 }), 7.5, 'unusable: the data');
  assert.equal(mlHeatmapWeightMax(feats, { value: '$item$' }, undefined), 1);
  assert.equal(mlHeatmapWeightMax([], { size: 'n' }, {}), 1);
  assert.equal(mlHeatmapWeightMax([feat([1, 1], { n: '0' })], { size: 'n' }, {}), 1, 'all weights 0: 1');
});

test('mlheatmap radius: a number when it does not follow the zoom or sits at a limit', () => {
  assert.equal(mlHeatmapRadius(30, 6, 1, false), 30);
  assert.equal(mlHeatmapRadius(1000, 6, 1, false), 400, 'capped');
  assert.equal(mlHeatmapRadius(0.1, 6, 1, false), 0.5, 'floored');
  assert.equal(mlHeatmapRadius(0, 6, 1, false), 30, 'unusable: the default of 30 px');
  assert.equal(mlHeatmapRadius(5000, 0, 1, true), 400, 'above the cap at every zoom');
});

test('mlheatmap radius: grows with the zoom exactly as the engine\'s object scaling, between 0.5 and 400 px', () => {
  for (const [r, ref, pow] of [[30, 6, 1], [30, 6, 2], [30, 6, 0.5], [12, 3.2, 1.5], [30, 20, 1], [30, 0, 1]]) {
    const expr = plain(mlHeatmapRadius(r, ref, pow, true));
    assert.equal(expr[0], 'interpolate');
    assert.deepEqual(expr[2], ['zoom']);
    assert.equal(expr[1][0], 'exponential');
    near(expr[1][1], Math.pow(2, 1 / pow), 1e-12, `base for pow ${pow}`);
    assert.ok(expr[5] > expr[3], 'stop zooms ascend');
    assert.ok(expr[3] >= 0 && expr[5] <= 24, 'stop zooms inside 0…24');
    for (let z = 0; z <= 24; z += 0.37) {
      near(evalRadius(expr, z), ideal(r, ref, pow, z), 1e-6 * 400, `r ${r}, zoomRef ${ref}, pow ${pow}, zoom ${z.toFixed(2)}`);
    }
    assert.ok(evalRadius(expr, 0) >= 0.5 - 1e-9 && evalRadius(expr, 24) <= 400 + 1e-9);
  }
});

test('mlheatmap radius: at the reference zoom the radius is the given one, doubling per zoom level (pow 1)', () => {
  const expr = plain(mlHeatmapRadius(30, 6, 1, true));
  near(evalRadius(expr, 6), 30, 1e-9, 'at the reference zoom');
  near(evalRadius(expr, 7), 60, 1e-9, 'one level in');
  near(evalRadius(expr, 5), 15, 1e-9, 'one level out');
  near(evalRadius(expr, 24), 400, 1e-9, 'capped far in');
  assert.equal(evalRadius(expr, 0), 30 * Math.pow(2, -6) < 0.5 ? 0.5 : 30 * Math.pow(2, -6), 'floored far out');
});

test('mlheatmap paint: weight 0…max → 0…1, the ramp over the densities, intensity, opacity, radius as given', () => {
  const paint = plain(mlHeatmapPaint({ colorscheme: ['#ffffcc', '#fd8d3c', '#800026'] }, 6, 25));
  assert.deepEqual(paint['heatmap-weight'], ['interpolate', ['linear'], ['get', 'w'], 0, 0, 6, 1]);
  assert.equal(paint['heatmap-intensity'], 1);
  assert.equal(paint['heatmap-opacity'], 1);
  assert.equal(paint['heatmap-radius'], 25);
  const color = paint['heatmap-color'];
  assert.deepEqual(color.slice(0, 3), ['interpolate', ['linear'], ['heatmap-density']]);
  const stops = color.slice(3);
  assert.deepEqual(stops.filter((_, i) => i % 2 === 0), [0, 0.2, 0.4, 0.6, 0.8, 1], 'densities ascend from 0 to 1');
  assert.equal(stops[1], 'rgba(255,255,204,0)', 'transparent at density 0, in the first color');
  assert.equal(stops[3], 'rgb(255,255,204)', 'the ramp starts at 0.2');
  assert.equal(stops[11], 'rgb(128,0,38)', 'and ends in the last color');
  assert.ok(stops.filter((_, i) => i % 2 === 1).every(c => /^rgba?\(\d+,\d+,\d+(,[\d.]+)?\)$/.test(c)), 'MapLibre color strings');
});

test('mlheatmap paint: intensity and opacity from the style, a radius expression passes through, bad values fall back', () => {
  const radius = mlHeatmapRadius(30, 6, 1, true);
  const p = plain(mlHeatmapPaint({ intensity: 2.5, fillopacity: 0.4 }, 3, radius));
  assert.equal(p['heatmap-intensity'], 2.5);
  assert.equal(p['heatmap-opacity'], 0.4);
  assert.deepEqual(p['heatmap-radius'], plain(radius));
  assert.equal(plain(mlHeatmapPaint({ intensity: -1, fillopacity: 7 }, 3, 10))['heatmap-opacity'], 1, 'above 1 is 1');
  assert.equal(plain(mlHeatmapPaint({ intensity: -1 }, 3, 10))['heatmap-intensity'], 1, 'unusable: 1');
  assert.deepEqual(plain(mlHeatmapPaint({}, 0, 10))['heatmap-weight'], ['interpolate', ['linear'], ['get', 'w'], 0, 0, 1, 1], 'no usable maximum: 1');
  const noScheme = plain(mlHeatmapPaint(undefined, 1, 10))['heatmap-color'];
  assert.ok(noScheme.length > 5, 'no style at all still gives a ramp');
});

test('mlheatmap paint: a scheme of one color fades in by alpha instead of by color', () => {
  const stops = plain(mlHeatmapPaint({ colorscheme: ['#336699'] }, 1, 10))['heatmap-color'].slice(3);
  assert.deepEqual(stops, [0, 'rgba(51,102,153,0)', 0.2, 'rgba(51,102,153,0.2)', 0.4, 'rgba(51,102,153,0.4)',
    0.6, 'rgba(51,102,153,0.6)', 0.8, 'rgba(51,102,153,0.8)', 1, 'rgba(51,102,153,1)']);
});

test('mlheatmap style: radiuspx, intensity, weightmax (and the HEATMAP / KDE keys) are numbers even when a project JSON writes strings', () => {
  const st = plain(typeStyleNumbers({ radiuspx: '30', intensity: '2.5', weightmax: '6', threshold: '0.1', bandwidth: '12', fillopacity: '0.4', colorscheme: ['#336699'] }));
  assert.deepEqual(st, { radiuspx: 30, intensity: 2.5, weightmax: 6, threshold: 0.1, bandwidth: 12, fillopacity: 0.4, colorscheme: ['#336699'] });
  // and what the functions do with them
  assert.equal(plain(mlHeatmapPaint(st, 3, 10))['heatmap-intensity'], 2.5);
  assert.equal(mlHeatmapWeightMax([feat([1, 2], { n: '3' })], { size: 'n' }, st), 6);
});

// ── the native layers: syncNativeHeatmaps against a fake MapLibre map ──
function fakeMap(initial = []) {
  const calls = [], layers = initial.map(id => ({ id, type: id.startsWith('deck-') ? 'custom' : 'fill' })), sources = new Map(), layout = new Map();
  const m = {
    calls, layers, sources,
    getLayersOrder: () => layers.map(l => l.id),
    getLayer: id => layers.find(l => l.id === id),
    getSource: id => sources.get(id),
    addSource(id, spec) { calls.push(['addSource', id]); sources.set(id, { spec, setData(d) { calls.push(['setData', id]); this.spec.data = d; } }); },
    addLayer(spec, before) {
      calls.push(['addLayer', spec.id, before]);
      const at = before ? layers.findIndex(l => l.id === before) : -1;
      const layer = { id: spec.id, type: spec.type, spec: { ...spec, paint: { ...spec.paint } } };
      if (at >= 0) layers.splice(at, 0, layer); else layers.push(layer);
    },
    removeLayer(id) { calls.push(['removeLayer', id]); layers.splice(layers.findIndex(l => l.id === id), 1); },
    removeSource(id) { calls.push(['removeSource', id]); sources.delete(id); },
    setPaintProperty(id, k, v) { calls.push(['setPaint', id, k]); m.getLayer(id).spec.paint[k] = v; },
    getLayoutProperty: (id, k) => layout.get(id + '|' + k),
    setLayoutProperty(id, k, v) { calls.push(['setLayout', id, k, v]); layout.set(id + '|' + k, v); },
    order: () => layers.map(l => l.id),
    dropStyle() { layers.length = 0; sources.length = 0; sources.clear(); layout.clear(); }   // what setStyle does: everything is gone
  };
  return m;
}
const quakes = () => [feat([1, 2], { n: '3' }), feat([5, 6], { n: '1.5' }), feat([7, 8], { n: '6' }), feat(null, { n: '9' })];
const theme = (over = {}) => ({ name: 'quakes', flags: new Set(['MLHEATMAP']), features: quakes(), binding: { size: 'n' },
  style: { colorscheme: ['#ffffcc', '#800026'], radiuspx: 30 }, mapOptions: {}, _dataGen: 1, _hidden: false, ...over });
const ID = 'ixmaps-mlheat:quakes';

test('mlheatmap sync: a source with the weighted points and a heatmap layer, before the first deck.gl layer', () => {
  const map = fakeMap(['basemap-fill', 'deck-a', 'deck-b']), owned = new Set(), rt = theme();
  syncNativeHeatmaps(map, [rt], owned);
  assert.equal(mlHeatLayerId('quakes'), ID);
  assert.deepEqual(map.order(), ['basemap-fill', ID, 'deck-a', 'deck-b'], 'under the deck.gl layers, above the basemap');
  assert.deepEqual(map.calls.map(c => c[0]), ['addSource', 'addLayer']);
  const src = map.sources.get(ID).spec;
  assert.equal(src.type, 'geojson');
  assert.deepEqual(plain(src.data.features.map(f => [f.geometry.coordinates, f.properties.w])), [[[1, 2], 3], [[5, 6], 1.5], [[7, 8], 6]]);
  const layer = map.getLayer(ID).spec;
  assert.equal(layer.type, 'heatmap'); assert.equal(layer.source, ID);
  assert.deepEqual(plain(layer.paint['heatmap-weight']), ['interpolate', ['linear'], ['get', 'w'], 0, 0, 6, 1], 'the weight max is the largest weight');
  assert.deepEqual(Object.keys(layer.paint).sort(), ['heatmap-color', 'heatmap-intensity', 'heatmap-opacity', 'heatmap-radius', 'heatmap-weight']);
  assert.deepEqual([...owned], [ID]);
});

test('mlheatmap sync: with no deck.gl layer yet it goes on top; a theme of another type is left alone', () => {
  const map = fakeMap(['basemap-fill']);
  syncNativeHeatmaps(map, [theme(), theme({ name: 'dots', flags: new Set(['CHART', 'DOT']) })], new Set());
  assert.deepEqual(map.order(), ['basemap-fill', ID]);
  assert.equal(map.calls.find(c => c[0] === 'addLayer')[2], undefined);
  assert.equal(map.calls.filter(c => c[0] === 'addLayer').length, 1);
});

test('mlheatmap sync: a redraw with nothing changed touches the map not at all', () => {
  const map = fakeMap(['deck-a']), owned = new Set(), rt = theme();
  syncNativeHeatmaps(map, [rt], owned);
  const before = map.calls.length;
  for (let i = 0; i < 5; i++) syncNativeHeatmaps(map, [rt], owned);
  assert.equal(map.calls.length, before, 'no addSource / setData / setPaint / setLayout');
});

test('mlheatmap sync: new records reload the source in place; a changed style sets only the paint', () => {
  const map = fakeMap(['deck-a']), owned = new Set(), rt = theme();
  syncNativeHeatmaps(map, [rt], owned);
  map.calls.length = 0;
  rt._activeFeatures = [feat([1, 1], { n: '2' }), feat([2, 2], { n: '10' })];                       // a facet filter
  syncNativeHeatmaps(map, [rt], owned);
  assert.deepEqual(map.calls.filter(c => c[0] === 'setData' || c[0] === 'addSource' || c[0] === 'addLayer').map(c => c[0]), ['setData']);
  assert.equal(map.sources.get(ID).spec.data.features.length, 2);
  assert.deepEqual(plain(map.getLayer(ID).spec.paint['heatmap-weight']).slice(-2), [10, 1], 'the weight max follows the records');

  map.calls.length = 0;
  rt.style = { ...rt.style, fillopacity: 0.4 };
  syncNativeHeatmaps(map, [rt], owned);
  assert.ok(map.calls.some(c => c[0] === 'setPaint' && c[2] === 'heatmap-opacity'));
  assert.equal(map.getLayer(ID).spec.paint['heatmap-opacity'], 0.4);
  assert.equal(map.calls.filter(c => c[0] === 'setData' || c[0] === 'addSource' || c[0] === 'addLayer').length, 0, 'the points are not reloaded for a style change');
});

test('mlheatmap sync: a given weightmax wins and changing it re-paints the weight without reloading the points', () => {
  const map = fakeMap([]), owned = new Set(), rt = theme({ style: { colorscheme: ['#336699'], weightmax: 4 } });
  syncNativeHeatmaps(map, [rt], owned);
  assert.deepEqual(plain(map.getLayer(ID).spec.paint['heatmap-weight']).slice(-2), [4, 1]);
  map.calls.length = 0;
  rt.style = { ...rt.style, weightmax: 12 };
  syncNativeHeatmaps(map, [rt], owned);
  assert.deepEqual(plain(map.getLayer(ID).spec.paint['heatmap-weight']).slice(-2), [12, 1]);
  assert.equal(map.calls.filter(c => c[0] === 'setData').length, 0);
});

test('mlheatmap sync: hiding the theme hides the layer, showing it again shows it', () => {
  const map = fakeMap([]), owned = new Set(), rt = theme();
  syncNativeHeatmaps(map, [rt], owned);
  rt._hidden = true; syncNativeHeatmaps(map, [rt], owned);
  assert.equal(map.getLayoutProperty(ID, 'visibility'), 'none');
  rt._hidden = false; syncNativeHeatmaps(map, [rt], owned);
  assert.equal(map.getLayoutProperty(ID, 'visibility'), 'visible');
});

test('mlheatmap sync: a removed theme takes its layer and source with it; others stay', () => {
  const map = fakeMap(['deck-a']), owned = new Set(), a = theme(), b = theme({ name: 'other' });
  syncNativeHeatmaps(map, [a, b], owned);
  assert.deepEqual([...owned].sort(), ['ixmaps-mlheat:other', ID]);
  syncNativeHeatmaps(map, [b], owned);
  assert.deepEqual([...owned], ['ixmaps-mlheat:other']);
  assert.equal(map.getLayer(ID), undefined); assert.equal(map.getSource(ID), undefined);
  assert.ok(map.getLayer('ixmaps-mlheat:other') && map.getSource('ixmaps-mlheat:other'));
  syncNativeHeatmaps(map, [], owned);
  assert.equal(owned.size, 0);
  assert.deepEqual(map.order(), ['deck-a']);
});

test('mlheatmap sync: a new style (setMapType) drops layer and source — both come back, from the points already built', () => {
  const map = fakeMap(['deck-a']), owned = new Set(), rt = theme();
  syncNativeHeatmaps(map, [rt], owned);
  const data = map.sources.get(ID).spec.data;
  map.dropStyle(); map.layers.push({ id: 'deck-a', type: 'custom' });      // the overlay re-adds its layers
  map.calls.length = 0;
  syncNativeHeatmaps(map, [rt], owned);
  assert.deepEqual(map.order(), [ID, 'deck-a']);
  assert.deepEqual(map.calls.map(c => c[0]), ['addSource', 'addLayer']);
  assert.strictEqual(map.sources.get(ID).spec.data, data, 'the points were not computed again');
});

test('mlheatmap sync: a map that refuses (style not loaded) is reported once and tried again on the next sync', () => {
  const warns = [], oldWarn = win.console.warn;
  win.console.warn = (...a) => warns.push(a.join(' '));
  try {
    const map = fakeMap(['deck-a']), owned = new Set(), rt = theme();
    const realAdd = map.addSource; let refusing = true;
    map.addSource = (id, spec) => { if (refusing) throw new Error('Style is not done loading'); return realAdd(id, spec); };
    syncNativeHeatmaps(map, [rt], owned);
    syncNativeHeatmaps(map, [rt], owned);
    assert.equal(warns.filter(w => /MLHEATMAP not drawn/.test(w)).length, 1, 'reported once');
    assert.equal(map.getLayer(ID), undefined);
    refusing = false;
    syncNativeHeatmaps(map, [rt], owned);
    assert.ok(map.getLayer(ID) && map.getSource(ID), 'drawn once the map accepts it');
  } finally { win.console.warn = oldWarn; }
});

test('mlheatmap sync: no map, or a map without layers support, is no error', () => {
  assert.doesNotThrow(() => syncNativeHeatmaps(null, [theme()], new Set()));
  assert.doesNotThrow(() => syncNativeHeatmaps({}, [theme()], new Set()));
});
