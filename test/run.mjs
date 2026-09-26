#!/usr/bin/env node
// ixmaps-gl output-regression harness.
//
//   npm test                         compare every page against test/baselines/
//   npm run snapshot                 (re)write the baselines  (= node run.mjs --update)
//   node run.mjs --page dot_         only pages whose path contains "dot_"
//   node run.mjs --engine old.js     run the pages against another ixmaps-gl.js build
//   node run.mjs --jobs 3            pages in parallel (default 2)
//
// Remote data (everything not served locally, except basemap tiles/images)
// is recorded on first use into test/.cache/ (git-ignored) and replayed
// afterwards, so a changed remote file can't produce a false diff;
// test/data-manifest.json (committed) records each URL's SHA-256 and flags
// a remote change when a fresh machine re-records it.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const TEST = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(TEST, '..');
// served from the repo's PARENT so a sibling checkout (e.g. ixmaps-grammar,
// used by examples/validate_demo.html on localhost) resolves as it does in dev
const SERVE_ROOT = path.resolve(REPO, '..');
const REPO_URL_PREFIX = '/' + path.basename(REPO) + '/';
const CACHE = path.join(TEST, '.cache');
const BASELINES = path.join(TEST, 'baselines');
const OUT = path.join(TEST, 'out');
const MANIFEST = path.join(TEST, 'data-manifest.json');

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const UPDATE = flag('--update');
const ENGINE = opt('--engine') ? path.resolve(opt('--engine')) : null;
const FILTER = opt('--page');
const JOBS = Number(opt('--jobs', 2));
const FLAT_ORACLE = flag('--flat-oracle');
const SETTLE_MS = 1200;       // layers unchanged this long = settled
const PAGE_TIMEOUT_MS = 120000;
const NO_MAP_MS = 15000;      // no ixmaps.Map() call by then = page needs interaction → skip

const config = JSON.parse(fs.readFileSync(path.join(TEST, 'pages.json'), 'utf8'));
const pages = config.pages.filter(p => !FILTER || p.includes(FILTER));
const slug = p => p.replace(/\.html?$/, '').replace(/[\/\s]+/g, '__');

// ------------------------------------------------------------ static server

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.csv': 'text/csv', '.png': 'image/png', '.svg': 'image/svg+xml', '.gz': 'application/gzip' };
function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.resolve(SERVE_ROOT, '.' + p);
    if (!file.startsWith(SERVE_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// ------------------------------------------------------------ data cache

fs.mkdirSync(CACHE, { recursive: true });
// MapTiler adds a per-load session id (mtsid) to its URLs — every load would
// be a new URL, never replayed and re-recorded into the manifest; its API key
// doesn't change the response and doesn't belong in the committed manifest.
// Both are dropped from the cache key and the manifest (MapTiler only: a
// "key" parameter elsewhere, e.g. a Google Sheet's, selects the data).
function canonicalUrl(url) {
  let u;
  try { u = new URL(url); } catch (e) { return url; }
  if (!/(^|\.)maptiler\.com$/.test(u.hostname)) return url;
  u.searchParams.delete('mtsid');
  u.searchParams.delete('key');
  return u.toString();
}
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
let manifestDirty = false;
for (const url of Object.keys(manifest)) {
  const c = canonicalUrl(url);
  if (c === url) continue;
  if (!manifest[c]) manifest[c] = manifest[url];
  delete manifest[url];
  manifestDirty = true;
}
const cacheStats = { replayed: 0, recorded: 0, live: 0, remoteChanged: [] };
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
// basemap tiles, glyphs and sprite images don't affect what is snapshotted —
// fetched live, never cached (the cache would otherwise grow per zoom/view)
const LIVE = /\.(pbf|mvt|png|jpe?g|webp|avif)(\?|$)|\/tiles?\/|\/fonts?\/|sprite/i;

async function handleRoute(route, localOrigin) {
  const url = route.request().url();
  if (url.startsWith(localOrigin)) {
    if (ENGINE && /\/ixmaps-gl\.js(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(ENGINE) });
    }
    return route.continue();
  }
  if (!/^https?:/.test(url) || LIVE.test(url)) { cacheStats.live++; return route.continue(); }
  const curl = canonicalUrl(url);
  const key = sha256(curl).slice(0, 32);
  const bodyFile = path.join(CACHE, key + '.bin'), metaFile = path.join(CACHE, key + '.json');
  if (fs.existsSync(bodyFile) && fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    cacheStats.replayed++;
    return route.fulfill({ status: meta.status, headers: meta.headers, body: fs.readFileSync(bodyFile) });
  }
  let resp;
  try { resp = await route.fetch(); } catch (e) { return route.abort(); }
  const body = await resp.body();
  // body() is already decoded — drop encoding/length so they're recomputed
  const headers = Object.fromEntries(Object.entries(resp.headers()).filter(([k]) => !/^(content-encoding|content-length|transfer-encoding|set-cookie)$/i.test(k)));
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'access-control-allow-origin')) headers['access-control-allow-origin'] = '*';
  if (resp.status() === 200) {
    fs.writeFileSync(bodyFile, body);
    fs.writeFileSync(metaFile, JSON.stringify({ url: curl, status: resp.status(), headers }, null, 1));
    const digest = sha256(body);
    if (manifest[curl] && manifest[curl].sha256 !== digest) cacheStats.remoteChanged.push(curl);
    if (!manifest[curl] || manifest[curl].sha256 !== digest) { manifest[curl] = { sha256: digest, bytes: body.length }; manifestDirty = true; }
    cacheStats.recorded++;
  }
  return route.fulfill({ status: resp.status(), headers, body });
}

// ------------------------------------------------------------ one page

const browserCode = fs.readFileSync(path.join(TEST, 'browser.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitSettled(page) {
  const t0 = Date.now();
  let last = null, since = Date.now();
  while (Date.now() - t0 < PAGE_TIMEOUT_MS) {
    const st = await page.evaluate(() => window.__glTest.state());
    const key = JSON.stringify(st);
    const ready = st.length && st.every(s => s.loaded && !s.moving && !s.splash);
    if (key !== last) { last = key; since = Date.now(); }
    else if (ready && Date.now() - since >= SETTLE_MS) return st;
    await sleep(250);
  }
  throw new Error(`not settled after ${PAGE_TIMEOUT_MS / 1000}s: ${last}`);
}

// keep only messages that describe the engine/page — not the network, and
// not GPU-driver chatter (it embeds a per-run context address, 0x11c0…)
const consoleRelevant = m => !/Failed to load resource|net::ERR_|favicon|GL Driver Message|\[\.WebGL-0x/i.test(m);

async function runPage(browser, localOrigin, pagePath) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  await context.addInitScript(browserCode);
  await context.route('**/*', route => handleRoute(route, localOrigin));
  const page = await context.newPage();
  const consoleMsgs = new Set();
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && consoleRelevant(m.text())) consoleMsgs.add(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', e => consoleMsgs.add(`pageerror: ${String(e.message).slice(0, 300)}`));
  try {
    await page.goto(localOrigin + REPO_URL_PREFIX + pagePath, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
    const t0 = Date.now();
    while (!(await page.evaluate(() => window.__glTest.mapCount())) && Date.now() - t0 < NO_MAP_MS) await sleep(250);
    if (!(await page.evaluate(() => window.__glTest.mapCount()))) {
      // a page that THREW before creating its map is broken, not "waiting for
      // interaction" — e.g. a builder method the engine lost
      const pageErrors = [...consoleMsgs].filter(m => m.startsWith('pageerror:'));
      if (pageErrors.length) return { page: pagePath, error: `no ixmaps.Map() call — ${pageErrors[0]}`, console: [...consoleMsgs].sort() };
      return { page: pagePath, skipped: 'no ixmaps.Map() call within 15s (needs interaction?)' };
    }
    const resolved = await page.evaluate(ms => window.__glTest.resolvedMaps(ms), PAGE_TIMEOUT_MS);
    if (!resolved.every(r => r === 'ok')) throw new Error(`map promise: ${resolved.join(', ')}`);
    const views = [];
    await waitSettled(page);
    views.push(...await page.evaluate(() => window.__glTest.snapshot('initial')));
    let at = 0;
    for (const step of config.zoomSteps) {
      await page.evaluate(d => window.__glTest.zoomBy(d), step - at);
      at = step;
      await sleep(600);
      await waitSettled(page);
      views.push(...await page.evaluate(l => window.__glTest.snapshot(l), `zoom${step > 0 ? '+' : ''}${step}`));
    }
    return { page: pagePath, views, console: [...consoleMsgs].sort() };
  } catch (e) {
    return { page: pagePath, error: e.message.split('\n')[0], console: [...consoleMsgs].sort() };
  } finally {
    await context.close();
  }
}

// ------------------------------------------------------------ compare

// JSON.stringify(undefined) is undefined, not a string — a field that exists
// on only one side must still print
const js = v => (v === undefined ? 'undefined' : JSON.stringify(v));

function diffSnapshots(base, act) {
  const d = [];
  if (act.error) { d.push(`run error: ${act.error}`); return d; }
  const bv = new Map(base.views.map(v => [v.label, v])), av = new Map(act.views.map(v => [v.label, v]));
  for (const label of new Set([...bv.keys(), ...av.keys()])) {
    const b = bv.get(label), a = av.get(label);
    if (!b || !a) { d.push(`[${label}] view ${b ? 'missing' : 'new'}`); continue; }
    if (js(b.view) !== js(a.view)) d.push(`[${label}] view ${js(b.view)} → ${js(a.view)}`);
    const bl = new Map(b.layers.map(l => [l.id, l])), al = new Map(a.layers.map(l => [l.id, l]));
    for (const id of new Set([...bl.keys(), ...al.keys()])) {
      const x = bl.get(id), y = al.get(id);
      if (!x || !y) { d.push(`[${label}] layer ${id} ${x ? 'removed' : 'added'}${y ? ` (${y.type}, ${y.count} items)` : ''}`); continue; }
      if (x.type !== y.type) d.push(`[${label}] ${id}: type ${x.type} → ${y.type}`);
      if (x.count !== y.count) d.push(`[${label}] ${id}: ${x.count} → ${y.count} items`);
      for (const k of new Set([...Object.keys(x.constants), ...Object.keys(y.constants)])) {
        if (js(x.constants[k]) !== js(y.constants[k])) d.push(`[${label}] ${id}: prop ${k} ${js(x.constants[k])} → ${js(y.constants[k])}`);
      }
      if (x.digest !== y.digest) {
        const cols = y.columns.filter(c => x.columnDigests[c] !== y.columnDigests[c]);
        const added = y.columns.filter(c => !x.columns.includes(c)), removed = x.columns.filter(c => !y.columns.includes(c));
        if (!cols.length && !added.length && !removed.length && x.setDigest === y.setDigest) {
          d.push(`[${label}] ${id}: same items, different ORDER (draw order / z-order changed)`);
        } else {
          for (const c of cols.filter(c => !added.includes(c))) {
            const ci = y.columns.indexOf(c), cx = x.columns.indexOf(c);
            const first = y.sample.findIndex((r, i) => js(r[ci]) !== js((x.sample[i] || [])[cx]));
            const detail = first >= 0 ? ` e.g. item ${first}: ${js((x.sample[first] || [])[cx])} → ${js(y.sample[first][ci])}` : ` (first difference beyond the ${y.sample.length}-item sample)`;
            d.push(`[${label}] ${id}: ${c} changed${js(x.stats[c]) !== js(y.stats[c]) ? ` range ${js(x.stats[c])} → ${js(y.stats[c])}` : ''};${detail}`);
          }
          if (added.length) d.push(`[${label}] ${id}: new accessors ${added.join(', ')}`);
          if (removed.length) d.push(`[${label}] ${id}: removed accessors ${removed.join(', ')}`);
        }
      }
    }
    const bt = new Map(b.themes.map(t => [t.name, t])), at = new Map(a.themes.map(t => [t.name, t]));
    for (const name of new Set([...bt.keys(), ...at.keys()])) {
      const x = bt.get(name), y = at.get(name);
      if (!x || !y) { d.push(`[${label}] theme ${name} ${x ? 'removed' : 'added'}`); continue; }
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (js(x[k]) !== js(y[k])) d.push(`[${label}] theme ${name}.${k}: ${js(x[k]).slice(0, 120)} → ${js(y[k]).slice(0, 120)}`);
      }
    }
    for (const k of ['legend', 'tooltips', 'validation']) {
      if (js(b[k]) !== js(a[k])) d.push(`[${label}] ${k} changed: ${js(b[k]).slice(0, 160)} → ${js(a[k]).slice(0, 160)}`);
    }
  }
  const bc = new Set(base.console || []), ac = new Set(act.console || []);
  for (const m of ac) if (!bc.has(m)) d.push(`console + ${m.slice(0, 200)}`);
  for (const m of bc) if (!ac.has(m)) d.push(`console − ${m.slice(0, 200)}`);
  return d;
}

// ------------------------------------------------------------ flat oracle
// The same map on the REAL ixmaps-flat engine (pages.json → flatOracle):
// read flat's computed classes from its own theme objects and compare them
// with gl's baseline for the gl twin. A report of differences, not a test.

async function runFlatPage(browser, localOrigin, pagePath) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  await context.addInitScript(browserCode);
  await context.route('**/*', route => handleRoute(route, localOrigin));
  const page = await context.newPage();
  try {
    await page.goto(localOrigin + REPO_URL_PREFIX + pagePath, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
    let last = null, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < PAGE_TIMEOUT_MS) {
      await sleep(1000);
      const r = await page.evaluate(() => window.__glTest.flatThemes());
      const ready = r.themes && r.themes.length && r.themes.every(t => /FEATURE/.test(t.flag) || t.parts.length);
      const key = JSON.stringify(r);
      stable = ready && key === last ? stable + 1 : 0;
      last = key;
      if (stable >= 3) return r.themes;
    }
    throw new Error(`flat themes not ready after ${PAGE_TIMEOUT_MS / 1000}s: ${String(last).slice(0, 200)}`);
  } finally { await context.close(); }
}

const baseType = flags => (flags.find(f => /^(CHOROPLETH|CHART|FEATURES?)$/.test(f)) || '?').replace('FEATURES', 'FEATURE');
const hexRgb = c => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
  if (!m) return String(c);
  const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const near = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= Math.max(1e-6, 1e-4 * Math.abs(a)) : js(a) === js(b);

function compareWithFlat(flatThemes, glThemes) {
  const out = [];
  const seen = {};
  const byBase = {};
  for (const t of glThemes) (byBase[baseType(t.flags)] ||= []).push(t);
  for (const f of flatThemes) {
    const base = baseType(f.flag.split('|'));
    const i = seen[base] = (seen[base] ?? -1) + 1;
    const g = (byBase[base] || [])[i];
    const label = `${base}#${i} (flat "${f.flag}")`;
    if (!g) { out.push(`${label}: no gl theme to compare`); continue; }
    if (base === 'FEATURE') continue; // a plain outline/fill layer has no classes
    if (/\bDOMINANT\b/.test(f.flag)) {
      // flat: partsA = one entry per field, items classed by the dominant
      // field's index — compare the category count and the per-field
      // statistics that pick the dominant field instead of value ranges
      const nCat = (g.categoryLabels || []).length;
      if (f.parts.length !== nCat) out.push(`${label}: flat ${f.parts.length} categories, gl ${nCat}`);
      for (const [name, fv, gv] of [['mean', f.means, g.dominantMeans], ['min', f.mins, g.dominantMins], ['stddev', f.devs, g.dominantStdDevs]]) {
        if (!fv || !gv) { out.push(`${label}: per-field ${name} not available (flat ${!!fv}, gl ${!!gv})`); continue; }
        for (let k = 0; k < Math.max(fv.length, gv.length); k++) if (!near(fv[k], gv[k])) out.push(`${label}: field ${k} ${name} flat ${fv[k]} gl ${gv[k]}`);
      }
    } else {
      const gp = (g.partsA || []).map(p => [p.min, p.max]);
      if (f.parts.length !== gp.length) out.push(`${label}: flat ${f.parts.length} classes, gl ${gp.length}`);
      for (let k = 0; k < Math.min(f.parts.length, gp.length); k++) {
        if (!near(f.parts[k][0], gp[k][0]) || !near(f.parts[k][1], gp[k][1])) out.push(`${label}: class ${k} flat [${f.parts[k]}] gl [${gp[k]}]`);
      }
    }
    const fc = f.colors.map(hexRgb), gc = g.categoryColorsRgb || [];
    if (fc.length !== gc.length) out.push(`${label}: flat ${fc.length} colors, gl ${gc.length}`);
    for (let k = 0; k < Math.min(fc.length, gc.length); k++) if (js(fc[k]) !== js(gc[k])) out.push(`${label}: color ${k} flat ${js(fc[k])} gl ${js(gc[k])}`);
    if (g.valueMin !== undefined && !near(f.min, g.valueMin)) out.push(`${label}: min flat ${f.min} gl ${g.valueMin}`);
    if (g.valueMax !== undefined && !near(f.max, g.valueMax)) out.push(`${label}: max flat ${f.max} gl ${g.valueMax}`);
  }
  return out;
}

async function flatOracle(browser, localOrigin) {
  const md = ['# ixmaps-gl vs real ixmaps-flat — computed classes', ''];
  let total = 0;
  for (const { flat, gl } of config.flatOracle || []) {
    if (FILTER && !flat.includes(FILTER) && !gl.includes(FILTER)) continue;
    const file = path.join(BASELINES, slug(gl) + '.json');
    let lines;
    try {
      if (!fs.existsSync(file)) throw new Error(`no gl baseline for ${gl}`);
      const glThemes = JSON.parse(fs.readFileSync(file, 'utf8')).views[0].themes;
      lines = compareWithFlat(await runFlatPage(browser, localOrigin, flat), glThemes);
    } catch (e) { lines = [`not compared: ${e.message.split('\n')[0]}`]; }
    total += lines.length;
    console.log(`${lines.length ? 'DIFF ' : 'SAME '} ${flat} ↔ ${gl}${lines.map(l => '\n        ' + l).join('')}`);
    md.push(`## ${flat} ↔ ${gl}`, '', ...(lines.length ? lines.map(l => `- ${l}`) : ['- same classes']), '');
  }
  fs.writeFileSync(path.join(OUT, 'flat-oracle.md'), md.join('\n') + '\n');
  console.log(`\n${total} difference(s) — report: test/out/flat-oracle.md`);
}

// ------------------------------------------------------------ main

const server = await serve();
const localOrigin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
fs.mkdirSync(BASELINES, { recursive: true });
// out/ only ever holds THIS run's failures
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

if (FLAT_ORACLE) {
  await flatOracle(browser, localOrigin);
  await browser.close();
  server.close();
  if (manifestDirty) fs.writeFileSync(MANIFEST, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1) + '\n');
  process.exit(0);
}

const results = [];
const queue = [...pages];
async function worker() {
  while (queue.length) {
    const p = queue.shift();
    const t0 = Date.now();
    const r = await runPage(browser, localOrigin, p);
    r.seconds = Math.round((Date.now() - t0) / 1000);
    results.push(r);
    const file = path.join(BASELINES, slug(p) + '.json');
    if (r.skipped) {
      // skipping is only acceptable for a page that never produced a map
      const b = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      if (!UPDATE && b && b.views && b.views.length) {
        r.diffs = [`produced no map (${r.skipped}) — its baseline has ${b.views.length} views`];
        console.log(`FAIL  ${p}\n        ${r.diffs[0]}`);
      } else console.log(`SKIP  ${p} — ${r.skipped}`);
      continue;
    }
    const known = (config.knownBroken || {})[p];
    if (known) {
      r.known = true;
      if (r.error) console.log(`KNOWN ${p} — ${r.error}`);
      else console.log(`KNOWN ${p} — now runs without error; remove it from knownBroken in pages.json and run npm run snapshot`);
      continue;
    }
    if (UPDATE) {
      if (r.error) { console.log(`ERROR ${p} — ${r.error} (baseline NOT written)`); continue; }
      fs.writeFileSync(file, JSON.stringify({ page: p, views: r.views, console: r.console }, null, 1) + '\n');
      const items = r.views.reduce((n, v) => n + v.layers.reduce((m, l) => m + l.count, 0), 0);
      console.log(`WROTE ${p} (${r.views.length} views, ${items} items, ${r.seconds}s)`);
      continue;
    }
    if (!fs.existsSync(file)) { console.log(`NEW   ${p} — no baseline (run npm run snapshot)`); r.diffs = ['no baseline']; continue; }
    r.diffs = diffSnapshots(JSON.parse(fs.readFileSync(file, 'utf8')), r);
    if (r.diffs.length) {
      fs.writeFileSync(path.join(OUT, slug(p) + '.actual.json'), JSON.stringify(r, null, 1) + '\n');
      console.log(`FAIL  ${p} (${r.seconds}s)\n${r.diffs.slice(0, 25).map(x => '        ' + x).join('\n')}${r.diffs.length > 25 ? `\n        … ${r.diffs.length - 25} more` : ''}`);
    } else console.log(`PASS  ${p} (${r.seconds}s)`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, JOBS) }, worker));
await browser.close();
server.close();

// ------------------------------------------------------------ equivalence
// [twin, original]: the twin spells the same map differently (flat aliases)
// — every layer, theme, legend and tooltip must come out identical
const byPage = new Map(results.map(r => [r.page, r]));
const equivFailed = [];
for (const [twin, orig] of config.equivalent || []) {
  const a = byPage.get(twin), b = byPage.get(orig);
  if (!a || !b) continue; // one of the pair filtered out by --page
  const d = (a.error || b.error || a.skipped || b.skipped) ? [`not comparable: ${a.error || b.error || a.skipped || b.skipped}`]
    : diffSnapshots({ views: b.views, console: [] }, { views: a.views, console: [] });
  if (d.length) {
    equivFailed.push(twin);
    console.log(`NOT EQUIVALENT  ${twin} ≠ ${orig}\n${d.slice(0, 15).map(x => '        ' + x).join('\n')}`);
  } else console.log(`EQUIVALENT  ${twin} ≡ ${orig}`);
}

if (manifestDirty) fs.writeFileSync(MANIFEST, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1) + '\n');
const failed = results.filter(r => !r.known && ((r.diffs && r.diffs.length) || (r.error && !UPDATE)));
const skipped = results.filter(r => r.skipped && !(r.diffs && r.diffs.length)).length;
const known = results.filter(r => r.known).length;
console.log(`\n${results.length} page(s)${ENGINE ? ` against ${path.relative(process.cwd(), ENGINE)}` : ''}: ${UPDATE ? 'baselines written' : `${results.length - failed.length - skipped - known} passed, ${failed.length} failed`}, ${skipped} skipped, ${known} known-broken`
  + ` — data: ${cacheStats.replayed} replayed, ${cacheStats.recorded} recorded, ${cacheStats.live} live (tiles)`);
if (cacheStats.remoteChanged.length) console.log(`WARNING remote data changed since the manifest was written:\n  ${cacheStats.remoteChanged.join('\n  ')}`);
if (equivFailed.length) console.log(`${equivFailed.length} equivalence pair(s) differ`);
process.exitCode = failed.length || equivFailed.length ? 1 : 0;
