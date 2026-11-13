// style.visible (flat maptheme.js 1971-1978): a theme defined with visible "false" starts hidden,
// so it is never drawn until setThemeVisible(id, true) shows it; anything else starts visible.
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

const runtime = style => new LayerRuntime(
  normalizeTheme({ layer: 'x', binding: { geo: 'geometry' }, style: { type: 'FEATURE', ...style } }),
  { type: 'FeatureCollection', features: [] }, {});

test('style.visible "false" / false defines the theme hidden', () => {
  assert.equal(runtime({ visible: 'false' })._hidden, true);
  assert.equal(runtime({ visible: false })._hidden, true);
  assert.equal(runtime({ visible: ' FALSE ' })._hidden, true);
});

test('no style.visible, or any other value, starts visible', () => {
  assert.equal(runtime({})._hidden, false);
  assert.equal(runtime({ visible: 'true' })._hidden, false);
  assert.equal(runtime({ visible: true })._hidden, false);
  assert.equal(runtime({ visible: '' })._hidden, false);
});
