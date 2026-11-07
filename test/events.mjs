// Live check of the map events (flat's mapApi.on/off) in headless Chromium: item click for a theme bound by
// geometry only, mapclick, onItemAction's position on a background click, layerdraw / ready payloads,
// viewchange/zoomend flags, off(), and that a drag is not a click.
// Needs network (MapLibre / deck.gl from unpkg, basemap tiles). Run: node events.mjs [--engine ../x.js]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineArg = process.argv.indexOf('--engine');
const engine = engineArg > 0 ? path.resolve(process.argv[engineArg + 1]) : path.join(root, 'ixmaps-gl.js');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/ixmaps-gl.js' ? engine : path.join(root, url);
  if (!file.startsWith(root) && file !== engine) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'text/javascript' }).end(buf);
  });
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { failed++; console.log('FAIL ', name, '—', e.message); } };
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${port}/test/events/page.html`);
  await page.waitForFunction(() => window.ixmaps && ixmaps.map('evmap').getMapLibre && ixmaps.map('evmap').getMapLibre(), null, { timeout: 90000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    window.__ev = []; window.__act = [];
    const h = ixmaps.map('evmap');
    window.__h = e => window.__ev.push(JSON.parse(JSON.stringify(e)));
    h.on('ready click mapclick layerdraw viewchange zoomend moveend', window.__h);
    ixmaps.onItemAction = (...a) => window.__act.push(JSON.parse(JSON.stringify(a)));
  });
  const clear = () => page.evaluate(() => { window.__ev = []; window.__act = []; });
  const events = type => page.evaluate(t => window.__ev.filter(e => e.type === t), type);
  const at = lngLat => page.evaluate(c => { const p = ixmaps.map('evmap').getMapLibre().project(c); const r = document.getElementById('map_div').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, lngLat);

  // ready: a handler added after the map is up is still called
  await page.evaluate(() => ixmaps.map('evmap').on('ready', e => window.__ev.push(JSON.parse(JSON.stringify(e)))));
  await page.waitForTimeout(300);
  const ready = await events('ready');
  check('ready: called for a late handler, with szMap', () => { assert.ok(ready.length >= 1); assert.equal(ready[0].szMap, 'evmap'); });

  // click on an item of a geometry-only theme
  await clear();
  const pt = await at([9.20, 45.47]);
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(800);
  const click = await events('click');
  const mapclick = await events('mapclick');
  const actAfterItem = await page.evaluate(() => window.__act);
  check('item click fires for a geometry-only theme (no id binding)', () => assert.equal(click.length, 1));
  check('item click payload: szId theme::key, id, theme, record, lngLat, point, szMap', () => {
    const c = click[0];
    assert.equal(c.theme, 'pts');
    assert.equal(c.szId, 'pts::' + c.id);
    assert.equal(c.id, '9.2,45.47');
    assert.equal(c.record.name, 'p1');
    assert.ok(c.lngLat && c.point);
    assert.equal(c.szMap, 'evmap');
  });
  check('mapclick also fires on an item, with the position', () => { assert.equal(mapclick.length, 1); assert.ok(Math.abs(mapclick[0].lngLat.lng - 9.2) < 1e-3); });
  check('onItemAction is not called for an item without a selection value', () => assert.equal(actAfterItem.length, 0));

  // background click: onItemAction(null, null, {lngLat, point}); no item click
  await clear();
  await page.mouse.click(60, 60); await page.waitForTimeout(800);
  const act = await page.evaluate(() => window.__act);
  const bgClicks = await events('click');
  check('background click: onItemAction(null, null, {lngLat, point})', () => {
    assert.equal(act.length, 1); assert.equal(act[0][0], null); assert.equal(act[0][1], null);
    assert.ok(act[0][2] && act[0][2].lngLat && act[0][2].point);
  });
  check('background click: no item click', () => assert.equal(bgClicks.length, 0));

  // a drag is not a click
  await clear();
  await page.mouse.move(300, 300); await page.mouse.down(); await page.mouse.move(380, 340, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(800);
  const dragClicks = (await events('mapclick')).length + (await events('click')).length;
  const vc = await events('viewchange'), me = await events('moveend');
  check('drag: no click, no mapclick', () => assert.equal(dragClicks, 0));
  check('pan: viewchange + moveend with flags and szMap', () => {
    assert.ok(vc.length >= 1 && me.length >= 1);
    assert.equal(me[0].panChanged, true); assert.equal(me[0].zoomChanged, false); assert.equal(me[0].szMap, 'evmap');
  });

  // zoom
  await clear();
  await page.mouse.wheel(0, -400); await page.waitForTimeout(1500);
  const ze = await events('zoomend');
  const ld = await events('layerdraw');
  check('zoom: zoomend with zoomChanged and nZoom', () => { assert.ok(ze.length >= 1); assert.equal(ze[0].zoomChanged, true); assert.equal(typeof ze[0].nZoom, 'number'); });
  check('layerdraw payload: type, szId, id, szMap', () => {
    assert.ok(ld.length >= 1);
    assert.deepEqual(ld[0], { type: 'layerdraw', szId: 'pts', id: 'pts', szMap: 'evmap' });
  });

  // off(): no more events for that handler
  await page.evaluate(() => ixmaps.map('evmap').off('ready click mapclick layerdraw viewchange zoomend moveend', window.__h));
  await clear();
  await page.mouse.wheel(0, 300); await page.waitForTimeout(1200);
  await page.mouse.click(60, 60); await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__ev.filter(e => e.type !== 'ready'));
  check('off(): the handler gets nothing more (view, click, layerdraw)', () => assert.deepEqual(after, []));
  check('no page errors', () => assert.deepEqual(errors, []));
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
