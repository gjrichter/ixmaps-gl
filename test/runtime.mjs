// Live check, in headless Chromium, of changing a built map at runtime: the ways to add a theme after the map
// exists (flat's myMap.layer(theme, "direct") included) and runtime filtering with changeThemeStyle.
// Needs network. Run: node runtime.mjs [--engine ../x.js]
import assert from 'node:assert/strict';
import { serve, launch, reporter } from './live.mjs';

const { server, port } = serve();
const browser = await launch();
const { check, done } = reporter();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const errors = [];
  const warnings = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.goto(`http://localhost:${port}/test/runtime/page.html`);
  await page.waitForFunction(() => window.ixmaps && ixmaps.map('rt').getMapLibre && ixmaps.map('rt').getMapLibre(), null, { timeout: 90000 });
  await page.waitForTimeout(5000);
  const settle = () => page.waitForTimeout(2000);

  // ---- adding a theme to a built map
  const adds = [
    ['myMap.layer(theme, "direct")', () => window.myMap.layer(mk('t1', 9.10, 'a'), 'direct'), 't1'],
    ['myMap.layer(theme)', () => window.myMap.layer(mk('t2', 9.12, 'a')), 't2'],
    ['myMap.then(map => map.layer(theme))', () => window.myMap.then(m => m.layer(mk('t3', 9.14, 'a'))), 't3'],
    ['ixmaps.map().layer(theme)', () => ixmaps.map('rt').layer(mk('t4', 9.16, 'a')), 't4'],
    ['ixmaps.map().add(theme)', () => ixmaps.map('rt').add(mk('t5', 9.18, 'a')), 't5'],
    ['myMap.layer("name").data()…define()', () => window.myMap.layer('t6').data({ obj: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { cat: 'a' }, geometry: { type: 'Point', coordinates: [9.2, 45.46] } }] }, type: 'geojson' }).binding({ geo: 'geometry', value: 'cat' }).type('CHART|DOT|CATEGORICAL|NOLEGEND').style({ colorscheme: ['#d9534f'], values: ['a'] }).meta({ name: 't6' }).define(), 't6']
  ];
  for (const [label, fn, id] of adds) {
    await page.evaluate(fn); await settle();
    const found = await page.evaluate(id => !!ixmaps.getThemeObj(id), id);
    check(`add after build: ${label}`, () => assert.equal(found, true));
  }
  // "replace" swaps the theme of the same id, it does not add a second
  const before = await page.evaluate(() => ixmaps.getThemes().length);
  await page.evaluate(() => ixmaps.map('rt').add(mk('t5', 9.19, 'a'), 'replace')); await settle();
  const afterReplace = await page.evaluate(() => ixmaps.getThemes().length);
  check('add(theme, "replace"): same theme id is swapped, not added twice', () => assert.equal(afterReplace, before));

  // ---- runtime filtering of the "base" theme (points p0:a p1:b p2:b), by which points stay clickable
  await page.evaluate(() => { window.__c = []; ixmaps.map('rt').on('click', e => window.__c.push(e.record && e.record.name)); });
  const at = lngLat => page.evaluate(c => { const q = ixmaps.map('rt').getMapLibre().project(c); const r = document.getElementById('map_div').getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; }, lngLat);
  const clickable = async () => {
    const hit = [];
    for (const [i, lng] of [9.18, 9.20, 9.22].entries()) {
      await page.evaluate(() => { window.__c = []; });
      const p = await at([lng, 45.45]);
      await page.mouse.click(p.x, p.y); await page.waitForTimeout(500);
      if ((await page.evaluate(() => window.__c)).includes('p' + i)) hit.push('p' + i);
    }
    return hit.join(',');
  };
  const run = async fn => { await page.evaluate(fn); await settle(); return clickable(); };
  const all = await clickable();
  check('filter: unfiltered, every point is there', () => assert.equal(all, 'p0,p1,p2'));
  const f1 = await run(() => ixmaps.changeThemeStyle('base', 'filter:WHERE "cat" = "b"', 'set'));
  check('filter: changeThemeStyle(id, "filter:WHERE …", "set")', () => assert.equal(f1, 'p1,p2'));
  const f2 = await run(() => ixmaps.changeThemeStyle('base', 'filter:WHERE "cat" IN (a)', 'set'));
  check('filter: WHERE … IN (…)', () => assert.equal(f2, 'p0'));
  const f3 = await run(() => ixmaps.changeThemeStyle('base', 'filter', 'remove'));
  check('filter: changeThemeStyle(id, "filter", "remove")', () => assert.equal(f3, 'p0,p1,p2'));
  const f4 = await run(() => ixmaps.map('rt').changeThemeStyle('base', 'filter:WHERE "cat" = "a"', 'set'));
  check('filter: through the map handle', () => assert.equal(f4, 'p0'));
  const f5 = await run(() => ixmaps.map('rt').theme('base').changeStyle('filter:WHERE "cat" = "b"', 'set'));
  check('filter: through the theme handle', () => assert.equal(f5, 'p1,p2'));
  const f6 = await run(() => ixmaps.changeThemeStyle(null, 'filter', 'remove'));
  check('filter: id null removes it from every theme', () => assert.equal(f6, 'p0,p1,p2'));
  // ---- a theme loaded with .filter(): a filter changeThemeStyle set survives refreshTheme
  await page.evaluate(() => ixmaps.map('rt').add(mkFiltered('filt', 'WHERE "cat" = "a"'))); await settle();
  const rf0 = await page.evaluate(() => recordNames('filt'));
  check('refresh filter: the definition\'s filter applies', () => assert.equal(rf0, 'q0'));
  await page.evaluate(() => ixmaps.changeThemeStyle('filt', 'filter:WHERE "cat" = "b"', 'set')); await settle();
  const rf1 = await page.evaluate(() => recordNames('filt'));
  check('refresh filter: changeThemeStyle re-filters', () => assert.equal(rf1, 'q1,q2'));
  await page.evaluate(() => ixmaps.map('rt').refreshTheme('filt')); await settle();
  const rf2 = await page.evaluate(() => [recordNames('filt'), ixmaps.getThemeObj('filt').szFilter]);
  check('refresh filter: refreshTheme keeps the runtime filter, not the definition\'s', () => assert.deepEqual(rf2, ['q1,q2', 'WHERE "cat" = "b"']));
  await page.evaluate(() => ixmaps.changeThemeStyle('filt', 'filter', 'remove')); await settle();
  const rf3 = await page.evaluate(() => recordNames('filt'));
  check('refresh filter: removing it after a refresh shows every record', () => assert.equal(rf3, 'q0,q1,q2'));
  await page.evaluate(() => ixmaps.map('rt').removeTheme('filt')); await settle();
  // ---- two in-memory (.obj) themes added at runtime are different data: a facet filter on one stays on it
  await page.evaluate(() => { ixmaps.map('rt').add(mkPts('ob1', 45.465)); ixmaps.map('rt').add(mkPts('ob2', 45.47)); }); await settle();
  const ob0 = await page.evaluate(() => [onMapCount('ob1'), onMapCount('ob2')]);
  check('obj themes: both are on the map', () => assert.deepEqual(ob0, [3, 3]));
  await page.evaluate(() => window.__setFacetFilter('ob1', 'cat', 'a')); await settle();
  const ob1 = await page.evaluate(() => [onMapCount('ob1'), onMapCount('ob2')]);
  check('obj themes: a facet filter on one runtime .obj theme leaves the other alone', () => assert.deepEqual(ob1, [1, 3]));
  await page.evaluate(() => { ixmaps.map('rt').removeTheme('ob1'); ixmaps.map('rt').removeTheme('ob2'); }); await settle();
  // ---- text on a label: a text field as the value warns, style.valuefield does not
  warnings.length = 0;
  await page.evaluate(() => ixmaps.map('rt').add(mkLabel('lab_text_value', 9.1, 'icon')));
  await page.evaluate(() => ixmaps.map('rt').add(mkLabel('lab_valuefield', 9.3, 'n', 'icon')));
  await settle();
  const labelWarnings = warnings.filter(w => /LABEL value field/.test(w));
  check('label: a text field bound as the value warns once, naming style.valuefield', () => {
    assert.equal(labelWarnings.length, 1);
    assert.match(labelWarnings[0], /lab_text_value.*"icon" holds text.*style\.valuefield/);
  });
  check('label: style.valuefield with a numeric value does not warn', () => assert.ok(!labelWarnings.some(w => /lab_valuefield/.test(w))));
  // ---- theme lifecycle: registration by every id, removal, replace in place (pins add/define/remove paths)
  // the real stack (draw/legend) order: the engine's runtimes; getThemes() is registry order
  const order = () => page.evaluate(async () => { const api = await window.myMap; return (api.runtimes || []).map(r => r.name).filter(n => /^lc_/.test(n)).join(','); });
  await page.evaluate(() => {
    const m = ixmaps.map('rt');
    m.add(mk('lc_a', 9.26, 'a'));
    m.add(ixmaps.layer('lc_b', l => l.data({ obj: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { cat: 'b', name: 'lc_b' }, geometry: { type: 'Point', coordinates: [9.27, 45.46] } }] }, type: 'geojson' })
      .binding({ geo: 'geometry', value: 'cat' }).type('CHART|DOT|CATEGORICAL|NOLEGEND').style({ colorscheme: ['#d9534f', '#428bca'], values: ['a', 'b'], name: 'lc_b_style' }).meta({ name: 'lc_b_meta' })));
    m.add(mk('lc_c', 9.28, 'a'));
  }); await settle();
  const lc0 = await page.evaluate(() => ['lc_a', 'lc_b', 'lc_b_meta', 'lc_b_style', 'lc_c'].map(id => { const t = ixmaps.getThemeObj(id); return t ? t.szId : null; }));
  check('lifecycle: themes added at runtime are found by layer name and meta.name (style.name yields to meta.name)', () =>
    assert.deepEqual(lc0, ['lc_a', 'lc_b_meta', 'lc_b_meta', null, 'lc_c']));
  const lcOrder0 = await order();
  check('lifecycle: stack order a, b, c', () => assert.equal(lcOrder0, 'lc_a,lc_b,lc_c'));
  // add(…, "replace") with style.name and meta.name differing: one theme, same stack place
  await page.evaluate(() => ixmaps.map('rt').add(ixmaps.layer('lc_b', l => l.data({ obj: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { cat: 'a', name: 'lc_b2' }, geometry: { type: 'Point', coordinates: [9.27, 45.46] } }] }, type: 'geojson' })
    .binding({ geo: 'geometry', value: 'cat' }).type('CHART|DOT|CATEGORICAL|NOLEGEND').style({ colorscheme: ['#d9534f', '#428bca'], values: ['a', 'b'], name: 'lc_b_style' }).meta({ name: 'lc_b_meta' })), 'replace')); await settle();
  const lcOrder1 = await order();
  const lcRec = await page.evaluate(() => recordNames('lc_b_meta'));
  check('lifecycle: add(theme, "replace") swaps the theme in place, not on top', () => assert.deepEqual([lcOrder1, lcRec], ['lc_a,lc_b,lc_c', 'lc_b2']));
  // replace(id, theme) by meta.name
  await page.evaluate(() => ixmaps.map('rt').replace('lc_a', mk('lc_a', 9.26, 'b'))); await settle();
  const lcOrder2 = await order();
  check('lifecycle: replace(id, theme) keeps the stack place', () => assert.equal(lcOrder2, 'lc_a,lc_b,lc_c'));
  // removal by layer name drops every registry id
  await page.evaluate(() => ixmaps.map('rt').removeTheme('lc_b')); await settle();
  const lc1 = await page.evaluate(() => ['lc_b', 'lc_b_meta'].map(id => !!ixmaps.getThemeObj(id)).concat([ixmaps.map('rt').getThemes().some(t => t.szId === 'lc_b')]));
  check('lifecycle: removeTheme(layer) leaves no registry entry and no runtime', () => assert.deepEqual(lc1, [false, false, false]));
  // removal by meta.name
  await page.evaluate(() => { ixmaps.map('rt').removeTheme('lc_a'); ixmaps.map('rt').removeTheme('lc_c'); }); await settle();
  const lcOrder3 = await order();
  check('lifecycle: every lc_ theme removed', () => assert.equal(lcOrder3, ''));
  // a theme from the Map()'s own definition (build path) is registered like a runtime one
  const lcBase = await page.evaluate(() => { const t = ixmaps.getThemeObj('base'); return t && [t.szId, t.szName]; });
  check('lifecycle: the base theme is registered', () => assert.deepEqual(lcBase, ['base', 'base']));
  // ---- a FEATURE theme out of scale at load shares its URL's data: a facet filter on a chart of that URL reaches it
  await page.evaluate(() => {
    const m = ixmaps.map('rt');
    const url = { url: 'pts.geojson', type: 'geojson' };
    m.add(ixmaps.layer('dchart', l => l.data(url).binding({ geo: 'geometry', value: 'cat' }).type('CHART|DOT|CATEGORICAL|NOLEGEND')
      .style({ colorscheme: ['#d9534f', '#428bca'], values: ['a', 'b'] }).meta({ name: 'dchart' })));
    m.add(ixmaps.layer('dfeat', l => l.data(url).binding({ geo: 'geometry' }).type('FEATURE|NOLEGEND')
      .style({ fillcolor: '#888', featureupper: '1:30000' }).meta({ name: 'dfeat' })));
  }); await settle();
  await page.evaluate(() => window.__setFacetFilter('dchart', 'cat', 'a')); await settle();
  await page.evaluate(async () => (await window.myMap).map.setZoom(14)); await page.waitForTimeout(4000);
  const dk = await page.evaluate(() => [onMapCount('dchart'), onMapCount('dfeat')]);
  check('deferred theme: a facet filter on a same-URL chart reaches a FEATURE theme loaded once in scale', () => assert.deepEqual(dk, [1, 1]));
  await page.evaluate(async () => { ixmaps.map('rt').removeTheme('dchart'); ixmaps.map('rt').removeTheme('dfeat'); (await window.myMap).map.setZoom(12); }); await settle();
  // ---- a deferred theme coming into scale loads only itself, from the data cache
  const dlRequests = [];
  page.on('request', r => { if (/pts\.geojson\?dl$/.test(r.url())) dlRequests.push(r.url()); });
  await page.evaluate(() => {
    const m = ixmaps.map('rt');
    const url = { url: 'pts.geojson?dl', type: 'geojson' };
    m.add(ixmaps.layer('dl', l => l.data(url).binding({ geo: 'geometry', value: 'cat' }).type('CHART|DOT|CATEGORICAL|NOLEGEND')
      .style({ colorscheme: ['#d9534f', '#428bca'], values: ['a', 'b'] }).meta({ name: 'dl_chart' })));
    m.add(ixmaps.layer('dl', l => l.data(url).binding({ geo: 'geometry' }).type('FEATURE|NOLEGEND')
      .style({ fillcolor: '#888', featureupper: '1:30000' }).meta({ name: 'dl_feat' })));
  }); await settle();
  const dlBefore = dlRequests.length;
  await page.evaluate(async () => (await window.myMap).map.setZoom(14)); await page.waitForTimeout(4000);
  const dl = await page.evaluate(() => [onMapCount('dl_chart'), onMapCount('dl_feat')]);
  check('deferred load: the FEATURE theme gets its data once in scale', () => assert.equal(dl[1], 3));
  check('deferred load: it reloads neither its layer\'s other theme nor the data (served from the cache)', () => assert.equal(dlRequests.length - dlBefore, 0));
  await page.evaluate(async () => { ixmaps.map('rt').removeTheme('dl'); (await window.myMap).map.setZoom(12); }); await settle();
  // ---- a CHART theme out of its chartupper range loads no data until it comes into scale (flat's execute() skips it)
  const dcRequests = [];
  page.on('request', r => { if (/pts\.geojson\?dc$/.test(r.url())) dcRequests.push(r.url()); });
  await page.evaluate(() => {
    ixmaps.map('rt').add(ixmaps.layer('dc', l => l.data({ url: 'pts.geojson?dc', type: 'geojson' }).binding({ geo: 'geometry', value: 'cat' })
      .type('CHART|DOT|CATEGORICAL|NOLEGEND').style({ colorscheme: ['#d9534f', '#428bca'], values: ['a', 'b'], chartupper: '1:30000' }).meta({ name: 'dc_chart' })));
  }); await settle();
  const dcRecords = () => page.evaluate(() => { const t = ixmaps.getThemeObj('dc_chart'); return t && t.objTheme ? t.objTheme.dbRecords.length : -1; });
  const dcOut = [dcRequests.length, await dcRecords()];
  check('deferred chart: out of chartupper at load, no data request and no records', () => assert.deepEqual(dcOut, [0, 0]));
  await page.evaluate(async () => (await window.myMap).map.setZoom(14)); await page.waitForTimeout(4000);
  const dcIn = [dcRequests.length, await dcRecords(), await page.evaluate(() => onMapCount('dc_chart'))];
  check('deferred chart: in scale, its data loads once and draws', () => assert.deepEqual(dcIn, [1, 3, 3]));
  await page.evaluate(async () => { ixmaps.map('rt').removeTheme('dc'); (await window.myMap).map.setZoom(12); }); await settle();
  // ---- while a scale-deferred theme's data loads, the loading message says its meta.splash, and goes once it is in
  await page.route(/pts\.geojson\?ds$/, async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue(); });
  await page.evaluate(() => {
    ixmaps.map('rt').add(ixmaps.layer('ds', l => l.data({ url: 'pts.geojson?ds', type: 'geojson' }).binding({ geo: 'geometry', value: 'cat' })
      .type('CHART|DOT|CATEGORICAL|NOLEGEND').style({ colorscheme: ['#d9534f', '#428bca'], values: ['a', 'b'], chartupper: '1:30000' })
      .meta({ name: 'ds_chart', splash: 'scaricando dati ...' })));
  }); await settle();
  const loadingMsg = () => page.evaluate(() => { const e = document.querySelector('.ixmaps-gl-loading');
    return e && e.style.display !== 'none' ? e.querySelector('.ixmaps-gl-loading-text').textContent : null; });
  const dsBefore = await loadingMsg();
  await page.evaluate(async () => (await window.myMap).map.setZoom(14));
  // the message alternates with flat's ' ... ' (see setDataLoading): collect what it says while the data is held
  const dsSeen = new Set();
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(200); const m = await loadingMsg(); if (m) dsSeen.add(m); }
  const dsDuring = dsSeen.has('scaricando dati ...') ? 'scaricando dati ...' : [...dsSeen].join('|');
  await page.waitForTimeout(4000);
  const dsAfter = [await loadingMsg(), await page.evaluate(() => onMapCount('ds_chart'))];
  check('deferred load message: none while the theme is out of scale', () => assert.equal(dsBefore, null));
  check('deferred load message: shows the theme\'s meta.splash while its data loads', () => assert.equal(dsDuring, 'scaricando dati ...'));
  check('deferred load message: gone once the data is in and drawn', () => assert.deepEqual(dsAfter, [null, 3]));
  await page.unroute(/pts\.geojson\?ds$/);
  await page.evaluate(async () => { ixmaps.map('rt').removeTheme('ds'); (await window.myMap).map.setZoom(12); }); await settle();
  // ---- data.preload: a scale-deferred theme's file is downloaded once the map is idle, and not again when it comes into scale
  const dpRequests = [];
  page.on('request', r => { if (/pts\.geojson\?dp$/.test(r.url())) dpRequests.push(r.url()); });
  await page.route(/pts\.geojson\?dp$/, async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
  await page.evaluate(() => {
    ixmaps.map('rt').add(ixmaps.layer('dp', l => l.data({ url: 'pts.geojson?dp', type: 'geojson', preload: true }).binding({ geo: 'geometry', value: 'cat' })
      .type('CHART|DOT|CATEGORICAL|NOLEGEND').style({ colorscheme: ['#d9534f', '#428bca'], values: ['a', 'b'], chartupper: '1:30000' }).meta({ name: 'dp_chart' })));
  }); await settle(); await page.waitForTimeout(2500);
  const dpRecords = () => page.evaluate(() => { const t = ixmaps.getThemeObj('dp_chart'); return t && t.objTheme ? t.objTheme.dbRecords.length : -1; });
  const dpOut = [dpRequests.length, await dpRecords()];
  check('data.preload: out of scale, its file is downloaded once the map is idle, nothing drawn', () => assert.deepEqual(dpOut, [1, 0]));
  await page.evaluate(async () => (await window.myMap).map.setZoom(14)); await page.waitForTimeout(3000);
  const dpIn = [dpRequests.length, await dpRecords(), await page.evaluate(() => onMapCount('dp_chart'))];
  check('data.preload: in scale, it draws from the preloaded file without a second request', () => assert.deepEqual(dpIn, [1, 3, 3]));
  await page.unroute(/pts\.geojson\?dp$/);
  await page.evaluate(async () => { ixmaps.map('rt').removeTheme('dp'); (await window.myMap).map.setZoom(12); }); await settle();
  // ---- a bar's fill is its colorscheme color's alpha × fillopacity (flat: fill rgba + fill-opacity, SVG multiplies them)
  await page.evaluate(() => ixmaps.map('rt').add(ixmaps.layer('ba', l => l.data({ obj: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { x: 3, y: 5 }, geometry: { type: 'Point', coordinates: [9.20, 45.46] } }] }, type: 'geojson' })
    .binding({ geo: 'geometry', value: 'x|y' }).type('CHART|BAR|NOLEGEND')
    .style({ colorscheme: ['RGBA(255,0,0,0.5)', '#0000ff'], fillopacity: 0.8, scale: 2 }).meta({ name: 'ba' })))); await settle();
  const baFills = await page.evaluate(async () => {
    const api = await window.myMap;
    const l = api.overlay._props.layers.flat(Infinity).find(x => x && x.id === 'ix-bar-ba');
    return l ? (l.props.data || []).map(d => [d.fill[0], d.fill[2], d.fill[3]]) : null;
  });
  check('bar fill: an RGBA color keeps its alpha, times fillopacity', () => assert.deepEqual(baFills, [[255, 0, 102], [0, 255, 204]]));
  await page.evaluate(() => ixmaps.map('rt').removeTheme('ba')); await settle();
  // ---- overlapping refreshTheme calls: the newest one's data stays, a slower older answer is dropped
  let raceCalls = 0;
  const raceFc = n => JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) =>
    ({ type: 'Feature', properties: { cat: 'a', name: 'r' + i }, geometry: { type: 'Point', coordinates: [9.18 + i * 0.01, 45.452] } })) });
  await page.route(/race\.geojson/, async route => {
    const call = ++raceCalls;
    if (call === 2) await new Promise(r => setTimeout(r, 2500)); // the first refresh answers late, with old data
    await route.fulfill({ status: 200, contentType: 'application/json', body: raceFc(call === 1 ? 3 : call === 2 ? 1 : 2) });
  });
  await page.evaluate(() => ixmaps.map('rt').add(ixmaps.layer('race', l => l.data({ url: 'race.geojson', type: 'geojson' })
    .binding({ geo: 'geometry', value: 'cat' }).type('CHART|DOT|CATEGORICAL|NOLEGEND').style({ colorscheme: ['#d9534f'], values: ['a'] }).meta({ name: 'race' })))); await settle();
  const race0 = await page.evaluate(() => onMapCount('race'));
  await page.evaluate(() => { const m = ixmaps.map('rt'); m.refreshTheme('race'); setTimeout(() => m.refreshTheme('race'), 300); });
  await page.waitForTimeout(4500);
  const race1 = await page.evaluate(() => onMapCount('race'));
  check('refresh race: the newest refresh\'s data stays when an older one answers last', () => assert.deepEqual([race0, raceCalls, race1], [3, 3, 2]));
  await page.evaluate(() => ixmaps.map('rt').removeTheme('race')); await settle();
  // ---- two overlapping define()s of one theme id: one theme, the newer definition's
  let sdCalls = 0;
  await page.route(/samedef\.geojson/, async route => {
    const call = ++sdCalls;
    if (call === 1) await new Promise(r => setTimeout(r, 2500)); // the first define's data answers late
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection',
      features: Array.from({ length: call }, (_, i) => ({ type: 'Feature', properties: { cat: 'a', name: 's' + i }, geometry: { type: 'Point', coordinates: [9.18 + i * 0.01, 45.458] } })) }) });
  });
  await page.evaluate(() => {
    const def = q => window.myMap.layer('samedef').data({ url: 'samedef.geojson?' + q, type: 'geojson' }).binding({ geo: 'geometry', value: 'cat' })
      .type('CHART|DOT|CATEGORICAL|NOLEGEND').style({ colorscheme: ['#d9534f'], values: ['a'] }).meta({ name: 'samedef' }).define();
    def(1); setTimeout(() => def(2), 300);
  });
  await page.waitForTimeout(4500);
  const sd = await page.evaluate(async () => { const api = await window.myMap; return [api.runtimes.filter(r => r.name === 'samedef').length, onMapCount('samedef')]; });
  check('same-id define: overlapping define()s leave one theme, with the newer definition\'s data', () => assert.deepEqual(sd, [1, 2]));
  // ---- a re-define whose data fails to load leaves the theme it would replace on the map
  await page.route(/samedef_fail\.geojson/, route => route.fulfill({ status: 404, body: 'not found' }));
  await page.evaluate(() => window.myMap.layer('samedef').data({ url: 'samedef_fail.geojson', type: 'geojson' }).binding({ geo: 'geometry', value: 'cat' })
    .type('CHART|DOT|CATEGORICAL|NOLEGEND').style({ colorscheme: ['#d9534f'], values: ['a'] }).meta({ name: 'samedef' }).define().catch(() => {}));
  await page.waitForTimeout(2500);
  const sdFail = await page.evaluate(async () => { const api = await window.myMap; return [api.runtimes.filter(r => r.name === 'samedef').length, onMapCount('samedef')]; });
  check('same-id define: a failed re-define keeps the existing theme', () => assert.deepEqual(sdFail, [1, 2]));
  await page.evaluate(() => ixmaps.map('rt').removeTheme('samedef')); await settle();
  // the deliberately failed load may report a page error of its own; any other error still counts
  for (let i = errors.length - 1; i >= 0; i--) if (/samedef_fail|404/.test(errors[i])) errors.splice(i, 1);
  // ---- ZOOMTO is dropped from the theme's flags once it zoomed (flat): a bubble's labelfield label then shows
  const zt0 = await page.evaluate(async () => (await window.myMap).map.getCenter().toArray());
  await page.evaluate(() => ixmaps.map('rt').add(ixmaps.layer('zt', l => l.data({ obj: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { v: 3, name: 'Zt-one' }, geometry: { type: 'Point', coordinates: [9.50, 45.60] } },
      { type: 'Feature', properties: { v: 5, name: 'Zt-two' }, geometry: { type: 'Point', coordinates: [9.56, 45.64] } }] }, type: 'geojson' })
    .binding({ geo: 'geometry', value: 'v' }).type('CHART|BUBBLE|SIZE|ZOOMTO|NOLEGEND')
    .style({ colorscheme: ['#d9534f'], labelfield: 'name', scale: 3 }).meta({ name: 'zt' })))); await page.waitForTimeout(3000);
  const zt = await page.evaluate(async () => {
    const api = await window.myMap;
    const labels = api.overlay._props.layers.flat(Infinity).filter(l => l && /^ix-labels-zt/.test(l.id));
    return { moved: api.map.getCenter().lng > 9.4, szFlag: ixmaps.getThemeObj('zt').szFlag, labels: labels.reduce((n, l) => n + ((l.props.data || []).length), 0) };
  });
  check('ZOOMTO: the map zooms to the theme', () => assert.equal(zt.moved, true));
  check('ZOOMTO: the flag is gone from the theme once it zoomed, and its labels show', () => assert.deepEqual([/ZOOMTO/.test(zt.szFlag), zt.labels], [false, 2]));
  await page.evaluate(async c => { ixmaps.map('rt').removeTheme('zt'); (await window.myMap).map.jumpTo({ center: c, zoom: 12 }); }, zt0); await settle();
  // ---- an aggregated chart whose records all share one binding.title shows that title (gl), else "(n)" as flat
  const aggTitles = async names => {
    await page.evaluate(names => ixmaps.map('rt').add(ixmaps.layer('at', l => l.data({ obj: { type: 'FeatureCollection', features:
        names.map((name, i) => ({ type: 'Feature', properties: { v: i + 1, name }, geometry: { type: 'Point', coordinates: [9.2 + i * 0.00002, 45.46] } })) }, type: 'geojson' })
      .binding({ geo: 'geometry', value: 'v', title: 'name' }).type('CHART|BAR|AGGREGATE|SUM|RECT|BOX|TITLE|NOLEGEND')
      .style({ colorscheme: ['#428bca'], aggregationscale: ['1:1', '100px'], scale: 2 }).meta({ name: 'at' }))), names); await settle();
    const t = await page.evaluate(async () => {
      const api = await window.myMap;
      const l = api.overlay._props.layers.flat(Infinity).find(x => x && x.id === 'ix-bar-titles-at');
      return l ? (l.props.data || []).map(d => (d.title && d.title.text) || d.text) : null;
    });
    await page.evaluate(() => ixmaps.map('rt').removeTheme('at')); await settle();
    return t;
  };
  const atSame = await aggTitles(['Roma', 'Roma', 'Roma', 'Roma']);
  const atMixed = await aggTitles(['Roma', 'Roma', 'Roma', 'Milano']);
  check('aggregated title: all records share the title → that title; mixed → "(n)"', () => assert.deepEqual([atSame, atMixed], [['Roma'], ['(4)']]));
  // ---- a BAR with CIRCULARBOX gets flat's circle (the shared circle layer), not the rectangle shape
  const barBox = async type => {
    await page.evaluate(type => ixmaps.map('rt').add(ixmaps.layer('cb', l => l.data({ obj: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { x: 3, y: 5, name: 'Cb' }, geometry: { type: 'Point', coordinates: [9.20, 45.46] } }] }, type: 'geojson' })
      .binding({ geo: 'geometry', value: 'x|y', title: 'name' }).type(type)
      .style({ colorscheme: ['#d9534f', '#428bca'], boxcolor: '#ffffff', boxopacity: 0.5, bordercolor: '#2770b6', scale: 2 }).meta({ name: 'cb' }))), type); await settle();
    const r = await page.evaluate(async () => {
      const ls = (await window.myMap).overlay._props.layers.flat(Infinity);
      const circle = ls.find(x => x && x.id === 'ix-bar-box-cb'), bars = ls.find(x => x && x.id === 'ix-bar-cb');
      return [circle ? circle.props.data.length : 0, bars ? bars.props.data.length : 0, ls.findIndex(x => x && x.id === 'ix-bar-box-cb') < ls.findIndex(x => x && x.id === 'ix-bar-cb')];
    });
    await page.evaluate(() => ixmaps.map('rt').removeTheme('cb')); await settle();
    return r;
  };
  const cbCircle = await barBox('CHART|BAR|BOX|CIRCULARBOX|TITLE|NOLEGEND');
  const cbRect = await barBox('CHART|BAR|BOX|TITLE|NOLEGEND');
  check('bar CIRCULARBOX: one circle under the bars, no box shape; BOX alone keeps its rectangle shape',
    () => assert.deepEqual([cbCircle, cbRect.slice(0, 2)], [[1, 2, true], [0, 3]]));
  // ---- htmlgui_onDrawTheme: a burst of changeThemeStyle calls in one task gives each shown theme ONE hook call (flat draws, then calls it)
  await page.evaluate(() => ixmaps.map('rt').add(ixmaps.layer('hk', l => l.data({ obj: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { v: 3 }, geometry: { type: 'Point', coordinates: [9.20, 45.46] } }] }, type: 'geojson' })
    .binding({ geo: 'geometry', value: 'v' }).type('CHART|BUBBLE|SIZE|NOLEGEND').style({ colorscheme: ['#d9534f'] }).meta({ name: 'hk' })))); await settle();
  const hk = await page.evaluate(async () => {
    const calls = []; const prev = ixmaps.htmlgui_onDrawTheme;
    ixmaps.htmlgui_onDrawTheme = id => { calls.push(id); };
    ixmaps.changeThemeStyle(null, 'hk', 'opacity:0.5', 'set');
    ixmaps.changeThemeStyle(null, 'hk', 'opacity:0.6', 'set');
    ixmaps.changeThemeStyle(null, 'hk', 'opacity:0.7', 'set');
    const sync = calls.length;
    await new Promise(r => setTimeout(r, 50));
    ixmaps.htmlgui_onDrawTheme = prev;
    return [sync, calls.filter(id => id === 'hk').length];
  });
  check('htmlgui_onDrawTheme: three changeThemeStyle calls in one task → one hook call for the theme, after the task', () => assert.deepEqual(hk, [0, 1]));
  await page.evaluate(() => ixmaps.map('rt').removeTheme('hk')); await settle();
  // ---- a page legend (.legend(html)) is laid out as flat's legend pane: left-aligned in its base font, whatever the page's body says
  const lp = await browser.newPage({ viewport: { width: 900, height: 650 } });
  await lp.route(/runtime\/page\.html/, async r => { const resp = await r.fetch(); const html = (await resp.text())
    .replace('<style>', '<style>body { text-align: center; } ')
    .replace('.view([45.46, 9.2], 12);', '.view([45.46, 9.2], 12).legend("<h1>Legend</h1><ul><li>item</li></ul>");')
    .replace('name: "rt" }', 'name: "rt", align: "right" }');
    r.fulfill({ response: resp, body: html }); });
  await lp.goto(`http://localhost:${port}/test/runtime/page.html?legend`); await lp.waitForTimeout(4000);
  const lg = await lp.evaluate(() => { const e = document.querySelector('.ix-page-legend'); if (!e) return null;
    const cs = x => getComputedStyle(x); return [cs(e.querySelector('li')).textAlign, cs(e.querySelector('li')).fontSize, cs(e).lineHeight, cs(e.querySelector('li')).color,
      cs(e).width, cs(e).top, cs(e).right, cs(e).backgroundColor, cs(e).borderRadius]; });
  await lp.close();
  check('page legend: left-aligned, 14px, normal line height, #444, in flat\'s pane box (align right: 300px at top 11, right 4% - 4px, white 0.9, 0.5em radius)',
    () => assert.deepEqual(lg, ['left', '14px', 'normal', 'rgb(68, 68, 68)', '300px', '11px', (900 * 0.04 - 4) + 'px', 'rgba(255, 255, 255, 0.9)', '7px']));
  check('no page errors', () => assert.deepEqual(errors, []));
} finally {
  await browser.close(); server.close();
}
done();
