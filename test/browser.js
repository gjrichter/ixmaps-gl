// Injected into every page BEFORE any page script (Playwright addInitScript).
// 1. Captures every ixmaps.Map(...) call, whatever global the page keeps
//    the handle in, by trapping assignments to window.ixmaps.
// 2. Exposes window.__glTest.{state, snapshot, zoomBy} for the runner.
//
// A snapshot records what ixmaps-gl PRODUCES, not pixels: every deck.gl
// layer's accessors evaluated for every item (normalized, per-column
// SHA-256), each theme's computed state, legend text and sample tooltips.
(() => {
  const maps = [];
  let current;
  const wrap = v => {
    if (v && typeof v.Map === 'function' && !v.Map.__glTestWrapped) {
      const orig = v.Map;
      const w = function (...args) { const p = orig.apply(this, args); maps.push(p); return p; };
      w.__glTestWrapped = true;
      try { v.Map = w; } catch (e) { /* frozen — leave as is */ }
    }
    return v;
  };
  // ixmaps-gl assigns window.ixmaps once at load (and again, as a Proxy,
  // in validation mode) — both pass through this setter
  Object.defineProperty(window, 'ixmaps', {
    configurable: true, enumerable: true,
    get() { return current; },
    set(v) { current = wrap(v); }
  });

  // ------------------------------------------------------------ normalize

  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
  const round = x => { if (Number.isNaN(x)) return 'NaN'; if (!Number.isFinite(x)) return String(x); const r = Math.round(x * 1e6) / 1e6; return Object.is(r, -0) ? 0 : r; };
  function norm(v, depth = 0) {
    if (v == null) return v === undefined ? '~undef' : null;
    const t = typeof v;
    if (t === 'number') return round(v);
    if (t === 'string') return v.length > 200 ? `#${fnv(v)}:${v.length}` : v;
    if (t === 'boolean') return v;
    if (t === 'function') return '~fn';
    if (depth > 6) return '~deep';
    if (ArrayBuffer.isView(v)) return Array.from(v, x => round(x));
    if (Array.isArray(v)) return v.map(x => norm(x, depth + 1));
    if (t === 'object') {
      if (v instanceof HTMLElement || v instanceof ImageBitmap || v instanceof HTMLCanvasElement) return `~${v.constructor.name}`;
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = norm(v[k], depth + 1);
      return o;
    }
    return String(v);
  }

  async function sha(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }

  const itemsOf = data => Array.isArray(data) ? data
    : (data && Array.isArray(data.features)) ? data.features
    : (data && typeof data.length === 'number') ? Array.from(data) : [];

  // cheap geometry signature for GeoJSON features (type, vertex count, first vertex)
  function geomSig(f) {
    const g = f && f.geometry;
    if (!g) return null;
    const flat = [];
    (function walk(c) { if (typeof c[0] === 'number') flat.push(c); else c.forEach(walk); })(g.coordinates || []);
    return [g.type, flat.length, flat[0] ? norm(flat[0]) : null];
  }

  // ------------------------------------------------------------ snapshot

  const layerArrays = new WeakMap();
  let layerArraySeq = 0;
  const layersOf = api => (api && api.overlay && api.overlay._props && api.overlay._props.layers) || [];

  async function snapshotLayer(layer) {
    const props = layer.props;
    const items = itemsOf(props.data);
    const accessors = [], constants = {};
    for (const k of Object.keys(props).sort()) {
      if (k === 'data' || k === 'id') continue;
      const v = props[k];
      if (k.startsWith('get') && typeof v === 'function') accessors.push(k);
      else if (typeof v !== 'function' && typeof v !== 'object') constants[k] = norm(v);
      else if (Array.isArray(v) && v.length <= 16 && v.every(x => typeof x === 'number')) constants[k] = norm(v);
    }
    const isGeo = items.length && items[0] && items[0].type === 'Feature';
    const columns = [...accessors, ...(isGeo ? ['~geometry'] : [])];
    const rows = items.map((d, index) => {
      const row = accessors.map(k => { try { return norm(props[k](d, { index, data: props.data, target: [] })); } catch (e) { return `~err:${e.message}`; } });
      if (isGeo) row.push(geomSig(d));
      return row;
    });
    const lines = rows.map(r => JSON.stringify(r));
    const columnDigests = {};
    for (let c = 0; c < columns.length; c++) columnDigests[columns[c]] = await sha(rows.map(r => JSON.stringify(r[c])).join('\n'));
    // numeric ranges per column (first numeric component) for readable diffs
    const stats = {};
    columns.forEach((c, ci) => {
      let min = Infinity, max = -Infinity;
      for (const r of rows) { let x = r[ci]; if (Array.isArray(x)) x = x[0]; if (typeof x === 'number') { if (x < min) min = x; if (x > max) max = x; } }
      if (min !== Infinity) stats[c] = [min, max];
    });
    return {
      id: layer.id,
      type: layer.constructor.layerName || layer.constructor.name,
      count: items.length,
      constants,
      columns,
      digest: await sha(lines.join('\n')),
      setDigest: await sha(lines.slice().sort().join('\n')),
      columnDigests,
      stats,
      sample: rows.slice(0, 20),
    };
  }

  function themeState(rt) {
    const pick = k => (rt[k] === undefined ? undefined : norm(rt[k]));
    return {
      name: rt.name,
      flags: [...(rt.flags || [])].sort(),
      features: rt.features ? rt.features.length : null,
      active: rt._activeFeatures ? rt._activeFeatures.length : null,
      hidden: !!rt._hidden,
      categoryLabels: pick('categoryLabels'),
      categoryColorsRgb: pick('categoryColorsRgb'),
      partsA: pick('partsA'),
      rangeClassed: pick('_rangeClassed'),
      valueMin: pick('_valueMin'),
      valueMax: pick('_valueMax'),
      valueMedian: pick('_valueMedian'),
      maxSizeValue: pick('_maxSizeValue'),
    };
  }

  const text = s => String(s || '').replace(/\s+/g, ' ').trim();

  async function snapshotMap(api, label) {
    const map = api.map;
    const c = map.getCenter();
    const proj = typeof map.getProjection === 'function' ? map.getProjection() : null;
    const layers = [];
    for (const l of layersOf(api)) layers.push(await snapshotLayer(l));
    const runtimes = api.runtimes || [];
    const tooltips = {};
    for (const rt of runtimes) {
      const layer = layersOf(api).find(l => l.id.includes(`-${rt.name}`));
      const items = layer ? itemsOf(layer.props.data) : [];
      if (!items.length || typeof rt.buildTooltipHtml !== 'function') continue;
      const picks = [...new Set([0, Math.floor(items.length / 2), items.length - 1])];
      tooltips[rt.name] = picks.map(i => { try { return text(rt.buildTooltipHtml(items[i])); } catch (e) { return `~err:${e.message}`; } });
    }
    return {
      label,
      view: { zoom: round(map.getZoom()), center: [round(c.lng), round(c.lat)], bearing: round(map.getBearing()), pitch: round(map.getPitch()), projection: (proj && proj.type) || 'mercator' },
      layers,
      themes: runtimes.map(themeState),
      legend: [...document.querySelectorAll('.ix-native-legend')].map(el => text(el.innerText)),
      tooltips,
      validation: typeof api.getValidationReport === 'function' ? norm(api.getValidationReport()) : '~none',
    };
  }

  // resolved map handles, waiting at most `ms` for each
  async function resolvedMaps(ms) {
    const timeout = new Promise(r => setTimeout(() => r('~timeout'), ms));
    const out = [];
    for (const p of maps) out.push(await Promise.race([Promise.resolve(p).catch(e => `~error:${e && e.message}`), timeout]));
    return out;
  }

  window.__glTest = {
    mapCount: () => maps.length,
    // cheap readiness probe — the runner waits until this stops changing
    async state() {
      const apis = await resolvedMaps(0);
      // test pages that add themes after the map exists (e.g. loadProject)
      // expose that work as window.__glTestWait; not settled until it is
      const waiting = window.__glTestWait && !window.__glTestWaitDone;
      if (window.__glTestWait && !window.__glTestWaitHooked) {
        window.__glTestWaitHooked = true;
        Promise.resolve(window.__glTestWait).then(() => { window.__glTestWaitDone = true; }, () => { window.__glTestWaitDone = true; });
      }
      return apis.map(api => {
        if (!api || typeof api !== 'object' || !api.map) return { pending: String(api) };
        const arr = layersOf(api);
        if (!layerArrays.has(arr)) layerArrays.set(arr, ++layerArraySeq);
        return { loaded: api.map.loaded() && !waiting, moving: api.map.isMoving(), layersRef: layerArrays.get(arr), layers: arr.length, splash: !!document.querySelector('.ixmaps-splash') };
      });
    },
    async snapshot(label) {
      const apis = await resolvedMaps(0);
      const out = [];
      for (const api of apis) out.push(api && api.map ? await snapshotMap(api, label) : { label, error: String(api) });
      return out;
    },
    async zoomBy(step) {
      const apis = await resolvedMaps(0);
      for (const api of apis) if (api && api.map) api.map.jumpTo({ zoom: api.map.getZoom() + step });
    },
    resolvedMaps: async ms => (await resolvedMaps(ms)).map(a => (a && a.map ? 'ok' : String(a))),
  };
})();
