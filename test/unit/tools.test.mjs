// The theme tools add-on (ixmaps-gl-tools.js): its pure helpers — which tune
// controls a theme type gets, the aggregation-width patch, and the rebuilt
// definition for a flag switch. The UI itself is checked live (tools.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' }, URL,
  document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } } };
win.window = win; win.globalThis = win;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ixmaps-gl.js'), 'utf8'), win, { filename: 'ixmaps-gl.js' });
const engineMap = win.ixmaps.Map;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ixmaps-gl-tools.js'), 'utf8'), win, { filename: 'ixmaps-gl-tools.js' });
const T = win.ixmaps.themeTools._internals;
// spread: arrays from the vm realm are not deepEqual to this realm's
const keys = words => [...T.controlsFor(words).map(c => c.key)];

test('the add-on wraps ixmaps.Map and adds ixmaps.themeTools and flat\'s popupTools', () => {
  assert.notEqual(win.ixmaps.Map, engineMap);
  assert.equal(typeof win.ixmaps.themeTools.tune, 'function');
  assert.equal(typeof win.ixmaps.popupTools, 'function');
});

test('controlsFor: a chart theme gets size, opacity, line width, shadow and the flag switches', () => {
  assert.deepEqual(keys('CHART|DOT|CATEGORICAL'), ['scale', 'fillopacity', 'linewidth', 'shadow', 'GLOW', 'VALUES', 'AGGREGATE']);
});

test('controlsFor: VALUES, GLOW and AGGREGATE add their own sliders', () => {
  const k = keys('CHART|SYMBOL|GLOW|AGGREGATE|SUM|VALUES');
  for (const key of ['valuescale', 'opacity', 'aggregation']) assert.ok(k.includes(key), key);
  assert.ok(!keys('CHART|SYMBOL').includes('valuescale'));
  // a flag is a whole word: AGGREGATEX is not AGGREGATE
  assert.ok(!keys('CHART|SYMBOL|AGGREGATEX').includes('aggregation'));
});

test('controlsFor: CHOROPLETH and FEATURE get opacity and line width only; others nothing', () => {
  assert.deepEqual(keys('CHOROPLETH|QUANTILE'), ['fillopacity', 'linewidth']);
  assert.deepEqual(keys('FEATURES|NOLEGEND'), ['fillopacity', 'linewidth']);
  assert.deepEqual(keys('WMS'), []);
});

test('controlsFor: every range minimum is above 0 (the engine reads 0 as "default")', () => {
  for (const c of T.controlsFor('CHART|SYMBOL|GLOW|AGGREGATE|VALUES')) if (c.min != null) assert.ok(c.min > 0, c.key);
});

test('currentValue: the style value, else the control default', () => {
  const ctl = T.controlsFor('CHART|DOT').find(c => c.key === 'scale');
  assert.equal(T.currentValue({ scale: '2.5' }, ctl), 2.5);
  assert.equal(T.currentValue({}, ctl), 1);
  assert.equal(T.currentValue({ scale: 0 }, ctl), 1);
});

test('scaleWidth keeps the unit and leaves field names alone', () => {
  assert.equal(T.scaleWidth('3px', 2), '6px');
  assert.equal(T.scaleWidth('500', 0.5), '250');
  assert.equal(T.scaleWidth(40, 1.5), 60);
  assert.equal(T.scaleWidth('PROCOM', 2), 'PROCOM');
});

test('aggregationPatch scales the widths of an aggregation bracket array, not its scales', () => {
  const p = T.aggregationPatch({ aggregation: ['1:1', '3px', '1:500000', '1px'] }, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(p)), { aggregation: ['1:1', '6px', '1:500000', '2px'] });
});

test('aggregationPatch scales gridwidth / gridwidthpx from the ORIGINAL, and starts at 30px without a grid', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(T.aggregationPatch({ gridwidth: '40px' }, 0.5))), { gridwidth: '20px' });
  assert.deepEqual(JSON.parse(JSON.stringify(T.aggregationPatch({ gridwidth: 1000 }, 2))), { gridwidth: 2000 });
  assert.deepEqual(JSON.parse(JSON.stringify(T.aggregationPatch({ gridwidthpx: 50 }, 2))), { gridwidthpx: 100 });
  assert.deepEqual(JSON.parse(JSON.stringify(T.aggregationPatch({}, 1))), { gridwidth: '30px' });
});

test('patchedDefinition switches a flag and keeps the tuned style', () => {
  const def = { layer: 'L', data: { obj: {} }, binding: { position: 'geometry', value: 'v' }, style: { type: 'CHART|SYMBOL|GLOW', scale: 1 }, meta: { name: 't' } };
  const off = T.patchedDefinition(def, { scale: 2 }, { GLOW: false });
  assert.equal(off.style.type, 'CHART|SYMBOL');
  assert.equal(off.style.scale, 2);
  assert.equal(off.binding, def.binding, 'binding, data and meta are the definition\'s own');
  assert.equal(def.style.type, 'CHART|SYMBOL|GLOW', 'the original definition is not changed');
  const on = T.patchedDefinition(def, null, { VALUES: true });
  assert.equal(on.style.type, 'CHART|SYMBOL|GLOW|VALUES');
});

test('patchedDefinition: switching AGGREGATE on gives a theme without a grid one of 30px', () => {
  const def = { layer: 'L', style: { type: 'CHART|SYMBOL' } };
  assert.equal(T.patchedDefinition(def, null, { AGGREGATE: true }).style.gridwidth, '30px');
  const withGrid = { layer: 'L', style: { type: 'CHART|SYMBOL', aggregation: ['1:1', '5px'] } };
  assert.equal(T.patchedDefinition(withGrid, null, { AGGREGATE: true }).style.gridwidth, undefined);
});

test('patchedDefinition takes the type string when style.type is missing', () => {
  assert.equal(T.patchedDefinition({ style: {} }, null, { GLOW: true }, 'CHART|DOT').style.type, 'CHART|DOT|GLOW');
});

test('toEditable: inline data and functions become "<kept: …>" strings, the rest is plain JSON', () => {
  const fc = { type: 'FeatureCollection', features: Array.from({ length: 120 }, (_, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [9, 45] } })) };
  const fn = () => 1;
  const def = { meta: { name: 't' }, style: { scale: 2, type: 'CHART|DOT' }, layer: 'L', data: { obj: fc, type: 'geojson' }, binding: { value: 'v' }, ext: fn };
  const { text, kept } = T.toEditable(def);
  const j = JSON.parse(text);
  assert.deepEqual(Object.keys(j), ['layer', 'data', 'binding', 'style', 'meta', 'ext'], 'the usual order');
  assert.deepEqual(Object.keys(j.style), ['type', 'scale'], 'the type first');
  assert.equal(j.data.type, 'geojson', 'small data options stay');
  assert.match(j.data.obj, /^<kept: data\.obj .* 120 features>$/);
  assert.match(j.ext, /^<kept: ext .* function>$/);
  assert.equal(kept.size, 2);
});

test('toEditable: a large value outside data stays editable', () => {
  const values = Array.from({ length: 400 }, (_, i) => 'v' + i);
  const j = JSON.parse(T.toEditable({ style: { type: 'CHART|DOT', values } }).text);
  assert.equal(j.style.values.length, 400);
});

test('fromEditable puts the kept values back, also after the text was edited around them', () => {
  const obj = { type: 'FeatureCollection', features: Array.from({ length: 50 }, () => ({ type: 'Feature', properties: { a: 'x'.repeat(30) }, geometry: null })) };
  const def = { layer: 'L', data: { obj, type: 'geojson' }, style: { type: 'CHART|DOT', scale: 1 } };
  const { text, kept } = T.toEditable(def);
  const r = T.fromEditable(text.replace('"scale": 1', '"scale": 3'), kept);
  assert.equal(r.error, undefined);
  assert.equal(r.def.data.obj, obj, 'the same object, not a copy');
  assert.equal(r.def.style.scale, 3);
});

test('fromEditable: a JSON syntax error gives its message and position; a definition without a type is refused', () => {
  const bad = T.fromEditable('{ "style": { "type": "CHART" }, }', new Map());
  assert.ok(bad.error);
  assert.equal(typeof bad.pos, 'number');
  assert.match(T.fromEditable('[]', new Map()).error, /object/);
  assert.match(T.fromEditable('{"layer":"L"}', new Map()).error, /style/);
  assert.match(T.fromEditable('{"style":{"type":""}}', new Map()).error, /style\.type/);
});

test('the add-on adds flat\'s popupThemeEditor and themeTools.edit', () => {
  assert.equal(typeof win.ixmaps.popupThemeEditor, 'function');
  assert.equal(typeof win.ixmaps.themeTools.edit, 'function');
});

test('typeParts splits the kind from the flags, joinType puts them back', () => {
  const p = T.typeParts('CHART|SYMBOL|GLOW|AGGREGATE|SUM');
  assert.equal(p.base, 'CHART|SYMBOL');
  assert.deepEqual([...p.flags], ['GLOW', 'AGGREGATE', 'SUM']);
  assert.equal(T.joinType('CHART|PIE', [...p.flags]), 'CHART|PIE|GLOW|AGGREGATE|SUM');
  assert.equal(T.typeParts('CHOROPLETH|QUANTILE').base, 'CHOROPLETH');
});

test('parseValue keeps the type of the value it replaces, and an empty input removes the key', () => {
  assert.deepEqual({ ...T.parseValue('num', '2,5', 1) }, { value: 2.5 });
  assert.deepEqual({ ...T.parseValue('num', '2', '1') }, { value: '2' }, 'a string stays a string (flat style)');
  assert.ok(T.parseValue('num', 'abc', 1).error);
  assert.deepEqual({ ...T.parseValue('text', '  ', 'x') }, { remove: true });
  assert.deepEqual([...T.parseValue('colors', '#fff, #f00', []).value], ['#fff', '#f00']);
  assert.deepEqual([...T.parseValue('list', '1, 2', [3, 4]).value], [1, 2], 'a list of numbers stays numbers');
  assert.deepEqual([...T.parseValue('list', '1, 2', ['3']).value], ['1', '2']);
  assert.deepEqual({ ...T.parseValue('check', '', true) }, { remove: true });
  assert.equal(T.parseValue('json', '{"a":1}', null).value.a, 1);
  assert.ok(T.parseValue('json', '{a:1}', null).error);
});

test('formatValue and guessKind', () => {
  assert.equal(T.formatValue('list', ['1:1', '3px']), '1:1, 3px');
  assert.equal(T.formatValue('check', 'true'), true);
  assert.equal(T.formatValue('json', { a: 1 }), '{"a":1}');
  assert.equal(T.guessKind(true), 'check');
  assert.equal(T.guessKind(3), 'num');
  assert.equal(T.guessKind(['a', 2]), 'list');
  assert.equal(T.guessKind([{ a: 1 }]), 'json');
  assert.equal(T.guessKind('x'), 'text');
});

test('fieldNamesOf lists the fields of the first records', () => {
  assert.deepEqual([...T.fieldNamesOf([{ properties: { a: 1, b: 2 } }, { properties: { c: 3 } }, {}])], ['a', 'b', 'c']);
});

test('registryKeys: the registry\'s keys, the ones ixmaps-gl draws first, gl extensions added, internals left out', () => {
  const g = { styleKeys: { b: { gl: { status: 'missing' } }, a: { gl: { status: 'impl' } }, json: { gl: { status: 'impl' } } },
    glExtensions: { styleKeys: { radiuspx: 'heatmap radius' } }, glInternal: { styleKeys: ['json'] } };
  const r = T.registryKeys(g, 'style').map(e => e.key + (e.gl ? '' : '-'));
  assert.deepEqual([...r], ['a', 'radiuspx', 'b-']);
  assert.deepEqual([...T.registryKeys(null, 'style')], []);
});

test('configModel copies the sections, so the configurator never changes the theme\'s own definition', () => {
  const def = { layer: 'L', style: { type: 'CHART|DOT' }, binding: { value: 'v' } };
  const m = T.configModel(def);
  m.style.scale = 2; m.binding.value = 'w';
  assert.equal(def.style.scale, undefined);
  assert.equal(def.binding.value, 'v');
  assert.deepEqual({ ...m.meta }, {});
});

test('the add-on adds flat\'s popupThemeConfigurator and themeTools.config', () => {
  assert.equal(typeof win.ixmaps.popupThemeConfigurator, 'function');
  assert.equal(typeof win.ixmaps.themeTools.config, 'function');
});

test('themeTools.attach ignores what is not a built map', () => {
  assert.equal(win.ixmaps.themeTools.attach(null), false);
  assert.equal(win.ixmaps.themeTools.attach({}), false);
});

test('a page that loads the add-on itself: themetools: false still leaves that map without the tool bar', () => {
  // the add-on's ixmaps.Map wrapper over a stand-in engine whose Map records who attaches
  const attached = [];
  const built = { then(f) { attached.push(f); return built; } };
  const ctx = { console: win.console, location: win.location, document: win.document, ixmaps: { Map: () => built } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ixmaps-gl-tools.js'), 'utf8'), ctx, { filename: 'ixmaps-gl-tools.js' });
  ctx.ixmaps.Map('m', { themetools: false });
  ctx.ixmaps.Map('m', { themetools: 'false' });
  assert.equal(attached.length, 0);
  ctx.ixmaps.Map('m', {});
  ctx.ixmaps.Map('m', { themetools: true });
  assert.equal(attached.length, 2);
});

// ---- the config dialog's Visual tab (the Smart Data Loader's visualizations)
const plain = x => JSON.parse(JSON.stringify(x));
const feats = Array.from({ length: 20 }, (_, i) => ({ properties: { v: i + 1, cat: i % 3 ? 'a' : 'b', name: 'p' + i } }));
const vdata = { isNumeric: f => f === 'v', categories: f => T.categoriesOf(feats, f), normValue: f => T.normValueOf(feats, f), sweep: win.__ixmapsGlInternals.flatColorSweep };

test('readVisual names the visualization of a theme as the loader builds it', () => {
  const viz = (type, style = {}) => T.readVisual({ style: Object.assign({ type }, style) }).viz;
  assert.equal(viz('CHART|SYMBOL|SIZE|AGGREGATE|SUM|SHOW'), 'bubble');
  assert.equal(viz('CHART|DOT|SHOW'), 'dot');
  assert.equal(viz('CHART|SYMBOL|GRIDSIZE|AGGREGATE|SUM|DOPACITY', { symbols: ['hexagon'] }), 'hexbin');
  assert.equal(viz('CHART|BUBBLE|SIZE|AGGREGATE|AUTOSIZE|RELOCATE|SUM'), 'hexbin_sized');
  assert.equal(viz('HEATMAP|SHOW'), 'heatmap');
  assert.equal(viz('MLHEATMAP'), 'mlheatmap');
  assert.equal(viz('KDE'), 'kde');
  assert.equal(viz('CHOROPLETH|QUANTILE'), 'choropleth');
  assert.equal(viz('FEATURE|NOLEGEND'), 'feature');
  assert.equal(viz('CHART|PIE|SIZE'), 'custom');
});

test('writeVisual: bubble → hexbin writes the loader\'s type, keeps other flags, data and position, drops bubble keys', () => {
  const data = { obj: {} };
  const def = { layer: 'L', data, binding: { position: 'geometry', value: 'v' }, style: { type: 'CHART|SYMBOL|SIZE|AGGREGATE|SUM|GLOW|VALUES', normalsizevalue: '30', colorscheme: ['#fecc5c', '#bd0026'] } };
  const out = T.writeVisual(def, { viz: 'hexbin' }, vdata);
  assert.equal(out.style.type, 'CHART|SYMBOL|GRIDSIZE|AGGREGATE|SUM|DOPACITY|GLOW|VALUES');
  assert.deepEqual(plain(out.style.symbols), ['hexagon']);
  assert.equal(out.style.gridwidthpx, 15);
  assert.equal(out.style.normalsizevalue, undefined);
  assert.deepEqual(plain(out.style.colorscheme), ['#bd0026'], 'a hexbin of a number: the strongest color');
  assert.equal(out.data, data);
  assert.equal(out.binding.position, 'geometry');
  assert.equal(def.style.type, 'CHART|SYMBOL|SIZE|AGGREGATE|SUM|GLOW|VALUES', 'the definition itself is not changed');
});

test('writeVisual keeps a grid the theme already has, and the theme\'s MEAN instead of SUM', () => {
  const def = { binding: { value: 'v', size: 'v' }, style: { type: 'CHART|SYMBOL|AGGREGATE|MEAN', gridwidth: '40px' } };
  const out = T.writeVisual(def, { viz: 'hexbin_sized' }, vdata);
  assert.equal(out.style.gridwidthpx, undefined);
  assert.equal(out.style.gridwidth, '40px');
  assert.equal(out.style.type, 'CHART|BUBBLE|SIZE|AGGREGATE|AUTOSIZE|RELOCATE|MEAN');
});

test('writeVisual: a text value field makes the theme CATEGORICAL, with its values and one color per value', () => {
  const def = { binding: { value: 'v' }, style: { type: 'CHART|SYMBOL|AGGREGATE', colorscheme: ['#111111', '#222222'] } };
  const out = T.writeVisual(def, { value: 'cat' }, vdata);
  assert.match(out.style.type, /CATEGORICAL/);
  assert.deepEqual(plain(out.style.values), ['b', 'a']);
  assert.deepEqual(plain(out.style.colorscheme), ['#111111', '#222222']);
  assert.equal(out.binding.size, '$item$', 'a text value is sized by the record count');
  const back = T.writeVisual(out, { value: 'v' }, vdata);
  assert.doesNotMatch(back.style.type, /CATEGORICAL/);
  assert.equal(back.style.values, undefined);
});

test('writeVisual: bubble sizes get normalsizevalue from the data, dots drop the size binding', () => {
  const b = T.writeVisual({ binding: { value: 'v' }, style: { type: 'CHART|DOT' } }, { viz: 'bubble' }, vdata);
  assert.equal(b.style.normalsizevalue, '20');
  assert.equal(b.binding.size, 'v');
  assert.match(b.style.type, /^CHART\|SYMBOL\|SIZE\|AGGREGATE\|SUM/);
  const d = T.writeVisual(b, { viz: 'dot' }, vdata);
  assert.equal(d.style.type, 'CHART|DOT');
  assert.equal(d.binding.size, undefined);
});

test('writeVisual on a choropleth only switches the classing by the field type', () => {
  const def = { binding: { lookup: 'id', value: 'v' }, style: { type: 'CHOROPLETH|QUANTILE' } };
  const cat = T.writeVisual(def, { value: 'cat' }, vdata);
  assert.equal(cat.style.type, 'CHOROPLETH|QUANTILE|CATEGORICAL');
  const pie = { binding: { value: 'v' }, style: { type: 'CHART|PIE' } };
  assert.equal(T.writeVisual(pie, { value: 'v' }, vdata).style.type, 'CHART|PIE', 'a custom chart type stays when only its field changes');
  assert.match(T.writeVisual(pie, { viz: 'bubble' }, vdata).style.type, /^CHART\|SYMBOL\|SIZE/, 'picking a visualization converts it');
});

test('withPalette: the theme\'s class count for a number, one color per category, a flat gradient in the engine\'s form', () => {
  const num = T.withPalette({ style: { type: 'CHART|SYMBOL', colorscheme: ['#a', '#b', '#c'].map(c => c + '00000') } }, 'red,blue,,warm', vdata.sweep);
  assert.deepEqual(plain(num.style.colorscheme), ['3', 'red', 'blue', '', 'warm']);
  const list = T.withPalette({ style: { type: 'CHART|SYMBOL', colorscheme: ['#000'] } }, '#1,#2'.replace(/#(\d)/g, '#00000$1'), vdata.sweep);
  assert.deepEqual(plain(list.style.colorscheme), ['#000001', '#000002']);
  const cat = T.withPalette({ style: { type: 'CHART|SYMBOL|CATEGORICAL', values: ['a', 'b', 'c'] } }, '#000001,#000002', vdata.sweep);
  assert.deepEqual(plain(cat.style.colorscheme), ['#000001', '#000002', '#000001']);
  assert.equal(T.paletteColors('#eeffee,#00cc00,dynamic,cold', 5, vdata.sweep).length, 5, 'a flat gradient is swept by the engine');
});

test('fieldInfoOf tells number fields from text fields', () => {
  assert.deepEqual(plain(T.fieldInfoOf(feats)), [{ name: 'v', numeric: true }, { name: 'cat', numeric: false }, { name: 'name', numeric: false }]);
});

test('writeVisual: a hexbin takes its own grid — the theme\'s aggregation brackets wait in the stash and come back', () => {
  const stash = {};
  const def = { binding: { value: 'v' }, style: { type: 'CHART|SYMBOL|AGGREGATE|SUM', aggregation: ['1:1', '3px', '1:500000', '1px'] } };
  const hx = T.writeVisual(def, { viz: 'hexbin' }, vdata, stash);
  assert.equal(hx.style.aggregation, undefined);
  assert.equal(hx.style.gridwidthpx, 15);
  const bb = T.writeVisual(hx, { viz: 'bubble' }, vdata, stash);
  assert.deepEqual(plain(bb.style.aggregation), ['1:1', '3px', '1:500000', '1px']);
  assert.equal(bb.style.gridwidthpx, undefined);
});

test('writeVisual: a density surface with fewer than three colors gets the loader\'s ramp', () => {
  const ml = T.writeVisual({ binding: { value: 'v' }, style: { type: 'CHART|SYMBOL', colorscheme: ['#bd0026'] } }, { viz: 'mlheatmap' }, vdata);
  assert.equal(ml.style.colorscheme.length, 5);
  const kde = T.writeVisual({ binding: { value: 'v' }, style: { type: 'CHART|SYMBOL', colorscheme: ['#111111', '#222222', '#333333'] } }, { viz: 'kde' }, vdata);
  assert.deepEqual(plain(kde.style.colorscheme), ['#111111', '#222222', '#333333'], 'a ramp of its own stays');
});

// ---- save map

test('jsLiteral: plain values as JavaScript, functions as their source, short parts on one line', () => {
  assert.equal(T.jsLiteral({ a: 1, 'b-c': 'x', d: [1, 2] }, true).src, '{ a: 1, "b-c": "x", d: [1, 2] }');
  assert.equal(T.jsLiteral({ a: undefined, b: null }, false).src, '{b:null}');
  const f = T.jsLiteral({ process: function (d) { return d; } }, false);
  assert.equal(f.functions, 1);
  assert.ok(f.src.includes('function (d) { return d; }'));
  const long = T.jsLiteral({ colorscheme: Array.from({ length: 12 }, (_, i) => '#00000' + (i % 10)) }, true, '');
  assert.ok(long.src.includes('\n  colorscheme: '), 'a part longer than a line is indented');
});

test('jsLiteral: a cycle or a class instance is an error, not a broken page', () => {
  const o = {}; o.self = o;
  assert.match(T.jsLiteral(o, false).error, /cyclic/);
  assert.match(T.jsLiteral({ m: new Map() }, false).error, /Map/);
});

test('themeCode: the theme as ixmaps.layer(name, l => l.data().binding().type().style().meta())', () => {
  const t = T.themeCode({ layer: 'pts', data: { url: 'data/p.csv', type: 'csv' }, binding: { geo: 'lat|lon', value: 'v' },
    style: { type: 'CHART|BUBBLE|SIZE', colorscheme: ['#f00'], name: 'b' }, meta: { title: 'Points' } }, 'https://ex.org/maps/page.html');
  assert.equal(t.skipped, undefined);
  assert.ok(t.code.startsWith('ixmaps.layer("pts", l => l\n'));
  assert.ok(t.code.includes('.data({ url: "https://ex.org/maps/data/p.csv", type: "csv" })'), 'a relative url is made absolute');
  assert.ok(t.code.includes('.type("CHART|BUBBLE|SIZE")'));
  assert.ok(t.code.includes('.style({ colorscheme: ["#f00"], name: "b" })'), 'the type is not repeated in style');
  const order = ['.data(', '.binding(', '.type(', '.style(', '.meta('].map(s => t.code.indexOf(s));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.deepEqual([...t.warnings], []);
});

test('themeCode: inline data is embedded up to the limit; larger or unserializable data leaves the theme out', () => {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { v: 1 }, geometry: { type: 'Point', coordinates: [9, 45] } }] };
  const ok = T.themeCode({ layer: 'a', data: { obj: fc, type: 'geojson' }, style: { type: 'CHART|DOT' } }, '');
  assert.ok(ok.code.includes('"Feature"'));
  const big = { type: 'FeatureCollection', features: [{ properties: { s: 'x'.repeat(2100000) } }] };
  assert.match(T.themeCode({ layer: 'b', data: { obj: big }, style: { type: 'CHART|DOT' } }, '').skipped, /MB/);
  assert.match(T.themeCode({ layer: 'c', data: { obj: new Map() }, style: { type: 'CHART|DOT' } }, '').skipped, /Map/);
});

test('themeCode: functions and data processing are kept, with a warning', () => {
  const t = T.themeCode({ layer: 'a', data: { url: 'https://x/a.csv', process: 'function(d){return d}' },
    style: { type: 'CHART|DOT' }, meta: { onclick: function () {} } }, '');
  assert.equal(t.warnings.length, 2);
  assert.ok(t.code.includes('onclick: function () {}'));
});

test('pageHtml: the engine from the CDN, the map options, the view, the themes in order, globe and bearing', () => {
  const themes = [T.themeCode({ layer: 'one', style: { type: 'FEATURE' } }, ''), { skipped: 'too big', label: 'Two', warnings: [] },
    T.themeCode({ layer: 'three', style: { type: 'CHART|DOT' } }, '')];
  const html = T.pageHtml({ title: 'A & B', engineUrl: 'https://cdn.jsdelivr.net/npm/ixmaps-gl@0.2.39/ixmaps-gl.js',
    map: { mapType: 'VT_TONER_LITE', legend: 'closed' }, options: { basemapopacity: 0.5 }, center: { lat: 45.1234567, lng: 9.7654321 },
    zoom: 8.12345, bearing: 30, pitch: 0, globe: true, attribution: 'Data: X', themes, notes: ['a note'], saved: '2026-11-08' });
  assert.ok(html.includes('<title>A &amp; B</title>'));
  assert.ok(html.includes('<script src="https://cdn.jsdelivr.net/npm/ixmaps-gl@0.2.39/ixmaps-gl.js"></script>'));
  assert.ok(html.includes('ixmaps.Map("map", { mapType: "VT_TONER_LITE", legend: "closed" }, map => map'));
  assert.ok(html.includes('.view([45.123457, 9.765432], 8.123)'));
  assert.ok(html.includes('.options({ basemapopacity: 0.5 })'));
  assert.ok(html.includes('.attribution("Data: X")'));
  assert.ok(html.indexOf('"one"') < html.indexOf('left out: "Two"') && html.indexOf('left out: "Two"') < html.indexOf('"three"'));
  assert.ok(html.includes('api.setProjection("globe");'));
  assert.ok(html.includes('api.map.jumpTo({ bearing: 30, pitch: 0 });'));
  assert.ok(html.includes('// a note'));
});

test('pageHtml: nothing in a theme can end the page\'s script', () => {
  const themes = [T.themeCode({ layer: 'x', style: { type: 'CHART|DOT' }, meta: { tooltip: '</script><script>alert(1)</script><!--' } }, '')];
  const html = T.pageHtml({ title: 't', engineUrl: 'e.js', map: {}, options: {}, center: { lat: 0, lng: 0 }, zoom: 2, bearing: 0, pitch: 0, themes });
  assert.equal((html.match(/<\/script>/gi) || []).length, 2, 'the engine tag and the page script only');
  assert.ok(!html.includes('<!--'));
  assert.ok(!html.includes('.then('), 'no projection or bearing: no then()');
});

test('htmlFileName: a file name from the title', () => {
  assert.equal(T.htmlFileName('Injured (AREU 2019–2023)'), 'injured_areu_2019_2023.html');
  assert.equal(T.htmlFileName('Città più'), 'citta_piu.html');
  assert.equal(T.htmlFileName(''), 'map.html');
});
