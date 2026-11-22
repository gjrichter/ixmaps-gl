// CHART|BAR / BARS: flat's bar chart layout (maptheme.js drawChart's BAR
// branch) and its BOX / TITLE (chartMap 18758-18905). Expected numbers are
// flat's own SVG, measured on the twin pages (raw SVG units / 20 = u):
// bar_horz_categorical_aggregate_svg.html (Türkiye) and
// bar_pointer_offsetmean_svg.html (Grugliasco).
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
const { isBarChart, flatBarLayout, chartBoxLayout, normalizeTheme, LayerRuntime } = win.__ixmapsGlInternals;
const near = (a, b, msg, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const flagsOf = t => { const f = new Set(t.split('|')); Object.defineProperty(f, 'typeString', { value: t }); return f; };
const measure = (text, font) => text.length * font * 0.5;
const plain = v => JSON.parse(JSON.stringify(v));

const HORZ = 'CHART|BAR|HORZ|SIZEP4|SORT|VALUES|CATEGORICAL|AGGREGATE|SUM|BOX|TITLE|COMPACTLEGEND';
const horzOpts = {
  themeMin: 0, themeMax: 3443522, maxSize: 3443522, sizeField: true, normalSizeValue: 100000, sizePow: 4,
  rangeScale: 0.2, valueScale: 0.8, units: 'ref.', gridX: 10, nClasses: 6, nColors: 6, measure
};

test('bar: which types are bar charts (flat\'s BAR branch comes after PIE, BUBBLE, SYMBOL …)', () => {
  assert.equal(isBarChart(flagsOf(HORZ)), true);
  assert.equal(isBarChart(flagsOf('CHART|BARS|VALUES')), true, 'BARS (a substring test)');
  assert.equal(isBarChart(flagsOf('CHART|SYMBOL|BAR')), false);
  assert.equal(isBarChart(flagsOf('CHART|PIE|BAR')), false);
  assert.equal(isBarChart(flagsOf('CHART|VECTOR|BAR')), false);
  assert.equal(isBarChart(flagsOf('CHOROPLETH|BAR')), false, 'only charts');
});

test('bar: HORZ|SIZEP4 sizing and placement as flat draws Türkiye', () => {
  const l = flatBarLayout([3332896, 12946, 2770, 0, 0, 0], HORZ, Object.assign({ itemSize: 3368976 }, horzOpts));
  assert.equal(l.bars.length, 6, 'a 0 value is a (0.00001) bar too');
  const W = 159.00779488154342 / 20;
  near(l.width, W, 'width: 30 · sizer / parts · 0.66, sizer (size / normalsizevalue)^(1/4)');
  const syria = l.bars[0];
  assert.equal(syria.part, 0, 'SORT: the biggest first');
  assert.equal(syria.dir, 1, 'HORZ: to the right');
  near(syria.len, 689.0552556556612 / 20, 'length: value · 30 / normalsizevalue / sizer² · rangescale');
  near(syria.w2, W / 2, 'half width');
  near(syria.base[0], 0, 'the bars start at the position');
  // flat: rotate(90) translate(−nPosX, 0), shifted down by half a bar
  near(syria.base[1], (0 + W / 2 * 20 - 960.0467692892605 + 79.50389744077171) / 20, 'the first bar on top');
  near(l.bars[5].base[1], (800.0389744077171 + 79.50389744077171 - 960.0467692892605 + 79.50389744077171) / 20, 'the last bar about the position');
  assert.deepEqual(plain(l.bars.map(b => b.cls)), [0, 1, 2, 3, 4, 5], 'colored by part');
  assert.equal(syria.line.opacity, 0.1, 'no linewidth: a black outline at 0.1');
  near(syria.line.width, 0.2, 'of 0.2 u');
  const t0 = l.texts[0];
  assert.equal(t0.text, '3 332 896 ref.', 'the value, grouped by blanks, and the units');
  assert.equal(t0.angle, 0, 'reading right');
  assert.equal(t0.bg, null, 'HORZ: no text box');
  assert.equal(t0.color, 'value');
  near(t0.x, 853.2925 / 20, 'beyond the bar\'s end', 1e-2);
  near(t0.y, -753.337 / 20, 'on the bar\'s height', 1e-2);
  near(t0.font, 0.9 * 127.20623590523473 / 20, 'font: the width · valuescale · 0.9');
  assert.equal(l.texts[3].text, '0 ref.', 'a 0 value is printed');
});

test('bar: POINTER|OFFSETMEAN|SIZEP3 as flat draws Grugliasco', () => {
  const t = 'CHART|BAR|POINTER|OFFSETMEAN|BOX|LONGTITLE|SIMPLELEGEND|MEAN|VALUES|SIZEP3|DOPACITY';
  const l = flatBarLayout([1.4906, 1.4879, 2.2182, 2.5643], t, {
    themeMin: 0, themeMax: 9.1837, maxSize: 100000, sizeField: true, itemSize: 36696, normalSizeValue: 100000, sizePow: 3,
    rangeScale: 5, valueScale: 1, units: '%', valueDecimals: 1, nClasses: 4, nColors: 4, textColor: 'black',
    means: [1.6107625397633267, 1.5160794884845383, 1.76641758493447, 2.2770202824786803], measure
  });
  const [neg, , pos] = l.bars;
  // the negative pointer: from the zero line down, the head W/4 below it
  assert.equal(neg.dir, 2);
  near(neg.base[0], (90.4149 - 430.8904251969181) / 20, 'centered: −(last width · bars / 2)', 1e-3);
  near(neg.base[1], 0, 'at the zero line');
  near(neg.len, 45.88435616056116 / 20, 'length: the deviation in % · step');
  near(neg.sw, 129.1641478545027 / 2 / 20, 'shaft 5/7 of the width');
  near(neg.head, 45.20745174907594 / 20, 'head W/4');
  assert.equal(neg.fill.opacity, 0.1, 'fadenegative');
  assert.equal(neg.line.rgb, 'low', 'more than 2 classes: the darker outline');
  // the positive pointer: up, a band of W/15, the head W/2
  assert.equal(pos.dir, 0);
  near(pos.len, 157.31241827272657 / 20, 'length');
  near(pos.band, 18.177949032707186 / 20, 'band');
  near(pos.head, 136.3346177453039 / 20, 'head');
  near(pos.base[0], (296.61730214827467 + 136.3346177453039 - 430.8904251969181) / 20, 'its width by the value (SIZE)', 1e-3);
  const tx = l.texts[2];
  assert.equal(tx.text, '+25.6 %', 'OFFSETMEAN: signed, valuedecimals');
  assert.equal(tx.angle, 90, 'reading up');
  assert.equal(tx.bg, 'white');
  assert.equal(tx.color, 'black', 'textcolor');
  near(tx.x, (494.30178 - 430.8904251969181) / 20, 'beyond the head', 1e-3);
  near(tx.y, -382.72111 / 20, 'above it', 1e-3);
  assert.equal(l.texts[0].color, 'red', 'a negative value in red');
  near(l.texts[0].opacity, 0.90128, 'faded by √(|v| / max)', 1e-4);
});

test('bar: STACKED is one column, values on leader lines, their share in %', () => {
  const l = flatBarLayout([1, 3], 'CHART|BAR|STACKED|VALUES', { themeMin: 0, themeMax: 4, nClasses: 2, nColors: 2, measure });
  assert.equal(l.bars.length, 2);
  assert.ok(l.bars.every(b => Math.abs(b.base[0] - l.bars[0].base[0]) < 1e-9), 'one column');
  near(l.bars[1].base[1], -l.bars[0].len, 'stacked on the first');
  assert.equal(l.texts[0].text, '1 (25%)');
  assert.equal(l.lines.length, 6, 'three leader segments per value');
});

test('bar: no chart without a size, nor for a single 0', () => {
  assert.equal(flatBarLayout([0], 'CHART|BAR', { themeMin: 0, themeMax: 1 }), null);
  assert.ok(flatBarLayout([0], 'CHART|BAR|ZEROISVALUE', { themeMin: 0, themeMax: 1 }));
  assert.equal(flatBarLayout([0, 0], 'CHART|BAR|SIZE', { themeMin: 0, themeMax: 1 }), null, 'SIZE by a 0 sum');
});

test('bar: NONEGATIVE leaves a negative bar out, NOZERO a 0 one (no gap)', () => {
  const o = { themeMin: -2, themeMax: 2, nClasses: 3, nColors: 3, measure };
  assert.deepEqual(plain(flatBarLayout([1, -1, 2], 'CHART|BAR|NONEGATIVE', o).bars.map(b => b.part)), [0, 2]);
  const z = flatBarLayout([1, 0, 2], 'CHART|BAR|NOZERO', o);
  assert.deepEqual(plain(z.bars.map(b => b.part)), [0, 2]);
  near(z.bars[1].base[0] - z.bars[0].base[0], z.width + 0.05, 'the next bar where the 0 one would be');
  const neg = flatBarLayout([1, -1], 'CHART|BAR', o).bars[1];
  assert.equal(neg.fill.opacity, 0.3, 'a negative plain bar: fill 0.3');
  assert.equal(neg.line.rgb, 'color', 'outlined in its color');
  near(neg.base[1], neg.len, 'below the zero line, drawn upward to it');
});

test('bar: BOX margin and TITLE above the chart (chartBoxLayout)', () => {
  const b = chartBoxLayout([0, -44, 78, 4], { margin: 5, titleFont: 6.5, titleText: 'Türkiye', measure });
  near(b.rect[0], -10, 'margin min(2 m, m · width / 30)');
  near(b.title.baseline, -44 - 0.7 * 6.5, 'the title\'s baseline 0.7 font above');
  near(b.rect[1], -44 - 0.7 * 6.5 - 0.905 * 6.5 + 0.1 * 6.5 - 10, 'the box encloses it, its top trimmed by 0.1 font');
  assert.equal(b.title.anchor, 'start');
  const small = chartBoxLayout([0, 0, 15, 10], { margin: 5, measure });
  near(small.rect[0], -2.5, 'a small chart: a smaller margin');
});

test('bar: an AGGREGATE|CATEGORICAL bar theme prepares its categories like a pie', () => {
  const def = normalizeTheme({ layer: 'x', binding: { position: 'p', value: 'cat', size: 'n' },
    style: { type: HORZ, values: ['a', 'b'], colorscheme: ['#ff0000', '#00ff00'] } });
  const rt = new LayerRuntime(def, { type: 'FeatureCollection', features: [] }, {});
  assert.equal(rt._isBarChart(), true);
  assert.equal(rt._hasAggregatedParts(), true, 'its items aggregated as a pie\'s');
  assert.equal(rt._isPieChart(), false);
});

// XAXIS: flat 23999-24037, measured on index_embed_..._fasi_ritardi_reg_prov_com_9.html
// (stato_reg, Lombardia): bar width 35.257, text "progett." font 17.629 (W·0.5),
// text-anchor:end at translate(20.943, 33.270) rotate(315) — (W/2 + 0.4f)·0.66 and
// 0.66f + 10 (raw; 0.5 u) with f = W (STACKED|gridx: f = 5·sizer = W)
const axisEnd = tx => { const r = tx.angle * Math.PI / 180, w = measure(tx.text, tx.font); return [tx.x + w * Math.cos(r), tx.y - w * Math.sin(r)]; };
test('bar: XAXIS texts below a STACKED gridx chart, one per column, as flat draws them', () => {
  const T = 'CHART|BAR|STACKED|XAXIS|NOSORT|SUM|BOX';
  const l = flatBarLayout([1, 2, 3, 4, 5, 6], T, { themeMin: 0, themeMax: 21, nClasses: 6, nColors: 6, gridX: 3, xaxis: ['pro', 'ass'], measure });
  const W = l.width;
  assert.deepEqual(plain(l.texts.map(t => t.text)), ['pro', 'ass'], 'one per column (index / gridx)');
  const cols = [...new Set(l.bars.map(b => b.base[0]))];
  assert.equal(cols.length, 2);
  l.texts.forEach((tx, k) => {
    assert.equal(tx.angle, 45);
    assert.equal(tx.color, '#888888');
    near(tx.font, W * 0.5, 'half the bar width');
    const [ex, ey] = axisEnd(tx);
    near(ex - (cols[k] - W / 2), 20.942734 / 35.257129 * W, 'ends under its column (flat ratio)');
    near(ey, 0.66 * W + 0.5, 'below the baseline');
  });
  // flat's measured case itself, in u (raw / 20): W = f = 1.7628564
  near(0.66 * (1.7628564 / 2 + 0.4 * 1.7628564), 20.942734 / 20, 'formula vs flat x', 1e-4);
  near(0.66 * 1.7628564 + 0.5, 33.269705 / 20, 'formula vs flat y', 1e-4);
});

test('bar: XAXIS needs the flag and a list, falls back to label, hides with the values', () => {
  const o = { themeMin: 0, themeMax: 4, nClasses: 2, nColors: 2, measure };
  assert.equal(flatBarLayout([1, 3], 'CHART|BAR', Object.assign({ xaxis: ['a', 'b'] }, o)).texts.length, 0, 'no XAXIS flag');
  assert.equal(flatBarLayout([1, 3], 'CHART|BAR|XAXIS', o).texts.length, 0, 'no list');
  assert.deepEqual(plain(flatBarLayout([1, 3], 'CHART|BAR|XAXIS|VALUES', Object.assign({ labels: ['first', 'second'] }, o))
    .texts.filter(t => t.color === '#888888').map(t => t.text)), ['first', 'second'], 'label with VALUES');
  assert.equal(flatBarLayout([1, 3], 'CHART|BAR|XAXIS', Object.assign({ xaxis: ['a1', 'b1'], hideValues: true }, o)).texts.length, 0, 'valueupper/lower');
  const neg = flatBarLayout([1, 3], 'CHART|BAR|XAXIS', Object.assign({}, o, { themeMin: -1, xaxis: ['a1', 'b1'] }));
  assert.deepEqual(plain(neg.texts.map(t => t.angle)), [90, 90], 'negative values: reading up (rotate(270))');
});

// align with gridx (flat maptheme.js 24476-24486): the chart moves sideways only,
// by w = nChartSize·nSizer · parts / classes / gridx — "right" w, "center" w / 2 —
// whatever its height (the bar build passes gridx and that width)
test('bar: align with gridx shifts the chart left by flat\'s width, not by its height', () => {
  const { flatChartAlignOffset } = win.__ixmapsGlInternals;
  const w = 30 * 0.8 * 12 / 12 / 3;
  for (const half of [2, 40]) {
    assert.deepEqual(plain(flatChartAlignOffset({ align: 'right' }, { unit: 1, half, gridx: 3, width: w })), [-w, 0]);
    assert.deepEqual(plain(flatChartAlignOffset({ align: 'center' }, { unit: 1, half, gridx: 3, width: w })), [-w / 2, 0]);
  }
});
