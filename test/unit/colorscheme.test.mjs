// Generated color sweeps (["N", cc1, cc2, nParam1, nParam2]) against the
// REAL ixmaps-flat colorscheme.js, run in node from a sibling
// ixmaps-flat checkout (skipped when it is missing), plus the
// style.classes rewrite of maptheme.js parseStyle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..', '..', 'ixmaps-gl.js');
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
  document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } } };
win.window = win; win.globalThis = win;
vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
const G = win.__ixmapsGlInternals;
const plain = v => JSON.parse(JSON.stringify(v));

const FLAT_COLORSCHEME = [
  path.resolve(HERE, '..', '..', '..', 'ixmaps-flat', 'maps', 'svg', 'js-source', 'colorscheme.js'),
  path.join(os.homedir(), 'Repositories/GitHub/ixmaps-flat/maps/svg/js-source/colorscheme.js'),
].find(p => fs.existsSync(p));
let flat = null;
if (FLAT_COLORSCHEME) {
  const w = { console: { log() {} } };
  w.window = w;
  vm.runInNewContext(fs.readFileSync(FLAT_COLORSCHEME, 'utf8'), w, { filename: 'colorscheme.js' });
  flat = w.ColorScheme;
}
const hex = rgb => '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');

const ends = [['#ffffb2', '#bd0026'], ['#CFFF33', '#9A5195'], ['#0000ff', '#ff0000'], ['#102030', '#304050'], ['#000000', '#ffffff']];
const params = [[], ['linear'], ['dynamic'], ['2colors'], ['3colors', '#94CCC8'], ['3low', '#94CCC8'], ['3high', '#94CCC8'],
  ['2low'], ['2high'], ['2narrow'], ['3narrow', '#ffffff'], ['2wide'], ['3wide', '#808080'], ['#fd8d3c', '#f03b20'],
  ['#00ff00'], ['auto'], ['dynamic', 'shift'], ['3colors', 'warm'], ['2colors', 'cold']];

test('flatColorSweep reproduces real colorscheme.js for every mode, 1-25 steps', { skip: !flat && 'no sibling ixmaps-flat checkout' }, () => {
  let compared = 0;
  for (const [cc1, cc2] of ends) for (const [p1, p2] of params) for (let n = 1; n <= 25; n++) {
    const want = Array.from(flat.createColorScheme(cc1, cc2, n, p1, p2), c => String(c).toLowerCase());
    // flat's hex encoding breaks for a channel outside 0-255 (the narrow/
    // wide sweeps can overshoot); gl clamps — compare only valid output
    if (!want.every(c => /^#[0-9a-f]{6}$/.test(c))) continue;
    const got = Array.from(G.flatColorSweep(cc1, cc2, n, p1, p2), c => hex(Array.from(c)));
    assert.deepEqual(got, want, `${cc1}→${cc2} n=${n} ${p1 || ''} ${p2 || ''}`);
    compared++;
  }
  assert.ok(compared > 2000, `compared ${compared} sweeps`);
});

const PALETTES = ['office', 'mineral', 'pastel', 'harvest', 'fruit', 'kmeans', 'kmeansp', 'pimp', 'intense', 'fluo',
  'tableau', 'tableau10', 'tableau20', 'viridis', 'plasma', 'magma'];
const spellings = n => [n, n.toUpperCase(), n === 'mineral' ? 'Minaral' : n[0].toUpperCase() + n.slice(1)];

test('named palettes reproduce real colorscheme.js: every palette and spelling, 1-30 colors, offsets 0-25', { skip: !flat && 'no sibling ixmaps-flat checkout' }, () => {
  let compared = 0;
  for (const name of PALETTES) for (const sp of spellings(name)) for (let n = 1; n <= 30; n++) for (const off of [undefined, '0', '3', '7', '25']) {
    const want = Array.from(flat.createColorScheme(sp, off, n), c => String(c).toLowerCase());
    const got = Array.from(G.flatColorSweep(sp, off, n), c => hex(Array.from(c)));
    assert.deepEqual(got, want, `${sp} n=${n} offset=${off}`);
    compared++;
  }
  assert.ok(compared > 7000, `compared ${compared} palettes`);
});

test('named palettes: ["9", "tableau"] are the first 9 Tableau colors; spectrum is not ported → null', () => {
  assert.deepEqual(plain(G.flatColorSweep('tableau', undefined, 3)), [[0x4e, 0x79, 0xa7], [0xa0, 0xcb, 0xe8], [0xf2, 0x8e, 0x2b]]);
  assert.equal(G.flatColorSweep('Spectrum', 'dark', 5), null);
});

test('applyClassesToColorScheme: explicit list → [classes, first, last, cs[3], cs[4]] (parseStyle)', () => {
  assert.deepEqual(plain(G.applyClassesToColorScheme(['#a', '#b', '#c', '#d', '#e'], '5')), [5, '#a', '#e', '#d', '#e']);
  assert.deepEqual(plain(G.applyClassesToColorScheme(['#a'], 3)), [3, '#a', '#a']);
  assert.deepEqual(plain(G.applyClassesToColorScheme(['21', '#a', '#b', '3colors', '#c'], 7)), [7, '#a', '#b', '3colors', '#c']);
  assert.deepEqual(plain(G.applyClassesToColorScheme(['#a', '#b'], undefined)), ['#a', '#b'], 'no classes → unchanged');
});

test('resolveClassColors: classes on an explicit list gives flat\'s generated sweep, not the listed colors', () => {
  const cs = ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'];
  const labels = new Array(5).fill('');
  assert.deepEqual(plain(G.resolveClassColors(cs, labels)).map(hex), cs, 'without classes: the list itself');
  const swept = plain(G.resolveClassColors(cs, labels, '5'));
  assert.deepEqual(swept[1], [248, 229, 164], 'dynamic sweep #ffffb2 → #bd0026, step 1 (flat: [248,229,164])');
  if (flat) assert.deepEqual(swept.map(hex), Array.from(flat.createColorScheme('#ffffb2', '#bd0026', 5, '#fd8d3c', '#f03b20'), c => c.toLowerCase()));
});

test('parseCssColor: hex and rgb()/RGB()/rgba() in any case, as the browser reads them in flat\'s SVG', () => {
  assert.deepEqual(plain(G.parseCssColor('RGB(238,217,36)')), [238, 217, 36]);
  assert.deepEqual(plain(G.parseCssColor('rgb( 5, 177, 240 )')), [5, 177, 240]);
  assert.deepEqual(plain(G.parseCssColor('rgba(10,20,30,0.5)')), [10, 20, 30]);
  assert.deepEqual(plain(G.parseCssColor('#abc')), [170, 187, 204]);
  assert.deepEqual(plain(G.parseCssColor('#11223380')), [17, 34, 51], '#rrggbbaa: alpha ignored');
  assert.equal(G.parseCssColor(''), null);
  assert.equal(G.parseCssColor(42), null);
});

test('resolveClassColors: an explicit list with RGB() colors', () => {
  assert.deepEqual(plain(G.resolveClassColors(['RGB(238,217,36)', '#05b1f0'], ['a', 'b'])), [[238, 217, 36], [5, 177, 240]]);
});

test('flatLegendLook: light by default, dark on dark basemaps/colors when the basemap is mostly opaque (flat legend.js)', () => {
  const look = (...a) => plain(G.flatLegendLook(...a));
  assert.deepEqual(look('white', 1), { dark: false, bg: 'rgba(255,255,255,0.9)' }, '"white" is a map type name, not a CSS color, for flat');
  assert.deepEqual(look('VT_BRIGHT_LIGHT', 1), { dark: false, bg: 'rgba(255,255,255,0.9)' });
  assert.deepEqual(look(undefined, 1), { dark: false, bg: 'rgba(255,255,255,0.9)' });
  assert.deepEqual(look('VT_DATAVIZ_DARK', 1), { dark: true, bg: '#111' });
  assert.deepEqual(look('satellite', 1), { dark: true, bg: '#111' });
  assert.deepEqual(look('VT_DATAVIZ_DARK', 0.4), { dark: false, bg: 'rgba(255,255,255,0.9)' }, 'faded dark basemap → light');
  assert.deepEqual(look('#202830', 1), { dark: true, bg: '#202830' }, 'dark CSS color → that color');
  assert.deepEqual(look('#f5f5f0', 1), { dark: false, bg: '#f5f5f0' }, 'light CSS color → that color');
  assert.deepEqual(look('rgba(0,0,0,0.2)', 1), { dark: false, bg: 'rgba(0,0,0,0.2)' }, 'blended against white → light');
  assert.deepEqual(look('VT_DATAVIZ_DARK', 1, '#f5f5f0'), { dark: false, bg: '#f5f5f0' }, 'legendBackground wins');
  assert.deepEqual(look('#0a1420', 0), { dark: true, bg: '#0a1420' }, 'dark CSS color, basemap faded: flat keeps dark text (unreadable) — light text here');
});

test('cssColorAlpha: SVG "none" paints nothing, rgba / #rrggbbaa keep their alpha (flat)', () => {
  assert.equal(G.cssColorAlpha('none'), 0);
  assert.equal(G.cssColorAlpha('rgba(255,255,255,0.5)'), 0.5);
  assert.equal(G.cssColorAlpha('rgba(155, 155, 155, 0.3)'), 0.3);
  assert.equal(G.cssColorAlpha('rgb(1 2 3 / 25%)'), 0.25);
  assert.equal(G.cssColorAlpha('#ff000080'), 128 / 255);
  assert.equal(G.cssColorAlpha('#f008'), 136 / 255);
  assert.equal(G.cssColorAlpha('#5BBBEB'), 1);
  assert.equal(G.cssColorAlpha('rgb(1,2,3)'), 1);
  assert.equal(G.cssColorAlpha('green'), 1);
});

test('legend row labels: values from the data are escaped, the page\'s style.label stays HTML', () => {
  const data = ['<img src=x onerror=alert(1)>', 'A & B'];
  assert.deepEqual(plainArr(G.legendRowLabels({ categoryLabels: data, categoryDisplayLabels: data })),
    ['&lt;img src=x onerror=alert(1)&gt;', 'A &amp; B']);
  assert.deepEqual(plainArr(G.legendRowLabels({ categoryLabels: data, categoryDisplayLabels: ['<b>One</b>', 'Two'] })), ['<b>One</b>', 'Two']);
  assert.equal(G.scaleDenom('1:250000'), 250000);
  assert.equal(G.scaleDenom('250000'), 250000);
  assert.equal(G.scaleDenom(''), 0);
  assert.equal(G.scaleDenom(undefined), 0);
});
function plainArr(a) { return JSON.parse(JSON.stringify(a)); }
