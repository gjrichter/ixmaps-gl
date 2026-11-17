// INFOBUBBLE helpers: the card ranking value (infoBubbleRank — numeric only,
// a CATEGORICAL choropleth's string class label counts as 0 so the sort
// comparator never turns NaN), the card cap from style.bubblemax
// (infoBubbleMax — default 50, "all" / 0 / negative for none) and the card
// offset from style.bubbleoffset (infoBubbleOffset).
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
const { infoBubbleRank, infoBubbleMax, infoBubbleOffset } = win.__ixmapsGlInternals;

test('rank: numeric value, total wins over value', () => {
  assert.equal(infoBubbleRank({ value: 7 }), 7);
  assert.equal(infoBubbleRank({ value: '12.5' }), 12.5);
  assert.equal(infoBubbleRank({ value: 3, total: 9 }), 9);
  assert.equal(infoBubbleRank({ value: -4 }), -4);
});

test('rank: string labels, missing and non-finite values count as 0', () => {
  for (const p of [{ value: 'Alta' }, {}, { value: undefined }, { value: NaN }, { total: null, value: null }, null, undefined]) {
    assert.equal(infoBubbleRank(p), 0, JSON.stringify(p));
  }
});

test('rank: sorting mixed items never yields NaN comparisons', () => {
  const items = [{ value: 'Alta' }, { value: 5 }, {}, { value: 2 }].map(properties => ({ properties }));
  items.sort((a, b) => infoBubbleRank(b.properties) - infoBubbleRank(a.properties));
  assert.deepEqual(items.map(i => i.properties.value), [5, 2, 'Alta', undefined]);
});

test('max: unset or blank → 50', () => {
  for (const style of [undefined, null, {}, { bubblemax: '' }, { bubblemax: '  ' }, { bubblemax: 'x' }]) {
    assert.equal(infoBubbleMax(style), 50, JSON.stringify(style));
  }
});

test('max: positive n (number or string, rounded) → n', () => {
  assert.equal(infoBubbleMax({ bubblemax: 20 }), 20);
  assert.equal(infoBubbleMax({ bubblemax: '20' }), 20);
  assert.equal(infoBubbleMax({ bubblemax: 7.6 }), 8);
});

test('max: "all", 0 or negative → no cap', () => {
  for (const v of ['all', 'ALL', ' all ', 0, '0', -1, '-5']) {
    assert.equal(infoBubbleMax({ bubblemax: v }), Infinity, String(v));
  }
});

test('offset: "dx,dy" or "dx dy", else the default [28,-12]', () => {
  assert.deepEqual([...infoBubbleOffset({ bubbleoffset: '26,-10' })], [26, -10]);
  assert.deepEqual([...infoBubbleOffset({ bubbleoffset: '5 6' })], [5, 6]);
  for (const style of [undefined, {}, { bubbleoffset: '' }, { bubbleoffset: '1' }, { bubbleoffset: 'a,b' }]) {
    assert.deepEqual([...infoBubbleOffset(style)], [28, -12], JSON.stringify(style));
  }
});
