// Project processing scripts (data.ext): the trustedscripts opt-in (URL
// prefix check) and flat's ixmaps.<name>.after/.process contract, run
// against the real ixmaps-gl.js in a Node vm with a mocked fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');

function loadEngine(scripts = {}) {
  const warnings = [], fetched = [];
  const win = {
    console: { info() {}, warn: (...a) => warnings.push(a.join(' ')), log() {}, error() {} },
    location: { search: '' },
    document: { baseURI: 'https://maps.example.org/app/page.html', styleSheets: [], createElement: () => ({}), head: { appendChild() {} } },
    fetch: async url => {
      fetched.push(url);
      return url in scripts ? { ok: true, text: async () => scripts[url] } : { ok: false, status: 404 };
    },
    URL,
  };
  win.window = win; win.globalThis = win;
  vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
  return { ...win.__ixmapsGlInternals, win, warnings, fetched };
}

test('resolveScriptUrl: against the page; a bare name gets ".js" (flat: story-root name)', () => {
  const { resolveScriptUrl } = loadEngine();
  assert.equal(resolveScriptUrl('process_data'), 'https://maps.example.org/app/process_data.js');
  assert.equal(resolveScriptUrl('../../projects/x/dataprovider.js'), 'https://maps.example.org/projects/x/dataprovider.js');
  assert.equal(resolveScriptUrl('https://gjrichter.github.io/viz/a/p.js'), 'https://gjrichter.github.io/viz/a/p.js');
});

test('isTrustedScriptUrl: off without a list; prefixes match whole path segments only', () => {
  const { isTrustedScriptUrl } = loadEngine();
  const url = 'https://raw.githubusercontent.com/gjrichter/viz/master/p.js';
  assert.equal(isTrustedScriptUrl(url, undefined), false, 'no option → nothing runs');
  assert.equal(isTrustedScriptUrl(url, []), false);
  assert.equal(isTrustedScriptUrl(url, true), false, 'true is not a list — no built-in prefixes');
  assert.equal(isTrustedScriptUrl(url, ['https://raw.githubusercontent.com/gjrichter/']), true);
  assert.equal(isTrustedScriptUrl(url, ['https://raw.githubusercontent.com/gjrichter']), true, 'no trailing slash: still a segment boundary');
  assert.equal(isTrustedScriptUrl('https://raw.githubusercontent.com/gjrichter-evil/x.js', ['https://raw.githubusercontent.com/gjrichter']), false);
  assert.equal(isTrustedScriptUrl('https://gjrichter.github.io.evil.com/x.js', ['https://gjrichter.github.io']), false, 'origin prefix gets its "/"');
  assert.equal(isTrustedScriptUrl(new URL('https://gjrichter.github.io/viz/../evil/x.js').href, ['https://gjrichter.github.io/viz/']), false, '".." resolved first');
  assert.equal(isTrustedScriptUrl('https://maps.example.org/app/p.js', ['/app/']), true, 'a relative prefix resolves against the page');
});

test('loadProcessingScript: untrusted → null, warned once, nothing fetched', async () => {
  const { loadProcessingScript, warnings, fetched } = loadEngine();
  const cfg = { name: 'themeDataObj', type: 'csv', url: 'd.csv', ext: 'https://other.example.com/p.js' };
  assert.equal(await loadProcessingScript(cfg, ['https://gjrichter.github.io/']), null);
  assert.equal(await loadProcessingScript(cfg, undefined), null);
  assert.equal(fetched.length, 0);
  assert.equal(warnings.filter(w => w.includes('other.example.com/p.js') && w.includes('trustedscripts')).length, 1);
});

test('loadProcessingScript: brokers (type "ext") and inline functions are not this step', async () => {
  const { loadProcessingScript, fetched } = loadEngine();
  const trusted = ['https://gjrichter.github.io/'];
  assert.equal(await loadProcessingScript({ name: 'X', type: 'ext', ext: 'https://gjrichter.github.io/b.js' }, trusted), null);
  assert.equal(await loadProcessingScript({ name: 'X', type: 'csv', ext: 'function (t) { return t; }' }, trusted), null);
  assert.equal(fetched.length, 0);
});

test('loadProcessingScript: a trusted script runs flat\'s contract — .after before .process, return replaces the table', async () => {
  const P = 'https://gjrichter.github.io/viz/p.js', A = 'https://gjrichter.github.io/viz/a.js';
  const { loadProcessingScript } = loadEngine({
    [P]: 'window.ixmaps = window.ixmaps || {}; ixmaps.T = ixmaps.T || {}; ixmaps.T.process = function (t, o) { return { rows: t.rows.filter(r => r.k > 1), opt: o.name }; };',
    [A]: 'ixmaps.U = { after: function (t) { t.tag = "after"; }, process: function () { return "wrong"; } };',
  });
  const trusted = ['https://gjrichter.github.io/viz/'];
  const run = await loadProcessingScript({ name: 'T', type: 'csv', url: 'd.csv', ext: P }, trusted);
  assert.deepEqual(JSON.parse(JSON.stringify(run({ rows: [{ k: 1 }, { k: 2 }] }))), { rows: [{ k: 2 }], opt: 'T' });
  const runA = await loadProcessingScript({ name: 'U', type: 'csv', ext: A }, trusted);
  const t = { rows: [] };
  assert.equal(runA(t), t, 'after() returning nothing keeps the (changed) table');
  assert.equal(t.tag, 'after');
});

test('loadProcessingScript: two scripts defining the same ixmaps.<name>.process each get their own', async () => {
  const A = 'https://gjrichter.github.io/viz/campania.js', B = 'https://gjrichter.github.io/viz/marche.js';
  const { loadProcessingScript, fetched } = loadEngine({
    [A]: 'ixmaps.themeDataObj = { process: function () { return "campania"; } };',
    [B]: 'ixmaps.themeDataObj = { process: function () { return "marche"; } };',
  });
  const trusted = ['https://gjrichter.github.io/'];
  const runA = await loadProcessingScript({ name: 'themeDataObj', type: 'csv', ext: A }, trusted);
  const runB = await loadProcessingScript({ name: 'themeDataObj', type: 'csv', ext: B }, trusted);
  assert.equal(runA({}), 'campania', 'loaded first, called last — still its own function');
  assert.equal(runB({}), 'marche');
  await loadProcessingScript({ name: 'themeDataObj', type: 'csv', ext: A }, trusted);
  assert.equal(fetched.filter(u => u === A).length, 1, 'script text fetched once per URL');
});

test('loadProcessingScript: missing data.name or missing process function are errors, not silent', async () => {
  const P = 'https://gjrichter.github.io/viz/empty.js';
  const { loadProcessingScript } = loadEngine({ [P]: '/* defines nothing */' });
  const trusted = ['https://gjrichter.github.io/'];
  await assert.rejects(loadProcessingScript({ type: 'csv', ext: P }, trusted), /needs data\.name/);
  const run = await loadProcessingScript({ name: 'Nope', type: 'csv', ext: P }, trusted);
  assert.throws(() => run({}), /defines neither ixmaps\.Nope\.after nor ixmaps\.Nope\.process/);
});
