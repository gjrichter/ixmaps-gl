// Unit tests for normalizeTheme / LayerBuilder.definition — pure functions,
// run against the real ixmaps-gl.js loaded into a Node vm (no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');

function loadEngine() {
  const logs = [];
  const win = {
    console: { info: (...a) => logs.push(['info', a.join(' ')]), warn: (...a) => logs.push(['warn', a.join(' ')]), log() {}, error() {} },
    location: { search: '' },
    document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } },
  };
  win.window = win; win.globalThis = win;
  vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
  return { ...win.__ixmapsGlInternals, ixmaps: win.ixmaps, logs };
}

// objects from the vm have a different prototype chain — compare as JSON
const plain = v => JSON.parse(JSON.stringify(v));
const setOf = s => [...s].sort();

test('definition() has real ixmaps-flat\'s shape: type/filter/title inside style', () => {
  const { ixmaps } = loadEngine();
  const def = ixmaps.layer('plants')
    .data({ url: 'p.csv', type: 'csv' })
    .binding({ geo: 'lat|lon', value: 'mw' })
    .type('CHART|BUBBLE|SIZE')
    .style({ colorscheme: ['#f00'], scale: 1.5 })
    .meta({ tooltip: '{{name}}' })
    .filter('WHERE "fuel" == "Solar"')
    .title('Power plants')
    .definition();
  assert.deepEqual(plain(def), {
    layer: 'plants',
    data: { url: 'p.csv', type: 'csv' },
    binding: { geo: 'lat|lon', value: 'mw' },
    style: { colorscheme: ['#f00'], scale: 1.5, type: 'CHART|BUBBLE|SIZE', filter: 'WHERE "fuel" == "Solar"', title: 'Power plants' },
    meta: { tooltip: '{{name}}' },
  });
});

test('.style() and .meta() merge across calls like flat\'s themeConstruct; type survives a later .style()', () => {
  const { ixmaps } = loadEngine();
  const def = ixmaps.layer('x').type('DOT').style({ a: 1 }).style({ b: 2 }).meta({ m: 1 }).meta({ n: 2 }).definition();
  assert.deepEqual(plain(def.style), { a: 1, b: 2, type: 'DOT' });
  assert.deepEqual(plain(def.meta), { m: 1, n: 2 });
});

test('type string → flag set; BUBBLE implies SYMBOL', () => {
  const { normalizeTheme } = loadEngine();
  const spec = normalizeTheme({ layer: 'x', style: { type: 'CHART|BUBBLE|VALUES' } });
  assert.deepEqual(setOf(spec.flags), ['BUBBLE', 'CHART', 'SYMBOL', 'VALUES']);
  assert.equal(spec.typeStr, 'CHART|BUBBLE|VALUES');
  assert.deepEqual(setOf(normalizeTheme({ layer: 'x', style: { type: 'CHART|SYMBOL' } }).flags), ['CHART', 'SYMBOL']);
});

test('no type → empty flag set (no renderer), as before', () => {
  const { normalizeTheme } = loadEngine();
  const spec = normalizeTheme({ layer: 'x' });
  assert.equal(spec.flags.size, 0);
  assert.equal(spec.typeStr, '');
  assert.deepEqual(plain(spec.binding), {});
  assert.deepEqual(plain(spec.style), {});
  assert.deepEqual(plain(spec.meta), {});
});

test('binding.geo → binding.position (flat\'s lookupfield: the last spelling wins — here position)', () => {
  const { normalizeTheme } = loadEngine();
  assert.equal(normalizeTheme({ layer: 'x', binding: { geo: 'lat|lon' } }).binding.position, 'lat|lon');
  assert.equal(normalizeTheme({ layer: 'x', binding: { geo: 'a|b', position: 'c|d' } }).binding.position, 'c|d');
  assert.equal(normalizeTheme({ layer: 'x', binding: { lookup: 'code' } }).binding.position, undefined);
});

test('style.title → meta.title fallback; an explicit meta.title wins', () => {
  const { normalizeTheme } = loadEngine();
  assert.equal(normalizeTheme({ layer: 'x', style: { title: 'T' } }).meta.title, 'T');
  assert.equal(normalizeTheme({ layer: 'x', style: { title: 'T' }, meta: { title: 'M' } }).meta.title, 'M');
});

test('type/filter/title are taken out of style; filter is returned separately', () => {
  const { normalizeTheme } = loadEngine();
  const spec = normalizeTheme({ layer: 'x', style: { type: 'DOT', filter: 'WHERE a == 1', title: 'T', scale: 2 } });
  assert.deepEqual(plain(spec.style), { scale: 2 });
  assert.equal(spec.filter, 'WHERE a == 1');
  assert.equal(spec.name, 'x');
});

test('pure: the page\'s own binding/style/meta objects are never mutated', () => {
  const { normalizeTheme } = loadEngine();
  const def = { layer: 'x', data: { url: 'u' }, binding: { geo: 'a|b' }, style: { type: 'CHART|BUBBLE', title: 'T' }, meta: {} };
  const before = JSON.stringify(def);
  const spec = normalizeTheme(def);
  assert.equal(JSON.stringify(def), before);
  assert.notEqual(spec.binding, def.binding);
  assert.notEqual(spec.style, def.style);
  assert.notEqual(spec.meta, def.meta);
  assert.equal(spec.data, def.data, 'data is passed through (it may be a large inline table)');
});

test('an inert flag logs its "no rendering behavior" note once', () => {
  const { normalizeTheme, logs } = loadEngine();
  normalizeTheme({ layer: 'a', style: { type: 'CHART|BUBBLE|SORT' } });
  normalizeTheme({ layer: 'b', style: { type: 'CHART|BUBBLE|SORT' } });
  assert.equal(logs.filter(([lvl, m]) => lvl === 'info' && m.includes('"SORT"')).length, 1);
});

test('the builder path end to end: definition() → normalizeTheme', () => {
  const { ixmaps, normalizeTheme } = loadEngine();
  const spec = normalizeTheme(ixmaps.layer('p').binding({ geo: 'lat|lon' }).type('CHART|BUBBLE').title('P').definition());
  assert.equal(spec.binding.position, 'lat|lon');
  assert.ok(spec.flags.has('SYMBOL'));
  assert.equal(spec.meta.title, 'P');
  assert.deepEqual(plain(spec.style), {});
});

test('value typing: numeric strings of the number style keys become numbers, once, in normalizeTheme', () => {
  const { normalizeTheme } = loadEngine();
  const spec = normalizeTheme({ layer: 'x', style: {
    type: 'CHOROPLETH', fillopacity: '0.8', classes: ' 5 ', scale: 1.5, linewidth: ['2', '0.5'],
    gridwidthpx: '', gridwidth: '12px', valuedecimals: 'two', colorscheme: ['#ff0000', '#0000ff'],
  } });
  assert.deepEqual(plain(spec.style), {
    fillopacity: 0.8, classes: 5, scale: 1.5, linewidth: [2, 0.5],
    gridwidthpx: '', gridwidth: '12px', valuedecimals: 'two', colorscheme: ['#ff0000', '#0000ff'],
  }, 'empty and non-numeric strings stay as given; gridwidth ("12px") and non-number keys untouched');
  assert.equal(normalizeTheme({ layer: 'x', style: { fillopacity: 'auto' } }).style.fillopacity, 'auto', 'flat\'s "auto" keeps its meaning');
  assert.equal(normalizeTheme({ layer: 'x', meta: { scale: '2' } }).style.scale, 2, 'a style key given in .meta() is typed too');
});

test('value typing: the page\'s own linewidth list is not mutated', () => {
  const { normalizeTheme } = loadEngine();
  const lw = ['2', '3'];
  normalizeTheme({ layer: 'x', style: { linewidth: lw } });
  assert.deepEqual(lw, ['2', '3']);
});

test('value typing: runtime patches (setStyle — legend sliders, setThemeStyle) are typed the same way', () => {
  const { LayerRuntime } = loadEngine();
  const rt = { style: { scale: 1, fillopacity: 0.5 } };
  const patch = { scale: '1.25', filter: 'WHERE "a" == "1"' };
  LayerRuntime.prototype.setStyle.call(rt, patch);
  assert.deepEqual(plain(rt.style), { scale: 1.25, fillopacity: 0.5, filter: 'WHERE "a" == "1"' });
  assert.equal(patch.scale, '1.25', 'the caller\'s patch object is not mutated');
});

test('styleNum: the number, a list\'s first number, else NaN (as parseFloat gave for missing values)', () => {
  const { styleNum } = loadEngine();
  assert.equal(styleNum(0.8), 0.8);
  assert.equal(styleNum([2, 0.5]), 2);
  assert.ok(Number.isNaN(styleNum(undefined)));
  assert.ok(Number.isNaN(styleNum('auto')));
  assert.ok(Number.isNaN(styleNum('')));
  assert.equal(styleNum(undefined) || 1, 1, '`|| default` keeps working');
});

// resolveBasemapStyleUrl: a flat mapType NAME picks gl's dark or light
// keyless basemap; a COLOR mapType stays a plain background (resolveMapTypeColor)
test('basemap names: dark/black/night/matter -> Dark Matter, anything else -> Positron; colors stay colors', () => {
  const { resolveBasemapStyleUrl: url, resolveMapTypeColor: color } = loadEngine();
  for (const n of ['VT_DATAVIZ_DARK', 'CartoDB - Dark matter', 'VT_TONER_DARK', 'black_night']) assert.match(url(n), /dark-matter/, n);
  for (const n of ['VT_TONER_LITE', 'CartoDB - Positron', 'VT_BRIGHT_LIGHT', undefined, '']) assert.match(url(n), /positron/, String(n));
  assert.equal(color('dark'), '#1a1a1a'); // the bare word stays the #1a1a1a background it always was
  assert.equal(color('#0b1020'), '#0b1020');
  assert.equal(color('VT_DATAVIZ_DARK'), null);
});
