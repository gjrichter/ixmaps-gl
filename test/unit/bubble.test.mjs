// CHART|BUBBLE: flat's stroke and opacity rule for a bubble (maptheme.js, the
// BUBBLE branch — flatBubbleLook) and its stepped form for a cached icon
// raster (bubbleIconLook). Expected widths are measured on real flat pages
// (stroke-width × the circle's screen CTM scale). Numeric style values, as
// normalizeTheme leaves them (STYLE_NUMBER_KEYS).
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
const { flatBubbleLook, bubbleIconLook } = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));
const flags = (...f) => new Set(['CHART', 'BUBBLE', 'CATEGORICAL', ...f]);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('bubble look: width linewidth · unit · √(r / normal radius), as measured on flat', () => {
  // UNHCR "idp" (linewidth 5, fillopacity 0.1): flat's normalX(1) on screen 0.05122
  const unhcr = { linewidth: 5, fillopacity: 0.1 };
  near(flatBubbleLook([174, 199, 232], 24.096, 0.0512162, unhcr, flags()).width, 1.434, 0.002, 'r 24.1 px');
  near(flatBubbleLook([174, 199, 232], 16.561, 0.0512162, unhcr, flags()).width, 1.189, 0.002, 'r 16.6 px');
  near(flatBubbleLook([174, 199, 232], 9.877, 0.0512162, unhcr, flags()).width, 0.918, 0.002, 'r 9.9 px');
  // AREU accidents as CHART|BUBBLE|…|RELOCATE (linewidth 3, fillopacity 0.3): unit 1.5024
  const areu = { linewidth: 3, fillopacity: 0.3 };
  near(flatBubbleLook([221, 187, 34], 18.31, 1.502406, areu, flags()).width, 4.063, 0.002, 'r 18.3 px');
  near(flatBubbleLook([221, 187, 34], 3.19, 1.502406, areu, flags()).width, 1.695, 0.002, 'r 3.2 px');
  near(flatBubbleLook([1, 1, 1], 15, 1, {}, flags()).width, 0.1, 1e-9, 'linewidth defaults to 0.1');
});

test('bubble look: stroke the color × 0.7 (ChartColors.lowColor), linecolor, NOLINES, "none"', () => {
  assert.deepEqual(plain(flatBubbleLook([174, 199, 232], 10, 1, {}, flags()).stroke), [121, 139, 162]);
  assert.deepEqual(plain(flatBubbleLook([221, 187, 34], 10, 1, {}, flags()).stroke), [154, 130, 23]);
  assert.deepEqual(plain(flatBubbleLook([221, 187, 34], 10, 1, { linecolor: '#ff0000' }, flags()).stroke), [255, 0, 0]);
  assert.deepEqual(plain(flatBubbleLook([221, 187, 34], 10, 1, { linecolor: ['#000000', '#00ff00'] }, flags()).stroke), [0, 255, 0], 'a list strokes with its last entry');
  assert.equal(flatBubbleLook([221, 187, 34], 10, 1, { linecolor: 'none' }, flags()).stroke, null);
  assert.equal(flatBubbleLook([221, 187, 34], 10, 1, {}, flags('NOLINES')).stroke, null);
  assert.deepEqual(plain(flatBubbleLook([221, 187, 34], 10, 1, { linecolor: '#ff0000' }, flags('NOLINES')).stroke), [255, 0, 0],
    'flat: szLineColor = this.szLineColor || szLineColor — an explicit linecolor wins over NOLINES');
});

test('bubble look: fill-opacity fillopacity (1); stroke-opacity 1 below 0.5, with OUTLINE or a linecolor, else 0.3', () => {
  const look = st => { const l = flatBubbleLook([1, 2, 3], 10, 1, st, flags()); return [l.fillOpacity, l.strokeOpacity]; };
  assert.deepEqual(look({ fillopacity: 0.1 }), [0.1, 1]);
  assert.deepEqual(look({ fillopacity: 0.6 }), [0.6, 0.3]);
  assert.deepEqual(look({}), [1, 0.3]);
  assert.deepEqual(look({ fillopacity: 0.6, linecolor: '#ffffff' }), [0.6, 1]);
  const outline = flatBubbleLook([1, 2, 3], 10, 1, { fillopacity: 0.6 }, flags('OUTLINE'));
  assert.equal(outline.strokeOpacity, 1);
});

test('bubble look: OUTLINE width unit · min(1, r / normal radius)', () => {
  assert.equal(flatBubbleLook([1, 1, 1], 7.5, 2, { linewidth: 5 }, flags('OUTLINE')).width, 0.5);
  assert.equal(flatBubbleLook([1, 1, 1], 90, 2, { linewidth: 5 }, flags('OUTLINE')).width, 2);
});

test('bubble icon look: canvas width in quarter-octave steps, zoom-independent, capped at the radius', () => {
  const st = { linewidth: 5, fillopacity: 0.1 };
  // UNHCR's largest bubble: 1.4286 canvas px exactly → step 2^(1/2)
  const a = bubbleIconLook(24.096, 0.0512162, st, flags(), 48);
  assert.equal(a.width, 1.414);
  // the same value at another zoom: r and unit scale together
  assert.equal(bubbleIconLook(24.096 * 3, 0.0512162 * 3, st, flags(), 48).width, a.width);
  assert.equal(bubbleIconLook(0.1, 1, st, flags(), 48).width, 24, 'a sub-pixel bubble: at most the icon radius');
  assert.equal(bubbleIconLook(0, 1, st, flags(), 48).width, 0);
  assert.deepEqual([a.fillOpacity, a.strokeOpacity, a.stroke, a.noStroke], [0.1, 1, null, false], 'derived stroke: per part, not in the look');
  assert.deepEqual(plain(bubbleIconLook(10, 1, { linecolor: '#ff0000' }, flags(), 48).stroke), [255, 0, 0]);
  assert.equal(bubbleIconLook(10, 1, {}, flags('NOLINES'), 48).noStroke, true);
  assert.equal(bubbleIconLook(10, 1, {}, flags(), 48).outlineRatio, undefined);
  assert.equal(bubbleIconLook(60, 1, {}, flags('OUTLINE'), 48).outlineRatio, 1, 'OUTLINE stops growing from the normal radius up');
  assert.equal(bubbleIconLook(7.5, 1, {}, flags('OUTLINE'), 48).outlineRatio, 0.5);
});
