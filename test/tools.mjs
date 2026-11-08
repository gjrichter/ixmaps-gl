// Live check, in headless Chromium, of the theme tools add-on (ixmaps-gl-tools.js): the right-click tool bar,
// the tune dialog's live sliders, a flag switch that rebuilds the theme, and Reset; the edit dialog (Ace from
// cdnjs): the definition as JSON with inline data kept, Apply, a syntax error, Revert; the config dialog (grammar
// registry from jsDelivr): flags, style fields, field names, a bad number, an added key, Apply, Revert; and the
// engine loading the add-on itself on the first right-click (ixmaps.Map option themetools: false | url).
// Needs network (MapLibre / deck.gl from unpkg, Ace from cdnjs, the grammar from jsDelivr). Run: node tools.mjs [--engine ../x.js]
import assert from 'node:assert/strict';
import { serve, launch, reporter } from './live.mjs';

const { server, port } = serve();
const browser = await launch();
const { check, done } = reporter();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${port}/test/tools/page.html`);
  await page.waitForFunction(async () => { const a = await window.myMap; return !!(a && a.map && a.runtimes.length === 2 && a.map.loaded()); }, null, { timeout: 90000, polling: 500 });
  await page.waitForTimeout(3000);
  const settle = () => page.waitForTimeout(1500);
  const rt = id => page.evaluate(async id => { const a = await window.myMap; const r = a.runtimes.find(x => (x.meta && x.meta.name) === id); return r && { flags: [...r.flags].join('|'), style: JSON.parse(JSON.stringify(r.style)), index: a.runtimes.indexOf(r) }; }, id);
  // deck.gl layers of a theme: id -> item count
  const layers = name => page.evaluate(async name => { const a = await window.myMap; return Object.fromEntries(a.overlay._props.layers.flat(Infinity).filter(l => l && l.id.includes('-' + name + '-')).map(l => [l.id.replace(/-g\d+$/, ''), Array.isArray(l.props.data) ? l.props.data.length : -1])); }, name);
  const setRange = (key, v) => page.evaluate(([key, v]) => { const i = document.querySelector(`.ixgt-dialog input[data-key="${key}"]`); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); }, [key, v]);
  const box = await page.locator('#map_div').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // ---- the context menu
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down({ button: 'right' }); await page.mouse.move(box.x + 160, box.y + 90, { steps: 5 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  const afterDrag = await page.locator('.ixgt-menu').count();
  check('a right-drag opens no menu', () => assert.equal(afterDrag, 0));
  await page.mouse.click(box.x + 40, box.y + 40, { button: 'right' });
  const menu = await page.evaluate(() => [...document.querySelectorAll('.ixgt-menu button')].map(b => b.textContent.trim() + (b.disabled ? ':off' : ':on')).join(','));
  check('a right-click opens the tool bar: tune, edit, config', () => assert.equal(menu, 'tune:on,edit:on,config:on'));
  await page.keyboard.press('Escape');
  const afterEsc = await page.locator('.ixgt-menu').count();
  check('Escape closes the tool bar', () => assert.equal(afterEsc, 0));

  // ---- the tune dialog, opened on empty map: the topmost chart theme
  await page.mouse.click(box.x + 40, box.y + 40, { button: 'right' });
  await page.click('.ixgt-menu button:first-child');
  const dlg = await page.evaluate(() => { const d = document.querySelector('.ixgt-dialog'); const s = d && d.querySelector('select'); return d && { options: s ? [...s.options].map(o => o.value).join(',') : '', value: s && s.value, keys: [...d.querySelectorAll('[data-key],[data-flag]')].map(i => i.dataset.key || i.dataset.flag).join(',') }; });
  check('tune opens a dialog with a theme picker of both themes', () => assert.equal(dlg && dlg.options, 'dots,bubbles'));
  check('it starts on the topmost theme', () => assert.equal(dlg.value, 'bubbles'));
  check('the bubble theme has its sliders and switches', () => assert.equal(dlg.keys, 'scale,fillopacity,linewidth,valuescale,opacity,aggregation,shadow,GLOW,VALUES,AGGREGATE'));

  // ---- live sliders
  const before = await layers('bubbles');
  const radiusAt = () => page.evaluate(async () => { const a = await window.myMap; const l = a.overlay._props.layers.flat(Infinity).find(x => x && /ix-bubbles-bubbles/.test(x.id)); const d = l.props.data; const f = l.props.getSize || l.props.getRadius; return typeof f === 'function' ? f(d[0], { index: 0, data: d, target: [] }) : f; });
  const r0 = await radiusAt();
  await setRange('scale', 2); await settle();
  const s1 = await rt('bubbles'); const r1 = await radiusAt();
  check('Size: style.scale is set live', () => assert.equal(s1.style.scale, 2));
  check('Size: the bubbles are redrawn bigger', () => assert.ok(r1 > r0, `${r0} -> ${r1}`));
  await setRange('fillopacity', 0.4); await settle();
  const s2 = await rt('bubbles');
  check('Opacity: style.fillopacity is set', () => assert.equal(s2.style.fillopacity, 0.4));
  await setRange('aggregation', 2); await settle();
  const s3 = await rt('bubbles'); const after = await layers('bubbles');
  check('Aggregation width: gridwidth is 2 x the original 40px', () => assert.equal(s3.style.gridwidth, '80px'));
  const cells = o => Object.entries(o).filter(([k]) => /ix-bubbles-bubbles/.test(k)).reduce((s, [, n]) => s + n, 0);
  check('Aggregation width: fewer, bigger cells', () => assert.ok(cells(after) < cells(before), `${cells(before)} -> ${cells(after)}`));

  // ---- a flag switch rebuilds the theme, keeping its tuned style and its place in the stack
  const glowBefore = Object.keys(await layers('bubbles')).some(k => /ix-glow/.test(k));
  await page.click('.ixgt-dialog input[data-flag="GLOW"]');
  await page.waitForFunction(async () => { const a = await window.myMap; const r = a.runtimes.find(x => x.meta && x.meta.name === 'bubbles'); return r && !r.flags.has('GLOW'); }, null, { timeout: 15000 });
  await settle();
  const s4 = await rt('bubbles'); const glowAfter = Object.keys(await layers('bubbles')).some(k => /ix-glow/.test(k));
  check('GLOW off: the theme is rebuilt without GLOW', () => assert.ok(!/\bGLOW\b/.test(s4.flags)));
  check('GLOW off: the glow layer is gone', () => { assert.equal(glowBefore, true); assert.equal(glowAfter, false); });
  check('GLOW off: the tuned style is kept', () => { assert.equal(s4.style.scale, 2); assert.equal(s4.style.gridwidth, '80px'); });
  check('GLOW off: same place in the stack (topmost)', () => assert.equal(s4.index, 1));
  const themeCount = await page.evaluate(async () => (await window.myMap).runtimes.length);
  check('GLOW off: no second theme', () => assert.equal(themeCount, 2));
  const dlgAfter = await page.evaluate(() => [...document.querySelectorAll('.ixgt-dialog [data-key]')].map(i => i.dataset.key).join(','));
  check('the dialog follows the rebuilt theme (no glow slider now)', () => { const k = dlgAfter.split(','); assert.ok(!k.includes('opacity') && k.includes('scale'), dlgAfter); });

  // ---- picking the other theme, then Reset
  await page.selectOption('.ixgt-dialog select', 'dots');
  const dotsKeys = await page.evaluate(() => [...document.querySelectorAll('.ixgt-dialog [data-key]')].map(i => i.dataset.key).join(','));
  check('the picker switches to the dot theme\'s controls', () => assert.equal(dotsKeys, 'scale,fillopacity,linewidth,shadow'));
  await page.selectOption('.ixgt-dialog select', 'bubbles');
  await page.click('.ixgt-foot button');
  await page.waitForFunction(async () => { const a = await window.myMap; const r = a.runtimes.find(x => x.meta && x.meta.name === 'bubbles'); return r && r.flags.has('GLOW'); }, null, { timeout: 15000 });
  await settle();
  const s5 = await rt('bubbles');
  check('Reset: the original theme is back', () => { assert.match(s5.flags, /GLOW/); assert.equal(s5.style.gridwidth, '40px'); assert.ok(s5.style.scale == null || s5.style.scale === 1); });

  // ---- flat's popupTools and closing
  await page.click('.ixgt-head button');
  const closed = await page.locator('.ixgt-dialog').count();
  check('the close button removes the dialog', () => assert.equal(closed, 0));
  await page.evaluate(() => ixmaps.popupTools());
  const reopened = await page.locator('.ixgt-dialog').count();
  check('ixmaps.popupTools() opens the tune dialog', () => assert.equal(reopened, 1));

  // ---- the edit dialog
  await page.evaluate(() => ixmaps.themeTools.close());
  await page.mouse.click(box.x + 40, box.y + 40, { button: 'right' });
  await page.click('.ixgt-menu button:nth-child(2)');
  await page.waitForSelector('.ixgt-edit .ixgt-code[data-editor]', { timeout: 30000 });
  const editorKind = await page.getAttribute('.ixgt-edit .ixgt-code', 'data-editor');
  check('edit opens a dialog with the Ace editor (loaded on first use)', () => assert.equal(editorKind, 'ace'));
  const aceText = () => page.evaluate(() => document.querySelector('.ixgt-edit .ace_editor').env.editor.getValue());
  const setText = t => page.evaluate(t => document.querySelector('.ixgt-edit .ace_editor').env.editor.setValue(t, -1), t);
  const shown = JSON.parse(await aceText());
  check('it shows the topmost theme\'s definition as JSON', () => { assert.equal(shown.meta.name, 'bubbles'); assert.match(shown.style.type, /^CHART\|SYMBOL\|GLOW/); assert.equal(shown.style.gridwidth, '40px'); });
  check('the inline data is kept, not shown', () => { assert.match(shown.data.obj, /^<kept: data\.obj .* 120 features>$/); assert.equal(shown.data.type, 'geojson'); });
  const edited = Object.assign({}, shown, { style: Object.assign({}, shown.style, { type: 'CHART|SYMBOL|AGGREGATE|SUM|VALUES|NOLEGEND', gridwidth: '60px' }) });
  await setText(JSON.stringify(edited, null, 2));
  await page.click('.ixgt-edit .ixgt-btns button:last-child');
  await page.waitForFunction(async () => { const a = await window.myMap; const r = a.runtimes.find(x => x.meta && x.meta.name === 'bubbles'); return r && !r.flags.has('GLOW') && r.style.gridwidth === '60px'; }, null, { timeout: 15000 });
  await settle();
  const e1 = await rt('bubbles'); const e1layers = await layers('bubbles');
  check('Apply rebuilds the theme from the edited JSON', () => { assert.ok(!/GLOW/.test(e1.flags)); assert.equal(e1.style.gridwidth, '60px'); });
  check('Apply: the kept inline data is put back (cells drawn)', () => assert.ok(cells(e1layers) > 0, JSON.stringify(e1layers)));
  const n1 = await page.evaluate(async () => (await window.myMap).runtimes.length);
  check('Apply: same place in the stack, no second theme', () => { assert.equal(e1.index, 1); assert.equal(n1, 2); });
  const afterApply = JSON.parse(await aceText());
  check('the editor then shows the rebuilt theme', () => assert.equal(afterApply.style.gridwidth, '60px'));
  await setText('{ "style": { "type": "CHART|DOT" }, }');
  await page.click('.ixgt-edit .ixgt-btns button:last-child');
  await page.waitForTimeout(300);
  const err = await page.evaluate(() => { const n = document.querySelector('.ixgt-edit .ixgt-error'); return n && n.textContent; });
  const e2 = await rt('bubbles');
  check('a JSON syntax error is shown and nothing is applied', () => { assert.ok(err && err.length > 5, String(err)); assert.equal(e2.style.gridwidth, '60px'); });
  await page.click('.ixgt-edit .ixgt-btns button:first-child');
  await page.waitForFunction(async () => { const a = await window.myMap; const r = a.runtimes.find(x => x.meta && x.meta.name === 'bubbles'); return r && r.flags.has('GLOW') && r.style.gridwidth === '40px'; }, null, { timeout: 15000 });
  await settle();
  const e3 = await rt('bubbles'); const nThemes = await page.evaluate(async () => (await window.myMap).runtimes.length);
  check('Revert rebuilds the theme as the editor first showed it', () => { assert.match(e3.flags, /GLOW/); assert.equal(e3.style.gridwidth, '40px'); assert.equal(e3.index, 1); assert.equal(nThemes, 2); });
  await page.screenshot({ path: 'out/tools_edit.png' });
  await page.evaluate(() => ixmaps.themeTools.close());
  await page.evaluate(() => ixmaps.popupThemeEditor('dots'));
  await page.waitForSelector('.ixgt-edit .ace_editor', { timeout: 10000 });
  const dotsShown = JSON.parse(await aceText());
  check('ixmaps.popupThemeEditor(id) opens the edit dialog on that theme', () => assert.equal(dotsShown.meta.name, 'dots'));

  // ---- the config dialog
  await page.evaluate(() => ixmaps.themeTools.close());
  await page.mouse.click(box.x + 40, box.y + 40, { button: 'right' });
  await page.click('.ixgt-menu button:nth-child(3)');
  await page.waitForSelector('.ixgt-config .ixgt-viz-btn', { timeout: 10000 });
  const firstTab = await page.evaluate(() => { const d = document.querySelector('.ixgt-config'); return { tab: d.querySelector('.ixgt-panel').dataset.section, viz: d.querySelector('.ixgt-viz-btn').dataset.viz }; });
  check('config opens on the Visual tab, which names the theme\'s visualization', () => { assert.equal(firstTab.tab, 'visual'); assert.equal(firstTab.viz, 'bubble'); });
  await page.click('.ixgt-config [data-tab="type"]');
  await page.waitForFunction(() => { const dl = document.getElementById('ixgt-dl-flags'); return dl && dl.options.length > 100; }, null, { timeout: 30000 });
  const cfg = await page.evaluate(() => { const d = document.querySelector('.ixgt-config'); return { tabs: [...d.querySelectorAll('.ixgt-tabs button')].map(b => b.dataset.tab).join(','), kind: d.querySelector('#ixgt-kind').value, glow: d.querySelector('input[data-flag="GLOW"]').checked, flags: document.getElementById('ixgt-dl-flags').options.length }; });
  check('config has the visual, type, style, binding, data and meta tabs', () => assert.equal(cfg.tabs, 'visual,type,style,binding,data,meta'));
  check('config: the kind and flags of the topmost theme', () => { assert.equal(cfg.kind, 'CHART|SYMBOL'); assert.equal(cfg.glow, true); });
  check('config: every other flag of the grammar registry can be added', () => assert.ok(cfg.flags > 100, String(cfg.flags)));
  await page.click('.ixgt-config input[data-flag="GLOW"]');
  await page.click('.ixgt-config [data-tab="style"]');
  await page.fill('.ixgt-config input[data-key="gridwidth"]', '60px');
  const swatches = await page.locator('.ixgt-config .ixgt-swatches input').count();
  check('config: the colorscheme gets a color picker per color', () => assert.equal(swatches, 2));
  await page.fill('.ixgt-config input[data-key="scale"]', 'abc');
  const bad = await page.evaluate(() => ({ marked: document.querySelector('.ixgt-config input[data-key="scale"]').classList.contains('ixgt-bad'), apply: document.querySelector('.ixgt-config .ixgt-btns button:last-child').disabled }));
  check('config: a value that is not a number is marked and blocks Apply', () => { assert.equal(bad.marked, true); assert.equal(bad.apply, true); });
  await page.fill('.ixgt-config input[data-key="scale"]', '');
  await page.fill('.ixgt-config .ixgt-add input', 'boxcolor');
  await page.click('.ixgt-config .ixgt-add button');
  await page.fill('.ixgt-config input[data-key="boxcolor"]', '#ff0000');
  await page.click('.ixgt-config [data-tab="binding"]');
  const fieldList = await page.evaluate(() => [...document.getElementById('ixgt-dl-fields').options].map(o => o.value).join(','));
  check('config: binding fields offer the data\'s field names', () => { for (const f of ['v', 'cat', 'name']) assert.ok(fieldList.split(',').includes(f), fieldList); });
  await page.click('.ixgt-config [data-tab="data"]');
  const keptData = await page.evaluate(() => document.querySelector('.ixgt-config .ixgt-panel').textContent);
  check('config: inline data is shown as kept, not edited', () => assert.match(keptData, /<kept: data\.obj .* 120 features>/));
  await page.click('.ixgt-config .ixgt-btns button:last-child');
  await page.waitForFunction(async () => { const a = await window.myMap; const r = a.runtimes.find(x => x.meta && x.meta.name === 'bubbles'); return r && !r.flags.has('GLOW') && r.style.gridwidth === '60px'; }, null, { timeout: 15000 });
  await settle();
  const c1 = await rt('bubbles'); const c1layers = await layers('bubbles'); const cn = await page.evaluate(async () => (await window.myMap).runtimes.length);
  check('config Apply rebuilds the theme: GLOW off, gridwidth 60px, boxcolor added', () => { assert.ok(!/GLOW/.test(c1.flags)); assert.equal(c1.style.gridwidth, '60px'); assert.equal(c1.style.boxcolor, '#ff0000'); });
  check('config Apply: the data is kept, same place in the stack, no second theme', () => { assert.ok(cells(c1layers) > 0); assert.equal(c1.index, 1); assert.equal(cn, 2); });
  await page.screenshot({ path: 'out/tools_config.png' });
  await page.click('.ixgt-config .ixgt-btns button:first-child');
  await page.waitForFunction(async () => { const a = await window.myMap; const r = a.runtimes.find(x => x.meta && x.meta.name === 'bubbles'); return r && r.flags.has('GLOW') && r.style.gridwidth === '40px'; }, null, { timeout: 15000 });
  await settle();
  const c2 = await rt('bubbles');
  check('config Revert rebuilds the theme as the dialog first showed it', () => { assert.match(c2.flags, /GLOW/); assert.equal(c2.style.boxcolor, undefined); assert.equal(c2.index, 1); });

  // ---- the Visual tab: the Smart Data Loader's visualizations on an existing theme
  const bub = () => page.evaluate(async () => { const a = await window.myMap; const r = a.runtimes.find(x => x.meta && x.meta.name === 'bubbles'); return r && { flags: [...r.flags].join('|'), style: JSON.parse(JSON.stringify(r.style)), binding: JSON.parse(JSON.stringify(r.binding || {})) }; });
  await page.click('.ixgt-config [data-tab="visual"]');
  const vis0 = await page.evaluate(() => ({ value: document.querySelector('#ixgt-v-value').value, size: document.querySelector('#ixgt-v-size').value, swatches: document.querySelectorAll('.ixgt-vsw input').length }));
  check('Visual: the value and size fields and the theme\'s colors', () => { assert.equal(vis0.value, 'v'); assert.equal(vis0.size, 'v'); assert.equal(vis0.swatches, 2); });
  await page.evaluate(() => { const i = document.querySelector('#ixgt-v-fillopacity'); i.value = '0.5'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle();
  const live = await bub();
  check('Visual: the opacity slider changes the theme live', () => assert.equal(live.style.fillopacity, 0.5));
  await page.click('.ixgt-viz-btn');
  const cards = await page.evaluate(() => [...document.querySelectorAll('.ixgt-viz-card')].map(c => c.dataset.viz).join(','));
  check('Visual: a point theme can become any of the loader\'s point visualizations', () => assert.equal(cards, 'dot,bubble,hexbin,hexbin_sized,heatmap,mlheatmap,kde'));
  await page.screenshot({ path: 'out/tools_visual.png' });
  await page.click('.ixgt-viz-card[data-viz="hexbin"]');
  await page.selectOption('#ixgt-v-value', 'cat');
  await page.click('.ixgt-pal-btn');
  await page.click('.ixgt-pal[data-palette="Blues"]');
  await page.click('.ixgt-config .ixgt-btns button:last-child');
  await page.waitForFunction(async () => { const a = await window.myMap; const r = a.runtimes.find(x => x.meta && x.meta.name === 'bubbles'); return r && r.flags.has('GRIDSIZE') && r.flags.has('CATEGORICAL'); }, null, { timeout: 15000 });
  await settle();
  const hx = await bub(); const hxLayers = await layers('bubbles');
  check('Visual Apply: the theme is now the loader\'s hexbin, by category', () => { for (const f of ['GRIDSIZE', 'AGGREGATE', 'SUM', 'DOPACITY', 'CATEGORICAL', 'CENTER', 'DOMINANT']) assert.match(hx.flags, new RegExp('\\b' + f + '\\b'), f); assert.deepEqual(hx.style.symbols, ['hexagon']); });
  check('Visual Apply: its other flags, grid and position stay', () => { assert.match(hx.flags, /GLOW/); assert.match(hx.flags, /NOLEGEND/); assert.equal(hx.style.gridwidth, '40px'); assert.equal(hx.binding.geo || hx.binding.position, 'geometry'); });
  check('Visual Apply: the categories and a Blues color for each', () => { assert.deepEqual(hx.style.values, ['b', 'a']); assert.deepEqual(hx.style.colorscheme, ['#eff3ff', '#bdd7e7']); });
  check('Visual Apply: the hexagons are drawn', () => assert.ok(Object.values(hxLayers).some(n => n > 0), JSON.stringify(hxLayers)));
  await page.click('.ixgt-config .ixgt-btns button:first-child');
  await page.waitForFunction(async () => { const a = await window.myMap; const r = a.runtimes.find(x => x.meta && x.meta.name === 'bubbles'); return r && !r.flags.has('GRIDSIZE') && r.flags.has('GLOW'); }, null, { timeout: 15000 });
  await settle();
  const back = await bub();
  check('Revert after the Visual tab: the bubbles are back', () => { assert.ok(!/CATEGORICAL/.test(back.flags)); assert.equal(back.style.symbols, undefined); });
  await page.evaluate(() => ixmaps.themeTools.close());
  await page.evaluate(() => ixmaps.popupThemeConfigurator('dots'));
  const dotsKind = await page.evaluate(() => ({ theme: document.querySelector('.ixgt-config select').value, viz: document.querySelector('.ixgt-viz-btn').dataset.viz }));
  check('ixmaps.popupThemeConfigurator(id) opens the config dialog on that theme', () => { assert.equal(dotsKind.theme, 'dots'); assert.equal(dotsKind.viz, 'dot'); });
  await page.screenshot({ path: 'out/tools.png' });
  check('no page errors', () => assert.deepEqual(errors, []));

  // ---- the engine loads the add-on itself, on the first right-click (as flat, every map has the menu);
  // ixmaps.Map(id, {themetools: false}) turns it off, a string is the add-on's URL. Only the engine on the page.
  const optionPage = async query => {
    const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://localhost:${port}/test/tools/page_option.html${query}`);
    await p.waitForFunction(async () => { const a = await window.myMap; return !!(a && a.map && a.runtimes.length === 1 && a.map.loaded()); }, null, { timeout: 90000, polling: 500 });
    await p.waitForTimeout(1500);
    const toolScripts = () => p.evaluate(() => [...document.scripts].map(x => x.src.replace(location.origin, '')).filter(x => /tools/.test(x)));
    const r = { before: await toolScripts() };
    // the right-click (MapLibre itself always suppresses the browser's own menu on the map)
    r.prevented = await p.evaluate(() => { const c = document.querySelector('#map_div canvas'); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }); c.dispatchEvent(ev); return ev.defaultPrevented; });
    await p.waitForTimeout(1500);
    Object.assign(r, await p.evaluate(() => ({ version: window.ixmaps.themeTools && window.ixmaps.themeTools.version, menu: [...document.querySelectorAll('.ixgt-menu button')].map(x => x.textContent.trim()).join(',') })));
    r.after = await toolScripts();
    if (r.menu) {
      await p.click('.ixgt-menu button:first-child');
      r.tune = await p.evaluate(() => { const s = document.querySelector('.ixgt-dialog .ixgt-sub'); return s && s.textContent; });
      // later right-clicks: the add-on's own menu, the script not loaded again
      await p.evaluate(() => window.ixmaps.themeTools.close());
      const b = await p.locator('#map_div').boundingBox();
      await p.mouse.click(b.x + 300, b.y + 300, { button: 'right' });
      await p.waitForTimeout(300);
      r.again = await p.evaluate(() => document.querySelectorAll('.ixgt-menu').length);
      r.afterAgain = await toolScripts();
    }
    r.errors = errs;
    await p.close();
    return r;
  };
  const byDefault = await optionPage('');
  check('default: nothing of the add-on is loaded with the map', () => assert.deepEqual(byDefault.before, []));
  check('default: the first right-click loads ixmaps-gl-tools.js from next to ixmaps-gl.js', () => assert.deepEqual(byDefault.after, ['/ixmaps-gl-tools.js']));
  check('default: that right-click opens the tool bar', () => assert.equal(byDefault.menu, 'tune,edit,config'));
  check('default: tune opens on the map\'s theme', () => assert.equal(byDefault.tune, 'Bubbles'));
  check('default: later right-clicks open the menu, the script is not loaded again', () => { assert.equal(byDefault.again, 1); assert.deepEqual(byDefault.afterAgain, ['/ixmaps-gl-tools.js']); });
  const withTrue = await optionPage('?tools=true');
  check('themetools: true — the same as the default', () => { assert.deepEqual(withTrue.before, []); assert.equal(withTrue.menu, 'tune,edit,config'); });
  const withUrl = await optionPage('?tools=' + encodeURIComponent('/ixmaps-gl-tools.js?from=option'));
  check('themetools: "<url>" — the add-on comes from that URL', () => { assert.deepEqual(withUrl.after, ['/ixmaps-gl-tools.js?from=option']); assert.equal(withUrl.menu, 'tune,edit,config'); });
  const off = await optionPage('?tools=false');
  check('themetools: false — no tool bar, nothing loaded', () => { assert.deepEqual(off.after, []); assert.equal(off.menu, ''); assert.equal(off.version, undefined); });
  check('option pages: no page errors', () => assert.deepEqual([...byDefault.errors, ...withTrue.errors, ...withUrl.errors, ...off.errors], []));
} finally {
  await browser.close();
  server.close();
}
done();
