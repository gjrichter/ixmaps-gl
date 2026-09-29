// The engine's version constant is the package's: a release bumps both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
  document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } } };
win.window = win; win.globalThis = win;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ixmaps-gl.js'), 'utf8'), win, { filename: 'ixmaps-gl.js' });

test('version: IXMAPS_GL_VERSION and ixmaps.glVersion equal package.json "version"', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(win.__ixmapsGlInternals.IXMAPS_GL_VERSION, pkg.version);
  assert.equal(win.ixmaps.glVersion, pkg.version);
});
