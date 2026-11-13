// Live check of the value a USER chart (style.userdraw) gets over several value fields with
// DIFFERENCE|RELATIVE|AGGREGATE — the censimenti page's population change: the chart's value is the
// relative change of the cell's summed fields, never the raw first field of one record (v0.2.33-0.2.45
// handed the chart the 2011 population, drawn as "+1.421%").
// Needs network (MapLibre / deck.gl from unpkg). Run: node userchart.mjs [--engine ../x.js]
import assert from 'node:assert/strict';
import { serve, launch, reporter } from './live.mjs';

const { server, port } = serve();
const browser = await launch();
const { check, done } = reporter();
const round = v => Math.round(v * 1000) / 1000;
const pct = (a, b) => round((b - a) / a * 100);
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${port}/test/userchart/page.html`);
  await page.waitForFunction(() => window.__charts && window.__charts.length > 0, null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  const drawn = () => page.evaluate(() => window.__charts.map(c => Math.round(c.value * 1000) / 1000));
  const reset = () => page.evaluate(() => { window.__charts = []; });

  // zoom 8: p0 and p1 share a cell — the change of their sums (1500 -> 1600), p2 on its own
  const z8 = [...new Set(await drawn())].sort((x, y) => x - y);
  check('aggregated cell: chart value is the relative change of the summed fields', () =>
    assert.deepEqual(z8, [pct(200, 150), pct(1500, 1600)].sort((x, y) => x - y)));

  // zoom in: the cells split, each record's own change
  await reset();
  await page.evaluate(() => ixmaps.map('uc').getMapLibre().jumpTo({ center: [9.2005, 45.46], zoom: 17 }));
  await page.waitForFunction(() => window.__charts.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  const z17 = [...new Set(await drawn())].sort((x, y) => x - y);
  check('zoomed in: each record\'s own relative change', () =>
    assert.deepEqual(z17, [pct(1000, 900), pct(500, 700)].sort((x, y) => x - y)));

  check('no page errors', () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.close();
}
done();
