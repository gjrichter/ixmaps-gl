// CATEGORICAL without style.values: the categories are discovered from the
// data in order of first appearance (flat). New data for the same theme
// (replaceFeatures: refreshTheme, a re-filter, a broker's next load) keeps
// the categories found before at their index, so colours and legend marks
// don't swap; new categories are appended.
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

const pt = c => ({ type: 'Feature', properties: { c }, geometry: { type: 'Point', coordinates: [9, 45] } });
const fc = cats => ({ type: 'FeatureCollection', features: cats.map(pt) });
const theme = style => G.normalizeTheme({ layer: 'x', binding: { value: 'c' },
  style: Object.assign({ type: 'CHART|DOT|CATEGORICAL', colorscheme: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'] }, style) });
const labels = rt => [...rt.categoryLabels];
const colorOf = (rt, label) => [...rt.categoryColorsRgb[rt.categoryIndexByLabel.get(label)]];

test('categories: first load is in order of first appearance', () => {
  const rt = new G.LayerRuntime(theme(), fc(['b', 'a', 'b']), {});
  assert.deepEqual(labels(rt), ['b', 'a']);
});

test('categories: new data in another order keeps each category at its index, new ones appended', () => {
  const rt = new G.LayerRuntime(theme(), fc(['b', 'a']), {});
  const bColor = colorOf(rt, 'b'), aColor = colorOf(rt, 'a');
  rt.replaceFeatures(fc(['c', 'a', 'b']));
  assert.deepEqual(labels(rt), ['b', 'a', 'c']);
  assert.deepEqual(colorOf(rt, 'b'), bColor);
  assert.deepEqual(colorOf(rt, 'a'), aColor);
});

test('categories: a category gone from the new data keeps its place', () => {
  const rt = new G.LayerRuntime(theme(), fc(['b', 'a', 'c']), {});
  const cColor = colorOf(rt, 'c');
  rt.replaceFeatures(fc(['c']));
  assert.deepEqual(labels(rt), ['b', 'a', 'c']);
  assert.deepEqual(colorOf(rt, 'c'), cColor);
});

test('categories: an explicit style.values list is unchanged by new data', () => {
  const rt = new G.LayerRuntime(theme({ values: ['a', 'b', 'c'] }), fc(['c', 'a']), {});
  rt.replaceFeatures(fc(['b']));
  assert.deepEqual(labels(rt), ['a', 'b', 'c']);
});

test('categories: numeric data values match an explicit style.values list (keys are strings)', () => {
  const rt = new G.LayerRuntime(theme({ values: [1, 2, 3] }), fc([3, 1, 2]), {});
  assert.deepEqual([3, 1, 2].map(v => rt._resolveClassIndex(v)), [2, 0, 1]);
  assert.equal(rt._resolveClassIndex(' 2 '), 1);
  assert.equal(rt._resolveClassIndex(9), undefined);
});

test('DOT fallback color: a count-first colorscheme ["5", from, to] starts its sweep, not gray', () => {
  const rt = new G.LayerRuntime(G.normalizeTheme({ layer: 'x', binding: {}, style: { type: 'CHART|DOT', colorscheme: ['5', '#ffffff', '#ff0000'] } }), fc([]), {});
  assert.deepEqual([...rt._dotFallbackColor()], [255, 255, 255]);
  const plainRt = new G.LayerRuntime(G.normalizeTheme({ layer: 'y', binding: {}, style: { type: 'CHART|DOT', colorscheme: ['#00ff00'] } }), fc([]), {});
  assert.deepEqual([...plainRt._dotFallbackColor()], [0, 255, 0]);
});
