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
  check('no page errors', () => assert.deepEqual(errors, []));
} finally {
  await browser.close(); server.close();
}
done();
