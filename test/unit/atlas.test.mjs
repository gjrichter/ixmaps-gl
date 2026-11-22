// Icon-atlas swap (LayerRuntime._cacheIcon / _commitAtlasSwap): a swap the
// icon caps ask for waits until deck.gl has loaded the current atlas
// layers' icons — deck.gl 9.4 copies late icon loads into the texture of a
// finalized IconLayer ("bindTexture: attempt to use a deleted object",
// examples/plot_curves.html with 2× plot icons).
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
const { normalizeTheme, LayerRuntime } = win.__ixmapsGlInternals;

const runtime = () => new LayerRuntime(normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'v' },
  style: { type: 'CHART|BUBBLE', colorscheme: ['#ff0000'] } }), { type: 'FeatureCollection', features: [] }, {});
// icons big enough that a handful pass the 2 Mpx area cap
const bigIcon = () => ({ width: 1024, height: 1024 });

test('atlas: crossing the area cap only marks a swap as due, the generation stays', () => {
  const rt = runtime();
  rt._cacheIcon('a', bigIcon());
  rt._cacheIcon('b', bigIcon());
  assert.equal(rt._atlasSwapPendingSince, 0, 'at the cap (2 Mpx): not past it yet');
  rt._cacheIcon('c', bigIcon());
  assert.ok(rt._atlasSwapPendingSince > 0, 'past the cap: a swap is due');
  assert.equal(rt._iconGeneration, 0, 'the layer id is not changed while icons may still load');
  assert.equal(rt._iconAreaSinceAtlasReset, 0, 'the count starts again for the next swap');
});

test('atlas: the swap is made once the current atlas layers have loaded', () => {
  const rt = runtime();
  ['a', 'b', 'c'].forEach(k => rt._cacheIcon(k, bigIcon()));
  const since = rt._atlasSwapPendingSince;
  assert.equal(rt._commitAtlasSwap(false, since + 100), false, 'icons still loading: wait');
  assert.equal(rt._iconGeneration, 0);
  assert.equal(rt._commitAtlasSwap(true, since + 300), true, 'loaded: swap');
  assert.equal(rt._iconGeneration, 1);
  assert.equal(rt._atlasSwapPendingSince, 0);
  assert.equal(rt._commitAtlasSwap(true, since + 400), false, 'nothing due: no second swap');
  assert.equal(rt._iconGeneration, 1);
});

test('atlas: a load that never finishes does not hold the swap back for more than 2 s', () => {
  const rt = runtime();
  ['a', 'b', 'c'].forEach(k => rt._cacheIcon(k, bigIcon()));
  const since = rt._atlasSwapPendingSince;
  assert.equal(rt._commitAtlasSwap(false, since + 1999), false);
  assert.equal(rt._commitAtlasSwap(false, since + 2000), true, 'swapped anyway');
  assert.equal(rt._iconGeneration, 1);
});

test('atlas: a second cap crossing while a swap waits keeps the first due time', () => {
  const rt = runtime();
  ['a', 'b', 'c'].forEach(k => rt._cacheIcon(k, bigIcon()));
  const since = rt._atlasSwapPendingSince;
  ['d', 'e', 'f'].forEach(k => rt._cacheIcon(k, bigIcon()));
  assert.equal(rt._atlasSwapPendingSince, since);
  rt._commitAtlasSwap(true, since + 10);
  assert.equal(rt._iconGeneration, 1, 'one swap, not one per crossing');
});
