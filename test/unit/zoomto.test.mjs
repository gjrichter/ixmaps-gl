// SHOW / ZOOMTO: flat drops the word from a theme's flag once it zoomed to the
// theme's extent (maptheme.js 8718-8733, removeDefinitionFromFlag 25924), so its
// later /ZOOM/ substring tests no longer read ZOOMTO as ZOOM. flagsWithout makes
// the flag set without the words (a new set: its typeString is fixed).
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
const flagsOf = type => G.normalizeTheme({ layer: 'x', binding: { value: 'v' }, style: { type } }).flags;

test('flagsWithout: drops the words from the set and from typeString', () => {
  const f = flagsOf('CHART|BUBBLE|ZOOMTO|SIZE');
  const g = G.flagsWithout(f, ['SHOW', 'ZOOMTO']);
  assert.equal(g.has('ZOOMTO'), false);
  assert.equal(g.has('BUBBLE'), true);
  assert.equal(g.typeString, 'CHART|BUBBLE|SIZE');
  // the original set is untouched
  assert.equal(f.has('ZOOMTO'), true);
});

test('flagsWithout: a set without the words comes back as is', () => {
  const f = flagsOf('CHART|BUBBLE');
  assert.equal(G.flagsWithout(f, ['SHOW', 'ZOOMTO']), f);
});
