// CHART|WAFFLE: flat's waffle layout (maptheme.js drawChart WAFFLE branch,
// 20533-20640). Expected numbers are computed from flat's own formulas:
// chart 30 u x 0.97, grid x 0.9, cell = grid / (columns x 1.1).
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
const { isWaffleChart, flatWaffleLayout } = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));
const near = (a, b, msg, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const flagsOf = t => { const f = new Set(t.split('|')); Object.defineProperty(f, 'typeString', { value: t }); return f; };

const W = 30 * 0.97 * 0.9;
const opts = { themeMin: 0, themeMax: 10 };

test('waffle: which types are waffle charts', () => {
  assert.equal(isWaffleChart(flagsOf('CHART|WAFFLE')), true);
  assert.equal(isWaffleChart(flagsOf('CHART|WAFFLE|SORT|AGGREGATE')), true);
  assert.equal(isWaffleChart(flagsOf('CHART|PIE|WAFFLE')), false, 'PIE comes first in flat');
  assert.equal(isWaffleChart(flagsOf('CHART|USER|WAFFLE')), false, 'USER comes first in flat');
  assert.equal(isWaffleChart(flagsOf('CHOROPLETH|WAFFLE')), false, 'only charts');
  assert.equal(isWaffleChart(flagsOf('CHART|BAR')), false);
});

test('waffle: a square per count, rows from the bottom left, 5 columns for a max of 10', () => {
  const l = flatWaffleLayout([5, 3], 'CHART|WAFFLE', opts);
  assert.equal(l.cells.length, 8);
  const cell = W / (5 * 1.1);
  const c0 = l.cells[0];
  near(c0.r[0], -W / 2, 'first x');
  near(c0.r[3], W / 2, 'first row bottom (y down)');
  near(c0.r[2] - c0.r[0], cell, 'cell width');
  near(c0.r[3] - c0.r[1], cell, 'cell height');
  assert.deepEqual(plain(l.cells.map(c => c.part)), [0, 0, 0, 0, 0, 1, 1, 1]);
  // the 6th square starts the second row, one cell and its gap above
  near(l.cells[5].r[0], -W / 2, 'row wrap x');
  near(l.cells[5].r[3], W / 2 - cell * 1.1, 'row wrap y');
  near(l.cells[1].r[0] - l.cells[0].r[0], cell * 1.1, 'column step');
});

test('waffle: values are rounded; 0 and negative parts have no squares', () => {
  const l = flatWaffleLayout([2.6, 0, -4, 1.4], 'CHART|WAFFLE', opts);
  assert.deepEqual(plain(l.cells.map(c => c.part)), [0, 0, 0, 3]);
  assert.equal(flatWaffleLayout([0, 0.2], 'CHART|WAFFLE', opts), null, 'no cell, no waffle');
});

test('waffle: SORT starts with the largest part', () => {
  const l = flatWaffleLayout([1, 3, 2], 'CHART|WAFFLE|SORT', opts);
  assert.deepEqual(plain(l.cells.map(c => c.part)), [1, 1, 1, 2, 2, 0]);
});

test('waffle: columns — gridx, WAFFLE100 / AUTO100 (10), sqrt of the theme max (min 5)', () => {
  const cols = (t, o) => {
    const l = flatWaffleLayout([30], t, Object.assign({}, opts, o));
    return l.cells.filter(c => c.r[3] === l.cells[0].r[3]).length;
  };
  assert.equal(cols('CHART|WAFFLE', {}), 5, 'max(5, round(sqrt(10)))');
  assert.equal(cols('CHART|WAFFLE', { themeMax: 400 }), 20, 'sqrt(400)');
  assert.equal(cols('CHART|WAFFLE', { themeMax: 400, gridX: 8 }), 8, 'gridx');
  assert.equal(cols('CHART|WAFFLE|WAFFLE100', {}), 10);
  assert.equal(cols('CHART|WAFFLE|AUTO100', { themeMax: 400 }), 10);
  assert.equal(cols('CHART|WAFFLE', { themeMin: -900, themeMax: 10 }), 30, '|nMin| counts');
});

test('waffle: WAFFLE100 stops at 100 squares in all (flat\'s running budget)', () => {
  const l = flatWaffleLayout([80, 60, 40], 'CHART|WAFFLE|WAFFLE100', opts);
  assert.equal(l.cells.length, 100);
  assert.equal(l.cells.filter(c => c.part === 0).length, 80);
  assert.equal(l.cells.filter(c => c.part === 1).length, 20);
  assert.equal(l.cells.filter(c => c.part === 2).length, 0);
  // WAFFLE1000 matches flat's /WAFFLE100/ substring test: capped at 100 too
  assert.equal(flatWaffleLayout([500], 'CHART|WAFFLE|WAFFLE1000', opts).cells.length, 100);
});

test('waffle: the background square is inset 0.5 u inside the 29.1 u chart', () => {
  const l = flatWaffleLayout([1], 'CHART|WAFFLE', opts);
  near(l.back[0], -29.1 / 2 + 0.5, 'back x0');
  near(l.back[2], 29.1 / 2 - 0.5, 'back x1');
  near(l.extent[2] - l.extent[0], 29.1 - 1, 'extent (no overflow) = the drawn background square');
});

test('waffle: o.width (GRIDSIZE) scales the chart, background and cells', () => {
  const l = flatWaffleLayout([5], 'CHART|WAFFLE', Object.assign({}, opts, { width: 60 }));
  near(l.extent[2] - l.extent[0], 60 * 0.97 - 1, 'extent = the background square');
  near(l.cells[0].r[2] - l.cells[0].r[0], 60 * 0.97 * 0.9 / (5 * 1.1), 'cell width');
});

test('waffle: the box extent is the background square (flat boxes what the chart drew)', () => {
  const l = flatWaffleLayout([5], 'CHART|WAFFLE|BOX', opts);
  near(l.back[2] - l.back[0], 29.1 - 1, 'back width');
});

test('waffle: the extent grows to the rows that overflow the background square', () => {
  const l = flatWaffleLayout([48], 'CHART|WAFFLE|BOX', opts);   // 5 columns, 10 rows
  const top = Math.min(...l.cells.map(c => c.r[1]));
  assert.ok(top < l.back[1], 'cells above the back square');
  near(l.extent[1], top, 'extent top = the highest cell');
  near(l.extent[3], l.back[3], 'bottom stays the background square');
});
