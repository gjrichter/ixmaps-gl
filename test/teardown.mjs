// Live check of a map built again in the same div (a page switching its data by calling ixmaps.Map() anew):
// the previous map is shut down — one MapLibre canvas in the div, no growing number of live WebGL
// contexts, window resize listeners, repaint loops or timers — and the new map works.
// Needs network (MapLibre / deck.gl from unpkg). Run: node teardown.mjs [--engine ../x.js]
import assert from 'node:assert/strict';
import { serve, launch, reporter } from './live.mjs';

const { server, port } = serve();
const browser = await launch();
const { check, done } = reporter();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // count what pages and maps attach to the window, and the WebGL contexts made
  await page.addInitScript(() => {
    const resize = new Set();
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
    window.addEventListener = (t, fn, o) => { if (t === 'resize') resize.add(fn); return add(t, fn, o); };
    window.removeEventListener = (t, fn, o) => { if (t === 'resize') resize.delete(fn); return remove(t, fn, o); };
    const contexts = [];
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) {
      const c = getContext.call(this, type, ...a);
      if (c && /webgl/.test(type) && !contexts.includes(c)) contexts.push(c);
      return c;
    };
    const divListeners = new Set();
    const tAdd = EventTarget.prototype.addEventListener, tRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (t, fn, o) { if (this.id === 'map_div' && /^(mousedown|contextmenu)$/.test(t)) divListeners.add(fn); return tAdd.call(this, t, fn, o); };
    EventTarget.prototype.removeEventListener = function (t, fn, o) { if (this.id === 'map_div' && /^(mousedown|contextmenu)$/.test(t)) divListeners.delete(fn); return tRemove.call(this, t, fn, o); };
    let rafs = 0; const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => { rafs++; return raf(cb); };
    window.__probe = () => ({
      resize: resize.size,
      divListeners: divListeners.size,
      liveContexts: contexts.filter(c => !c.isContextLost()).length,
      canvases: document.querySelectorAll('#map_div canvas').length,
      maplibreCanvases: document.querySelectorAll('#map_div .maplibregl-canvas').length,
      rafs
    });
  });
  await page.goto(`http://localhost:${port}/test/teardown/page.html`);
  await page.waitForFunction(() => window.ixmaps && window.buildMap, null, { timeout: 60000 });
  const build = async k => {
    await page.evaluate(k => window.buildMap(k), k);
    await page.waitForFunction(async () => { const api = await window._mapPromise; return api && api.map && api.map.loaded(); }, null, { timeout: 60000, polling: 500 });
    await page.waitForTimeout(2500);
  };
  const rafRate = async () => { const a = await page.evaluate(() => window.__probe().rafs); await page.waitForTimeout(1000); return (await page.evaluate(() => window.__probe().rafs)) - a; };

  await build(1);
  const one = await page.evaluate(() => window.__probe());
  const rate1 = await rafRate();
  for (let k = 2; k <= 5; k++) await build(k);
  const five = await page.evaluate(() => window.__probe());
  const rate5 = await rafRate();
  console.log('after 1 build:', JSON.stringify({ ...one, rafPerSec: rate1 }));
  console.log('after 5 builds:', JSON.stringify({ ...five, rafPerSec: rate5 }));

  check('re-created map: one MapLibre canvas in the div', () => assert.equal(five.maplibreCanvases, 1));
  check('re-created map: no more live WebGL contexts than one map has', () => assert.ok(five.liveContexts <= one.liveContexts, `${five.liveContexts} > ${one.liveContexts}`));
  check('re-created map: no more window resize listeners than one map has', () => assert.equal(five.resize, one.resize));
  check('re-created map: no more mousedown/contextmenu listeners on the page\'s div than one map has', () => assert.equal(five.divListeners, one.divListeners));
  check('re-created map: no repaint loops of the old maps (requestAnimationFrame rate)', () => assert.ok(rate5 <= rate1 * 1.5 + 5, `${rate5}/s after 5 builds vs ${rate1}/s after 1`));
  const works = await page.evaluate(async () => { const api = await window._mapPromise; return [api.runtimes.map(r => r.name).join(','), !!ixmaps.getThemeObj('pts')]; });
  check('re-created map: the new map has its themes and is registered', () => assert.deepEqual(works, ['pts,flows', true]));
  // map.destroy(): the page shuts the map down itself
  const lateDrawCalls = await page.evaluate(async () => {
    let calls = 0;
    ixmaps.htmlgui_onDrawTheme = () => { calls++; };
    const api = await window._mapPromise;
    api.map.panBy([60, 0], { duration: 0 });   // arms the 400 ms redraw notification
    ixmaps.map('td').destroy();
    // the pan's own moveend queued one round of hooks (a microtask, before destroy): not a timer
    await new Promise(r => setTimeout(r, 50));
    calls = 0;
    await new Promise(r => setTimeout(r, 1500));
    delete ixmaps.htmlgui_onDrawTheme;
    return calls;
  });
  const gone = await page.evaluate(() => ({ ...window.__probe(), theme: !!ixmaps.getThemeObj('pts') }));
  const rateGone = await rafRate();
  check('destroy(): no live WebGL context, no resize listener, no theme left', () =>
    assert.deepEqual([gone.liveContexts, gone.resize, gone.maplibreCanvases, gone.theme], [0, 0, 0, false]));
  check('destroy(): no htmlgui_onDrawTheme call from the destroyed map\'s pending timers', () => assert.equal(lateDrawCalls, 0));
  check('destroy(): no repaint loop left (requestAnimationFrame rate)', () => assert.ok(rateGone <= 5, `${rateGone}/s`));
  // and a map can be built in the div again
  await build(6);
  const again = await page.evaluate(async () => { const api = await window._mapPromise; return [window.__probe().liveContexts, api.runtimes.length, !!ixmaps.getThemeObj('pts')]; });
  check('after destroy(): a new map in the same div works', () => assert.deepEqual(again, [1, 2, true]));
  check('no page errors', () => assert.deepEqual(errors, []));

  const sp = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const spErrors = [];
  sp.on('pageerror', e => spErrors.push(e.message));
  await sp.goto(`http://localhost:${port}/test/teardown/sphere.html`);
  await sp.waitForFunction(async () => { const api = await window._mapPromise; return api && api.map && api.map.loaded() && api.runtimes.length === 2; }, null, { timeout: 60000, polling: 500 });
  await sp.waitForTimeout(2500);
  const pinnedShown = () => sp.evaluate(() => { const d = [...document.querySelectorAll('div')].find(x => x.style.zIndex === '6' && x.style.maxWidth === '440px'); return !!d && d.style.display !== 'none' && /p/.test(d.textContent); });
  await sp.mouse.click(450, 325);
  await sp.waitForTimeout(500);
  const pinnedBefore = await pinnedShown();
  await sp.evaluate(async () => (await window._mapPromise).remove('pts'));
  await sp.waitForTimeout(500);
  const pinnedAfter = await pinnedShown();
  check('a click pins the point\'s tooltip', () => assert.equal(pinnedBefore, true));
  check('remove(theme): its pinned tooltip goes with it', () => assert.equal(pinnedAfter, false));
  const backdrop = await sp.evaluate(async () => {
    const api = await window._mapPromise, map = api.map;
    const read = () => map.getLayer('__ixmaps_gl_sphere_backdrop') ? map.getPaintProperty('__ixmaps_gl_sphere_backdrop', 'background-color') : null;
    const before = read();
    await new Promise(r => { map.once('style.load', () => setTimeout(r, 500)); api.setMapType('VT_VOYAGER'); });
    return [before, read()];
  });
  check('Sphere backdrop: painted, and still there after setMapType', () => assert.deepEqual(backdrop, ['#123456', '#123456']));
  const cam = await sp.evaluate(async () => {
    const api = await window._mapPromise;
    let keyframes = 0;
    const p = api.cameraPath([{ center: { lat: 45.46, lng: 9.2 }, zoom: 11 }], { loop: true, onKeyframe: () => { keyframes++; } });
    await p.ready; p.play();
    await new Promise(r => setTimeout(r, 2500));
    const out = { playing: p.playing, keyframes };
    p.destroy();
    return out;
  });
  check('cameraPath: a looping path of one keyframe ends (no endless keyframe 0)', () => assert.ok(!cam.playing && cam.keyframes <= 2, JSON.stringify(cam)));
  check('sphere page: no page errors', () => assert.deepEqual(spErrors, []));
} finally {
  await browser.close();
  server.close();
}
done();
