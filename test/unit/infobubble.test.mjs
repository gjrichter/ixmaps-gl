// INFOBUBBLE: the permanent info-card type flag — flag parsing, the base
// type's dispatch (dot + recorded items, |NOICON cards only), the item
// recording with .style({bubblemax}), the card template preference
// (meta.infobubble > meta.tooltip), and the offset/key helpers
// createInfoBubbles uses to place the DOM cards.
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
// arrays/objects built inside the vm realm fail deepStrictEqual's prototype
// check — round-trip them like the other unit tests do
const plain = v => JSON.parse(JSON.stringify(v));

// a minimal Mustache stand-in: the engine only needs render + the identity
// escape it installs itself; {{a.b}} paths are enough for these assertions
win.Mustache = {
  escape: t => t,
  render: (tpl, data) => tpl.replace(/\{\{#?([\w.]+)\}?\}/g, (m, k) => {
    const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), data);
    return v == null ? '' : String(v);
  })
};

// deck.gl layer stand-ins: buildDeckLayers constructs layers by class
class FakeLayer {
  constructor(props) { this.props = props; this.id = props.id; }
  clone(p) { return new FakeLayer(Object.assign({}, this.props, p)); }
}
G.setDeckLayerClassesForTests({ ScatterplotLayer: FakeLayer, IconLayer: FakeLayer, TextLayer: FakeLayer });

const pt = (props, lng, lat) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lng, lat] } });
const poly = (props, ring) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
const square = [[10, 44], [12, 44], [12, 46], [10, 46], [10, 44]];
const BBOX = [-180, -85, 180, 85];

const comuni = {
  type: 'FeatureCollection',
  features: [
    pt({ comune: 'Amatrice', profilo: 'A', bisogno: 'presenze < anagrafe', priorita: 'presidi sanitari' }, 13.29, 42.63),
    pt({ comune: 'Accumoli', profilo: 'A', bisogno: 'nessuna scuola', priorita: 'servizi minimi' }, 13.23, 42.69),
    pt({ comune: 'Norcia', profilo: 'C', bisogno: 'turismo', priorita: 'diversificare' }, 12.94, 42.79)
  ]
};
const rtOf = (type, extraStyle, meta) => new G.LayerRuntime(G.normalizeTheme({
  layer: 'comuni',
  binding: { position: 'geometry', value: 'profilo', title: 'comune' },
  style: Object.assign({ type, colorscheme: ['#c0392b', '#e67e22', '#27ae60'] }, extraStyle),
  meta
}), comuni, {});

test('INFOBUBBLE / NOICON survive normalizeTheme as type flags (not inert, not stripped)', () => {
  const f1 = G.normalizeTheme({ layer: 'x', style: { type: 'CHART|BUBBLE|CATEGORICAL|INFOBUBBLE' } }).flags;
  assert.ok(f1.has('INFOBUBBLE') && f1.has('CHART') && f1.has('SYMBOL'), 'BUBBLE still adds SYMBOL');
  assert.equal(G.styleNum(G.normalizeTheme({ layer: 'x', style: { type: 'DOT', bubblemax: '2' } }).style.bubblemax), 2,
    'bubblemax is a typed numeric style key');
  const f2 = G.normalizeTheme({ layer: 'x', style: { type: 'INFOBUBBLE|NOICON' } }).flags;
  assert.ok(f2.has('INFOBUBBLE') && f2.has('NOICON'));
});

test('base type INFOBUBBLE|NOICON: no deck layers, every feature recorded as an info-bubble item', () => {
  const rt = rtOf('INFOBUBBLE|NOICON');
  const layers = rt.buildDeckLayers(10, BBOX, 10);
  assert.equal(layers.length, 0, 'NOICON: no deck layers');
  assert.equal(rt._infoBubbleItems.length, 3);
  assert.equal(rt._infoBubbleItems[0].properties.raw.comune, 'Amatrice');
  assert.deepEqual(plain(rt._infoBubbleItems[0].geometry.coordinates), [13.29, 42.63]);
});

test('base type INFOBUBBLE: draws the DOT layer and records the same items', () => {
  const rt = rtOf('INFOBUBBLE');
  const layers = rt.buildDeckLayers(10, BBOX, 10);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].id, 'ix-dot-comuni');
  assert.equal(layers[0].props.data.length, 3, 'the dot layer carries the same items');
  assert.equal(rt._infoBubbleItems.length, 3);
});

test('a hidden theme (style.visible "false") clears the recorded items on its pass', () => {
  const rt = rtOf('INFOBUBBLE|NOICON', { visible: 'false' });
  assert.equal(rt.buildDeckLayers(10, BBOX, 10).length, 0);
  assert.equal(rt._infoBubbleItems, null, 'no cards survive a hidden theme');
});

test('_recordInfoBubbles: bubblemax caps the cards, keeping the biggest by value/total (like maxcharts)', () => {
  const rt = rtOf('INFOBUBBLE|NOICON', { bubblemax: '2' });
  rt._recordInfoBubbles([
    { geometry: pt({}, 1, 1).geometry, properties: { value: 5 } },
    { geometry: pt({}, 2, 2).geometry, properties: { value: 50 } },
    { geometry: pt({}, 3, 3).geometry, properties: { total: 500 } }
  ]);
  assert.equal(rt._infoBubbleItems.length, 2);
  assert.deepEqual(plain(rt._infoBubbleItems.map(d => d.properties.total ?? d.properties.value)), [500, 50]);
  const rtAll = rtOf('INFOBUBBLE|NOICON');
  rtAll._recordInfoBubbles([{ geometry: pt({}, 1, 1).geometry, properties: {} }]);
  assert.equal(rtAll._infoBubbleItems.length, 1, 'no bubblemax: all items kept');
});

test('card content: meta.infobubble wins over meta.tooltip; tooltip template is the fallback', () => {
  const rt = rtOf('INFOBUBBLE|NOICON', {}, { title: 'T', tooltip: 'TIP {{comune}}', infobubble: 'BUB <b>{{comune}}</b> {{bisogno}}' });
  rt.buildDeckLayers(10, BBOX, 10);
  const html = rt.buildTooltipHtml(rt._infoBubbleItems[0], false);
  assert.ok(html.includes('BUB <b>Amatrice</b> presenze < anagrafe'), 'infobubble template, raw fields interpolated: ' + html);
  const rt2 = rtOf('INFOBUBBLE|NOICON', {}, { title: 'T', tooltip: 'TIP {{comune}}' });
  rt2.buildDeckLayers(10, BBOX, 10);
  assert.ok(rt2.buildTooltipHtml(rt2._infoBubbleItems[1], false).includes('TIP Accumoli'), 'falls back to meta.tooltip');
  // style.infobubble works too (normalizeTheme merges meta into style)
  const rt3 = rtOf('INFOBUBBLE|NOICON', { infobubble: 'STY {{comune}}' }, {});
  rt3.buildDeckLayers(10, BBOX, 10);
  assert.ok(rt3.buildTooltipHtml(rt3._infoBubbleItems[0], false).includes('STY Amatrice'));
});

test('infoBubbleOffset: style bubbleoffset "dx,dy", default [28,-12]; infoBubbleKey is stable per anchor', () => {
  assert.deepEqual(plain(G.infoBubbleOffset({})), [28, -12]);
  assert.deepEqual(plain(G.infoBubbleOffset({ bubbleoffset: '10,-5' })), [10, -5]);
  assert.deepEqual(plain(G.infoBubbleOffset({ bubbleoffset: '40 0' })), [40, 0]);
  assert.deepEqual(plain(G.infoBubbleOffset({ bubbleoffset: 'x,y' })), [28, -12], 'garbage falls back to the default');
  assert.equal(G.infoBubbleKey('comuni', [13.290001, 42.63]), 'comuni::13.290001,42.630000');
  assert.equal(G.infoBubbleKey('comuni', [13.2900014, 42.6300004]), G.infoBubbleKey('comuni', [13.290001, 42.63]),
    'sub-microdegree jitter keys the same card');
});

// a minimal DOM stand-in: style is a plain object (cssText included), events
// are recorded so the test can fire them
function fakeEl() {
  return {
    style: {}, children: [], listeners: {}, parent: null, textContent: '', innerHTML: '',
    offsetWidth: 100, offsetHeight: 50, clientWidth: 800, clientHeight: 600,
    appendChild(c) { this.children.push(c); c.parent = this; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); },
    addEventListener(ev, cb) { (this.listeners[ev] = this.listeners[ev] || []).push(cb); },
    setAttribute() {}
  };
}

test('createInfoBubbles: sync mounts one positioned card per recorded item, content from meta.infobubble; close and stale-drop work', () => {
  win.document.createElement = () => fakeEl();
  win.getComputedStyle = () => ({ position: 'absolute' });
  win.innerWidth = 1200;
  const rt = rtOf('INFOBUBBLE|NOICON', {}, { infobubble: 'BUB <b>{{comune}}</b>' });
  rt.buildDeckLayers(10, BBOX, 10);
  const el = fakeEl();
  const map = {
    project: a => ({ x: 100 + a[0], y: 200 + a[1] }),
    handlers: {},
    on(ev, cb) { (this.handlers[ev] = this.handlers[ev] || []).push(cb); },
    off(ev, cb) { this.handlers[ev] = (this.handlers[ev] || []).filter(f => f !== cb); }
  };
  const builder = { _engineOptions: {}, mapOptions: {}, __effectiveDark: () => false };
  const disposers = [];
  const ib = G.createInfoBubbles({ builder, map, el, runtimes: [rt], disposers });
  ib.mount();
  assert.equal(el.children.length, 1, 'the card pane is anchored inside the map container');
  assert.ok(map.handlers.move && map.handlers.move.length === 1, 'positions follow the map moves');
  ib.sync();
  const pane = el.children[0];
  assert.equal(pane.children.length, 3, 'one card per recorded item');
  const card = pane.children[0];
  assert.ok(card.children[0].innerHTML.includes('BUB <b>Amatrice</b>'), 'card content: ' + card.children[0].innerHTML);
  assert.ok(/translate\(\d+px, \d+px\)/.test(card.style.transform), 'positioned via map.project: ' + card.style.transform);
  assert.ok(String(card.style.cssText).includes('pointer-events:auto'), 'the card itself is clickable (the pane is not)');
  // closing a card removes it and keeps it closed across syncs
  card.children[1].listeners.click[0]();
  assert.equal(pane.children.length, 2);
  ib.sync();
  assert.equal(pane.children.length, 2, 'a closed card is not recreated');
  // a rebuild that records nothing drops the remaining cards
  rt._infoBubbleItems = null;
  ib.sync();
  assert.equal(pane.children.length, 0);
  // move re-positions without errors
  ib.sync();
  map.handlers.move.forEach(cb => cb());
  // dispose removes the pane and the listeners
  disposers.forEach(d => d());
  assert.equal(el.children.length, 0);
  assert.equal(map.handlers.move.length, 0);
});

test('polygon items anchor at flatShapeCenter (the choropleth |INFOBUBBLE path records whole features)', () => {
  const rt = new G.LayerRuntime(G.normalizeTheme({
    layer: 'regioni',
    binding: { geo: 'geometry', value: 'profilo', title: 'comune' },
    style: { type: 'CHOROPLETH|CATEGORICAL|INFOBUBBLE', colorscheme: ['#c0392b', '#e67e22', '#27ae60'] }
  }), { type: 'FeatureCollection', features: [poly({ comune: 'X', profilo: 'B' }, square)] }, {});
  rt.buildDeckLayers(10, BBOX, 10);
  assert.equal(rt._infoBubbleItems.length, 1);
  assert.equal(rt._infoBubbleItems[0].properties.raw.comune, 'X', 'raw record wrapped as {raw}');
  const c = G.flatShapeCenter(rt._infoBubbleItems[0].geometry);
  assert.ok(c && Math.abs(c[0] - 10.8) < 1e-9, 'shape center lon, vertex mean');
});
