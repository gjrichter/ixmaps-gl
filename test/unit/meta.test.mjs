// meta ↔ style in normalizeTheme, as real ixmaps-flat does it (htmlgui.js
// newTheme): .meta() is merged into style first (meta wins), and the meta
// vocabulary (title, tooltip, name, snippet, description) can be given on
// either side.
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
const { normalizeTheme } = win.__ixmapsGlInternals;
const n = (style, meta, binding) => normalizeTheme({ layer: 'x', style, meta, binding });

test('a style property given in .meta() becomes a style property', () => {
  assert.equal(n({}, { fillopacity: 0.5 }).style.fillopacity, 0.5);
  assert.equal(n({}, { colorscheme: ['#f00'] }).style.colorscheme[0], '#f00');
});

test('.meta() wins over .style() for the same key', () => {
  assert.equal(n({ fillopacity: 0.8 }, { fillopacity: 0.5 }).style.fillopacity, 0.5);
  assert.equal(n({ tooltip: 'S' }, { tooltip: 'M' }).meta.tooltip, 'M');
});

test('meta keys given in .style() fill meta (tooltip, name, snippet, description, title)', () => {
  const spec = n({ tooltip: 'T', name: 'N', snippet: 'S', description: 'D', title: 'H' }, {});
  assert.equal(spec.meta.tooltip, 'T');
  assert.equal(spec.meta.name, 'N');
  assert.equal(spec.meta.snippet, 'S');
  assert.equal(spec.meta.description, 'D');
  assert.equal(spec.meta.title, 'H');
});

test('.meta() keys stay in meta', () => {
  const spec = n({}, { tooltip: 'T', title: 'H' });
  assert.equal(spec.meta.tooltip, 'T');
  assert.equal(spec.meta.title, 'H');
});

test('the type can come from .meta() too (flat merges before reading it)', () => {
  assert.ok(n({ type: 'DOT' }, { type: 'CHART|BUBBLE' }).flags.has('SYMBOL'));
});

test('a binding target given in .meta() counts; a real binding still wins (flat: style < meta < binding)', () => {
  assert.equal(n({}, { sizefield: 'M' }).binding.size, 'M');
  assert.equal(n({ sizefield: 'S' }, { sizefield: 'M' }).binding.size, 'M');
  assert.equal(n({}, { sizefield: 'M' }, { size: 'B' }).binding.size, 'B');
});

test('the page\'s own style and meta objects are not mutated', () => {
  const s = { tooltip: 'T' }, m = { fillopacity: 0.5 };
  const before = JSON.stringify([s, m]);
  n(s, m);
  assert.equal(JSON.stringify([s, m]), before);
});
