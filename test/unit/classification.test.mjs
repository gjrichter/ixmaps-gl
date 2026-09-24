// Pure classification functions: class breaks (equal interval, quantile,
// natural/Jenks) and class lookup. Exact values for small hand-checked
// inputs, plus properties every classification must satisfy.
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
const plain = v => JSON.parse(JSON.stringify(v));

test('equalIntervalBreaks: 0..10 in 5 classes', () => {
  assert.deepEqual(plain(G.equalIntervalBreaks(0, 10, 5)),
    [{ min: 0, max: 2 }, { min: 2, max: 4 }, { min: 4, max: 6 }, { min: 6, max: 8 }, { min: 8, max: 10 }]);
});

test('equalIntervalBreaks: a zero range (all values equal) still yields nParts classes', () => {
  const b = G.equalIntervalBreaks(3, 3, 4);
  assert.equal(b.length, 4);
  assert.equal(b[0].min, 3);
});

test('quantileBreaks: 1..10 in 5 classes (index round(i·n/k))', () => {
  // sorted = [1..10], n = 10: min = sorted[round(i·2)], max = sorted[round((i+1)·2)], last max = 10
  assert.deepEqual(plain(G.quantileBreaks([5, 3, 9, 1, 7, 2, 10, 4, 8, 6], 5)),
    [{ min: 1, max: 3 }, { min: 3, max: 5 }, { min: 5, max: 7 }, { min: 7, max: 9 }, { min: 9, max: 10 }]);
});

test('quantileBreaks does not mutate its input', () => {
  const v = [3, 1, 2];
  G.quantileBreaks(v, 2);
  assert.deepEqual(v, [3, 1, 2]);
});

test('jenksBreakValues: two clearly separated groups break between them', () => {
  const b = G.jenksBreakValues([1, 2, 3, 10, 11, 12], 2);
  assert.equal(b[0], 1);
  assert.equal(b[1], 3);   // last value of the lower group
  assert.equal(b[2], 12);
});

test('naturalBreaks: fewer values than classes → one class per value, padded', () => {
  const b = G.naturalBreaks([4, 2], 4);
  assert.equal(b.length, 4);
  assert.equal(b[b.length - 1].max, 4);
});

test('evenStrideSample: keeps both ends and has the requested size', () => {
  const s = G.evenStrideSample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.deepEqual(plain(s), [0, 3, 5, 8, 10]);
});

test('partsFromBreakValues: inner maxima get a tie epsilon, the last max is the true maximum', () => {
  const p = G.partsFromBreakValues([0, 5, 10], 2, 10);
  assert.equal(p[0].min, 0);
  assert.ok(p[0].max > 5 && p[0].max < 5.001);
  assert.deepEqual(plain(p[1]), { min: 5, max: 10 });
});

test('resolvePartsClass: lower bound inclusive, upper exclusive except the last class', () => {
  const parts = [{ min: 0, max: 5 }, { min: 5, max: 10 }];
  assert.equal(G.resolvePartsClass(0, parts), 0);
  assert.equal(G.resolvePartsClass(4.99, parts), 0);
  assert.equal(G.resolvePartsClass(5, parts), 1);
  assert.equal(G.resolvePartsClass(10, parts), 1);
  assert.equal(G.resolvePartsClass(10.1, parts), null);
  assert.equal(G.resolvePartsClass(NaN, parts), null);
  assert.equal(G.resolvePartsClass(1, null), null);
});

// ---- properties, on a few datasets and class counts
const datasets = {
  uniform: Array.from({ length: 100 }, (_, i) => i),
  skewed: Array.from({ length: 200 }, (_, i) => Math.round(Math.exp(i / 20))),
  ties: [1, 1, 1, 1, 2, 2, 3, 3, 3, 9, 9, 9, 9, 9],
  large: Array.from({ length: 5000 }, (_, i) => (i * 7919) % 1000), // > NATURAL_BREAKS_MAX_SAMPLE → sampled
};
const methods = {
  equal: (v, k) => G.equalIntervalBreaks(Math.min(...v), Math.max(...v), k),
  quantile: (v, k) => G.quantileBreaks(v, k),
  natural: (v, k) => G.naturalBreaks(v, k),
};

for (const [mname, fn] of Object.entries(methods)) {
  for (const [dname, values] of Object.entries(datasets)) {
    for (const k of [3, 5, 7]) {
      // KNOWN ISSUE (found by this test, not changed by the behavior-preserving
      // extraction): natural breaks with MORE classes than distinct values
      // yield duplicate classes, and from ~k ≥ distinct+3 undefined bounds
      // (jenksBreakValues backtracks to valuesA[-2]) — values then fit no
      // class and are dropped. To be fixed as its own change.
      const distinct = new Set(values).size;
      const known = mname === 'natural' && k > distinct
        ? `known issue: natural breaks with ${k} classes on ${distinct} distinct values (duplicate/undefined class bounds)` : undefined;
      test(`property: ${mname} / ${dname} / ${k} classes`, { todo: known }, () => {
        const parts = fn(values, k);
        const lo = Math.min(...values), hi = Math.max(...values);
        assert.equal(parts.length, k);
        assert.equal(parts[0].min, lo, 'first class starts at the minimum');
        assert.ok(Math.abs(parts[k - 1].max - hi) < 1e-9 || parts[k - 1].max >= hi, 'last class reaches the maximum');
        for (let i = 0; i < k; i++) {
          assert.ok(parts[i].min <= parts[i].max, `class ${i} min <= max`);
          if (i) assert.ok(parts[i].min >= parts[i - 1].min, `class ${i} starts no lower than class ${i - 1}`);
        }
        // the engine's lookup puts every value in exactly one class
        for (const v of values) assert.notEqual(G.resolvePartsClass(v, parts), null, `value ${v} in no class`);
        // natural breaks: a value ON a break belongs to the LOWER class —
        // partsFromBreakValues' documented tie epsilon (Jenks' break value
        // is the last element of the lower segment); equal/quantile classes
        // don't overlap at all
        for (let i = 0; i < k - 1; i++) {
          const overlap = parts[i].max - parts[i + 1].min;
          if (mname === 'natural') {
            assert.ok(overlap >= 0 && overlap <= 1e-6 + 1e-12, `natural: classes ${i}/${i + 1} overlap only by the tie epsilon`);
            if (values.includes(parts[i + 1].min)) assert.equal(G.resolvePartsClass(parts[i + 1].min, parts), i, `break value ${parts[i + 1].min} → lower class ${i}`);
          } else {
            assert.ok(overlap <= 1e-12, `${mname}: classes ${i}/${i + 1} do not overlap`);
          }
        }
      });
    }
  }
}
