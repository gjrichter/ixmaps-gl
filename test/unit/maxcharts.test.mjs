// style.maxcharts: flat's chartMap (maptheme.js 16879-16885) sorts the
// charts ascending — the biggest drawn last — and skips the first
// nToDraw − nMaxCharts, for every chart type; gl applies the same cut with
// applyFlatMaxCharts on each renderer's sorted list of charts to draw.
// style.maxcharts is a number there: gl parses numeric style strings
// ("5000") into numbers with the theme (typeStyleNumbers).
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
const { applyFlatMaxCharts } = win.__ixmapsGlInternals;

test('maxcharts keeps the last (biggest) n of an ascending list, in place', () => {
  const list = [1, 2, 3, 4, 5];
  const out = applyFlatMaxCharts(list, { maxcharts: 3 });
  assert.equal(out, list);
  assert.deepEqual([...list], [3, 4, 5]);
});

test('maxcharts unset, 0 or not smaller than the list leaves it whole', () => {
  for (const style of [{}, { maxcharts: 0 }, { maxcharts: NaN }, { maxcharts: 5 }, { maxcharts: 9 }]) {
    const list = [1, 2, 3, 4, 5];
    applyFlatMaxCharts(list, style);
    assert.deepEqual([...list], [1, 2, 3, 4, 5], JSON.stringify(style));
  }
});

test('maxcharts is rounded as flat (Math.round)', () => {
  const list = [1, 2, 3, 4, 5];
  applyFlatMaxCharts(list, { maxcharts: 1.6 });
  assert.deepEqual([...list], [4, 5]);
});

// flatSortCharts: flat's draw-order sort (maptheme.js 16774-16870), shared by
// the pie, bar and vector builders — only numeric keys take part, as flat
// builds its draw list from them; ascending (biggest drawn last) or, for
// SORT|UP, descending; stable for equal keys
const { flatSortCharts } = win.__ixmapsGlInternals;
const ids = list => list.map(c => c.id).join(',');

test('flatSortCharts: ascending by key, in place; descending when down', () => {
  const list = [{ id: 'a', key: 3 }, { id: 'b', key: 1 }, { id: 'c', key: 2 }];
  assert.equal(flatSortCharts(list, c => c.key, false), list);
  assert.equal(ids(list), 'b,c,a');
  assert.equal(ids(flatSortCharts(list, c => c.key, true)), 'a,c,b');
});

test('flatSortCharts: a chart without a numeric key (blank size or value) is left out, as flat', () => {
  const list = [{ id: 'a', key: 3 }, { id: 'b', key: NaN }, { id: 'c', key: undefined }, { id: 'd', key: 1 }];
  assert.equal(ids(flatSortCharts(list, c => c.key, false)), 'd,a');
});

test('flatSortCharts: equal keys keep their order', () => {
  const list = [{ id: 'a', key: 1 }, { id: 'b', key: 0 }, { id: 'c', key: 1 }, { id: 'd', key: 1 }];
  assert.equal(ids(flatSortCharts(list, c => c.key, false)), 'b,a,c,d');
});
