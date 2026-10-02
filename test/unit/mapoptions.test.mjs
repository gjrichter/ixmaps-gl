// The `legend` map option as flat reads it (htmlgui_flat.js 748-794) — also what the runtime
// map.setLegend(value) accepts.
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

test('legend on: any given value except false / "false" / 0', () => {
  for (const v of [true, 'true', 'open', 'closed', '', 1]) assert.equal(G.legendIsOn(v), true, JSON.stringify(v));
  for (const v of [undefined, null, false, 'false', 0, '0']) assert.equal(G.legendIsOn(v), false, JSON.stringify(v));
});
