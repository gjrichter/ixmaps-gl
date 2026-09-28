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

// ---- broker scripts (data.type "ext")

function brokerEngine(scripts) {
  const e = loadEngine(scripts);
  // data.js stand-in: a Table is anything with json(); Data.object parses "csv"
  e.win.Data = {
    object: ({ source }) => ({ import: cb => cb({ json: () => String(source).trim().split('\n').slice(1).map(l => { const [k, v] = l.split(','); return { k, v: Number(v) }; }) }) }),
    Table: function (o) { this.o = o; this.json = () => o.records; },
  };
  e.win.setTimeout = setTimeout; e.win.clearTimeout = clearTimeout;
  return e;
}
const brokerSpec = (G, def) => G.normalizeTheme(G.projectThemeToDefinition(def));

test('broker: a trusted script loads its data, hands it over by name, and its theme writes are applied', async () => {
  const B = 'https://gjrichter.github.io/viz/broker.js';
  const e = brokerEngine({
    [B]: `ixmaps.COVID_LAST = function (theme, options) {
      setTimeout(function () {
        theme.szFields = "2020-03-02"; theme.szFieldsA = ["2020-03-02"]; theme.szSnippet = "aggiornato al 2020-03-02";
        theme.style.colorscheme = ["#ff0000"];
        ixmaps.setExternalData("k,v\\na,1\\nb,2", { type: "csv", name: options.name });
      }, 5);
    };`,
  });
  const def = { layer: 'x', type: 'CHART|BUBBLE', field: '$item$', style: { dbtable: 'COVID_LAST', dbtableType: 'ext', dbtableExt: B, lookupfield: 'lat|lon' } };
  const spec = brokerSpec(e, def);
  const { rows, patch } = await e.loadBrokerData(spec, { trustedscripts: ['https://gjrichter.github.io/'] });
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ k: 'a', v: 1 }, { k: 'b', v: 2 }]);
  const spec2 = e.normalizeTheme(e.applyBrokerThemePatch(e.projectThemeToDefinition(def), patch));
  assert.equal(spec2.binding.value, '2020-03-02', 'the field the broker set wins over the project\'s field');
  assert.equal(spec2.meta.snippet, 'aggiornato al 2020-03-02');
  assert.deepEqual(JSON.parse(JSON.stringify(spec2.style.colorscheme)), ['#ff0000']);
  assert.equal(spec2.binding.position, 'lat|lon', 'the position binding is untouched');
});

test('broker: setProperties / style.setProperties (flat MapTheme API) are applied as fields and style keys', async () => {
  const B = 'https://gjrichter.github.io/viz/b2.js';
  const e = brokerEngine({
    [B]: `ixmaps.ODS = function (theme, options) {
      options.theme.setProperties({ fields: "a|b", field100: "tot" });
      options.theme.style.setProperties({ snippet: "al 2021-01-01", xaxis: "x1|x2" });
      ixmaps.setExternalData({ records: [{ a: 1 }] }, { type: "jsonDB", name: "ODS" });
    };`,
  });
  const def = { layer: 'x', type: 'CHART|BUBBLE', binding: { value: 'old', geo: 'lat|lon' }, data: { name: 'ODS', type: 'ext', ext: B } };
  const { rows, patch } = await e.loadBrokerData(brokerSpec(e, def), { trustedscripts: ['https://gjrichter.github.io/viz/'] });
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ a: 1 }], 'jsonDB → data.js Table');
  const spec2 = e.normalizeTheme(e.applyBrokerThemePatch(e.projectThemeToDefinition(def), patch));
  assert.equal(spec2.binding.value, 'a|b', 'binding.value "old" replaced');
  assert.equal(spec2.binding.field100, 'tot');
  assert.equal(spec2.meta.snippet, 'al 2021-01-01');
  assert.equal(spec2.style.xaxis, 'x1|x2');
});

test('broker: an untrusted script is not fetched; a page-defined ixmaps.<name> (no data.ext) runs without trust', async () => {
  const B = 'https://other.example.com/b.js';
  const e = brokerEngine({ [B]: 'ixmaps.X = function () {};' });
  const spec = brokerSpec(e, { layer: 'x', type: 'CHART|BUBBLE', data: { name: 'X', type: 'ext', ext: B } });
  await assert.rejects(e.loadBrokerData(spec, { trustedscripts: ['https://gjrichter.github.io/'] }), /not run — not under \.options\(\{trustedscripts/);
  assert.equal(e.fetched.length, 0);
  e.win.ixmaps.PAGEFN = function (theme, options) { e.win.ixmaps.setExternalData({ records: [{ n: 1 }] }, { type: 'jsondb', name: options.name }); };
  const pspec = brokerSpec(e, { layer: 'y', type: 'CHART|BUBBLE', data: { name: 'PAGEFN', type: 'ext' } });
  const { rows } = await e.loadBrokerData(pspec, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ n: 1 }]);
});

test('broker: missing data.name or a script that defines no function are errors', async () => {
  const B = 'https://gjrichter.github.io/viz/none.js';
  const e = brokerEngine({ [B]: '/* nothing */' });
  const trusted = { trustedscripts: ['https://gjrichter.github.io/'] };
  await assert.rejects(e.loadBrokerData(brokerSpec(e, { layer: 'x', data: { type: 'ext', ext: B } }), trusted), /needs data\.name/);
  await assert.rejects(e.loadBrokerData(brokerSpec(e, { layer: 'x', data: { name: 'Nope', type: 'ext', ext: B } }), trusted), /ixmaps\.Nope is not a function/);
});

test('setExternalData publishes the data by name as window[name], as flat, also without a waiting broker', async () => {
  const e = brokerEngine({});
  e.win.ixmaps.setExternalData({ records: [{ n: 1 }] }, { type: 'jsondb', name: 'nobody' });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(typeof e.win.nobody.json, 'function', 'a data.js Table under its name');
  assert.deepEqual(JSON.parse(JSON.stringify(e.win.nobody.json())), [{ n: 1 }]);
  assert.ok(!e.warnings.some(w => w.includes('no pending')));
});

test('broker: data.query is registered as ixmaps.<name> and called with the theme\'s data options', async () => {
  const e = brokerEngine({});
  const query = function (theme, options) {
    ixmaps.setExternalData({ records: [{ got: options.name, url: options.url }] }, { type: 'jsondb', name: options.name });
  };
  const spec = brokerSpec(e, { layer: 'x', type: 'CHART|BUBBLE', data: { name: 'qdata', query: query.toString(), url: 'u.csv' } });
  const { rows, table } = await e.loadBrokerData(spec, undefined);
  assert.equal(typeof e.win.ixmaps.qdata, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ got: 'qdata', url: 'u.csv' }]);
  assert.equal(e.win.qdata, table, 'the table is also window.qdata');
});

test('broker: without a script, a project can\'t call ixmaps-gl\'s own API by name', async () => {
  const e = brokerEngine({});
  for (const name of ['loadProject', 'Map', 'layer', 'setExternalData', 'setProjectJSON']) {
    await assert.rejects(e.loadBrokerData(brokerSpec(e, { layer: 'x', data: { name, type: 'ext' } }), undefined), /is an ixmaps-gl API function/, name);
  }
});
