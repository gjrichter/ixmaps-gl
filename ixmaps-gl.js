// =======================================================================
// ixmaps-gl.js — a generic, config-driven map/theme engine exposing
// the SAME declarative builder API as the original ixmaps framework
// (ixmaps.Map(...), ixmaps.layer(...).data().binding().filter().type()
// .style().meta()), rendering through MapLibre GL + deck.gl instead of
// ixmaps' own SVG/Leaflet engine.
//
// Scope note (read this before assuming a keyword "works"): this engine
// fully implements the theme-type grammar our real layers exercise —
// FEATURE/FEATURES (polygon/line rendering, singular is the real engine's
// own keyword, plural this port's earlier convention — both accepted),
// CHOROPLETH (polygon fill from a bound value — single-field numeric range
// via QUANTILE/NATURAL/equal-interval; multi-field DOMINANT's per-polygon
// argmax across piped fields, plain (highest raw value), |PERCENTOFMEAN
// (highest % deviation from that field's own cross-record mean), or
// |DEVIATION (highest z-score above that field's own mean); or multi-field
// COMPOSECOLOR's per-polygon color BLEND across the same piped fields,
// additive or |SUBTRACTIVE; and DOPACITY/DOPACITYMIN/DOPACITYMAX/
// DOPACITYMINMAX, which drive per-polygon fill OPACITY (not color) —
// from the same bound value by default, or from .binding({alpha,
// alpha100}) when set (alpha100:"$density$" divides by the polygon's
// own geodesic area — see _prepareAlphaField/_resolveDopacityAlpha).
// AGGREGATE CATEGORICAL on one field paints each polygon in its records'
// dominant category; a plain CATEGORICAL choropleth is not implemented,
// see _buildChoroplethLayers), and the CHART|SYMBOL|
// GLOW|CATEGORICAL|AGGREGATE|COUNT|RELOCATE|VALUES pipeline (categorical
// clustering + sizing + glow + multi-bubble grouping + on-bubble value
// labels, generalized to however many distinct category values the DATA
// actually contains — never hardcoded; NORMALIZE additionally rescales
// every point's/group's aggregated value into [0,1] post-aggregation,
// the one thing that keeps a SUM aggregation's per-cell total bounded
// regardless of local record density — see the NORMALIZE block in
// _buildChartLayers). A non-CATEGORICAL numeric-range bubble
// (_buildPartsA's own coloring mode, not exact-match CATEGORICAL) run
// through AGGREGATE colors from each cell's own AGGREGATED total, not
// each record's raw value — see _rangeClassed/the reclassify block in
// _buildChartLayers, matching the real engine's own order of operations
// (maptheme.js classes color from nValuesA[0] AFTER binning). Plus DOT,
// the real engine's
// simplest base symbol type (a fixed-radius, unclustered point — see
// DOT_RADIUS_PX/_buildDotLayers). BUBBLE, DOT, and CHOROPLETH all share
// the real engine's two coloring modes for a bound value: CATEGORICAL
// (exact-match classes) and numeric range/class coloring (_buildPartsA —
// equal-interval by default, or QUANTILE, or NATURAL/Jenks, with flat's
// range adjustments; see flatRangeParts). A CHOROPLETH
// layer's geometry is borrowed from a FEATURE base layer sharing the same
// .layer() name (the real engine's own convention), joined via
// binding.lookup — see joinChoroplethFeatures. HEADTAIL breaks are flat's
// (headTailBreaks); LOG/POW2/POW3 are recognized type flags but not
// implemented, see KNOWN_INERT_FLAGS. CHART|USER draws a page's own chart
// function (style.userdraw, _buildUserChartLayers), CHART|LABEL flat's
// value label, boxed or TEXTONLY (_buildLabelChartLayers). These
// base types are dispatched by buildDeckLayers in the real engine's own
// precedence order — DOT is checked first because the real engine's DOT
// bypasses the whole drawChart/modifier pipeline rather than being
// "BUBBLE with the size locked." Other real base types (QUAD, BEZIER,
// VECTOR, PIE/DONUT, WAFFLE, BAR, and SYMBOL's own shape variants) are NOT
// implemented yet — adding one means a new _buildXLayers() method plus a
// dispatch line, not a rewrite, but each should be added deliberately
// (checking, per real source, which modifiers it actually shares with
// BUBBLE) rather than forced through a shared "modifier pipeline"
// abstraction that doesn't exist yet. Flags with no distinct rendering
// behavior yet (see KNOWN_INERT_FLAGS) are recognized and stored, not
// silently dropped, but produce a one-time console note rather than a
// fabricated effect — this is not full coverage of ixmaps' entire theme
// grammar.
// =======================================================================

(function (global) {
  'use strict';

  // ---------------------------------------------------------------
  // Lazy-loaded dependencies — a page only needs to include THIS one
  // script; MapLibre GL, deck.gl, and Mustache are fetched
  // on first use, matching the real ixmaps-flat engine's own single-
  // <script src="ixmaps.js"> convention instead of this port's earlier
  // per-page 5-tag boilerplate (a page may still include them statically:
  // ensureLibrariesLoaded below reuses compatible copies and replaces
  // outdated ones — deck.gl < 9.4, maplibre-gl < 4.5.1 — with a warning).
  // Same CDN builds every example page already pinned; centralized here
  // so bumping a version is a one-file edit, not a 13-file one.
  // ---------------------------------------------------------------
  // this engine's release (= package.json "version", checked by
  // test/unit/version.test.mjs); ixmaps.glVersion, and logged once at start
  const IXMAPS_GL_VERSION = '0.2.12';

  const LIB_URLS = {
    // Bumped 3.6.2 -> 5.x (2026-09-21, globe-projection compat fix): native
    // globe projection (map.setProjection({type:'globe'})) needs >=5.0.1
    // (5.0.0 shipped a style-spec regression, reverted in 5.0.1). Requires
    // MapLibre GL JS v4.5.1, v5, or v6 on the deck.gl side (see `deck`
    // below) — v5 satisfies that.
    // 5.x -> 6.x (2026-09-29): MapLibre 6 is published only as an ES
    // module (dist/maplibre-gl.mjs, named exports, no UMD bundle and no
    // window.maplibregl) — loadMaplibre imports it and provides the global.
    // Its worker (maplibre-gl-worker.mjs, resolved next to the module) is
    // cross-origin from the CDN; MapLibre wraps it in a same-origin blob URL
    // itself. Pinned to an exact version: unpkg answers a version range
    // (@6) with a redirect, and a browser refuses a worker script that
    // redirects ("Refused to cross-origin redirects of the top-level worker
    // script" — the map never loaded on a file:// page).
    maplibreCss: 'https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.css',
    maplibreJs: 'https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs',
    // Bumped 8.9.35 -> 9.4.0 (2026-09-21, globe-reprojection fix): v8's
    // interleaving (MapboxOverlay) always computed flat Web-Mercator
    // screen positions regardless of the map's actual projection —
    // confirmed live, every theme layer (bubbles, country fill, even the
    // graticule — whose dead-straight, non-converging lines were the
    // giveaway: real meridians/parallels curve toward the poles under any
    // spherical projection) stayed a flat, static, un-rotated rectangle
    // while only MapLibre's own native basemap became a true sphere.
    // Globe-aware interleaving camera sync landed in deck.gl v9.1; the
    // dedicated @deck.gl/maplibre module (MapLibreOverlay, forked from
    // @deck.gl/mapbox's MapboxOverlay specifically for MapLibre) shipped
    // in v9.4 — see the MapLibreOverlay swap below. Needs a WebGL2
    // context for interleaved mode (deck.gl v9's own requirement,
    // supplied by MapLibre GL JS itself, nothing this engine manages).
    deck: 'https://unpkg.com/deck.gl@9.4.0/dist.min.js',
    mustache: 'https://unpkg.com/mustache@4.2.0/mustache.min.js',
    // loaded by default, as flat does (its resource list loads
    // ../data.js/data.js — from its CDN build, this URL); every data format
    // except GeoJSON/TopoJSON is read by it, see fetchLayerData
    dataJs: 'https://cdn.jsdelivr.net/gh/gjrichter/data.js/data.js'
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`[ixmaps-gl] failed to load ${src}`));
      document.head.appendChild(el);
    });
  }
  // MapLibre 6's ES module → the window.maplibregl the engine and pages use
  // (a copy of its named exports: a module namespace is read-only)
  function loadMaplibre(src) {
    installFileWorkerShim();
    return import(src).then(mod => {
      global.maplibregl = Object.assign({}, mod.default || {}, mod);
    }, err => { throw new Error(`[ixmaps-gl] failed to load ${src}: ${err && err.message}`); });
  }
  // MapLibre 6 starts its worker as a module worker; for a worker on the
  // CDN it wraps it in a blob URL (`import "…maplibre-gl-worker.mjs"`).
  // On a file:// page Chrome refuses every module worker from a blob URL
  // ("Refused to cross-origin redirects of the top-level worker script" —
  // the map never loaded), while a module worker from a data: URL works.
  // Only there, and only for MapLibre's own wrapper, the Worker is started
  // from the same import as a data: URL. Other workers are untouched.
  function installFileWorkerShim() {
    if (!global.location || global.location.protocol !== 'file:' || !global.Worker || global.Worker.__ixmapsGlFileShim) return;
    const NativeBlob = global.Blob, NativeWorker = global.Worker;
    const maplibreWorkerImport = new WeakMap(); // Blob → its import statement
    const blobUrls = new Map();                 // blob: URL → import statement
    const isMaplibreImport = t => typeof t === 'string' && /^import "https?:[^"]*\/maplibre-gl-worker(-dev)?\.mjs"$/.test(t);
    function Blob(parts, opts) {
      const b = new NativeBlob(parts, opts);
      if (Array.isArray(parts) && parts.length === 1 && isMaplibreImport(parts[0])) maplibreWorkerImport.set(b, parts[0]);
      return b;
    }
    Blob.prototype = NativeBlob.prototype;
    global.Blob = Blob;
    const nativeCreate = global.URL.createObjectURL;
    global.URL.createObjectURL = function (obj) {
      const u = nativeCreate.call(this, obj);
      if (maplibreWorkerImport.has(obj)) blobUrls.set(u, maplibreWorkerImport.get(obj));
      return u;
    };
    function Worker(url, opts) {
      const imp = blobUrls.get(String(url));
      if (imp && opts && opts.type === 'module') return new NativeWorker('data:text/javascript,' + encodeURIComponent(imp), opts);
      return new NativeWorker(url, opts);
    }
    Worker.prototype = NativeWorker.prototype;
    Worker.__ixmapsGlFileShim = true;
    global.Worker = Worker;
  }
  function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('link');
      el.rel = 'stylesheet';
      el.href = href;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`[ixmaps-gl] failed to load ${href}`));
      document.head.appendChild(el);
    });
  }

  // IconLayer/ScatterplotLayer/GeoJsonLayer/MapLibreOverlay/TextLayer are
  // bound once loading completes (see ensureLibrariesLoaded) — every
  // _buildXLayers method reads these as closure variables, same as when
  // they were a top-level `const` destructured synchronously; the only
  // change is WHEN they're populated, not how they're used afterward.
  //
  // MapLibreOverlay (not MapboxOverlay) as of the deck.gl 9.4.0 bump —
  // the dedicated @deck.gl/maplibre interleaving class, needed for the
  // MapLibre-globe camera sync MapboxOverlay doesn't have. Both classes
  // ship in the same UMD bundle; confirmed present via a direct
  // byte-grep of the shipped file (deck.gl's own @deck.gl/maplibre
  // overview page claims ES-modules-only, which the actual UMD bundle
  // contradicts).
  let IconLayer, ScatterplotLayer, GeoJsonLayer, MapLibreOverlay, TextLayer;

  // Cached so multiple ixmaps.Map() calls on one page (or a page that
  // still has its own static <script> tags for these libraries) only
  // ever fetch once: a library a page already loaded is reused when it is
  // compatible — MapLibre >= 4.5.1 and a deck.gl with MapLibreOverlay
  // (>= 9.4) — and replaced, with a console warning, when it isn't (see
  // pageMaplibreUsable/pageDeckUsable). Mustache is reused as found.
  let _librariesPromise = null;
  // A page's own deck.gl is reused only if it has what this engine needs:
  // MapLibreOverlay (deck.gl >= 9.4). Older pages still carry a deck.gl
  // 8.9 <script> tag from before the 9.4 bump — reusing that one made
  // `new MapLibreOverlay(...)` throw "is not a constructor" and the map
  // never loaded. Feature-detected, not version-parsed.
  function pageDeckUsable() {
    if (!global.deck) return false;
    if (global.deck.MapLibreOverlay) return true;
    console.warn(`[ixmaps-gl] this page loads deck.gl ${global.deck.VERSION || '(unknown version)'}, which has no MapLibreOverlay — loading deck.gl ${LIB_URLS.deck.match(/deck\.gl@([\d.]+)/)[1]} instead (it replaces window.deck); remove the page's own deck.gl <script> tag`);
    // deck.gl's bundle refuses to initialize while an older one's globals
    // are still there — "deck.gl - multiple versions detected" (window.deck)
    // and "luma.gl - multiple versions detected" (window.luma) — and merges
    // into an existing window.loaders. The deck.gl 8.9 bundle sets all
    // three (plus Hammer and polyfills, which 9.4 doesn't touch): take them
    // off before loading ours.
    for (const k of ['deck', 'luma', 'loaders']) {
      try { delete global[k]; } catch (e) { global[k] = undefined; }
    }
    return false;
  }
  // Same for a page's own MapLibre: deck.gl 9.4's MapLibreOverlay throws
  // "interleaved rendering requires MapLibre GL JS 4.5.1 or later" on the
  // maplibre-gl 3.x such pages load. A version check here, since that's
  // how deck.gl states the requirement. (The globe projection needs
  // >= 5.0.1; setProjectJSON already warns about that separately.)
  const MAPLIBRE_MIN_VERSION = [4, 5, 1];
  function pageMaplibreUsable() {
    const m = global.maplibregl;
    if (!m) return false;
    const v = String((typeof m.getVersion === 'function' && m.getVersion()) || m.version || '');
    const parts = v.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((parts[i] || 0) !== MAPLIBRE_MIN_VERSION[i]) {
        if ((parts[i] || 0) > MAPLIBRE_MIN_VERSION[i]) return true;
        break;
      }
      if (i === 2) return true;
    }
    console.warn(`[ixmaps-gl] this page loads maplibre-gl ${v || '(unknown version)'}; deck.gl needs >= ${MAPLIBRE_MIN_VERSION.join('.')} — loading ${LIB_URLS.maplibreJs.match(/maplibre-gl@([\d.]+)/)[1]} instead (it replaces window.maplibregl); remove the page's own maplibre-gl <script> tag`);
    return false;
  }
  // data.js, unless the page has it already: .options({datajs: url}) loads
  // another build, .options({datajs: false}) none (CSV then falls back to
  // this engine's own parser; other formats need it). A failed load is a
  // warning, not an error — the fallback still reads CSV/GeoJSON/TopoJSON.
  let _dataJsPromise = null;
  function ensureDataJs(engineOptions) {
    if (global.Data) return Promise.resolve(true);
    const opt = engineOptions && engineOptions.datajs;
    if (opt === false || opt === 'false') return Promise.resolve(false);
    if (!_dataJsPromise) {
      const url = typeof opt === 'string' && opt ? opt : LIB_URLS.dataJs;
      _dataJsPromise = loadScript(url).then(() => !!global.Data, e => {
        console.warn(`[ixmaps-gl] data.js could not be loaded (${url}) — CSV, GeoJSON and TopoJSON are read by ixmaps-gl itself, other formats need data.js`);
        return false;
      });
    }
    return _dataJsPromise;
  }

  function ensureLibrariesLoaded() {
    if (!_librariesPromise) {
      _librariesPromise = Promise.all([
        pageMaplibreUsable() ? Promise.resolve() : loadMaplibre(LIB_URLS.maplibreJs),
        pageDeckUsable() ? Promise.resolve() : loadScript(LIB_URLS.deck),
        global.Mustache ? Promise.resolve() : loadScript(LIB_URLS.mustache),
        [...document.styleSheets].some(s => s.href === LIB_URLS.maplibreCss) ? Promise.resolve() : loadStylesheet(LIB_URLS.maplibreCss)
      ]).then(() => {
        ({ IconLayer, ScatterplotLayer, GeoJsonLayer, MapLibreOverlay, TextLayer } = global.deck);
        // which engine and libraries this page really runs (a page may
        // bring its own MapLibre/deck.gl — the loaded ones are named)
        const ml = global.maplibregl && typeof global.maplibregl.getVersion === 'function' ? global.maplibregl.getVersion() : '?';
        console.info(`[ixmaps-gl] ${IXMAPS_GL_VERSION} · MapLibre ${ml} · deck.gl ${global.deck.VERSION || '?'}`);
        // Matches the real engine's own ui/js/tools/tooltip_mustache.js,
        // which overrides Mustache.escape to identity: tooltip HTML (the
        // template itself, and this engine's own chart/data-table
        // fragments — see LayerRuntime.buildTooltipHtml) is trusted
        // markup, not user input, so interpolated values are inserted
        // raw rather than HTML-escaped.
        global.Mustache.escape = text => text;
      });
    }
    return _librariesPromise;
  }

  // ---------------------------------------------------------------
  // Opt-in grammar validation — checks every theme definition against
  // the shared ixmaps grammar (github.com/gjrichter/ixmaps-grammar, the
  // keyword registry extracted from the real ixmaps-flat sources) and
  // warns once per keyword about anything unknown (typos) or not
  // implemented by THIS engine. Off by default: nothing is fetched and
  // nothing changes unless a page turns it on with
  //   .options({ validate: true })            (or a validator URL string)
  //   ixmaps.validate = true                  (before or after this script)
  //   ?ixmaps-validate                        (page URL; on/off only)
  // The query parameter can only switch validation ON — it never selects
  // the validator URL, since that URL is import()ed and executed: a
  // crafted link must not be able to load arbitrary code into the page.
  // ---------------------------------------------------------------
  // v0.1.6: knows this engine's aliases, lookupfield rule, meta↔style, builder methods, project loading
  const VALIDATOR_URL_DEFAULT = 'https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-grammar@v0.1.25/dist/validate.mjs';
  // a page may set ixmaps.validate BEFORE loading this script — the
  // `global.ixmaps = {...}` export below would otherwise overwrite it
  const _preloadValidate = global.ixmaps && global.ixmaps.validate;

  function resolveValidatorUrl(engineOptions) {
    const opt = engineOptions && engineOptions.validate;
    if (opt === false) return null;
    const setting = opt != null ? opt : (global.ixmaps && global.ixmaps.validate);
    if (typeof setting === 'string' && setting) return setting;
    if (setting) return VALIDATOR_URL_DEFAULT;
    try {
      if (new URLSearchParams(global.location.search).has('ixmaps-validate')) return VALIDATOR_URL_DEFAULT;
    } catch (e) { /* no location (non-browser) */ }
    return null;
  }

  const _validatorModules = new Map();
  function loadValidatorModule(url) {
    if (!_validatorModules.has(url)) _validatorModules.set(url, import(url));
    return _validatorModules.get(url);
  }

  // One per map. Findings print once per (layer, code, keyword) and are
  // kept for map.getValidationReport().
  class GrammarValidation {
    constructor(mod) {
      this.mod = mod;
      this.report = [];
      this._seen = new Set();
      this.v = mod.createValidator({
        engine: 'gl',
        onFinding: (f, ctx) => {
          const layer = ctx && ctx.layer != null ? ctx.layer : null;
          const key = `${layer}|${f.code}|${f.keyword}`;
          if (this._seen.has(key)) return;
          this._seen.add(key);
          this.report.push(Object.assign({ layer }, f));
          const where = layer != null ? `layer "${layer}": ` : '';
          const log = f.severity === 'info' ? console.info : console.warn;
          log(`[ixmaps-gl validate] ${f.severity} ${f.code} — ${where}${f.message}`);
        }
      });
    }
    layer(lb) { this.definition(lb.definition()); }
    definition(def) { this.v.theme(def, { layer: def.layer }); }
    mapOptions(o) { this.v.mapOptions(o, { layer: null }); }
    options(o) { this.v.options(o, { layer: null }); }
    style(themeId, patch) { this.v.style(patch, { layer: themeId }); }
    // a property read on the ixmaps global that this engine doesn't have:
    // report it when ixmaps-flat has it (a real gap) or it's a near-miss
    // typo; stay silent for anything else (a page's own ixmaps.* state)
    runtimeAccess(name) {
      const known = this.v.v.lookup('runtimeApi', name).known;
      if (known || this.mod.suggest(name, this.v.v.keys('runtimeApi'))) this.v.runtimeCall(name, { layer: null });
    }
  }

  // Replaces the ixmaps global with a Proxy (validation mode only) that
  // reports reads of missing properties, then returns undefined exactly as
  // before — feature checks like `if (ixmaps.setMapTool)` keep working.
  const PROXY_IGNORED_PROPS = new Set(['then', 'toJSON', 'constructor', 'prototype', 'valueOf', 'toString',
    'length', 'nodeType', 'tagName', '$$typeof', 'inspect', 'validate', '__proto__']);
  // the ixmaps object behind the validation proxy: gl's own reads of names
  // a page may define (hooks like htmlgui_onNewTheme, broker functions) go
  // there, so an undefined hook isn't reported as the page's use of it
  let _rawIxmaps = null;
  function pageIxmaps() { return _rawIxmaps || global.ixmaps; }
  function installRuntimeApiProxy(validation) {
    const target = global.ixmaps;
    if (!target || target.__ixmapsGlValidationProxy) return;
    _rawIxmaps = target;
    global.ixmaps = new Proxy(target, {
      get(t, prop, recv) {
        if (prop === '__ixmapsGlValidationProxy') return true;
        if (typeof prop === 'string' && !(prop in t) && !PROXY_IGNORED_PROPS.has(prop)) validation.runtimeAccess(prop);
        return Reflect.get(t, prop, recv);
      }
    });
  }

  // null when validation is off or the validator can't be loaded — a
  // validator failure must never break the map itself
  async function startValidation(engineOptions) {
    const url = resolveValidatorUrl(engineOptions);
    if (!url) return null;
    try {
      const validation = new GrammarValidation(await loadValidatorModule(url));
      console.info(`[ixmaps-gl validate] on — ixmaps-grammar ${validation.mod.version || '?'} (${url})`);
      installRuntimeApiProxy(validation);
      return validation;
    } catch (e) {
      console.warn(`[ixmaps-gl validate] could not load the validator from ${url} — continuing without validation`, e);
      return null;
    }
  }

  // ---------------------------------------------------------------
  // generic TopoJSON -> GeoJSON decoding (all geometry types, with or
  // without quantization) — no external topojson-client dependency
  // ---------------------------------------------------------------

  function decodeArc(arc, transform) {
    if (!transform) return arc.map(p => [p[0], p[1]]);
    const [sx, sy] = transform.scale;
    const [tx, ty] = transform.translate;
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  }

  function ringCoords(arcIndices, arcs, transform) {
    let ring = [];
    arcIndices.forEach(idx => {
      const reversed = idx < 0;
      const arc = arcs[reversed ? ~idx : idx];
      let pts = decodeArc(arc, transform);
      if (reversed) pts = pts.slice().reverse();
      if (ring.length && ring[ring.length - 1][0] === pts[0][0] && ring[ring.length - 1][1] === pts[0][1]) {
        pts = pts.slice(1);
      }
      ring = ring.concat(pts);
    });
    return ring;
  }

  function topoGeometryToGeoJSON(geom, arcs, transform) {
    switch (geom.type) {
      case 'Point': return { type: 'Point', coordinates: geom.coordinates };
      case 'MultiPoint': return { type: 'MultiPoint', coordinates: geom.coordinates };
      case 'LineString': return { type: 'LineString', coordinates: ringCoords(geom.arcs, arcs, transform) };
      case 'MultiLineString': return { type: 'MultiLineString', coordinates: geom.arcs.map(a => ringCoords(a, arcs, transform)) };
      case 'Polygon': return { type: 'Polygon', coordinates: geom.arcs.map(ring => ringCoords(ring, arcs, transform)) };
      case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: geom.arcs.map(poly => poly.map(ring => ringCoords(ring, arcs, transform))) };
      default: return null;
    }
  }

  function topojsonToFeatureCollection(topo) {
    const objName = Object.keys(topo.objects)[0];
    const obj = topo.objects[objName];
    const geoms = obj.type === 'GeometryCollection' ? obj.geometries : [obj];
    const features = geoms.map(g => ({
      type: 'Feature',
      properties: g.properties || {},
      geometry: topoGeometryToGeoJSON(g, topo.arcs, topo.transform)
    })).filter(f => f.geometry);
    return { type: 'FeatureCollection', features };
  }

  // Real ixmaps source CSV exports (confirmed live against
  // data.ixmaps.com/DStatis/Unfallorte*.csv.gz) are semicolon-delimited,
  // UTF-8-with-BOM, European-locale numbers (comma decimal separator,
  // e.g. "9,389075627000068"). No embedded delimiters/quotes observed in
  // these specific government exports, so a plain split is enough — this
  // is NOT a general RFC4180 parser (no quoted-field support), matching
  // only what this real data source actually needs.
  //
  // Delimiter is sniffed from the header line, not hardcoded — confirmed
  // live that not every real CSV source uses ';': the ixmaps-data comuni
  // demographics export (italy-comuni-demographics-ixmaps.html) is plain
  // comma-delimited, decimal-DOT (no European-locale comma parsing
  // needed for that source, unlike the semicolon-delimited German one).
  // one CSV line -> cells; a quoted cell ("a,b" or "say ""hi""") may hold
  // the delimiter and doubled quotes (RFC 4180, as data.js/PapaParse read
  // it in flat). Lines without a quote take the plain split (big files).
  // (A quoted cell spanning several lines is not supported.)
  function splitCsvLine(line, delimiter) {
    if (!line.includes('"')) return line.split(delimiter);
    const cells = [];
    let cell = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === delimiter) { cells.push(cell); cell = ''; }
      else cell += ch;
    }
    cells.push(cell);
    return cells;
  }

  function parseCsvText(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\r\n|\n/).filter(l => l.length);
    if (!lines.length) return [];
    const delimiter = lines[0].includes(';') ? ';' : ',';
    const headers = splitCsvLine(lines[0], delimiter);
    const rows = new Array(lines.length - 1);
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i], delimiter);
      const row = {};
      for (let c = 0; c < headers.length; c++) row[headers[c]] = cells[c];
      rows[i - 1] = row;
    }
    return rows;
  }

  // European-locale numeric string ("9,389075627000068") -> float. Only
  // applied to the two fields binding.position names, not every column —
  // most of this data source's other fields are plain integers.
  function parseEuroFloat(v) {
    return parseFloat(String(v).replace(',', '.'));
  }

  // binding.position: "YFIELD|XFIELD" (real convention, matches the
  // source's own field order — Y/northing first, X/easting second) is
  // CSV's only way to carry a position, since (unlike topojson/geojson)
  // a CSV row has no embedded geometry. Splits out from the row's other
  // columns into a GeoJSON Point feature, matching topojsonToFeatureCollection's
  // output shape so the rest of the engine (which only ever reads
  // f.geometry.coordinates / f.properties) can't tell the difference.
  function csvRowsToFeatureCollection(rows, position) {
    const [yField, xField] = String(position || '').split('|');
    if (!yField || !xField) {
      throw new Error('[ixmaps-gl] CSV .data() needs .binding({position: "YFIELD|XFIELD"}) — no embedded geometry to fall back to');
    }
    const features = [];
    for (const row of rows) {
      const lat = parseEuroFloat(row[yField]), lon = parseEuroFloat(row[xField]);
      if (isNaN(lat) || isNaN(lon)) continue;
      features.push({ type: 'Feature', properties: row, geometry: { type: 'Point', coordinates: [lon, lat] } });
    }
    return { type: 'FeatureCollection', features };
  }

  // GL-PORT COMPAT: a real ixmaps-flat page's inline/fetched GeoJSON can
  // legitimately carry a geometry type this engine's own renderers don't
  // draw — confirmed live with an Orthographic globe's native
  // {type:"Sphere"} ocean backdrop (create-ixmap skill's own documented
  // convention: a `{type:"Sphere"}` geometry, no `coordinates`, draws the
  // full visible-globe disc and auto-recenters every redraw — a real
  // engine feature, not a mistake in the page). Left unfiltered, this
  // reached deck.gl's GeoJsonLayer directly and threw ("Unknown GeoJSON
  // type Sphere"), same failure mode as an unrecognized type flag would
  // if KNOWN_INERT_FLAGS didn't exist. Same fix here: recognize and warn
  // ONCE per type rather than letting deck.gl's own harder failure
  // surface — the feature is dropped (no renderer implemented for it
  // yet), everything else in the same FeatureCollection still draws.
  const KNOWN_GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);
  const _warnedGeometryTypes = new Set();
  function sanitizeGeoJSON(fc) {
    if (!fc || !Array.isArray(fc.features)) return fc;
    const features = fc.features.filter(f => {
      const t = f && f.geometry && f.geometry.type;
      if (!t || KNOWN_GEOMETRY_TYPES.has(t)) return true;
      if (!_warnedGeometryTypes.has(t)) {
        _warnedGeometryTypes.add(t);
        console.info(`[ixmaps-gl] geometry type "${t}" recognized (real ixmaps-flat convention), no renderer implemented yet — features of this type are skipped`);
      }
      return false;
    });
    return features.length === fc.features.length ? fc : Object.assign({}, fc, { features });
  }

  // CHOROPLETH's own .data() (e.g. the comuni demographics CSV in
  // italy-comuni-demographics-ixmaps.html) carries no point geometry at
  // all — it's a plain lookup table joined against a FEATURE base layer's
  // geometry by binding.lookup (see MapBuilder.build()'s
  // joinChoroplethFeatures). binding.lookup with no binding.position is
  // the signal for that shape; anything else still builds Point features
  // as before (binding.position, or neither — the .position-required
  // error path below).
  // flat: without a position binding, the table's geometry column — the
  // first field named like /geometry|geom|geo/ (maptheme.js 15887-15896)
  // that holds GeoJSON, as data.js hands over its geo formats
  function geometryField(rows) {
    const row = rows && rows[0];
    if (!row) return null;
    for (const k of Object.keys(row)) {
      if (!/geometry|geom|geo/i.test(k)) continue;
      const v = row[k];
      if ((v && typeof v === 'object' && v.type) || (typeof v === 'string' && /coordinates/i.test(v))) return k;
    }
    return null;
  }
  // ---------------------------------------------------------------
  // flat's data cache (maptheme.js 2457-2500, themeDataCacheA): data once
  // loaded from a source is reused by every later theme of the map with the
  // same source — data.cache (also style.datacache, see the dbtable* table)
  // defaults to true (fDataCache, maptheme.js 7736); cache: false reloads.
  // The key is the fetch identity PLUS the shape the binding asks for:
  // rowsResult() turns the same CSV rows into a Table (lookup only) or a
  // FeatureCollection (position), so two themes reading one URL differently
  // must not share one result.
  // ---------------------------------------------------------------
  // the data source itself (no shape) — also rt._dataSourceKey, which tells the
  // facet filters which themes share one dataset (setFacetFilter)
  function dataSourceKey(data) {
    const d = data || {};
    return JSON.stringify({ url: d.url, urls: d.urls, type: d.type, query: d.query,
      process: d.process && String(d.process), ext: d.ext, name: d.ext ? d.name : undefined });
  }
  function dataCacheKey(data, binding) {
    const b = binding || {};
    return dataSourceKey(data) + '|' + (b.lookup && !b.position ? 'table' : 'pos:' + (b.position || ''));
  }
  function dataCacheDisabled(dataConfig) {
    const c = dataConfig && dataConfig.cache;
    return c === false || (typeof c === 'string' && c.trim().toLowerCase() === 'false');
  }
  // cache: Map key → Promise; a failed load is not kept (the next theme tries again)
  function cachedLayerData(cache, data, binding, engineOptions, { reload = false } = {}) {
    const key = dataCacheKey(data, binding);
    if (reload || dataCacheDisabled(data) || !cache.has(key)) {
      const p = fetchLayerData(data, binding, engineOptions);
      cache.set(key, p);
      p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
    }
    return { key, sourceKey: dataSourceKey(data), promise: cache.get(key) };
  }

  // ---------------------------------------------------------------
  // SHOW / ZOOMTO (flat maptheme.js 8714-8740, MapTheme.zoomTo 15664): once
  // a theme is drawn, the map zooms to the extent of its items, then the
  // flag is dropped — once per theme definition, not on every redraw.
  // featuresBounds: [[west, south], [east, north]] of every coordinate, or
  // null when there is none.
  // ---------------------------------------------------------------
  function featuresBounds(features) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const visit = c => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === 'number' && typeof c[1] === 'number') {
        if (!isFinite(c[0]) || !isFinite(c[1]) || Math.abs(c[1]) > 90) return;
        if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
        if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
        return;
      }
      for (const x of c) visit(x);
    };
    const geom = g => {
      if (!g) return;
      if (g.type === 'GeometryCollection') (g.geometries || []).forEach(geom);
      else visit(g.coordinates);
    };
    for (const f of features || []) geom(f && f.geometry);
    return w === Infinity ? null : [[w, s], [e, n]];
  }
  // the `legend` map option as flat reads it (htmlgui_flat.js 748-794): on whenever given
  // and not false/"false"/0
  function legendIsOn(opt) {
    return opt !== undefined && opt !== null && opt !== false && opt !== 'false' && opt !== 0 && opt !== '0';
  }
  function wantsZoomToExtent(flags) {
    return !!flags && (flags.has('SHOW') || flags.has('ZOOMTO'));
  }

  function rowsResult(rows, binding) {
    if (binding && binding.lookup && !binding.position) return { type: 'Table', rows };
    const position = (binding && binding.position) || geometryField(rows);
    if (position && !String(position).includes('|')) return geometryRowsToFeatureCollection(rows, position);
    return csvRowsToFeatureCollection(rows, position);
  }

  // rows whose `field` holds a GeoJSON geometry (object or JSON string) →
  // features — how data.js hands over its geo formats (KML, GML, Geobuf,
  // FlatGeobuf, GeoPackage, GeoParquet, ...: a table with a "geometry"
  // column), read by flat through lookupfield "geometry"
  function geometryRowsToFeatureCollection(rows, field) {
    const features = [];
    let parsed = 0;
    for (const row of rows) {
      let g = row[field];
      if (typeof g === 'string') {
        try { g = JSON.parse(g); } catch (e) { g = null; }
      }
      if (!g || typeof g !== 'object' || !g.type) continue;
      parsed++;
      const properties = Object.assign({}, row);
      delete properties[field];
      features.push({ type: 'Feature', properties, geometry: g });
    }
    if (rows.length && !parsed) {
      throw new Error(`[ixmaps-gl] .binding({geo: "${field}"}): the "${field}" column holds no GeoJSON geometry — for point data use "LATFIELD|LONFIELD"`);
    }
    return sanitizeGeoJSON({ type: 'FeatureCollection', features });
  }

  // Bridges the real ixmaps runtime's ixmaps.setExternalData(dataObj, opt)
  // — a verbatim, unmodified query() function body (copied straight from
  // a real ported page) calls Data.provider().addSource(...).realize(cb
  // => {...; ixmaps.setExternalData(dataA[0], opt);}) and expects that
  // call to hand control back to whatever was waiting on the data. The
  // REAL engine's own hand-off is side-effect-driven, not Promise-based
  // — it stores the table on window[szDataName], clears per-theme
  // "waiting" flags, and re-enters a synchronous theme-rendering
  // pipeline (confirmed by reading maptheme.js:2559-2583 directly: real
  // ixmaps-flat dev tree, Themes.prototype.setExternalData). This engine
  // has no such pipeline to resume, so the bridge only needs to do the
  // ONE thing fetchLayerData actually needs: resolve the promise a
  // query()-mode fetch is awaiting. build()'s layer-loading loop is
  // strictly sequential (one .data({query}) in flight at a time, see its
  // dataCache), so a single pending-resolver slot is enough — not a
  // registry keyed by data name like the real engine's.
  let _pendingQueryResolve = null;
  // Data by name, as flat (maptheme.js 2570-2593, 8286-8310):
  // setExternalData(data, {type, name}) makes a data.js Table of the data
  // and keeps it as window[name]; whoever waits for that name gets it, and
  // every live theme of that name reloads from it (a theme may only name
  // another theme's data: .data({name})). See loadNamedTheme in build().
  const _namedDataWaiters = new Map();   // name → Set of resolve(table)
  const _namedDataListeners = new Map(); // name → Set of fn(table)
  function namedTable(name) {
    try { const t = global[name]; return t && typeof t === 'object' && typeof t.json === 'function' ? t : null; } catch (e) { return null; }
  }
  // → { promise, cancel }; the promise resolves with the table (or null,
  // setExternalData(null, …)), rejects after timeoutMs (0: never)
  function waitForNamedData(name, timeoutMs) {
    let resolveFn, timer = null;
    const set = _namedDataWaiters.get(name) || new Set();
    _namedDataWaiters.set(name, set);
    const promise = new Promise((resolve, reject) => {
      resolveFn = t => { clearTimeout(timer); set.delete(resolveFn); resolve(t); };
      set.add(resolveFn);
      if (timeoutMs) {
        timer = setTimeout(() => {
          set.delete(resolveFn);
          reject(new Error(`[ixmaps-gl] no data "${name}" handed over (ixmaps.setExternalData(data, {name: "${name}"})) within ${timeoutMs / 1000}s`));
        }, timeoutMs);
      }
    });
    return { promise, cancel: () => { clearTimeout(timer); set.delete(resolveFn); } };
  }
  function publishNamedData(name, table) {
    if (table && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !(name in _engineGlobalsGuard)) {
      try { global[name] = table; } catch (e) { /* read-only global: waiters still get it */ }
    }
    const waiters = _namedDataWaiters.get(name);
    if (waiters) [...waiters].forEach(resolve => resolve(table));
    const listeners = _namedDataListeners.get(name);
    // after the handing-over code finished (a broker's own theme first)
    if (listeners && listeners.size && table) setTimeout(() => [...listeners].forEach(fn => fn(table)), 0);
  }
  // globals a data name must not overwrite
  const _engineGlobalsGuard = { ixmaps: 1, Data: 1, deck: 1, maplibregl: 1, window: 1, document: 1, $: 1, jQuery: 1 };
  function setExternalDataBridge(dataObj, opt) {
    const name = opt && opt.name;
    if (name != null && name !== '') {
      (dataObj == null ? Promise.resolve(null) : externalDataToTable(dataObj, opt))
        .then(table => publishNamedData(String(name), table))
        .catch(err => { console.error(err); publishNamedData(String(name), null); });
      return;
    }
    if (!_pendingQueryResolve) {
      console.warn('[ixmaps-gl] ixmaps.setExternalData called with no pending .data({query}) fetch — ignored');
      return;
    }
    const resolve = _pendingQueryResolve;
    _pendingQueryResolve = null;
    resolve(dataObj);
  }

  // ---------------------------------------------------------------
  // data loading — dispatches on .data({url, type}); fetch() transparently
  // decompresses gzip via Content-Encoding, same as the original sources
  // (including CSV's real "x-gzip" Content-Encoding — browsers treat
  // x-gzip as an alias for gzip, so no special handling needed here).
  //
  // .data({query}) runs the real page's own literal query() function
  // body verbatim (a stringified function, matching the real config's
  // own .data({query: queryData.toString()}) convention) against the
  // REAL data.js library (window.Data — must be loaded via <script
  // src=".../data.js"> before ixmaps-gl.js, same as a real page) —
  // Data.provider()/.addSource()/.realize()/.subtable()/.append()/
  // .column().map() all run as their real implementations, not a
  // reimplementation. Only the FINAL hand-off (ixmaps.setExternalData)
  // is bridged — see setExternalDataBridge above. This is the preferred
  // path for porting a real config: no deviation needed for the data
  // loading itself, only for the position-field decimal-comma parsing
  // Data.Table.json() rows still need (see csvRowsToFeatureCollection —
  // data.js doesn't auto-convert locale numbers either, confirmed by
  // reading its source, so this step is required regardless of loader).
  //
  // .data({urls: [...], type: 'csv', remap}) remains this engine's OWN
  // idiom for pages that don't have (or don't need) a real query()
  // function to port — a lighter-weight path that doesn't need data.js
  // loaded at all.
  // ---------------------------------------------------------------

  // .data({process}) — real ixmaps-flat's data processing hook
  // (htmlgui.js:1749-1760 registers it as ixmaps.<name>.process, called
  // after loading as `data = process(data, options) || data`,
  // htmlgui.js:3646/3774): a page-written function (or its toString())
  // that receives the loaded data as a data.js Table and may change it —
  // add computed columns (addColumn), filter, … . Run against the REAL
  // data.js (window.Data, loaded by the page like for .data({query})),
  // with the CSV parsed by data.js too (Data.import, flat's own parser),
  // so the function sees exactly the Table flat gives it. Only a page's
  // own .data() runs one; loadProject strips it from project files.
  function requireDataJs(what) {
    if (!global.Data) {
      throw new Error(`[ixmaps-gl] .data({${what}}) needs data.js, which could not be loaded (see the warning above, or .options({datajs}))`);
    }
  }
  // a data.js Table → row objects, straight from its field list and record
  // arrays (table.json() builds the same rows ~1.5x slower, measured on
  // 1.2M rows)
  function dataTableRows(table) {
    if (!table || !Array.isArray(table.records) || !Array.isArray(table.fields)) {
      return table && typeof table.json === 'function' ? table.json() : [];
    }
    const names = table.fields.map(f => f.id);
    const rows = new Array(table.records.length);
    for (let i = 0; i < table.records.length; i++) {
      const rec = table.records[i], o = {};
      for (let c = 0; c < names.length; c++) o[names[c]] = rec[c];
      rows[i] = o;
    }
    return rows;
  }
  // parse CSV text with data.js (as flat) → a Table
  function dataJsCsvTable(text) {
    return new Promise((resolve, reject) => {
      global.Data.object({ source: text, type: 'csv', error: e => reject(new Error(`[ixmaps-gl] data.js CSV import failed: ${e}`)) })
        .import(table => resolve(table));
    });
  }
  // load a URL of any data.js format through its Broker, as flat's
  // htmlgui_loadExternalData does → a Table. data.js can give up without
  // calling either callback (e.g. "feed not kml") — a timeout turns that
  // into an error instead of a map that never finishes loading.
  const DATAJS_LOAD_TIMEOUT_MS = 180000;
  function dataJsLoadTable(url, type) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`[ixmaps-gl] data.js did not deliver ${url} (${type}) within ${DATAJS_LOAD_TIMEOUT_MS / 1000}s — see its console messages`)), DATAJS_LOAD_TIMEOUT_MS);
      new global.Data.Broker({})
        .addSource(url, type)
        .error(e => { clearTimeout(timer); reject(new Error(`[ixmaps-gl] data.js failed to load ${url} (${type}): ${e}`)); })
        .realize(dataA => {
          clearTimeout(timer);
          if (dataA && dataA[0]) resolve(dataA[0]);
          else reject(new Error(`[ixmaps-gl] data.js returned no data for ${url}`));
        });
    });
  }
  function runDataProcess(table, dataConfig) {
    const fn = typeof dataConfig.process === 'function' ? dataConfig.process : new Function(`return (${dataConfig.process});`)();
    if (typeof fn !== 'function') throw new Error('[ixmaps-gl] .data({process}) is not a function');
    return fn(table, dataConfig) || table;
  }

  // Project processing scripts (data.ext on a loaded file) — flat's
  // contract (htmlgui.js htmlgui_loadExternalData): the file is parsed by
  // data.js, the script is loaded as text and run, and the Table goes
  // through ixmaps.<data.name>.after(table, options) or, without one,
  // .process(table, options); a returned value replaces the table.
  // Code a PROJECT names is run only when the page opts in with
  // .options({trustedscripts: [url prefixes]}) and the script's resolved
  // URL is under one of them — off by default, no built-in prefixes, and a
  // project file can't set it (applyProjectMap drops the key). Scripts
  // that load the data themselves (data.type "ext"): see loadBrokerData.
  const _warnedUntrustedScripts = new Set();
  const _scriptTextCache = new Map();
  // flat: a bare name ("process_data") is story-root relative, ".js" added;
  // gl resolves every script against the page
  function resolveScriptUrl(ext) {
    let s = String(ext).trim();
    if (!s.includes('/') && !/\.js(\?|$)/.test(s)) s += '.js';
    return new URL(s, (global.document && global.document.baseURI) || undefined).href;
  }
  // prefix match on whole path segments: "…/gjrichter" doesn't admit
  // "…/gjrichter-other/"; the URL parser has already resolved "..", %2e
  function isTrustedScriptUrl(url, trusted) {
    if (!Array.isArray(trusted)) return false;
    return trusted.some(p => {
      if (typeof p !== 'string' || !p.trim()) return false;
      let prefix;
      try { prefix = new URL(p.trim(), (global.document && global.document.baseURI) || undefined).href; } catch (e) { return false; }
      if (!url.startsWith(prefix)) return false;
      return prefix.endsWith('/') || url.length === prefix.length || '/?#'.includes(url[prefix.length]);
    });
  }
  // the processor for a data.ext processing script (on csv or any
  // data.js-loaded table), or null when there is none or it isn't trusted
  // (warned once per script)
  async function loadProcessingScript(dataConfig, trusted) {
    if (!dataConfig.ext || dataConfig.type === 'ext' || typeof dataConfig.ext !== 'string' || /function/.test(dataConfig.ext)) return null;
    const url = resolveScriptUrl(dataConfig.ext);
    if (!isTrustedScriptUrl(url, trusted)) {
      if (!_warnedUntrustedScripts.has(url)) {
        _warnedUntrustedScripts.add(url);
        console.warn(`[ixmaps-gl] data.ext script ${url} not run — not under .options({trustedscripts: [...]}); the data is used unprocessed`);
      }
      return null;
    }
    if (!dataConfig.name) throw new Error(`[ixmaps-gl] data.ext script ${url} needs data.name (it defines ixmaps.<name>.process)`);
    if (!_scriptTextCache.has(url)) {
      _scriptTextCache.set(url, fetch(url).then(r => {
        if (!r.ok) throw new Error(`[ixmaps-gl] failed to fetch data.ext script ${url}: ${r.status}`);
        return r.text();
      }));
    }
    const text = await _scriptTextCache.get(url);
    const name = dataConfig.name;
    // run the script right before its own call, never ahead: several
    // scripts define the same ixmaps.<name>.process (flat evals each time)
    return table => {
      new Function(text + '\n//# sourceURL=' + url)();
      const ns = global.ixmaps && global.ixmaps[name];
      const fn = ns && (typeof ns.after === 'function' ? ns.after : typeof ns.process === 'function' ? ns.process : null);
      if (!fn) throw new Error(`[ixmaps-gl] data.ext script ${url} defines neither ixmaps.${name}.after nor ixmaps.${name}.process`);
      return fn.call(ns, table, { name, type: dataConfig.type, url: dataConfig.url, ext: dataConfig.ext }) || table;
    };
  }

  // Broker scripts (data.type "ext") — flat's contract (htmlgui.js
  // htmlgui_loadExternalData): the script (data.ext, trusted like a
  // processing script) defines ixmaps.<data.name>(theme, options), which
  // loads the data itself and hands it over with
  // ixmaps.setExternalData(data, {type, name}); a type other than
  // "dbtable"/"jsondb" is parsed by data.js. Without data.ext the PAGE
  // defines ixmaps.<name> (page code — no trust needed). Brokers also set
  // theme properties from the data (the latest date column as value field,
  // "aggiornato al …" as snippet, …): `theme` is a stand-in for flat's
  // MapTheme that records every write — applyBrokerThemePatch turns them
  // into the definition keys flat's parseStyle reads them from.
  const BROKER_TIMEOUT_MS = 120000;
  const BROKER_THEME_FIELDS = ['szFields', 'szFieldsA', 'szField100', 'szSizeField', 'szValueField', 'szItemField',
    'szSelectionField', 'szFilter', 'szTitle', 'szSnippet', 'szDescription', 'szLabelA', 'szXaxisA',
    'colorScheme', 'origColorScheme', 'nClipFrames', 'nGridX'];
  function makeBrokerTheme(spec) {
    const b = spec.binding || {}, st = spec.style || {}, m = spec.meta || {};
    const arr = v => (v == null ? undefined : Array.isArray(v) ? v.slice() : String(v).split('|'));
    const values = {
      // flat's szId / szName: the theme's id (its style.name / meta.name —
      // a bbox provider refreshes the theme by it), else the layer
      szId: (st && st.name) || (m && m.name) || spec.name, szName: (st && st.name) || (m && m.name) || spec.name, szFields: b.value, szFieldsA: arr(b.value), szField100: b.field100,
      szSizeField: b.size, szValueField: st.valuefield, szItemField: b.id, szSelectionField: b.id,
      szFilter: spec.filter, szTitle: m.title, szSnippet: m.snippet, szDescription: m.description,
      szLabelA: arr(st.label), szXaxisA: arr(st.xaxis), colorScheme: st.colorscheme, origColorScheme: st.colorscheme,
      nClipFrames: st.clipframes, nGridX: st.gridx,
    };
    const writes = {}, styleWrites = {};
    const style = new Proxy(Object.assign({}, st), {
      set(t, k, v) { t[k] = v; styleWrites[k] = v; return true; },
    });
    // flat: style.setProperties(obj) → parseStyle; setProperties({field(s),
    // field100, ...}) sets the fields, then the rest as style
    Object.defineProperty(style, 'setProperties', { value: obj => { Object.assign(styleWrites, obj); } });
    const theme = new Proxy(values, {
      get(t, k) {
        if (k === 'style') return style;
        if (k === 'setProperties') {
          return obj => {
            const o = Object.assign({}, obj);
            if (o.field != null || o.fields != null) writes.szFields = o.field != null ? o.field : o.fields;
            if (o.field100 != null) writes.szField100 = o.field100;
            delete o.field; delete o.fields; delete o.field100;
            Object.assign(styleWrites, o);
          };
        }
        return t[k];
      },
      set(t, k, v) { t[k] = v; if (BROKER_THEME_FIELDS.includes(k)) writes[k] = v; return true; },
    });
    return { theme, patch: () => ({ writes: Object.assign({}, writes), style: Object.assign({}, styleWrites) }) };
  }
  // a theme definition (flat's shape) with a broker's theme writes applied —
  // written where they win in normalizeTheme (binding aliases over style
  // keys over .field()), after dropping other aliases of the same target
  function applyBrokerThemePatch(def, patch) {
    const w = (patch && patch.writes) || {}, sw = (patch && patch.style) || {};
    const out = Object.assign({}, def, { binding: Object.assign({}, def.binding), style: Object.assign({}, def.style), meta: Object.assign({}, def.meta) });
    const list = v => (Array.isArray(v) ? v.join('|') : v);
    const setTarget = (target, alias, v) => {
      for (const [k, t] of Object.entries(FLAT_BINDING_ALIASES)) {
        if (t !== target) continue;
        delete out.binding[k];
        delete out.style[k];
      }
      if (target === 'theme.field') delete out.field;
      if (target === 'theme.field100') delete out.field100;
      out.binding[alias] = v;
    };
    if (w.szFieldsA !== undefined || w.szFields !== undefined) setTarget('theme.field', 'value', list(w.szFieldsA !== undefined ? w.szFieldsA : w.szFields));
    if (w.szField100 !== undefined) setTarget('theme.field100', 'value100', list(w.szField100));
    if (w.szSizeField !== undefined) setTarget('style.sizefield', 'size', w.szSizeField);
    if (w.szValueField !== undefined) setTarget('style.valuefield', 'valuefield', w.szValueField);
    if (w.szItemField !== undefined) setTarget('style.itemfield', 'itemfield', w.szItemField);
    if (w.szFilter !== undefined) out.style.filter = w.szFilter;
    if (w.szLabelA !== undefined) out.style.label = w.szLabelA;
    if (w.szXaxisA !== undefined) out.style.xaxis = w.szXaxisA;
    if (w.nClipFrames !== undefined) out.style.clipframes = w.nClipFrames;
    if (w.nGridX !== undefined) out.style.gridx = w.nGridX;
    const cs = w.origColorScheme !== undefined ? w.origColorScheme : w.colorScheme;
    if (cs !== undefined) out.style.colorscheme = cs;
    // style keys given via style / style.setProperties: flat reads the meta
    // vocabulary (title, snippet, description) from style too
    for (const [k, v] of Object.entries(sw)) {
      if (k === 'title' || k === 'snippet' || k === 'description') out.meta[k] = v;
      else out.style[k] = v;
    }
    if (w.szTitle !== undefined) out.meta.title = w.szTitle;
    if (w.szSnippet !== undefined) out.meta.snippet = w.szSnippet;
    if (w.szDescription !== undefined) out.meta.description = w.szDescription;
    return out;
  }
  function externalDataToTable(data, opt) {
    const type = String((opt && opt.type) || 'dbtable');
    if (data && typeof data.json === 'function') return Promise.resolve(data); // a data.js Table
    if (/^jsondb$/i.test(type)) return Promise.resolve(new global.Data.Table(data));
    return new Promise((resolve, reject) => {
      global.Data.object({ source: data, type, error: e => reject(new Error(`[ixmaps-gl] setExternalData: data.js import failed: ${e}`)) })
        .import(table => resolve(table));
    });
  }
  // → { rows, table, patch } for a broker theme (spec: its normalizeTheme
  // result). data.query is flat's broker too: flat registers it as
  // ixmaps.<name> (htmlgui.js 1771-1777) and calls it like any broker.
  async function loadBrokerData(spec, engineOptions) {
    const dataConfig = spec.data;
    const name = dataConfig.name;
    if (!name) throw new Error('[ixmaps-gl] a broker theme (data.type "ext") needs data.name — the function ixmaps.<name>(theme, options)');
    requireDataJs('ext');
    // gl's API names are never a data provider (a project could otherwise
    // call — or replace — them by name)
    const isEngineName = _engineIxmapsApi.has(String(name)) || String(name) === 'setExternalData';
    if (dataConfig.query) {
      if (isEngineName) throw new Error(`[ixmaps-gl] broker name "${name}" is an ixmaps-gl API function, not a page-defined data provider`);
      const q = dataConfig.query;
      pageIxmaps()[name] = typeof q === 'function' ? q : new Function(`return (${q});`)();
    }
    // flat's .data({url, type: "ext"}) keeps the url as data.ext
    // (htmlgui_flat.js 1803-1804)
    const ext = dataConfig.ext || dataConfig.url;
    let text = null, url = null;
    // flat calls a function the page already defined (ixmaps.<name>) and
    // loads data.ext as its script only when there is none (htmlgui.js
    // 3459-3497) — so a page provider gets data.ext as its data url
    const pageFn = pageIxmaps() && typeof pageIxmaps()[name] === 'function' && !isEngineName;
    if (ext && !pageFn && !dataConfig.query) {
      url = resolveScriptUrl(ext);
      if (!isTrustedScriptUrl(url, engineOptions && engineOptions.trustedscripts)) {
        throw new Error(`[ixmaps-gl] broker script ${url} not run — not under .options({trustedscripts: [...]})`);
      }
      if (!_scriptTextCache.has(url)) {
        _scriptTextCache.set(url, fetch(url).then(r => {
          if (!r.ok) throw new Error(`[ixmaps-gl] failed to fetch broker script ${url}: ${r.status}`);
          return r.text();
        }));
      }
      text = await _scriptTextCache.get(url);
    }
    // without a script, ixmaps.<name> must be a function the page defined —
    // never gl's own API, which a project could otherwise call by name
    if (text == null && isEngineName) {
      throw new Error(`[ixmaps-gl] broker name "${name}" is an ixmaps-gl API function, not a page-defined data provider`);
    }
    const { theme, patch } = makeBrokerTheme(spec);
    const key = String(name);
    const wait = waitForNamedData(key, BROKER_TIMEOUT_MS);
    try {
      // run the script right before its own call (see loadProcessingScript)
      if (text != null) new Function(text + '\n//# sourceURL=' + url)();
      const fn = pageIxmaps() && pageIxmaps()[name];
      if (typeof fn !== 'function') throw new Error(`[ixmaps-gl] broker ${url || 'page'}: ixmaps.${name} is not a function`);
      // flat passes the theme's data options (name, type, ext, …) and the theme
      fn.call(global.ixmaps, theme, Object.assign({}, dataConfig, { name, type: 'ext', ext, theme, setData: global.ixmaps.setExternalData }));
    } catch (e) {
      // the call failed: stop waiting (no late timeout rejection)
      wait.cancel();
      throw e;
    }
    const table = await wait.promise;
    return { rows: table ? table.json() : [], table, patch: patch() };
  }

  // themes naming one broker share one call while it runs (flat: the
  // first theme loads the named data, the others find it — maptheme.js
  // 8286); force (a refresh) calls the broker again — a broker may have
  // returned without data (waiting for other data), and an earlier call
  // still waiting gets the new data too
  const _brokerInflight = new Map();
  function loadBrokerOnce(spec, engineOptions, force) {
    const key = String(spec.data.name);
    if (force || !_brokerInflight.has(key)) {
      const p = loadBrokerData(spec, engineOptions).finally(() => { if (_brokerInflight.get(key) === p) _brokerInflight.delete(key); });
      _brokerInflight.set(key, p);
    }
    return _brokerInflight.get(key);
  }

  // a theme whose data comes by name: a broker (data.type "ext" or
  // data.query, with data.name) or a theme that only names another
  // theme's data (.data({name})) — loaded on its own, see loadNamedTheme
  function namedDataTheme(spec) {
    const d = spec.data;
    if (!d || !d.name) return false;
    if (d.type === 'ext' || d.query) return true;
    return !d.url && !d.urls && !d.obj;
  }
  function brokerTheme(spec) {
    const d = spec.data;
    return !!(d && (d.type === 'ext' || d.query));
  }

  async function fetchLayerData(dataConfig, binding, engineOptions) {
    if (!dataConfig || (!dataConfig.url && !dataConfig.urls && !dataConfig.query && !dataConfig.obj)) {
      throw new Error('[ixmaps-gl] layer .data() needs a url, urls, query, or obj');
    }
    // processing scripts run on csv files only (loadProcessingScript) — say
    // so instead of silently using the data unprocessed
    if (dataConfig.ext && /^(geojson|topojson)$/.test(dataConfig.type) && !_warnedUntrustedScripts.has('type:' + dataConfig.ext)) {
      _warnedUntrustedScripts.add('type:' + dataConfig.ext);
      console.warn(`[ixmaps-gl] data.ext script ${dataConfig.ext} not run — processing scripts work on tables (csv and the data.js formats), not on ${dataConfig.type} features`);
    }

    // .data({obj: table, type: 'jsondb'}) — an already-in-memory data.js
    // Table (or plain row array) handed straight to the layer, matching
    // the real engine's own jsondb data source. No network fetch at all;
    // exists for callers (e.g. a wizard/loader UI) that already parsed
    // the data themselves and would otherwise have to re-fetch/re-parse
    // it a second time just to satisfy this function's url-based paths.
    //
    // GL-PORT COMPAT: .data({obj: ...}) must respect `type` exactly like
    // the URL-based path below does (topojson/geojson vs csv-like rows) —
    // real ixmaps-flat pages routinely inline an already-built GeoJSON
    // FeatureCollection this way (dense-polygon ocean backdrops,
    // graticules, an Orthographic {type:"Sphere"} globe background — see
    // the create-ixmap skill's own Equal-Earth/Orthographic examples,
    // always paired with .binding({geo:"geometry"})). Such an object
    // already carries embedded geometry, not a "YFIELD|XFIELD" position
    // pair to extract, so it must never reach rowsResult/
    // csvRowsToFeatureCollection. Confirmed live: a real page's ocean
    // layer (.data({obj: worldBBoxGeoJSON, type:"geojson"})) hit this
    // branch unconditionally regardless of `type`, and its single-field
    // binding.geo:"geometry" (correct for GeoJSON, no "|") then failed
    // csvRowsToFeatureCollection's Y|X split — the exact same error a
    // genuinely CSV-shaped .obj with a missing binding.position would
    // throw, even though this .obj was never row data in the first place.
    if (dataConfig.obj) {
      if (dataConfig.type === 'topojson') return topojsonToFeatureCollection(dataConfig.obj);
      if (dataConfig.type === 'geojson') return sanitizeGeoJSON(dataConfig.obj);
      let obj = dataConfig.obj;
      if (dataConfig.process) {
        requireDataJs('process');
        if (typeof obj.json !== 'function') {
          // a jsonDB object ({table, fields, records}) or plain row objects
          if (Array.isArray(obj)) {
            const headers = Object.keys(obj[0] || {});
            obj = new global.Data.Table().setArray([headers, ...obj.map(r => headers.map(h => r[h]))]);
          } else {
            obj = new global.Data.Table(obj);
          }
        }
        obj = runDataProcess(obj, dataConfig);
      }
      const rows = typeof obj.json === 'function' ? obj.json() : obj;
      return rowsResult(rows, binding);
    }

    if (dataConfig.query) {
      if (!global.Data) {
        throw new Error('[ixmaps-gl] .data({query}) needs the real data.js loaded first — ' +
          '<script src="https://cdn.jsdelivr.net/gh/gjrichter/data.js@master/data.js"> before ixmaps-gl.js');
      }
      const queryFn = typeof dataConfig.query === 'function' ? dataConfig.query : new Function(`return (${dataConfig.query});`)();
      const dataObj = await new Promise(resolve => {
        _pendingQueryResolve = resolve;
        queryFn({}, {});
      });
      return rowsResult((dataConfig.process ? runDataProcess(dataObj, dataConfig) : dataObj).json(), binding);
    }

    if (dataConfig.type === 'csv') {
      const urls = dataConfig.urls || [dataConfig.url];
      const texts = await Promise.all(urls.map(async url => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`[ixmaps-gl] failed to fetch ${url}: ${resp.status}`);
        return resp.text();
      }));
      let rows;
      // a trusted project processing script wins over data.process, as the
      // script's ixmaps.<name>.process replaces the registered one in flat
      const scriptProcess = await loadProcessingScript(dataConfig, engineOptions && engineOptions.trustedscripts);
      if (global.Data) {
        // data.js parses (as flat does); several urls append their records.
        // Data.object(...).import(cb): data.js may first load its CSV
        // parser (PapaParse), so the Table arrives via the callback
        const tables = await Promise.all(texts.map(dataJsCsvTable));
        let table = tables[0];
        for (const t of tables.slice(1)) table.records = table.records.concat(t.records);
        if (table.table) table.table.records = table.records.length;
        if (scriptProcess) table = scriptProcess(table);
        else if (dataConfig.process) table = runDataProcess(table, dataConfig);
        rows = dataTableRows(table);
      } else {
        // no data.js (.options({datajs: false}) or it failed to load)
        if (dataConfig.process || scriptProcess) requireDataJs(scriptProcess ? 'ext' : 'process');
        rows = [].concat(...texts.map(parseCsvText));
      }
      if (dataConfig.remap) {
        Object.entries(dataConfig.remap).forEach(([field, map]) => {
          rows.forEach(row => { if (row[field] in map) row[field] = map[row[field]]; });
        });
      }
      return rowsResult(rows, binding);
    }

    if (dataConfig.type === 'topojson' || dataConfig.type === 'geojson') {
      // read by this engine itself: features directly (data.js would turn
      // them into a table with a geometry column, and back)
      const resp = await fetch(dataConfig.url);
      if (!resp.ok) throw new Error(`[ixmaps-gl] failed to fetch ${dataConfig.url}: ${resp.status}`);
      if (dataConfig.type === 'topojson') return topojsonToFeatureCollection(await resp.json());
      return sanitizeGeoJSON(await resp.json());
    }
    // every other format (json, jsonstat, ndjson, rss, kml, gml, geobuf,
    // flatgeobuf, geopackage, parquet, ...) through data.js, as flat
    requireDataJs(`type: "${dataConfig.type}"`);
    let table = await dataJsLoadTable(dataConfig.url, dataConfig.type);
    const scriptProcess = await loadProcessingScript(dataConfig, engineOptions && engineOptions.trustedscripts);
    if (scriptProcess) table = scriptProcess(table);
    else if (dataConfig.process) table = runDataProcess(table, dataConfig);
    return rowsResult(dataTableRows(table), binding);
  }

  // ---------------------------------------------------------------
  // .filter(...) — flat's filter grammar (maptheme.js filterValues,
  // 9339-9505): "WHERE field op value [AND field op value ...]" (AND only,
  // as flat; a quoted value may hold spaces, BETWEEN a AND b is one
  // clause, field "*" tests all cells, a value "$field$" another column):
  //   = != <>      text equal, or equal as numbers (flat's __scanValue)
  //   > < >= <=    as numbers;  BETWEEN a AND b  a ≤ v ≤ b
  //   LIKE         SQL %/_ wildcards, else a regex; LIKE "*": not empty
  //   NOT          does not match the regex;  IN (a,b,…)  one of the list
  //   anything else (e.g. "==")  matches the value as a regex
  // regexes case-insensitive. Without WHERE: a regex over the whole row.
  // ---------------------------------------------------------------
  function flatScanValue(v) {
    const str = String(v);
    return str.includes(',') ? parseFloat(str.replace(/\./g, '').replace(/,/g, '.')) : parseFloat(str.replace(/ /g, ''));
  }
  function flatRegexTest(value, pattern) {
    try { return new RegExp(String(pattern).replace(/\//g, '\\/'), 'i').test(String(value)); } catch (e) { return false; }
  }
  function flatLikeTest(value, pattern) {
    let out = '';
    const p = String(pattern);
    for (let i = 0; i < p.length; i++) {
      const c = p.charAt(i);
      if (c === '\\' && i + 1 < p.length) { out += '\\' + p.charAt(++i); continue; }
      out += c === '%' ? '.*' : c === '_' ? '.' : c;
    }
    return flatRegexTest(value, out);
  }
  function flatInTest(value, list) {
    const e = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return new RegExp('\\(' + e + '\\,|\\(' + e + '\\)|\\,' + e + '\\,|\\,' + e + '\\)', 'i').test(String(list)); } catch (err) { return false; }
  }
  const _filterCache = new Map();
  function flatFilterPredicate(expr) {
    if (_filterCache.has(expr)) return _filterCache.get(expr);
    let pred;
    if (!/WHERE/.test(expr)) {
      pred = row => flatRegexTest(Object.values(row).join(' '), expr);
    } else {
      const tokens = expr.split('WHERE ')[1].split(' ');
      for (let i = 0; i < tokens.length; i++) {
        if (!tokens[i].length) { tokens.splice(i, 1); i--; continue; }
        const close = tokens[i][0] === '"' ? '"' : tokens[i][0] === '(' ? ')' : null;
        if (close) while (tokens[i][tokens[i].length - 1] !== close && i + 1 < tokens.length) { tokens[i] += ' ' + tokens[i + 1]; tokens.splice(i + 1, 1); }
      }
      const clauses = [];
      const unquote = t => t.replace(/("|)/g, '');
      while (tokens.length >= 3) {
        const c = { field: unquote(tokens[0]), op: tokens[1].toUpperCase(), value: unquote(tokens[2]) };
        let n = 3;
        if (c.op === 'BETWEEN' && tokens.length >= 5 && tokens[3] === 'AND') { c.value2 = unquote(tokens[4]); n = 5; }
        const col = /^\$(.+)\$$/.exec(c.value);
        if (col) c.valueField = col[1];
        clauses.push(c);
        tokens.splice(0, n);
        if (tokens.length && tokens[0] === 'AND') tokens.splice(0, 1); else break;
      }
      if (!clauses.length) {
        console.warn('[ixmaps-gl] incomplete filter query, left unfiltered:', expr);
        pred = () => true;
      } else {
        pred = row => clauses.every(c => {
          const v = c.field === '*' ? Object.values(row).join('|') : String(row[c.field]);
          const fv = c.valueField ? String(row[c.valueField]) : c.value;
          const n = flatScanValue(v);
          switch (c.op) {
            case '=': return v == fv || n == Number(fv);
            case '!=': case '<>': return !(v == fv || n == Number(fv));
            case '>': return n > Number(fv);
            case '<': return n < Number(fv);
            case '>=': return n >= Number(fv);
            case '<=': return n <= Number(fv);
            case 'LIKE': return fv === '*' ? v.length > 0 : flatLikeTest(v, fv);
            case 'NOT': return !flatRegexTest(v, fv);
            case 'IN': return flatInTest(v, fv);
            case 'BETWEEN': return n >= Number(fv) && n <= Number(c.value2);
            default: return flatRegexTest(v, fv);
          }
        });
      }
    }
    _filterCache.set(expr, pred);
    return pred;
  }
  function applyWhereFilter(fc, filterExpr) {
    if (!filterExpr) return fc;
    const pred = flatFilterPredicate(String(filterExpr));
    if (fc.type === 'Table') return { type: 'Table', rows: fc.rows.filter(pred) };
    return { type: 'FeatureCollection', features: fc.features.filter(f => pred(f.properties || {})) };
  }

  // ---------------------------------------------------------------
  // CHOROPLETH geometry join — a CHOROPLETH layer's own .data() is a
  // lookup TABLE (see rowsResult above), not geometry. Its geometry is
  // borrowed from a FEATURE base layer sharing the same .layer() NAME
  // (the real engine's own convention — see italy-comuni-demographics-
  // ixmaps.html's "same layer name as FEATURE base -> joins its
  // geometry" comment), joined per-polygon via binding.lookup (the
  // table's join-key field) against the FEATURE base's binding.id (the
  // geometry's own join-key field — usually a differently-named field,
  // e.g. comune_code vs. com_istat_code_num).
  //
  // Requires the FEATURE base to be .layer()'d BEFORE the CHOROPLETH
  // layer using it — MapBuilder.build()'s runtime loop is sequential in
  // .layer() call order, so `runtimes` already holds the base by the
  // time this runs, same precondition the real engine's own
  // same-name-join convention has.
  // a table joined to geometry: a CHOROPLETH colors its FEATURE layer's
  // polygons (joinChoroplethFeatures), any other theme is placed at them
  // (joinChartPositions)
  function joinTableFeatures(spec, table, runtimes) {
    return spec.flags && spec.flags.has('CHOROPLETH') ? joinChoroplethFeatures(spec, table, runtimes) : joinChartPositions(spec, table, runtimes);
  }

  // flat's lookup key (maptheme.js 10365-10376): upper case (lookuptoupper),
  // zero-padded to lookupdigits, as a number (lookuptonumber / tonumber)
  function flatLookupKey(v, style) {
    let id = String(v);
    if (style && /^(1|true)$/i.test(String(style.lookuptoupper))) id = id.toUpperCase();
    const digits = parseInt(style && style.lookupdigits, 10);
    if (digits > 0) id = ('000000000000000' + id).slice(-digits);
    if (style && /^(1|true)$/i.test(String(style.lookuptonumber))) id = String(Number(id));
    return id;
  }
  // shape area (lng/lat units) for comparing an id's polygons; a point has
  // none (NaN), as flat's point shapes carry no area attribute
  function geometryArea(g) {
    const ring = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
    if (!g) return 0;
    if (g.type === 'Polygon') return g.coordinates.length ? ring(g.coordinates[0]) : 0;
    if (g.type === 'MultiPolygon') return g.coordinates.reduce((a, p) => a + (p.length ? ring(p[0]) : 0), 0);
    return NaN;
  }
  // flat's shape center (maptheme.js 17996, 18075-18081): the mean of the
  // vertices in map (Mercator) coordinates — of the part with the most
  // vertices for a MultiPolygon
  function flatShapeCenter(g) {
    if (!g) return null;
    if (g.type === 'Point') return g.coordinates;
    const merc = lat => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360));
    const parts = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
    if (!parts) return geometryBBoxCenter(g);
    let best = null;
    for (const part of parts) {
      let x = 0, y = 0, n = 0;
      for (const ringCoords of part) for (const c of ringCoords) { x += c[0]; y += merc(c[1]); n++; }
      if (n && (!best || n > best.n)) best = { n, x: x / n, y: y / n };
    }
    return best ? [best.x, (2 * Math.atan(Math.exp(best.y)) - Math.PI / 2) * 180 / Math.PI] : null;
  }
  // flat's getNodePosition (maptheme.js 24728-24742): the first shape of an
  // id stays unless a later one has a larger (numeric) area — a first shape
  // without area (a point) is never replaced
  function flatShapeWins(cur, area) {
    return !cur || (area > cur.area);
  }
  function geometryBBoxCenter(g) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (function walk(c) {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === 'number') { if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0]; if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1]; return; }
      c.forEach(walk);
    })(g && g.coordinates);
    return minX <= maxX ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
  }
  // id → position of one FEATURE runtime's shapes (flat's getNodePosition,
  // maptheme.js 24702-24784): its shape (flatShapeWins) at flat's shape
  // center (flatShapeCenter)
  function featurePositionIndex(rt) {
    if (rt._positionIndex && rt._positionIndexOf === rt.features) return rt._positionIndex;
    const idField = rt.binding && rt.binding.id;
    const best = new Map();
    if (idField) {
      for (const f of rt.features) {
        const id = f.properties && f.properties[idField];
        if (id == null) continue;
        const key = String(id), area = geometryArea(f.geometry);
        if (!flatShapeWins(best.get(key), area)) continue;
        const pos = flatShapeCenter(f.geometry);
        if (pos) best.set(key, { area, pos });
      }
    }
    rt._positionIndex = best;
    rt._positionIndexOf = rt.features;
    return best;
  }
  // a chart theme positioned by a key into FEATURE layers — flat looks the
  // key up in every layer of the theme ("a|b") and places a record once on
  // each layer where its shape is found (maptheme.js 9324, 10376); records
  // with no shape are left out (10387-10392)
  //
  // flat runs the after-aggregation steps after EACH layer's pass, over all
  // items; DIFFERENCE turns a record's value fields into their difference
  // and drops the last, so a second pass leaves the earlier layers' items
  // without values (measured: the "…_11::x,y" items of a DIFFERENCE theme
  // on "…_11|…_21" end with nValuesA []) — only the last layer's charts are
  // drawn. Such a theme is placed on its last layer only.
  function joinChartPositions(spec, table, runtimes) {
    const lookupField = spec.binding.lookup;
    let layers = String(spec.name).split('|');
    if (layers.length > 1 && spec.flags && spec.flags.has('DIFFERENCE')) layers = layers.slice(-1);
    const features = [];
    for (const layer of layers) {
      const index = new Map();
      runtimes.filter(r => r.name === layer && (r.flags.has('FEATURE') || r.flags.has('FEATURES'))).forEach(r => {
        // in theme order, as flat's layer holds the themes' shapes
        for (const [k, v] of featurePositionIndex(r)) { if (flatShapeWins(index.get(k), v.area)) index.set(k, v); }
      });
      if (!index.size) continue;
      for (const row of table.rows) {
        const v = row[lookupField];
        if (v == null || v === '') continue;
        const hit = index.get(flatLookupKey(v, spec.style));
        if (hit) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: hit.pos }, properties: row });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  // flat's shape area (getNodeArea, maptheme.js: the shape's "area" / 10^6):
  // the FEATURE theme's size field when it binds one (flat stores nSize as
  // the area, 17999-18080), else the geodesic area — in km²
  function flatShapeAreaKm2(featureRt, f) {
    const sizeField = featureRt.binding && featureRt.binding.size;
    if (sizeField) {
      const v = parseFloat(f.properties && f.properties[sizeField]);
      return isFinite(v) ? v / 1000000 : NaN;
    }
    return geodesicPolygonAreaKm2(f.geometry);
  }
  function featureAreaKm2(f) {
    return f._flatAreaKm2 !== undefined ? f._flatAreaKm2 : geodesicPolygonAreaKm2(f.geometry);
  }
  // .type("CHOROPLETH|CATEGORICAL|AGGREGATE") on ONE value field (e.g.
  // DOMINANT over the categories of "missione"): flat aggregates every
  // record of a polygon into a part per category — the sum of the size
  // field (else the record count, resolveAggregateValue) — and paints the
  // dominant part's class (maptheme.js 13520-13565)
  const AGGREGATED_ROWS = Symbol('ixmaps-gl aggregated rows');
  function isAggregatedCategoricalChoropleth(spec) {
    const flags = spec.flags;
    return !!(flags && flags.has('CHOROPLETH') && flags.has('CATEGORICAL') && flags.has('AGGREGATE')
      && spec.binding && spec.binding.value && !String(spec.binding.value).includes('|'));
  }
  // a polygon's parts (sum per category) and its dominant one: the biggest
  // part above 0, the first of equal ones; null without any
  function aggregatedCategoricalClass(rows, binding, flags, indexByLabel, nCats) {
    const parts = new Array(nCats).fill(0);
    for (const row of rows) {
      const i = indexByLabel.get(String(row[binding.value]));
      if (i == null) continue;
      parts[i] += resolveAggregateValue(binding, flags, row);
    }
    let index = -1;
    parts.forEach((v, i) => { if (v > 0 && (index < 0 || v > parts[index])) index = i; });
    return index < 0 ? null : { parts, index, value: parts[index] };
  }
  // flat's DOMINANT opacity (maptheme.js 13567-13628): from the dominant
  // part v and the biggest part of that class over all polygons, max —
  // DOPACITYMAX dopacityscale · (v / max)^(1/dopacitypow), DOPACITYLOGMAX
  // log v / log max, plain DOPACITY log(dopacityscale · v) / log max;
  // below 0.0001 → 0, at most 0.9
  function dominantDopacityAlpha(style, flags, v, max) {
    const scale = styleNum(style.dopacityscale) || 1;
    const pow = 1 / (styleNum(style.dopacitypow) || 1);
    let o;
    if (flags.has('DOPACITYLOGMAX')) o = Math.log(v) / Math.log(max);
    else if (flags.has('DOPACITYMAX') || flags.has('DOPACITYPOWMAX')) o = scale * Math.pow(v, pow) / Math.pow(max, pow);
    else o = Math.log(scale * v) / Math.log(max);
    if (!(o >= 0.0001)) o = 0;
    return Math.min(0.9, o);
  }

  function joinChoroplethFeatures(spec, table, runtimes) {
    // a page can define several FEATURE layers of one name — e.g. the
    // comuni as polygons and as center points (for chart positions); flat
    // paints every shape of the layer with a matching id, so the polygons
    // are the ones that show: prefer a base with polygon geometry
    const bases = runtimes.filter(r => r.name === spec.name && (r.flags.has('FEATURE') || r.flags.has('FEATURES')));
    const geomRt = bases.find(r => (r.features || []).some(f => f.geometry && /Polygon/.test(f.geometry.type))) || bases[0];
    if (!geomRt) {
      throw new Error(`[ixmaps-gl] CHOROPLETH layer "${spec.name}" needs a FEATURE base layer with the same name, .layer()'d earlier on the map`);
    }
    // A FEATURE base that's donating geometry to a same-named CHOROPLETH
    // exists PURELY as a geometry template (per this join's own
    // precondition) — its own visible fill would just stack a second,
    // redundant translucent layer directly underneath the CHOROPLETH's
    // (which already renders its own "no data" fallback color for any
    // unmatched polygon, below), compounding opacity for no visual
    // purpose. Confirmed as a real, reported bug: e.g. a CHOROPLETH at
    // fillopacity 0.3 over this base's own default 0.4 gray fill
    // compounds to ~0.58 effective coverage — never actually 0.3.
    // Marked here (not decided inside _buildFeaturesLayers) since this is
    // the one place that already knows a CHOROPLETH is consuming this
    // specific FEATURE runtime as a donor, not just sharing its name
    // coincidentally.
    geomRt._isChoroplethGeometryDonor = true;
    const idField = geomRt.binding.id;
    const lookupField = spec.binding.lookup;
    if (!idField || !lookupField) {
      throw new Error(`[ixmaps-gl] CHOROPLETH layer "${spec.name}" needs .binding({lookup}), and its FEATURE base needs .binding({id})`);
    }
    // an AGGREGATE CATEGORICAL choropleth sums ALL the rows of a polygon
    // per category (aggregatedCategoricalClass) — every row is kept, under
    // AGGREGATED_ROWS (not enumerable: the first row stays the polygon's
    // properties for the tooltip and filters)
    if (isAggregatedCategoricalChoropleth(spec)) {
      const groups = new Map();
      for (const row of table.rows) {
        const key = String(row[lookupField]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      return {
        type: 'FeatureCollection',
        features: geomRt.features.map(f => {
          const rows = groups.get(String(f.properties[idField]));
          const properties = rows ? Object.assign({}, rows[0]) : {};
          if (rows) Object.defineProperty(properties, AGGREGATED_ROWS, { value: rows });
          return { type: 'Feature', geometry: f.geometry, properties, _flatAreaKm2: flatShapeAreaKm2(geomRt, f) };
        })
      };
    }
    const rowsByKey = new Map(table.rows.map(row => [String(row[lookupField]), row]));
    // Unmatched polygons (no CSV row for that id) keep their geometry with
    // empty properties — real-world data: not every comune necessarily has
    // a row in every demographic source. Renders as "no data" (see
    // _buildChoroplethLayers's fallback color), not silently dropped from
    // the map.
    const features = geomRt.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: rowsByKey.get(String(f.properties[idField])) || {},
      _flatAreaKm2: flatShapeAreaKm2(geomRt, f)
    }));
    return { type: 'FeatureCollection', features };
  }

  // ---------------------------------------------------------------
  // .style({colorscheme}) resolution — supports a literal color array,
  // ["none"] (no fill), or the original's own convention of passing a
  // STRINGIFIED coloring function (`someFn.toString()`) that receives an
  // { szLabelA, colorScheme } object and fills in colorScheme by index
  // ---------------------------------------------------------------

  const FALLBACK_PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c'];

  // .style({colorscheme: ["N", cc1, cc2, nParam1, nParam2]}) — the real
  // engine's generated N-step color sweep: a colorscheme whose first
  // element is a number is never used as a color list, it is handed to
  // ColorScheme.createColorScheme(cs[1], cs[2], N, cs[3], cs[4])
  // (maptheme.js:12575-12606). flatColorSweep ports its core,
  // colorscheme.js _circ_createColorScheme (verified against real
  // ixmaps-flat with --flat-oracle), branch for branch:
  //  - N < 2 → [cc2]; N < 3 → [cc1, cc2];
  //  - middle color cc3: '#FFFDE0', or 0.55·(cc1+cc2) when either end is
  //    bright (mean channel > 127), or 1.5·(cc1+cc2) for 'auto'; a COLOR
  //    in the nParam1 slot becomes cc3 and the mode 'auto', a color in
  //    the nParam2 slot becomes cc3 (so ["N",a,b,c] and
  //    ["N",a,b,"3colors",c] both take c as the middle color);
  //  - 'linear': cc1 → cc2 in equal steps;
  //  - 'dynamic', and 'auto' when either end is bright: cc1 → cc2 with
  //    triangular-number steps (low range expanded) — cc3 is IGNORED
  //    there, so a bright 3-anchor sweep never reaches its middle color;
  //  - 'auto'/'2colors'/'3colors' (split 0.5), '2low'/'3low' (0.75),
  //    '2high'/'3high' (0.23): cc1 → cc3 → cc2, last step exactly cc2;
  //  - '2narrow'/'3narrow', '2wide'/'3wide': cumulative-step variants.
  // Channels are FLOORED, as the source's own hex encoding does
  // (hh.charAt(Math.floor(v / 16)) + hh.charAt(v % 16) truncates the
  // fraction), and clamped to 0-255. The named palettes are
  // flatPaletteScheme's; spectrum/spectral (flat's colour-wheel generator)
  // is not ported: null, the caller's fallback.
  const FLAT_PALETTE_SCHEMES = /^(spectrum|spectral|office|mineral|minaral|pastel|harvest|fruit|kmeansp?|pimp|intense|fluo|tableau(10|20)?|viridis|plasma|magma)$/i;
  const FLAT_SWEEP_MODES = ['auto', 'linear', 'dynamic', '2colors', '2wide', '2narrow', '2low', '2high', '3colors', '3wide', '3narrow', '3low', '3high'];

  // flat's named palettes (colorscheme.js 832-1177, 1197-1268), the tables
  // copied from flat's source: ["N", "tableau", offset] takes N colors of the
  // palette from offset on, repeating it cyclically
  // (_circ_createPaletteColorScheme); viridis / plasma / magma are 32-stop
  // sequential maps resampled to N stops with linear interpolation
  // (_circ_createSequentialPaletteColorScheme). flat matches each name in
  // three spellings only — lower, UPPER, Title ("Minaral" for mineral).
  const FLAT_QUALITATIVE_PALETTES = {
    office: [
      '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF',
      '#000080', '#FF00FF', '#FFFF00', '#00FFFF', '#800080', '#800000', '#008080', '#0000FF',
      '#00CCFF', '#CCFFFF', '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99'
    ],
    mineral: [
      '#F3898B', '#7BFECD', '#B3B07B', '#49BA85', '#FEDBFE', '#847FBA', '#FEA869', '#17BCC4',
      '#DC686D', '#28803C', '#FFFF00', '#C09B43', '#746FC0', '#9C9C9C', '#EDFEA5', '#0000FF',
      '#00E04D', '#86A9CE', '#B37B9D', '#9FD8B3', '#FEB676', '#C09671', '#87CFFE', '#00A7C7'
    ],
    pastel: [
      '#D2D2D2', '#9DC0C0', '#DFC7AA', '#A1D197', '#E2A6A6', '#CBA6CB', '#FEA4A4', '#A8ACD1',
      '#C8D89A', '#F3C4D8', '#E9E15E', '#EEEEEE', '#C0AB79', '#E2E17F', '#B4E1FE', '#E8DDFE',
      '#E1FEEB', '#FEF782', '#C3FFC3', '#CEFE87', '#8CFEB3', '#D2D2D2', '#9DC0C0', '#DFC7AA'
    ],
    harvest: [
      '#C06549', '#FFD700', '#BDB76B', '#F7B567', '#CEC395', '#CD9B1D', '#F0E68C', '#A7AF5E',
      '#C09058', '#8B4513', '#AC96AC', '#698B69', '#8B6914', '#8B8B00', '#FFFBC3', '#BDB056',
      '#DCCEDB', '#FEF782', '#FEEAC6', '#FFC7AE', '#A6B655', '#DB6700', '#E5A100', '#F7D3B3'
    ],
    fruit: [
      '#1F77B4', '#AEC7E8', '#FF7F0E', '#FFBB78', '#2CA02C', '#99DF8B', '#D62728', '#FF9896',
      '#966ABE', '#C5B0D5', '#8C564B', '#C49C94', '#E377C2', '#F7B6D2', '#7E7E7E', '#C7C7C7',
      '#BCBD22', '#DBDB8D', '#18BECF', '#9EDAE5', '#1F77B4', '#AEC7E8'
    ],
    kmeans: [
      '#c17cd3', '#91c15d', '#6a70d7', '#bab440', '#513688', '#5dc67f', '#993888', '#37d8b0',
      '#e3586f', '#36dee6', '#d66044', '#47b795', '#ab396c', '#568429', '#e07db5', '#3c7c3d',
      '#628bd5', '#cb8832', '#ad4258', '#a2863e', '#ad4248', '#9c4629'
    ],
    kmeansp: [
      '#ffd1b2', '#a5b2e9', '#effcc2', '#e1c3f8', '#acc692', '#d899b7', '#bbfdd9', '#e8a197',
      '#8ceceb', '#fab9a0', '#6dc5b7', '#ffc0bc', '#66b8bd', '#dcc992', '#7db3c8', '#fffedb',
      '#ffdfff', '#84b5ac', '#ffebf2', '#a2aead', '#e1f3ff', '#b5e6ff'
    ],
    pimp: [
      '#b09234', '#5f3dc1', '#4ca735', '#b54ade', '#7e9a36', '#cb43b3', '#4a9f61', '#d93f76',
      '#3a9e88', '#da4631', '#7876dc', '#d57a29', '#5e90cd', '#814b1b', '#554f95', '#396829',
      '#c275ba', '#75702e', '#89376c', '#bf7f51', '#923432', '#d37075'
    ],
    intense: [
      '#c98ab6', '#5bbb42', '#6035bd', '#9dac3c', '#c450da', '#66b888', '#d84fa9', '#44733a',
      '#7370d7', '#d19231', '#443672', '#db4d32', '#4ca5b0', '#d5466d', '#829fdb', '#8b3b26',
      '#506793', '#a69358', '#873987', '#4f4b21', '#d58873', '#79354c'
    ],
    fluo: [
      '#ecd730', '#4ddded', '#c0ee32', '#f6ac8d', '#64ea51', '#eebd5e', '#5be9c8', '#d9db55',
      '#77e7a1', '#c6e552', '#8ac793', '#95e354', '#a5e3ad', '#dff782', '#67ee8b', '#e2d680',
      '#a5e47d', '#b0d490', '#9fc658', '#d1f5a5', '#b4db6c', '#c1d271'
    ],
    tableau: [
      '#4e79a7', '#a0cbe8', '#f28e2b', '#ffbe7d', '#59a14f', '#8cd17d', '#b6992d', '#f1ce63',
      '#499894', '#86bcb6', '#e15759', '#ff9d9a', '#79706e', '#bab0ac', '#d37295', '#fabfd2',
      '#b07aa1', '#d4a6c8', '#9d7660', '#d7b5a6'
    ],
    tableau10: [
      '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B', '#E377C2', '#7F7F7F',
      '#BCBD22', '#17BECF', '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B',
      '#E377C2', '#7F7F7F', '#BCBD22', '#17BECF'
    ],
    tableau20: [
      '#1F77B4', '#AEC7E8', '#FF7F0E', '#FFBB78', '#2CA02C', '#98DF8A', '#D62728', '#FF9896',
      '#9467BD', '#C5B0D5', '#8C564B', '#C49C94', '#E377C2', '#F7B6D2', '#7F7F7F', '#C7C7C7',
      '#BCBD22', '#DBDB8D', '#17BECF', '#9EDAE5'
    ]
  };
  const FLAT_SEQUENTIAL_PALETTES = {
    viridis: [
      '#440154', '#470D60', '#48186A', '#482475', '#472E7C', '#453882', '#424186', '#3E4C8A',
      '#3A548C', '#365D8D', '#32658E', '#2E6D8E', '#2B758E', '#287D8E', '#25848E', '#228C8D',
      '#1F948C', '#1E9C89', '#20A386', '#25AB82', '#2EB37C', '#3ABA76', '#48C16E', '#58C765',
      '#69CD5B', '#7FD34E', '#93D741', '#A8DB34', '#BDDF26', '#D5E21A', '#EAE51A', '#FDE725'
    ],
    plasma: [
      '#0D0887', '#220690', '#310597', '#41049D', '#4E02A2', '#5B01A5', '#6700A8', '#7501A8',
      '#8104A7', '#8D0BA5', '#9814A0', '#A21D9A', '#AD2793', '#B6308B', '#BF3984', '#C7427C',
      '#CF4C74', '#D6556D', '#DD5E66', '#E3685F', '#E97257', '#EF7C51', '#F3874A', '#F79143',
      '#FA9C3C', '#FCA934', '#FDB52E', '#FDC229', '#FCCE25', '#F9DD25', '#F5EB27', '#F0F921'
    ],
    magma: [
      '#000004', '#030312', '#0A0822', '#140E36', '#1E1149', '#2A115C', '#38106C', '#471078',
      '#54137D', '#601880', '#6D1D81', '#792282', '#882781', '#942C80', '#A1307E', '#AE347B',
      '#BD3977', '#CA3E72', '#D6456C', '#E24D66', '#EC5860', '#F3655C', '#F8745C', '#FB835F',
      '#FD9266', '#FEA36F', '#FEB27A', '#FEC185', '#FECF92', '#FDE0A1', '#FCEEB0', '#FCFDBF'
    ]
  };
  const FLAT_PALETTE_NAMES = (() => {
    const names = {};
    for (const key of [...Object.keys(FLAT_QUALITATIVE_PALETTES), ...Object.keys(FLAT_SEQUENTIAL_PALETTES)]) {
      names[key] = key; names[key.toUpperCase()] = key;
      names[key === 'mineral' ? 'Minaral' : key[0].toUpperCase() + key.slice(1)] = key;
    }
    return names;
  })();
  const hexRgb = h => [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  function flatPaletteScheme(name, nColors, offset) {
    const key = FLAT_PALETTE_NAMES[name];
    if (!key) return null;
    nColors = Math.max(1, Number(nColors) || 1);
    const seq = FLAT_SEQUENTIAL_PALETTES[key];
    if (seq) {
      const out = [];
      for (let i = 0; i < nColors; i++) {
        const pos = (nColors < 2 ? 0 : i / (nColors - 1)) * (seq.length - 1);
        const i0 = Math.floor(pos), i1 = Math.min(seq.length - 1, i0 + 1), f = pos - i0;
        const a = hexRgb(seq[i0]), b = hexRgb(seq[i1]);
        out.push(a.map((v, k) => Math.round(v + (b[k] - v) * f)));
      }
      return out;
    }
    const colors = FLAT_QUALITATIVE_PALETTES[key];
    const off = Number(offset) || 0;
    const out = [];
    for (let i = 0; i < nColors; i++) out.push(hexRgb(colors[(off + i) % colors.length]));
    return out;
  }

  function isGeneratedColorScheme(colorscheme) {
    return Array.isArray(colorscheme) && colorscheme.length > 0 && !isNaN(Number(colorscheme[0])) && String(colorscheme[0]).trim() !== '';
  }

  // colorscheme.js _circ_getHexaColor, to RGB: '#rrggbb', 'rgb(r,g,b)'
  // (any case), CSS color names — else the caller's fallback, like flat's
  function flatColorRgb(c, fallback) {
    return parseCssColor(c) || fallback;
  }

  function flatColorSweep(cc1, cc2, nSteps, nParam1, nParam2) {
    if (typeof cc1 === 'string' && FLAT_PALETTE_NAMES[cc1]) return flatPaletteScheme(cc1, nSteps, cc2);
    if (typeof cc1 === 'string' && FLAT_PALETTE_SCHEMES.test(cc1)) return null;
    nSteps = Number(nSteps);
    const [r1, g1, b1] = flatColorRgb(cc1, [255, 255, 255]);
    const [r2, g2, b2] = flatColorRgb(cc2, [0, 0, 0]);
    if (nSteps < 2) return [[r2, g2, b2]];
    if (nSteps < 3) return [[r1, g1, b1], [r2, g2, b2]];
    const bright = (r1 + g1 + b1) / 3 > 127 || (r2 + g2 + b2) / 3 > 127;
    let c3 = [255, 253, 224]; // '#FFFDE0'
    if (bright) c3 = [Math.min(255, (r1 + r2) * 0.55), Math.min(255, (g1 + g2) * 0.55), Math.min(255, (b1 + b2) * 0.55)].map(Math.floor);
    if (nParam1 === 'auto' || nParam2 === 'auto') {
      c3 = [Math.min(255, (r1 + r2) * 1.5), Math.min(255, (g1 + g2) * 1.5), Math.min(255, (b1 + b2) * 1.5)].map(Math.floor);
      nParam1 = nParam2 = 'auto';
    }
    if (nParam1 && !FLAT_SWEEP_MODES.includes(nParam1)) { c3 = flatColorRgb(nParam1, [255, 253, 224]); nParam1 = 'auto'; }
    if (!nParam1) nParam1 = 'auto';
    if (nParam2 && nParam2 !== 'shift') {
      if (FLAT_SWEEP_MODES.includes(nParam2)) nParam1 = nParam2;
      else if (nParam2 === 'warm') c3 = [255, 253, 216];
      else if (nParam2 === 'cold') c3 = [255, 255, 255];
      else c3 = flatColorRgb(nParam2, [255, 253, 224]);
    }
    const [r3, g3, b3] = c3;
    const ch = v => Math.max(0, Math.min(255, Math.floor(v)));
    const px = (r, g, b) => [ch(r), ch(g), ch(b)];
    const out = [];
    if (nParam1 === 'linear') {
      const dr = (r2 - r1) / (nSteps - 1), dg = (g2 - g1) / (nSteps - 1), db = (b2 - b1) / (nSteps - 1);
      for (let i = 0; i < nSteps; i++) out.push(px(r1 + dr * i, g1 + dg * i, b1 + db * i));
      return out;
    }
    if (nParam1 === 'dynamic' || (nParam1 === 'auto' && bright)) {
      const shift = nParam2 === 'shift' ? 1 : 0;
      let nn = 0;
      for (let i = 0; i < nSteps + shift; i++) nn += i;
      const dr = (r2 - r1) / nn, dg = (g2 - g1) / nn, db = (b2 - b1) / nn;
      nn = 0;
      for (let i = shift; i < nSteps + shift; i++) { nn += i; out.push(px(r1 + dr * nn, g1 + dg * nn, b1 + db * nn)); }
      return out;
    }
    let rr = r1, gg = g1, bb = b1;
    if (['auto', '2colors', '2high', '2low', '3colors', '3high', '3low'].includes(nParam1)) {
      const nPart1 = /low$/.test(nParam1) ? 0.75 : /high$/.test(nParam1) ? 0.23 : 0.5;
      const nPart2 = 1 - nPart1;
      const d1 = (nSteps - 1) * nPart1, d2 = (nSteps - 1) * nPart2;
      const dr1 = (r3 - r1) / d1, dg1 = (g3 - g1) / d1, db1 = (b3 - b1) / d1;
      const dr2 = (r3 - r2) / d2, dg2 = (g3 - g2) / d2, db2 = (b3 - b2) / d2;
      for (let i = 0; i < nSteps - 1; i++) {
        out.push(px(rr, gg, bb));
        if (i < d1) { rr += dr1; gg += dg1; bb += db1; } else { rr -= dr2; gg -= dg2; bb -= db2; }
        rr = Math.max(Math.min(255, rr), 0); gg = Math.max(Math.min(255, gg), 0); bb = Math.max(Math.min(255, bb), 0);
      }
    } else { // '2narrow'/'3narrow', '2wide'/'3wide'
      const wide = /wide$/.test(nParam1);
      let nn = 0;
      for (let i = 0; i < nSteps / 2; i++) nn += i;
      if (wide) nn -= Math.floor((nSteps / 2 - Math.floor(nSteps / 2)) * nSteps / 2);
      const dr1 = (r3 - r1) / (nn + 1), dg1 = (g3 - g1) / (nn + 1), db1 = (b3 - b1) / (nn + 1);
      const dr2 = (r3 - r2) / (nn + 1), dg2 = (g3 - g2) / (nn + 1), db2 = (b3 - b2) / (nn + 1);
      for (let i = 0; i < nSteps - 1; i++) {
        if (i < nSteps / 2) { const k = wide ? nSteps / 2 - 1 - i : i; rr += dr1 * k; gg += dg1 * k; bb += db1 * k; }
        else { const k = wide ? i - nSteps / 2 : nSteps - 1 - i; rr -= dr2 * k; gg -= dg2 * k; bb -= db2 * k; }
        out.push(px(rr, gg, bb));
      }
    }
    out.push([r2, g2, b2]); // the last step is exactly cc2
    return out;
  }

  // style.classes rewrites the colorscheme before it is generated
  // (maptheme.js parseStyle, :1253): an explicit color list becomes
  // [classes, first, last, cs[3], cs[4]] — slots 3/4 keep the ORIGINAL
  // list's 4th/5th colors, which the sweep then reads as nParam1/nParam2
  // — and a generated one just gets classes as its N. So `classes` on an
  // explicit list yields a generated sweep, not the listed colors.
  function applyClassesToColorScheme(colorscheme, classes) {
    if (classes === undefined || classes === null || classes === '' || !Array.isArray(colorscheme) || !colorscheme.length) return colorscheme;
    const cs = colorscheme.slice();
    if (isNaN(Number(cs[0]))) { const last = cs[cs.length - 1]; cs[1] = cs[0]; cs[2] = last; }
    cs[0] = Number(classes);
    return cs;
  }

  // Deliberate deviation from the real source: real colorscheme.js takes
  // nSteps (the array's own leading "N") literally, which can silently
  // drift out of sync with the theme's actual label count (confirmed:
  // CATEGORICAL/SEQUENCE themes even overwrite their OWN nSteps before
  // calling in, precisely because of this). This port always uses
  // `labels.length` as the step count instead — the one value that
  // actually has to match categoryColorsRgb's indexing in this engine —
  // and only uses the array's leading element to DETECT a generated
  // colorscheme (isGeneratedColorScheme above), never as the step count.
  function resolveColorScheme(colorscheme, labels, classes) {
    if (!colorscheme) return labels.map((_, i) => FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]);
    colorscheme = applyClassesToColorScheme(colorscheme, classes);
    if (isGeneratedColorScheme(colorscheme)) {
      const [, cc1, cc2, nParam1, nParam2] = colorscheme;
      const sweep = flatColorSweep(cc1, cc2, labels.length, nParam1, nParam2);
      if (sweep) return sweep;
      console.warn(`[ixmaps-gl] colorscheme "${cc1}" (a named ixmaps palette) is not supported, using the fallback palette`);
      return null;
    }
    if (Array.isArray(colorscheme)) {
      if (colorscheme.length === 1 && colorscheme[0] === 'none') return null; // no fill (FEATURES outline-only)
      return labels.map((_, i) => colorscheme[i % colorscheme.length]);
    }
    if (typeof colorscheme === 'string') {
      try {
        const fn = new Function('return (' + colorscheme + ')')();
        const objTheme = { szLabelA: labels, colorScheme: new Array(labels.length) };
        fn(objTheme);
        return objTheme.colorScheme;
      } catch (err) {
        console.warn('[ixmaps-gl] colorscheme function failed to evaluate, using fallback palette:', err);
      }
    }
    return labels.map((_, i) => FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]);
  }

  function hexToRgb(hex) {
    let h = hex.replace('#', '').trim();
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('');
    else if (h.length === 8) h = h.slice(0, 6); // #rrggbbaa: alpha not used here
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Any CSS color string → [r, g, b], or null if it isn't one. A listed
  // colorscheme color goes straight into flat's SVG fill, so the BROWSER
  // parses it there: '#rgb'/'#rrggbb', 'rgb()'/'RGB()'/'rgba()', names
  // ('darkorange'), hsl(), … Here deck.gl needs numbers, so: hex and
  // rgb()/rgba() (any case) directly, anything else through the browser's
  // own CSS parser (a canvas fillStyle round trip, cached).
  const _cssColorCache = new Map();
  let _cssColorCtx;
  function parseCssColor(v) {
    if (typeof v !== 'string' || !v.trim()) return null;
    const c = v.trim();
    if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return hexToRgb(c);
    const m = c.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    if (m) return [m[1], m[2], m[3]].map(x => Math.max(0, Math.min(255, Math.round(+x))));
    if (_cssColorCache.has(c)) return _cssColorCache.get(c);
    let rgb = null;
    try {
      if (_cssColorCtx === undefined) {
        const cv = typeof document !== 'undefined' && document.createElement && document.createElement('canvas');
        _cssColorCtx = (cv && cv.getContext && cv.getContext('2d')) || null;
      }
      if (_cssColorCtx) {
        _cssColorCtx.fillStyle = '#010203';   // sentinel: an invalid color leaves it unchanged
        _cssColorCtx.fillStyle = c;
        const out = String(_cssColorCtx.fillStyle);
        if (out !== '#010203' || /^#010203$/i.test(c)) rgb = parseCssColor(out);
      }
    } catch (e) { rgb = null; }
    _cssColorCache.set(c, rgb);
    return rgb;
  }

  // resolveColorScheme can now return either hex strings (plain array /
  // colorscheme-function paths) or already-RGB triplets (the diverging
  // sweep above) — every caller needs actual RGB arrays for deck.gl, so
  // this is the one place that normalizes either shape, instead of each
  // of the three call sites (_prepare's CATEGORICAL branch, _buildPartsA,
  // _prepareDominant) doing its own `.map(hexToRgb)` that would break on
  // the diverging sweep's own output.
  function resolveClassColors(colorscheme, labels, classes) {
    const resolved = resolveColorScheme(colorscheme, labels, classes);
    return (resolved || labels.map((_, i) => FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]))
      .map(c => Array.isArray(c) ? c : (parseCssColor(c) || [130, 130, 130]));
  }

  // ---------------------------------------------------------------
  // builder API — chainable, matches the original ixmaps syntax exactly
  // ---------------------------------------------------------------

  // NOSORT: confirmed inert in the REAL engine too, not just unimplemented
  // here — its own drawChart only checks /\bSORT\b/, which never matches
  // inside the substring "NOSORT" (a real self-inflicted no-op flag in the
  // source we're porting, per direct verification against it).
  // NOOUTLIER (drops values beyond outlierscale std-deviations from the
  // mean — see the NOOUTLIER block in _buildChartLayers) has real
  // behavior now; bare OUTLIER (the real source's "keep ONLY the
  // outliers" inverse mode) stays unimplemented — no config here uses it.
  const KNOWN_INERT_FLAGS = ['SEQUENCE', 'STAR', 'SORT', 'DOWN', 'RECT', 'CLIPTOGEOBOUNDS', 'OUTLIER',
    'POW2', 'POW3', 'NOSORT'];
  const _warnedFlags = new Set();

  // GL-PORT COMPAT: real ixmaps-flat's global ixmaps.getThemeObj(szId) /
  // ixmaps.data.getFacets(...) look up a theme by id from the ENGINE's own
  // global registry, not from a per-map handle a page necessarily still
  // has around — a page's own callback (e.g. a "layerdraw" handler) is
  // often written to call these globals directly, real-engine style. This
  // engine has no single global "the map"'s worth of state (a page can
  // build more than one independent map), so this registry is a
  // best-effort, LAST-DEFINITION-WINS map from theme name to its
  // LayerRuntime — exactly matching a real page's own typical assumption
  // that theme names are unique enough to look up this way. See
  // build()'s main loop and defineLayer(), the two places a runtime is
  // ever created, for where this gets populated.
  const _globalThemeRegistry = new Map();

  // Same LAST-DEFINITION-WINS rationale as _globalThemeRegistry above, for
  // real ixmaps-flat's map-LEVEL globals (ixmaps.getProjectString/
  // setProjectJSON/getZoom/getCenter/...) that a page calls without a
  // per-map handle — most real pages only ever build one map anyway. Set
  // once per successful build(), just before it returns engineApi below.
  let _lastMapApi = null;
  // resolves with the first built map's API: ixmaps.map() calls a page
  // makes while the map is still building wait for it
  let _resolveMapReady;
  const _mapReady = new Promise(r => { _resolveMapReady = r; });

  // flat's ixmaps.require(url) fetches the script and evals it
  // (htmlgui.js 3911-3934); here each one runs globally, in order, before
  // the layers are built — a failed one is reported and skipped, as flat
  const _requiredScripts = new Map();
  async function loadRequiredScripts(urls) {
    for (const url of urls || []) {
      if (!_requiredScripts.has(url)) {
        _requiredScripts.set(url, fetch(url)
          .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
          .then(text => { (0, eval)(text + '\n//# sourceURL=' + url); })
          .catch(e => console.error(`[ixmaps-gl] required resource '${url}' could not be loaded:`, e)));
      }
      await _requiredScripts.get(url);
    }
  }

  // ---- USER charts: a page's own chart function (style.userdraw) ----
  // flat calls ixmaps.<userdraw>_init(SVGDocument, {target, theme}) once
  // per realize (maptheme.js 17000-17050) and ixmaps.<userdraw>(SVGDocument,
  // opt) per chart (19855-19930), opt = {target: the chart's SVG group,
  // theme, item, value, values, size, maxSize, color, class, flag, …}; the
  // chart draws in flat's chart units around 0,0, and flat scales the group
  // to the screen. Here it draws into a hidden SVG, and the drawing is shown
  // as an icon, in the same units, scaled the same way.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // DENSITY's value field (LayerRuntime._withDensity)
  const DENSITY_VALUE_FIELD = '$density$value';
  let _userChartSvg = null;
  function userChartHost() {
    if (_userChartSvg && _userChartSvg.isConnected) return _userChartSvg;
    _userChartSvg = document.createElementNS(SVG_NS, 'svg');
    _userChartSvg.setAttribute('style', 'position:absolute;left:-100000px;top:0;width:10px;height:10px;visibility:hidden;pointer-events:none');
    document.body.appendChild(_userChartSvg);
    return _userChartSvg;
  }
  // a function by name — "name" on ixmaps, or a dotted path on window (flat)
  function resolveUserChartFunction(name) {
    if (!name || !/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(name)) return null;
    let fn = null;
    if (name.includes('.')) {
      fn = name.split('.').reduce((o, k) => (o && o[k] ? o[k] : null), global);
    } else {
      const ix = pageIxmaps();
      fn = ix && ix[name];
    }
    return typeof fn === 'function' ? fn : null;
  }
  // the user chart's size unit: flat's normalX(15) = 300 is the chart's
  // normal radius (maxSize), shown at gl's normal bubble radius
  const USER_CHART_MAX_SIZE = 300;
  // raster sizes (px) of a user chart's image — see _userChartIcon
  const USER_CHART_RASTER = [16, 24, 32, 48, 64, 96, 128, 192, 256];
  // ?ixgl-debug in the page URL: ixmaps-gl logs what it draws (console.info)
  function glDebug() {
    try { return new URLSearchParams(global.location.search).has('ixgl-debug'); } catch (e) { return false; }
  }
  // the pixel area all of a layer's chart images may take together: deck.gl
  // packs them into one texture (1024 px wide), which must stay well below
  // the GPU's texture size limit — see _userChartIcon
  const USER_CHART_ATLAS_AREA = 1024 * 8192;
  class LayerBuilder {
    constructor(name) {
      this.name = name;
      this._data = null;
      this._binding = {};
      this._filterExpr = null;
      this._typeStr = '';
      this._style = {};
      this._meta = {};
    }
    data(d) { this._data = d; return this; }
    // .binding()/.style()/.meta() MERGE into what earlier calls set, as real
    // ixmaps-flat's themeConstruct does (for (i in obj) def.x[i] = obj[i]):
    // .binding({geo}).binding({value}) keeps both, a later value for the same
    // key wins. Always into a new object — the page's own objects are never
    // mutated. Aliases (geo → position, ...) are resolved in normalizeTheme.
    binding(b) {
      this._binding = Object.assign({}, this._binding, b);
      return this;
    }
    filter(expr) { this._filterExpr = expr; return this; }
    // flags (and their implications, e.g. BUBBLE → SYMBOL) are resolved in
    // normalizeTheme, not here
    type(t) {
      this._typeStr = t;
      return this;
    }
    style(s) { this._style = Object.assign({}, this._style, s); return this; }
    meta(m) { this._meta = Object.assign({}, this._meta, m); return this; }
    // Real ixmaps-flat's remaining themeConstruct methods — each stores what
    // flat stores, and definition() writes it into flat's slot:
    //   field/field100 → def.field/def.field100 (a .binding() value wins)
    //   lookup/geo     → def.style.lookupfield (see resolveGeometryBinding)
    //   query/process  → def.data.query/process (process: a function is kept
    //                    as its source text, as flat does; this engine can't
    //                    run it yet — the validator reports it)
    //   encoding       → merged into binding: {k: {field: f}} or {k: f}
    //   json           → the definition, like definition()
    field(name) { this._field = name; return this; }
    field100(name) { this._field100 = name; return this; }
    lookup(name) { this._lookupfield = name; return this; }
    geo(name) { this._lookupfield = name; return this; }
    query(q) { this._query = q; return this; }
    process(p) { this._process = typeof p === 'function' ? p.toString() : p; return this; }
    encoding(e) {
      const b = Object.assign({}, this._binding);
      for (const k in e) b[k] = (e[k] && e[k].field) || e[k];
      this._binding = b;
      return this;
    }
    json() { return this.definition(); }
    // Real-engine chain method setting the legend panel's own HEADING
    // text (not a value-field label, despite the name reading that way at
    // first glance — confirmed against real pages, e.g. the power-plants
    // sample's .title("Global Power Plants") becomes that legend's title
    // line). Stored separately (not merged into _meta here), so callers can
    // chain .title() before OR after .meta() — definition() puts it where real
    // ixmaps-flat does (style.title) and normalizeTheme applies it as a
    // fallback (meta.title wins if a caller's own .meta({title:...})
    // already set one). Consumed by the native legend renderer in build()
    // via rt.meta.title.
    title(fieldName) { this._titleField = fieldName; return this; }
    // GL-PORT COMPAT: real ixmaps-flat's map.layer(name).data()...define()
    // chain ends with an explicit .define() call that commits the theme.
    // This engine's own build pipeline doesn't need an explicit commit —
    // simply being attached via .layer() (see MapBuilder.layer, both the
    // ixmaps.layer(name, cb) factory path and the real-flat map.layer(name)
    // compat path) is already enough — so .define() is a harmless no-op,
    // not a crash, for a page that calls it out of real-engine habit.
    // The theme definition in real ixmaps-flat's own shape (its
    // themeConstruct.definition() — also a project-JSON theme, schema v1.2):
    // type, filter and title live INSIDE style there. Built fresh from this
    // builder's fields on every call. normalizeTheme() turns it into what the
    // renderers read.
    definition() {
      const style = Object.assign({}, this._style);
      if (this._typeStr) style.type = this._typeStr;
      if (this._filterExpr != null) style.filter = this._filterExpr;
      if (this._titleField != null) style.title = this._titleField;
      if (this._lookupfield != null) style.lookupfield = this._lookupfield;
      let data = this._data;
      if (this._query != null || this._process != null) {
        data = Object.assign({}, this._data);
        if (this._query != null) data.query = this._query;
        if (this._process != null) data.process = this._process;
      }
      const def = { layer: this.name, data, binding: this._binding, style, meta: this._meta };
      if (this._field != null) def.field = this._field;
      if (this._field100 != null) def.field100 = this._field100;
      return def;
    }
    define() { return this; }
  }

  function layer(name, configFn) {
    const builder = new LayerBuilder(name);
    if (configFn) configFn(builder);
    return builder;
  }

  // ---------------------------------------------------------------
  // Binding aliases. Real ixmaps-flat accepts ~50 .binding() keys and maps
  // them onto 17 internal targets (htmlgui.js newTheme: value/values/field/
  // fields → theme.field, size/sizefield → style.sizefield, ...). The table
  // between the markers is GENERATED from the shared grammar
  // (github.com/gjrichter/ixmaps-grammar) by test/sync-grammar.mjs — do not
  // edit it by hand; `npm run unit` fails when it drifts.
  // ---------------------------------------------------------------
  // <grammar:binding-aliases>
  // generated from ixmaps-grammar 0.1.25 (ixmaps-flat 1.0.42, 2b978d5 2026-10-02) — 52 aliases
  const FLAT_BINDING_ALIASES = {
    "aggregation": "style.aggregationfield",
    "aggregationfield": "style.aggregationfield",
    "alpha": "style.alphafield",
    "alpha100": "style.alphafield100",
    "alphafield": "style.alphafield",
    "alphafield100": "style.alphafield100",
    "color": "style.colorfield",
    "colorfield": "style.colorfield",
    "digits": "style.lookupdigits",
    "field": "theme.field",
    "field100": "theme.field100",
    "fields": "theme.field",
    "geo": "style.lookupfield",
    "geo1": "style.lookupfield",
    "geo2": "style.lookupfield2",
    "georef": "style.lookupfield",
    "georef1": "style.lookupfield",
    "georef2": "style.lookupfield2",
    "id": "style.itemfield",
    "item": "style.itemfield",
    "itemfield": "style.itemfield",
    "lookup": "style.lookupfield",
    "lookup1": "style.lookupfield",
    "lookup2": "style.lookupfield2",
    "lookupdigits": "style.lookupdigits",
    "lookupfield": "style.lookupfield",
    "lookupfield1": "style.lookupfield",
    "lookupfield2": "style.lookupfield2",
    "lookupsuffix": "style.lookupsuffix",
    "lookuptonumber": "style.lookuptonumber",
    "lookuptoupper": "style.lookuptoupper",
    "number": "style.lookuptonumber",
    "position": "style.lookupfield",
    "position1": "style.lookupfield",
    "position2": "style.lookupfield2",
    "size": "style.sizefield",
    "sizefield": "style.sizefield",
    "suffix": "style.lookupsuffix",
    "text": "style.valuefield",
    "textvalue": "style.valuefield",
    "time": "style.timefield",
    "timefield": "style.timefield",
    "title": "style.titlefield",
    "titlefield": "style.titlefield",
    "tonumber": "style.lookuptonumber",
    "toupper": "style.lookuptoupper",
    "upper": "style.lookuptoupper",
    "value": "theme.field",
    "value100": "theme.field100",
    "valuefield": "style.valuefield",
    "values": "theme.field",
    "valuetext": "style.valuefield",
  };
  // </grammar:binding-aliases>

  // flat's meta vocabulary. flat merges ALL of .meta() into style (meta
  // wins) before anything reads either, and keeps these keys readable from
  // both — so .style({tooltip}) is a tooltip and .meta({fillopacity}) a style
  // property. GENERATED by test/sync-grammar.mjs — do not edit.
  // <grammar:meta-keys>
  // generated from ixmaps-grammar 0.1.25 — 5 meta keys
  const FLAT_META_KEYS = ["description","name","snippet","title","tooltip"];
  // </grammar:meta-keys>

  // Which of those flat targets this engine implements, and under which name
  // its renderers read it. Targets missing here (style.colorfield, style.timefield, ...) are still resolved into
  // spec.targets, just not used yet — the validator reports them as
  // gl-unsupported. style.lookupfield (geo/position/lookup/georef/... — ONE
  // target in flat) has no fixed name here: resolveGeometryBinding decides,
  // by flat's own rule, whether it means points or a join key.
  const GL_BINDING_TARGETS = {
    'style.lookupfield': null, // → binding.position or binding.lookup, see resolveGeometryBinding
    'theme.field': ['binding', 'value'],
    'theme.field100': ['binding', 'field100'], // see applyField100
    'style.sizefield': ['binding', 'size'],
    'style.itemfield': ['binding', 'id'],
    'style.alphafield': ['binding', 'alpha'],
    'style.alphafield100': ['binding', 'alpha100'],
    'style.valuefield': ['style', 'valuefield'],
    'style.timefield': ['binding', 'time'], // setThemeTimeFrame, see LayerRuntime.setTimeFrame
    'style.titlefield': ['binding', 'title'], // {{theme.item.title}}, see _buildTooltipContext
    // the lookup key's normalization (flatLookupKey): flat's newTheme moves
    // binding.tonumber / digits / … into these style keys (htmlgui.js 1712)
    'style.lookupdigits': ['style', 'lookupdigits'],
    'style.lookuptonumber': ['style', 'lookuptonumber'],
    'style.lookuptoupper': ['style', 'lookuptoupper'],
  };
  const LOOKUPFIELD_TARGET = 'style.lookupfield';

  // flat's own resolution order (htmlgui.js newTheme): a target given as a
  // STYLE key first (in flat, .style({sizefield}) and .binding({size}) are the
  // same thing), then every .binding() alias in object order — the last
  // alias for a target wins.
  function resolveBindingTargets(style, rawBinding, def) {
    // flat: .field()/.field100() set theme.field/field100 first; style keys
    // and then .binding() aliases override them
    const targets = {};
    if (def && def.field != null) targets['theme.field'] = def.field;
    if (def && def.field100 != null) targets['theme.field100'] = def.field100;
    const styleTargets = new Set(Object.values(FLAT_BINDING_ALIASES).filter(t => t.startsWith('style.')));
    for (const [k, v] of Object.entries(style)) {
      if (styleTargets.has('style.' + k)) targets['style.' + k] = v;
    }
    for (const [k, v] of Object.entries(rawBinding)) {
      const t = FLAT_BINDING_ALIASES[k];
      if (t) targets[t] = v;
    }
    return targets;
  }

  // What style.lookupfield means — real ixmaps-flat's rule (maptheme.js
  // MapTheme.getSelectionId): "a|b" naming two fields = lat/lon; a single
  // field holding GeoJSON geometry = the item's own geometry; any other
  // single field = a lookup key joined to map items. This engine gets its
  // geometry from GeoJSON/TopoJSON sources (not from a per-record geometry
  // string), and joins only against a same-named FEATURE layer, so:
  //   "a|b"                        → latlon   → binding.position (points)
  //   "geometry", or geojson/
  //   topojson data                → embedded → binding.position
  //   any other data, single field → join     → binding.lookup
  // ("geometry" is flat's own convention: htmlgui.js defaults lookupfield
  // to "geometry" for GeoJSON/TopoJSON sources — that field IS the geometry)
  function resolveGeometryBinding(field, data) {
    if (String(field).includes('|')) return { kind: 'latlon', field };
    if (field === 'geometry' || (data && /^(geo|topo)json$/i.test(String(data.type || '')))) return { kind: 'embedded', field };
    return { kind: 'join', field };
  }

  // ---------------------------------------------------------------
  // Project-file themes. A theme in a real ixmaps-flat project JSON
  // (setProjectJSON/loadProject) is stored in flat's OLDER shape: the data
  // source lives in style.dbtable* keys, the value field at the top level.
  // projectThemeToDefinition() reverses flat's own translation (htmlgui.js
  // newTheme maps data{} → style.dbtable*; maptheme.js reads those back) into
  // the definition shape normalizeTheme() takes:
  //   style.dbtable        → data.name (a table NAME — flat never builds a
  //                          file URL from it)
  //   style.dbtableUrl     → data.url, used as is (flat passes it straight to
  //                          its data loader)
  //   style.dbtableType/Ext/Process/Query/Obj, datacache → data.type/ext/
  //                          process/query/obj/cache
  //   style.dbtable "name type (url) (ext)" — flat's oldest one-string form
  //   theme.type → style.type; theme.field/field100 (or data.field/field100)
  //                          → def.field/field100
  // A modern theme.data{} wins over the style keys (flat applies it later).
  // Code a project names (data.ext scripts, data.process functions) is kept
  // as data; only data.ext scripts under the page's .options({trustedscripts})
  // ever run (see loadProcessingScript, loadBrokerData).
  // ---------------------------------------------------------------
  const PROJECT_DATA_KEYS = {
    dbtable: 'name', dbtableUrl: 'url', dbtableType: 'type', dbtableExt: 'ext',
    dbtableProcess: 'process', dbtableQuery: 'query', dbtableObj: 'obj', datacache: 'cache',
  };
  // Every project key the engine would turn into code (new Function)
  // is kept out, never run — a page's own .data({process, query}) and
  // .style({colorscheme: fn.toString()}) still run. Project keys of
  // that kind: the data processing function (data.process /
  // style.dbtableProcess), the broker query (data.query /
  // style.dbtableQuery — without it a data.name still reaches a
  // provider the PAGE defined as ixmaps[name]) and a colorscheme given
  // as a string, which resolveColorScheme evaluates as a function
  // (an array colorscheme is data and stays).
  const PROJECT_CODE_KEYS = [
    ['data', 'process', 'data.process function'],
    ['style', 'dbtableProcess', 'data.process function'],
    ['data', 'query', 'data.query function'],
    ['style', 'dbtableQuery', 'data.query function'],
    ['style', 'colorscheme', 'colorscheme function', v => typeof v === 'string'],
  ];
  function withoutProjectCode(t, report) {
    const found = PROJECT_CODE_KEYS.filter(([part, key, , isCode]) =>
      t[part] && t[part][key] != null && (!isCode || isCode(t[part][key])));
    if (!found.length) return t;
    const copy = Object.assign({}, t);
    found.forEach(([part, key]) => {
      if (copy[part] === t[part]) copy[part] = Object.assign({}, t[part]);
      delete copy[part][key];
    });
    const what = [...new Set(found.map(f => f[2]))].join(', ');
    report.notes.push(`theme "${t.layer}": the project's ${what} is never run by ixmaps-gl`);
    return copy;
  }

  function projectThemeToDefinition(theme) {
    const t = theme || {};
    const style = Object.assign({}, t.style);
    const data = {};
    for (const [k, dk] of Object.entries(PROJECT_DATA_KEYS)) {
      if (style[k] !== undefined) { data[dk] = style[k]; delete style[k]; }
    }
    // "name type (url) (ext)" (maptheme.js MapTheme style parsing)
    if (typeof data.name === 'string' && data.name.includes(' ')) {
      const a = data.name.split(' ');
      const inParens = x => (x && x.includes('(') ? x.split('(')[1].split(')')[0] : undefined);
      data.name = a[0];
      if (a.length === 2) { data.type = 'jsonDB'; data.url = inParens(a[1]); }
      if (a.length >= 3) { data.type = a[1]; data.url = inParens(a[2]); }
      if (a.length >= 4) data.ext = inParens(a[3]);
    }
    const modern = Object.assign({}, t.data);
    if (modern.data !== undefined && modern.obj === undefined) modern.obj = modern.data; // flat: "data" aliases "obj"
    delete modern.data;
    const field = modern.field !== undefined ? modern.field : t.field;
    const field100 = modern.field100 !== undefined ? modern.field100 : t.field100;
    delete modern.field;
    delete modern.field100;
    Object.assign(data, modern);
    if (t.type) style.type = t.type;
    const def = { layer: t.layer, data: Object.keys(data).length ? data : undefined, binding: t.binding, style, meta: t.meta };
    if (field !== undefined) def.field = field;
    if (field100 !== undefined) def.field100 = field100;
    return def;
  }

  // ---------------------------------------------------------------
  // Theme normalization — the ONE place a theme definition (real
  // ixmaps-flat's shape: {layer, data, binding, style: {type, filter,
  // title, ...}, meta}, see LayerBuilder.definition) becomes what the
  // renderers read. Every alias/implication rule lives here instead of at
  // the call sites where each gap happened to show up:
  //   - type string → flag Set; BUBBLE implies SYMBOL (real flat's base
  //     chart flag is BUBBLE; this engine's CHART pipeline keys on SYMBOL)
  //   - every flat binding alias → its target (see FLAT_BINDING_ALIASES /
  //     GL_BINDING_TARGETS), also when given as a style key, flat's order
  //   - geo/position/lookup/georef/lookupfield/... (flat's single
  //     lookupfield) → binding.position (points / embedded geometry) or
  //     binding.lookup (join key), by flat's rule (resolveGeometryBinding)
  //   - .meta() merged into style first (meta wins), as flat does
  //   - the meta vocabulary (title, tooltip, name, snippet, description)
  //     given in style fills meta; .title() is style.title in flat too
  //   - style.type/filter/title are taken out of style, so rt.style holds
  //     only real style properties
  // Pure: returns new objects and never mutates the caller's definition
  // (the page's own binding/style/meta objects stay untouched).
  // Style keys this engine reads as numbers. A string that is a complete
  // number ("0.8", " 12 ") becomes that number ONCE — here, for every theme,
  // and in LayerRuntime.setStyle for runtime patches (legend sliders,
  // setThemeStyle) — so read sites get numbers and don't parse. Anything
  // else stays as given: flat gives "auto", "12px", … their own meaning.
  // (flat stores most of these as given and lets arithmetic coerce them;
  // its runtime changeThemeStyle applies Number() — the same result for
  // every clean value.) A linewidth list is typed element by element.
  const STYLE_NUMBER_KEYS = ['linewidth', 'fillopacity', 'scale', 'classes', 'valuedecimals', 'normalsizevalue',
    'sizepow', 'rangescale', 'minvalue', 'maxvalue', 'markersize', 'boxopacity', 'outlierscale', 'valuescale',
    'brightness', 'fractionscale', 'dopacityscale', 'dopacitypow', 'gridwidthpx', 'textscale', 'rangecentervalue',
    'shadowblur', 'shadowdx', 'shadowdy', 'maxshadow', 'offsetx', 'offsety', 'gridx', 'boxmargin', 'borderwidth',
    'borderradius'];
  function toNumberIfNumeric(v) {
    if (typeof v !== 'string' || !v.trim()) return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  // types STYLE_NUMBER_KEYS of `style` in place (callers pass their own copy)
  function typeStyleNumbers(style) {
    for (const k of STYLE_NUMBER_KEYS) {
      if (!(k in style)) continue;
      const v = style[k];
      style[k] = Array.isArray(v) ? v.map(toNumberIfNumeric) : toNumberIfNumeric(v);
    }
    return style;
  }
  // read side of a typed key: the number, a list's first number, else NaN
  // (so `styleNum(style.x) || default` and isNaN checks work as before)
  function styleNum(v) {
    if (Array.isArray(v)) v = v[0];
    return typeof v === 'number' ? v : NaN;
  }

  function normalizeTheme(def) {
    // real ixmaps-flat (htmlgui.js newTheme) merges .meta() INTO style first
    // — meta wins — and only then reads type, bindings and style properties
    const style = Object.assign({}, def.style, def.meta);
    const typeStr = style.type != null ? String(style.type) : '';
    const filter = style.filter;
    const title = style.title;
    delete style.type;
    delete style.filter;
    delete style.title;

    const flags = new Set(typeStr ? typeStr.split('|') : []);
    if (flags.has('BUBBLE')) flags.add('SYMBOL');
    // flat tests its base type as a substring (szFlag.match(/CHOROPLETH/)),
    // so "CHOROPLETHE" is a choropleth there too
    if (!flags.has('CHOROPLETH') && [...flags].some(f => f.includes('CHOROPLETH'))) flags.add('CHOROPLETH');
    // flat's word tests (\bCHOROPLETH\b, e.g. the legend sliders) read
    // the type as written
    Object.defineProperty(flags, 'typeString', { value: typeStr });
    flags.forEach(flag => {
      if (KNOWN_INERT_FLAGS.includes(flag) && !_warnedFlags.has(flag)) {
        _warnedFlags.add(flag);
        console.info(`[ixmaps-gl] type flag "${flag}" recognized, no distinct rendering behavior implemented yet`);
      }
    });

    const rawBinding = Object.assign({}, def.binding);
    const targets = resolveBindingTargets(style, rawBinding, def);
    // every original key is kept (position/lookup/geo, and keys flat ignores);
    // implemented targets are then written under this engine's own names
    const binding = rawBinding;
    for (const [t, target] of Object.entries(GL_BINDING_TARGETS)) {
      if (!target || targets[t] === undefined) continue;
      // "$item$" is flat's "no value field — count the items"; this engine
      // counts records whenever no value field is bound (targets keeps it)
      if (t === 'theme.field' && targets[t] === '$item$') continue;
      const [where, name] = target;
      (where === 'binding' ? binding : style)[name] = targets[t];
    }
    // flat has ONE lookupfield; this engine reads it as either position or
    // lookup — set exactly one of them, never both
    let geometry = null;
    if (targets[LOOKUPFIELD_TARGET] !== undefined) {
      geometry = resolveGeometryBinding(targets[LOOKUPFIELD_TARGET], def.data);
      delete binding.position;
      delete binding.lookup;
      binding[geometry.kind === 'join' ? 'lookup' : 'position'] = geometry.field;
    }

    // the meta vocabulary is readable from either side: a meta key given in
    // .style() (or via .title(), which flat also stores as style.title) fills
    // meta; an explicit .meta() value wins
    const meta = Object.assign({}, def.meta);
    if (title && !meta.title) meta.title = title;
    for (const k of FLAT_META_KEYS) {
      if (k !== 'title' && meta[k] == null && style[k] != null) meta[k] = style[k];
    }

    typeStyleNumbers(style);
    return { name: def.layer, data: def.data, binding, targets, geometry, flags, typeStr, style, meta, filter };
  }

  // ---------------------------------------------------------------
  // Splash screen — shown the instant ixmaps.Map() is called (covering
  // both library lazy-loading and this layer's own data fetch, real-
  // world verified as the two slowest phases: a >1.2M-row CSV source
  // alone took >15s in this engine's own German accidents demo), hidden
  // once MapLibre's own 'load' event fires (by which point every
  // layer's data has already finished loading too, since build()'s data
  // loop runs and is awaited BEFORE the MapLibre map itself is even
  // constructed — see MapBuilder.build()). One shared <style> tag
  // injected once regardless of how many maps a page creates.
  // ---------------------------------------------------------------
  let _splashStyleInjected = false;
  function ensureSplashStyle() {
    if (_splashStyleInjected) return;
    _splashStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .ixmaps-splash {
        position: absolute; inset: 0; z-index: 2000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 0.9em; background: #fafafa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        opacity: 1; transition: opacity 0.4s ease;
      }
      .ixmaps-splash.ixmaps-splash-hidden { opacity: 0; pointer-events: none; }
      .ixmaps-splash-mark { position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }
      .ixmaps-splash-ping {
        position: absolute; width: 16px; height: 16px; border-radius: 50%;
        background: #0088dd; animation: ixmaps-splash-ping 1.6s cubic-bezier(0,0,0.3,1) infinite;
      }
      .ixmaps-splash-dot { position: relative; width: 16px; height: 16px; border-radius: 50%; background: #0088dd; }
      .ixmaps-splash-word { font-size: 1.3em; font-weight: 600; letter-spacing: 0.01em; color: #222; }
      .ixmaps-splash-word sup { font-size: 0.6em; font-weight: 500; color: #0088dd; margin-left: 0.05em; }
      .ixmaps-splash-text { font-size: 0.8em; color: #888; min-height: 1.2em; }
      @keyframes ixmaps-splash-ping {
        0% { transform: scale(1); opacity: 0.7; }
        100% { transform: scale(2.6); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  // the data-loading message (see setDataLoading)
  function ensureLoadingStyle() {
    if (typeof document === 'undefined' || document.getElementById('ixmaps-gl-loading-style')) return;
    const style = document.createElement('style');
    style.id = 'ixmaps-gl-loading-style';
    style.textContent = `
      .ixmaps-gl-loading { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:7;
        display:flex; align-items:center; gap:10px; padding:10px 16px; border-radius:8px; pointer-events:none;
        background:rgba(255,255,255,0.9); box-shadow:0 2px 10px rgba(0,0,0,0.18);
        font:14px/1.2 -apple-system,Arial,sans-serif; color:#333; }
      .ixmaps-gl-loading-spin { width:18px; height:18px; border-radius:50%; border:3px solid rgba(46,125,230,0.25);
        border-top-color:#2e7de6; animation:ixmaps-gl-spin 0.8s linear infinite; }
      @keyframes ixmaps-gl-spin { to { transform:rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }
  // flat's Dictionary.getLocalText (mapscript.js 5631-5648) over the page's
  // .local(text, translation) pairs: the whole text, else word by word
  // (a word's entry is written in quotes, 'word')
  function makeLocalText(locals) {
    const dict = {};
    (locals || []).forEach(a => {
      if (a && typeof a[0] === 'object' && a[0]) Object.assign(dict, a[0]);
      else if (a && a.length >= 2) dict[a[0]] = a[1];
    });
    return text => {
      if (dict[text] !== undefined) return String(dict[text]);
      return String(text).split(' ').map(w => (dict["'" + w + "'"] !== undefined ? String(dict["'" + w + "'"]) : w)).join(' ');
    };
  }
  function showSplash(el, text) {
    ensureSplashStyle();
    // Checks the actual RENDERED position, not el.style (the inline
    // attribute only) — every example page's own #map_div already sets
    // position:absolute via a real stylesheet rule, not inline, so
    // `el.style.position` reads as empty regardless and would always
    // "win" the `||` fallback, overwriting that CSS rule with an inline
    // position:relative. Confirmed live as a real, not hypothetical, bug:
    // position:relative does NOT give top/bottom:0 the same "stretch to
    // fill" meaning position:absolute does, so the container's computed
    // height silently collapsed to 0 — invisible map, invisible splash,
    // both zero-height. Only truly static (unpositioned) elements need
    // this at all.
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const splash = document.createElement('div');
    splash.className = 'ixmaps-splash';
    splash.innerHTML = '<div class="ixmaps-splash-mark"><span class="ixmaps-splash-ping"></span><span class="ixmaps-splash-dot"></span></div>' +
      '<div class="ixmaps-splash-word">ixmaps<sup>gl</sup></div>' +
      '<div class="ixmaps-splash-text"></div>';
    splash.querySelector('.ixmaps-splash-text').textContent = text || '';
    el.appendChild(splash);
    return splash;
  }
  function hideSplash(splash) {
    if (!splash || !splash.parentNode) return;
    splash.classList.add('ixmaps-splash-hidden');
    setTimeout(() => splash.parentNode && splash.parentNode.removeChild(splash), 500);
  }

  // GL-PORT COMPAT: real ixmaps-flat's `mapType` doubles as a real basemap
  // NAME ("VT_TONER_LITE", "CartoDB - Dark matter", ...) or a literal
  // background COLOR (any hex string, or "black"/"white"/"dark") — see
  // create-ixmap skill: "Set mapType to the background/sea color instead
  // of using CSS... Do not use mapType:'white' + CSS background — set it
  // directly in mapType." A color mapType means the real engine draws NO
  // tile layer at all (this is standard for every SVG-projection map —
  // equalearth/orthographic/lambert/etc. — which have no Mercator tiles
  // to show in the first place). This engine's own map surface is always
  // a MapLibre GL instance, though, so "no tile layer" has to be built
  // explicitly rather than just being the absence of a Leaflet tile
  // layer: an empty-sources style with one plain `background` paint
  // layer reproduces the same visual result (solid color, no network
  // fetch, no basemap attribution) without special-casing every
  // downstream deck.gl/picking/opacity code path that only knows how to
  // talk to "the current MapLibre style".
  const BLANK_BACKGROUND_LAYER_ID = '__ixmaps_gl_blank_background';
  const NAMED_MAPTYPE_COLORS = { dark: '#1a1a1a', black: '#000000', white: '#ffffff' };
  function resolveMapTypeColor(mapType) {
    if (typeof mapType !== 'string') return null;
    const t = mapType.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return t;
    const named = NAMED_MAPTYPE_COLORS[t.toLowerCase()];
    return named || null;
  }
  // A basemap NAME (flat's mapType: "VT_TONER_LITE", "VT_DATAVIZ_DARK",
  // "CartoDB - Dark matter", ...) picks one of two keyless CARTO vector
  // styles: dark for a name reading dark/black/night/matter, otherwise
  // light (Positron, gl's default). A color mapType (resolveMapTypeColor)
  // is a plain background instead and wins, so "dark" alone stays the
  // #1a1a1a background it always was.
  const BASEMAP_STYLE_URLS = {
    light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  };
  function resolveBasemapStyleUrl(mapType) {
    return typeof mapType === 'string' && /dark|black|night|matter/i.test(mapType) ? BASEMAP_STYLE_URLS.dark : BASEMAP_STYLE_URLS.light;
  }
  // Real ixmaps-flat's legend look (tools/legend.js 3773-3845, via
  // tools/background_theme.js): DARK when the basemap is more than half
  // opaque and the map background reads as dark — a map type naming
  // satellite/dark/black, or a CSS color of relative luminance < 0.45
  // (semi-transparent colors blended against white first) — on the CSS
  // color itself, else #111; otherwise LIGHT, on the map's CSS color if it
  // is one, else rgba(255,255,255,0.9). legendBackground (map option)
  // goes through the same test, as flat passes it to the same function.
  // One deliberate difference: on a CSS-color background, flat keeps its
  // light-legend (dark) text even when the color is dark (a dark color with
  // the basemap faded to ≤ 0.5 — unreadable); here the text follows the
  // color's own brightness. Returns { dark, bg } (dark: light text).
  const FLAT_MAPTYPE_PATTERN = /dark|light|satellite|street|toner|positron|terrain|osm|mapbox|stamen|arcgis|carto|openstreetmap|maptiler|gray|grey|white|black|transparent|topo|ocean|basic|bright|dataviz|voyager/i;
  function flatIsCssColorValue(id) {
    if (typeof id !== 'string' || !id.trim()) return false;
    const t = id.trim();
    if (/^#([0-9a-f]{3,8})$/i.test(t) || /^(rgba?|hsla?)\(/i.test(t) || /^(none|transparent)$/i.test(t)) return true;
    return /^[a-zA-Z]+$/.test(t) && !FLAT_MAPTYPE_PATTERN.test(t);
  }
  function flatIsDarkColor(c) {
    const m = String(c).trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?/i);
    let rgb = m ? [+m[1], +m[2], +m[3]] : parseCssColor(c);
    if (!rgb) return false;
    const a = m && m[4] !== undefined ? +m[4] : 1;
    if (a < 1) rgb = rgb.map(v => Math.round(v * a + 255 * (1 - a)));
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]) < 0.45;
  }
  function flatIsDarkMapBackground(id) {
    if (typeof id !== 'string' || !id) return false;
    if (/satellite/i.test(id) || /^black$/i.test(id.trim())) return true;
    if (flatIsCssColorValue(id)) return flatIsDarkColor(id);
    return /dark|black/i.test(id);
  }
  function flatLegendLook(mapType, basemapOpacity, legendBackground) {
    const id = legendBackground || mapType;
    const isColor = flatIsCssColorValue(id);
    const isDark = flatIsDarkMapBackground(id);
    if (!(basemapOpacity <= 0.5) && isDark) return { dark: true, bg: isColor ? id : '#111' };
    if (isColor) return { dark: isDark, bg: id };
    return { dark: false, bg: 'rgba(255,255,255,0.9)' };
  }

  function buildBlankBackgroundStyle(color) {
    return {
      version: 8,
      sources: {},
      layers: [{ id: BLANK_BACKGROUND_LAYER_ID, type: 'background', paint: { 'background-color': color } }]
    };
  }

  // ---------------------------------------------------------------
  // flat's map attribution (ui/html/mappage.html #attribution-div): the
  // page's text bottom left on the map; hidden while empty ("null" counts
  // as empty, htmlgui_flat.js 522-526). Here a MapLibre control in the
  // bottom-left corner, styled like MapLibre's own attribution (the
  // basemap credit, bottom right — same line, same pill: white, 12px
  // radius, 12px/20px Helvetica Neue, links rgba(0,0,0,0.75)).
  // ---------------------------------------------------------------
  let _attributionCss = false;
  function createAttribution(map) {
    if (!_attributionCss && typeof document !== 'undefined') {
      _attributionCss = true;
      const css = document.createElement('style');
      css.textContent = '.ixmaps-gl-attribution a{color:rgba(0,0,0,0.75);text-decoration:none}'
        + '.ixmaps-gl-attribution a:hover{color:inherit;text-decoration:underline}';
      document.head.appendChild(css);
    }
    const box = document.createElement('div');
    box.className = 'maplibregl-ctrl ixmaps-gl-attribution';
    box.style.cssText = 'background:#fff;border-radius:12px;padding:2px 8px;min-height:20px;box-sizing:content-box;'
      + 'font:12px/20px "Helvetica Neue",Arial,Helvetica,sans-serif;color:#000;display:none;';
    map.addControl({ onAdd: () => box, onRemove: () => box.remove() }, 'bottom-left');
    let text = '';
    return {
      set(t) {
        text = t == null || t === 'null' ? '' : String(t);
        box.innerHTML = text;
        box.style.display = text ? 'block' : 'none';
      },
      get() { return text; }
    };
  }

  // ---------------------------------------------------------------
  // Embedded YouTube players in tooltips (data fields carrying <iframe
  // src=".../embed/ID">) are replaced by a thumbnail with a play button; the
  // real iframe is created on click. Keeps tooltips light, and a removed
  // video or a refused embed (e.g. error 153 on file:// pages) degrades to a
  // thumbnail that opens YouTube in a new tab instead of a broken player.
  const YT_IFRAME_RE = /<iframe\b[^>]*?\bsrc\s*=\s*["']?(?:https?:)?\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})[^"'\s>]*["']?[^>]*>\s*<\/iframe>/gi;
  function youtubeClickToPlay(html) {
    if (!html || html.indexOf('youtube') < 0) return html;
    return html.replace(YT_IFRAME_RE, (m, id) => {
      const w = (/\bwidth\s*=\s*["']?(\d+)/i.exec(m) || [])[1] || 240;
      const h = (/\bheight\s*=\s*["']?(\d+)/i.exec(m) || [])[1] || 180;
      return '<div class="ixgl-yt" data-yt="' + id + '" data-w="' + w + '" data-h="' + h + '" ' +
        'style="position:relative;width:' + w + 'px;height:' + h + 'px;cursor:pointer;background:#000 url(https://i.ytimg.com/vi/' + id + '/hqdefault.jpg) center/cover" ' +
        'title="play"><span style="position:absolute;left:50%;top:50%;width:48px;height:34px;margin:-17px 0 0 -24px;' +
        'border-radius:8px;background:rgba(220,0,0,0.9)"></span><span style="position:absolute;left:50%;top:50%;margin:-9px 0 0 -6px;' +
        'border-style:solid;border-width:9px 0 9px 15px;border-color:transparent transparent transparent #fff"></span></div>';
    });
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && !global.__ixglYtClick) {
    global.__ixglYtClick = true;
    document.addEventListener('click', e => {
      const el = e.target.closest && e.target.closest('.ixgl-yt');
      if (!el) return;
      e.stopPropagation();
      const f = document.createElement('iframe');
      f.width = el.dataset.w; f.height = el.dataset.h; f.frameBorder = '0';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.src = 'https://www.youtube.com/embed/' + el.dataset.yt + '?autoplay=1&rel=0';
      el.replaceWith(f);
    }, true);
  }

  // Hover tooltips and the click-to-pin tooltip of a map, built once per map
  // by MapBuilder.build(). ctx: the builder (its map options, for the
  // tooltip look), the MapLibre map, its container element and
  // findRuntimeForLayerId (the theme of a drawn deck.gl layer). Returns the
  // overlay's getTooltip / onClick handlers and mount(), which adds the
  // pinned tooltip to the page and keeps it on its place while the map moves.
  // ---------------------------------------------------------------
  function createTooltips(ctx) {
    const { builder, map, el, findRuntimeForLayerId } = ctx;
    // Click-to-pin tooltip: matches the real ixmaps engine's own
    // click-pins-the-tooltip convention in pan mode (a hover tooltip is
    // transient; a click keeps one visible until dismissed). This is a
    // separate DOM element from deck.gl's own hover tooltip (so hovering
    // a DIFFERENT bubble still shows a normal transient tooltip even
    // while one is pinned) — its content is a snapshot of buildTooltipHtml
    // at click time (not live-updating), but its screen POSITION is kept
    // in sync with the map on every pan/zoom via map.project().
    let pinned = null; // { runtime, object, lngLat }
    // Tooltip look, like the legend's (flatLegendLook): flat's light
    // tooltip (tooltip_mustache.js: white 0.95, #444 text, thin black
    // border, 5px radius) on light basemaps, this engine's dark tooltip
    // on dark ones. Read when shown, so options set later (a
    // myMap.then(...).options({basemapopacity})) count.
    const tooltipLook = () => {
      const o = parseFloat(builder._engineOptions.basemapopacity);
      const look = flatLegendLook(builder.mapOptions.mapType, isNaN(o) ? 1 : o, builder.mapOptions.legendBackground || builder.mapOptions.legendbackground);
      return look.dark
        ? { background: 'rgb(41,50,60)', color: 'rgb(200,205,214)', border: 'none', borderRadius: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }
        : { background: 'rgba(255,255,255,0.95)', color: '#444', border: '0.5px solid black', borderRadius: '5px',
            boxShadow: 'rgba(0,0,0,0.2) 0px 2px 4px 0px, rgba(0,0,0,0.19) 0px 3px 10px 0px' };
    };
    const pinnedTooltipEl = document.createElement('div');
    pinnedTooltipEl.style.cssText = 'position:absolute;top:0;left:0;z-index:6;display:none;' +
      'pointer-events:auto;max-width:440px;max-height:360px;overflow:auto;' +
      'padding:0.6em 1.6em 0.6em 0.7em;font-size:1em;';

    function updatePinnedTooltipPosition() {
      if (!pinned) return;
      const pt = map.project(pinned.lngLat);
      pinnedTooltipEl.style.transform = `translate(${pt.x + 10}px, ${pt.y - 10}px)`;
    }

    // A stable per-geometry anchor coordinate for the identity check
    // below — only a Point's OWN coordinates are an [lng,lat] pair;
    // Polygon/MultiPolygon nest rings of them, so the first ring's
    // first vertex stands in instead (stable across rebuilds for the
    // same underlying feature, same as the Point case: this.features'
    // geometry references don't change shape between
    // _buildChoroplethLayers calls, only the wrapping properties do).
    function anchorCoordOf(geometry) {
      if (!geometry) return null;
      if (geometry.type === 'Point') return geometry.coordinates;
      if (geometry.type === 'Polygon') return geometry.coordinates[0] && geometry.coordinates[0][0];
      if (geometry.type === 'MultiPolygon') return geometry.coordinates[0] && geometry.coordinates[0][0] && geometry.coordinates[0][0][0];
      return null;
    }

    // Identity check for "is this hovered object the same one that's
    // pinned" — object references are rebuilt from scratch on every
    // redraw (new individual/group arrays each buildDeckLayers call), so
    // reference equality never works here. Same layer + same geometry
    // position is a reasonable proxy: individual points and aggregated
    // groups alike are keyed by position within a layer, matching how
    // clustering itself already treats "same position" as "same thing".
    function isSameAsPinned(layerId, object) {
      if (pinned.layerId !== layerId) return false;
      const a = anchorCoordOf(object.geometry);
      const b = anchorCoordOf(pinned.object.geometry);
      if (!a || !b) return false;
      return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    }

    // content lives in its own child so re-rendering (innerHTML) never
    // wipes out the unpin button below (a sibling, not a descendant of it)
    const pinnedContentEl = document.createElement('div');
    pinnedTooltipEl.appendChild(pinnedContentEl);

    function renderPinnedTooltip() {
      if (!pinned) { pinnedTooltipEl.style.display = 'none'; return; }
      const html = pinned.runtime.buildTooltipHtml(pinned.object);
      if (!html) { pinned = null; pinnedTooltipEl.style.display = 'none'; return; }
      pinnedContentEl.innerHTML = html;
      Object.assign(pinnedTooltipEl.style, tooltipLook());
      pinnedTooltipEl.style.display = 'block';
      updatePinnedTooltipPosition();
    }

    const unpinBtn = document.createElement('button');
    unpinBtn.type = 'button';
    unpinBtn.setAttribute('aria-label', 'chiudi');
    unpinBtn.title = 'chiudi';
    unpinBtn.textContent = '×';
    unpinBtn.style.cssText = 'position:absolute;top:5px;right:5px;width:1.5em;height:1.5em;padding:0;' +
      'display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;' +
      'background:rgba(255,255,255,0.18);color:inherit;font-size:1em;line-height:1;font-weight:bold;cursor:pointer';
    unpinBtn.addEventListener('mouseenter', () => { unpinBtn.style.background = 'rgba(255,255,255,0.35)'; });
    unpinBtn.addEventListener('mouseleave', () => { unpinBtn.style.background = 'rgba(255,255,255,0.18)'; });
    unpinBtn.addEventListener('click', () => { pinned = null; pinnedTooltipEl.style.display = 'none'; });
    pinnedTooltipEl.style.position = 'absolute';
    pinnedTooltipEl.appendChild(unpinBtn);

    // deck.gl's own default hover tooltip is only recomputed on pointer-
    // move events, not on click — so right after a click, it's still
    // showing whatever it rendered from the hover that was already
    // active (the same item we just pinned), and won't hide itself just
    // because getTooltip would now return null for it. Nothing re-asks
    // it until the next real mousemove. Force it closed here instead —
    // deferred one frame so it wins even if deck.gl's own click handling
    // touches the tooltip DOM in the same tick.
    function hideDefaultHoverTooltip() {
      requestAnimationFrame(() => {
        const defaultTooltipEl = el.parentElement && el.parentElement.querySelector('.deck-tooltip');
        if (defaultTooltipEl) defaultTooltipEl.style.display = 'none';
      });
    }

    let tooltipErrorLogged = false;
    // a USER chart's picked item is {d, icon} (see _buildUserChartLayers):
    // the feature is its d
    function pickedFeature(o) { return o && o.icon && o.d ? o.d : o; }
    function tooltipFor({ object: picked, layer }) {
        const object = pickedFeature(picked);
        if (!object || !layer) return null;
        // suppress the hover tooltip ONLY for the specific item that's
        // pinned (showing both would just duplicate the same content) —
        // every OTHER item still gets its normal hover preview even
        // while something else stays pinned
        if (pinned && isSameAsPinned(layer.id, object)) return null;
        const rt = findRuntimeForLayerId(layer.id);
        if (!rt) return null;
        const html = rt.buildTooltipHtml(object);
        return html ? { html, style: Object.assign({ fontSize: '1em', padding: '0.5em 0.7em', maxWidth: '440px' }, tooltipLook()) } : null;
    }
    function clickFor(picked) {
        const info = picked && Object.assign({}, picked, { object: pickedFeature(picked.object) });
        if (info && info.object && info.layer) {
          const rt = findRuntimeForLayerId(info.layer.id);
          if (rt) {
            // Only a Point geometry's own coordinates ARE an
            // [lng,lat] pair (every point/bubble/dot/chart-cluster
            // layer) — a CHOROPLETH polygon's geometry.coordinates is
            // a nested array of RINGS, which map.project() below
            // can't accept (confirmed live: threw MapLibre's own
            // "LngLatLike argument must be..." error). The `||
            // info.coordinate` fallback this used to lean on never
            // actually ran for a polygon — a nested array is truthy,
            // so the left side always "won" — which is the real bug
            // this fixes: the pinned tooltip stuck at its default
            // top:0/left:0 (never got a real position because
            // updatePinnedTooltipPosition's map.project() threw
            // before setting one), AND that same uncaught exception,
            // thrown from inside deck.gl's own click-dispatch
            // callback, left deck.gl's pointer-interaction state
            // corrupted enough to block all further pan/zoom —
            // confirmed live, both symptoms disappear together once
            // this stops throwing. info.coordinate (the actual
            // clicked map location, provided regardless of feature
            // geometry type) anchors every non-Point case correctly.
            const lngLat = (info.object.geometry && info.object.geometry.type === 'Point')
              ? info.object.geometry.coordinates
              : info.coordinate;
            pinned = { runtime: rt, object: info.object, lngLat, layerId: info.layer.id };
            renderPinnedTooltip();
            hideDefaultHoverTooltip();
            return true;
          }
        }
        // clicked empty map space (or a non-tooltippable layer) -> unpin
        pinned = null;
        pinnedTooltipEl.style.display = 'none';
        return false;
    }
    // An exception thrown from these callbacks runs inside deck.gl's
    // own render frame / event dispatch and leaves its frame and
    // interaction state broken — the map stopped showing new layers
    // after zooms and pans (a USER chart's hover threw on every frame
    // the mouse was over an arrow, see pickedFeature). Both are guarded.
    function getTooltip(info) {
      try { return tooltipFor(info); } catch (err) {
        if (!tooltipErrorLogged) { tooltipErrorLogged = true; console.error('[ixmaps-gl] tooltip failed:', err); }
        return null;
      }
    }
    function onClick(info) {
      try { return clickFor(info); } catch (err) {
        console.error('[ixmaps-gl] click failed:', err);
        return false;
      }
    }
    function mount() {
      map.on('move', updatePinnedTooltipPosition);
      if (el.parentElement) {
        el.parentElement.style.position = el.parentElement.style.position || 'relative';
        el.parentElement.appendChild(pinnedTooltipEl);
      }
    }
    return { getTooltip, onClick, mount };
  }

  // ---------------------------------------------------------------
  // The map's native interactive legend, built once per map by
  // MapBuilder.build(). ctx: the builder (its map options), the MapLibre
  // map, its container element, the deck.gl overlay, the runtimes, the
  // engine API and its refresh hooks. Returns the four hooks the map
  // calls: addLegendPanel(rt), setLegendOption(value), updateSubTheme(rt),
  // layoutLegends().
  // ---------------------------------------------------------------
  function createLegend(ctx) {
    const { builder, map, el, overlay, runtimes, engineApi, built, refresh, scheduleRefresh, notifyRedraw } = ctx;
    let addLegendPanel = () => {};
    let setLegendOption = () => {};
    let updateSubTheme = () => {};
    let layoutLegends = () => {};

    // NATIVE INTERACTIVE LEGEND — real ixmaps-flat's legend.js
    // (makeColorLegendHTMLLong) builds, per CATEGORICAL-ish theme: a
    // title/snippet header, one row per category (color swatch + a bar
    // proportional to that category's own total + right-aligned
    // formatted value), a description/source footer, and a per-theme
    // "Chart size" 25-200% slider — all read directly off source
    // (ui/js/tools/legend.js:594-1037/3196-3393, ui/js/htmlgui.js:2196/
    // 2208 for markThemeClass/unmarkThemeClass, ui/css/legend.css for
    // the selected-row highlight) rather than guessed from the
    // screenshot alone. Gated on `legend:"open"` — the one real map
    // option this engine's own createMap already threads through as
    // builder.mapOptions (see mapOptions.legend below) — since there's no
    // toolbar toggle button here to open/close it later the way the
    // real engine's own chrome does.
    //
    // Deliberate divergences from the real implementation, both
    // reasoned rather than accidental:
    //   - Real legend.js does a full innerHTML rebuild on every single
    //     theme redraw (even a bare click-toggle). renderRows() below
    //     only rebuilds the ROWS (swatch/bar/value/highlight) — cheap,
    //     and the only part that can actually change post-load (marks,
    //     or an AGGREGATE theme's dataset-wide totals, which this port
    //     doesn't yet let change post-load anyway) — rather than
    //     tearing down and rebuilding title/snippet/description/slider
    //     too, which never change. Same visible result, less DOM churn.
    //   - Real "isolate_gray" mode dims non-marked SVG paths via a CSS
    //     class; this engine dims via IconLayer's own getColor alpha
    //     (see LayerRuntime#_iconAlpha) since these are deck.gl raster
    //     icons, not DOM/SVG nodes a CSS rule could reach.
    // Legend on/off and fold state as real ixmaps-flat reads the map
    // option (htmlgui_flat.js:748-794): on whenever `legend` is given and
    // isn't false/"false" ("true", "open", "", 1, …), folded for
    // "closed", off when not given at all.
    const legendOpt = builder.mapOptions.legend;
    // let, not const: map.setLegend(value) switches them at runtime (see setLegendOption)
    let legendOn = legendIsOn(legendOpt);
    let legendFolded = legendOpt === 'closed';
    {
      // Map-level `align` option positions the legend panel — a map-
      // wide placement choice, not per-theme (unlike legendtheme/
      // legendfilter above), so read once from builder.mapOptions rather
      // than per-runtime. Real ixmaps-flat ALSO has an `align` map
      // option (ui/js/htmlgui_flat.js) controlling legend position, but
      // its value shape is a free-form regex-matched left/right/center/
      // top/bottom/pixel-prefixed string tied to a static in-page DOM
      // panel — a different layout model from this panel's own
      // position:absolute floating-overlay-over-the-map-canvas
      // approach. This port reuses the real OPTION NAME but adapts the
      // VALUE SHAPE to plain four-corner tokens matching how this panel
      // is actually positioned — a deliberate divergence, same
      // reasoning already applied to style.legendfilter's own name/
      // shape choice earlier this session. Default "top-right" per
      // explicit request (real engine's own fallback is right-anchored
      // too, just without an opinion on vertical placement).
      const ALIGN_CSS = {
        'top-left': 'left:10px;top:10px;',
        'top-right': 'right:10px;top:10px;',
        'bottom-left': 'left:10px;bottom:10px;',
        'bottom-right': 'right:10px;bottom:10px;'
      };
      // gl's four corners, else flat's own values (htmlgui_flat.js
      // 421-470): "…left" → left (the part before "left", else 55px), 12px
      // from the top; "…right" → right (else 25px); "center" / "top" → top
      // center
      const flatAlignCss = align => {
        const a = String(align || '');
        if (/left/.test(a)) return 'left:' + (a.split('left')[0] || '55px') + ';top:12px;';
        if (/right/.test(a)) return 'right:' + (a.split('right')[0] || '25px') + ';top:10px;';
        if (a === 'center' || a === 'top') return 'left:50%;transform:translateX(-50%);top:10px;';
        return null;
      };
      const legendAlignCss = ALIGN_CSS[builder.mapOptions.align] || flatAlignCss(builder.mapOptions.align) || ALIGN_CSS['top-right'];
      // Real ixmaps-flat's SUB-THEME (MapTheme.createSubTheme,
      // maptheme.js 14284-14292 / 15010-15160; map.Themes.enableSubThemes
      // defaults to true): marking fields of a multi-field choropleth
      // (DOMINANT/COMPOSECOLOR, not CHART) paints a new theme over the
      // original — one field: CHOROPLETH|LOG|DOPACITY on that field, white
      // → the field's color in 7 steps, dopacityscale 2, dopacitypow 1,
      // keeping DOPACITY(→DOPACITYMAX)/AGGREGATE/GROUP/SUM/ZEROISVALUE/
      // VALUES; several fields: the original type on just those fields
      // and colors. It reuses the original's joined polygons, has no
      // legend and stays out of the theme registry (its name
      // "<layer>::subtheme" also keeps its deck.gl layer id apart), so
      // markThemeClass/removeTheme still address the original.
      const subThemeCapable = rt => rt.flags.has('CHOROPLETH') && !rt.flags.has('CHART') && (rt.flags.has('DOMINANT') || rt.flags.has('COMPOSECOLOR'));
      const toHex = c => Array.isArray(c) ? '#' + c.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('') : c;
      updateSubTheme = (rt) => {
        if (rt._subTheme) {
          const i = runtimes.indexOf(rt._subTheme);
          if (i >= 0) runtimes.splice(i, 1);
          rt._subTheme = null;
        }
        const fields = String(rt.binding.value || '').split('|');
        const marks = [...rt._markedClasses].filter(i => i >= 0 && i < fields.length).sort((a, b) => a - b);
        if (marks.length) {
          const colors = (rt.categoryColorsRgb || []).map(toHex);
          const labels = rt.categoryDisplayLabels || rt.categoryLabels || fields;
          const kept = ['DOPACITY', 'AGGREGATE', 'GROUP', 'SUM', 'ZEROISVALUE', 'VALUES']
            .filter(f => [...rt.flags].some(x => x.startsWith(f) && (f !== 'DOPACITY' || /^DOPACITY/.test(x))))
            .map(f => (f === 'DOPACITY' ? 'DOPACITYMAX' : f));
          let def;
          if (marks.length > 1) {
            def = {
              layer: rt.name + '::subtheme',
              binding: (b => { delete b.field100; delete b.value100; return b; })(Object.assign({}, rt.binding, { value: marks.map(i => fields[i]).join('|') })),
              style: Object.assign({}, rt.style, { type: [...rt.flags].concat(['SUBTHEME', 'NOLEGEND']).join('|'),
                colorscheme: marks.map(i => colors[i]), values: marks.map(i => labels[i]) }),
              meta: { title: 'actual selection' }
            };
          } else {
            const i = marks[0];
            const binding = Object.assign({}, rt.binding, { value: fields[i] });
            delete binding.alpha; delete binding.alpha100;
            // rt.features already carry the field100 result — drop it and
            // every alias of it, or normalizeTheme would apply it again
            delete binding.field100; delete binding.value100;
            def = {
              layer: rt.name + '::subtheme',
              binding,
              style: { type: ['CHOROPLETH', 'LOG', 'DOPACITY', 'NOLEGEND', 'SUBTHEME'].concat(kept).join('|'),
                colorscheme: ['7', 'white', colors[i]], dopacityscale: 2, dopacitypow: 1,
                units: rt.style.units, linecolor: rt.style.linecolor, linewidth: rt.style.linewidth },
              meta: { title: 'actual selection' }
            };
          }
          const sub = new LayerRuntime(normalizeTheme(def), { type: 'FeatureCollection', features: rt.features }, builder._engineOptions);
          sub._isSubTheme = true;
          runtimes.splice(runtimes.indexOf(rt) + 1, 0, sub);
          rt._subTheme = sub;
        }
        refresh();
        notifyRedraw();
      };
      // the stack of the theme panels — flat shows one theme's legend
      // after the other in #map-legend, separated by a line, and leaves
      // out a theme hidden, out of scale or not yet drawn
      let legendStack = null;
      const legendStackEl = shadow => {
        if (legendStack && legendStack.parentNode) return legendStack;
        legendStack = document.createElement('div');
        legendStack.className = 'ix-legend-stack';
        legendStack.style.cssText = 'position:absolute;' + legendAlignCss + 'z-index:6;width:280px;'
          + 'display:flex;flex-direction:column;max-height:calc(100% - 24px);overflow-y:auto;'
          + 'border-radius:6px;box-shadow:' + shadow + ';pointer-events:auto;';
        if (!document.getElementById('ix-legend-stack-css')) {
          const css = document.createElement('style');
          css.id = 'ix-legend-stack-css';
          css.textContent = '.ix-legend-stack>.ix-native-legend:not([data-ixoff])~.ix-native-legend:not([data-ixoff]){border-top:1px solid rgba(128,128,128,.35)}';
          document.head.appendChild(css);
        }
        el.parentElement.appendChild(legendStack);
        return legendStack;
      };
      // map.setLegend(value): the `legend` map option at runtime, same values as
      // ixmaps.Map(id, {legend}) — on ("true", "open", …), folded ("closed"), off
      // (false/"false"/0/undefined). Panels are made for themes that lack one,
      // removed when off, folded/unfolded otherwise.
      setLegendOption = (opt) => {
        builder.mapOptions.legend = opt;
        legendFolded = opt === 'closed';
        legendOn = legendIsOn(opt);
        runtimes.forEach(rt => {
          if (!legendOn) {
            if (rt._legendPanel && rt._legendPanel.parentNode) rt._legendPanel.parentNode.removeChild(rt._legendPanel);
            rt._legendPanel = null;
          } else if (!rt._legendPanel) addLegendPanel(rt);
          else if (rt._setLegendCollapsed) rt._setLegendCollapsed(legendFolded);
        });
        layoutLegends();
      };
      layoutLegends = () => {
        if (!legendStack) return;
        const z = map.getZoom();
        let shown = 0;
        [...legendStack.children].forEach(panel => {
          const rt = panel._ixRuntime;
          const off = !rt || rt._hidden || themeHiddenByScale(rt.flags, rt.style, z);
          if (off) { panel.setAttribute('data-ixoff', ''); panel.style.display = 'none'; }
          else { panel.removeAttribute('data-ixoff'); panel.style.display = 'flex'; shown++; }
        });
        legendStack.style.display = shown ? 'flex' : 'none';
      };
      const legendApplies = rt => rt.categoryLabels && rt.categoryLabels.length && !rt.flags.has('FEATURE') && !rt.flags.has('FEATURES') && !rt.flags.has('NOLEGEND');
      // One theme's panel — at build time for every theme, and again for a
      // theme defined later (map.layer(...) in a myMap.then(...) chain,
      // defineLayer, loadProject); removeTheme removes it with the theme.
      addLegendPanel = (rt) => {
        // marking a class (legend row, or ixmaps.markThemeClass from a
        // page) redraws — for every theme, legend panel or not
        rt._triggerRedraw = () => { refresh(); };
        if (subThemeCapable(rt)) rt._onMarksChanged = () => updateSubTheme(rt);
        if (!legendOn || !el.parentElement || !legendApplies(rt)) return;
        el.parentElement.style.position = el.parentElement.style.position || 'relative';
        {
        // .type("...|NOLEGEND") — the fourth real legend-related type()
        // token: opts a theme OUT of the legend entirely (real engine's
        // own per-layer "skip this one" flag, distinct from the map-
        // level legend:"open"/"closed" option gating the whole panel).
        // Same free-parsing story as SIMPLELEGEND/COMPACTLEGEND above —
        // just one more flag to exclude on, no new plumbing.
          const panel = document.createElement('div');
          rt._legendPanel = panel;
          panel.className = 'ix-native-legend';
          // Opt-in via .style({legendtheme:"light"}) — a NEW, ixmaps-gl-
          // only convention (same naming pattern as the sibling
          // legendfilter/legendunits keys added earlier this session):
          // real ixmaps-flat's legend.js has no such switch, this panel
          // is entirely this port's own construction. Default ("dark")
          // preserves the original always-dark panel exactly; "light" is
          // for pages using a light basemap (e.g. CARTO Positron) where
          // a dark semi-transparent panel reads as a mismatched dark
          // patch rather than legend chrome. Every other hardcoded panel
          // color below (rows, bar track, filter <select>) is expressed
          // in terms of this one palette so the two variants stay in
          // sync — no separate light/dark branch anywhere else.
          // flat's look (flatLegendLook) unless the page picks one with
          // this engine's own legendtheme
          const opacityOpt = parseFloat(builder._engineOptions.basemapopacity);
          const flatLook = flatLegendLook(builder.mapOptions.mapType, isNaN(opacityOpt) ? 1 : opacityOpt, builder.mapOptions.legendBackground || builder.mapOptions.legendbackground);
          const isLightLegend = rt.style.legendtheme === 'light' || (rt.style.legendtheme !== 'dark' && !flatLook.dark);
          const legendColors = isLightLegend
            ? { bg: 'rgba(255,255,255,0.92)', fg: '#1a1a1a', shadow: '0 2px 10px rgba(0,0,0,0.18)',
                rowMarked: 'rgba(0,0,0,0.08)', track: 'rgba(0,0,0,0.08)',
                selectBg: 'rgba(0,0,0,0.04)', selectBorder: 'rgba(0,0,0,0.2)' }
            : { bg: 'rgba(28,30,34,0.92)', fg: '#eee', shadow: '0 2px 10px rgba(0,0,0,0.45)',
                rowMarked: 'rgba(255,255,255,0.14)', track: 'rgba(255,255,255,0.08)',
                selectBg: 'rgba(255,255,255,0.08)', selectBorder: 'rgba(255,255,255,0.25)' };
          if (!rt.style.legendtheme) legendColors.bg = flatLook.bg;
          // max-height:66% resolves against el.parentElement's own
          // height (the map container, which always has a definite
          // height for the map itself to render into) since this panel
          // is absolutely positioned inside it — a plain percentage on
          // an absolutely-positioned element's height IS legal CSS as
          // long as its containing block has a definite height, which
          // this one does. display:flex column + min-height:0 on the
          // ROWS wrapper below (not this outer panel) is what makes
          // only the row list scroll while the header/description/
          // slider stay fixed in place — a flex child won't actually
          // shrink to fit and scroll internally without min-height:0,
          // it just overflows its flex parent instead.
          // one box for every theme, as flat's #map-legend (legend.js
          // 2200-2460): the panels stack in the legend stack in theme
          // order, a line between them (see layoutLegends)
          panel.style.cssText = 'position:relative;flex:0 0 auto;'
            + 'display:flex;flex-direction:column;'
            + 'background:' + legendColors.bg + ';color:' + legendColors.fg + ';font:12px/1.4 -apple-system,Arial,sans-serif;'
            + 'padding:10px 12px 12px;pointer-events:auto;';
          const stack = legendStackEl(legendColors.shadow);
          const at = runtimes.indexOf(rt);
          const next = [...stack.children].find(c => runtimes.indexOf(c._ixRuntime) > at);
          panel._ixRuntime = rt;
          stack.insertBefore(panel, next || null);

          // SUM+valuefield mirrors the real engine's own "SUM style
          // aggregation" reading (style.valuefield, falling back to
          // the bound size field); anything else (plain CATEGORICAL,
          // no SUM) falls back to a per-category record COUNT.
          const useSum = flatFlag(rt.flags, 'SUM') && rt.style.valuefield;
          const valueField = rt.style.valuefield || rt.binding.size;
          // legendunits wins over the theme's general-purpose units
          // (used elsewhere for tooltips, e.g. _renderItemChartHtml) —
          // a page may want a different/no unit string specifically on
          // the legend's own value column. Appended as-is (no extra
          // space injected), matching how style.units/legendunits are
          // themselves authored with their own leading space (e.g.
          // " MW") in real pages.
          const legendUnit = rt.style.legendunits || rt.style.units || '';
          // row labels go into innerHTML: the page's own .style({label})
          // stays HTML, as in flat; categories read from the data are
          // escaped (a value could carry markup)
          const labels = legendRowLabels(rt);
          // .type("...|TEXTLEGEND") — the FIFTH real legend-related
          // type() token: title/snippet/description text only, no
          // category rows at all (swatches, bars, chips — none of it),
          // per explicit correction. Everything below that builds the
          // rows/totals/onRedraw-recompute wiring is skipped outright
          // rather than built-then-hidden — there is nothing for any of
          // it to feed once no rows ever render. The country-filter
          // dropdown and Chart-size slider stay: neither is a
          // "categorical item" or "colorscheme swatch", both are
          // independent controls unrelated to the row list.
          const isTextOnly = rt.flags.has('TEXTLEGEND');

          // Map-view-aware per explicit request: totals reflect only
          // what's CURRENTLY on screen (the map's own bounds, plus the
          // same far-hemisphere exclusion _buildChartLayers itself
          // applies under globe projection — see isOnVisibleHemisphere)
          // rather than the whole dataset — recomputed on every redraw
          // (engineApi.onRedraw, below) so panning/zooming/rotating
          // updates the bars and values live, the same way the actual
          // rendered bubbles change. Same simple rectangular bbox
          // membership test _computeAggregatedItems's own non-AGGREGATE
          // branch uses (no antimeridian wraparound handling — matches
          // that existing convention, not a new gap this introduces).
          let totals, maxTotal, order, rowsScroll;
          // No-op default: TEXTLEGEND never reassigns this (see below),
          // so the LATER unconditional-looking `renderRows()` call
          // safely does nothing rather than needing its own isTextOnly
          // guard at every call site.
          let renderRows = () => {};
          if (!isTextOnly) {
          function computeTotals() {
            const bounds = map.getBounds();
            const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
            const proj = (typeof map.getProjection === 'function' && map.getProjection()) || { type: 'mercator' };
            const globeCenter = proj.type === 'globe' ? map.getCenter() : null;
            totals = new Array(rt.categoryLabels.length).fill(0);
            if (rt._rangeClassed) { totals = rangeClassLegendTotals(rt, bbox, globeCenter); maxTotal = Math.max(0, ...totals); order = totals.map((v, i) => i).sort((a, b) => totals[b] - totals[a]); return; }
            // _activeFeatures (set by setFacetFilter/clearFacetFilter,
            // e.g. the country-select dropdown below) is the facet-
            // filtered subset when a filter is active, null otherwise —
            // reading it here keeps the legend's own numbers consistent
            // with whatever the country filter is currently narrowing
            // the map down to, not just with the viewport/hemisphere.
            (rt._activeFeatures || rt.features).forEach(f => {
              const idx = rt.categoryIndexByLabel ? rt.categoryIndexByLabel.get(f.properties[rt.binding.value]) : null;
              if (idx == null) return;
              const [lng, lat] = f.geometry.coordinates;
              if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) return;
              if (globeCenter && !isOnVisibleHemisphere(lng, lat, globeCenter)) return;
              totals[idx] += useSum ? (parseFloat(f.properties[valueField]) || 0) : 1;
            });
            maxTotal = Math.max(0, ...totals);
            order = totals.map((v, i) => i).sort((a, b) => totals[b] - totals[a]);
          }
          computeTotals();

          // Only THIS wrapper scrolls (flex:1 1 auto + min-height:0 lets
          // it shrink to whatever's left of the panel's own 66%-height
          // cap once the fixed header/description/slider take their
          // share, then overflow-y:auto scrolls just the row list) —
          // the header above and description/slider below stay put.
          rowsScroll = document.createElement('div');
          rowsScroll.style.cssText = 'flex:1 1 auto;min-height:0;overflow-y:auto;';
          const rowsEl = document.createElement('div');
          rowsEl.className = 'ix-legend-rows';
          // .type("...|SIMPLELEGEND") — real ixmaps-flat's OTHER legend
          // variant (confirmed against a real-engine screenshot, per
          // explicit correction): swatch + label chips only, no bar, no
          // value column. SIMPLELEGEND is just another pipe-delimited
          // type() token — MapBuilder#type() already puts every token
          // into this.flags regardless of whether anything reads it, so
          // no new parsing was needed, only this render-mode branch.
          // flex-wrap here (vs. the bar mode's block rows) — chips wrap
          // to the panel's own width the same loose way the real
          // engine's screenshot shows (an uneven number of chips per
          // row, driven by each label's own text length, not a fixed
          // column grid).
          // .type("...|COMPACTLEGEND") — the THIRD real legend variant
          // (again confirmed against a real-engine screenshot, per
          // explicit correction): the bar-mode's own two-line label/bar/
          // value row, but wrapped into a multi-column flex-wrap grid
          // instead of one full-width row per category — each item's
          // own width follows its content (a bigger value's longer bar
          // makes its own item wider, so fewer fit per line; Coal alone
          // filled its own row in the reference screenshot while the
          // smaller categories packed 3-4 per row) rather than a fixed
          // column count.
          if (rt.flags.has('SIMPLELEGEND') || rt.flags.has('COMPACTLEGEND')) {
            rowsEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
          }
          rowsScroll.appendChild(rowsEl);

          // Two lines per row — label on its own full-width line, then
          // swatch+bar+value below — per explicit correction: a single
          // shared line left too little room for the bar to read as
          // proportional (it was squeezed between the label text and a
          // fixed-width value column). The bar itself lives inside a
          // flex:1 "track" div sized to whatever's left after the fixed
          // swatch/value columns, and is a PERCENTAGE of that track's
          // own width (not a pixel value) — real formula's per-unit-
          // factor/cap (legend.js:980-984/946-950) collapses to a plain
          // linear percentage-of-max once the bar's available width
          // isn't a fixed constant this code has to guess at.
          const isSimple = rt.flags.has('SIMPLELEGEND');
          const isCompact = rt.flags.has('COMPACTLEGEND');
          // Compact mode's bar can't use the full-width mode's
          // percentage-of-flex-track trick (there's no full-width track
          // to be a percentage OF once the row itself is content-sized,
          // not stretched) — a plain pixel width, proportional to value
          // and capped, same shape as the full-width formula just
          // expressed in absolute px instead of a % of an elastic track.
          const COMPACT_MAX_BAR_PX = 70;
          // flat's compact legend (legend.js makeColorLegendHTML, the
          // "compact" mode the theme legends use, 1212-1257): a range
          // theme of 5 classes or more without labels is one line of
          // color patches with the value range below; DOPACITY with an
          // alpha field adds two paler lines (opacity 1/2, 1/3) and the
          // alpha max, "↓" and min to their right (1062-1205). The
          // legend's own __formatValue (legend.js 451-553) has no SPACE
          // form: SPACE there is flat's plain "." thousands.
          const flatCompactLegend = rt._rangeClassed && !flatFlag(rt.flags, 'CATEGORICAL') && !flatFlag(rt.flags, 'PLOT')
            && (rt.partsA || []).length >= 5 && !(Array.isArray(rt.style.label) && rt.style.label.length);
          // flat's single-color legend (legend.js 765-769, 1039-1046): a range
          // theme of at most 2 classes without label/ranges, not
          // CATEGORICAL, is one row — the swatch and "min ... max unit",
          // or, when every value is 1 (a "$item$" count), its label or
          // value field
          const flatSingleRowLegend = rt._rangeClassed && !flatFlag(rt.flags, 'CATEGORICAL') && !flatFlag(rt.flags, 'PLOT')
            && (rt.partsA || []).length <= 2 && !(Array.isArray(rt.style.label) && rt.style.label.length)
            && !(Array.isArray(rt.style.ranges) && rt.style.ranges.length);
          if (flatSingleRowLegend) {
            renderRows = function() {
              const rgb = rt.categoryColorsRgb[0] || [128, 128, 128];
              const unit = String(rt.style.legendunits || rt.style.units || '').replace(/ /g, '&nbsp;');
              const vMin = styleNum(rt.style.minvalue) || rt._valueMin, vMax = styleNum(rt.style.maxvalue) || rt._valueMax;
              const label = rt.style.label != null && !Array.isArray(rt.style.label) ? String(rt.style.label) : String(rt.binding.value || '');
              const text = vMin !== 1 || vMax !== 1
                ? flatFormatValue(vMin, 2, 'BLANK') + ' &nbsp;... ' + flatFormatValue(vMax, 2, 'BLANK') + ' ' + unit
                : label;
              const marked = rt._markedClasses.has(0);
              rowsEl.innerHTML = '<div class="ix-legend-row" data-idx="0" style="display:flex;align-items:center;gap:5px;padding:4px 3px;cursor:pointer;border-radius:4px;'
                + 'background:' + (marked ? legendColors.rowMarked : 'transparent') + ';">'
                + '<span style="flex:0 0 auto;width:1.6em;height:0.8em;background:rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ');"></span>'
                + '<span>' + text + '</span></div>';
              rowsEl.querySelectorAll('.ix-legend-row').forEach(row => {
                row.addEventListener('click', () => {
                  if (rt._markedClasses.has(0)) unmarkRuntimeClass(rt, 0);
                  else markRuntimeClass(rt, 0);
                });
              });
            };
          } else
          if (flatCompactLegend) {
            renderRows = function() {
              const n = rt.categoryColorsRgb.length;
              const withAlpha = flatFlag(rt.flags, 'DOPACITY') && rt.binding.alpha && rt._alphaMax;
              const nLines = withAlpha ? 3 : 1;
              const dec = rt.style.decimals != null ? parseInt(rt.style.decimals, 10) : 2;
              const unit = rt.style.legendunits || rt.style.units || '';
              const ranges = Array.isArray(rt.style.ranges) && rt.style.ranges.length ? rt.style.ranges.map(Number) : null;
              const vMin = ranges ? ranges[0] : rt._valueMin, vMax = ranges ? ranges[ranges.length - 1] : rt._valueMax;
              let html = '<div style="display:grid;grid-template-columns:repeat(' + n + ',1fr)' + (withAlpha ? ' auto' : '') + ';gap:1px;align-items:center;">';
              for (let line = 0; line < nLines; line++) {
                for (let c = 0; c < n; c++) {
                  const ix = flatFlag(rt.flags, 'INVERT') ? n - c - 1 : c;
                  const rgb = rt.categoryColorsRgb[ix];
                  const part = rt.partsA[ix];
                  const title = part ? flatFormatValue(part.min, dec, '') + unit + ' ... ' + flatFormatValue(part.max, dec, '') + unit : '';
                  const marked = rt._markedClasses.has(ix);
                  html += '<span class="ix-legend-row" data-idx="' + ix + '" title="' + title + '" style="cursor:pointer;height:14px;'
                    + 'background:rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ');opacity:' + (1 / (line + 1)) + ';'
                    + (marked ? 'outline:2px solid ' + legendColors.fg + ';outline-offset:-2px;' : '') + '"></span>';
                }
                if (withAlpha) {
                  const txt = line === 0 ? flatFormatValue(rt._alphaMax, 0, 'BLANK')
                    : line === 1 ? '&#8595; ' + (rt.style.alphavalueunits || '') : flatFormatValue(rt._alphaMin || 0, 0, 'BLANK');
                  html += '<span style="padding-left:0.5em;white-space:nowrap;">' + txt + '</span>';
                }
              }
              html += '</div><div style="display:flex;justify-content:space-between;margin-top:3px;' + (withAlpha ? 'margin-right:4em;' : '') + '">'
                + '<span>' + flatFormatValue(vMin, dec, '') + (unit ? ' ' + unit : '') + '</span>'
                + '<span>' + flatFormatValue(vMax, dec, '') + (unit && unit.length <= 3 ? ' ' + unit : '') + '</span></div>';
              rowsEl.innerHTML = html;
              rowsEl.querySelectorAll('.ix-legend-row').forEach(cell => {
                cell.addEventListener('click', () => {
                  const idx = parseInt(cell.dataset.idx, 10);
                  if (rt._markedClasses.has(idx)) unmarkRuntimeClass(rt, idx);
                  else markRuntimeClass(rt, idx);
                });
              });
            };
          } else
          renderRows = function() {
            // flat drops the rows without a count once any row has one
            // (legend.js 754-760, 787-789: fCountBars && !count)
            rowsEl.innerHTML = order.filter(i => !(maxTotal > 0) || totals[i]).map(i => {
              const rgb = rt.categoryColorsRgb[i];
              const color = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
              const marked = rt._markedClasses.has(i);
              const dimmed = rt._markedClasses.size > 0 && !marked;
              const rowStyle = 'padding:4px 3px;border-radius:4px;cursor:pointer;opacity:' + (dimmed ? 0.4 : 1) + ';'
                + 'background:' + (marked ? legendColors.rowMarked : 'transparent') + ';';
              if (isSimple) {
                // Swatch + label only, no bar/value — see rowsEl's own
                // comment above for why (SIMPLELEGEND).
                return '<div class="ix-legend-row" data-idx="' + i + '" style="' + rowStyle
                  + 'display:inline-flex;align-items:center;gap:5px;padding:4px 8px;">'
                  + '<span style="flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:' + color + ';"></span>'
                  + '<span>' + labels[i] + '</span>'
                  + '</div>';
              }
              const pct = maxTotal ? Math.max(0, Math.min(100, (totals[i] / maxTotal) * 100)) : 0;
              if (isCompact) {
                // Same two-line label/bar/value shape as full-width bar
                // mode below, just content-sized (flex:0 0 auto, no
                // min-width:0 flex-1 track) so multiple items pack onto
                // one line inside rowsEl's own flex-wrap — see
                // COMPACTLEGEND's own comment on rowsEl above.
                const barPx = Math.max(2, (pct / 100) * COMPACT_MAX_BAR_PX);
                return '<div class="ix-legend-row" data-idx="' + i + '" style="' + rowStyle + 'flex:0 0 auto;">'
                  + '<div style="margin-bottom:3px;white-space:nowrap;">' + labels[i] + '</div>'
                  + '<div style="display:flex;align-items:center;gap:6px;">'
                  + '<span style="flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:' + color + ';"></span>'
                  + '<span style="flex:0 0 auto;width:' + barPx + 'px;height:6px;background:' + color + ';border-radius:3px;"></span>'
                  + '<span style="flex:0 0 auto;white-space:nowrap;">' + rt._formatTooltipValue(totals[i]) + legendUnit + '</span>'
                  + '</div>'
                  + '</div>';
              }
              return '<div class="ix-legend-row" data-idx="' + i + '" style="' + rowStyle + '">'
                + '<div style="margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + labels[i] + '</div>'
                + '<div style="display:flex;align-items:center;gap:6px;">'
                + '<span style="flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:' + color + ';"></span>'
                + '<span style="flex:1 1 auto;min-width:0;height:6px;background:' + legendColors.track + ';border-radius:3px;overflow:hidden;">'
                + '<span style="display:block;height:100%;width:' + pct + '%;background:' + color + ';border-radius:3px;"></span>'
                + '</span>'
                + '<span style="flex:0 0 auto;text-align:right;min-width:60px;">' + rt._formatTooltipValue(totals[i]) + legendUnit + '</span>'
                + '</div>'
                + '</div>';
            }).join('');
            // GL-PORT COMPAT: real ixmaps-flat's row markup wires its
            // click handler inline (onclick="ixmaps.markThemeClass(...)"
            // — legend.js:817), toggle decided by the caller. Same
            // split here: the toggle check lives in this click
            // handler, the actual add/remove-and-redraw primitive is
            // markRuntimeClass/unmarkRuntimeClass, which the globals
            // ixmaps.markThemeClass/unmarkThemeClass also use — so a
            // page's OWN custom UI drives this exact legend too. The
            // rows pass their runtime itself: its .layer() name may be
            // shared with other themes of the page.
            rowsEl.querySelectorAll('.ix-legend-row').forEach(rowEl => {
              rowEl.addEventListener('click', () => {
                const idx = parseInt(rowEl.dataset.idx, 10);
                if (rt._markedClasses.has(idx)) unmarkRuntimeClass(rt, idx);
                else markRuntimeClass(rt, idx);
              });
            });
          };

          // Recompute+re-render on EVERY redraw, not just mark toggles —
          // this is what makes the legend map-view-aware: a plain pan/
          // zoom/rotate fires this too (via the map's own 'move'
          // listener -> scheduleRefresh -> notifyRedraw, debounced the
          // same 400ms as the facets sidebar's own onRedraw use), same
          // signal already used elsewhere in this file for "the visible
          // data just changed, recompute".
          engineApi.onRedraw(() => { computeTotals(); renderRows(); });
          }

          // rt._triggerRedraw: see its own doc comment on LayerRuntime
          // (set here rather than at construction time since refresh()
          // doesn't exist yet when the runtime is built). Kept
          // unconditional (even for TEXTLEGEND, which never registers
          // the onRedraw recompute above) — a page can still call
          // ixmaps.markThemeClass/unmarkThemeClass directly with no
          // visual row list to click, and that should still redraw the
          // MAP's own dim/isolate effect even without a legend UI for
          // it, matching real-engine global-API availability regardless
          // of legend style.
          rt._triggerRedraw = () => { refresh(); };

          // Header row (title/snippet + collapse toggle) always stays
          // visible; everything else lives in `bodyEl`, hidden/shown as
          // a single unit by the toggle below — collapsing shows just
          // the title bar, matching the real engine's own fold/unfold
          // behavior (ixmaps.legendState + the "legend-folded" CSS
          // class, ui/js/tools/legend.js) even though this port toggles
          // via a plain display swap on one wrapper div rather than a
          // shared stylesheet class (this panel has no external CSS at
          // all — everything here is inline-styled, unlike the real
          // engine's DOM/CSS-class-driven legend).
          const header = document.createElement('div');
          header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:6px;';
          const headerText = document.createElement('div');
          headerText.style.cssText = 'min-width:0;flex:1 1 auto;';
          let headerHtml = '';
          if (rt.meta.title) headerHtml += '<div style="font-weight:600;font-size:13px;margin-bottom:2px;">' + rt.meta.title + '</div>';
          if (rt.meta.snippet) headerHtml += '<div style="opacity:0.75;">' + rt.meta.snippet + '</div>';
          headerText.innerHTML = headerHtml;
          header.appendChild(headerText);
          const collapseBtn = document.createElement('button');
          collapseBtn.type = 'button';
          collapseBtn.style.cssText = 'flex:0 0 auto;background:transparent;border:none;color:inherit;'
            + 'font-size:14px;line-height:1;cursor:pointer;padding:2px 4px;opacity:0.7;';
          header.appendChild(collapseBtn);
          panel.appendChild(header);

          const bodyEl = document.createElement('div');
          bodyEl.style.cssText = 'display:flex;flex-direction:column;min-height:0;flex:1 1 auto;margin-top:8px;';
          panel.appendChild(bodyEl);

          // Collapsed by default under the real engine's own narrow-
          // screen legend threshold (ui/js/tools/legend.js: `if
          // (window.innerWidth < 500) ixmaps.legend.hide()`) — reusing
          // that concrete precedent rather than picking an arbitrary
          // "mobile" breakpoint of this port's own invention. Checked
          // once at panel-build time, not on resize — matching the real
          // engine's own one-shot-at-redraw-time check, not a live
          // matchMedia listener.
          const MOBILE_LEGEND_BREAKPOINT = 500;
          let collapsed = legendFolded || window.innerWidth < MOBILE_LEGEND_BREAKPOINT;
          function applyCollapsed() {
            bodyEl.style.display = collapsed ? 'none' : 'flex';
            collapseBtn.textContent = collapsed ? '▸' : '▾';
            collapseBtn.title = collapsed ? 'Expand legend' : 'Collapse legend';
          }
          collapseBtn.addEventListener('click', () => { collapsed = !collapsed; applyCollapsed(); });
          applyCollapsed();
          rt._setLegendCollapsed = c => { collapsed = !!c; applyCollapsed(); }; // setLegendOption

          // Selection/filter by field — opt-in via .style({legendfilter:
          // "<field>"}), e.g. "country_long" on the power-plants sample.
          // A NEW, ixmaps-gl-only convention: real ixmaps-flat's own
          // style.filterfield names the DEFAULT field an unqualified
          // .filter("text") search term matches against (maptheme.js:
          // 1275-1276/7359-7362) — a different concept entirely, so this
          // deliberately uses its own name rather than overloading that
          // one. Options come from the FULL dataset (a world-spanning
          // bbox, not the current viewport) and stay fixed regardless of
          // pan/zoom — unlike the map-view-aware category totals below,
          // a picker whose own choices kept shrinking as you panned
          // would make it impossible to select a country not currently
          // in view. Selecting a value reuses the engine's own existing
          // facet-filter primitive (engineApi.setFacetFilter/
          // clearFacetFilter — already propagates to sibling runtimes
          // sharing the same data source and calls refresh()), so this
          // is UI wiring only, no new filtering logic.
          const filterField = rt.style.legendfilter;
          if (filterField) {
            const facet = engineApi.getFacets(rt.name, [filterField], { bbox: [-180, -85, 180, 85] })[0];
            const values = (facet && facet.type === 'textual')
              ? facet.values.slice().sort((a, b) => String(a).localeCompare(String(b)))
              : [];
            const filterEl = document.createElement('select');
            filterEl.style.cssText = 'width:100%;margin-bottom:8px;background:' + legendColors.selectBg + ';'
              + 'color:' + legendColors.fg + ';border:1px solid ' + legendColors.selectBorder + ';border-radius:4px;padding:4px 6px;font:inherit;';
            filterEl.innerHTML = '<option value="">All (' + values.length + ')</option>'
              + values.map(v => '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>').join('');
            filterEl.addEventListener('change', () => {
              if (filterEl.value) engineApi.setFacetFilter(rt.name, filterField, filterEl.value);
              else engineApi.clearFacetFilter(rt.name, filterField);
            });
            bodyEl.appendChild(filterEl);
          }

          if (!isTextOnly) { bodyEl.appendChild(rowsScroll); renderRows(); }

          if (rt.meta.description) {
            const desc = document.createElement('div');
            desc.style.cssText = 'margin-top:8px;font-size:11px;opacity:0.8;';
            // Raw HTML, matching the real engine's own description
            // rendering and this engine's existing .legend(html)/
            // tooltip conventions (e.g. _buildTooltipContext) — real
            // pages already embed their own source-citation markup
            // inside meta.description (see the power-plants sample).
            desc.innerHTML = rt.meta.description;
            bodyEl.appendChild(desc);
          }

          // Chart-size slider — real engine's own range (legend.js:
          // 3196-3202), 100% == scale:1, wired to changeThemeStyle(
          // themeId,"scale:"+pct/100,"set")+redrawTheme there; this
          // engine's equivalent is rt.setStyle({scale}) + refresh(),
          // the same primitive engineApi.setThemeStyle uses above.
          // CHOROPLETH themes get an OPACITY slider instead, as in flat
          // (legend.js ~3190: 0-100%, fillopacity·100, default 90;
          // changeThemeStyle("fillopacity:"+pct/100,"set") + redraw).
          // (flat labels a VECTOR theme's size slider "Line width" — gl has
          // no VECTOR themes.)
          // Flat tests the words (legend.js 2533-2535): a "CHOROPLETHE"
          // theme has neither slider.
          const typeWords = rt.flags.typeString != null ? rt.flags.typeString : [...rt.flags].join('|');
          const isOpacitySlider = /\bCHOROPLETH\b/.test(typeWords);
          const hasSlider = isOpacitySlider || /\bCHART\b|\bBUBBLE\b|\bDOT\b/.test(typeWords);
          if (hasSlider) {
          const sliderRow = document.createElement('div');
          sliderRow.style.cssText = 'margin-top:10px;font-size:11px;opacity:0.8;';
          const fillPct = Math.round(styleNum(rt.style.fillopacity) * 100);
          const initialPct = isOpacitySlider
            ? (Number.isFinite(fillPct) ? Math.max(0, Math.min(100, fillPct)) : 90)
            : Math.round((styleNum(rt.style.scale) || 1) * 100);
          const sliderLabel = isOpacitySlider ? 'Opacity' : 'Chart size';
          sliderRow.innerHTML = sliderLabel + ': <span class="ix-legend-scale-val">' + initialPct + '</span>%';
          bodyEl.appendChild(sliderRow);
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = isOpacitySlider ? '0' : '25';
          slider.max = isOpacitySlider ? '100' : '200';
          slider.value = String(initialPct);
          slider.style.cssText = 'width:100%;margin-top:2px;';
          slider.addEventListener('input', () => {
            const pct = parseInt(slider.value, 10);
            sliderRow.querySelector('.ix-legend-scale-val').textContent = pct;
            rt.setStyle(isOpacitySlider ? { fillopacity: pct / 100 } : { scale: pct / 100 });
            refresh();
          });
          bodyEl.appendChild(slider);
          }
        }
      };
      runtimes.forEach(rt => addLegendPanel(rt));
    }
    return { addLegendPanel, setLegendOption, updateSubTheme, layoutLegends };
  }

  class MapBuilder {
    constructor(containerId, options) {
      this.containerId = containerId;
      this.mapOptions = options || {};
      this._viewCenter = null;
      this._viewZoom = null;
      this._engineOptions = {};
      this._locals = [];
      this._attributionText = '';
      this._legendHtml = '';
      this._layerBuilders = [];
    }
    // GL-PORT COMPAT: real ixmaps-flat's own .view() takes ONE argument —
    // {center:{lat,lng}, zoom} — where this engine's own convention is TWO
    // args, .view([lat,lng], zoom). Detected by shape (a plain array, this
    // engine's own idiom, vs. an object carrying its own .center), so
    // either calling convention works unmodified.
    view(latlonOrOpts, zoom) {
      if (latlonOrOpts && typeof latlonOrOpts === 'object' && !Array.isArray(latlonOrOpts) && latlonOrOpts.center) {
        const c = latlonOrOpts.center;
        this._viewCenter = Array.isArray(c) ? c : [c.lat, c.lng];
        this._viewZoom = latlonOrOpts.zoom;
      } else {
        this._viewCenter = latlonOrOpts;
        this._viewZoom = zoom;
      }
      return this;
    }
    options(o) { this._engineOptions = o; return this; }
    local(...args) { this._locals.push(args); return this; }
    // flat's .require(url) (htmlgui.js ixmaps.require): a script the page
    // needs (a chart library, a user chart) — page code, like a <script>
    // tag; loaded in order before the layers (see loadRequiredScripts)
    require(url) { this._required = (this._required || []).concat(url); return this; }
    // flat's .attribution(text): the page's attribution, bottom left on the
    // map (createAttribution) — also after the map is built
    attribution(a) {
      this._attributionText = a;
      if (this._setAttribution) this._setAttribution(a);
      return this;
    }
    legend(html) { this._legendHtml = html; return this; }
    // GL-PORT COMPAT: real ixmaps-flat's map.layer(name) returns a NEW
    // per-layer builder for a .data()...define() chain on the LAYER
    // itself. This engine's own established convention instead pre-builds
    // a LayerBuilder via the global ixmaps.layer(name, configFn) factory
    // and passes the finished OBJECT to map.layer(obj), which returns
    // `this` (the MAP) for further .layer(a).layer(b) chaining. Both are
    // supported, distinguished by argument type, so a real page's
    // map.layer("name").data()...define() chain works unmodified.
    layer(nameOrBuilder) {
      if (typeof nameOrBuilder === 'string') {
        const lb = new LayerBuilder(nameOrBuilder);
        this._layerBuilders.push(lb);
        return lb;
      }
      this._layerBuilders.push(nameOrBuilder);
      return this;
    }
    // GL-PORT COMPAT: real ixmaps-flat's map.on("layerdraw", cb) — only
    // "layerdraw" is actually wired up (see build()'s own note on how
    // it's translated into onRedraw + a synthetic per-runtime event); any
    // OTHER event name is accepted and stored but never fired —
    // recognized rather than throwing, the same "known but inert" pattern
    // KNOWN_INERT_FLAGS already uses for unimplemented type flags.
    on(event, cb) {
      this._pendingEvents = this._pendingEvents || [];
      this._pendingEvents.push([event, cb]);
      return this;
    }

    async build() {
      // createMap() calls build() synchronously, and an async function runs
      // synchronously up to its first await — so without this yield, the
      // splash below read this._engineOptions BEFORE a page's chained
      // ixmaps.Map(...).options({splash:false | splashText}) had run (only
      // the Map(id, opts, map => map.options(...)) callback form worked).
      // One microtask lets the caller's whole synchronous chain land first.
      await null;
      const el = document.getElementById(this.containerId);
      if (!el) throw new Error(`[ixmaps-gl] container #${this.containerId} not found`);
      // GL-PORT COMPAT: ixmaps.Map(id, {width, height}) — flat sizes its
      // inner map div with these and gives PIXEL values to the page's own
      // container too (htmlgui_flat.js:866-876, parent().css(...)); here
      // the page's container is the map itself, so pixel values size it
      // (a page whose div has no CSS size of its own relies on this),
      // percentages are left to the page's CSS as with flat's outer div.
      for (const dim of ['width', 'height']) {
        const v = this.mapOptions && this.mapOptions[dim];
        if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*px\s*$/i.test(v)) el.style[dim] = v.trim();
        else if (typeof v === 'number' && v > 0) el.style[dim] = v + 'px';
      }
      // without width/height flat's map is "fullscreen" (htmlgui_flat.js
      // 847-876): it fills the window, whatever the page's CSS gives the
      // container — a container left without a height gets the window's
      if (!(this.mapOptions && (this.mapOptions.width || this.mapOptions.height))) {
        if (!el.clientHeight) el.style.height = '100vh';
        if (!el.clientWidth) el.style.width = '100%';
      }

      // shown for the whole build() (library lazy-load + every layer's own
      // data fetch, real-world verified as the two slowest phases) through
      // to MapLibre's own 'load' event, below — .options({splashText:...})
      // overrides the default message, .options({splash:false}) skips it
      // entirely (e.g. for a map embedded somewhere a full-cover overlay
      // would be wrong, or one that's expected to load near-instantly).
      const splash = this._engineOptions.splash === false ? null
        : showSplash(el, this._engineOptions.splashText || 'loading…');

      // ixmaps.getBoundingBox()/setTitle() for brokers called below, before
      // the MapLibre map exists (same default view as the map gets)
      _titleHost = el;
      const initialZoom = this._viewZoom != null && this._viewZoom !== '' ? flatToMapLibreZoom(Number(this._viewZoom)) : 8;
      {
        const [vLat, vLng] = this._viewCenter || [45.5, 9.2];
        _boundsSource = () => viewBounds(Number(vLat), Number(vLng), initialZoom, el.clientWidth, el.clientHeight);
      }

      // fast local check (missing container) before the network round
      // trip — MapLibre/deck.gl/Mustache + MapLibre's own
      // CSS, all in parallel; a no-op per-library for anything a page's
      // own <script>/<link> tags already loaded (see ensureLibrariesLoaded).
      await Promise.all([ensureLibrariesLoaded(), ensureDataJs(this._engineOptions)]);
      await loadRequiredScripts(this._required);

      // opt-in grammar validation (see startValidation) — only now, after
      // the library load, have .options() calls chained onto ixmaps.Map()
      // landed in this._engineOptions
      const validation = await startValidation(this._engineOptions);
      if (validation) {
        validation.mapOptions(this.mapOptions);
        validation.options(this._engineOptions);
        this._layerBuilders.forEach(lb => validation.layer(lb));
      }

      // load + filter every attached layer's data up front. Multiple
      // layers pointing at the SAME source (real convention:
      // .data({cache:"true"}) — this engine's own multi-layer example
      // pages all set this whenever a curves/grid layer shares its base
      // layer's dataset) must fetch it ONCE, not once per layer: cache
      // by the fetch identity (url/urls/type — the only fields that
      // determine what actually gets requested) for the lifetime of this
      // one build() call, sharing the in-flight PROMISE so concurrent
      // requests for the same source also dedupe, not just sequential
      // ones. Confirmed live as a real, not just theoretical, problem:
      // without this, a 3-layer page sharing one >1.2M-row multi-file CSV
      // source fetched all 5 files 3 SEPARATE times.
      // one data cache for the map's whole lifetime (flat's themeDataCacheA):
      // build() and every later defineLayer()/refreshTheme() share it
      const dataCache = this._dataCache = this._dataCache || new Map();
      const runtimes = [];
      // themes whose data comes by name (see namedDataTheme) start empty and
      // load on their own once the map is built, as in flat, where every
      // theme loads independently: a broker that answers late — or only
      // after a zoom — holds up nothing but its own theme
      let resolveBuilt;
      const built = new Promise(r => { resolveBuilt = r; });
      const namedLoads = [];
      for (const lb of this._layerBuilders) {
       // flat skips a theme it can't load; the others still load
       try {
        // flat applies its style.dbtable* data translation to EVERY theme
        // (htmlgui.js newTheme), not only to project files
        const def = projectThemeToDefinition(lb.definition());
        let spec = normalizeTheme(def);
        const named = namedDataTheme(spec);
        // .data({obj}) is already in-memory (no network cost to "re-
        // fetch"), and its object identity can't be captured in a
        // JSON.stringify key without serializing the whole table — skip
        // the fetch cache entirely for it rather than risk two DIFFERENT
        // .obj sources colliding on the same {url:undefined,...} key.
        // BUG FIX: cacheKey used to be declared INSIDE the `else` branch
        // below — block-scoped to it, so `rt._dataSourceKey = cacheKey`
        // (needed regardless of which branch ran) threw "cacheKey is not
        // defined" for every layer, the instant this function actually
        // ran to completion. Confirmed live: introduced when the .obj
        // branch was added, only now actually exercised end-to-end again.
        // Declared here (still per-iteration, before the branch) so both
        // arms can reach it, and .obj sources get a distinct identity tag
        // instead of colliding with each other under one 'null' entry.
        let raw, cacheKey;
        const deferred = deferredFeatureLoad(spec, initialZoom);
        if (deferred || named) {
          raw = { type: 'FeatureCollection', features: [] };
          cacheKey = named ? 'name:' + spec.data.name : 'deferred:' + spec.name;
        } else if (spec.data && spec.data.obj) {
          raw = await fetchLayerData(spec.data, spec.binding, this._engineOptions);
          cacheKey = 'obj:' + spec.name;
        } else {
          const cached = cachedLayerData(dataCache, spec.data, spec.binding, this._engineOptions);
          cacheKey = cached.sourceKey;
          raw = await cached.promise;
        }
        const filtered = applyWhereFilter(raw, spec.filter);
        const fc = filtered.type === 'Table' ? joinTableFeatures(spec, filtered, runtimes) : filtered;
        const rt = new LayerRuntime(spec, fc, this._engineOptions);
        // tags which underlying data source this runtime came from — see
        // setFacetFilter/clearFacetFilter/clearAllFacetFilters below,
        // which use this to propagate a facet filter to every theme
        // sharing the SAME data, not just the one the sidebar was built
        // against.
        rt._dataSourceKey = cacheKey;
        rt._definition = def; // for refreshTheme
        rt._deferredLoad = deferred;
        rt._named = named;
        rt._zoomToPending = wantsZoomToExtent(spec.flags);
        runtimes.push(rt);
        notifyNewTheme(rt);
        _globalThemeRegistry.set(rt.name, rt);
        // See findRuntime's own comment on the three real theme-id
        // conventions (.layer() name / style.name / meta.name) — this
        // module-level registry (used by getThemeObj/markThemeClass/the
        // global ixmaps.data.getFacets) needs the SAME meta.name fallback
        // findRuntime just got, or those globals would silently miss a
        // theme addressed only by its meta.name, same bug different
        // resolution path.
        if (rt.meta && rt.meta.name && rt.meta.name !== rt.name) _globalThemeRegistry.set(rt.meta.name, rt);
        // flat's theme id is style.name (maptheme szId) — several themes
        // can share one .layer() name (a page's features + charts + texts)
        if (themeIdOf(rt) !== rt.name) _globalThemeRegistry.set(themeIdOf(rt), rt);
        if (named) namedLoads.push(rt);
       } catch (err) {
        console.error(`[ixmaps-gl] theme "${lb.name}" skipped:`, err);
       }
      }

      const [lat, lon] = this._viewCenter || [45.5, 9.2];
      const mapTypeColor = resolveMapTypeColor(this.mapOptions.mapType);
      const map = new maplibregl.Map({
        container: this.containerId,
        style: mapTypeColor ? buildBlankBackgroundStyle(mapTypeColor)
                             : resolveBasemapStyleUrl(this.mapOptions.mapType),
        center: [lon, lat],
        zoom: this._viewZoom != null && this._viewZoom !== '' ? flatToMapLibreZoom(Number(this._viewZoom)) : 8,
        // MapLibre's own AttributionControl (bottom right) keeps the
        // basemap's required CARTO/OpenStreetMap credit; the page's own
        // .attribution() goes bottom left, as flat shows it
        // (createAttribution).
        //
        // A color `mapType` (mapTypeColor truthy — see
        // buildBlankBackgroundStyle above) has no real basemap at all, so
        // there's no required CARTO/OSM credit to keep — only
        // maplibre-gl's OWN default "MapLibre" attribution badge, which
        // 5.x (unlike the 3.6.2 this was pinned to before) adds even for
        // an empty-sources style. Disabled in exactly that one case;
        // customAttribution's own required-credit behavior for a REAL
        // basemap is left untouched.
        ...(mapTypeColor ? { attributionControl: false } : {}),
        // MapLibre's default (true) is kept: with false it also stops the
        // zoom-out where the world gets narrower than the window, so a
        // world map can't open fully zoomed out. The deck.gl overlay takes
        // its `repeat` from map.getRenderWorldCopies(), so the themes are
        // drawn on every world copy too (flat draws them once; only its
        // basemap tiles wrap). .options({worldcopies: false}) draws the
        // world once, at the cost of that zoom limit.
        renderWorldCopies: this._engineOptions.worldcopies !== false
      });
      _boundsSource = () => {
        const b = map.getBounds();
        return [{ lat: b.getSouth(), lng: b.getWest() }, { lat: b.getNorth(), lng: b.getEast() }];
      };
      // set once by the 'load' event — NOT map.loaded(), which MapLibre turns false again
      // whenever tiles are loading (after every pan/zoom), so a theme defined then would
      // wait for a 'load' that never fires again (SHOW / ZOOMTO, see maybeZoomToTheme)
      let mapHasLoaded = false;

      // flat's page hook ixmaps.htmlgui_onZoomAndPan(nZoom), called after
      // a zoom or a pan of more than 10 px (mapscript2.js 6445-6454) — a
      // broker re-queries its data from it. Read at call time: pages wrap
      // it after loading. flat passes its SVG zoom scale; this passes the
      // flat zoom level, the one value gl has.
      //
      // gl also calls it DURING a zoom (notifyZoomAndPanMidGesture, wired
      // into the throttled refresh below), zoom changes only: the scale
      // gates (featurelower/chartupper ...) switch on the live zoom while
      // the gesture runs, so a page that ties something zoom-dependent to
      // this hook (e.g. a basemap opacity ramp) must be told in the same
      // tick — from 'moveend' alone it arrived after the gate had already
      // flipped (FEATURE gone, basemap still at the old, faint opacity: a
      // blank background until the zoom ended).
      let notifyZoomAndPanMidGesture = () => {};
      {
        let last = null;
        map.on('moveend', () => {
          const hook = pageIxmaps() && pageIxmaps().htmlgui_onZoomAndPan;
          const z = map.getZoom(), c = map.getCenter(), prev = last;
          last = { z, c };
          if (typeof hook !== 'function' || !prev) return;
          const p = map.project(c), q = map.project(prev.c);
          if (z === prev.z && Math.abs(p.x - q.x) <= 10 && Math.abs(p.y - q.y) <= 10) return;
          try { hook.call(global.ixmaps, mapLibreToFlatZoom(z)); } catch (e) { console.error('[ixmaps-gl] htmlgui_onZoomAndPan:', e); }
        });
        notifyZoomAndPanMidGesture = () => {
          const hook = pageIxmaps() && pageIxmaps().htmlgui_onZoomAndPan;
          if (typeof hook !== 'function' || !last) return;
          const z = map.getZoom();
          if (z === last.z) return; // a pan alone waits for 'moveend' (and its 10 px rule)
          last = { z, c: map.getCenter() };
          try { hook.call(global.ixmaps, mapLibreToFlatZoom(z)); } catch (e) { console.error('[ixmaps-gl] htmlgui_onZoomAndPan:', e); }
        };
        // flat calls it on the first draw too (its old zoom is unset then)
        map.once('load', () => {
          last = { z: map.getZoom(), c: map.getCenter() };
          const hook = pageIxmaps() && pageIxmaps().htmlgui_onZoomAndPan;
          if (typeof hook === 'function') { try { hook.call(global.ixmaps, mapLibreToFlatZoom(last.z)); } catch (e) { console.error('[ixmaps-gl] htmlgui_onZoomAndPan:', e); } }
        });
      }

      // Tooltip resolution is per-runtime (each theme's own meta.tooltip
      // template), not generic — a layer id exactly matches one of the
      // pickable ids a runtime's buildDeckLayers() produced (ix-bubbles-/
      // ix-dot-/ix-features-/ix-choropleth- + that runtime's own name);
      // the glow and values (label) layers are pickable:false so they
      // never reach here.
      //
      // Each id-pattern check is paired with the flag(s) that actually
      // produce it, not matched by name alone — necessary now that a
      // CHOROPLETH runtime and its FEATURE base runtime share the SAME
      // .layer() name by design (joinChoroplethFeatures): matching by name
      // alone would make `.find()` return whichever of the two happens to
      // come FIRST in `runtimes` for every layer id, not the one that
      // actually produced it.
      // the theme of each drawn deck.gl layer, by its final id (refreshLayers)
      const layerRuntimeById = new Map();
      function findRuntimeForLayerId(layerId) {
        if (layerRuntimeById.has(layerId)) return layerRuntimeById.get(layerId);
        // icon-atlas-based layer ids (ix-bubbles-/ix-glow-/ix-plot-/
        // ix-grid-) carry a rotating "-gN" generation suffix (see
        // ICON_ATLAS_RESET_AFTER) — strip it before matching so
        // hover/click tooltip lookup keeps working across a rotation.
        // Non-atlas layers (ix-dot-/ix-features-/ix-choropleth-) never
        // carry the suffix; stripping a pattern that isn't there is a
        // no-op.
        const base = layerId.replace(/-g\d+$/, '');
        return runtimes.find(r => {
          if (base === `ix-bubbles-${r.name}`) return isSymbolChart(r.flags);
          if (base === `ix-dot-${r.name}`) return r.flags.has('DOT');
          if (base === `ix-choropleth-${r.name}`) return r.flags.has('CHOROPLETH');
          if (base === `ix-features-${r.name}`) return r.flags.has('FEATURE') || r.flags.has('FEATURES');
          if (base === `ix-plot-${r.name}`) return r.flags.has('GRIDSIZE') && r.flags.has('PLOT');
          if (base === `ix-grid-${r.name}`) return r.flags.has('GRIDSIZE') && !r.flags.has('PLOT');
          return false;
        });
      }

      // hover / click-to-pin tooltips: createTooltips
      const tooltips = createTooltips({ builder: this, map, el, findRuntimeForLayerId });

      const overlay = new MapLibreOverlay({
        interleaved: true,
        layers: [],
        // pointer becomes a hand over anything pickable (bubbles/points),
        // so hovering something clickable actually looks clickable
        getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : (isHovering ? 'pointer' : 'grab')),
        // (guarded: see createTooltips)
        getTooltip: tooltips.getTooltip,
        onClick: tooltips.onClick
      });
      map.addControl(overlay);
      map.addControl(new maplibregl.NavigationControl(), 'top-left');
      tooltips.mount();
      // the page's attribution (.attribution(), Map option attribution)
      const attributionBox = createAttribution(map);
      attributionBox.set(this._attributionText != null ? this._attributionText : this.mapOptions.attribution);
      this._setAttribution = text => attributionBox.set(text);

      if (this._legendHtml && el.parentElement) {
        const legendEl = document.createElement('div');
        legendEl.style.cssText = 'position:absolute;top:0;left:0;z-index:5;pointer-events:none';
        legendEl.innerHTML = this._legendHtml;
        el.parentElement.style.position = el.parentElement.style.position || 'relative';
        el.parentElement.appendChild(legendEl);
      }

      // themes are addressed by either the layer()'s own name (e.g. "AREU")
      // or style.name (e.g. "chart") — the real engine's changeThemeStyle
      // etc. address themes by style.name, so both need to resolve.
      //
      // A CHOROPLETH runtime and its FEATURE geometry-donor base
      // intentionally share the SAME .layer() name (joinChoroplethFeatures)
      // — when a name matches more than one runtime, prefer whichever
      // ISN'T the FEATURE/FEATURES donor: "restyle layer X" always means
      // the visible thematic layer, never its invisible backdrop geometry
      // provider. Same disambiguation problem findRuntimeForLayerId
      // already solves for hover/click picking, above.
      // GL-PORT COMPAT: a real page addresses a theme by whichever of
      // THREE real identifiers it happens to have set at define() time —
      // .layer(name)'s own name, .style({name}), or .meta({name}) — all
      // three are real, live conventions, not this port's own invention:
      // confirmed live as a real bug (mappa_stranieri_30.html's own
      // filter dropdown, which addresses its theme purely by
      // .meta({name:"scuole-pct-stranieri"}), silently no-opped — no
      // error, findRuntime's own console.warn just never matched anything
      // — because this only checked .name/.style.name, missing the third
      // real convention entirely). r.meta.name checked last since it's
      // the one real page found using it, matching the two already-
      // verified conventions' own priority (layer name, then style.name).
      function findRuntime(themeId) {
        const matches = runtimes.filter(r => r.name === themeId || (r.style && r.style.name === themeId) || (r.meta && r.meta.name === themeId));
        if (!matches.length) { console.warn(`[ixmaps-gl] no layer named "${themeId}"`); return undefined; }
        return matches.find(r => !r.flags.has('FEATURE') && !r.flags.has('FEATURES')) || matches[0];
      }

      // Every runtime loaded from the same .data() source (see build()'s
      // _dataSourceKey tag) — used to propagate a facet filter to every
      // theme actually built on that data, not just the one named theme.
      function siblingRuntimes(rt) {
        return runtimes.filter(r => r._dataSourceKey === rt._dataSourceKey);
      }

      const redrawListeners = [];

      // Basemap opacity fade — the real engine's ixmaps.setBasemapOpacity
      // dims the WHOLE basemap container div via a single CSS `opacity`
      // (htmlgui.js:1409-1420, confirmed by direct source read: real
      // callers pass a stray extra leading arg the actual 2-param
      // function silently ignores, making the real "relative" fade a
      // dead no-op there — this port implements the INTENDED 2-arg
      // behavior, not that bug). A single CSS opacity on the map
      // container isn't available to us: this engine's deck.gl overlay
      // is INTERLEAVED (see MapLibreOverlay above), so its bubble layers
      // are injected as MapLibre style layers of type 'custom' sitting
      // among the real basemap's own fill/line/background/symbol layers
      // in the SAME style — dimming the container would dim the bubbles
      // too. Instead this fades every NON-custom style layer's own
      // opacity paint property, leaving deck.gl's 'custom'-type layers
      // (the actual accident bubbles) untouched — the same practical
      // result (basemap fades, thematic data doesn't) reached by a
      // different, interleaving-safe mechanism.
      let _basemapOpacity = 1;
      const OPACITY_PAINT_PROPS = {
        background: ['background-opacity'],
        fill: ['fill-opacity'],
        line: ['line-opacity'],
        raster: ['raster-opacity'],
        'fill-extrusion': ['fill-extrusion-opacity'],
        circle: ['circle-opacity', 'circle-stroke-opacity'],
        symbol: ['icon-opacity', 'text-opacity']
      };
      function applyBasemapOpacity() {
        const style = map.getStyle && map.getStyle();
        if (!style || !style.layers) return;
        style.layers.forEach(layer => {
          // the synthetic solid-color background substituted in for a
          // color `mapType` (see buildBlankBackgroundStyle) IS the page's
          // requested background, not a real basemap to fade — real
          // ixmaps-flat has no basemapopacity concept at all for these
          // (SVG-projection, tile-free) maps, so basemapopacity here would
          // otherwise make the "no basemap" background itself vanish.
          if (layer.id === BLANK_BACKGROUND_LAYER_ID) return;
          const props = OPACITY_PAINT_PROPS[layer.type];
          if (!props) return; // includes 'custom' (deck.gl's own interleaved layers) — left alone
          props.forEach(prop => {
            try { map.setPaintProperty(layer.id, prop, _basemapOpacity); } catch (e) { /* layer may not define this paint property */ }
          });
        });
      }

      let _chainedLayers = Promise.resolve();
      // Jump the live map AND make sure deck.gl follows: deck's picking
      // viewport is synced from the map's move events, and a jump made
      // right after the build (a page's myMap.then(map => map.view(...)))
      // can come before deck's overlay listens — picking then kept the
      // map's FIRST view (hover/click hit the wrong shapes) until the next
      // user pan/zoom. Re-firing 'move' (again once loaded) re-syncs it.
      const jumpLive = (opts) => {
        map.jumpTo(opts);
        map.fire('move');
        if (!map.loaded()) map.once('load', () => map.fire('move'));
        else map.once('idle', () => map.fire('move'));
      };
      let addLegendPanel = () => {}; // set up with the legend, below
      let setLegendOption = () => {}; // map.setLegend(value) — set up with the legend, below
      let updateSubTheme = () => {};
      let layoutLegends = () => {}; // set up with the legend, below
      let setDataLoading = () => {}; // set up with the loads, below
      const engineApi = {
        map,
        overlay,
        // delta: the new absolute opacity (0-1), or a +/- amount when
        // mode==='relative' (matching the real page's own +/- button
        // idiom, e.g. setBasemapOpacity(-0.1,'relative')/(0.1,'relative')).
        // Clamped to [0,1] either way.
        resize: () => { map.resize(); return engineApi; },
        // broker calls in flight (themes whose data comes by name)
        pendingLoads: () => pendingLoads,
        getZoom: () => mapLibreToFlatZoom(map.getZoom()),
        require: (url) => { loadRequiredScripts([url]); return engineApi; },
        // flat's theme-level calls by theme id (style.name / meta.name, else
        // the layer name): add(theme, flag) — "replace" swaps a theme of the
        // same id —, replace(id, theme, flag), remove(id)
        add: (layerBuilder, flag) => {
          _chainedLayers = _chainedLayers.then(() => {
            if (/replace/i.test(flag || '')) {
              const def = layerBuilder.definition();
              const id = (def.style && def.style.name) || (def.meta && def.meta.name);
              if (id) removeThemeById(id);
            }
            return engineApi.defineLayer(layerBuilder);
          }).catch(err => console.error('[ixmaps-gl] map.add():', err));
          return engineApi;
        },
        replace: (id, layerBuilder, flag) => {
          _chainedLayers = _chainedLayers.then(() => { removeThemeById(id); return engineApi.defineLayer(layerBuilder); })
            .catch(err => console.error('[ixmaps-gl] map.replace():', err));
          return engineApi;
        },
        replaceTheme: (id, layerBuilder, flag) => engineApi.replace(id, layerBuilder, flag),
        remove: (id) => { removeThemeById(id); return engineApi; },
        // flat's map.setMapType(id) / setMapTypeId / mapType (htmlgui_flat.js
        // mapApi): swap the basemap at runtime. MapLibre's setStyle replaces
        // the whole style; deck.gl's interleaved overlay re-adds its own
        // layers on 'styledata' by itself. What the new style resets is put
        // back once it has loaded: the projection (globe), the basemap
        // opacity (it is written into the style's paint properties).
        setMapType: (id) => {
          const color = resolveMapTypeColor(id);
          const style = color ? buildBlankBackgroundStyle(color) : resolveBasemapStyleUrl(id);
          const current = color ? null : resolveBasemapStyleUrl(builder.mapOptions.mapType);
          const wasColor = !!resolveMapTypeColor(builder.mapOptions.mapType);
          builder.mapOptions.mapType = id;
          if (!color && !wasColor && style === current) return engineApi; // same style: nothing to reload
          const projection = typeof map.getProjection === 'function' ? map.getProjection() : null;
          map.once('style.load', () => {
            if (projection && projection.type && typeof map.setProjection === 'function') {
              try { map.setProjection({ type: projection.type }); } catch (e) { /* projection unsupported by this build */ }
            }
            applyBasemapOpacity();
          });
          map.setStyle(style);
          return engineApi;
        },
        setMapTypeId: (id) => engineApi.setMapType(id),
        mapType: (id) => engineApi.setMapType(id),
        // flat's getMapTypeId(): the basemap type name in use
        getMapTypeId: () => String(builder.mapOptions.mapType || ''),
        // flat's attribution (htmlgui.js htmlgui_set/getAttributionString)
        setAttribution: (text) => { builder.attribution(text); return engineApi; },
        // flat's map handle ixmaps.map().attribution(text) (htmlgui_flat.js 1381)
        attribution: (text) => engineApi.setAttribution(text),
        getAttribution: () => attributionBox.get(),
        setBasemapOpacity: (delta, mode) => {
          _basemapOpacity = mode === 'relative'
            ? Math.max(0, Math.min(1, _basemapOpacity + (parseFloat(delta) || 0)))
            : Math.max(0, Math.min(1, parseFloat(delta)));
          applyBasemapOpacity();
          return _basemapOpacity;
        },
        runtimes,
        getThemes: () => runtimes.map(r => ({ szId: r.name, meta: r.meta, categoryLabels: r.categoryDisplayLabels || r.categoryLabels || null })),
        // facet browser API (see LayerRuntime.getFacets/setFacetFilter) —
        // viewport + active-filter scoped stats per field, and per-field
        // click-to-filter, matching the real ixmaps facet plugin's
        // observable behavior against this engine's GeoJSON feature model
        getFacets: (themeId, fields, opts) => {
          const rt = findRuntime(themeId);
          return rt ? rt.getFacets(fields, opts) : [];
        },
        // A facet filter is a property of the DATA, not of one theme's
        // own rendering of it — a curves/grid layer sharing the exact
        // same source as the theme the facets sidebar was built against
        // must show the same filtered subset, or toggling it on makes it
        // silently ignore whatever's currently filtered (confirmed as a
        // real, reported gap: the real page's own htmlgui_onDrawTheme
        // hook does this exact propagation by hand — see
        // __incidenti_curves_years_incidenti.style.filter = themeObj.
        // szFilter in the ported Germany page — this engine does it
        // generically instead of requiring every ported page to wire it
        // up itself). Scoped to runtimes sharing the SAME _dataSourceKey
        // (see build()), not literally every theme on the map — broadcasting
        // to an unrelated layer (e.g. a region boundary FEATURES layer
        // with completely different fields) would just find zero matches
        // for that field and incorrectly empty it out.
        setFacetFilter: (themeId, field, value) => {
          const rt = findRuntime(themeId);
          if (rt) { siblingRuntimes(rt).forEach(sib => sib.setFacetFilter(field, value)); refresh(); }
        },
        clearFacetFilter: (themeId, field) => {
          const rt = findRuntime(themeId);
          if (rt) { siblingRuntimes(rt).forEach(sib => sib.clearFacetFilter(field)); refresh(); }
        },
        clearAllFacetFilters: (themeId) => {
          const rt = findRuntime(themeId);
          if (rt) { siblingRuntimes(rt).forEach(sib => sib.clearAllFacetFilters()); refresh(); }
        },
        getActiveFacetFilters: (themeId) => {
          const rt = findRuntime(themeId);
          return rt ? Object.fromEntries(rt.facetFilters) : {};
        },
        setSizeField: (themeId, field) => {
          const rt = findRuntime(themeId);
          if (rt) { rt.setSizeField(field); refresh(); }
        },
        // findings of the opt-in grammar validation (null when it's off)
        getValidationReport: () => (validation ? validation.report.slice() : null),
        setThemeStyle: (themeId, patch) => {
          if (validation) validation.style(themeId, patch);
          const rt = findRuntime(themeId);
          if (rt) { rt.setStyle(patch); refresh(); }
        },
        // GL-PORT COMPAT: real ixmaps-flat's ixmaps.changeThemeStyle(szId,
        // "key:value", "set"|"remove") — a generic, STRING-based style
        // patch API (confirmed used by real ported pages, e.g. a school-
        // type filter dropdown calling changeThemeStyle(id,'filter:WHERE
        // "tipo" == "X"', "set") / changeThemeStyle(id,"filter","remove")).
        // Only the "filter" key is implemented — the one real page found
        // using this only ever patches filter, and this engine's own
        // setThemeStyle(patch) already covers arbitrary OBJECT-shaped
        // style patches for everything else a page would reach for. A
        // "filter:WHERE ..." value reuses rt.setRuntimeFilter, the SAME
        // applyWhereFilter grammar the layer's own load-time .filter()
        // already parses — just invoked again at runtime.
        changeThemeStyle: (themeId, styleKeyValue, action) => {
          const rt = findRuntime(themeId);
          if (!rt) return;
          const colonIdx = String(styleKeyValue).indexOf(':');
          const key = colonIdx === -1 ? String(styleKeyValue) : styleKeyValue.slice(0, colonIdx);
          const value = colonIdx === -1 ? '' : styleKeyValue.slice(colonIdx + 1);
          if (validation) validation.style(themeId, { [key]: value });
          if (key === 'filter') {
            rt.setRuntimeFilter(action === 'remove' ? '' : value);
            refresh();
          } else if (key === 'type') {
            console.warn(`[ixmaps-gl] changeThemeStyle: changing the type ("${value}") is not supported`);
          } else {
            // any other style key, as flat: "set" writes it, "remove" drops it
            rt.setStyle({ [key]: /remove/.test(action || '') ? undefined : value });
            refresh();
          }
        },
        // flat's ixmaps.setThemeTimeFrame(szId, min, max): show only the
        // records whose timefield lies in [min, max) (ms or Date-
        // parsable). null min+max clears. szId null/undefined = every theme
        // that has a timefield (flat: one call updates all themes at once).
        setThemeTimeFrame: (themeId, min, max) => {
          const targets = themeId == null ? runtimes.filter(r => r.binding && r.binding.time) : (() => {
            const rt = findRuntime(themeId);
            return rt ? siblingRuntimes(rt).filter(r => r.binding && r.binding.time) : [];
          })();
          targets.forEach(rt => rt.setTimeFrame(min, max));
          if (targets.length) refresh();
        },
        // shows/hides a whole theme (all the deck.gl layers its
        // buildDeckLayers would otherwise produce) without touching its
        // data or style — for toggle controls like the real page's
        // "incidenti/feriti per anno" checkbox, which switches an entire
        // PLOT+GRIDSIZE overlay (and its grid-mesh companion) on and off.
        setThemeVisible: (themeId, visible) => {
          const rt = findRuntime(themeId);
          if (rt) { rt._hidden = !visible; refresh(); }
        },
        getCategoryColor: (themeId, value) => {
          const rt = findRuntime(themeId);
          if (!rt || !rt.categoryIndexByLabel) return null;
          const idx = rt.categoryIndexByLabel.get(value);
          return idx == null ? null : rt.categoryColorsRgb[idx];
        },
        // called after every redraw (pan/zoom, or any of the setters above)
        // so a page can keep a facets sidebar in sync, mirroring the real
        // engine's htmlgui_onDrawTheme hook
        onRedraw: (cb) => { redrawListeners.push(cb); },
        refresh: () => refresh(),
        // Adds ONE new layer/theme to an ALREADY-BUILT map — build()'s own
        // loop above only ever runs once, at construction, so a caller
        // that needs to add a theme dynamically after the map exists (a
        // wizard/loader UI letting the user pick a dataset/viz AFTER the
        // map is already on screen, rather than a page whose layers are
        // all known upfront) previously had no way to do that at all.
        // Deliberately PURELY ADDITIVE — it does not remove any existing
        // runtime sharing the new one's name, even though the real
        // engine's own convention is "defining a theme with the same name
        // replaces the old one". Two real layers can legitimately share
        // one name on purpose here (a CHOROPLETH's FEATURE geometry donor
        // — see joinChoroplethFeatures — is looked up by exact name
        // match), so silently auto-removing on name collision would
        // delete a donor the very next line's overlay still needs. The
        // caller (which knows whether a name collision means "replace"
        // or "these are meant to coexist") is expected to call
        // removeTheme() itself first when it actually wants a replace —
        // exactly how this engine's own facet-filter/style setters below
        // already push responsibility for "what should happen" to the
        // caller rather than guessing.
        defineLayer: (layerBuilder) => defineFromDefinition(layerBuilder.definition()),
        // GL-PORT COMPAT: real ixmaps-flat's map handle, as a page gets it
        // from `myMap.then(map => map.view(...).options(...).layer(a)
        // .layer(b))` — the common multi-layer idiom — is chainable on the
        // LIVE map: view() jumps it, options() changes the running options,
        // layer() adds a layer. Layers are defined one after the other,
        // in call order, so a CHOROPLETH finds the FEATURE base that the
        // chain added just before it (defineLayer itself is async).
        view: (latlonOrOpts, zoom) => {
          const isOpts = latlonOrOpts && typeof latlonOrOpts === 'object' && !Array.isArray(latlonOrOpts) && latlonOrOpts.center;
          const c = isOpts ? latlonOrOpts.center : latlonOrOpts;
          const z = isOpts ? latlonOrOpts.zoom : zoom;
          if (c) {
            const lngLat = Array.isArray(c) ? [c[1], c[0]] : [c.lng, c.lat];
            jumpLive(Object.assign({ center: lngLat }, z != null ? { zoom: flatToMapLibreZoom(Number(z)) } : {}));
          }
          return engineApi;
        },
        options: (o) => {
          if (o && typeof o === 'object') {
            Object.assign(builder._engineOptions, o);
            // read only when the MapLibre map is created — switched here at runtime
            if ('worldcopies' in o) map.setRenderWorldCopies(o.worldcopies !== false && o.worldcopies !== 'false');
            refresh();
          }
          return engineApi;
        },
        // the `legend` map option at runtime (see setLegendOption)
        setLegend: (opt) => { setLegendOption(opt); return engineApi; },
        layer: (nameOrBuilder) => {
          if (typeof nameOrBuilder !== 'string') {
            const lb = nameOrBuilder;
            _chainedLayers = _chainedLayers.then(() => engineApi.defineLayer(lb))
              .catch(err => console.error('[ixmaps-gl] map.layer():', err));
            return engineApi;
          }
          // map.layer(name).data()...define(): replaces a theme of that name
          const lb = new LayerBuilder(nameOrBuilder);
          lb.define = () => {
            _chainedLayers = _chainedLayers.then(() => { engineApi.removeTheme(nameOrBuilder); return engineApi.defineLayer(lb); })
              .catch(err => console.error('[ixmaps-gl] map.layer().define():', err));
            return _chainedLayers;
          };
          return lb;
        },
        // Real ixmaps-flat's loadProject (htmlgui.js loadProject →
        // setProjectJSON → continueSetProjectJSON): src is a project object,
        // a JSON string, or a URL (fetched as DATA — nothing a project names
        // is ever run). Resolves to { themes, skipped, notes }; see
        // applyProject for the flags and what is (not) applied.
        loadProject: async (src, flags) => {
          let project = src;
          if (typeof src === 'string') {
            const s = src.trim();
            if (s.startsWith('{')) project = JSON.parse(s);
            else {
              const resp = await fetch(s);
              if (!resp.ok) throw new Error(`[ixmaps-gl] loadProject: ${s} → HTTP ${resp.status}`);
              project = await resp.json();
            }
          }
          return applyProject(project, flags);
        },
        // Removes every runtime whose OWN .layer(name) matches — a theme
        // may legitimately be split across more than one runtime sharing
        // one name (the CHOROPLETH/FEATURE-donor pair above), so this
        // removes all of them, not just the first match.
        removeTheme: (name) => removeRuntimes(name, runtimes.filter(r => r.name === name)),
        // flat's refreshTheme (maptheme.js Themes.refreshTheme): the
        // theme's data is loaded again — a broker is called again — and
        // replaces the old features in place (draw order, legend, style
        // changes and facet filters kept). A broker's theme writes from
        // its first call stay; later calls only bring new data.
        refreshTheme: async (name) => {
          // by layer name, or by theme id (style.name / meta.name) as flat
          const byId = runtimes.filter(r => r._definition && ((r.style && r.style.name === name) || (r.meta && r.meta.name === name)));
          const targets = byId.length ? byId : runtimes.filter(r => r.name === name && r._definition);
          for (const rt of targets) {
            if (rt._named) { await loadNamedTheme(rt, true); continue; }
            const spec = normalizeTheme(rt._definition);
            // flat's refresh reloads, cache or not (maptheme.js 2366: datacache = false);
            // the fresh result also replaces the cached one for later themes
            const raw = spec.data && spec.data.obj
              ? await fetchLayerData(spec.data, rt._specBinding, builder._engineOptions)
              : await cachedLayerData(builder._dataCache, spec.data, rt._specBinding, builder._engineOptions, { reload: true }).promise;
            const filtered = applyWhereFilter(raw, spec.filter);
            rt.replaceFeatures(filtered.type === 'Table' ? joinTableFeatures(spec, filtered, runtimes) : filtered);
            maybeZoomToTheme(rt); // a scale-deferred theme gets its first data here
          }
          if (targets.length) { refresh(); notifyRedraw(); }
        }
      };

      // removes the given runtimes (all sharing `name`) from this map
      function removeRuntimes(name, removedRuntimes) {
        removedRuntimes.forEach(rt => {
          const i = runtimes.indexOf(rt); if (i >= 0) runtimes.splice(i, 1);
          if (rt._unlisten) rt._unlisten();
          if (rt._cancelWait) rt._cancelWait();
          clearTimeout(rt._dependentTimer);
        });
        const removed = removedRuntimes.length > 0;
        // stale-registry guard: _globalThemeRegistry is a bare name->
        // runtime map (see its own comment) that can hold at most one
        // entry per name — only clear it if it's actually pointing at
        // one of the runtime(s) just removed, not a DIFFERENT map's
        // still-live runtime that happens to share the same name.
        if (removedRuntimes.includes(_globalThemeRegistry.get(name))) {
          _globalThemeRegistry.delete(name);
        }
        // Same stale-registry guard, for the meta.name registration
        // findRuntime's own comment documents (a removed runtime may
        // have been ALSO reachable by a meta.name distinct from its
        // .layer() name — leaving that second entry behind would let a
        // later ixmaps.getThemeObj(metaName) call resolve a runtime this
        // API just told the caller was removed).
        removedRuntimes.forEach(rt => {
          if (rt.meta && rt.meta.name && rt.meta.name !== name && _globalThemeRegistry.get(rt.meta.name) === rt) {
            _globalThemeRegistry.delete(rt.meta.name);
          }
        });
        removedRuntimes.forEach(rt => {
          if (rt._legendPanel && rt._legendPanel.parentNode) rt._legendPanel.parentNode.removeChild(rt._legendPanel);
          if (rt._subTheme) { const i = runtimes.indexOf(rt._subTheme); if (i >= 0) runtimes.splice(i, 1); rt._subTheme = null; }
        });
        if (removed) { refresh(); notifyRedraw(); }
        return removed;
      }
      // flat addresses a theme by its id — style.name / meta.name (several
      // themes may share one layer), else the layer name
      function removeThemeById(id) {
        const named = runtimes.filter(r => (r.style && r.style.name === id) || (r.meta && r.meta.name === id));
        if (named.length) return removeRuntimes(named[0].name, named);
        return engineApi.removeTheme(id);
      }

      // ---- themes whose data comes by name (namedDataTheme) ----
      // loadNamedTheme: a broker theme calls its broker (again with force —
      // refreshTheme — or when its named table isn't there yet); any other
      // takes the named table, or waits for it. The features are replaced
      // in place. Broker calls in flight are counted (pendingLoads).
      let pendingLoads = 0;
      // flat's loading message while a theme's external data loads
      // (htmlgui.js 3446-3448: showLoadingArray(["loading data ...", " ... "])
      // for every broker load, hidden when its data is handed over; none
      // with the silent / loadsilent options): a spinner and the text,
      // translated by the page's .local() dictionary, centred on the map
      const optFlag = v => v === true || v === 'true' || v === 1 || v === '1';
      const loadSilent = [this.mapOptions, this._engineOptions].some(o => o && (optFlag(o.silent) || optFlag(o.loadsilent)));
      const localText = makeLocalText(this._locals);
      let loadingEl = null, loadingTimer = null;
      // only loads of themes shown at this scale count: a broker that waits
      // for other data (the page's section merge, empty at the national
      // view) behind an out-of-scale theme kept the message up for good
      setDataLoading = () => {
        if (loadSilent || !el.parentElement) return;
        const z = map.getZoom();
        const shownLoading = runtimes.some(r => r._brokerLoading > 0 && !r._hidden && !themeHiddenByScale(r.flags, r.style, z));
        if (shownLoading) {
          if (!loadingEl) {
            ensureLoadingStyle();
            loadingEl = document.createElement('div');
            loadingEl.className = 'ixmaps-gl-loading';
            loadingEl.innerHTML = '<span class="ixmaps-gl-loading-spin"></span><span class="ixmaps-gl-loading-text"></span>';
            el.appendChild(loadingEl);
          }
          const msgs = [localText('loading data ...'), localText(' ... ')];
          let i = 0;
          loadingEl.querySelector('.ixmaps-gl-loading-text').textContent = msgs[0];
          loadingEl.style.display = 'flex';
          clearInterval(loadingTimer);
          // flat alternates its messages
          loadingTimer = setInterval(() => { i = (i + 1) % msgs.length; if (loadingEl) loadingEl.querySelector('.ixmaps-gl-loading-text').textContent = msgs[i].trim() ? msgs[i] : msgs[0]; }, 1500);
        } else if (loadingEl) {
          clearInterval(loadingTimer);
          loadingEl.style.display = 'none';
        }
      };
      // SHOW / ZOOMTO: zoom to the theme's extent the first time it has
      // features on a loaded map (see featuresBounds), then never again for
      // this definition — as flat drops the flag after its zoomTo()
      function maybeZoomToTheme(rt) {
        if (!rt || !rt._zoomToPending || !mapHasLoaded || !runtimes.includes(rt)) return;
        const bounds = featuresBounds(rt.features);
        if (!bounds) return; // no data yet (named / deferred): wait for it
        rt._zoomToPending = false;
        const [[w, s], [e, n]] = bounds;
        if (w === e && s === n) map.jumpTo({ center: [w, s], zoom: Math.max(map.getZoom(), 12) });
        else map.fitBounds(bounds, { padding: 30, animate: false, maxZoom: 16 });
      }

      async function loadNamedTheme(rt, force) {
        const spec = normalizeTheme(rt._definition);
        const name = String(spec.data.name);
        const broker = brokerTheme(spec);
        rt._loading = (rt._loading || 0) + 1;
        if (broker) { pendingLoads++; rt._brokerLoading = (rt._brokerLoading || 0) + 1; setDataLoading(); }
        try {
          let table = namedTable(name), patch = null;
          if (broker && (force || !table)) {
            const r = await loadBrokerOnce(spec, builder._engineOptions, force);
            table = r.table; patch = r.patch;
          } else if (!table) {
            const w = waitForNamedData(name, 0);
            rt._cancelWait = w.cancel;
            table = await w.promise;
          }
          await built;
          if (runtimes.includes(rt)) { fillNamedTheme(rt, spec, table, patch); maybeZoomToTheme(rt); }
        } catch (err) {
          // a broker that hands nothing over yet is normal in flat (it may
          // wait for other data); the theme stays empty until a refresh
          if (/no data ".*" handed over/.test(String(err && err.message))) console.warn(`[ixmaps-gl] theme "${themeIdOf(rt)}": ${err.message}; it stays empty until refreshed`);
          else console.error(`[ixmaps-gl] theme "${themeIdOf(rt)}": no data —`, err);
        } finally {
          rt._loading--;
          if (broker) { pendingLoads--; rt._brokerLoading--; setDataLoading(); }
        }
      }
      function namedThemeFeatures(spec, rows, binding) {
        const filtered = applyWhereFilter(rowsResult(rows, binding || spec.binding), spec.filter);
        return filtered.type === 'Table' ? joinTableFeatures(spec, filtered, runtimes) : filtered;
      }
      function fillNamedTheme(rt, spec, table, patch) {
        rt._lastTable = table;
        const rows = table ? table.json() : [];
        const w = patch && patch.writes, st = patch && patch.style;
        if (!rt._patched && ((w && Object.keys(w).length) || (st && Object.keys(st).length))) {
          // a broker's theme writes (its fields, title, …) apply to the
          // theme, as flat; style changes the page made since stay
          const pspec = normalizeTheme(applyBrokerThemePatch(rt._definition, patch));
          rt._patched = true;
          rt.binding = rt._specBinding = pspec.binding;
          rt.flags = pspec.flags;
          rt.meta = pspec.meta;
          rt.style = Object.assign({}, pspec.style, rt._styleSet || {});
          rt._filterExpr = pspec.filter || '';
          spec = pspec;
        }
        rt.replaceFeatures(namedThemeFeatures(spec, rows, rt._specBinding));
        if (glDebug()) console.info(`[ixmaps-gl debug] data for ${themeIdOf(rt)}: ${rows.length} rows → ${rt.features.length} features`);
        // the legend is built from the theme's classes: build it again
        if (rt._legendPanel && rt._legendPanel.parentNode) rt._legendPanel.parentNode.removeChild(rt._legendPanel);
        rt._legendPanel = null;
        addLegendPanel(rt);
        if (rt.flags.has('FEATURE') || rt.flags.has('FEATURES')) featureDependents(rt);
        refresh();
        notifyRedraw();
      }
      // every live theme of the name reloads when new data of that name
      // arrives (not its own broker call, which fills it itself)
      function listenNamedData(rt) {
        const name = String(normalizeTheme(rt._definition).data.name);
        const set = _namedDataListeners.get(name) || new Set();
        _namedDataListeners.set(name, set);
        const fn = table => {
          if (rt._loading || rt._deferredLoad || rt._lastTable === table || !runtimes.includes(rt)) return;
          built.then(() => fillNamedTheme(rt, normalizeTheme(rt._definition), table, null));
        };
        set.add(fn);
        rt._unlisten = () => set.delete(fn);
      }
      // flat, after a FEATURE theme is drawn (maptheme.js 18947-18962): the
      // other themes on its layer are placed again, and a data.query broker
      // among them is refreshed 500 ms later
      function featureDependents(featureRt) {
        runtimes.forEach(dep => {
          if (dep === featureRt || dep.flags.has('FEATURE') || dep.flags.has('FEATURES')) return;
          if (!String(dep.name).split('|').includes(featureRt.name)) return;
          const spec = normalizeTheme(dep._definition || {});
          if (dep._named && spec.data && spec.data.query) {
            clearTimeout(dep._dependentTimer);
            dep._dependentTimer = setTimeout(() => { if (runtimes.includes(dep)) loadNamedTheme(dep, true); }, 500);
          } else if (dep._named && dep._lastTable && !dep._loading) {
            fillNamedTheme(dep, spec, dep._lastTable, null);
          }
        });
      }

      // One theme definition (real ixmaps-flat's shape — from a builder's
      // definition() or a project file) → a new runtime on this map. Shared
      // by defineLayer and loadProject. Purely additive, see defineLayer.
      async function defineFromDefinition(def) {
        if (validation) validation.definition(def);
        const pdef = projectThemeToDefinition(def);
        let spec = normalizeTheme(pdef);
        let raw;
        const deferred = deferredFeatureLoad(spec, map.getZoom());
        const named = namedDataTheme(spec);
        let sourceKey = null;
        if (deferred || named) {
          raw = { type: 'FeatureCollection', features: [] };
        } else if (spec.data && spec.data.obj) {
          // in memory already — nothing to cache (see build())
          raw = await fetchLayerData(spec.data, spec.binding, builder._engineOptions);
        } else {
          const cached = cachedLayerData(builder._dataCache, spec.data, spec.binding, builder._engineOptions);
          sourceKey = cached.sourceKey;
          raw = await cached.promise;
        }
        const filtered = applyWhereFilter(raw, spec.filter);
        const fc = filtered.type === 'Table' ? joinTableFeatures(spec, filtered, runtimes) : filtered;
        const rt = new LayerRuntime(spec, fc, builder._engineOptions);
        rt._definition = pdef; // for refreshTheme
        rt._deferredLoad = deferred;
        rt._named = named;
        rt._zoomToPending = wantsZoomToExtent(spec.flags);
        rt._dataSourceKey = named ? 'name:' + spec.data.name
          : sourceKey || JSON.stringify({ url: spec.data && spec.data.url, urls: spec.data && spec.data.urls, type: spec.data && spec.data.type, query: spec.data && spec.data.query, obj: !!(spec.data && spec.data.obj) });
        runtimes.push(rt);
        _globalThemeRegistry.set(rt.name, rt);
        if (rt.meta && rt.meta.name && rt.meta.name !== rt.name) _globalThemeRegistry.set(rt.meta.name, rt);
        if (themeIdOf(rt) !== rt.name) _globalThemeRegistry.set(themeIdOf(rt), rt);
        addLegendPanel(rt);
        notifyNewTheme(rt);
        refresh();
        notifyRedraw();
        maybeZoomToTheme(rt); // before the map's 'load': its handler zooms pending themes
        if (named) { listenNamedData(rt); if (!deferred) loadNamedTheme(rt, false); }
        return rt.name;
      }

      const builder = this;
      // Applies a real ixmaps-flat project object, following flat's own
      // continueSetProjectJSON:
      //   - map part (skipped with the flags themeonly/add/replace): flat's
      //     map file picks the projection (its generic orthographic map →
      //     globe, anything else → mercator; flat's own SVG maps can't be
      //     loaded here and are noted), center/zoom set the view (unless
      //     keepview/nonewview), options and scaleParam.normalSizeScale go
      //     into this map's options. The basemap is not switched (noted).
      //     Older projects keep the map part at the top level (map = path).
      //   - themes (skipped with maponly): without "add", the first theme
      //     clears every existing one; with "replace", a theme carrying a
      //     style.name/meta.name replaces the theme of that name. Defined in
      //     order (a CHOROPLETH needs its FEATURE layer first). A theme that
      //     fails is skipped with a warning; the others still load.
      //   - never run: project.required/require scripts, data.process
      //     functions; data.ext scripts (processing scripts and brokers)
      //     only under the page's .options({trustedscripts}) (see
      //     loadProcessingScript, loadBrokerData) — noted / reported.
      // Flags are matched as substrings, like flat (szFlag.match(/add/i)).
      async function applyProject(project, flags) {
        if (!project || typeof project !== 'object') throw new Error('[ixmaps-gl] loadProject: not a project object');
        const f = String(flags || '');
        const report = { themes: [], skipped: [], notes: [] };
        if (project.required || project.require) report.notes.push('project scripts (required/require) are never run by ixmaps-gl');

        const m = typeof project.map === 'string'
          ? { map: project.map, center: project.center, zoom: project.zoom, options: project.options, scaleParam: project.scaleParam, basemap: project.basemap }
          : project.map;
        if (m && typeof m === 'object' && !/themeonly|add|replace/i.test(f)) applyProjectMap(m, f, report);

        const themes = Array.isArray(project.themes) ? project.themes : (project.theme ? [project.theme] : []);
        if (!/maponly/i.test(f)) {
          for (let i = 0; i < themes.length; i++) {
            const t = themes[i] || {};
            const name = (t.style && t.style.name) || (t.meta && t.meta.name);
            if (/replace/i.test(f) && name) removeThemesNamed(name);
            else if (i === 0 && !/add/i.test(f)) [...new Set(runtimes.map(r => r.name))].forEach(n => engineApi.removeTheme(n));
            try {
              report.themes.push(await defineFromDefinition(withoutProjectCode(t, report)));
            } catch (e) {
              report.skipped.push({ layer: t.layer, reason: e.message });
            }
          }
        }
        if (report.skipped.length || report.notes.length) {
          console.warn('[ixmaps-gl] loadProject:', [...report.notes, ...report.skipped.map(x => `theme "${x.layer}" skipped — ${x.reason}`)].join('; '));
        }
        return report;
      }

      function applyProjectMap(m, f, report) {
        const svg = String(m.map || '');
        if (svg && !/generic\/(mercator|orthographic)\.svg$/i.test(svg)) report.notes.push(`flat SVG map "${svg.split('/').pop()}" is not available in ixmaps-gl — mercator used`);
        if (typeof map.setProjection === 'function') {
          try { map.setProjection({ type: /orthographic\.svg$/i.test(svg) ? 'globe' : 'mercator' }); }
          catch (e) { console.warn('[ixmaps-gl] loadProject: map.setProjection failed (needs maplibre-gl >=5.0.1)', e); }
        } else {
          console.warn('[ixmaps-gl] loadProject: map.setProjection not available on the loaded maplibre-gl build (needs >=5.0.1) — projection unchanged');
        }
        if (!/keepview|nonewview/i.test(f)) {
          // project files often store these as strings ("14", "40.72…")
          const c = m.center || {};
          const lat = Number(c.lat), lng = Number(c.lng);
          const z = m.zoom != null && m.zoom !== '' ? Number(m.zoom) : NaN;
          if (Number.isFinite(lat) && Number.isFinite(lng)) jumpLive(Object.assign({ center: [lng, lat] }, Number.isFinite(z) ? { zoom: flatToMapLibreZoom(z) } : {}));
          else if (Number.isFinite(z)) jumpLive({ zoom: flatToMapLibreZoom(z) });
        }
        // a project can't authorize its own scripts — trustedscripts is the page's
        if (m.options && typeof m.options === 'object') {
          const o = Object.assign({}, m.options);
          if ('trustedscripts' in o) { delete o.trustedscripts; report.notes.push('the project\'s options.trustedscripts is ignored — only the page can set it'); }
          Object.assign(builder._engineOptions, o);
        }
        if (m.scaleParam && m.scaleParam.normalSizeScale != null) builder._engineOptions.normalSizeScale = m.scaleParam.normalSizeScale;
        if (m.basemap) report.notes.push(`basemap "${m.basemap}" not switched (ixmaps-gl keeps the map's own basemap)`);
      }

      // flat addresses a theme by its style.name/meta.name as well as its layer
      function removeThemesNamed(name) {
        [...new Set(runtimes.filter(r => r.name === name || (r.style && r.style.name === name) || (r.meta && r.meta.name === name)).map(r => r.name))]
          .forEach(n => engineApi.removeTheme(n));
      }

      // Rebuilds the deck.gl layers only — measured at ~5ms even fully
      // zoomed out over the whole dataset, cheap enough to run on every
      // throttled pan/zoom tick AT A SETTLED zoom. During an ACTIVE zoom
      // gesture, every runtime is instead built against the last SETTLED
      // zoom (stableGridZoom, frozen while isZooming, updated at
      // 'zoomend') rather than the live one — for two independent, both
      // real, reasons:
      //   - GRIDSIZE's world-pixel grid math round-trips through this
      //     same zoom both when binning cells and when placing their
      //     icons, and deck.gl's viewport renders at the real fractional
      //     zoom too — an exact-but-CHANGING zoom rebins the grid (and
      //     re-renders every PLOT/grid icon) on every throttled tick
      //     while still mid-gesture, visibly swimming; it also uses fixed
      //     on-screen pixel sizes (getSize: cellPx), so those boxes stay
      //     a constant screen size while the basemap scales beneath them
      //     mid-gesture — floating and misaligned. GRIDSIZE layers are
      //     hidden outright (not just frozen) for the gesture's duration,
      //     below, and pop back in once zoomend snaps everything to the
      //     new level.
      //   - BUBBLE/DOT aggregation (grid, per zoom) re-aggregates on every
      //     distinct zoom it's queried at, each producing its own new set
      //     of aggregated group icons through _buildBubbleIcon. A smooth
      //     zoom gesture passes through MANY intermediate zoom levels in
      //     quick succession, and the icon cache is never evicted — so
      //     confirmed live, a real scroll-wheel zoom accumulates icons
      //     from every one of those intermediate clustering states over
      //     the course of one gesture, eventually overflowing deck.gl's
      //     shared icon atlas into solid black squares, on top of being
      //     visibly slow (a fresh aggregation + icon batch on every
      //     throttled tick, repeatedly, for the whole gesture). A single
      //     `setZoom` jump to the SAME end zoom — one clustering pass —
      //     renders perfectly clean, confirming the accumulation, not any
      //     single frame, is the cause. Freezing clustering to one config
      //     for the gesture's duration (same as GRIDSIZE) bounds this.
      //
      // `liveZoom` (always the real current zoom, never frozen) is passed
      // through alongside the frozen `zoom` — CHART/SYMBOL's
      // objectscaling:"dynamic" symbol-size term uses it specifically
      // (see _buildChartLayers), so bubbles keep growing/shrinking in
      // real time as the user actively zooms, even though clustering
      // itself stays frozen. Safe to do continuously: _getGlowIcon/
      // _buildBubbleIcon cache their raster by color/proportions only,
      // never by size, so resizing the SAME cached icon every frame
      // creates no new atlas entries — none of the reclustering risk
      // above applies to a pure size change.
      function refreshLayers() {
        const liveZoom = map.getZoom();
        // frozen only while MapLibre really is zooming (see 'moveend')
        const zoom = isZooming && map.isZooming() ? stableGridZoom : liveZoom;
        const viewMoving = map.isMoving();
        const bounds = map.getBounds();
        const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
        // Only meaningful under globe projection (see buildDeckLayers'
        // own comment on the far-hemisphere bubble leak this fixes) —
        // null under mercator, where every in-bbox point is always on
        // the visible, flat surface and there's no "far side" to hide.
        const proj = (typeof map.getProjection === 'function' && map.getProjection()) || { type: 'mercator' };
        const globeCenter = proj.type === 'globe' ? map.getCenter() : null;
        let layers = [];
        const layerOwner = new Map();
        // a choropleth whose sub-theme is active is not drawn: in flat the
        // sub-theme re-paints the SAME map shapes (fill and fill-opacity),
        // so it replaces the parent's colors rather than lying over them
        runtimes.forEach(rt => {
          if (rt._subTheme) return;
          // a theme that fails to draw is left out (reported once), the
          // others still draw — as flat skips a theme it can't realize
          // USER charts are drawn once the map stands still (see
          // _buildUserChartLayers)
          rt._viewMoving = viewMoving;
          try {
            const built = rt.buildDeckLayers(zoom, bbox, liveZoom, globeCenter);
            built.forEach(l => layerOwner.set(l, rt));
            layers.push(...built);
            rt._drawError = null;
          } catch (err) {
            if (!rt._drawError) console.error(`[ixmaps-gl] theme "${themeIdOf(rt)}" not drawn:`, err);
            rt._drawError = err;
          }
        });
        if (isZooming && map.isZooming()) layers = layers.filter(l => !(l.id.startsWith('ix-plot-') || l.id.startsWith('ix-grid-')));
        // flat paints FEATURE/CHOROPLETH themes on the map's shapes and draws
        // charts in their own group above them: whatever the theme order
        // (a choropleth swapped in with add(..., 'replace') comes last), the
        // shapes lie under the charts — in theme order among themselves
        const isShape = l => /^ix-(features|choropleth|shadow)-/.test(l.id);
        layers = layers.filter(isShape).concat(layers.filter(l => !isShape(l)));
        // every deck.gl layer id once: two themes of one layer name and type
        // (the page's comune points and comune polygons, both FEATURES on
        // "ITALIA_Comuni_…") made two ix-features-… layers with the same id,
        // and deck.gl matched both to one layer state — polygons drawn with
        // another layer's vertices, triangles across the map until the next
        // redraw. A repeated id gets ~2, ~3 … in theme order (stable between
        // redraws); layerRuntimeById maps the final id to its theme for
        // tooltips and clicks.
        const seenIds = new Map();
        layerRuntimeById.clear();
        layers = layers.map(l => {
          const n = (seenIds.get(l.id) || 0) + 1;
          seenIds.set(l.id, n);
          const owner = layerOwner.get(l);
          const out = n > 1 ? l.clone({ id: l.id + '~' + n }) : l;
          if (owner) layerRuntimeById.set(out.id, owner);
          return out;
        });
        if (glDebug()) {
          const order = layers.map(l => l.id).join(' < ');
          if (order !== refreshLayers._lastOrder) { refreshLayers._lastOrder = order; console.info('[ixmaps-gl debug] draw order (bottom → top): ' + order); }
        }
        overlay.setProps({ layers });
      }

      // isZooming flips true/false on every 'zoomstart'/'zoomend' pair —
      // and a scroll-wheel or trackpad zoom fires MANY such pairs per
      // second (one per wheel tick, not one for the whole gesture), not
      // just a single pair for a whole drag-to-zoom gesture. Calling
      // refreshLayers() directly from 'zoomstart' (an earlier version of
      // this code did, to hide GRIDSIZE layers instantly) bypassed the
      // 150ms throttle entirely — on a fast scroll-wheel zoom that meant
      // dozens of full, UNTHROTTLED layer rebuilds per second, each
      // re-running the grid aggregation (_computeAggregatedItems) and
      // regenerating bubble icons for every visible runtime, not just the
      // GRIDSIZE ones. Confirmed live: this made zooming visibly slow and
      // blocking, and the resulting churn of rapid, closely-spaced
      // reclustering could throw more distinct icons at deck.gl's atlas
      // in a shorter window than before, undermining the icon-cache
      // fixes above. 'zoomstart' now only flips the flag (free); the
      // already-throttled 'move' handler (fired continuously during any
      // zoom too) picks up the hide/show within one 150ms tick — still
      // effectively instant, without the unthrottled rebuild storm.
      let isZooming = false;
      let stableGridZoom = map.getZoom();
      map.on('zoomstart', () => { isZooming = true; });
      map.on('zoomend', () => {
        isZooming = false;
        stableGridZoom = map.getZoom();
        // Was: clearTimeout(refreshTimer); refreshLayers(); — a DIRECT,
        // un-throttled rebuild on every single zoomend. That was fine
        // while every runtime's per-tick cost was cheap (viewport-scoped
        // rank only), but confirmed live as a real, severe regression
        // once world-wide _ensureAggregateStats() started running
        // unconditionally on every _buildChartLayers call (Z-LEVEL
        // thresholds fix, see _ensureAggregateStats): a real trackpad/
        // wheel pinch fires zoomstart/zoomend in many rapid MICRO-pairs
        // (documented above — one per wheel tick, not one per whole
        // gesture), so this direct call fired a ~15-20ms WORLD-WIDE
        // reclustering pass on EVERY micro-tick — measured ~130 calls /
        // ~500ms of cumulative blocking work for a single fast zoom
        // gesture, main-thread-blocking severely enough to visibly
        // flicker and to cascade into MapLibre tile-request cancel/retry
        // storms (thousands of duplicate basemap tile fetches). Fixed by
        // routing through the SAME 150ms trailing-call throttle already
        // used for 'move' (scheduleRefresh) instead of bypassing it: a
        // burst of rapid zoomend calls within one throttle window now
        // collapses into a single trailing refresh, while an isolated
        // zoom (no recent 'move'/'zoomend' activity) still refreshes
        // immediately, since scheduleRefresh's own elapsed-time check
        // fires it right away in that case. 'moveend' below remains the
        // final unconditional correctness guarantee regardless of how
        // many micro-pairs this collapses.
        scheduleRefresh();
      });
      // Safety net: 'moveend' is MapLibre's own single, authoritative
      // "interaction is now FULLY settled" signal — fires exactly once
      // after ANY pan/zoom/pinch/wheel sequence ends, regardless of how
      // many zoomstart/zoomend micro-pairs or throttled 'move' ticks
      // happened along the way. Confirmed reproducible-in-spirit even
      // though not pinned to an exact root cause: a user-reported "zoomed
      // out with a trackpad, new area never got its own symbols, even
      // after waiting" is exactly the symptom of some earlier refresh in
      // the sequence being the last one that actually ran. This call is
      // deliberately NOT throttled and always uses the CURRENT live zoom
      // (not stableGridZoom) — by the time 'moveend' fires the gesture is
      // over, so there's no reclustering-mid-gesture risk left to guard
      // against, only a guarantee that whatever the final view is, it
      // gets one last unconditional, correct render.
      map.on('moveend', () => {
        clearTimeout(refreshTimer);
        // the movement is over: the grid zoom is the live one. Not left to
        // 'zoomend' alone — a zoom whose 'zoomend' never came (a zoom
        // interrupted by a pan, a trackpad gesture) left isZooming true,
        // and every later refresh aggregated at the frozen stableGridZoom:
        // the same arrows at every zoom, while the scale gates (liveZoom)
        // still switched.
        isZooming = false;
        stableGridZoom = map.getZoom();
        refresh();
      });

      // flat's page hook ixmaps.htmlgui_onDrawTheme(szId), called when a
      // theme has been drawn: here once per settled redraw, for every
      // shown theme, with its id. Not re-entered when the hook itself
      // changes a theme (changeThemeStyle → refresh → here again).
      let inDrawThemeHook = false;
      function callDrawThemeHooks() {
        const hook = pageIxmaps() && pageIxmaps().htmlgui_onDrawTheme;
        if (typeof hook !== 'function' || inDrawThemeHook) return;
        inDrawThemeHook = true;
        try {
          for (const rt of runtimes.slice()) {
            if (rt._hidden) continue;
            try { hook.call(global.ixmaps, themeIdOf(rt)); } catch (e) { console.error('[ixmaps-gl] htmlgui_onDrawTheme:', e); }
          }
        } finally { inDrawThemeHook = false; }
      }
      function notifyRedraw() {
        redrawListeners.forEach(cb => { try { cb(); } catch (err) { console.error('[ixmaps-gl] onRedraw callback failed:', err); } });
        callDrawThemeHooks();
      }

      // For explicit, discrete API calls (setFacetFilter, setSizeField,
      // setThemeStyle, ...): rebuild layers AND notify onRedraw listeners
      // immediately. These aren't part of a continuous pan/zoom stream, so
      // there's no jank risk to throttle away — the caller expects instant
      // feedback.
      function refresh() {
        refreshLayers();
        layoutLegends();
        setDataLoading();
        notifyRedraw();
      }

      // a FEATURE theme out of scale at its definition gets its data once
      // it comes into scale (see deferredFeatureLoad) — for that view
      function loadDeferredThemes() {
        const z = map.getZoom();
        runtimes.forEach(rt => {
          if (!rt._deferredLoad || featuresHiddenByScale(rt.style, z)) return;
          rt._deferredLoad = false;
          engineApi.refreshTheme(rt.name).catch(err => console.error(`[ixmaps-gl] loading theme "${rt.name}":`, err));
        });
      }
      map.on('moveend', loadDeferredThemes);

      map.on('load', () => {
        mapHasLoaded = true;
        loadDeferredThemes();
        refresh();
        runtimes.forEach(maybeZoomToTheme);
        hideSplash(splash);
        const initialOpacity = parseFloat(this._engineOptions.basemapopacity);
        if (!isNaN(initialOpacity)) { _basemapOpacity = Math.max(0, Math.min(1, initialOpacity)); applyBasemapOpacity(); }
      });

      // throttle with a trailing call, not a plain debounce — a pure
      // debounce resets on every 'move' event, which fires continuously
      // during an active drag, so refreshLayers() never actually ran until
      // the drag stopped (no visible update *while* panning). This fires at
      // most once per REFRESH_INTERVAL_MS during continuous movement,
      // plus one final call once movement settles.
      const REFRESH_INTERVAL_MS = 150;
      let refreshTimer = null;
      let lastRefreshAt = 0;
      function scheduleRefresh() {
        const now = Date.now();
        const elapsed = now - lastRefreshAt;
        if (elapsed >= REFRESH_INTERVAL_MS) {
          lastRefreshAt = now;
          notifyZoomAndPanMidGesture();
          refreshLayers();
        } else {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => { lastRefreshAt = Date.now(); notifyZoomAndPanMidGesture(); refreshLayers(); }, REFRESH_INTERVAL_MS - elapsed);
        }
        scheduleNotifyRedraw();
      }

      // onRedraw listeners (facets sidebar) are notified on their OWN,
      // longer debounce, separate from the map's own 150ms layer throttle
      // above — measured cost: getFacets() over every configured field
      // plus the sidebar DOM rebuild can run ~55-70ms at a zoomed-out
      // viewport (tens of thousands of in-view points), vs ~5ms for
      // refreshLayers() itself. Running that on every throttled pan/zoom
      // tick visibly competed with the map's own frame budget; recomputing
      // it only once movement settles (this fires once, NOTIFY_REDRAW_MS
      // after the last 'move' event) keeps panning smooth and matches the
      // real ixmaps engine's own shape — htmlgui_onDrawTheme (facets) fires
      // once per completed theme redraw, not per intermediate pan frame.
      const NOTIFY_REDRAW_MS = 400;
      let notifyRedrawTimer = null;
      function scheduleNotifyRedraw() {
        clearTimeout(notifyRedrawTimer);
        notifyRedrawTimer = setTimeout(notifyRedraw, NOTIFY_REDRAW_MS);
      }

      map.on('move', scheduleRefresh);
      window.addEventListener('resize', () => map.resize());

      // GL-PORT COMPAT: real ixmaps-flat's map.on("layerdraw", cb) fires
      // once per THEME as it finishes drawing, handing the callback an
      // event object carrying that theme's own id (e.constructor.id).
      // This engine has no equivalent per-theme draw event — onRedraw
      // fires once per REFRESH of the whole map (see its own comment,
      // above) — so "layerdraw" is approximated by firing the registered
      // callback once per CURRENT runtime, synthesizing {id: rt.name},
      // every time onRedraw fires. A page reacting to "layerdraw" by
      // reading THAT theme's own state (e.g. recomputing a stats sidebar
      // via getThemeObj/getFacets — see the global compat shims, below)
      // gets the same practical effect: fresh numbers after every redraw,
      // for every theme, without needing the page rewritten around a
      // finer-grained event this engine doesn't produce.
      const layerdrawCbs = (this._pendingEvents || [])
        .filter(([event]) => event === 'layerdraw')
        .map(([, cb]) => cb);
      if (layerdrawCbs.length) {
        engineApi.onRedraw(() => {
          runtimes.forEach(rt => {
            layerdrawCbs.forEach(cb => {
              try { cb({ id: rt.name }); } catch (err) { console.error('[ixmaps-gl] "layerdraw" callback failed:', err); }
            });
          });
        });
      }

      // the native legend: createLegend (its four hooks are what the rest
      // of the map calls — panels, the legend option, sub-themes, layout)
      ({ addLegendPanel, setLegendOption, updateSubTheme, layoutLegends } =
        createLegend({ builder, map, el, overlay, runtimes, engineApi, built, refresh, scheduleRefresh, notifyRedraw }));

      _lastMapApi = engineApi;
      // ?ixgl-debug: ixmaps.__glDebug.check() reports, for the moment it is
      // called, every theme's geometry problems (invalid or mixed-dimension
      // coordinates, a shape far larger than the theme's others) and what
      // deck.gl draws
      if (glDebug()) {
        const extentOf = g => {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, bad = 0;
          const dims = new Set();
          const walk = c => {
            if (typeof c[0] === 'number') {
              dims.add(c.length);
              if (!isFinite(c[0]) || !isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) { bad++; return; }
              x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]);
            } else c.forEach(walk);
          };
          walk(g.coordinates || []);
          return { size: Math.max(x1 - x0, y1 - y0), bad, dims: [...dims], bbox: [x0, y0, x1, y1].map(v => +v.toFixed(5)) };
        };
        const pageIx = pageIxmaps() || global.ixmaps;
        pageIx.__glDebug = {
          api: engineApi,
          check() {
            const report = runtimes.map(rt => {
              const feats = (rt.features || []).filter(f => f && f.geometry && f.geometry.type !== 'Point');
              const ext = feats.map(f => [f, extentOf(f.geometry)]);
              const sizes = ext.map(e => e[1].size).filter(isFinite).sort((a, b) => a - b);
              const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
              const dims = new Set(); ext.forEach(e => e[1].dims.forEach(d => dims.add(d)));
              const idOf = f => { const p = f.properties || {}; const r = p.raw || p; return r[rt.binding.id] != null ? r[rt.binding.id] : (r[rt.binding.lookup] != null ? r[rt.binding.lookup] : ''); };
              const suspects = ext.filter(([f, e]) => e.bad || (median && e.size > median * 50))
                .slice(0, 10).map(([f, e]) => ({ id: idOf(f), type: f.geometry.type, parts: f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.length : 1, extentDeg: +e.size.toFixed(4), bbox: e.bbox, invalidCoords: e.bad }));
              return { theme: themeIdOf(rt), shapes: feats.length, medianExtentDeg: +median.toFixed(5), coordDims: [...dims], suspects };
            }).filter(r => r.shapes);
            // what deck.gl draws right now: each layer's own data, scanned
            // like the themes (the choropleth's data is rebuilt per redraw)
            const deckNow = overlay._deck || overlay.deck;
            const drawn = deckNow ? deckNow.props.layers.map(l => {
              const d = l.props.data;
              const feats = Array.isArray(d) ? d : (d && d.features) || [];
              const polys = feats.filter(f => f && f.geometry && f.geometry.type !== 'Point');
              let note = '';
              if (polys.length) {
                const ext = polys.map(f => extentOf(f.geometry));
                const sizes = ext.map(e => e.size).filter(isFinite).sort((a, b) => a - b);
                const med = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
                const bad = ext.filter(e => e.bad || (med && e.size > med * 50)).length;
                const dims = new Set(); ext.forEach(e => e.dims.forEach(x => dims.add(x)));
                note = `, dims ${[...dims].join('/')}, ${bad} suspect`;
              }
              return l.id + ' (' + feats.length + note + ')';
            }) : [];
            const lines = report.map(r => `${r.theme}: ${r.shapes} shapes, median extent ${r.medianExtentDeg}°, dims ${r.coordDims.join('/')}`
              + r.suspects.map(x => `\n   suspect ${x.id} ${x.type}(${x.parts} parts) extent ${x.extentDeg}° bbox [${x.bbox.join(', ')}]${x.invalidCoords ? ' invalid coords: ' + x.invalidCoords : ''}`).join(''));
            console.info('[ixmaps-gl debug] check\n' + lines.join('\n') + '\n drawn: ' + drawn.join(', '));
            return { report, drawn };
          }
        };
      }
      _resolveMapReady(engineApi);
      resolveBuilt();
      namedLoads.forEach(rt => { listenNamedData(rt); if (!rt._deferredLoad) loadNamedTheme(rt, false); });
      return engineApi;
    }
  }

  // named createMap (not Map) so it doesn't shadow the built-in ES6 Map
  // class used throughout this file — a real bug caught during testing
  // (every `new Map()` below silently resolved to *this* function instead)
  function createMap(containerId, options, mapFn) {
    const builder = new MapBuilder(containerId, options);
    if (mapFn) mapFn(builder);
    // If build() rejects (bad data URL, misconfigured CHOROPLETH join,
    // etc.) before ever reaching MapLibre's own 'load' event, the splash
    // showSplash() put up at the top of build() would otherwise never get
    // its hideSplash() call and sit there forever, masking the error
    // visually as "still loading". Re-thrown so the caller's own
    // .catch()/await still sees the real failure — this only guarantees
    // the splash doesn't outlive it.
    const promise = builder.build().catch(err => {
      const el = document.getElementById(containerId);
      const splash = el && el.querySelector('.ixmaps-splash');
      if (splash) hideSplash(splash);
      throw err;
    });

    // GL-PORT COMPAT: real ixmaps-flat's ixmaps.Map(id, options) — no
    // third mapFn argument — returns a SYNCHRONOUSLY CHAINABLE object:
    // .view()/.options()/.on()/.layer(name).data()...define() are called
    // directly on the return value, not inside a callback. This engine's
    // OWN established convention (used by every example page built so
    // far) is the mapFn callback above, kept completely unchanged when
    // one is passed. When it's NOT passed, `promise` (already returned by
    // build(), started above) gets these same chain methods attached
    // directly, mutating the SAME `builder` build() is reading from.
    // This works — not a race — because of plain JS run-to-completion:
    // build() is an async function that only reads _viewCenter/
    // _engineOptions/_layerBuilders AFTER its own first `await`
    // (ensureLibrariesLoaded(), see build()'s own body), and nothing
    // between here and the end of the CALLER's current synchronous
    // script (its own .view()/.options()/.layer(...).define() chain)
    // yields back to the event loop — so every one of those calls lands
    // on `builder` before build() ever gets far enough to consume them,
    // exactly as if they'd all been made inside a mapFn callback.
    if (!mapFn) {
      // Tracks whether build() has actually finished — needed by .layer()
      // below, since a call BEFORE vs. AFTER that point needs two
      // completely different mechanisms to actually take effect (see its
      // own comment).
      let resolvedApi = null;
      promise.then(api => { resolvedApi = api; }, () => {});
      // GL-PORT COMPAT: real ixmaps-flat's map.view(...) re-centers the
      // LIVE map when called after it's already built — confirmed as a
      // real, needed behavior by a real page's own city-picker dropdown
      // (mappa_stranieri_30.html), which calls myMap.view({center,zoom})
      // again on every selection change, long after the initial .then()
      // already resolved. Before this fix .view() ALWAYS routed to
      // builder.view(...) (a build-time-only config setter MapBuilder's
      // own constructor reads exactly once, inside build()) regardless of
      // resolvedApi — a post-build call silently mutated a property
      // nothing ever reads again, so the dropdown visibly did nothing.
      // Same before/after-build split .layer() below already has, applied
      // here too: post-build, jump the actual MapLibre map directly
      // instead of the inert builder property.
      promise.view = (...args) => {
        if (resolvedApi) {
          resolvedApi.view(...args);
        } else {
          builder.view(...args);
        }
        return promise;
      };
      promise.options = (...args) => { builder.options(...args); return promise; };
      promise.attribution = (...args) => { builder.attribution(...args); return promise; };
      promise.legend = (...args) => { builder.legend(...args); return promise; };
      promise.local = (...args) => { builder.local(...args); return promise; };
      promise.require = (url) => { if (resolvedApi) resolvedApi.require(url); else builder.require(url); return promise; };
      promise.on = (...args) => { builder.on(...args); return promise; };
      promise.layer = (nameOrBuilder) => {
        if (typeof nameOrBuilder !== 'string') {
          // object form (a pre-built LayerBuilder, e.g. from the global
          // ixmaps.layer(name, cb) factory): existing semantics, chain
          // back on the MAP for further .layer(a).layer(b) calls.
          builder.layer(nameOrBuilder);
          return promise;
        }
        const lb = new LayerBuilder(nameOrBuilder);
        if (!resolvedApi) {
          // Still building (the common case: this whole chain runs
          // synchronously right after ixmaps.Map(), see the run-to-
          // completion note above) — queue into the pending builder,
          // consumed by build()'s own FIRST (and only) pass over
          // _layerBuilders. .define() stays LayerBuilder's default no-op;
          // simply being queued here is already enough.
          builder._layerBuilders.push(lb);
        } else {
          // GL-PORT COMPAT: map.layer(name).data()...define() called
          // AFTER the map has ALREADY finished building — e.g. a real
          // page's own year/dataset switcher re-running its layer-
          // building function on a later user action. build()'s
          // _layerBuilders consumption already happened once and never
          // runs again, so queuing into it here would silently do
          // nothing (confirmed live: exactly this, switching years on a
          // real ported page — the map just kept showing the old data).
          // Routed through defineLayer() instead, with any EXISTING
          // theme of the SAME name removed first — matching real
          // ixmaps-flat's own "defining a theme with the same name
          // replaces it in place" convention. Scoped to only this
          // specific calling pattern rather than changing defineLayer()
          // itself, which stays purely additive for every other caller —
          // see its own comment for why (the CHOROPLETH/FEATURE-donor
          // pairing needs two runtimes sharing one name to coexist).
          lb.define = () => {
            resolvedApi.removeTheme(nameOrBuilder);
            return resolvedApi.defineLayer(lb);
          };
        }
        return lb;
      };
    }
    return promise;
  }

  // ---------------------------------------------------------------
  // LayerRuntime — turns one loaded+filtered layer's config into deck.gl
  // layers each refresh(). This is the generalized version of what was
  // previously hand-written for one specific dataset: category count,
  // field names, and colors all come from the config + the data itself.
  // ---------------------------------------------------------------

  // NORMAL_RADIUS_PX: the pixel radius of a symbol whose value equals the
  // normal size value (normalsizevalue, else the dataset max — see
  // LayerRuntime._prepare's _maxSizeValue) at the object-scaling reference
  // zoom: flat's nMaxRadius = normalX(nChartSize / 2) = 15 (maptheme.js
  // 20654). Measured against real flat on the same page (2026-09-27): the
  // earlier hand-tuned 12.5 drew every symbol 1.2× (with the reference
  // below, 1.3×) smaller than flat.
  const NORMAL_RADIUS_PX = 15;
  // largest BOX side (px) still drawn as a canvas icon (at 2×), see _buildBoxIcon
  const BOX_ICON_MAX_PX = 2048;
  // Flat's own map scale, which dynamic object scaling compares with
  // normalSizeScale (mapscript2.js 2849: dx = nTrueMapScale · nZoomScale /
  // nNormalSizeScale), read from a real flat page: the generic Mercator
  // map's nMapScale 177 165 354 at 72 map-PPI shown at 96 PPI (nTrueMapScale
  // 236 220 472) × nZoomScale 1.875 at flat zoom 0 → 442 913 385 / 2^zoom —
  // 1.262× (0.336 zoom levels) below the true Web Mercator scale. Without
  // normalSizeScale flat's reference is nMapScale itself (mapscript.js 2124).
  const FLAT_OBJECT_SCALE_CONSTANT = 442913385;
  // the longitude of flat's map x origin (generic Mercator map, see
  // snapToAggregationGrid): 1355.1779834773333 / 26.666666666667
  const FLAT_GRID_ORIGIN_LON = -50.81917438040;
  const FLAT_DEFAULT_NORMAL_SIZE_SCALE = 177165354;
  // A flat-convention zoom (see FLAT_ZOOM_OFFSET), like every zoom a page
  // passes in; flatToMapLibreZoom() before comparing with the live map.
  const DEFAULT_ZOOM_REFERENCE = 10;
  const DEFAULT_DYNAMIC_SCALE_POW = 3;
  // Near-zero rather than a real floor: for aggressive-size-contrast themes
  // (small values must actually stay small at zoomed-out views, not clamp
  // to a visible minimum), keeping the real engine's own behavior — its
  // per-symbol radius code has no floor at all, values can shrink toward 0.
  // 0.1 instead of a literal 0 just avoids a zero/negative-radius edge case
  // in the renderer, not a deliberate visual floor.
  const VALUE_RADIUS_MIN = 0.1;
  // no ceiling either — flat's radius has none (a 40 px cap here, from the
  // first version, cut big symbols flat draws in full)
  const VALUE_RADIUS_MAX = Infinity;
  // Reference zoom for a real-world-METERS .style({gridwidth}): the cell
  // width is converted to world pixels at this ONE fixed zoom and the
  // grid aggregation runs at it too (see _ensureClusterIndices /
  // _computeAggregatedItems), so a meters grid has the same cells at every
  // map zoom. The value itself is arbitrary; 0 keeps metersToWorldPixels
  // formula-only.
  const GRIDWIDTH_METERS_REFERENCE_ZOOM = 0;

  // .type("DOT") — the real engine's simplest symbol (maptheme.js ~line
  // 18046): a FIXED-radius circle, never value-scaled (a bound value only
  // ever picks a color class, e.g. via CATEGORICAL) — confirmed by reading
  // the real source's DOT branch, which bypasses drawChart's whole
  // modifier pipeline entirely (no clustering/AGGREGATE, no GLOW, no
  // VALUES text) rather than being "BUBBLE with the size locked down".
  // Fixed in real screen pixels here, not zoom-scaled — the real engine's
  // own zoom-proportional SVG-unit behavior for this constant wasn't
  // confirmed precisely enough to port faithfully, so this is the honest,
  // simpler reading ("always a small fixed dot") rather than a guess.
  const DOT_RADIUS_PX = 3;

  // .style({classes: N}) — number of equal-interval range/class buckets
  // for a NON-CATEGORICAL bound value (maptheme.js distributeValues:
  // nParts = colorScheme.length, default colorScheme is a hardcoded
  // 5-color array) — 5 is the real engine's own default class count.
  const DEFAULT_RANGE_CLASSES = 5;

  // NATURAL/Jenks classification's O(n^2*k) DP is only run on at most this
  // many sampled values — see _naturalBreaks for why the real engine's own
  // uncapped version is infeasible at this project's actual data scale.
  const NATURAL_BREAKS_MAX_SAMPLE = 2000;

  // .type("GRIDSIZE") — spatial grid cell pitch in screen pixels when
  // .style({gridwidthpx}) isn't set (maptheme.js's own GRIDSIZE default).
  const GRID_WIDTH_PX_DEFAULT = 100;

  // .type("PLOT") mini-chart icon — square raster canvas (the on-screen
  // FOOTPRINT is set by GRIDSIZE to the full grid cell width, same as the
  // grid-mesh companion layer's own square — NOT by normalsizevalue; see
  // _buildPlotLayers). The height reserved at the bottom for XAXIS tick
  // labels, when that flag is set, comes out of this same square.
  const PLOT_ICON_RASTER_SIZE = 100;
  const PLOT_XAXIS_HEIGHT = 12;

  // standard 96dpi Web Mercator scale-denominator constant for 256px
  // tiles: scale = this / 2^zoom
  const WEBMERCATOR_SCALE_CONSTANT = 559082264.028;

  // Zoom convention. Real ixmaps-flat's zoom numbers are Leaflet's, on
  // 256px tiles; MapLibre's world is 512px, so MapLibre zoom z shows what
  // Leaflet shows at z + 1 on the same screen. Measured with
  // --flat-oracle: a flat page at view(..., 12.5) spans 0.2486° of
  // longitude on a 1024px map, gl at MapLibre zoom 12.5 showed half that.
  // Every zoom crossing the flat API (view(), loadProject/setProjectJSON,
  // getProjectString) is converted here, and every scale denominator is
  // computed from the flat zoom of what the map actually shows. Internal
  // MapLibre zooms (rendering, clustering, grid math) stay MapLibre's.
  const FLAT_ZOOM_OFFSET = 1;
  const flatToMapLibreZoom = z => z - FLAT_ZOOM_OFFSET;
  const mapLibreToFlatZoom = z => z + FLAT_ZOOM_OFFSET;
  // map scale denominator at a MapLibre zoom (null → the default reference):
  // flat's own map scale, the one its scale bar shows and every scale gate
  // (featureupper, chartupper, boxupper, valueupper, aggregation brackets)
  // is compared with — 442 913 385 / 2^zoom at any latitude, read off flat
  // (1:54 067 at flat zoom 13, 1:108 133 at 12, 1:142 683 at 11.6); see
  // FLAT_OBJECT_SCALE_CONSTANT. The Web Mercator scale would put every gate
  // 0.336 zoom levels off flat's.
  function scaleDenominatorAt(mapLibreZoom) {
    const flatZoom = mapLibreZoom == null ? DEFAULT_ZOOM_REFERENCE : mapLibreToFlatZoom(mapLibreZoom);
    return FLAT_OBJECT_SCALE_CONSTANT / Math.pow(2, flatZoom);
  }

  // Map-level .options({objectscaling, normalSizeScale}) — the zoom-anchor
  // half of dynamic symbol scaling (normalsizevalue/sizepow, above, is the
  // *value*-driven half). normalSizeScale is a map SCALE DENOMINATOR (e.g.
  // "259302", meaning 1:259302) at which symbols render at their
  // configured normal size, converted here to the equivalent zoom level
  // via the same scale formula used for style.aggregation thresholds —
  // returned as a MapLibre zoom, comparable with the live map's.
  // objectscaling:"dynamic" (the default, matching this engine's prior
  // always-on behavior) means symbols DO scale with zoom; anything else
  // (e.g. "fixed") means they don't — same pixel size at every zoom.
  // the zoom at which flat's object scale equals normalSizeScale (symbols
  // at their normal size) — see FLAT_OBJECT_SCALE_CONSTANT
  function resolveZoomReference(mapOptions) {
    const scaleDenominator = parseFloat(mapOptions && mapOptions.normalSizeScale) || FLAT_DEFAULT_NORMAL_SIZE_SCALE;
    return flatToMapLibreZoom(Math.log2(FLAT_OBJECT_SCALE_CONSTANT / scaleDenominator));
  }

  // .options({dynamicScalePow}) — the REAL parameter name (confirmed in
  // maps/svg/js/mapscript.js / mapscript2.js) for the exponent governing
  // HOW STRONGLY symbols react to zoom, separate from normalSizeScale
  // (which only sets WHERE the neutral point is). Real formula
  // (mapscript2.js:2851, ixMap.Layer.doDynamicObjectScaling):
  //   dx = (nTrueMapScale * nZoomScale) / nNormalSizeScale
  //   objectScale *= Math.pow(1/dx, 1/nDynamicScalePow)
  // default 3 ("qubic root function", per the source's own comment) —
  // gentler than a raw doubling per zoom level. dx is a scale-denominator
  // ratio; in zoom-level terms (scale halves each zoom step) this reduces
  // to a clean base-2 exponential: zoomFactor = 2^((zoom-zoomRef)/dynamicScalePow).
  function resolveDynamicScalePow(mapOptions) {
    const parsed = parseFloat(mapOptions && mapOptions.dynamicScalePow);
    return isNaN(parsed) ? DEFAULT_DYNAMIC_SCALE_POW : parsed;
  }

  // .style({fillopacity: "auto"}) — CHOROPLETH-only (real source dispatch:
  // maptheme.js's realize_draw/realizeContinue route FEATURE/CHART themes
  // through chartMap, whose OWN separate autoOpacity formula at
  // maptheme.js:16436-16438 never applies to a plain polygon-fill
  // CHOROPLETH; only paintMap's formula at maptheme.js:13379-13382 does):
  //   dx = (nTrueMapScale * nZoomScale) / nNormalSizeScale
  //   fill-opacity = clamp(0.3, 1, 0.3 + 0.7 / max(1, ln(nZoom / dx)))
  // nZoom is the real engine's own "zooming factor (>=1) relative to the
  // initial full-extent view" (mapscript2.js:395-420) — NOT a Leaflet/
  // MapLibre 0-20 zoom level, and confirmed via direct source read that
  // nZoomScale is itself ~1/nZoom in ordinary interactive use, making
  // nZoom/dx roughly proportional to nZoom^2 * (nNormalSizeScale /
  // nTrueMapScale). nTrueMapScale is a real, physical scale denominator
  // this engine has no equivalent of (computed from print/embed DPI, no
  // config surface at all) — and the exact formula bridging a MapLibre
  // zoom level to the real engine's own nZoom could not be located in the
  // source (checked mapapi.js/mapquery.js/mapselect.js, htmlgui_flat.js).
  //
  // This is deliberately NOT a bit-exact port, unlike this engine's other
  // ported formulas — the real formula's own physical-scale inputs
  // (nTrueMapScale) have no equivalent here and the zoom-level bridging
  // formula couldn't be located in the source, so this reproduces the
  // real behavior's INTENT (full opacity at/below the configured "normal"
  // view, fading toward a floor as you zoom in past it, using THIS
  // engine's own already-established zoom-reference concept —
  // resolveZoomReference / .options({normalSizeScale}), the same
  // reference BUBBLE's dynamic sizing already uses) rather than its exact
  // curve. A smooth exponential half-life decay (halves every
  // AUTO_OPACITY_HALF_LIFE_ZOOM zoom levels past the fade's own start
  // point) down to AUTO_OPACITY_FLOOR. Retuned three times per explicit
  // correction: the original log-based falloff (mirroring the real
  // formula's own shape) was still ~0.47 opacity six zoom levels past the
  // reference, too gentle to reveal the basemap; the first half-life
  // retuning (floor 0.08, half-life 2 zooms) was still ~0.2 at typical
  // street-level zoom, still too opaque to read street labels through;
  // floor/half-life then landed at ~0.1 by ~4-5 zoom levels past the
  // normal view — correct AT street level, but per the next correction
  // ("could attack earlier") the fade didn't START until the configured
  // normal-view zoom itself, so a page whose initial view sits below that
  // (e.g. this engine's own demo, view zoom 6 against the default
  // reference 10) saw full, unfading opacity across its whole starting
  // zoom range. AUTO_OPACITY_EARLY_START_ZOOM shifts the fade's START
  // point earlier than the normal-view zoom (not the floor or the decay
  // rate, both already correct at street level) so it's already visibly
  // underway well before reaching it.
  const AUTO_OPACITY_FLOOR = 0.1;
  const AUTO_OPACITY_HALF_LIFE_ZOOM = 1;
  const AUTO_OPACITY_EARLY_START_ZOOM = 4;
  // the reference the auto-opacity approximation below was tuned against:
  // the zoom showing normalSizeScale at the true Web Mercator scale, else
  // flat zoom 10 — kept as it was when symbol sizing moved to flat's own
  // scale (resolveZoomReference); flat's real rule (maptheme.js 13408,
  // 0.3 + 0.7 / ln(nZoom / dx)) is not ported yet
  function autoOpacityZoomReference(mapOptions) {
    const scaleDenominator = parseFloat(mapOptions && mapOptions.normalSizeScale);
    if (!scaleDenominator) return flatToMapLibreZoom(DEFAULT_ZOOM_REFERENCE);
    return flatToMapLibreZoom(Math.log2(WEBMERCATOR_SCALE_CONSTANT / scaleDenominator));
  }

  function resolveAutoFillOpacity(zoom, mapOptions) {
    const zoomReference = autoOpacityZoomReference(mapOptions) - AUTO_OPACITY_EARLY_START_ZOOM;
    const z = zoom == null ? zoomReference : zoom;
    const zoomsPastNormal = Math.max(0, z - zoomReference);
    return AUTO_OPACITY_FLOOR + (1 - AUTO_OPACITY_FLOOR) * Math.pow(0.5, zoomsPastNormal / AUTO_OPACITY_HALF_LIFE_ZOOM);
  }

  // Shared by every renderer's `opacity` prop: resolves style.fillopacity,
  // including the "auto" special case above. `zoom` may be omitted by
  // callers that don't have one in scope (auto then falls back to full
  // opacity, same as being at/below the normal reference view).
  function resolveFillOpacity(style, mapOptions, zoom) {
    if (style.fillopacity === 'auto') return resolveAutoFillOpacity(zoom, mapOptions);
    return styleNum(style.fillopacity) || 1;
  }

  // .style({sizepow}) — power-law exponent applied to value BEFORE scaling:
  // sizepow=1 (default) is the plain linear relation; sizepow=0.5 gives
  // area-proportional (sqrt) sizing; sizepow>1 exaggerates differences.
  // Applied as (value/normalsizevalue)^sizepow rather than value^sizepow
  // directly so the theme's own calibration point still holds exactly —
  // value===normalsizevalue always maps to NORMAL_RADIUS_PX (times
  // scale/zoom) no matter what exponent is in play, since
  // (normalsizevalue/normalsizevalue)^sizepow = 1^sizepow = 1 always.
  // .type() flags that set nSizePow, read verbatim from the real ixmaps
  // engine (maps/svg/js/maptheme.js, ~line 16451) — a matching flag
  // OVERRIDES an explicit style.sizepow (that's the real engine's own
  // precedence, checked in the same order below), falling back to
  // style.sizepow only when none of these flags are present, and to 2
  // ("quadratic/surface" — the real engine's own default) when neither is set.
  function resolveSizePow(style, flags) {
    if (flags.has('LINEAR') || flags.has('SIZEP1')) return 1;
    if (flags.has('SIZEP1H')) return 1.5;
    if (flags.has('SIZELOG') || flags.has('SIZEP10')) return 10;
    if (flags.has('SIZEP4')) return 4;
    if (flags.has('SIZEP3') || flags.has('SIZEVOLUME')) return 3;
    const parsed = styleNum(style.sizepow);
    return isNaN(parsed) ? 2 : parsed;
  }

  // Real formula (maptheme.js): radius = normalRadius * (value/normalValue)
  // ^(1/nSizePow) — note the exponent is 1/sizePow, not sizePow itself, so
  // a LARGER sizepow COMPRESSES size differences (2 ~ area/sqrt-like, 3 ~
  // volume/cube-root-like), the opposite of a naive reading of "power".
  // .options({objectscaling}) — "dynamic": symbols grow with the zoom by
  // 2^((zoom − reference) / dynamicScalePow); otherwise fixed
  function objectZoomFactor(zoom, mapOptions) {
    const objectScaling = (mapOptions && mapOptions.objectscaling) || 'dynamic';
    const zoomReference = resolveZoomReference(mapOptions);
    const dynamicScalePow = resolveDynamicScalePow(mapOptions);
    return objectScaling === 'dynamic'
      ? Math.pow(2, ((zoom == null ? zoomReference : zoom) - zoomReference) / dynamicScalePow)
      : 1;
  }

  function valueRadius(value, zoom, style, mapOptions, flags, maxSizeValue) {
    const zoomFactor = objectZoomFactor(zoom, mapOptions);
    // FIXSIZE (a symbol chart; PLOT / GRIDSIZE size their markers
    // themselves): one radius for every item, whatever its value — the
    // normal radius ÷ normalsizevalue, half of it for BUBBLE (maptheme.js
    // 20711, 21847; measured on flat: PNRR "details", r = 1.5 units at
    // scale 0.1)
    if (flags && flags.has('FIXSIZE') && !flags.has('PLOT') && !flags.has('GRIDSIZE')) {
      const fixed = NORMAL_RADIUS_PX * (styleNum(style.scale) || 1) / (styleNum(style.normalsizevalue) || 1)
        * (flatChartBranch(flags) === 'bubble' ? 0.5 : 1);
      return Math.max(VALUE_RADIUS_MIN, Math.min(VALUE_RADIUS_MAX, fixed * zoomFactor));
    }
    // Real default (maptheme.js ~line 5059) when the theme sets no
    // normalsizevalue: the dataset's own max value on the bound size
    // field (maxSizeValue, from LayerRuntime._prepare), not a fixed
    // constant. Final `|| 1` only guards a pathological empty dataset.
    const normalValue = styleNum(style.normalsizevalue) || maxSizeValue || 1;
    const sizePow = resolveSizePow(style, flags || new Set());
    // flat sizes by the ABSOLUTE value (maptheme.js 19851/20720:
    // Math.pow(Math.abs(nSizeValue), 1/nSizePow)) — negative values (a
    // DIFFERENCE, a balance; NEGATIVEISVALUE is flat's default) are drawn,
    // colored by their class
    const ratio = Math.pow(Math.abs(value || 0) / normalValue, 1 / sizePow);
    // NOTE: valuescale (nValueScale) is deliberately NOT here — checked the
    // real source (maptheme.js), every one of its usages is font/label
    // sizing (nFontSize/nTextSize), never symbol radius. An earlier version
    // of this engine multiplied it into the radius, which was a fabricated
    // behavior not present in ixmaps.
    const k = NORMAL_RADIUS_PX * ratio * (styleNum(style.scale) || 1);
    return Math.max(VALUE_RADIUS_MIN, Math.min(VALUE_RADIUS_MAX, k * zoomFactor));
  }

  // .style({aggregation: ["1:1","3px","1:500000","1px", ...]}) — pairs of
  // (map-scale-ratio threshold, aggregation grid size). CORRECTED
  // (2026-09-22, user-asked-to-verify): this engine's own prior comment
  // here admitted the exact crossover rule was an unverified guess ("the
  // one piece of the original engine's internals we don't have source
  // for") — a research pass into the REAL engine's own source
  // (maptheme.js:7990-8008, byte-identical duplicate at :6912-6928)
  // found the actual algorithm and it differs from what was implemented:
  //   - NO sorting — real code stores szAggregationFieldA verbatim
  //     (toArray, maptheme.js:999-1017, does no reordering) and scans it
  //     in AUTHOR-PROVIDED order.
  //   - NO break, no max-tracking — a PLAIN linear scan over every pair;
  //     every pair whose threshold is exceeded UNCONDITIONALLY overwrites
  //     the result, so whichever matching pair comes LAST in array order
  //     wins. This only produces "largest exceeded threshold wins" — the
  //     intuitive reading — when the page author supplies pairs in
  //     ascending "1:N" order (the real code assumes but never verifies
  //     this; a descending array behaves differently for real too, not
  //     just in this port).
  //   - Strict `>`, not `>=` (maptheme.js:7993) — exact equality to a
  //     threshold does NOT match.
  //   - A pair's value can be a bare real-world-METERS number, not only
  //     "Npx" (maptheme.js: `if (val.match(/px/)) nGridWidthPx = ...;
  //     else { nGridWidth = ...; nGridWidthPx = 0; }`) — the exact same
  //     px-vs-meters duality standalone .style({gridwidth}) has (see
  //     _ensureClusterIndices' own comment) — the previous version here
  //     silently DROPPED any non-"px" pair entirely, a real, separate gap
  //     from the ordering bug. A matched meters entry is converted at the
  //     SAME fixed GRIDWIDTH_METERS_REFERENCE_ZOOM the standalone-
  //     gridwidth fix uses, for the identical reason: converting at the
  //     LIVE zoom here would reintroduce the exact same
  //     rebuild/re-cluster-every-zoom-tick bug this session already fixed
  //     once, just reachable through this second, array-based path
  //     instead of the plain scalar one.
  //   - No match at all (current scale under every threshold) keeps
  //     whatever value was already in effect — no equivalent "prior
  //     value" concept exists on this call path, so `fallbackPx` (the
  //     caller's own default) stands in for that case, matching this
  //     function's existing contract.
  // Returns { px, isMeters } — isMeters lets the caller (_ensureClusterIndices)
  // decide whether the QUERY-time zoom must also be pinned to the fixed
  // reference zoom (see _computeAggregatedItems' own comment) for
  // whichever bracket happens to be active right now — a theme mixing
  // "px" and meters entries across brackets can genuinely need different
  // treatment as the live zoom crosses from one bracket into another.
  function resolveAggregationPx(aggregation, zoom, fallbackPx, refLat) {
    if (!Array.isArray(aggregation) || aggregation.length < 2) return { px: fallbackPx, isMeters: false, field: null, matched: false };
    const scaleDenominator = scaleDenominatorAt(zoom);
    let chosenPx = fallbackPx, chosenIsMeters = false, chosenField = null, matched = false;
    for (let i = 0; i + 1 < aggregation.length; i += 2) {
      const ratioMatch = /^1:(\d+(?:\.\d+)?)$/.exec(aggregation[i]);
      if (!ratioMatch) continue;
      const lower = parseFloat(ratioMatch[1]);
      if (!(lower && scaleDenominator > lower)) continue;
      const valueStr = String(aggregation[i + 1]);
      const pxMatch = /^(\d+(?:\.\d+)?)\s*px$/i.exec(valueStr);
      matched = true;
      if (pxMatch) {
        chosenPx = parseFloat(pxMatch[1]);
        chosenIsMeters = false;
        chosenField = null;
      } else {
        const meters = parseFloat(valueStr);
        if (!isNaN(meters)) {
          chosenPx = metersToWorldPixels(meters, refLat || 0, GRIDWIDTH_METERS_REFERENCE_ZOOM);
          chosenIsMeters = true;
          chosenField = null;
        } else {
          // flat (maptheme.js 7999-8000): any other value is an aggregation
          // field — the records are grouped by its value
          chosenField = valueStr;
        }
      }
      // no break — see this function's own comment on why the real
      // engine's own last-match-wins scan is reproduced faithfully here.
    }
    return { px: chosenPx, isMeters: chosenIsMeters, field: chosenField, matched };
  }

  // .style({aggregation}) can carry a bare-METERS entry (see
  // resolveAggregationPx's own comment) just like standalone
  // .style({gridwidth}) can — this just needs to know WHETHER one exists
  // at _prepare() time, to decide whether the one-time full-extent
  // reference-latitude scan is worth doing at all.
  function aggregationHasMetersEntry(aggregation) {
    if (!Array.isArray(aggregation)) return false;
    for (let i = 1; i < aggregation.length; i += 2) {
      const v = String(aggregation[i]);
      if (!/px\s*$/i.test(v) && !isNaN(parseFloat(v))) return true;
    }
    return false;
  }

  // .type() flag VALUES — draws the bound value as a bold, centered text
  // label directly on each bubble (individual point or aggregated group),
  // matching maptheme.js's BUBBLE-symbol VALUES branch (~line 20928-20994):
  //   szText = formatValue(nValue, decimals, "ROUND") + (unit.length<=5 ? unit : "")
  //   nFontSize = min(radius*0.8, radius*(3.3/text.length)) * nValueScale
  //   label suppressed once nFontSize would render under ~1px (real source:
  //   `nFontSize > map.Scale.normalX(1)`) — i.e. the bubble itself is too
  //   small for the text to be legible, not a separate declutter pass.
  // valuescale (nValueScale) drives ONLY this font size, never the bubble's
  // own radius — confirmed earlier while auditing valueRadius().
  const VALUES_MIN_FONT_PX = 1;

  // Per-item PLOT — flat draws one small line chart per item
  // (maptheme.js drawChart PLOT, 22430-22481), measured on real flat
  // (_scratch per-item PLOT page, 2026-09-26). In units of S, flat's chart
  // unit normalX(nChartSize = 30) — twice a bubble's normal radius — times
  // .style({scale}) and the object scaling:
  //   point i at x = i; value v at y = (v − min)·k + h/20, k = (n−1)/(max −
  //   min)·rangescale, h = (max − min)·k (a 5 % bottom margin), y up from
  //   the item position, which is the first point's x;
  //   min/max: .style({minvalue, maxvalue}), else the dataset's (flat's
  //   nMinValuePlot/nMaxValuePlot; maxvalue "auto" → the item's own);
  //   LINES stroke linewidth/30; AREA filled down to the value 0 level;
  //   point markers r = 1/3 (FIXSIZE, ÷ normalsizevalue) or ½·(|v| /
  //   max)^(1/sizepow), white outline 1/75, none for 0 values (not STACKED)
  // → { points: [{x, y, v, r}], area: [[x, y]...] | null, bbox, lineWidth }
  function itemPlotGeometry(values, range, style, flags, sizeMax) {
    const n = values.length;
    const rs = styleNum(style.rangescale) || 1;
    const span = (range.max - range.min) || 1;
    const k = Math.max(1, n - 1) / span * rs;
    const h = span * k;
    const yOf = v => (v - range.min) * k + h / 20;
    const normal = styleNum(style.normalsizevalue) || 1;
    const pow = resolveSizePow(style, flags);
    const points = values.map((v, i) => {
      if (v == null || isNaN(v)) return null;
      let r = 0;
      if (!(v === 0 && !flags.has('STACKED'))) {
        r = flags.has('FIXSIZE') ? 1 / 3 / normal : 0.5 * Math.pow(Math.abs(v) / (sizeMax || 1), 1 / pow);
      }
      return { x: i, y: yOf(v), v, r };
    });
    const lineWidth = (styleNum(style.linewidth) || 1) / 30;
    const defined = points.filter(Boolean);
    let area = null;
    if (flags.has('AREA') && defined.length > 1) {
      const y0 = yOf(0);
      area = [[defined[0].x, y0]].concat(defined.map(p => [p.x, p.y]), [[defined[defined.length - 1].x, y0]]);
    }
    const pad = lineWidth / 2 + 1 / 75;
    let x0 = 0, x1 = Math.max(0, n - 1), y0b = 0, y1b = h + h / 20;
    for (const p of defined) {
      x0 = Math.min(x0, p.x - p.r - pad); x1 = Math.max(x1, p.x + p.r + pad);
      y0b = Math.min(y0b, p.y - p.r - pad); y1b = Math.max(y1b, p.y + p.r + pad);
    }
    if (area) for (const [, y] of area) { y0b = Math.min(y0b, y); y1b = Math.max(y1b, y); }
    return { points, area, lineWidth, bbox: { x0: x0 - pad, x1: x1 + pad, y0: y0b - pad, y1: y1b + pad } };
  }
  // the item's chart anchor: a point, or the bounding-box center of a
  // polygon's largest part (flat places a chart at its shape's position)
  function itemAnchor(geometry) {
    if (!geometry) return null;
    if (geometry.type === 'Point') return geometry.coordinates;
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
    if (!parts || !parts.length) return null;
    let best = null, bestArea = -1;
    for (const poly of parts) {
      const ring = poly[0] || [];
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
      if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = ring; }
    }
    if (!best || !best.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of best) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  // flat's normal size value when the theme sets no normalsizevalue
  // (maptheme.js 20666-20690): the max of the size field when one is bound,
  // else the max of the value (max(nMax, nMaxA[0])). CATEGORICAL without a
  // size field (a fixed radius in flat) and AGGREGATE (flat: the max
  // aggregated cell, zoom-dependent) keep the previous behavior: size field
  // max, else none (→ 1); shapes (CHOROPLETH/FEATURE) draw no symbols.
  function defaultNormalSizeValue(features, binding, flags) {
    const symbols = !flags.has('CHOROPLETH') && !flags.has('FEATURE') && !flags.has('FEATURES');
    const field = binding.size ? binding.size
      : (symbols && !flags.has('CATEGORICAL') && !flags.has('AGGREGATE') && binding.value && !String(binding.value).includes('|') ? binding.value : null);
    if (!field) return undefined;
    // "$item$": every record counts 1
    if (field === '$item$') return features.length ? 1 : 0;
    return features.reduce((max, f) => {
      const v = parseFloat(f.properties[field]);
      return isNaN(v) ? max : Math.max(max, v);
    }, 0);
  }

  // Records behind one drawn chart item: a group's per-category record
  // counts summed, else a Supercluster cluster's point_count, else 1.
  // recordCounts only exists on RELOCATE groups (groupCoLocated); a plain
  // grid group (no RELOCATE) carries counts only — read unguarded, BOX|TITLE
  // without RELOCATE threw on the first cluster and the theme stopped drawing.
  function groupRecordCount(props) {
    const perCat = props.recordCounts || props.counts;
    return perCat ? perCat.reduce((x, c) => x + c, 0) : (props.point_count || 1);
  }

  function valuesFontSizePx(radiusPx, text, valueScale) {
    return Math.min(radiusPx * 0.8, radiusPx * (3.3 / Math.max(1, text.length))) * (valueScale || 1);
  }

  // the themes drawn by the symbol chart pipeline (_buildChartLayers): flat's
  // BUBBLE/SQUARE/LABEL branch (maptheme.js 20647-20652), symbols, user charts
  function isSymbolChart(flags) {
    return flags.has('CHART') && (flags.has('SYMBOL') || flags.has('USER') || flags.has('LABEL'));
  }

  // flat's __formatValue (mapscript.js 6268-6365) as maptheme's formatValue
  // calls it: 0 and values beyond ±10^12 as they are, else rounded twice
  // (one decimal more, then the precision — 25.446 → 25.45 → 25.5),
  // thousands grouped with spaces unless noBreaks (formatValue's NOBREAKS
  // for a theme of values within 1000-3000, i.e. years: maptheme.js 26364)
  function flatGroupedValue(value, decimals, noBreaks) {
    if (!isFinite(value)) return String(value);
    if (value === 0) return '0';
    if (value > 1e12 || value < -1e12) return String(value);
    const clip = Math.pow(10, decimals);
    const flatRounded = Math.round(Number(value.toFixed(decimals + 1)) * clip) / clip;
    const [intPart, dec] = flatRounded.toFixed(decimals).split('.');
    const grouped = noBreaks ? intPart : intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return dec ? `${grouped}.${dec}` : grouped;
  }
  // maptheme.js formatValue's NOBREAKS switch (26368): theme min > 999 and max < 3000
  function flatNoBreaks(vMin, vMax) {
    return Number.isFinite(vMin) && Number.isFinite(vMax) && vMin > 999 && vMax < 3000;
  }

  // flat's chart position (maptheme.js 24441-24530 and 24603, the non-PLOT,
  // non-grid case), measured on flat: the chart group is moved by −ptNull.
  //   ptNull = (offsetx, −offsety) · unit · symbolScale — unit is flat's
  //   normalX(1) on screen (object zoom × style.scale), symbolScale the
  //   SYMBOL branch's r / chart size (21993), 1 for BUBBLE/LABEL
  //   then align overwrites/adds: o is the chart's own ptNull.y as its
  //   branch left it (ptNullOrig — BUBBLE/LABEL and SYMBOL: r + 5 units,
  //   TEXTONLY: r; 21111, 23204), h half the chart size (BUBBLE/LABEL:
  //   the item's radius, SYMBOL: the theme's normal radius)
  // So "left" puts the chart's left edge o to the right of the point (and
  // drops offsetx), "2left" one more h. Returns deck.gl's pixel offset.
  function flatChartAlignOffset(style, g) {
    const num = v => (isNaN(styleNum(v)) ? 0 : styleNum(v));
    const sym = g.symbolScale || 1;
    let x = num(style.offsetx) * g.unit * sym, y = -num(style.offsety) * g.unit * sym;
    const a = String(style.align || '');
    if (a) {
      const h = g.half, o = g.orig;
      if (/center/.test(a)) y = 0;
      if (/bottom/.test(a)) y = o || h * 2 / 5;
      if (/above/.test(a)) y = o || h;
      if (/2above/.test(a)) y += h;
      if (/below/.test(a)) y = -(o || h);
      if (/2below/.test(a)) y -= h;
      if (/top/.test(a)) y = -(o || h);
      if (/left/.test(a)) x = -(o || h);
      if (/2left/.test(a)) x -= h;
      if (/right/.test(a)) x = o || h;
      if (/2right/.test(a)) x += h;
      if (/23right/.test(a)) x = h * 2 / 3;
      if (/baseline/.test(a)) y += h * 2 / 5;
    }
    return [-x || 0, -y || 0];
  }
  // which of flat's chart branches draws a symbol-pipeline theme: BUBBLE /
  // SQUARE / LABEL (maptheme.js 20647) come before SYMBOL (21122)
  function flatChartBranch(flags) {
    const t = flags.typeString != null ? flags.typeString : [...flags].join('|');
    return /BUBBLE|SQUARE|LABEL/.test(t) ? 'bubble' : 'symbol';
  }

  // flat's ColorScheme.getDerivateColor (colorscheme.js 46-75): each
  // channel × f, floored, capped at 255; brightening (f > 1) first lifts
  // every channel to at least 90 and, with one at 250 or more, uses
  // max(0.9 f, 1.1)
  function flatDerivateRgb(rgb, f) {
    let [r, g, b] = rgb;
    if (f > 1) {
      r = Math.max(r, 90); g = Math.max(g, 90); b = Math.max(b, 90);
      if (r >= 250 || g >= 250 || b >= 250) f = Math.max(f * 0.9, 1.1);
    }
    return [r, g, b].map(c => Math.min(255, Math.floor(c * f)));
  }
  // ChartColors.textColor (colorscheme.js 104-116): darker on light colors
  function flatChartTextRgb(rgb) {
    return flatDerivateRgb(rgb, rgb[0] + rgb[1] + rgb[2] > 450 ? 0.6 : 3);
  }

  // a chart's VALUES text (maptheme.js 20979-21017): an explicit valuefield
  // prints that field of the record ($title$: the title; a non-number as
  // is), else the value; numbers formatted with valuedecimals (flat's `||`:
  // 0 or unset → 1 decimal below 1 — or when the max value is at most 1 —
  // else none) plus the unit, which flat stores with a leading space unless
  // it starts with "." (9675) and appends only up to 5 characters.
  // A CATEGORICAL bubble prints its size value when size is bound to a
  // field (its value, see resolveAggregateValue), as flat does; with
  // valuefield set to its categorical field, the class name
  // (_categoryValueRecord for an aggregated part).
  // pure: the record an aggregated part of category i stands for in its
  // value text — with style.valuefield the theme's CATEGORICAL field, flat
  // prints the class name (the records' own valuefield value); else none
  function categoryValueRecord(style, binding, flags, labels, i) {
    const field = style.valuefield;
    if (!field || field !== binding.value || !flags.has('CATEGORICAL') || !labels || labels[i] == null) return null;
    return { [field]: labels[i] };
  }
  function flatValueText(raw, title, value, style, flags, opts = {}) {
    const units = style.units ? String(style.units) : '';
    const unit = units ? (units[0] === '.' ? '' : ' ') + units : '';
    const unitText = unit.length <= 5 ? unit : '';
    const dec = v => styleNum(style.valuedecimals) || ((v < 1 || (opts.maxValue != null && opts.maxValue <= 1)) ? 1 : 0);
    const signed = (v, text) => {
      if (flags && (flags.has('DIFFERENCE') || flags.has('RELATIVE') || flags.has('SIGN'))) {
        if (v === 0) return '+/-' + text;
        if (v > 0) return '+' + text;
      }
      return text;
    };
    const field = style.valuefield;
    if (field === '$title$') return title != null ? String(title) : '';
    if (field && raw && raw[field] != null && raw[field] !== '') {
      if (isNaN(raw[field])) return String(raw[field]);
      const v = Number(raw[field]);
      return signed(v, flatGroupedValue(v, styleNum(style.valuedecimals) || (v < 1 ? 1 : 0), opts.noBreaks) + unitText);
    }
    return signed(value, flatGroupedValue(value, dec(value), opts.noBreaks) + unitText);
  }

  // .style({valueupper: "1:200000"}) — the real engine's fHideValues gate
  // (maptheme.js ~line 16969/19542): value LABELS (not the whole layer,
  // that's clipupper, out of scope) hide once the map is zoomed out past
  // this scale-denominator threshold, since at that scale the bubbles are
  // too small/numerous for a value label to be legible or useful anyway.
  // .style({featureupper, featurelower}) on a FEATURE theme — flat's
  // scale gate (maptheme.js 2609-2611, 8250-8260): the theme is hidden at
  // scales above featureupper and at or below featurelower ("1:200000" or
  // a bare denominator, __scanScaleValue 2021)
  // a scale style value ("1:200000" or a bare denominator, flat's
  // __scanScaleValue, maptheme.js 2021) as its denominator; 0 when unset
  function scaleDenom(v) {
    return (v == null || v === '' ? 0 : Number(String(v).includes(':') ? String(v).split(':')[1] : v)) || 0;
  }
  function featuresHiddenByScale(style, zoom) {
    const upper = scaleDenom(style.featureupper), lower = scaleDenom(style.featurelower);
    if (!upper && !lower) return false;
    const scale = scaleDenominatorAt(zoom);
    return (lower && scale <= lower) || (upper && scale > upper);
  }

  // .style({chartupper, chartlower}) — flat's scale gate for every theme
  // but FEATURE (maptheme.js 1736-1745, 2614-2617): hidden at scales above
  // chartupper and at or below chartlower; layerupper / layerlower stand in
  // for them when unset (1774-1779)
  function chartHiddenByScale(style, zoom) {
    const upper = scaleDenom(style.chartupper != null ? style.chartupper : style.layerupper);
    const lower = scaleDenom(style.chartlower != null ? style.chartlower : style.layerlower);
    if (!upper && !lower) return false;
    const scale = scaleDenominatorAt(zoom);
    return !!((upper && scale > upper) || (lower && scale <= lower));
  }
  // .style({glowupper, glowlower}) — flat's glow gate (maptheme.js
  // 1726-1734, 16986-16990): the GLOW halo is drawn at scales at or below
  // glowupper and at or above glowlower (both inclusive)
  function glowHiddenByScale(style, zoom) {
    const upper = scaleDenom(style.glowupper), lower = scaleDenom(style.glowlower);
    if (!upper && !lower) return false;
    const scale = scaleDenominatorAt(zoom);
    return !!((upper && scale > upper) || (lower && scale < lower));
  }
  function themeHiddenByScale(flags, style, zoom) {
    return (flags.has('FEATURE') || flags.has('FEATURES')) ? featuresHiddenByScale(style, zoom) : chartHiddenByScale(style, zoom);
  }

  // flat's realize() returns before loading any data for a FEATURE theme
  // out of scale (maptheme.js 8250-8260) and loads it once the theme comes
  // into scale — for the view of that moment, the bbox a broker queries
  function deferredFeatureLoad(spec, zoom) {
    return !!(spec.flags && (spec.flags.has('FEATURE') || spec.flags.has('FEATURES')) && featuresHiddenByScale(spec.style, zoom));
  }

  // flat's shadow gate (maptheme.js 1326-1343, 16732-16762): style.shadow
  // true, at most maxshadow (1000) shapes, within shadowupper/shadowlower
  function flatShadowOn(style, count, zoom) {
    const on = style.shadow === true || style.shadow === 'true' || style.shadow === 1 || style.shadow === '1';
    if (!on) return false;
    if (count > (isNaN(styleNum(style.maxshadow)) ? 1000 : styleNum(style.maxshadow))) return false;
    const upper = scaleDenom(style.shadowupper), lower = scaleDenom(style.shadowlower);
    const scale = scaleDenominatorAt(zoom);
    return !((upper && scale > upper) || (lower && scale < lower));
  }

  // flat tests type flags as substrings (szFlag.match(/SUM/)), so a
  // compound token counts too: "BOTTOMTITLESUM" is BOTTOMTITLE, TITLE and SUM
  function flatFlag(flags, name) {
    for (const f of flags) if (f.includes(name)) return true;
    return false;
  }
  // flat's BOX block (maptheme.js 18758-18760): the box — and its title —
  // is removed at scales above boxupper or below boxlower
  function boxHiddenByScale(style, zoom) {
    const upper = scaleDenom(style.boxupper), lower = scaleDenom(style.boxlower);
    const scale = scaleDenominatorAt(zoom);
    return !!((upper && scale > upper) || (lower && scale < lower));
  }
  // flat's map.Dom.wrapText: words onto lines no wider than widthPx (a word
  // wider than that gets a line of its own)
  let _measureCtx = null;
  function titleTextWidth(text, fontPx) {
    if (!_measureCtx && typeof document !== 'undefined') _measureCtx = document.createElement('canvas').getContext('2d');
    if (!_measureCtx) return text.length * fontPx * 0.55;
    _measureCtx.font = fontPx + 'px arial';
    return _measureCtx.measureText(text).width;
  }
  function wrapTitleLines(text, fontPx, widthPx) {
    const width = w => titleTextWidth(w, fontPx);
    const lines = [];
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const last = lines.length ? lines[lines.length - 1] + ' ' + word : null;
      if (last !== null && width(last) <= widthPx) lines[lines.length - 1] = last;
      else lines.push(word);
    }
    return lines.join('\n');
  }

  function valuesHiddenByScale(style, zoom) {
    const m = /^1:(\d+(?:\.\d+)?)$/.exec(style.valueupper || '');
    if (!m) return false;
    const upperRatio = parseFloat(m[1]);
    const scaleDenominator = scaleDenominatorAt(zoom);
    return scaleDenominator > upperRatio;
  }

  // contrasting text color against a bubble's own fill — standard relative
  // luminance; approximates the real engine's __maptheme_getChartColors(...)
  // .textColor (white text on ixmaps' typically dark/saturated palette,
  // dark text on pale fills) without needing its exact color-space table.
  function contrastTextColor(fillRgb) {
    const [r, g, b] = fillRgb;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? [30, 30, 30] : [255, 255, 255];
  }

  // .style({valuecolor, textcolor}) — real engine precedence, confirmed at
  // maptheme.js:20841 (`szTextColor = this.szValueColor || this.szTextColor
  // || szTextColor`, run just before the BUBBLE symbol branch): an explicit
  // valuecolor wins, then textcolor, and only when NEITHER is set does the
  // auto-computed per-bubble contrast color (contrastTextColor above,
  // approximating __maptheme_getChartColors(...).textColor) apply.
  function resolveTextColor(style, autoRgb) {
    const override = style.valuecolor || style.textcolor;
    return override ? hexOrNamedToRgb(override) : autoRgb;
  }

  // Point-in-bbox test used to scope getFacets() to the current viewport,
  // matching the real engine's viewport-scoped facet behavior (facets sum
  // only records actually on the map, not the whole dataset). Non-point
  // geometries pass through unfiltered — this engine's CHART/AGGREGATE
  // pipeline only ever deals in points.
  function pointInBbox(geometry, bbox) {
    if (!geometry || geometry.type !== 'Point' || !bbox) return true;
    const [lng, lat] = geometry.coordinates;
    const [west, south, east, north] = bbox;
    return lng >= west && lng <= east && lat >= south && lat <= north;
  }

  // Facet-value matching for one active facet clause: either an exact
  // string match (clicking a bar) or a case-insensitive substring match
  // (the "Filtra per ..." search box, LIKE-style).
  function matchesFacetClause(recordValue, clause) {
    if (clause && typeof clause === 'object' && 'like' in clause) {
      return String(recordValue).toLowerCase().includes(String(clause.like).toLowerCase());
    }
    return String(recordValue) === String(clause);
  }

  // scale uses a 512px tile-pixel base, matching MapLibre GL's own
  // internal mercator transform convention (its "world size" at zoom z is
  // 512*2^z, not the older 256px raster-tile convention) — these two
  // helpers exist specifically so GRIDSIZE cell math and BUBBLE relocate
  // grouping round-trip through the SAME pixel space the map itself
  // renders in; a mismatched base silently doubles (or halves) every
  // distance once reprojected through the real map, which showed up as a
  // hard gap between adjacent GRIDSIZE cells — confirmed live: with the
  // old 256 base, cell centers measured exactly 2x their configured
  // gridwidthpx apart on screen.
  function lngLatToWorldPixel(lng, lat, zoom) {
    const scale = 512 * Math.pow(2, zoom);
    const sinLat = Math.sin(lat * Math.PI / 180);
    return { x: (lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale };
  }
  function worldPixelToLngLat(x, y, zoom) {
    const scale = 512 * Math.pow(2, zoom);
    const n = Math.PI - 2 * Math.PI * y / scale;
    return { lng: x / scale * 360 - 180, lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) };
  }

  // .style({gridwidth}) — the real engine's own aggregation cell width
  // (maptheme.js: nGridWidth, confirmed via direct source read as METERS,
  // a fixed real-world size — NOT screen pixels like this port's own
  // .style({aggregation: [...]}) idiom, and NOT the same thing as
  // .style({gridwidthpx}) (the separate, already-pixel-based key the
  // GRIDSIZE/PLOT pipeline uses — see _ensureGridIndex). A meters-based
  // cell keeps the SAME real-world footprint at every zoom (more records
  // fall into it as you zoom out, fewer as you zoom in), unlike a
  // pixel-based radius, which keeps the same ON-SCREEN size and so
  // covers a shrinking real-world area as you zoom in. Uses the same
  // 512px-tile world-pixel space as lngLatToWorldPixel above, so a
  // radius computed here round-trips correctly through the same
  // aggregation/RELOCATE grid math that already consumes clusterRadiusPx
  // in world-pixel terms.
  function metersToWorldPixels(meters, lat, zoom) {
    const scale = 512 * Math.pow(2, zoom);
    const metersPerPixelAtEquator = (2 * Math.PI * EARTH_RADIUS_M) / scale;
    const metersPerPixel = metersPerPixelAtEquator * Math.cos(lat * Math.PI / 180);
    return meters / metersPerPixel;
  }

  // .binding({alpha, alpha100: "$density$"}) — real engine's population-
  // density opacity mode (maptheme.js:9134-9143/9273, __getGeodesicRingArea
  // at 16239-16258, confirmed by direct source read): divides the alpha
  // field's own value by the polygon's own GEODESIC area in km². The real
  // engine caches this as an SVG node attribute, but the area algorithm
  // itself has zero SVG dependency — pure spherical-excess (Chamberlain &
  // Duquette) computed directly from ring coordinates, so it ports cleanly.
  // Same well-known algorithm shape used by turf.js/@mapbox/geojson-area
  // (not an ixmaps-specific formula), using the real source's own
  // confirmed authalic Earth radius constant (6371008.8 m) rather than a
  // library default that might differ slightly. Signed per-ring area is
  // summed directly (not exterior-plus/holes-minus by position) — a valid
  // GeoJSON polygon's holes wind opposite to its exterior, so their signed
  // areas already cancel correctly; MultiPolygon sums every part.
  const EARTH_RADIUS_M = 6371008.8;
  function geodesicRingSignedArea(ring) {
    let area = 0;
    const n = ring.length;
    if (n < 3) return 0;
    for (let i = 0; i < n; i++) {
      const p1 = ring[i === 0 ? n - 1 : i - 1];
      const p2 = ring[i];
      const p3 = ring[(i + 1) % n];
      area += (p3[0] - p1[0]) * Math.PI / 180 * Math.sin(p2[1] * Math.PI / 180);
    }
    return area * EARTH_RADIUS_M * EARTH_RADIUS_M / 2;
  }
  function geodesicPolygonAreaKm2(geometry) {
    if (!geometry) return 0;
    const ringsArea = rings => rings.reduce((sum, ring) => sum + geodesicRingSignedArea(ring), 0);
    let area = 0;
    if (geometry.type === 'Polygon') area = ringsArea(geometry.coordinates);
    else if (geometry.type === 'MultiPolygon') area = geometry.coordinates.reduce((sum, poly) => sum + ringsArea(poly), 0);
    return Math.abs(area) / 1e6;
  }

  // Real ixmaps engine's AGGREGATE spatial-grid binning (maptheme.js
  // ~line 10564, confirmed by direct source read) — the SAME shared
  // mechanism the real engine uses for both per-record aggregation
  // binning and GRIDSIZE cell sizing, ported here as one shared function
  // used by both this engine's GRIDSIZE binning (_ensureGridIndex) and
  // BUBBLE co-location grouping (_groupCoLocated), matching that real
  // architecture instead of the two separate ad-hoc rectangular-only
  // grids this file used to have.
  //
  // RECT (this.flags.has('RECT')): a plain axis-aligned square grid —
  // independently round x and y to the nearest multiple of cellPx.
  //
  // Default (no RECT): genuinely HEXAGONAL, not just a cosmetic label —
  // implemented in the real source as a staggered/offset rectangular grid
  // (alternating columns, or rows under PLOTY, offset by half a cell)
  // followed by a nearest-neighbor correction: a point further than a
  // quarter-cell from its offset-grid snap point gets compared against
  // the two candidate neighboring cell centers and reassigned to
  // whichever is actually closer — this second pass is what makes the
  // tiling genuinely hexagonal rather than just a staggered rectangle.
  // Ported line-for-line from the real source, including its exact
  // variable reuse for the neighbor pass's dy (real source: `dy = (dy
  // === 0) ? hexaHalf : 0`, which — same as the real code — resolves to
  // plain 0 under PLOTY, since dy is never assigned in that branch).
  //
  // x/y/cellPx are all in world-pixel space (lngLatToWorldPixel /
  // worldPixelToLngLat) — the exact analogue of the real engine's own
  // internal projected canvas-coordinate space at the current zoom, so
  // this ports over with no unit conversion.
  //
  // The grid's origin is flat's map origin (zoom given): flat rounds in
  // its SVG map coordinates, whose 0,0 lies on the equator at lon
  // FLAT_GRID_ORIGIN_LON (maptheme.js 10591-10595; read from flat's
  // generic Mercator map: x = 1355.178 + 26.667·lon). Without zoom the
  // world-pixel origin is used.
  function snapToAggregationGrid(x, y, cellPx, flags, zoom) {
    if (zoom != null) {
      const world = 512 * Math.pow(2, zoom);
      const ox = (FLAT_GRID_ORIGIN_LON + 180) / 360 * world, oy = world / 2;
      const s = snapToAggregationGrid(x - ox, y - oy, cellPx, flags);
      return { x: s.x + ox, y: s.y + oy };
    }
    if (flags.has('RECT')) {
      return { x: Math.round(x / cellPx) * cellPx, y: Math.round(y / cellPx) * cellPx };
    }
    const hexaWidth = cellPx * 1.15;
    const hexaHalf = hexaWidth / 2;
    const hexa4th = cellPx / 4;
    let newX, newY, dy;
    if (flags.has('PLOTY')) {
      const yr = Math.round(y / cellPx);
      const dx = yr % 2 ? hexaHalf : 0;
      newX = Math.round((x + dx) / hexaWidth) * hexaWidth - dx;
      newY = yr * cellPx;
    } else {
      const xr = Math.round(x / cellPx);
      dy = xr % 2 ? hexaHalf : 0;
      newX = xr * cellPx;
      newY = Math.round((y + dy) / hexaWidth) * hexaWidth - dy;
    }
    if (Math.abs(newX - x) > hexa4th) {
      dy = dy === 0 ? hexaHalf : 0;
      let n0x, n0y, n1x, n1y;
      if (newX > x) {
        n0x = newX - cellPx; n0y = newY - hexaHalf;
        n1x = newX - cellPx; n1y = newY + hexaHalf;
      } else {
        n0x = newX + cellPx; n0y = newY - hexaHalf;
        n1x = newX + cellPx; n1y = newY + hexaHalf;
      }
      const d0 = Math.hypot(n0x - x, n0y - y);
      const d1 = Math.hypot(n1x - x, n1y - y);
      const d3 = Math.hypot(newX - x, newY - y);
      if (d0 < d3) {
        newX = Math.round(n0x / cellPx) * cellPx;
        newY = Math.round((n0y + dy) / hexaWidth) * hexaWidth - dy;
      } else if (d1 < d3) {
        newX = Math.round(n1x / cellPx) * cellPx;
        newY = Math.round((n1y + dy) / hexaWidth) * hexaWidth - dy;
      }
    }
    return { x: newX, y: newY };
  }

  function packBubbles(radii) {
    const n = radii.length;
    if (n <= 1) return [{ x: 0, y: 0 }];
    const pos = radii.map((_, i) => ({ x: Math.cos(i / n * Math.PI * 2) * 0.01, y: Math.sin(i / n * Math.PI * 2) * 0.01 }));
    for (let iter = 0; iter < 200; iter++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const minDist = radii[i] + radii[j];
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2, ux = dx / dist, uy = dy / dist;
          pos[i].x -= ux * overlap; pos[i].y -= uy * overlap;
          pos[j].x += ux * overlap; pos[j].y += uy * overlap;
        }
      }
    }
    const cx = pos.reduce((s, p) => s + p.x, 0) / n, cy = pos.reduce((s, p) => s + p.y, 0) / n;
    return pos.map(p => ({ x: p.x - cx, y: p.y - cy }));
  }

  const BUBBLE_ICON_SIZE = 48;

  // deck.gl@9.4's MapLibre-globe interleaving (see LIB_URLS `deck` comment)
  // renders every IconLayer icon as a flat billboard quad in 3D space; the
  // GPU's default back-face culling can hide that quad depending on which
  // way it happens to face relative to the globe's curved surface at the
  // point it's anchored to — confirmed live: bubble/glow icons were
  // completely invisible on the globe (0 rendered, no console error) while
  // the GeoJsonLayer country fill on the SAME globe correctly curved into
  // view. `billboard: true` (deck.gl's own IconLayer default already, kept
  // explicit here as documentation) keeps the quad screen-facing; disabling
  // culling on top of that is still needed for it to actually draw. v9's
  // `parameters` use luma.gl's WebGPU-style string constants, not v8's
  // GL-constant object keys (e.g. `{[GL.CULL_FACE]: false}`) — confirmed
  // live: `cullMode: 'none'` is accepted with no console warning and the
  // icons render.
  //
  // `depthCompare: 'always'` (same fix, same reason, as the FEATURE/
  // FEATURES GeoJsonLayer — see _buildFeaturesLayers) — confirmed live,
  // separately, on a SECOND real bug on top of the culling one above:
  // even once visible, every bubble/glow icon rendered as a half-moon/kite
  // shape instead of a full circle, worse near the globe's limb and
  // closer to correct near the view center. The icon's billboard quad
  // extends a few pixels beyond its anchor point on the sphere surface in
  // every direction; near the limb, the surface curves away from the
  // camera fast enough that part of that quad falls "behind" the sphere's
  // own depth from the GPU's point of view and gets clipped, even though
  // the whole point of `billboard: true` is that the quad should always
  // fully face the camera regardless of surface curvature at that point.
  // Same underlying mechanism as the country-fill "holes" bug: two
  // independently-rendered systems (deck.gl's icon quad, MapLibre's own
  // globe-sphere mesh) competing for the same depth-buffer real estate.
  const ICON_LAYER_GLOBE_PARAMETERS = { cullMode: 'none', depthCompare: 'always' };

  // GLOBE_HORIZON_DEG / isOnVisibleHemisphere: `depthCompare: 'always'`
  // above (needed to stop the near-surface z-fighting/half-moon bug —
  // see ICON_LAYER_GLOBE_PARAMETERS' own comment) makes this icon layer
  // ALWAYS pass the depth test, i.e. it never gets occluded by anything,
  // including MapLibre's own near-side globe surface — combined with
  // `cullMode:'none'` (also required, for billboards near the limb), a
  // bubble anchored on the FAR hemisphere has literally nothing left to
  // hide it. Confirmed live as a real, user-reported regression from
  // that fix: rotating the globe showed bubbles from "the other side"
  // bleeding straight through. The FEATURE/CHOROPLETH GeoJsonLayer polygon
  // fill doesn't have this problem despite the same depthCompare override
  // (see _buildFeaturesLayers' own comment) because ITS far-side culling
  // comes from ordinary GPU back-face culling (orientation-based, keyed
  // off the polygon winding order flipping on the sphere's far side) —
  // untouched by depthCompare either way. A billboarded icon quad has no
  // such orientation to cull by (it always faces the camera on purpose),
  // so this engine culls by geography instead: a great-circle angular
  // distance from the map's current center (globe projection's own
  // "facing the camera" point) beyond ~90 degrees is, by definition, on
  // the far hemisphere. 90 exactly (not padded smaller) since the goal is
  // only to stop the far side bleeding through, not to hem in near-limb
  // points that are still legitimately visible (if foreshortened).
  const GLOBE_HORIZON_DEG = 90;
  function isOnVisibleHemisphere(lng, lat, center) {
    const toRad = d => d * Math.PI / 180;
    const phi0 = toRad(center.lat), phi1 = toRad(lat);
    const dLambda = toRad(lng - center.lng);
    const cosAngle = Math.sin(phi0) * Math.sin(phi1) + Math.cos(phi0) * Math.cos(phi1) * Math.cos(dLambda);
    return cosAngle > Math.cos(GLOBE_HORIZON_DEG * Math.PI / 180);
  }

  // Alpha (0-255) an icon renders at once ixmaps.markThemeClass has
  // isolated at least one category on this theme and this particular icon
  // ISN'T one of the marked ones — see LayerRuntime#_iconAlpha. Matches
  // the real engine's "isolate_gray" evidence mode (dim, don't remove) —
  // near-zero rather than a visible partial tint, per explicit correction
  // (an earlier ~25% alpha read as too visible/not actually "dimmed").
  // Kept just above 0 (not fully transparent) so a marked category's own
  // position is still technically hit-testable/inspectable rather than
  // functionally deleted.
  const DIMMED_ICON_ALPHA = 8;

  // deck.gl's IconLayer auto-packing atlas (icon-manager.ts, read and
  // measured on 8.9.35; the guards below are kept for 9.x, not re-measured
  // there) has NO eviction and NO cap of its own: its texture is 1024px wide (fixed) but
  // grows TALLER via power-of-two resize forever, for every distinct icon
  // id ever seen, for the lifetime of the layer — confirmed by reading
  // that file directly. There is no "atlas full" code path; it just keeps
  // allocating a bigger GPU texture until that allocation exceeds the
  // device's real WebGL MAX_TEXTURE_SIZE, at which point the texture
  // silently ends up incomplete/corrupt — rendering as solid black
  // rectangles.
  //
  // ICON_CACHE_MAX must be set ABOVE the largest number of distinct icons
  // any SINGLE frame can legitimately need, not just "reasonably large":
  // measured live against the real 69,597-row dataset at a wide, whole-
  // region zoom, one single settled frame needed 900-1550 distinct
  // cluster-bubble shapes depending on RATIO_BUCKETS (see
  // _buildBubbleIcon) — a first attempt at 500 was actually BELOW that,
  // which doesn't just evict occasionally, it THRASHES: every redraw of
  // that same frame re-evicts and regenerates icons still needed by that
  // very frame, in a tight loop, which is worse than no cap at all (it
  // was the actual cause of an observed runaway icon-atlas-reset rate,
  // not genuine cross-session accumulation). 2000 comfortably clears the
  // measured worst case with headroom for the larger PLOT/grid icons
  // that share this same cache.
  const ICON_CACHE_MAX = 2000;

  // ICON_CACHE_MAX above only bounds THIS engine's own JS-side cache — it
  // does NOT bound deck.gl's internal atlas, which (confirmed by reading
  // icon-manager.ts directly) has no eviction of its own: an IconLayer's
  // IconManager remembers every distinct icon id it has EVER packed, for
  // the entire lifetime of that layer INSTANCE, regardless of whether
  // this engine's own cache later evicts its reference to it — so even a
  // correctly-sized, non-thrashing cache still lets deck.gl's OWN atlas
  // grow across MANY DIFFERENT zoom levels visited over a session. The
  // only way to actually reclaim that GPU-side state is to force deck.gl
  // to build a brand NEW IconLayer instance (a fresh IconManager, fresh
  // empty atlas) — which deck.gl's own layer-diffing does automatically
  // whenever a layer's id changes between redraws, the same "key"
  // mechanism React uses. Every icon-atlas-based layer id therefore
  // carries a rotating "-gN" generation suffix (see
  // LayerRuntime._cacheIcon), bumped once enough NEW icons have been
  // created since the last rotation. Set comfortably above ICON_CACHE_MAX
  // (one single zoom level's worth of legitimate icons must never, on its
  // own, trigger a mid-frame reset) so this only fires from genuine
  // accumulation across distinct zoom levels over time, not from any one
  // frame — while still keeping deck.gl's own cumulative atlas bounded to
  // roughly this many icons before a reset, comfortably inside the
  // researched safe range (~1480-2980 distinct 48px icons before a real
  // device's WebGL MAX_TEXTURE_SIZE is at risk).
  const ICON_ATLAS_RESET_AFTER = 3000;
  // The same reset by icon AREA: a few large icons (BOX rectangles around
  // MULTIQUAD grids, hundreds of px each, new sizes at every zoom) fill
  // deck.gl's 1024 px wide atlas long before 3000 icons — on the PNRR
  // page a dozen boxes doubled it per zoom step, until it passed WebGL's
  // MAX_TEXTURE_SIZE (16384) and the boxes drew black. 2 Mpx leaves room
  // for the atlas's row-packing waste (measured ~2×) below that limit.
  const ICON_ATLAS_AREA_RESET_AFTER = 2 * 1024 * 1024;

  // Shared packing layout for a multi-category group's sub-bubbles — used
  // both to draw the packed icon raster (_buildBubbleIcon) and to position
  // each sub-bubble's own VALUES text label at that same canvas-space spot
  // (see _buildChartLayers), so a label always lines up with the specific
  // sub-bubble it belongs to rather than a single combined number for the
  // whole group.
  function computeBubblePackLayout(counts, size) {
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const present = [];
    counts.forEach((c, i) => { if (c > 0) present.push({ i, c }); });
    const maxR = size / 2 - 1.5;
    // near-zero floor (was maxR*0.28, i.e. a minority category could never
    // shrink below 28% of the max sub-bubble size) — same treatment as
    // VALUE_RADIUS_MIN above: aggressive-size-contrast themes need a
    // minority slice to actually recede at zoomed-out views, not clamp
    // to an artificially visible minimum
    const radii = present.map(p => Math.max(0.1, maxR * Math.sqrt(p.c / total)));
    const offsets = packBubbles(radii);
    let furthest = 0;
    offsets.forEach((o, i) => { const d = Math.hypot(o.x, o.y) + radii[i]; if (d > furthest) furthest = d; });
    const fitScale = furthest > maxR ? maxR / furthest : 1;
    return { present, radii, offsets, fitScale, maxR };
  }

  // A group while legend classes are marked (flat's MapTheme.markClass,
  // maptheme.js 14339-14420, evidence "isolate" — the default): the parts
  // of the other categories are hidden, the marked ones keep their own
  // size and move to the group's center (the SEQUENCE transform reset to
  // its scale only). Biggest first, so a smaller marked part stays on top.
  // null when no marked category is in the group.
  function isolatedBubblePackLayout(counts, size, marked) {
    const full = computeBubblePackLayout(counts, size);
    const keep = full.present.map((p, k) => k).filter(k => marked.has(full.present[k].i))
      .sort((a, b) => full.radii[b] - full.radii[a]);
    if (!keep.length) return null;
    return {
      present: keep.map(k => full.present[k]),
      radii: keep.map(k => full.radii[k]),
      offsets: keep.map(() => ({ x: 0, y: 0 })),
      fitScale: full.fitScale, maxR: full.maxR
    };
  }

  // MULTIQUAD / MULTISQUARE (flat maptheme.js 18648-18690): the items at
  // one position, in drawing order, fill quads around it — the k-th at
  // square = ⌊√k⌋, (k − square², square) while that is within the square,
  // else (square, square − (k − square² − square)); once square reaches
  // gridx, rows of gridx go on upward (k % gridx, ⌊k / gridx⌋). Steps of
  // 2 · normal radius · rangescale (flat's chart size, measured on the PNRR
  // page); y up. Returns per item its pixel offset and index, and per
  // position's first item the extent [minX, minY, maxX, maxY] of the
  // offsets there (flat sizes the BOX around all of them).
  function multiQuadOffsets(items, normalRadiusPx, rangeScale, gridX) {
    const step = 2 * normalRadiusPx * (rangeScale || 1);
    const count = new Map(), offset = new Map(), index = new Map(), first = new Map(), extent = new Map();
    for (const d of items) {
      const c = d.geometry && d.geometry.coordinates;
      const key = c ? c[0] + ',' + c[1] : '';
      const k = count.get(key) || 0;
      count.set(key, k + 1);
      index.set(d, k);
      if (k === 0) { first.set(key, d); extent.set(d, [0, 0, 0, 0]); }
      let x = 0, y = 0;
      if (k > 0) {
        const square = Math.floor(Math.sqrt(k));
        if (square < (gridX || Infinity)) {
          const line = k - square * square;
          x = line <= square ? line : square;
          y = line <= square ? square : square - (line - square);
        } else {
          x = k % gridX;
          y = Math.floor(k / gridX);
        }
      }
      offset.set(d, [x * step, -y * step]);
      const e = extent.get(first.get(key));
      e[0] = Math.min(e[0], x * step); e[1] = Math.min(e[1], -y * step);
      e[2] = Math.max(e[2], x * step); e[3] = Math.max(e[3], -y * step);
    }
    return { offset, index, extent };
  }

  // A pixel offset [dx, dy] (y down) from lngLat at MapLibre zoom `zoom`,
  // as lng/lat (Web Mercator, 512 px world tiles) — for shapes too large
  // for an icon, drawn in map coordinates (rebuilt with every refresh).
  function pixelOffsetLngLat(lngLat, offset, zoom) {
    const world = 512 * Math.pow(2, zoom);
    const lat0 = lngLat[1] * Math.PI / 180;
    const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + lat0 / 2)) / (2 * Math.PI)) * world + offset[1];
    const lat = (2 * Math.atan(Math.exp((0.5 - y / world) * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI;
    return [lngLat[0] + offset[0] * 360 / world, lat];
  }

  // CHART|SYMBOL|SEQUENCE (flat maptheme.js 21184-21300, 21790-21925,
  // 22296-22395): one symbol per category part of a chart, in category
  // order or sorted (SORT: DOWN biggest first, UP smallest first), parts
  // of value 0 left out. radiusOf(v) is the part's radius (flat: max radius
  // · (v / max value)^(1/sizepow)). Placement:
  //  - STAR: the first part is the center (star radius R = its radius); each
  //    further part (with UP every part) sits on a circle around it, at
  //    R + r (×1.5 EXPAND, ×2 EXPANDMAX, ×rangescale), stepping the angle
  //    by f = 90° − asin(√((R+r)² − r²) / (R+r)) before and after it, so
  //    neighbours touch; UP: radius R·(1 + parts/5), the angle step of the
  //    7th part on divided by 1 + 2r/maxRadius; with EXPAND|SORT|UP,
  //    R = (EXPANDMAX ? 2 : 0.5) · maxRadius · √(biggest / max value)
  //    (LINEAR/SIZEP1: linear), COMPRESS halves it (COMPRESSMAX quarter)
  //  - HORZ: side by side from the center to the right
  //  - otherwise (or CENTER): all on the center
  // Returns the parts in drawing order: { i, v, r, x, y } (pixels, y down).
  function sequenceLayout(counts, flags, radiusOf, opts = {}) {
    const has = f => flatFlag(flags, f);
    const word = w => [...flags].some(f => new RegExp('\\b' + w + '\\b').test(f));
    let order = counts.map((v, i) => ({ i, v }));
    if (word('SORT')) {
      if (word('UP')) order.sort((a, b) => a.v - b.v);
      else if (word('DOWN')) order.sort((a, b) => b.v - a.v);
    }
    const parts = [];
    const star = has('STAR') && !has('CENTER'), horz = has('HORZ') && !has('CENTER');
    const up = word('UP');
    const maxR = opts.maxRadius || 0;
    const nStarParts = opts.nParts || counts.length;
    let angle = 0, starR = null, x = 0;
    order.forEach((p, k) => {
      if (!p.v) return;
      const r = radiusOf(p.v);
      if (!(r > 0)) return;
      let px = 0, py = 0;
      if (star) {
        if (starR === null) {
          starR = r;
          if (has('EXPAND') && word('SORT') && up) {
            const big = order[order.length - 1].v, mv = opts.maxValue || big || 1;
            starR = (has('EXPANDMAX') ? 2 : 0.5) * maxR * (has('LINEAR') || has('SIZEP1') ? big / mv : Math.sqrt(big / mv));
          }
          if (has('COMPRESS')) starR *= has('COMPRESSMAX') ? 0.25 : 0.5;
        }
        if (parts.length > 0 || up) {
          const c = starR + r;
          const b = Math.sqrt(Math.max(0, c * c - r * r));
          let f = 90 - Math.asin(Math.min(1, b / c)) / Math.PI * 180;
          let dist = starR + r;
          if (up) {
            if (k > 5) f /= (1 + 2 * (r / (maxR || r)));
            dist = starR * (1 + nStarParts / 5);
          }
          if (opts.rangeScale) dist *= opts.rangeScale;
          else dist = has('EXPANDMAX') ? dist * 2 : (has('EXPAND') ? dist * 1.5 : dist);
          angle += f;
          px = Math.cos(angle / 180 * Math.PI) * dist;
          py = Math.sin(angle / 180 * Math.PI) * dist;
          angle += f;
        }
      } else if (horz) {
        x += r; px = x; x += r;
      }
      parts.push({ i: p.i, v: p.v, r, x: px, y: py });
    });
    return parts;
  }

  // ---------------------------------------------------------------
  // Classification — pure functions (no LayerRuntime state): class
  // breaks for a numeric field, and which class a value falls in.
  // LayerRuntime keeps thin _method delegations to these.
  // ---------------------------------------------------------------
  function equalIntervalBreaks(nMin, nMax, nParts) {
    const nStep = (nMax - nMin) / nParts || 1; // guard a zero-range dataset (all values equal)
    return new Array(nParts).fill(null).map((_, i) => ({
      min: nMin + i * nStep,
      max: nMin + (i + 1) * nStep
    }));
  }

  // .type("QUANTILE") — equal-COUNT classes (as opposed to
  // _equalIntervalBreaks's equal-WIDTH ranges). The real engine
  // (maptheme.js:13024-13032, getMeanMedianQuantile + distributeValues'
  // QUANTILE branch) sorts every value ascending and computes a FIXED
  // stride ONCE (nMaxMember = round(N/nParts)), then reuses it for every
  // boundary (index i*nMaxMember) — a real quirk: rounding error from
  // that single division compounds linearly with i instead of being
  // corrected at each step, so class sizes drift uneven (and the drift
  // all piles onto the last class, since its max is force-set to the
  // true data max regardless of where the stride landed).
  //
  // Deliberately NOT ported here — this recomputes each boundary
  // independently as round(i*N/nParts), the textbook percentile-split
  // formula, so class membership stays as close to equal-count as
  // integer rounding allows at every boundary, not just the first few.
  function quantileBreaks(values, nParts) {
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const breaks = new Array(nParts).fill(null).map((_, i) => ({
      min: sorted[Math.min(Math.round(i * n / nParts), n - 1)],
      max: sorted[Math.min(Math.round((i + 1) * n / nParts), n - 1)]
    }));
    breaks[breaks.length - 1].max = sorted[n - 1];
    return breaks;
  }

  // .type("NATURAL") — Jenks natural breaks (maptheme.js:8085-8168,
  // getNaturalBreaks): the classic Fisher-Jenks "goodness of variance
  // fit" O(n^2 * nParts) dynamic program, minimizing total within-class
  // variance. The DP recurrence and backtracking below are ported
  // directly from the real source (same matrices, same accumulation).
  //
  // One necessary, loudly-documented deviation: the real engine runs
  // this on the FULL raw per-record value array with NO cap, sample, or
  // early-out anywhere in the source (confirmed) — fine for the small
  // datasets ixmaps typically classes, but at this engine's real scale
  // (this project's own AREU layer is 69,597 records) O(n^2*k) is tens
  // of billions of operations and would hang the browser tab solid, not
  // "run slowly but correctly." That's a genuine scalability gap in the
  // source, not a detail to silently reproduce. Past
  // NATURAL_BREAKS_MAX_SAMPLE values, this classifies an evenly-strided
  // sample of the sorted distribution instead of every value — standard
  // practice for Jenks at scale (what d3/simple-statistics-based tools
  // do too) — since the sample only decides WHERE the class boundaries
  // fall, not which bucket each actual record's color resolves to
  // afterward (every record is still tested against the resulting
  // partsA individually, same as every other method here).
  function naturalBreaks(values, nParts) {
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const sample = n > NATURAL_BREAKS_MAX_SAMPLE ? evenStrideSample(sorted, NATURAL_BREAKS_MAX_SAMPLE) : sorted;

    // Not enough DISTINCT values to fill every class → identity breaks,
    // one class per distinct value, the surplus classes padded at the top.
    // The source guards only `n <= nParts` (maptheme.js getNaturalBreaks,
    // whose own comment says "not enough distinct items"): with fewer
    // distinct values than classes but more records (ties), the DP below
    // leaves back-pointers at 0 and the backtrack reads valuesA[-2] —
    // undefined class bounds, values in no class. Checking distinct values,
    // as that comment intends, fixes it (flat itself still has the bug).
    const distinct = sample.filter((v, i) => i === 0 || v !== sample[i - 1]);
    if (distinct.length <= nParts) {
      const identity = [distinct[0] || 0].concat(distinct);
      while (identity.length < nParts + 1) identity.push(identity[identity.length - 1]);
      return partsFromBreakValues(identity, nParts, sorted[n - 1]);
    }

    const breakValues = jenksBreakValues(sample, nParts);
    return partsFromBreakValues(breakValues, nParts, sorted[n - 1]);
  }

  function evenStrideSample(sortedValues, sampleSize) {
    const n = sortedValues.length;
    return new Array(sampleSize).fill(null).map((_, i) =>
      sortedValues[Math.min(Math.round(i * (n - 1) / (sampleSize - 1)), n - 1)]);
  }

  // core Fisher-Jenks DP, ported line-for-line from getNaturalBreaks —
  // mat1/mat2 are the lower-class-limit / cumulative-variance matrices;
  // v is the within-segment sum-of-squared-deviations for the trailing
  // run ending at l, recomputed incrementally as the window grows.
  function jenksBreakValues(valuesA, nParts) {
    const n = valuesA.length;
    const mat1 = [], mat2 = [];
    for (let i = 0; i <= n; i++) {
      mat1.push(new Array(nParts + 1).fill(0));
      mat2.push(new Array(nParts + 1).fill(0));
    }
    for (let i = 1; i <= nParts; i++) {
      mat1[1][i] = 1;
      mat2[1][i] = 0;
      for (let j = 2; j <= n; j++) mat2[j][i] = Infinity;
    }

    let v = 0;
    for (let l = 2; l <= n; l++) {
      let s1 = 0, s2 = 0, w = 0;
      for (let m = 1; m <= l; m++) {
        const i3 = l - m + 1;
        const val = valuesA[i3 - 1];
        s2 += val * val;
        s1 += val;
        w++;
        v = s2 - (s1 * s1) / w;
        const i4 = i3 - 1;
        if (i4 !== 0) {
          for (let j = 2; j <= nParts; j++) {
            if (mat2[l][j] >= (v + mat2[i4][j - 1])) {
              mat1[l][j] = i3;
              mat2[l][j] = v + mat2[i4][j - 1];
            }
          }
        }
      }
      mat1[l][1] = 1;
      mat2[l][1] = v;
    }

    let k = n;
    const breaks = [];
    breaks[nParts] = valuesA[n - 1];
    breaks[0] = valuesA[0];
    let countNum = nParts;
    while (countNum > 1) {
      const id = mat1[k][countNum] - 2;
      breaks[countNum - 1] = valuesA[id];
      k = mat1[k][countNum] - 1;
      countNum--;
    }
    return breaks;
  }

  // breakValues[i] (for 0 < i < nParts) is the LAST element of segment
  // i-1 in the DP's own backtracking, not the first element of segment
  // i — verified empirically: on a 3-cluster test dataset ({1..10},
  // {50,51,52}, {100..103}), the DP's own within-class variance is
  // minimized only if the shared boundary value (e.g. 10) stays in the
  // LOWER segment, not the upper one. Since _resolvePartsClass tests
  // every class as inclusive-min/exclusive-max (except the true last
  // class), each non-last segment's max is nudged just past its shared
  // boundary value so ties resolve toward the lower (already-optimal)
  // segment instead of leaking into the next one.
  function partsFromBreakValues(breakValues, nParts, trueMax) {
    const TIE_EPSILON = 1e-6;
    return new Array(nParts).fill(null).map((_, i) => ({
      min: breakValues[i],
      max: i === nParts - 1 ? trueMax : breakValues[i + 1] + TIE_EPSILON
    }));
  }

  // partsA override param: lets a caller classify against a DIFFERENT,
  // dynamically-computed breaks array (e.g. the AGGREGATE reclassify
  // step in _buildChartLayers, which needs to bucket a post-aggregation
  // cell TOTAL, not this runtime's own static this.partsA built from
  // raw per-record values) without disturbing this.partsA itself,
  // which every other caller here still relies on unchanged.
  function resolvePartsClass(value, partsA) {
    if (!partsA || isNaN(value)) return null;
    for (let i = 0; i < partsA.length; i++) {
      const isLast = i === partsA.length - 1;
      const inLower = value >= partsA[i].min;
      const inUpper = isLast ? value <= partsA[i].max : value < partsA[i].max;
      if (inLower && inUpper) return i;
    }
    return null; // outside every class (e.g. explicit user ranges that don't cover the data) -> caller drops the feature
  }


  // --- per-theme class statistics (compute) and per-item lookups (resolve):
  //     computeX returns fields under the exact names LayerRuntime keeps
  //     (Object.assign(this, result)); resolveX reads only its own fields
  //     from ctx (the runtime, or a plain object in the unit tests)

  // .binding({alpha, alpha100}) prep — orthogonal to classification (real
  // source confirms this combines with CHOROPLETH's own DOMINANT mode,
  // not just plain range-classed themes), computed once per theme build.
  // Cheap no-op unless binding.alpha is actually set. Three modes, real
  // source confirmed (maptheme.js:9834-9852/9134-9143):
  //  - alpha100 is the literal string "$density$": per-feature value =
  //    (alpha field's own value) / (that polygon's own geodesic area in
  //    km²) — see geodesicPolygonAreaKm2.
  //  - alpha100 is any OTHER (real field) name: percent-normalize,
  //    100/alpha100Value*alphaValue.
  //  - alpha100 unset: the alpha field's raw value, unchanged.
  // _alphaMax (the max nAlpha across every feature) is the ramp's own
  // denominator in _resolveDopacityAlpha — a SEPARATE stats pass from
  // the main bound value's min/max/median, real source confirmed.
  // Keyed by feature object identity (WeakMap), not written into
  // properties — this is a derived rendering input, not real CSV data,
  // and keeping it out of `properties` keeps it out of the tooltip's
  // bare-field/`raw` mustache expansion too.
  function computeAlphaStats(features, binding) {
    const out = {};
    if (!binding.alpha) return null;
    const alpha100 = binding.alpha100;
    const isDensity = alpha100 === '$density$';
    out._alphaByFeature = new WeakMap();
    let maxAlpha = -Infinity, minAlpha = Infinity;
    features.forEach(f => {
      // flat: an alpha that is no number is 0 (maptheme.js 9853-9857)
      let v = parseFloat(f.properties[binding.alpha]);
      if (isNaN(v)) v = 0;
      if (isDensity) {
        const areaKm2 = featureAreaKm2(f);
        if (!areaKm2) return;
        v = v / areaKm2;
      } else if (alpha100) {
        const v100 = parseFloat(f.properties[alpha100]);
        if (!isNaN(v100) && v100) v = 100 / v100 * v;
      }
      out._alphaByFeature.set(f, v);
      if (v > maxAlpha) maxAlpha = v;
      if (v < minAlpha) minAlpha = v;
    });
    out._alphaMax = isFinite(maxAlpha) ? maxAlpha : 0;
    out._alphaMin = isFinite(minAlpha) ? minAlpha : 0; // flat nMinAlpha, the compact legend's lower end
    return out;
  }

  // Shared setup for every MULTI-field CHOROPLETH mode (DOMINANT's three
  // relevance formulas, and COMPOSECOLOR): parses binding.value's
  // pipe-joined field list (same pipe convention
  // csvRowsToFeatureCollection's binding.position already uses) and
  // resolves one label/color per field — same .style({values:[...]})
  // explicit-ordered-list convention as CATEGORICAL, positionally
  // aligned with the piped fields (e.g. AGE_BANDS, built by mapping over
  // the very same array that produced the pipe-joined binding.value). No
  // raw-vs-display distinction needed here (unlike CATEGORICAL's
  // categoryLabels/categoryDisplayLabels split) — there's no exact-match
  // filtering against these labels, only field-index lookup.
  function computeMultiFieldClasses(binding, style) {
    const out = {};
    const fields = binding.value.split('|');
    out._multiFields = fields;
    const explicit = Array.isArray(style.values) && style.values.length === fields.length
      ? style.values.map(String) : fields;
    out.categoryLabels = explicit;
    // .style({label}) names the fields' classes (flat's szLabelA, legend.js
    // 600-640; extra labels are dropped)
    const label = Array.isArray(style.label) && style.label.length >= fields.length ? style.label.slice(0, fields.length).map(String) : null;
    out.categoryDisplayLabels = label || explicit;
    out.categoryColorsRgb = resolveClassColors(style.colorscheme, out.categoryLabels, style.classes);
    
    return out;
  }

  // .type("CHOROPLETH|DOMINANT") prep — computes, once per theme build,
  // each piped field's own cross-record MEAN, MIN, and (population)
  // STANDARD DEVIATION (over this.features, i.e. every polygon this
  // CHOROPLETH's join produced — real source: maptheme.js:13086-13160,
  // distributeValues' DOMINANT block, plus getDeviationOfArray at line
  // 6198 for the stddev itself; nMinA doubles as the default nFilterA in
  // _resolveDominantClass). All three are computed unconditionally even
  // though a given theme only ends up using one relevance formula — the
  // pass is cheap, and one prep path avoids duplicating the field-parsing
  // loop per mode. The pooling differs per statistic, as in the real
  // source (verified against real ixmaps-flat with --flat-oracle):
  // MEAN and MIN take every finite value INCLUDING 0 — nSumA/nMinA are
  // accumulated per item (maptheme.js:9121-9128) and nMeanA = nSumA /
  // nCount divides by the item count (maptheme.js:13126ff) — the DATA
  // records, so a polygon without a joined record (empty properties, see
  // joinChoroplethFeatures) is not counted; the STDDEV
  // pools only truthy values (skips NaN AND exactly 0, `if
  // (nValuesA[i]) nPopA.push(...)`, maptheme.js:12976) around that
  // pool's own mean, as getDeviationOfArray does.
  //
  // With a field100 (value100) the MEAN is flat's pooled one instead
  // (maptheme.js 13132-13150, nOrigSumA / nSum100 · 100): Σ field / Σ
  // field100 — here, as the items hold the percentages, the field100-
  // weighted mean of the percentages (unless DIFFERENCE, where flat keeps
  // nSumA / nCount).
  function computeDominantStats(features, binding, style, flags) {
    const out = {};
    Object.assign(out, computeMultiFieldClasses(binding, style));
    const fields = out._multiFields;
    const f100 = binding.field100 && !(flags && flags.has('DIFFERENCE')) ? String(binding.field100).split('|')[0] : null;
    const sums = fields.map(() => 0), mins = fields.map(() => Infinity);
    const pooled = fields.map(() => 0);
    let sum100 = 0;
    const valuesByField = fields.map(() => []);
    let nItems = 0;
    features.forEach(f => {
      if (!f.properties || !Object.keys(f.properties).length) return; // unjoined polygon
      nItems++;
      const v100 = f100 ? parseFloat(f.properties[f100]) : NaN;
      if (f100 && isFinite(v100)) sum100 += v100;
      fields.forEach((field, i) => {
        const v = parseFloat(f.properties[field]);
        if (!isFinite(v)) return;
        sums[i] += v;
        if (f100 && isFinite(v100)) pooled[i] += v * v100;
        if (v < mins[i]) mins[i] = v;
        if (v) valuesByField[i].push(v); // stddev pool: truthy values only
      });
    });
    out._dominantMeans = f100 && sum100
      ? pooled.map(p => p / sum100)
      : sums.map(s => nItems ? s / nItems : 0);
    out._dominantMins = mins.map(m => isFinite(m) ? m : 0);
    // Population standard deviation (divide by N, no Bessel's
    // correction) of the truthy pool around its own mean — matches
    // getDeviationOfArray exactly.
    out._dominantStdDevs = valuesByField.map(vals => {
      if (!vals.length) return 0;
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length;
      return Math.sqrt(variance);
    });
    return out;
  }

  // Which piped field "wins" for one joined polygon's properties — three
  // relevance formulas, real engine confirmed by direct source read:
  //
  // PERCENTOFMEAN (maptheme.js:13491/13505): nRelevanz = 100 * value /
  // mean[i].
  // DEVIATION (maptheme.js:13493/13502-13503, stddev from
  // getDeviationOfArray): nRelevanz = (value - mean[i]) / stddev[i] — a
  // z-score. Every mode (plain DOMINANT too) shares the SAME filter: a
  // field can only win if its own value is strictly greater than that
  // field's own dataset-wide MIN, zeros included — so 0 for non-negative
  // data (real source: `nValue > (nFilterA[i] || 0)`, maptheme.js:21423,
  // default nFilterA[i] = nMinA[i]; szDominantFilter
  // "mean"/"median" variants aren't implemented, not used by any config
  // ported here). Both deliberately unguarded against divide-by-zero
  // (mean=0 or stddev=0) — matching the real source exactly: that
  // naturally yields Infinity/NaN, and NaN can never win the `>`
  // comparison below (though +Infinity CAN — a real, confirmed-unguarded
  // quirk of the source itself, not introduced here).
  //
  // Plain DOMINANT (no PERCENTOFMEAN/DEVIATION, per explicit
  // correction): nRelevanz = value itself — the field with the highest
  // raw value wins (subject to the min filter above). "Which band dominates
  // this comune's own local profile," not a cross-record comparison.
  //
  // All three: the winning threshold starts at 0, not -Infinity (real
  // source: maptheme.js:13440, nLastRelevant reset to 0 per record,
  // shared by every relevance mode) — a field must have a STRICTLY
  // POSITIVE relevance score to win at all, so DEVIATION in particular
  // only ever picks a field ABOVE its own mean, never the most anomalous
  // in either direction. Ties go to the first (lowest-index) field
  // (strict `>`).
  function resolveDominantClass(ctx, props) {
    const fields = ctx._multiFields;
    const usePercentOfMean = ctx.flags.has('PERCENTOFMEAN');
    const useDeviation = ctx.flags.has('DEVIATION');
    let bestIndex = -1, bestRelevance = 0, bestValue = null;
    for (let i = 0; i < fields.length; i++) {
      const v = parseFloat(props[fields[i]]);
      if (!(v > (ctx._dominantMins[i] || 0))) continue;
      const relevance = useDeviation ? (v - ctx._dominantMeans[i]) / ctx._dominantStdDevs[i]
        : usePercentOfMean ? 100 * v / ctx._dominantMeans[i]
        : v;
      if (relevance > bestRelevance) { bestRelevance = relevance; bestIndex = i; bestValue = v; }
    }
    return bestIndex === -1 ? null : { index: bestIndex, value: bestValue };
  }

  // .type("CHOROPLETH|COMPOSECOLOR") prep — unlike DOMINANT's argmax
  // (exactly one field "wins"), COMPOSECOLOR blends EVERY field's own
  // class color into one RGB triple, weighted by that field's value.
  // Real source (maptheme.js:13267-13321, __maptheme_initComposedColor,
  // confirmed by direct source read) precomputes, once, over the
  // resolved class colors themselves (not the data): the mean channel-
  // sum (R+G+B) and the mean per-color peak channel (max(R,G,B)) — used
  // as brightness/normalization constants in _resolveComposedColor.
  // Also precomputes nMax: the GLOBAL max value across every field AND
  // every feature combined (not per-field, unlike DOMINANT's own
  // per-field means) — confirmed real source computes one shared max,
  // not one per field.
  function computeComposeColorStats(features, binding, style) {
    const out = {};
    Object.assign(out, computeMultiFieldClasses(binding, style));
    const fields = out._multiFields;
    let nMax = 0;
    features.forEach(f => fields.forEach(field => {
      const v = parseFloat(f.properties[field]);
      if (v > nMax) nMax = v;
    }));
    out._composeColorMax = nMax;
    const rgbs = out.categoryColorsRgb;
    out._composeColorSumIntensity = rgbs.reduce((s, c) => s + c[0] + c[1] + c[2], 0) / rgbs.length;
    out._composeColorMeanMaxIntensity = rgbs.reduce((s, c) => s + Math.max(c[0], c[1], c[2]), 0) / rgbs.length;
    return out;
  }

  // Blends every piped field's class color into one RGB triple for a
  // single polygon — real source (maptheme.js:13442-13452 in paintMap's
  // render loop, __maptheme_getComposedColor_additive/_subtractive,
  // confirmed by direct source read). No nFilterA/min filter here
  // (unlike DOMINANT) — every field's raw value (or 0) contributes.
  //
  // ADDITIVE (COMPOSECOLOR alone, the real engine's own default when
  // SUBTRACTIVE isn't also set): per channel, sum each field's own
  // channel value weighted by (fieldValue/nMax), then normalize by the
  // sum's own peak channel and scale to a brightness constant.
  //
  // SUBTRACTIVE (COMPOSECOLOR|SUBTRACTIVE): the same weighted sum but
  // over each color's COMPLEMENT (255-channel), then subtracted from a
  // brightness ceiling — approximates paint-style mixing (more
  // contributing colors -> darker result) without true CMY conversion,
  // matching the real source's own per-channel-RGB approach exactly
  // rather than a "more correct" but fabricated color-space conversion.
  //
  // Real source has no guard for nMax===0 (all-zero dataset) or for the
  // weighted sum's own peak channel being 0 — both divide-by-zero to
  // NaN there. This port guards both (`|| 1`) rather than faithfully
  // reproducing a NaN fill color, since deck.gl has no equivalent of the
  // real engine's own silent-failure-to-white-shape fallback to lean on.
  function resolveComposedColor(ctx, props) {
    const fields = ctx._multiFields;
    const rgbs = ctx.categoryColorsRgb;
    const nMax = ctx._composeColorMax || 1;
    const subtractive = ctx.flags.has('SUBTRACTIVE');
    let rr = 0, gg = 0, bb = 0;
    for (let i = 0; i < fields.length; i++) {
      const v = parseFloat(props[fields[i]]) || 0;
      const weight = v / nMax;
      const [r, g, b] = rgbs[i];
      if (subtractive) { rr += (255 - r) * weight; gg += (255 - g) * weight; bb += (255 - b) * weight; }
      else { rr += r * weight; gg += g * weight; bb += b * weight; }
    }
    const peak = Math.max(rr, gg, bb) || 1;
    const styleBrightness = styleNum(ctx.style.brightness);
    if (subtractive) {
      const brightness = !isNaN(styleBrightness) ? Math.floor(styleBrightness * 255)
        : (Math.min(Math.floor(ctx._composeColorSumIntensity), 300) || 255);
      return [rr, gg, bb].map(c => Math.max(0, Math.min(255,
        brightness - Math.floor(c / peak * ctx._composeColorMeanMaxIntensity))));
    }
    const scale = !isNaN(styleBrightness) ? Math.floor(styleBrightness * 255) : ctx._composeColorMeanMaxIntensity;
    return [rr, gg, bb].map(c => Math.max(0, Math.min(255, Math.floor(c / peak * scale))));
  }

  // .style({classes: N}) numeric range/class buckets — real engine's
  // "distributeValues" (maptheme.js ~12817-13166). Four classification
  // methods implemented: equal-interval/"EQUIDISTANT" (the DEFAULT when
  // no method flag is present, ~line 12983), QUANTILE (~line 13024),
  // NATURAL/Jenks (~line 13017) and HEADTAIL (13031-13038). Other real
  // methods (LOG, POW2, POW3) aren't implemented yet (documented gap, not
  // silently guessed). Class count
  // defaults to 5 (colorScheme.length in the real engine's own hardcoded
  // default palette), overridable via style.classes; colors resolve
  // through the SAME resolveColorScheme used for CATEGORICAL (literal
  // array / "none" / stringified fn / the diverging N-step sweep — see
  // resolveClassColors), sliced positionally per class.
  //
  // One deliberate correction vs. the literal source, shared by both
  // methods: the real engine's bucket test is `value >= min && value <
  // max` for EVERY class including the last, which (for breaks ending
  // exactly at the data's own max) excludes the single highest-valued
  // record from every bucket. The real source actually patches this the
  // same way for every method (`partsA[last].max += 0.001`, line 13166)
  // — this engine achieves the same effect via an inclusive last-bucket
  // comparison in _resolvePartsClass instead of a literal epsilon bump.
  // Real ixmaps-flat's class count: the number of classes IS the number of
  // colors in the theme's color scheme (maptheme.js: `var nParts =
  // this.colorScheme.length;` — and style.classes works by rewriting the
  // scheme into an N-color ramp, parseStyle). An explicit color list → its
  // length (a single color → 1 class); a generator spec ["N", ...] → N. A
  // scheme given as a function can't be counted up front → null (caller
  // falls back to DEFAULT_RANGE_CLASSES).
  function colorSchemeClassCount(colorscheme) {
    if (!Array.isArray(colorscheme) || !colorscheme.length) return null;
    if (/^\d+$/.test(String(colorscheme[0]))) return Number(colorscheme[0]) || null;
    if (colorscheme.length === 1 && colorscheme[0] === 'none') return null;
    return colorscheme.length;
  }

  // Real ixmaps-flat's range classes (maptheme.js distributeValues,
  // 12850-12887, 13006-13062, 13193-13196), around the break algorithms
  // above:
  //  - the range is clipped to a precision nPreClip (1, ×10 while the
  //    range exceeds nPreClip·1000): above 1 the min/max round outward to
  //    it, otherwise the max is nudged by max/100000;
  //  - equal-interval steps are floored to nPreClip (0-81 in 5 classes →
  //    steps of 16, not 16.2);
  //  - QUANTILE/NATURAL classes take their bounds from the data, the last
  //    class max is the adjusted max;
  //  - all values equal → one class;
  //  - finally the last class max grows by 0.001 ("we test for < max").
  //  - with rangecentervalue c the range is made symmetric around it
  //    first: c ± max(|c − min|, |max − c|) (maptheme.js 12857-12861), so
  //    an even class count splits at c.
  // Not ported, as gl supports neither: INTEGER, and the 0.01 precision of
  // a 100-field theme.
  // flat's reading of a value field (maptheme.js 9776-9800, defaults
  // 7740-7801): a value that is no number counts as 0 — unless
  // UNDEFINEDISNOTVALUE —, and 0 is a value — unless ZEROISNOTVALUE
  function flatNumber(v, flags) {
    let n = parseFloat(v);
    if (isNaN(n)) n = flags && flags.has('UNDEFINEDISNOTVALUE') ? NaN : 0;
    if (n === 0 && flags && flags.has('ZEROISNOTVALUE')) return NaN;
    return n;
  }
  function headTailBreaks(values) {
    const mean = arr => arr.reduce((a, v) => a + v, 0) / arr.length;
    let arr = values.slice(), m = mean(arr);
    const bins = [arr.reduce((a, v) => (v < a ? v : a), Infinity), m];
    while (arr.length > 1) {
      arr = arr.filter(d => d > m);
      m = mean(arr);
      bins.push(m);
    }
    return bins;
  }
  function flatRangeParts(values, nMin, nMax, nParts, flags, centerValue) {
    const rawMin = nMin, rawMax = nMax;
    if (centerValue != null && !isNaN(centerValue)) {
      const half = Math.max(Math.abs(centerValue - nMin), Math.abs(nMax - centerValue));
      nMin = centerValue - half;
      nMax = centerValue + half;
    }
    let nRange = nMax - nMin;
    let nPreClip = 1;
    while (nRange > nPreClip * 1000) nPreClip *= 10;
    if (nPreClip > 1) {
      nMin = Math.floor(nMin / nPreClip) * nPreClip;
      nMax = Math.ceil(nMax / nPreClip) * nPreClip;
    } else {
      nMax += nMax / 100000;
    }
    nRange = nMax - nMin;
    if (nRange === 0 || values.every(v => v === values[0])) nParts = 1;
    let parts;
    // HEADTAIL (maptheme.js 13031-13038, getHeadTail): the bounds are the
    // head/tail breaks of the values — min, mean, then the mean of the
    // values above the last mean, while more than one is left
    if (flags.has('HEADTAIL')) {
      const b = headTailBreaks(values);
      parts = new Array(nParts).fill(null).map((_, i) => ({ min: b[i], max: b[i + 1] - 0.000001 }));
    } else if (flags.has('QUANTILE')) parts = quantileBreaks(values, nParts);
    else if (flags.has('NATURAL')) parts = naturalBreaks(values, nParts);
    else {
      let nStep = nRange / nParts;
      if (nStep > nPreClip) nStep = Math.floor(nStep / nPreClip) * nPreClip;
      parts = new Array(nParts).fill(null).map((_, i) => ({ min: nMin + i * nStep, max: nMin + (i + 1) * nStep }));
    }
    parts[parts.length - 1].max = nMax;
    // LOG (maptheme.js 13064-13078): classes evenly spaced on a log scale
    // of the RAW range (a zero min taken as min(0.1, max/10)), replacing
    // whatever the method above made; the last max is the raw max
    if (flags.has('LOG')) {
      const lMin = Math.log(rawMin ? rawMin : Math.min(0.1, rawMax / 10));
      const lStep = (Math.log(rawMax ? rawMax : 0.1) - lMin) / nParts;
      parts = new Array(nParts).fill(null).map((_, i) => ({ min: Math.exp(lMin + i * lStep), max: Math.exp(lMin + (i + 1) * lStep) }));
      parts[parts.length - 1].max = rawMax;
    }
    parts[parts.length - 1].max += 0.001;
    return parts;
  }

  // NOOUTLIER as real ixmaps-flat computes it over the aggregated items
  // (maptheme.js distributeValues 12380-12440): an item is an outlier when
  // |value − mean| > deviation · outlierscale (default 3), where the MEAN
  // is over every item, zeros included (getMeanMedianQuantile: sum/count,
  // 8045ff), but the DEVIATION only over the non-zero values, around their
  // own mean (`if (nValuesA[i]) nPopA.push(...)`, getDeviationOfArray —
  // population stddev). Min/max are recomputed after the removal (12441).
  function flatOutlierStats(values, scale) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const pool = values.filter(v => v);
    const poolMean = pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : 0;
    const deviation = pool.length ? Math.sqrt(pool.reduce((a, v) => a + (v - poolMean) * (v - poolMean), 0) / pool.length) : 0;
    return { mean, threshold: deviation * scale };
  }

  // Which records flat takes as values at load (maptheme.js
  // loadValuesOfTheme 9795-9856, loadAndAggregateValuesOfTheme 10510-10571):
  //   - NEGATIVEISNOTVALUE: a negative value (or field100) field is no
  //     value — the item keeps it missing; with AGGREGATE the record is
  //     dropped (flat's default, NEGATIVEISVALUE, keeps negatives)
  //   - a bound size field without AGGREGATE: a record whose size is 0,
  //     negative or not a number is dropped, whatever the flags
  // Shapes (CHOROPLETH/FEATURE polygons) are never dropped — their value
  // fields are cleared instead, the shape stays (unpainted).
  function filterFlatValues(features, binding, flags) {
    if (!Array.isArray(features) || !binding) return features;
    const aggregate = flags.has('AGGREGATE');
    const negativeIsNot = flags.has('NEGATIVEISNOTVALUE');
    const size = binding.size && binding.size !== '$item$' && !aggregate ? binding.size : null;
    if (!negativeIsNot && !size) return features;
    const keepShapes = flags.has('CHOROPLETH') || flags.has('FEATURE') || flags.has('FEATURES');
    const valueFields = binding.value ? String(binding.value).split('|').map(k => (k[0] === '!' ? k.slice(1) : k)) : [];
    const checked = valueFields.concat(binding.field100 ? String(binding.field100).split('|') : []);
    const out = [];
    for (const f of features) {
      const p = f && f.properties;
      if (!p) { out.push(f); continue; }
      let clear = [];
      if (size) {
        const v = parseFloat(p[size]);
        if (!(isFinite(v) && v > 0)) {
          if (!keepShapes) continue;
          clear.push(size);
        }
      }
      if (negativeIsNot) {
        const negative = checked.filter(k => parseFloat(p[k]) < 0);
        if (negative.length && aggregate && !keepShapes) continue;
        clear = clear.concat(negative);
      }
      if (!clear.length) { out.push(f); continue; }
      const props = Object.assign({}, p);
      clear.forEach(k => { delete props[k]; });
      out.push(Object.assign({}, f, { properties: props }));
    }
    return out;
  }

  // .binding({value100}) / field100 and the per-item value arithmetic —
  // real ixmaps-flat's loadValuesOfTheme (maptheme.js 9013-9023, 9044-9112),
  // applied at load; everything after (classes, colors, DOMINANT/
  // COMPOSECOLOR, DOPACITY, labels) uses the result. With a field100 value
  // v100 (several field100 fields "a|b" pair with the value fields, the last
  // one repeated; AUTO100 without AGGREGATE: v100 = the item's value sum),
  // in flat's order:
  //   0 stays 0 (unless ZEROISVALUE); a field named "!name" → v100 − v;
  //   CALCVAL/CALC100 → round(v × v100 / 100); PRODUCT → v × v100 (both: v
  //   when v100 is 0); DIFFERENCE with ONE value field (not RELATIVE) →
  //   v − v100; otherwise v / v100 (v100 missing or 0 → 1) × fractionscale
  //   (FRACTION), × 1000 (PERMILLE) or × 100, then RELATIVE − 100 / INVERT
  //   100 − v for positive values.
  // Then DIFFERENCE with several value fields: each value becomes the next
  // minus it (RELATIVE: in % of it; 0 → 100 or 0), and the last one is
  // dropped — field100Binding() takes it out of binding.value.
  // On copies of the features' properties — the page's data is not changed.
  // AGGREGATE themes: not here — flat computes field100 on the aggregated
  // sums (aggregateField100).
  function applyField100(features, binding, flags, style) {
    if (!binding || !binding.value || !Array.isArray(features)) return features;
    // AGGREGATE: flat applies field100 to the aggregated sums
    // (loadAndAggregateValuesOfTheme) — see aggregateField100
    if (flags.has('AGGREGATE')) return features;
    const f100 = binding.field100;
    const fields = String(binding.value).split('|');
    const auto100 = flags.has('AUTO100') && !flags.has('AGGREGATE');
    const seriesDifference = flags.has('DIFFERENCE') && fields.length > 1;
    if (!f100 && !auto100 && !seriesDifference) return features;
    const f100A = f100 ? String(f100).split('|') : null;
    const fractionScale = styleNum(style && style.fractionscale) || 1;
    const names = fields.map(field => (field[0] === '!' ? field.slice(1) : field));
    const singleDifference = flags.has('DIFFERENCE') && fields.length === 1 && !flags.has('RELATIVE');
    return features.map(f => {
      if (!f || !f.properties) return f;
      const props = Object.assign({}, f.properties);
      let values = names.map(name => parseFloat(f.properties[name]));
      if (f100A || auto100) {
        const sum = auto100 ? values.reduce((a, v) => a + (isNaN(v) ? 0 : v), 0) : 0;
        values = values.map((v, i) => {
          if (isNaN(v)) return v;
          const v100 = auto100 ? sum : parseFloat(f.properties[f100A[Math.min(i, f100A.length - 1)]]);
          if (v === 0 && !flags.has('ZEROISVALUE')) return 0;
          if (fields[i][0] === '!') return (isNaN(v100) ? 0 : v100) - v;
          if (flags.has('CALCVAL') || flags.has('CALC100')) return v100 ? Math.round(v * v100 / 100) : v;
          if (flags.has('PRODUCT')) return v100 ? v * v100 : v;
          if (singleDifference) return v - (isNaN(v100) ? 0 : v100);
          let out = v / (v100 || 1);
          if (flags.has('FRACTION')) out *= fractionScale;
          else if (flags.has('PERMILLE')) out *= 1000;
          else {
            out *= 100;
            if (out > 0 && flags.has('RELATIVE')) out -= 100;
            else if (out > 0 && flags.has('INVERT')) out = 100 - out;
          }
          return out;
        });
      }
      if (seriesDifference) {
        values = values.map((v, i) => {
          if (i === values.length - 1) return v;
          const next = values[i + 1] - v;
          if (!flags.has('RELATIVE')) return next;
          return v ? 100 / v * next : (next ? 100 : 0);
        });
      }
      fields.forEach((field, i) => {
        if (seriesDifference && i === fields.length - 1) return;
        if (!isNaN(values[i])) props[field] = values[i];
      });
      return Object.assign({}, f, { properties: props });
    });
  }
  // the binding the runtime reads after applyField100: DIFFERENCE over
  // several value fields leaves one value less (flat pops the last)
  function field100Binding(binding, flags) {
    if (!binding || !binding.value || !flags.has('DIFFERENCE') || flags.has('AGGREGATE')) return binding;
    const fields = String(binding.value).split('|');
    if (fields.length < 2) return binding;
    return Object.assign({}, binding, { value: fields.slice(0, -1).join('|') });
  }

  function computeRangeClasses(features, binding, style, flags, formatValue) {
    const out = {};
    // DIFFERENCE over several value fields: the difference is the value
    const fields = String(binding.value).split('|');
    const valueOf = flags && flags.has('DIFFERENCE') && fields.length > 1
      ? p => cellAggregatedValues({ sums: fields.map(k => parseFloat(p[k]) || 0), counts: fields.map(() => 1) }, flags, style)[0]
      // "$item$" is flat's record count: 1 per record
      : binding.value === '$item$' ? () => 1
      : p => (p && Object.keys(p).length ? flatNumber(p[binding.value], flags) : NaN);
    const values = features
      .map(f => valueOf(f.properties))
      .filter(v => !isNaN(v));
    if (!values.length) return null;

    // Plain loop, not Math.min(...values)/Math.max(...values) — spreading
    // a huge array as individual function arguments overflows the call
    // stack well before a real dataset's size (confirmed live: a
    // >1M-row CSV-sourced dataset threw "Maximum call stack size
    // exceeded" here; every prior dataset ported this session topped
    // out at 69,597 rows, comfortably under engines' argument-count
    // limits, which is why this never surfaced before).
    let nMin = Infinity, nMax = -Infinity;
    for (const v of values) { if (v < nMin) nMin = v; if (v > nMax) nMax = v; }
    // Dataset min/max/median — real engine's own theme-level stats
    // (this.nMin/this.nMax/this.nMedianA[0], distributeValues), stored
    // here (not local to partsA) since .style({dopacity...}) reads them
    // independently of which classification method produced partsA —
    // see _resolveDopacityAlpha.
    out._valueMin = nMin;
    out._valueMax = nMax;
    const sorted = values.slice().sort((a, b) => a - b);
    out._valueMedian = sorted[Math.floor((sorted.length - 1) / 2)];
    const nParts = Math.trunc(styleNum(style.classes)) || colorSchemeClassCount(style.colorscheme) || DEFAULT_RANGE_CLASSES;
    const placeholders = new Array(nParts).fill('');
    const colorsRgb = resolveClassColors(style.colorscheme, placeholders, style.classes);

    out.partsA = flatRangeParts(values, nMin, nMax, nParts, flags, styleNum(style.rangecentervalue));
    out._nRangeParts = nParts; // the configured count; partsA may have fewer (all values equal)

    out.categoryLabels = out.partsA.map(p => `${formatValue(p.min)} - ${formatValue(p.max)}`);
    // .style({label}) names the classes (flat's szLabelA, legend.js
    // 630-640: the range texts only when no label is given)
    const label = Array.isArray(style.label) ? style.label : null;
    out.categoryDisplayLabels = label && label.length ? out.categoryLabels.map((t, i) => (label[i] != null ? String(label[i]) : t)) : undefined;
    out.categoryColorsRgb = colorsRgb;
    // Marks "numeric range/class coloring" (as opposed to CATEGORICAL
    // exact-match, or DOMINANT/COMPOSECOLOR, neither of which call
    // _buildPartsA at all) — _buildAggregationIndex/_buildChartLayers
    // use this to decide whether an AGGREGATE bubble's color must be
    // resolved from the aggregated CELL TOTAL instead of each record's
    // own raw value (see the reclassify step in _buildChartLayers).
    out._rangeClassed = true;
    return out;
  }

  // .type("CHOROPLETH|DOPACITY") family — per-RECORD fill opacity, two
  // entirely different real formulas depending on whether
  // .binding({alpha}) is set (real source: all three DOPACITY call
  // sites in paintMap are `if (this.szAlphaField) {...} else {...}`,
  // confirmed by direct source read — alphafield doesn't just tweak the
  // value/min/max ramps below, it REPLACES them outright):
  //
  // WITH binding.alpha (maptheme.js:13456-13471 etc., ~line "if
  // (this.szAlphaField)"): nOpacity = dopacityscale / nAlphaMax^(1/pow)
  // * nAlpha^(1/pow) — nAlpha/nAlphaMax from _prepareAlphaField's OWN
  // separate stats pass (never the main value's min/max/median), and
  // — per the literal source quoted — NOT multiplied by the theme's
  // base fillopacity here (unlike every other variant below). DOPACITY*
  // flag choice (MIN/MAX/MINMAX) is irrelevant once alpha is set — only
  // the bare DOPACITY-family gate in buildDeckLayers matters.
  //
  // WITHOUT binding.alpha (the bound value drives opacity directly,
  // maptheme.js paintMap ~13635-13800): returned as a 0-1 fraction
  // already scaled by the theme's own base fillopacity, matching the
  // real engine writing this value directly as the shape's final
  // fill-opacity:
  //   DOPACITYMINMAX (or real source's own auto-trigger: an unflagged
  //   theme whose data straddles zero, _valueMin<0<_valueMax —
  //   "BIPOLAR" data): ramps from the dataset MEDIAN toward nMax above
  //   it and toward nMin below it — two independent half-ramps.
  //   DOPACITYMIN: inverted ramp — HIGHER value -> LOWER opacity.
  //   DOPACITYMAX: direct ramp — higher value -> higher opacity.
  //   Plain DOPACITY: (value-min)/(median-min), capped at a 0.5
  //   ceiling BEFORE the fillopacity/scale multiply — real source's own
  //   formula, not a rounding choice of this port's.
  //
  // dopacitypow (real nDopacityPow, default 1) is the exponent
  // 1/dopacitypow — on the alpha ramp always, on the value ramp only
  // for MIN/MAX/MINMAX (plain DOPACITY has no pow term in the real
  // source either). dopacityscale (real nDopacityScale, default 1) is
  // a flat multiplier on the final result, every variant. Clamped:
  // <0.0001 snaps to 0 (real source's own near-zero cutoff); capped at
  // the theme's own base opacity (real source caps at a separate
  // `this.nOpacity||0.9` style property this port doesn't model
  // separately — using the already-resolved base fillopacity as the
  // cap instead, a minor documented deviation).
  function resolveDopacityAlpha(ctx, f, value, baseOpacity) {
    const scale = styleNum(ctx.style.dopacityscale) || 1;
    const pow = 1 / (styleNum(ctx.style.dopacitypow) || 1);
    if (ctx.binding.alpha) {
      if (!ctx._alphaByFeature) return null;
      const nAlpha = ctx._alphaByFeature.get(f);
      if (nAlpha == null) return null;
      let nOpacity = scale / Math.pow(ctx._alphaMax || 1, pow) * Math.pow(nAlpha, pow);
      if (nOpacity < 0.0001) nOpacity = 0;
      return Math.max(0, Math.min(baseOpacity || 0.9, nOpacity));
    }
    if (isNaN(value) || ctx._valueMin == null) return null;
    const nMin = ctx._valueMin, nMax = ctx._valueMax, nMedian = ctx._valueMedian;
    const bipolar = ctx.flags.has('DOPACITYMINMAX') || ctx.flags.has('BIPOLAR') || (nMin < 0 && nMax > 0);
    let nOpacity;
    if (bipolar) {
      nOpacity = value >= nMedian
        ? Math.pow(Math.abs(value - nMedian), pow) / Math.pow((nMax - nMedian) || 1, pow)
        : Math.pow(Math.abs(value - nMedian), pow) / Math.pow((nMedian - nMin) || 1, pow);
    } else if (ctx.flags.has('DOPACITYMIN')) {
      nOpacity = Math.pow(nMax - value, pow) / Math.pow((nMax - nMin) || 1, pow);
    } else if (ctx.flags.has('DOPACITYMAX')) {
      nOpacity = Math.pow(value - nMin, pow) / Math.pow((nMax - nMin) || 1, pow);
    } else {
      nOpacity = (value - nMin) / ((nMedian - nMin) || 1) * 0.5;
    }
    nOpacity *= baseOpacity * scale;
    if (nOpacity < 0.0001) nOpacity = 0;
    return Math.max(0, Math.min(baseOpacity || 0.9, nOpacity));
  }

  // ---------------------------------------------------------------
  // Aggregation — pure value math (what a record contributes, how a
  // cell's values combine, co-located grouping). The stateful parts —
  // the per-category grid indices, per-zoom caches — stay in LayerRuntime.
  // ---------------------------------------------------------------
  // group raw features by category — cheap, cell-width-independent. The
  // per-category GridAggregateIndex is built lazily per resolved grid
  // width (see _ensureClusterIndices), which can change with zoom per
  // style.aggregation.
  // Re-run whenever the active feature set changes (facet filter, or
  // .binding.size rebound via setSizeField) so clustering always reflects
  // what's actually visible/bound right now.
  // What a record adds to its AGGREGATE cell's size, as in real
  // ixmaps-flat:
  //  - a size field bound: its value (summed per cell / per category);
  //  - CATEGORICAL without a size field: 1 — the record count per category;
  //  - value-based (numeric value field) without a size field: the value
  //    itself — the cell's aggregated value (flat's default aggregation is
  //    "sum", SUM or not) is what sizes the symbol, after NORMALIZE when
  //    set (e.g. roma: summed Pericolosita, normalized to 0..1).
  // (flat's per-item nSize holds a record count in that last case, but it
  // is not what draws a value-based symbol.)
  // "$item$" (as size or value) is flat's record count: 1 per record — it
  // is no column (read as one, every record was 0 and a LABEL|TEXTONLY
  // theme's text 0.08 px high).
  function resolveAggregateValue(binding, flags, props) {
    if (binding.size === '$item$') return 1;
    if (binding.size) return parseFloat(props[binding.size]) || 0;
    if (flags.has('CATEGORICAL') || binding.value == null || binding.value === '$item$') return 1;
    return parseFloat(props[binding.value]) || 0;
  }

  // Whether a range-classed AGGREGATE cell's class value (flat: the sum
  // of the value field, nValuesA) differs from its size sum: only when a
  // size field other than the value field is bound.
  function classValueSeparate(binding, flags) {
    return binding.value != null && !!binding.size && binding.size !== binding.value;
  }

  // real engine's SUM (default) vs MEAN aggregation per cell per
  // category — resolved at consumption time from the raw sums/counts
  // _ensureGridIndex stores, not baked in, so the same grid index could
  // serve either without rebinning.
  // then DIFFERENCE over the cell's series — flat's post-aggregation step
  // (maptheme.js 11086-11101): each value becomes the next minus it
  // (RELATIVE: in % of it when it is above field100min, else 0), the last
  // one is dropped
  function cellAggregatedValues(cell, flags, style) {
    const useMean = flags.has('MEAN');
    const values = cell.sums.map((s, i) => (useMean && cell.counts[i] > 0 ? s / cell.counts[i] : s));
    if (!flags.has('DIFFERENCE') || values.length < 2) return values;
    const min = parseFloat(style && style.field100min) || 0;
    const out = [];
    for (let i = 0; i < values.length - 1; i++) {
      const d = values[i + 1] - values[i];
      out.push(flags.has('RELATIVE') ? (values[i] > min ? 100 / values[i] * d : 0) : d);
    }
    return out;
  }

  function oneHot(cat, value, nCategories) {
    const arr = new Array(nCategories).fill(0);
    arr[cat] = value;
    return arr;
  }

  // Real ixmaps-flat's AGGREGATE (maptheme.js:10587-10760, 11139): every
  // record's position snaps to the aggregation grid — hexagonal by
  // default, square with RECT (snapToAggregationGrid, a line-for-line
  // port) — and all records of one cell become ONE item, keyed by the
  // snapped position, values summed. The item sits at the cell center, or
  // with RELOCATE at the mean of its records' original positions. Without
  // a grid width (no aggregation/gridwidth/gridwidthpx) flat does not
  // snap at all: the key is the exact position, so only records at
  // identical coordinates merge. cellPx and positions are world pixels at
  // `zoom`, i.e. screen pixels there.
  //
  // Returns Supercluster's getClusters() shape, which the rest of the
  // pipeline reads: a cell of 2+ records → { cluster: true, point_count,
  // value }, a single-record cell → that record's own feature, moved to
  // the item position.
  // field100 on an AGGREGATE cell — flat's post-aggregation step
  // (loadAndAggregateValuesOfTheme, maptheme.js 11000-11052), on the cell's
  // summed value v and summed field100 v100: DIFFERENCE (not RELATIVE) →
  // v − v100; FRACTION → v / v100 × fractionscale (v100 ≤ 0 → 0); PRODUCT
  // → v × v100; CALCVAL → round(v × v100 / 100); PERMILLE → v × 1000 / v100;
  // otherwise v100 > field100min (default 0) ? v × 100 / v100, then
  // RELATIVE − 100 / INVERT 100 − v for positive values : 0. A percent of
  // the sums, not a sum of per-record percents. (flat's PERMILLE divides by
  // a 0 sum → Infinity; 0 here.)
  function aggregateField100(v, v100, flags, style) {
    if (flags.has('DIFFERENCE') && !flags.has('RELATIVE')) return v - v100;
    if (flags.has('FRACTION')) return v100 > 0 ? v / v100 * (styleNum(style && style.fractionscale) || 1) : 0;
    if (flags.has('PRODUCT')) return v * v100;
    if (flags.has('CALCVAL')) return Math.round(v * v100 / 100);
    if (flags.has('PERMILLE')) return v100 ? v * 1000 / v100 : 0;
    const min = parseFloat(style && style.field100min) || 0;
    if (!(v100 > min)) return 0;
    let out = v * 100 / v100;
    if (out > 0 && flags.has('RELATIVE')) out -= 100;
    else if (out > 0 && flags.has('INVERT')) out = 100 - out;
    return out;
  }

  // post(value, value100) — optional: converts a cell's value-field sum
  // (classValue when the cell carries one, else value) once aggregated,
  // for single-record cells too (flat converts every item)
  // field: an aggregation field (aggregation / aggregationscale) — the
  // records are grouped by its value, at their mean position (flat
  // relocates a field aggregation, maptheme.js 11141) — instead of a grid
  function aggregateOnGrid(features, zoom, cellPx, flags, post, field) {
    const relocate = flags.has('RELOCATE') || !!field;
    const cells = new Map();
    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      const p = lngLatToWorldPixel(lng, lat, zoom);
      let key, snapped;
      if (field) {
        const raw = f.properties.raw || f.properties;
        key = 'f:' + String(raw[field]);
        snapped = p;
      } else {
        snapped = cellPx ? snapToAggregationGrid(p.x, p.y, cellPx, flags, zoom) : p;
        key = `${snapped.x}:${snapped.y}`;
      }
      let cell = cells.get(key);
      if (!cell) { cell = { key, snapped, sumX: 0, sumY: 0, n: 0, value: 0, classValue: 0, value100: 0, series: null, first: f }; cells.set(key, cell); }
      cell.sumX += p.x; cell.sumY += p.y; cell.n++;
      cell.value += f.properties.value;
      if (f.properties.classValue !== undefined) cell.classValue += f.properties.classValue;
      if (post) cell.value100 += f.properties.value100 || 0;
      const series = f.properties.series;
      if (series) {
        if (!cell.series) cell.series = new Array(series.length).fill(0);
        for (let i = 0; i < series.length; i++) cell.series[i] += series[i];
      }
    }
    const out = [];
    for (const cell of cells.values()) {
      const x = relocate ? cell.sumX / cell.n : cell.snapped.x;
      const y = relocate ? cell.sumY / cell.n : cell.snapped.y;
      const ll = worldPixelToLngLat(x, y, zoom);
      const geometry = { type: 'Point', coordinates: [ll.lng, ll.lat] };
      const hasClass = cell.first.properties.classValue !== undefined;
      let props = cell.n > 1
        // titleRaw: the cell's first record — flat titles an aggregated
        // item by it (itemTitle)
        ? { cluster: true, point_count: cell.n, value: cell.value, ...(hasClass ? { classValue: cell.classValue } : {}),
            titleRaw: cell.first.properties.raw || cell.first.properties }
        : cell.first.properties;
      if (cell.series && cell.n > 1) props = Object.assign({}, props, { series: cell.series });
      // a field aggregation's cell key (the field value): the categories of
      // one cell are merged by it (groupCoLocated), not by their positions
      if (field) props = Object.assign({}, props, { aggKey: cell.key });
      if (post) {
        props = Object.assign({}, props);
        if (hasClass) props.classValue = post(cell.n > 1 ? cell.classValue : props.classValue, cell.value100, props.series);
        else props.value = post(cell.n > 1 ? cell.value : props.value, cell.value100, props.series);
      }
      out.push({ type: 'Feature', geometry, properties: props });
    }
    return out;
  }

  // Drop-in for the Supercluster index this engine used before (whose
  // radius-based, whole-zoom-level, cross-level-merging clusters were
  // up to ~2x flat's grid cells — found with --flat-oracle): the same
  // load()/getClusters(bbox, zoom) surface, aggregating the whole dataset
  // once per zoom (cached) and filtering by bbox.
  class GridAggregateIndex {
    constructor(cellPx, flags, post, field) { this.cellPx = cellPx; this.flags = flags; this.post = post; this.field = field || null; this.features = []; this._byZoom = new Map(); }
    load(features) { this.features = features; this._byZoom.clear(); return this; }
    getClusters(bbox, zoom) {
      let items = this._byZoom.get(zoom);
      if (!items) {
        if (this._byZoom.size >= 8) this._byZoom.delete(this._byZoom.keys().next().value);
        items = aggregateOnGrid(this.features, zoom, this.cellPx, this.flags, this.post, this.field);
        this._byZoom.set(zoom, items);
      }
      return items.filter(f => {
        const [lng, lat] = f.geometry.coordinates;
        return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
      });
    }
  }

  function groupCoLocated(clusterFeatures, zoom, clusterRadiusPx, nCategories, flags, atCellCenter = false) {
    // Merge tolerance MUST track the same theme-driven, scale-dependent
    // aggregation width the clustering itself just used (clusterRadiusPx,
    // set by _ensureClusterIndices right before this runs) — not an
    // independent constant. Grouping and clustering are two views of the
    // same "how close counts as the same spot" question at the current
    // map scale, so they need the same answer.
    const cellPx = clusterRadiusPx; // null: no grid, exact positions (aggregateOnGrid)
    const cells = new Map();
    const n = nCategories;
    clusterFeatures.forEach(f => {
      const [lng, lat] = f.geometry.coordinates;
      const p = lngLatToWorldPixel(lng, lat, zoom);
      // Same shared snapToAggregationGrid as GRIDSIZE (hex by default,
      // RECT if set) decides ONLY which same-spot clusters get grouped
      // together — the group's final position below still comes from
      // the mean of the members' own ORIGINAL (unsnapped) positions,
      // not the grid snap point; RELOCATE's positioning is orthogonal
      // to grid shape (confirmed against the real source: RELOCATE
      // recomputes ptPos as the mean of ptPosA regardless of which
      // grid produced the grouping key).
      const snapped = cellPx ? snapToAggregationGrid(p.x, p.y, cellPx, flags, zoom) : p;
      // a field aggregation's categories each sit at the mean of their own
      // records — merged by the field value, not by (float) position
      const key = f.properties.aggKey != null ? f.properties.aggKey : `${snapped.x}:${snapped.y}`;
      let cell = cells.get(key);
      if (!cell) { cell = { sumX: 0, sumY: 0, n: 0, cx: snapped.x, cy: snapped.y, counts: new Array(n).fill(0), recordCounts: new Array(n).fill(0), classTotal: undefined }; cells.set(key, cell); }
      cell.sumX += p.x; cell.sumY += p.y; cell.n++;
      if (!cell.titleRaw) cell.titleRaw = f.properties.titleRaw || f.properties.raw || null;
      cell.counts[f.properties.cat] += f.properties.value;
      if (f.properties.classValue !== undefined) cell.classTotal = (cell.classTotal || 0) + f.properties.classValue;
      // point_count is the aggregated-record count of a multi-record
      // cell (aggregateOnGrid; absent on a single-record cell)
      // — tracked separately from counts (the summed bound VALUE) purely
      // for the tooltip's theme.item.count.
      cell.recordCounts[f.properties.cat] += (f.properties.point_count || 1);
    });
    return Array.from(cells.values()).map(cell => {
      // without RELOCATE flat's cell item sits at the cell center
      const ll = atCellCenter && cellPx ? worldPixelToLngLat(cell.cx, cell.cy, zoom) : worldPixelToLngLat(cell.sumX / cell.n, cell.sumY / cell.n, zoom);
      return {
        geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
        properties: { counts: cell.counts, total: cell.counts.reduce((a, c) => a + c, 0), recordCounts: cell.recordCounts, ...(cell.classTotal !== undefined ? { classTotal: cell.classTotal } : {}),
          ...(cell.titleRaw ? { titleRaw: cell.titleRaw } : {}) }
      };
    });
  }

  // A range-classed theme's legend numbers, as real ixmaps-flat computes
  // partsA[i].nCount / nSum (legend.js 644-720): per class the number of
  // items and the sum of their class values — for CHART themes over the
  // VISIBLE items as drawn (aggregated cells included, maptheme.js
  // 16633-16683), for CHOROPLETH over every polygon (distributeValues,
  // 13790ff). Shown like flat: SUM → the sum (with PERCENT the share of
  // all, with MEAN the mean), otherwise the count. (flat's remaining case,
  // no SUM/COUNT on a non-CATEGORICAL theme, divides two undefined values
  // — shown as the count here instead of NaN.)
  function rangeClassLegendTotals(rt, bbox, globeCenter) {
    const n = rt.categoryLabels.length;
    const count = new Array(n).fill(0), sum = new Array(n).fill(0);
    const add = (cat, v) => { if (cat == null || cat < 0 || cat >= n) return; count[cat]++; sum[cat] += Number.isFinite(v) ? v : 0; };
    if (rt.flags.has('CHOROPLETH')) {
      (rt._activeFeatures || rt.features).forEach(f => {
        const v = parseFloat(f.properties[rt.binding.value]);
        add(rt._resolvePartsClass(v), v);
      });
    } else if (rt._legendItems) {
      rt._legendItems.forEach(d => add(d.cat, d.value));
    } else {
      (rt._activeFeatures || rt.features).forEach(f => {
        const c = f.geometry && f.geometry.coordinates;
        if (!c || typeof c[0] !== 'number') return;
        const [lng, lat] = c;
        if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) return;
        if (globeCenter && !isOnVisibleHemisphere(lng, lat, globeCenter)) return;
        const v = parseFloat(f.properties[rt.binding.value]);
        add(rt._resolvePartsClass(v), v);
      });
    }
    if (rt.flags.has('SUM') && !rt.flags.has('COUNT')) {
      if (rt.flags.has('PERCENT')) { const all = sum.reduce((a, b) => a + b, 0); return sum.map(x => (all ? 100 * x / all : 0)); }
      if (rt.flags.has('MEAN')) return sum.map((x, i) => (count[i] ? x / count[i] : 0));
      return sum;
    }
    return count;
  }

  class LayerRuntime {
    // spec: a normalizeTheme() result — never a raw LayerBuilder
    constructor(spec, fc, mapOptions) {
      this.name = spec.name;
      this.binding = spec.binding;
      this.flags = spec.flags;
      this.style = spec.style;
      this.meta = spec.meta;
      // GL-PORT COMPAT: retained only for ixmaps.getThemeObj()'s szFilter
      // (real ixmaps-flat global compat shim, see _globalThemeRegistry) —
      // this engine's own filtering is fully static/load-time (see
      // applyWhereFilter in MapBuilder.build()), so nothing else here ever
      // reads it back off the runtime.
      this._filterExpr = spec.filter || '';
      this.mapOptions = mapOptions || {};
      this._specBinding = spec.binding;
      this.features = applyField100(filterFlatValues(this._withDensity(fc.features), this.binding, this.flags), this.binding, this.flags, this.style);
      this.binding = field100Binding(this.binding, this.flags);
      this._iconCache = new Map();
      this._glowIconCache = new Map();
      this._clusterIndices = null;
      // Categories isolated via ixmaps.markThemeClass/unmarkThemeClass
      // (the native legend's own row clicks — see build()'s legend
      // block). Empty = show every category at full opacity, the default.
      // See _iconAlpha for how this dims (not removes) the rest once
      // non-empty.
      this._markedClasses = new Set();
      // Set once per redraw cycle inside build()'s legend block, to
      // `() => { refresh(); renderRows(); }` — lets the module-level
      // ixmaps.markThemeClass/unmarkThemeClass (which only have a bare
      // name -> runtime lookup, not a closure over this map's own
      // refresh()) still trigger a live redraw + legend repaint.
      this._triggerRedraw = null;
      // _iconGeneration is appended to every icon-atlas-based deck.gl
      // layer id this runtime produces (see e.g. _buildBubbleIcon's
      // caller) — bumping it forces deck.gl to build a genuinely new
      // IconLayer instance with a fresh, empty atlas (see
      // ICON_ATLAS_RESET_AFTER for why this is necessary at all).
      this._iconGeneration = 0;
      this._iconsSinceAtlasReset = 0;
      this._iconAreaSinceAtlasReset = 0;
      this._prepare();
    }

    // Every generated icon (bubble clusters, PLOT charts, grid squares)
    // funnels through here instead of a bare `this._iconCache.set` — see
    // ICON_CACHE_MAX for why: deck.gl's own atlas never evicts, so this
    // cache must. FIFO eviction (oldest inserted first) via Map's
    // insertion-order iteration — not true LRU, but re-requesting an
    // evicted shape just regenerates a cheap canvas, so an occasional
    // extra cache miss costs nothing worth a fancier structure.
    //
    // Separately (see ICON_ATLAS_RESET_AFTER): every genuinely NEW icon
    // (one this cache hasn't seen before, whether the cache is still
    // growing or already evicting to make room) also counts against
    // deck.gl's OWN cumulative, never-evicted atlas. Once enough new
    // icons have been created since the last reset, bump the generation
    // counter — the caller's layer id changes next redraw, and deck.gl
    // throws away the old IconLayer (and its bloated atlas) for a fresh
    // one, the same way React remounts a component when its key changes.
    _cacheIcon(key, icon) {
      if (!this._iconCache.has(key)) {
        this._iconsSinceAtlasReset++;
        this._iconAreaSinceAtlasReset += (icon.width || 0) * (icon.height || 0);
        if (this._iconsSinceAtlasReset > ICON_ATLAS_RESET_AFTER || this._iconAreaSinceAtlasReset > ICON_ATLAS_AREA_RESET_AFTER) {
          this._iconGeneration++;
          this._iconsSinceAtlasReset = 0;
          this._iconAreaSinceAtlasReset = 0;
        }
      }
      if (this._iconCache.size >= ICON_CACHE_MAX) {
        this._iconCache.delete(this._iconCache.keys().next().value);
      }
      this._iconCache.set(key, icon);
      return icon;
    }

    _prepare() {
      // Real default for normalsizevalue when the theme doesn't set one
      // (maptheme.js ~line 5059): the dataset's OWN max value on the bound
      // size field — never a fixed constant. Computed once here so
      // valueRadius() doesn't need a magic-number fallback.
      this._maxSizeValue = defaultNormalSizeValue(this.features, this.binding, this.flags);

      // Reference latitude for a real-world-METERS aggregation cell size —
      // either a bare .style({gridwidth}) OR a bare-meters (non-"px")
      // entry inside .style({aggregation:[...]}) — see
      // _ensureClusterIndices' and _computeAggregatedItems' own comments
      // for the bug this fixes (index rebuilding AND cluster composition
      // itself both shifting with the live zoom, for what must be a
      // zoom-invariant real-world grid). Computed ONCE here from the
      // theme's OWN full data extent ("the index is always calculated
      // for the entire geographic data extension", per explicit
      // correction) — the bbox-center of every feature's own
      // coordinates, not the current viewport (which pans) and not tied
      // to zoom at all. Only bothers with the O(n) scan when the theme
      // could ever need it (a plain "px" gridwidth, or an aggregation
      // array with only "px" entries, never reads this field).
      const gridwidthIsMeters = typeof this.style.gridwidth === 'string' ? !/px\s*$/i.test(this.style.gridwidth) : this.style.gridwidth != null;
      if (gridwidthIsMeters || aggregationHasMetersEntry(this.style.aggregation)) {
        let minLat = Infinity, maxLat = -Infinity;
        this.features.forEach(f => {
          const lat = f.geometry && f.geometry.coordinates && f.geometry.coordinates[1];
          if (typeof lat === 'number' && !isNaN(lat)) {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        });
        this._gridRefLat = (minLat <= maxLat) ? (minLat + maxLat) / 2 : 0;
      }

      if (this.flags.has('DOMINANT') && this.binding.value && !isAggregatedCategoricalChoropleth(this)) {
        // .type("CHOROPLETH|DOMINANT") — a MULTI-field bound value
        // (binding.value is a pipe-joined field list, e.g. one CSV column
        // per age band for the same year/sex — same pipe convention
        // csvRowsToFeatureCollection's binding.position already uses).
        // Three relevance formulas, all handled by _resolveDominantClass:
        // PERCENTOFMEAN picks the field deviating most (as a %) from ITS
        // OWN cross-record mean; DEVIATION picks the field with the
        // highest z-score above its own mean; plain DOMINANT (neither
        // flag) picks whichever field simply has the highest raw value —
        // "which band dominates this comune's own local profile", per
        // explicit correction.
        this._prepareDominant();
      } else if (this.flags.has('COMPOSECOLOR') && this.binding.value) {
        // .type("CHOROPLETH|COMPOSECOLOR") — real engine's OTHER
        // multi-field mode (mutually exclusive with DOMINANT, not a
        // modifier of it, confirmed by direct source read): blends every
        // field's class color into one RGB triple weighted by value,
        // rather than picking one winning field. |SUBTRACTIVE switches the
        // blend formula (see _resolveComposedColor); plain COMPOSECOLOR is
        // the real engine's own additive default.
        this._prepareComposeColor();
      } else if (this.flags.has('CATEGORICAL') && this.binding.value) {
        // .style({values: [...]}) (or .xaxis, same list in practice — see
        // the PLOT curves-chart config) is an EXPLICIT, ORDERED category
        // list — when present it's authoritative over auto-discovery from
        // the data, matching the real engine's own explicit-ranges branch
        // of distributeValues. Order matters here (it's the X axis order
        // for PLOT), which raw data-discovery order can't guarantee.
        const explicit = Array.isArray(this.style.values) ? this.style.values
          : Array.isArray(this.style.xaxis) ? this.style.xaxis : null;
        if (explicit) {
          this.categoryLabels = explicit.map(String);
          this.categoryIndexByLabel = new Map(this.categoryLabels.map((v, i) => [v, i]));
        } else {
          const seen = new Map();
          this.features.forEach(f => {
            const v = f.properties[this.binding.value];
            if (v != null && !seen.has(v)) seen.set(v, seen.size);
          });
          this.categoryLabels = Array.from(seen.keys());
          this.categoryIndexByLabel = seen;
        }
        // .style({label: [...]}) — real engine's szLabelA convention: a
        // parallel, human-readable display string per category, common
        // when .style({values:[...]}) is a list of short codes ("0".."9")
        // rather than self-explanatory text (e.g. the German Unfallatlas
        // UART codes vs. their German names). categoryLabels/
        // categoryIndexByLabel above stay keyed by the RAW value — every
        // matching/filtering/lookup path (facet click-to-filter,
        // getCategoryColor, .style.values itself) needs the real
        // underlying value, never the display text. categoryDisplayLabels
        // is the one exception: everywhere this engine actually SHOWS a
        // category to the user (tooltip, per-category color-function
        // input, facet bar text) reads this instead. Falls back to
        // categoryLabels itself (i.e. no behavior change) whenever
        // .style.label is absent or its length doesn't line up.
        const explicitLabel = Array.isArray(this.style.label) ? this.style.label.map(String) : null;
        this.categoryDisplayLabels = (explicitLabel && explicitLabel.length === this.categoryLabels.length)
          ? explicitLabel : this.categoryLabels;

        // szLabelA passed to a custom colorscheme function (see
        // resolveColorScheme) is the real engine's own convention too —
        // a function like __setColors that pattern-matches category NAMES
        // ("investimento"/"tamponamento"/...) needs the display text, not
        // a raw numeric code it could never match against.
        this.categoryColorsRgb = resolveClassColors(this.style.colorscheme, this.categoryDisplayLabels, this.style.classes);
      } else if (this.binding.value) {
        // real engine's OTHER coloring mode (maptheme.js distributeValues,
        // partsA): a NUMERIC bound value, not CATEGORICAL, is classed into
        // equal-interval ranges instead of exact-match categories — this is
        // automatic (no separate opt-in flag) whenever binding.value isn't
        // CATEGORICAL, matching real behavior. Populates the SAME
        // categoryLabels/categoryColorsRgb this runtime's whole clustering/
        // GLOW/VALUES/tooltip pipeline already reads by index — a range
        // class and a category are just two different ways to answer
        // "which bucket does this feature belong to", and once buckets +
        // colors exist, everything downstream is identical.
        this._buildPartsA();
      }

      // facet-driven dynamic filter state (see setFacetFilter/getFacets) —
      // separate from the static, load-time .filter() already baked into
      // this.features by MapBuilder.build()
      this.facetFilters = new Map();
      this._activeFeatures = null; // null = no active facet filter, use this.features directly
      // GL-PORT COMPAT: real ixmaps-flat's ixmaps.changeThemeStyle(szId,
      // "filter:WHERE ...", "set"/"remove") — a SEPARATE runtime-filter
      // mechanism from the facet-browser's own setFacetFilter/clearFacetFilter
      // (field=value/like clauses). This one takes a raw WHERE-expression
      // STRING, the SAME grammar the layer's own load-time .filter(expr)
      // already parses (applyWhereFilter) — just applied at RUNTIME instead
      // of once at build time. AND'd together with any active facet
      // filters in _rebuildActiveFeatures below, not mutually exclusive —
      // a page could in principle use both at once, though no current
      // ported page does.
      this._runtimeFilterExpr = '';
      // flat's setThemeTimeFrame(id, min, max): records whose style.timefield
      // value lies in [min, max) — null = no time filter. AND'd with the
      // filters above in _rebuildActiveFeatures.
      this._timeFrame = null;

      // GRIDSIZE layers (PLOT curves-chart, or its grid-mesh companion)
      // also carry AGGREGATE in their type string, but they bin into a
      // spatial grid (_ensureGridIndex), not the per-category AGGREGATE
      // grid — building _featuresByCategory for them would be wasted
      // work (up to the full dataset, never consumed by buildDeckLayers).
      //
      // GL-PORT COMPAT: see _usesAggregationIndex()'s own comment — also
      // triggered by CHART+SYMBOL alone, without an explicit AGGREGATE
      // flag, so a real-ixmaps-flat page's own "CHART|BUBBLE|SIZE|SHOW"
      // (no AGGREGATE — the real engine's per-record BUBBLE rendering
      // doesn't need it) doesn't silently render nothing once ported
      // unmodified.
      if (this._usesAggregationIndex()) {
        this._buildAggregationIndex(this.features);
      }

      this._prepareAlphaField();
    }

    // pure: prepareAlphaField → see "Classification — pure functions"
    _prepareAlphaField() { const r = computeAlphaStats(this.features, this.binding); if (r) Object.assign(this, r); }

    // pure: prepareMultiFieldChoropleth → see "Classification — pure functions"
    _prepareMultiFieldChoropleth() { const r = computeMultiFieldClasses(this.binding, this.style); Object.assign(this, r); return r._multiFields; }

    // pure: prepareDominant → see "Classification — pure functions"
    _prepareDominant() { Object.assign(this, computeDominantStats(this.features, this.binding, this.style, this.flags)); }

    // pure: resolveDominantClass → see "Classification — pure functions"
    _resolveDominantClass(props) { return resolveDominantClass(this, props); }

    // .style({symbolfield, symbolvalues, symbols}) — a SEPARATE shape-
    // encoding channel, independent of whatever field drives this theme's
    // own COLOR (binding.value/categoryColorsRgb) — e.g. color = a %
    // class, shape = school type, two orthogonal classifications on the
    // same bubble. symbolvalues[i] maps to symbols[i] by position, the
    // SAME parallel-array convention .style({values, colorscheme}) already
    // uses for the primary color channel. This is the real engine's own
    // SYMBOL type (used WITHOUT BUBBLE) — MapBuilder#type's own comment
    // flagged this as "a DIFFERENT, still-unimplemented real type for
    // non-circle marker shapes" before this method existed; see
    // drawSymbolPath for the actual shape rendering. Only wired into the
    // individual (non-AGGREGATE) rendering path — no ported page combines
    // this with AGGREGATE clustering yet, so a clustered GROUP bubble
    // always stays circular (_buildBubbleIcon, untouched).
    _resolveSymbolShape(props) {
      if (!this.style.symbolfield || !Array.isArray(this.style.symbolvalues) || !Array.isArray(this.style.symbols)) return 'circle';
      // CORRECTED: found live via pickObject, not assumed — the properties
      // this actually receives at render time (from _computeAggregatedItems'
      // non-AGGREGATE branch, spreading a _featuresByCategory entry) are
      // {value, raw, cat} — every RECORD field this method needs (e.g.
      // "tipo") lives under .raw, wrapped there by _buildAggregationIndex
      // for EVERY theme using this pipeline, categorical or not (see its
      // own comment) — not flat on `props` itself. Reading `props` directly
      // silently and permanently fell through to the 'circle' default,
      // exactly what this method's own unit-level test (called with an
      // UNWRAPPED raw feature's properties, not what render time actually
      // passes) failed to catch — falling back to `props` itself keeps
      // that direct-unwrapped-properties call shape working too.
      const source = (props && props.raw) ? props.raw : props;
      const raw = String(source[this.style.symbolfield]);
      const idx = this.style.symbolvalues.findIndex(v => String(v) === raw);
      return (idx !== -1 && this.style.symbols[idx]) || 'circle';
    }

    // pure: prepareComposeColor → see "Classification — pure functions"
    _prepareComposeColor() { Object.assign(this, computeComposeColorStats(this.features, this.binding, this.style)); }

    // pure: resolveComposedColor → see "Classification — pure functions"
    _resolveComposedColor(props) { return resolveComposedColor(this, props); }

    // pure: buildPartsA → see "Classification — pure functions"
    _buildPartsA() { const r = computeRangeClasses(this.features, this.binding, this.style, this.flags, v => this._formatTooltipValue(v)); if (r) Object.assign(this, r); }

    // pure versions: see "Classification — pure functions" above the class
    _evenStrideSample(sortedValues, sampleSize) { return evenStrideSample(sortedValues, sampleSize); }
    _jenksBreakValues(valuesA, nParts) { return jenksBreakValues(valuesA, nParts); }
    _partsFromBreakValues(breakValues, nParts, trueMax) { return partsFromBreakValues(breakValues, nParts, trueMax); }
    _resolvePartsClass(value, partsA = this.partsA) { return resolvePartsClass(value, partsA); }

    // Single entry point for "which color-class bucket does this feature's
    // bound value belong to" — CATEGORICAL (exact match), range/class
    // (_buildPartsA, numeric bucket), or neither (a single implicit
    // bucket, today's behavior for any other theme).
    _resolveClassIndex(rawValue) {
      if (this.categoryIndexByLabel) return this.categoryIndexByLabel.get(rawValue);
      if (this.partsA) return this._resolvePartsClass(parseFloat(rawValue));
      return 0;
    }

    // pure: resolveDopacityAlpha → see the pure-function sections above the class
    _resolveDopacityAlpha(f, value, baseOpacity) { return resolveDopacityAlpha(this, f, value, baseOpacity); }

    // pure: resolveAggregateValue → see the pure-function sections above the class
    _resolveAggregateValue(props) { return resolveAggregateValue(this.binding, this.flags, props); }

    _buildAggregationIndex(sourceFeatures) {
      // Range-classed (non-CATEGORICAL numeric) coloring: DON'T pre-split
      // by class here — the real engine aggregates every record together
      // first and classes color from the resulting CELL TOTAL afterward
      // (see the reclassify step in _buildChartLayers), never from each
      // record's own raw value. Splitting by pre-class here would do
      // exactly that wrong thing (and would also keep same-cell,
      // different-class records in separate grid indices, so
      // they'd never even share a cell in the first place). Every
      // feature goes into ONE bucket; _buildChartLayers resolves the real
      // 7-class color once it knows each cell's actual aggregated total.
      if (this._rangeClassed) {
        // flat colors/classes an aggregated cell by the SUM of the value
        // field (nValuesA, maptheme.js:10870ff; classified by nValuesA[0],
        // 16676/17386/18112), whatever sizes it. Where that differs from
        // the quantity _resolveAggregateValue sums for the size — a size
        // field other than the value field, or no size field and no SUM
        // (a record count) — the cell carries its own classValue sum.
        this._classSeparate = classValueSeparate(this.binding, this.flags);
        // field100: applied to the cell sums (aggregateField100) — the
        // value-field sum of a cell is its classValue, or its value when no
        // separate size field is bound
        const f100 = this.binding.field100 ? String(this.binding.field100).split('|')[0] : null;
        this._aggregateField100 = !!f100 && (this._classSeparate || !this.binding.size);
        // DIFFERENCE over several value fields: each record keeps its field
        // values, the difference is taken on the cell sums (see post)
        const seriesFields = String(this.binding.value || '').split('|');
        this._seriesDifference = this.flags.has('DIFFERENCE') && seriesFields.length > 1 && !this._aggregateField100;
        const seriesOf = props => seriesFields.map(k => parseFloat(props[k]) || 0);
        const seriesValue = props => cellAggregatedValues({ sums: seriesOf(props), counts: seriesFields.map(() => 1) }, this.flags, this.style)[0];
        this._featuresByCategory = [sourceFeatures.map(f => ({
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            value: this._seriesDifference ? seriesValue(f.properties) : this._resolveAggregateValue(f.properties),
            ...(this._seriesDifference ? { series: seriesOf(f.properties) } : {}),
            // "$item$": flat's record count, 1 per record
            ...(this._classSeparate ? { classValue: this.binding.value === '$item$' ? 1 : parseFloat(f.properties[this.binding.value]) || 0 } : {}),
            ...(this._aggregateField100 ? { value100: parseFloat(f.properties[f100]) || 0 } : {}),
            raw: f.properties
          }
        }))];
        this._clusterIndices = null;
        this._clusterRadiusPx = null;
        this._aggregateStatsCache = null;
        return;
      }

      const nCategories = this.categoryLabels ? this.categoryLabels.length : 1;
      this._featuresByCategory = new Array(nCategories).fill(null).map(() => []);
      sourceFeatures.forEach(f => {
        const cat = this._resolveClassIndex(f.properties[this.binding.value]);
        if (cat == null) return;
        // no sizefield bound (style.name's sizeField toggled off) -> COUNT
        // aggregation, one unit per record, matching the real engine's
        // fallback when sizefield is empty
        const value = this._resolveAggregateValue(f.properties);
        this._featuresByCategory[cat].push({
          type: 'Feature',
          geometry: f.geometry,
          properties: { value, raw: f.properties }
        });
      });
      this._clusterIndices = null;
      this._clusterRadiusPx = null;
      this._aggregateStatsCache = null;
    }

    // ---------------------------------------------------------------
    // facet-driven dynamic filtering — one active value (or LIKE-pattern)
    // per field, AND'd across fields, applied on top of the layer's own
    // static .filter(). Rebuilding _activeFeatures also rebuilds the
    // aggregation index and invalidates cluster indices, since a filter
    // change is a change to which records exist, not just which are shown.
    // ---------------------------------------------------------------

    setFacetFilter(field, value) {
      this.facetFilters.set(field, value);
      this._rebuildActiveFeatures();
    }

    clearFacetFilter(field) {
      this.facetFilters.delete(field);
      this._rebuildActiveFeatures();
    }

    clearAllFacetFilters() {
      this.facetFilters.clear();
      this._rebuildActiveFeatures();
    }

    // See _runtimeFilterExpr's own comment (constructor) — the
    // changeThemeStyle(id,"filter:WHERE ...","set"/"remove") runtime
    // filter, distinct from the facet-browser's field=value clauses above.
    setRuntimeFilter(expr) {
      this._runtimeFilterExpr = expr || '';
      this._rebuildActiveFeatures();
    }

    // setThemeTimeFrame: min/max in ms or any Date-parsable value; a null /
    // NaN bound is open-ended, both null clears the frame.
    setTimeFrame(min, max) {
      const toMs = v => (v == null || v === '' ? NaN : (typeof v === 'number' ? v : new Date(v).getTime()));
      const lo = toMs(min), hi = toMs(max);
      // flat: with the slider at its start position (frame starts at or
      // before the earliest record) every item is shown, not just the first window
      const field = this.binding && this.binding.time;
      if (field && !isNaN(lo)) {
        if (this._timeMin === undefined) {
          let m = Infinity;
          for (const f of this.features) {
            const v = f.properties && f.properties[field];
            const t = typeof v === 'number' ? v : new Date(v).getTime();
            if (!isNaN(t) && t < m) m = t;
          }
          this._timeMin = m;
        }
        if (lo <= this._timeMin) { this._timeFrame = null; this._rebuildActiveFeatures(); return; }
      }
      this._timeFrame = isNaN(lo) && isNaN(hi) ? null : { min: lo, max: hi };
      this._rebuildActiveFeatures();
    }

    // predicate over a record's properties for the active time frame
    _timePredicate() {
      const tf = this._timeFrame;
      if (!tf) return null;
      const field = this.binding && this.binding.time;
      if (!field) return null;
      return props => {
        const v = props && props[field];
        const t = typeof v === 'number' ? v : new Date(v).getTime();
        if (isNaN(t)) return false;
        return (isNaN(tf.min) || t >= tf.min) && (isNaN(tf.max) || t < tf.max);
      };
    }

    // `_featuresByCategory` (plain per-category bucketing — NOT yet
    // grid-aggregated; that's a separate, later step gated by AGGREGATE
    // alone, see _computeAggregatedItems) is needed whenever this runtime
    // will dispatch to _buildChartLayers, i.e. explicit AGGREGATE or
    // CHART+SYMBOL on its own — _buildChartLayers has no other data
    // source to read from (a real page's un-AGGREGATE-flagged BUBBLE type
    // still needs to render, just without any clustering — see
    // _computeAggregatedItems's own AGGREGATE check for that half).
    // DENSITY (maptheme.js 9092-9095): the value is the value per km² of the
    // item's shape (flatShapeAreaKm2), null without an area. Kept in its own
    // field, the theme reads it as its value; the row keeps the raw value.
    _withDensity(features) {
      if (!this.flags.has('DENSITY') || !this.binding.value || String(this.binding.value).includes('|')) return features;
      const field = this.binding.value;
      this.binding = Object.assign({}, this.binding, { value: DENSITY_VALUE_FIELD, densityOf: field });
      return features.map(f => {
        const a = featureAreaKm2(f);
        // no data row (a polygon no record joins): no value
        const v = f.properties && Object.keys(f.properties).length ? flatNumber(f.properties[field], this.flags) : NaN;
        const out = { type: 'Feature', geometry: f.geometry, properties: Object.assign({}, f.properties, { [DENSITY_VALUE_FIELD]: a && !isNaN(v) ? v / a : null }) };
        if (f._flatAreaKm2 !== undefined) out._flatAreaKm2 = f._flatAreaKm2;
        return out;
      });
    }

    // refreshTheme: new data for this theme, prepared as in the
    // constructor; the facet and runtime filters stay active
    replaceFeatures(fc) {
      // new data → new deck.gl layers (see _dataLayerId)
      this._dataGen = (this._dataGen || 0) + 1;
      this._timeMin = undefined;
      const facetFilters = this.facetFilters, runtimeFilterExpr = this._runtimeFilterExpr, timeFrame = this._timeFrame;
      this.binding = this._specBinding;
      this.features = applyField100(filterFlatValues(this._withDensity(fc.features), this.binding, this.flags), this.binding, this.flags, this.style);
      this.binding = field100Binding(this.binding, this.flags);
      this._iconCache.clear();
      this._glowIconCache.clear();
      this._clusterIndices = null;
      this._prepare();
      this.facetFilters = facetFilters;
      this._runtimeFilterExpr = runtimeFilterExpr;
      this._timeFrame = timeFrame;
      this._rebuildActiveFeatures();
    }

    // A shape layer's deck.gl id carries its data generation: when the
    // theme's features are replaced (a broker's partial fgb load, a FEATURE
    // layer's new sections re-joined into its choropleth) deck.gl builds a
    // fresh layer instead of updating the old one in place — updates in
    // place, arriving over each other during heavy zooming/panning, left
    // triangles across sections (colour gradients spanning the map) until
    // the next redraw.
    _dataLayerId(base) { return this._dataGen ? `${base}-d${this._dataGen}` : base; }

    // deck.gl compares a layer's data by reference: a new object makes it
    // re-process every polygon (on the PNRR page ~300 ms per refresh for
    // 8 000 comuni, at every pan tick). Polygon data that doesn't depend
    // on the view is therefore handed over as the same object until its
    // inputs change.
    _featureCollection() {
      if (!this._featuresFC || this._featuresFC.features !== this.features) {
        this._featuresFC = { type: 'FeatureCollection', features: this.features };
      }
      return this._featuresFC;
    }
    // the same for derived data: build() runs only when an entry of key
    // (compared by identity) differs from the last call's
    _cachedPolygonData(slot, key, build) {
      const last = this[slot];
      if (last && last.key.length === key.length && last.key.every((v, i) => v === key[i])) return last.data;
      const data = build();
      this[slot] = { key, data };
      return data;
    }

    _usesAggregationIndex() {
      return (this.flags.has('AGGREGATE') || isSymbolChart(this.flags)) && !this.flags.has('GRIDSIZE');
    }

    _rebuildActiveFeatures() {
      // An AGGREGATE CATEGORICAL choropleth filters the RECORDS of each
      // polygon (as its .filter() does before the join), then sums them —
      // not the polygons by their first record
      if (isAggregatedCategoricalChoropleth(this)) {
        const expr = this._runtimeFilterExpr;
        const clauses = Array.from(this.facetFilters.entries());
        const timePred = this._timePredicate();
        if (!expr && !clauses.length && !timePred) { this._activeFeatures = null; return; }
        const wherePred = expr ? flatFilterPredicate(String(expr)) : null;
        const pred = wherePred && timePred ? (r => wherePred(r) && timePred(r)) : (wherePred || timePred);
        this._activeFeatures = this.features.map(f => {
          const rows = f.properties && f.properties[AGGREGATED_ROWS];
          if (!rows) return f;
          const kept = rows.filter(r => (!pred || pred(r)) && clauses.every(([field, clause]) => matchesFacetClause(r[field], clause)));
          const properties = kept.length ? Object.assign({}, kept[0]) : {};
          if (kept.length) Object.defineProperty(properties, AGGREGATED_ROWS, { value: kept });
          const out = { type: 'Feature', geometry: f.geometry, properties };
          if (f._flatAreaKm2 !== undefined) out._flatAreaKm2 = f._flatAreaKm2;
          return out;
        });
        return;
      }
      // Base set: this.features narrowed by the runtime WHERE-filter
      // (changeThemeStyle's own mechanism, see _runtimeFilterExpr's own
      // comment) if one is active — reusing applyWhereFilter, the SAME
      // parser the layer's load-time .filter(expr) already uses, just
      // invoked again here instead of once at build time.
      let base = this._runtimeFilterExpr
        ? applyWhereFilter({ type: 'FeatureCollection', features: this.features }, this._runtimeFilterExpr).features
        : this.features;
      const timePred = this._timePredicate();
      if (timePred) base = base.filter(f => timePred(f.properties));
      if (this.facetFilters.size === 0) {
        this._activeFeatures = (this._runtimeFilterExpr || timePred) ? base : null;
      } else {
        const clauses = Array.from(this.facetFilters.entries());
        this._activeFeatures = base.filter(f =>
          clauses.every(([field, clause]) => matchesFacetClause(f.properties[field], clause)));
      }
      if (this._usesAggregationIndex()) this._buildAggregationIndex(this._activeFeatures || this.features);
      // GRIDSIZE (_ensureGridIndex) has its own separate cache, keyed only
      // by zoom/cellPx — a filter change doesn't touch either of those,
      // so without this it would keep showing the pre-filter grid/curves
      // until the next zoom change happened to force a rebuild. Null it
      // out so the next _ensureGridIndex call is forced to rebuild from
      // the new _activeFeatures.
      this._gridIndex = null;
    }

    // .binding.size rebind at runtime (the "visualizza numero di feriti"
    // checkbox on the original page: unchecking it removes style.sizefield,
    // falling the chart back to plain COUNT aggregation) — recomputes the
    // normalsizevalue default (dataset max on the new field) and rebuilds
    // aggregation, same as a facet filter change.
    setSizeField(field) {
      this.binding.size = field || null;
      this._maxSizeValue = defaultNormalSizeValue(this.features, this.binding, this.flags);
      if (this._usesAggregationIndex()) this._buildAggregationIndex(this._activeFeatures || this.features);
    }

    setStyle(patch) {
      const typed = typeStyleNumbers(Object.assign({}, patch));
      Object.assign(this.style, typed);
      // kept over a broker's later theme writes (see fillNamedTheme)
      this._styleSet = Object.assign(this._styleSet || {}, typed);
    }

    // Viewport + active-filter scoped facet stats for szFieldsA, matching
    // the real ixmaps.data.getFacets/showFacets behavior (facet.js /
    // show_facets.js), confirmed by direct source read rather than
    // assumed: count-vs-sum is NOT something a page picks per call — the
    // real engine reads it straight off the THEME's own bubble-size
    // binding (facet.js:565-568: `if (objThemeDefinition.style.sizefield
    // && ixmaps.data.fShowFacetValues) { ...weight by that column... }`,
    // where style.sizefield is set from binding.size at theme-build time,
    // htmlgui.js:1677-1679 — literally the same field already sizing
    // bubbles on the map). Mirrored here: sizeField defaults to
    // `ixmapsData.fShowFacetValues ? this.binding.size : null` — a page
    // toggles the GLOBAL gate (ixmaps.data.fShowFacetValues, exactly the
    // real flag/name) to switch every facet browser on the map between
    // record-count and size-field-sum, without needing to know or repeat
    // which field that is per call. `opts.sizeField`, if explicitly
    // passed, still overrides this default outright — a GL-port-only
    // escape hatch (real pages have no per-call override at all) kept for
    // a page that genuinely wants a DIFFERENT field than the one sizing
    // bubbles, without weakening the new automatic default.
    getFacets(fields, opts) {
      opts = opts || {};
      const sizeField = opts.sizeField !== undefined
        ? opts.sizeField
        : (ixmapsData.fShowFacetValues ? this.binding.size : null);
      const bbox = opts.bbox || this._lastBbox;
      const source = this._activeFeatures || this.features;
      const scoped = bbox ? source.filter(f => pointInBbox(f.geometry, bbox)) : source;

      const weightsByField = new Map(fields.map(f => [f, new Map()]));
      const countsByField = new Map(fields.map(f => [f, new Map()]));

      scoped.forEach(f => {
        const weight = sizeField ? (parseFloat(f.properties[sizeField]) || 0) : 1;
        for (const field of fields) {
          const v = f.properties[field];
          if (v == null || v === '') continue;
          const weights = weightsByField.get(field);
          weights.set(v, (weights.get(v) || 0) + weight);
          const counts = countsByField.get(field);
          counts.set(v, (counts.get(v) || 0) + 1);
        }
      });

      const FREETEXT_MIN_UNIQUE = 50;
      const FREETEXT_UNIQUE_RATIO = 0.5;

      return fields.map(field => {
        const weights = weightsByField.get(field);
        const counts = countsByField.get(field);
        const uniqueValues = Array.from(counts.keys());
        const totalCount = scoped.length;
        const isFreeText = uniqueValues.length >= FREETEXT_MIN_UNIQUE &&
          (uniqueValues.length / Math.max(1, totalCount)) > FREETEXT_UNIQUE_RATIO;
        const activeClause = this.facetFilters.get(field);

        if (isFreeText) {
          return {
            id: field, type: 'freetext',
            example: uniqueValues[0], nCount: totalCount,
            isActive: activeClause != null, activeClause
          };
        }

        const sorted = uniqueValues.slice().sort((a, b) => (weights.get(b) || 0) - (weights.get(a) || 0));
        // .style({label:[...]}) display text for THIS theme's own bound
        // field (binding.value) — see categoryDisplayLabels in _prepare.
        // Every other facet field (e.g. a year or a boolean flag column
        // with no category-label concept of its own) has no mapping here
        // and a caller should just fall back to showing the raw value,
        // same as before this existed.
        const valuesLabels = (field === this.binding.value && this.categoryDisplayLabels && this.categoryDisplayLabels !== this.categoryLabels)
          ? Object.fromEntries(this.categoryLabels.map((v, i) => [v, this.categoryDisplayLabels[i]]))
          : null;
        return {
          id: field, type: 'textual',
          values: sorted,
          valuesCount: Object.fromEntries(weights),
          valuesLabels,
          nCount: totalCount,
          nValuesSum: Array.from(weights.values()).reduce((a, b) => a + b, 0),
          isActive: activeClause != null, activeClause,
          // Real show_facets.js:776 appends objTheme.szUnits to a bar's
          // number ONLY when fShowFacetValues (sizeField weighting) is
          // active — matches sizeField's own truthiness here rather than
          // being a separate condition, since a plain per-record COUNT
          // isn't naturally expressed "in units of" this theme's size
          // field at all.
          unit: sizeField ? (this.style.units || '') : ''
        };
      });
    }

    // (re)builds the per-category GridAggregateIndex for the grid width
    // resolved at the given zoom, only when that width changed. Grid width,
    // as flat reads it (maptheme.js:1892-1908, 7990-8008): gridwidthpx and
    // a "Npx" gridwidth are screen pixels; a bare gridwidth is METERS,
    // converted once at the fixed GRIDWIDTH_METERS_REFERENCE_ZOOM with the
    // FULL dataset's reference latitude (this._gridRefLat), so a meters
    // grid keeps the same cells at every zoom; otherwise the matching
    // style.aggregation bracket; none → no grid (exact positions).
    _ensureClusterIndices(zoom) {
      let radiusPx;
      // GL-PORT COMPAT: a real-ixmaps-flat page's own gridwidth is
      // sometimes a fixed SCREEN-PIXEL size (e.g. style.gridwidth:"3px",
      // confirmed against a real ported page) rather than this engine's
      // own real-world-METERS convention (metersToWorldPixels) — a bare
      // "3" would mean 3 meters here, an absurdly tiny cell, while "3px"
      // means "3 screen pixels regardless of zoom", exactly what
      // style.aggregation already expresses. Detected by the "px" suffix
      // so both conventions can coexist without the page needing to change.
      const gridwidthPxMatch = typeof this.style.gridwidth === 'string' && /^\s*(\d+(?:\.\d+)?)\s*px\s*$/i.exec(this.style.gridwidth);
      // flat: a bracket of aggregation / aggregationscale (its alias,
      // maptheme.js 1923-1929) matching the scale overrides gridwidth /
      // gridwidthpx (initValues, 7988-8006); it may name a field
      const scaled = resolveAggregationPx(this.style.aggregation || this.style.aggregationscale, zoom, null, this._gridRefLat);
      let aggField = null;
      if (scaled.matched) {
        radiusPx = scaled.field ? null : scaled.px;
        aggField = scaled.field;
        this._clusterUsesFixedZoom = scaled.isMeters;
      } else
      // flat: gridwidthpx is the AGGREGATE grid width in screen pixels too
      // (maptheme.js:1906, nGridWidthPx), default 50 when not a number
      if (this.style.gridwidthpx != null && this.style.gridwidthpx !== '') {
        radiusPx = styleNum(this.style.gridwidthpx) || 50;
        this._clusterUsesFixedZoom = false;
      } else if (gridwidthPxMatch) {
        radiusPx = parseFloat(gridwidthPxMatch[1]);
        this._clusterUsesFixedZoom = false;
      } else if (this.style.gridwidth != null) {
        const meters = parseFloat(this.style.gridwidth);
        radiusPx = metersToWorldPixels(meters, this._gridRefLat || 0, GRIDWIDTH_METERS_REFERENCE_ZOOM);
        this._clusterUsesFixedZoom = true;
      } else {
        // Which bracket of .style({aggregation}) is currently active DOES
        // legitimately depend on the live zoom (that's the whole point of
        // the array) — but see resolveAggregationPx's own comment for why
        // a MATCHED meters-valued bracket still needs the fixed reference
        // zoom for ITS OWN OWN radius conversion and, via
        // _clusterUsesFixedZoom below, for _computeAggregatedItems' query
        // zoom too. A theme whose brackets mix "px" and meters values can
        // genuinely flip this flag as the live zoom crosses from one
        // bracket into another.
        // no matching bracket and no gridwidth: no grid (null), like flat
        radiusPx = null;
        this._clusterUsesFixedZoom = false;
      }
      if (this._clusterIndices && this._clusterRadiusPx === radiusPx && this._clusterField === aggField) return;
      this._clusterRadiusPx = radiusPx;
      this._clusterField = aggField;
      // after aggregation, on the cell sums: field100 of a value-based
      // AGGREGATE theme, or the DIFFERENCE of its value fields (flat,
      // maptheme.js 11084-11097: v2 − v1, RELATIVE: in % of v1)
      const post = this._seriesDifference
        ? (v, v100, series) => (series ? cellAggregatedValues({ sums: series, counts: series.map(() => 1) }, this.flags, this.style)[0] : v)
        : this._aggregateField100 ? (v, v100) => aggregateField100(v, v100, this.flags, this.style) : undefined;
      this._clusterIndices = this._featuresByCategory.map(feats => new GridAggregateIndex(radiusPx, this.flags, post, aggField).load(feats));
    }

    // Reverted from the source-accurate two-flat-circle GLOW (radius*6
    // @0.05, radius*2 @0.1, straight from maptheme.js) back to this
    // gradient-texture approximation — the real formula's flat, no-falloff
    // opacity washes into a dense overlapping blur at close zoom with many
    // simultaneously-visible points, and this reads better despite being
    // less literally source-faithful. Deliberate divergence, not a lapse.
    _getGlowIcon(colorRgb) {
      const key = colorRgb.join(',');
      if (!this._glowIconCache.has(key)) {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const c = size / 2;
        const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
        grad.addColorStop(0, `rgba(${key},0.28)`);
        grad.addColorStop(0.5, `rgba(${key},0.09)`);
        grad.addColorStop(1, `rgba(${key},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
        this._glowIconCache.set(key, { url: canvas.toDataURL(), width: size, height: size, anchorX: size / 2, anchorY: size / 2, id: `glow-${key}` });
      }
      return this._glowIconCache.get(key);
    }

    // SHADOW on chart symbols — flat's chart drop shadow (maptheme.js 17097-17160, 18709-18749):
    // an SVG filter that blurs the symbol by nShadowBlur (3) REAL screen pixels, offsets it by
    // nShadowDx/Dy (1.5/2.5 px) and darkens it to 0.1 × its color at the source alpha. Here: a
    // blurred disc as a MASK icon (tinted per item via getColor), one per size step, so the blur
    // stays ~blurPx on screen whatever the symbol radius (a single scaled icon would blur big
    // bubbles more). The disc spans 2/3 of the canvas: the rest is room for the blur.
    // `shape`: the symbol's own (drawSymbolPath, as _buildSingleIcon) — flat's filter shadows
    // whatever the symbol is, e.g. a RECT square
    _getShadowIcon(radiusPx, blurPx, shape) {
      shape = shape || 'circle';
      const step = Math.max(0, Math.min(7, Math.round(Math.log2(Math.max(1, radiusPx)))));
      const key = `shadow-${shape}-${step}-${blurPx}`;
      if (!this._glowIconCache.has(key)) {
        const size = 96, disc = 32, c = size / 2;
        const sigma = Math.max(0.5, Math.min(12, blurPx * disc / Math.pow(2, step)));
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        // the disc itself is drawn off-canvas; only its blurred shadow lands at the center
        ctx.shadowColor = 'rgba(255,255,255,1)';
        ctx.shadowBlur = sigma * 2;
        ctx.shadowOffsetX = size * 4;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); drawSymbolPath(ctx, shape, c - size * 4, c, disc); ctx.closePath(); ctx.fill();
        this._glowIconCache.set(key, { url: canvas.toDataURL(), width: size, height: size, anchorX: c, anchorY: c, mask: true, id: key });
      }
      return this._glowIconCache.get(key);
    }

    _buildBubbleIcon(counts, colors, marked = null) {
      // The cache key quantizes each count's RATIO to the group's total,
      // not the raw count — computeBubblePackLayout's radii are purely
      // sqrt(c/total), so two clusters with wildly different absolute
      // sizes but the same category proportions render pixel-identical
      // icons regardless. Keying on rounded raw counts (the old
      // `Math.round(c*100)`) treated every distinct absolute magnitude as
      // a separate icon, which at a wide zoom-out — thousands of
      // differently-sized clusters, few of them sharing an exact count —
      // requests thousands of pixel-distinct icons and overflows deck.gl's
      // shared icon atlas texture, rendering as solid black squares
      // (confirmed live: same failure mode, same root cause, as the
      // PLOT/GRIDSIZE icon cache fixed earlier in this file). Quantizing
      // the ratio instead collapses same-shaped clusters of any size into
      // one shared icon, bounding the atlas regardless of zoom — 15
      // buckets (~6.7% resolution) rather than a finer 40: with up to 13
      // real NATURA_INC categories, distinct icon count is dominated by
      // which categories are PRESENT at all (a combinatorial factor
      // quantization barely touches), not by ratio precision — measured
      // live, going from 40 to 15 buckets only reduced worst-case distinct
      // shapes from ~1555 to ~1391 at the same wide zoom, so this is a
      // real but modest gain, traded for a shape that's still visually
      // smooth.
      const total = counts.reduce((a, b) => a + b, 0) || 1;
      const RATIO_BUCKETS = 15;
      // an isolated group shows only its marked parts, alone and at their
      // own size: their radius (√share, 1/100 steps) keys the icon, not the
      // coarse share buckets that can put a small marked part at 0
      const key = counts.map(c => Math.round((c / total) * RATIO_BUCKETS)).join('-') + (marked
        ? '|iso:' + counts.map((c, i) => (c > 0 && marked.has(i) ? i + ':' + Math.round(Math.sqrt(c / total) * 100) : null)).filter(Boolean).join(',')
        : '');
      if (this._iconCache.has(key)) return this._iconCache.get(key);
      const size = BUBBLE_ICON_SIZE;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const { present, radii, offsets, fitScale } = (marked && isolatedBubblePackLayout(counts, size, marked)) || computeBubblePackLayout(counts, size);
      const cx = size / 2, cy = size / 2;
      present.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(cx + offsets[i].x * fitScale, cy + offsets[i].y * fitScale, radii[i] * fitScale, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${colors[p.i].join(',')})`;
        ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
      });
      const icon = { url: canvas.toDataURL(), width: size, height: size, anchorX: size / 2, anchorY: size / 2, id: key };
      return this._cacheIcon(key, icon);
    }

    // Plain flat circle, no stroke — an individual point's icon, sharing
    // the same IconLayer (and cache/atlas) as _buildBubbleIcon's cluster
    // icons so both can be sorted and drawn together (see _buildChartLayers
    // for why). Same visual as the ScatterplotLayer it replaces: opacity
    // baked into the texture instead of applied as a layer-wide `opacity`,
    // so it stays correct when combined into one layer with cluster icons
    // (which already bake in their own fixed alpha).
    // shape (default 'circle'), borderColorRgb/borderWidth (default none)
    // — .style({symbolfield, symbolvalues, symbols}) and
    // .style({linecolor, linewidth}) on an individual (non-AGGREGATE)
    // CHART|SYMBOL theme, see _resolveSymbolShape's own comment for the
    // real feature this implements ("SYMBOL... a DIFFERENT, still-
    // unimplemented real type for non-circle marker shapes", per
    // MapBuilder#type's own comment — this is that implementation).
    // Border width is a canvas-pixel value in this icon's OWN fixed
    // BUBBLE_ICON_SIZE raster, not a calibrated real display-pixel width
    // — this icon gets rasterized once and reused (scaled) at every
    // on-screen bubble size the theme's own value-driven radius produces
    // (see valueRadius/_iconCache), so there is no single "actual size"
    // to calibrate a border against, same inherent tradeoff every other
    // cached bubble icon here already accepts; the border scales with
    // the bubble exactly as the fill already does, which reads as
    // reasonable rather than wrong.
    _buildSingleIcon(colorRgb, opacity, shape, borderColorRgb, borderWidth) {
      shape = shape || 'circle';
      borderWidth = borderWidth || 0;
      const key = `single-${shape}-${colorRgb.join(',')}-${opacity}-${borderColorRgb ? borderColorRgb.join(',') : 'none'}-${borderWidth}`;
      if (this._iconCache.has(key)) return this._iconCache.get(key);
      const size = BUBBLE_ICON_SIZE;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const c = size / 2;
      // Inset by half the border width so a thick stroke doesn't get
      // clipped at the canvas edge (same reasoning as _buildGridSquareIcon's
      // own inset, applied here for an arbitrary symbol shape instead of
      // a fixed square).
      const r = c - borderWidth / 2;
      ctx.beginPath();
      drawSymbolPath(ctx, shape, c, c, r);
      ctx.closePath();
      ctx.fillStyle = `rgb(${colorRgb.join(',')})`;
      ctx.globalAlpha = opacity;
      ctx.fill();
      if (borderWidth > 0 && borderColorRgb) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = `rgb(${borderColorRgb.join(',')})`;
        ctx.lineWidth = borderWidth;
        ctx.stroke();
      }
      const icon = { url: canvas.toDataURL(), width: size, height: size, anchorX: size / 2, anchorY: size / 2, id: key };
      return this._cacheIcon(key, icon);
    }

    // .meta({tooltip: "..."}) — the real engine's actual tooltip mechanism:
    // themeObj.szTooltip is run through the REAL Mustache.js library
    // (ui/js/tools/tooltip_mustache.js calls Mustache.render(szHtml,
    // dataObj), with Mustache.escape overridden to identity — no HTML-
    // escaping of interpolated values), so full mustache section/inverted-
    // section/comment syntax works, not just flat {{x}} substitution. This
    // engine loads the same library (global Mustache) and builds the same
    // dataObj shape the real one does (see _buildTooltipContext) — bare
    // {{FIELD}}, {{raw.FIELD}} (unformatted numeric), {{local.FIELD}},
    // {{theme.title/snippet/description}}, {{theme.chart}} and
    // {{theme.item.{chart,data,value,label,title,count,class}}}.
    //
    // Two deliberate, documented divergences (the real __add_chart/
    // __add_data are wired into ixmaps' live SVG theme engine — temp DOM
    // nodes, getChart()/getHistogram() — not portable 1:1 to deck.gl):
    //   - theme.chart / theme.item.chart renders a compact HTML per-
    //     category breakdown (colored swatch + this engine's own VALUES
    //     formatting) instead of an inline SVG chart — one line per present
    //     category, each showing ITS OWN value, never summed across
    //     categories (same rule as the VALUES bubble labels).
    //   - theme.item.data (a table of the hovered record's raw fields) is
    //     only available for an individual, unaggregated point — an
    //     aggregated/grouped bubble has no single underlying record to
    //     tabulate, so it resolves to an empty string there.
    // an item's title as flat gives it (maptheme.js 11838-11886): the title
    // field of its record — of an aggregated item its first record; an
    // aggregated grid cell (no aggregation field) of more than 3 records,
    // or without a title, is titled "(n)"
    _itemTitle(props) {
      const raw = props.raw || props.titleRaw;
      const title = this.binding.title && raw && raw[this.binding.title] != null ? String(raw[this.binding.title]) : '';
      const aggregated = !!(props.counts || props.cluster);
      if (aggregated && this._clusterRadiusPx && !this._clusterField) {
        const n = groupRecordCount(props);
        if (!title || n > 3) return '(' + n + ')';
      }
      return title;
    }

    buildTooltipHtml(object) {
      // no .meta({tooltip}): flat's default template (tooltip_mustache.js 394)
      // — the theme title, the item's title and its chart
      const template = this.meta.tooltip || FLAT_DEFAULT_TOOLTIP;
      if (!global.Mustache) {
        console.warn('[ixmaps-gl] tooltips need Mustache.js, which is not loaded — ' +
          'include https://unpkg.com/mustache@4.2.0/mustache.min.js before ixmaps-gl.js.');
        return null;
      }
      return youtubeClickToPlay(global.Mustache.render(template, this._buildTooltipContext(object)));
    }

    _buildTooltipContext(object) {
      const props = object.properties;
      const isGroup = !!props.counts;
      const chartHtml = this._renderItemChartHtml(props);

      const dataObj = {
        theme: {
          title: this.meta.title || '',
          snippet: this.meta.snippet || '',
          description: this.meta.description || '',
          chart: chartHtml,
          item: {
            chart: chartHtml,
            data: isGroup ? '' : this._renderItemDataTableHtml(props.raw),
            value: this._hasValue(isGroup ? props.total : props.value) ? this._formatTooltipValue(isGroup ? props.total : props.value) : '',
            label: isGroup ? '' : (this.categoryDisplayLabels ? (this.categoryDisplayLabels[props.cat] || '') : ''),
            // flat: the item's title is its titlefield value (binding title/
            // titlefield, e.g. the comune name); else the class label
            title: this._itemTitle(props) || (isGroup ? '' : (this.categoryDisplayLabels ? (this.categoryDisplayLabels[props.cat] || '') : '')),
            count: isGroup ? (props.recordCounts ? props.recordCounts.reduce((a, c) => a + c, 0) : '') : 1,
            class: isGroup ? '' : props.cat
          }
        },
        raw: {},
        local: {}
      };

      // bare {{FIELD}}, {{raw.FIELD}}, {{local.FIELD}} — only meaningful
      // for a single unaggregated record (see class comment above)
      if (!isGroup && props.raw) {
        Object.keys(props.raw).forEach(field => {
          if (field === 'geometry') return;
          const v = props.raw[field];
          if (this._isNumericValue(v)) {
            dataObj[field] = this._formatTooltipValue(v);
            dataObj.raw[field] = v;
          } else {
            dataObj[field] = v;
            dataObj.local[field] = v;
          }
        });
      }

      return dataObj;
    }

    // theme.chart / theme.item.chart approximation — see buildTooltipHtml's
    // comment for why this isn't the real engine's SVG chart. Per-category
    // breakdown, one line per present category, each with its own legend
    // color swatch and its OWN value (never summed across categories).
    _renderItemChartHtml(props) {
      const unitOf = this.style.units ? ' ' + this.style.units : '';
      // an AGGREGATE CATEGORICAL choropleth polygon: its sum per category
      if (props.parts) {
        const labels = this.categoryDisplayLabels || this.categoryLabels || [];
        return tooltipTable(props.parts.map((v, i) => (v > 0 ? { rgb: this.categoryColorsRgb[i], label: labels[i] || '(n/d)', value: this._formatTooltipValue(v) + unitOf } : null)).filter(Boolean));
      }
      if (this.flags.has('CHOROPLETH') && (this.flags.has('DOMINANT') || this.flags.has('COMPOSECOLOR')) && props.raw) {
        return this._renderMultiFieldBarsHtml(props.raw);
      }
      const unit = unitOf;

      // PLOT|GRIDSIZE curve cells: properties.values is an array parallel
      // to _plotCategories() (e.g. one FERITI sum per year), not a single
      // category/value pair — none of the shapes below match it. No
      // per-category color here (PLOT's colorscheme is one line color,
      // not a category ramp), so just label: value per line.
      if (Array.isArray(props.values)) {
        const categories = this._isItemPlot() ? this._itemPlotLabels() : this._plotCategories();
        const labels = this._isItemPlot() ? categories : Array.isArray(this.style.label) ? this.style.label.map(String) : categories;
        return tooltipTable(props.values.map((v, i) => {
          if (v == null || isNaN(v)) return null;
          return { rgb: null, label: labels[i] || categories[i] || i, value: this._formatTooltipValue(v) + unit };
        }).filter(Boolean));
      }

      if (props.counts) {
        // categoryDisplayLabels is only ever set for CATEGORICAL runtimes
        // (_prepare's CATEGORICAL branch) — a range-classed runtime
        // (_buildPartsA, e.g. this port's own Roma pericolosità layer)
        // never sets it, leaving it undefined. Calling .map() on it
        // unguarded (unlike every OTHER categoryDisplayLabels read in this
        // file, all of which fall back to categoryLabels or '') threw
        // "Cannot read properties of undefined (reading 'map')" on every
        // hover/click of a multi-class cluster bubble on such a runtime —
        // an uncaught exception inside deck.gl's own getTooltip callback,
        // which (same class of bug as the click-handler crash fixed
        // earlier this session) can corrupt deck.gl's internal
        // pointer/interaction state and silently break subsequent pan/
        // zoom until something resets it. Root cause of the "trackpad
        // zoom sometimes just stops updating" reports.
        const labels = this.categoryDisplayLabels || this.categoryLabels || [];
        return tooltipTable(labels.map((label, i) => {
          if (!(props.counts[i] > 0)) return null;
          return { rgb: this.categoryColorsRgb[i], label: label || '(n/d)', value: this._formatTooltipValue(props.counts[i]) + unit };
        }).filter(Boolean));
      }
      if (props.cat != null) {
        const label = this.categoryDisplayLabels ? (this.categoryDisplayLabels[props.cat] || '') : '';
        const rgb = this.categoryColorsRgb ? this.categoryColorsRgb[props.cat] : null;
        // no bound size field (e.g. a plain DOT|CATEGORICAL layer) -> just
        // the category label, no ": undefined" value suffix
        return tooltipTable([{ rgb, label, value: this._hasValue(props.value) ? this._formatTooltipValue(props.value) + unit : '' }]);
      }
      return '';
    }

    // {{theme.item.chart}} of a multi-field choropleth (DOMINANT, incl.
    // DEVIATION/PERCENTOFMEAN, COMPOSECOLOR) as real ixmaps-flat draws it
    // (tooltip_mustache.js __add_chart → theme.getChart(item, 30,
    // "VALUES|XAXIS|ZOOM|BOX|GRID")): a bar per field in the field's color,
    // its value with units, the field label; horizontal with HORZ (else
    // columns), sorted by value with SORT (UP ascending); bars on one
    // scale — the theme's maximum over every field and polygon (flat's
    // nMax), not the item's own. Values are the item's own (after field100).
    _renderMultiFieldBarsHtml(raw) {
      const fields = String(this.binding.value || '').split('|');
      if (this._multiFieldMax === undefined) {
        let max = 0;
        for (const f of this.features) for (const field of fields) { const v = Math.abs(parseFloat(f.properties[field])); if (v > max) max = v; }
        this._multiFieldMax = max;
      }
      const labels = Array.isArray(this.style.label) && this.style.label.length === fields.length ? this.style.label.map(String)
        : (this.categoryDisplayLabels || this.categoryLabels || fields);
      const unit = this.style.units ? ' ' + this.style.units : '';
      let rows = fields.map((field, i) => ({ i, v: parseFloat(raw[field]) })).filter(r => Number.isFinite(r.v));
      if (!rows.length) return '';
      if (this.flags.has('SORT')) rows.sort((a, b) => (this.flags.has('UP') ? a.v - b.v : b.v - a.v));
      const color = i => { const c = (this.categoryColorsRgb || [])[i] || [128, 128, 128]; return `rgb(${c.slice(0, 3).join(',')})`; };
      const frac = v => (this._multiFieldMax ? Math.max(0, Math.abs(v) / this._multiFieldMax) : 0);
      const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      if (this.flags.has('HORZ')) {
        const BAR_PX = 60;
        return '<table style="border-collapse:collapse;font-size:0.72em;line-height:1.25;margin-top:0.2em">'
          + rows.map(r => '<tr>'
            + `<td style="text-align:right;padding:0 0.4em 0 0;opacity:0.8;white-space:nowrap">${esc(labels[r.i] || fields[r.i])}</td>`
            + `<td style="padding:1px 0"><div style="width:${Math.round(frac(r.v) * BAR_PX)}px;min-width:${r.v ? 2 : 0}px;height:0.95em;background:${color(r.i)}"></div></td>`
            + `<td style="padding:0 0 0 0.4em;white-space:nowrap">${this._formatTooltipValue(r.v)}${unit}</td>`
            + '</tr>').join('')
          + '</table>';
      }
      const COL_PX = 50;
      return '<div style="display:flex;align-items:flex-end;gap:4px;font-size:0.72em;margin-top:0.3em">'
        + rows.map(r => '<div style="display:flex;flex-direction:column;align-items:center;max-width:4.5em">'
          + `<div style="white-space:nowrap">${this._formatTooltipValue(r.v)}${unit}</div>`
          + `<div style="width:1.4em;height:${Math.round(frac(r.v) * COL_PX)}px;min-height:${r.v ? 2 : 0}px;background:${color(r.i)}"></div>`
          + `<div style="opacity:0.8;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:4.5em">${esc(labels[r.i] || fields[r.i])}</div>`
          + '</div>').join('')
        + '</div>';
    }

    _hasValue(v) {
      return v != null && !isNaN(Number(v));
    }

    // theme.item.data approximation — a plain field:value table of the
    // hovered record's own raw properties (individual points only).
    _renderItemDataTableHtml(raw) {
      if (!raw) return '';
      const rows = Object.keys(raw)
        .filter(k => k !== 'geometry')
        .map(k => `<tr><td style="padding:0 0.6em 0 0;color:#888">${k}</td><td>${this._isNumericValue(raw[k]) ? this._formatTooltipValue(raw[k]) : raw[k]}</td></tr>`)
        .join('');
      return `<table style="font-size:0.95em;border-collapse:collapse">${rows}</table>`;
    }

    _isNumericValue(v) {
      if (v === '' || v == null) return false;
      return !isNaN(parseFloat(v)) && isFinite(v);
    }

    // Real tooltip formatting default is `nValueDecimals || 2` — note the
    // real `||`, not a null check: a theme with valuedecimals:0 (falsy)
    // still gets 2 decimals in tooltip text, only an explicit non-zero
    // value overrides it. Thousands grouped with spaces, matching the real
    // formatValue()'s own convention (not comma/dot grouping).
    _formatTooltipValue(value) {
      const num = Number(value);
      if (isNaN(num)) return String(value);
      const rawDecimals = styleNum(this.style.valuedecimals);
      const decimals = isNaN(rawDecimals) ? 2 : rawDecimals;
      // flat's __formatValue (mapscript.js 6268ff) rounds twice: first to
      // one decimal more (toFixed), then to the precision (Math.round) —
      // 25.446 → "25.45" → 25.5, where a single toFixed(1) gives 25.4
      // 0 keeps its decimals here (the class labels follow flat's legend
      // toFixed(2), legend.js 636), unlike the chart values' formatValue
      if (num === 0) return num.toFixed(decimals);
      return flatGroupedValue(num, decimals);
    }

    // Per-icon alpha for the legend's isolate-on-click behavior (see
    // _markedClasses) — dims rather than removes, matching the real
    // engine's "isolate_gray" evidence mode: a dimmed point stays visible
    // at its real position instead of vanishing, so panning/zooming
    // doesn't lose spatial context for the de-emphasized categories.
    // A grouped/clustered item (properties.counts, one slot per category)
    // counts as marked if ANY of its constituent categories is marked —
    // a mixed cluster shouldn't dim just because one of several
    // categories inside it happens to be unmarked.
    // the marked classes a group isolates to (isolatedBubblePackLayout),
    // or null: none marked, a page's own mark handler, or evidence
    // "isolate_gray" (keeps every part, dimmed via _iconAlpha)
    _groupIsolation(d) {
      if (!d.properties.counts || !this._markedClasses.size || this._onMarksChanged) return null;
      if (String(this.style.evidence || 'isolate') === 'isolate_gray') return null;
      return d.properties.counts.some((c, i) => c > 0 && this._markedClasses.has(i)) ? this._markedClasses : null;
    }

    _iconAlpha(d) {
      if (!this._markedClasses.size) return 255;
      if (d.properties.counts) {
        for (let i = 0; i < d.properties.counts.length; i++) {
          if (d.properties.counts[i] > 0 && this._markedClasses.has(i)) return 255;
        }
        return DIMMED_ICON_ALPHA;
      }
      return this._markedClasses.has(d.properties.cat) ? 255 : DIMMED_ICON_ALPHA;
    }

    // liveZoom (optional, defaults to `zoom`): the map's ACTUAL current
    // zoom, even mid-gesture — see _buildChartLayers for why this needs
    // to be separate from `zoom` (which freezes to the last SETTLED zoom
    // during an active zoom gesture, for clustering/grid-alignment
    // reasons unrelated to symbol size).
    // globeCenter (null under mercator): the map's current geographic
    // center under globe projection, used ONLY by _buildChartLayers to
    // cull bubbles/glow icons sitting on the far (hidden) hemisphere —
    // see that method's own comment for why this is needed at all
    // (billboarded icons have no orientation-based back-face culling the
    // way the FEATURE/CHOROPLETH GeoJsonLayer polygons do).
    buildDeckLayers(zoom, bbox, liveZoom = zoom, globeCenter = null) {
      this._lastZoom = zoom;
      this._lastBbox = bbox;
      if (this._hidden) return [];
      if (!this.flags.has('FEATURE') && !this.flags.has('FEATURES') && chartHiddenByScale(this.style, liveZoom)) return [];
      // DOT is checked FIRST, matching the real engine's own precedence
      // (its DOT branch is a loop-level fast-path that bypasses the whole
      // drawChart/modifier machinery entirely — a layer flagged DOT never
      // reaches CHART|SYMBOL's clustering/GLOW/VALUES pipeline, even if
      // those flags are also present in the type string).
      if (this.flags.has('DOT')) return this._buildDotLayers();
      // GRIDSIZE (spatial grid binning) is checked before the generic
      // CHART|SYMBOL bubble pipeline, same "more specific base type wins"
      // precedence as DOT: PLOT+GRIDSIZE is the per-year curves mini-chart
      // (_buildPlotLayers); GRIDSIZE alone (no PLOT — the real engine's
      // "grid" companion layer) is a plain uniform grid mesh, sized to the
      // full cell pitch regardless of SIZE/QUANTILE/MEAN, matching
      // maptheme.js's own `GRIDSIZE && !PLOT -> nRadius = nGridSize/2` rule
      // (SIZE/QUANTILE/MEAN have no visible effect there in the real
      // engine either — confirmed, not a gap in this port).
      if (this.flags.has('GRIDSIZE') && this.flags.has('PLOT')) return this._buildPlotLayers(zoom, bbox);
      // PLOT without GRIDSIZE: one line chart per item over its value fields
      if (this.flags.has('PLOT') && this._isItemPlot()) return this._buildItemPlotLayers(zoom);
      if (this.flags.has('GRIDSIZE')) return this._buildGridMeshLayers(zoom, bbox);
      // CHOROPLETH is checked before the generic FEATURE dispatch — a
      // CHOROPLETH layer's own type string doesn't carry FEATURE/FEATURES
      // (only its geometry-donor base layer does, see
      // joinChoroplethFeatures); its data is already the joined
      // {geometry, properties} FeatureCollection built in build().
      if (this.flags.has('CHOROPLETH')) return this._buildChoroplethLayers(zoom);
      // FEATURE is the real engine's own keyword (confirmed in maptheme.js
      // — singular); FEATURES (plural) is this port's own prior
      // convention, still used by demo_accidents.html/accidents_app.html —
      // both accepted so a real config ported verbatim (singular) and this
      // engine's existing pages (plural) both work.
      //
      // A FEATURE base donating geometry to a same-named CHOROPLETH (see
      // joinChoroplethFeatures) renders nothing of its own — per explicit
      // correction, its own visible fill was stacking underneath the
      // CHOROPLETH's, compounding opacity (e.g. 0.4 gray base + 0.3
      // CHOROPLETH fill never actually looked like 0.3). The CHOROPLETH
      // already provides its own "no data" fallback color for any
      // unmatched polygon, so the donor's fill serves no purpose once
      // superseded.
      if (this._isChoroplethGeometryDonor) return [];
      if (this.flags.has('FEATURE') || this.flags.has('FEATURES')) {
        return featuresHiddenByScale(this.style, liveZoom) ? [] : this._buildFeaturesLayers(liveZoom, bbox);
      }
      // USER charts (a page's own chart function, style.userdraw) go the
      // chart pipeline too, drawn by _buildUserChartLayers (bubbles when the
      // page has no such function)
      if (isSymbolChart(this.flags)) return this._buildChartLayers(zoom, bbox, liveZoom, globeCenter);
      console.warn(`[ixmaps-gl] layer "${this.name}": type "${[...this.flags].join('|')}" has no implemented renderer`);
      return [];
    }

    _buildFeaturesLayers(zoom, bbox) {
      const cs = this.style.colorscheme;
      const raw = Array.isArray(cs) ? cs[0] : cs;
      const filled = raw !== 'none';
      const shadow = filled && flatShadowOn(this.style, this.features.length, zoom)
        ? this._buildShadowLayers(hexOrNamedToRgb(raw), zoom, bbox) : [];
      return shadow.concat([new GeoJsonLayer({
        id: this._dataLayerId(`ix-features-${this.name}`),
        data: this._featureCollection(),
        // linecolor "none": no outline (a FEATURES theme of points with
        // colorscheme and linecolor "none" draws nothing, as flat)
        stroked: styleLineColor(this.style.linecolor) !== 'none',
        filled,
        // A FEATURES/FEATURE base layer has one flat fill color for every
        // polygon (style.colorscheme[0], or plain style.colorscheme) —
        // unlike CHOROPLETH, there's no per-feature classification here.
        // flat puts fillopacity into the shape's fill-opacity only
        // (maptheme.js 13407, 14071-14078): the outline stays opaque
        // (a fill color's own alpha — rgba(…, 0.5) — times fillopacity)
        getFillColor: filled ? [...hexOrNamedToRgb(raw).slice(0, 3), Math.round(255 * cssColorAlpha(raw) * (styleNum(this.style.fillopacity) || 1))] : [0, 0, 0, 0],
        getLineColor: this.style.linecolor
          ? withAlpha(hexOrNamedToRgb(styleLineColor(this.style.linecolor)), cssColorAlpha(styleLineColor(this.style.linecolor)))
          : [130, 130, 130],
        lineWidthMinPixels: styleNum(this.style.linewidth) || 1,
        // Confirmed live (2026-09-21, deck.gl v9.4/MapLibre-globe upgrade):
        // this layer's fill rendered with a moire/hatching pattern of
        // "holes" ONLY under globe projection, never flat Mercator —
        // uniform across the whole polygon (not localized to specific
        // edges/vertices) and completely unaffected by disabling `stroked`
        // or by 5x+ densifying the source geometry's vertices (both ruled
        // out as the cause by direct A/B testing, not assumed). Root cause:
        // deck.gl's interleaved polygon surface and MapLibre's own native
        // globe-sphere mesh independently compute the "same" 3D position
        // for a point on the Earth's surface, at a depth-buffer precision
        // that isn't enough to resolve which one is in front — classic
        // coplanar z-fighting, worse at more zoomed-out views (less depth
        // precision per screen pixel), invisible under flat rendering
        // (no real depth contention there). `depthCompare: 'always'` makes
        // this layer always win the depth test rather than flicker against
        // MapLibre's own surface. Confirmed this doesn't let hidden
        // far-side (back hemisphere) polygons bleed through: those are
        // still correctly excluded by ordinary back-face culling, which is
        // orientation-based and untouched by this change — verified by
        // rotating the globe and checking for bleed-through, not assumed.
        parameters: { depthCompare: 'always' }
      })]);
    }

    // .style({shadow:true}) — flat's drop shadow of the shapes (maptheme.js
    // 17097-17155): an SVG filter under the shapes, their silhouette in
    // 0.1·(R+G+B) gray, blurred (σ shadowblur, 3 screen px) and shifted
    // (shadowdx/dy, 1.5/2.5 px). deck.gl has neither blur nor a pixel
    // offset for polygons: the silhouette is shifted by the offset in
    // degrees at the view's center latitude, filled at half alpha (a
    // Gaussian edge's value), and three translucent outlines of 3/6/12 px
    // give the blurred edge's falloff (≈0.3 / 0.15 / 0.05 out to 1.5 / 3 /
    // 6 px). Shapes without fill have no shadow here.
    _buildShadowLayers(rgb, zoom, bbox) {
      const blur = styleNum(this.style.shadowblur) || 3;
      const num = (v, d) => (isNaN(styleNum(v)) ? d : styleNum(v));
      const dx = num(this.style.shadowdx, 1.5), dy = num(this.style.shadowdy, 2.5);
      const pxPerDeg = 512 * Math.pow(2, zoom) / 360;
      const lat = bbox ? (bbox[1] + bbox[3]) / 2 : 0;
      const dLng = dx / pxPerDeg, dLat = -dy * Math.cos(lat * Math.PI / 180) / pxPerDeg;
      const key = dLng.toPrecision(3) + ',' + dLat.toPrecision(3);
      if (!this._shadowCache || this._shadowCache.key !== key || this._shadowCache.src !== this.features) {
        const shift = c => (typeof c[0] === 'number' ? [c[0] + dLng, c[1] + dLat] : c.map(shift));
        this._shadowCache = { key, src: this.features, data: { type: 'FeatureCollection', features: this.features.map(f => (f.geometry
          ? { type: 'Feature', properties: {}, geometry: { type: f.geometry.type, coordinates: shift(f.geometry.coordinates) } } : f)) } };
      }
      const gray = Math.round(Math.min(255, 0.1 * (rgb[0] + rgb[1] + rgb[2])));
      const edge = (w, a) => new GeoJsonLayer({
        id: this._dataLayerId(`ix-shadow-${this.name}-${w}`), data: this._shadowCache.data, pickable: false,
        filled: false, stroked: true, getLineColor: [gray, gray, gray, Math.round(255 * a)],
        lineWidthUnits: 'pixels', getLineWidth: w * blur / 3, lineJointRounded: true,
        parameters: { depthCompare: 'always' }
      });
      return [new GeoJsonLayer({
        id: this._dataLayerId(`ix-shadow-${this.name}`), data: this._shadowCache.data, pickable: false,
        filled: true, stroked: false, getFillColor: [gray, gray, gray, 128],
        parameters: { depthCompare: 'always' }
      }), edge(12, 0.05), edge(6, 0.105), edge(3, 0.176)];
    }

    // .type("CHOROPLETH") — a polygon fill from a bound value, three ways:
    // numeric range (QUANTILE/NATURAL/equal-interval, _buildPartsA/
    // _resolveClassIndex, single-field binding.value); DOMINANT's
    // per-polygon argmax across MULTIPLE piped fields (_resolveDominantClass
    // — plain/PERCENTOFMEAN/DEVIATION); or COMPOSECOLOR's per-polygon
    // BLEND across the same piped fields (_resolveComposedColor — no
    // single winning class, so no `cat`/tooltip chart line, just the
    // blended color directly); AGGREGATE CATEGORICAL on one field — the
    // dominant category of each polygon's records (aggregatedCategoricalClass).
    // A plain CATEGORICAL choropleth (exact match of one row's value) is not
    // implemented. Geometry + properties are already the joined
    // FeatureCollection from joinChoroplethFeatures. `zoom` is only used
    // for style.fillopacity:"auto" (see resolveAutoFillOpacity) — every
    // other branch here is zoom-independent.
    _buildChoroplethLayers(zoom) {
      const source = this._activeFeatures || this.features;
      // flat (maptheme.js 13811-13823): a polygon whose value falls in no
      // class is painted in style.nodatacolor (default white); a polygon
      // with no data row at all is not painted by the choropleth (it keeps
      // the base layer's look) — transparent here
      const fallbackRgb = parseCssColor(this.style.nodatacolor) || [255, 255, 255];
      const hasData = d => d.properties.raw && Object.keys(d.properties.raw).length > 0;
      const isDominant = this.flags.has('DOMINANT');
      const isComposeColor = this.flags.has('COMPOSECOLOR');
      const baseOpacity = resolveFillOpacity(this.style, this.mapOptions, zoom);
      // DOPACITY needs a PER-FEATURE opacity, which deck.gl only supports
      // via getFillColor's own alpha channel (its layer-level `opacity`
      // prop is one number for every feature) — see _resolveDopacityAlpha.
      // Not meaningful combined with COMPOSECOLOR (no single driving value
      // per polygon there), matching the real engine's own separate
      // DOPACITY/COMPOSECOLOR branches.
      const dopacityActive = !isComposeColor &&
        (this.flags.has('DOPACITY') || this.flags.has('DOPACITYMIN') || this.flags.has('DOPACITYMAX') || this.flags.has('DOPACITYMINMAX'));
      // AGGREGATE CATEGORICAL: every polygon's parts and dominant class
      // (aggregatedCategoricalClass), the biggest part per class over all
      // polygons for the opacity (flat's nMaxA)
      // the polygons' classes don't depend on the view or on marked
      // classes (those only change the colors, see updateTriggers below):
      // the data is rebuilt only when its inputs change
      const dataKey = [source, this._dataGen, this.categoryIndexByLabel, this.partsA, this._classSeparate,
        dopacityActive ? baseOpacity : null, JSON.stringify(this.style), JSON.stringify(this.binding)];
      const collection = this._cachedPolygonData('_choroplethData', dataKey, () => {
        const aggCat = isAggregatedCategoricalChoropleth(this) && this.categoryIndexByLabel;
        let aggOf = null, aggMaxA = null;
        if (aggCat) {
          const nCats = this.categoryLabels.length;
          aggOf = new Map();
          aggMaxA = new Array(nCats).fill(0);
          source.forEach(f => {
            const rows = f.properties && f.properties[AGGREGATED_ROWS];
            if (!rows) return;
            const agg = aggregatedCategoricalClass(rows, this.binding, this.flags, this.categoryIndexByLabel, nCats);
            if (!agg) return;
            aggOf.set(f, agg);
            agg.parts.forEach((v, i) => { if (v > aggMaxA[i]) aggMaxA[i] = v; });
          });
        }
        const data = source.map(f => {
          if (aggCat) {
            const agg = aggOf.get(f);
            return {
              type: 'Feature',
              geometry: f.geometry,
              properties: {
                // no part above 0: no item in flat, not painted
                value: agg ? agg.value : undefined, raw: agg ? f.properties : {}, cat: agg ? agg.index : null, parts: agg ? agg.parts : undefined,
                dopacityAlpha: agg && dopacityActive ? dominantDopacityAlpha(this.style, this.flags, agg.value, aggMaxA[agg.index]) : null
              }
            };
          }
          if (isComposeColor) {
            return {
              type: 'Feature',
              geometry: f.geometry,
              properties: { raw: f.properties, composedColor: this._resolveComposedColor(f.properties) }
            };
          }
          if (isDominant) {
            const dom = this._resolveDominantClass(f.properties);
            const value = dom ? dom.value : undefined;
            return {
              type: 'Feature',
              geometry: f.geometry,
              properties: {
                value, raw: f.properties, cat: dom ? dom.index : null,
                dopacityAlpha: dopacityActive ? this._resolveDopacityAlpha(f, value, baseOpacity) : null
              }
            };
          }
          // a polygon without a data row is no item in flat: no value
          const hasRow = f.properties && Object.keys(f.properties).length > 0;
          const value = hasRow ? flatNumber(f.properties[this.binding.value], this.flags) : NaN;
          const cat = this._resolveClassIndex(value);
          return {
            type: 'Feature',
            geometry: f.geometry,
            properties: {
              value, raw: f.properties, cat,
              dopacityAlpha: dopacityActive ? this._resolveDopacityAlpha(f, value, baseOpacity) : null
            }
          };
        });
        return { type: 'FeatureCollection', features: data };
      });
      // A marked class (legend row click / ixmaps.markThemeClass) as real
      // ixmaps-flat shows it on a choropleth (MapTheme.markClass,
      // maptheme.js 14276ff): polygons of the OTHER classes are hidden —
      // evidence mode "isolate", the default (7715) — or grayed with
      // style.evidence "isolate_gray". ("highlight", flat's highlight list,
      // is shown grayed too here.) COMPOSECOLOR has no classes.
      // linecolor "none": no outline; a class color "none" (an explicit
      // colorscheme list) leaves its polygons unpainted, an rgba() class
      // color keeps its alpha — as flat's SVG fill does
      const lineColorRaw = this.style.linecolor ? styleLineColor(this.style.linecolor) : null;
      const lineRgb = lineColorRaw ? withAlpha(hexOrNamedToRgb(lineColorRaw), cssColorAlpha(lineColorRaw)) : [255, 255, 255];
      const cs = this.style.colorscheme;
      const classAlpha = Array.isArray(cs) && cs.length && !/^\d+$/.test(String(cs[0])) ? cs.map(cssColorAlpha) : null;
      const alphaOfClass = i => (classAlpha && i != null && classAlpha[i] != null ? classAlpha[i] : 1);
      const evidenceMode = String(this.style.evidence || 'isolate');
      const unmarkedEvidence = d => {
        if (!this._markedClasses.size || this._onMarksChanged || this._markedClasses.has(d.properties.cat)) return null;
        return evidenceMode === 'isolate' ? 'hide' : 'gray';
      };
      const grayOf = ([r, g, b]) => { const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b); return [y, y, y]; };
      // deck.gl re-runs the color accessors only for new data or a changed trigger
      const colorKey = JSON.stringify([[...this._markedClasses], !!this._onMarksChanged, evidenceMode,
        this.categoryColorsRgb, fallbackRgb, classAlpha, lineRgb]);
      return [new GeoJsonLayer({
        id: this._dataLayerId(`ix-choropleth-${this.name}`),
        data: collection,
        updateTriggers: { getFillColor: colorKey, getLineColor: colorKey },
        pickable: true,
        stroked: true,
        filled: true,
        getFillColor: d => {
          if (!hasData(d)) return [0, 0, 0, 0];
          const rgb = d.properties.composedColor
            || (d.properties.cat != null ? this.categoryColorsRgb[d.properties.cat] : null) || fallbackRgb;
          const evidence = unmarkedEvidence(d);
          if (evidence === 'hide') return [0, 0, 0, 0];
          if (evidence === 'gray') return [...grayOf(rgb), 90];
          const a = alphaOfClass(d.properties.cat);
          return d.properties.dopacityAlpha != null ? [...rgb.slice(0, 3), Math.round(d.properties.dopacityAlpha * a * 255)] : withAlpha(rgb, a);
        },
        // a per-polygon accessor only while a class is isolated
        getLineColor: this._markedClasses.size && !this._onMarksChanged && evidenceMode === 'isolate'
          ? d => (unmarkedEvidence(d) === 'hide' ? [0, 0, 0, 0] : lineRgb)
          : lineRgb,
        lineWidthMinPixels: styleNum(this.style.linewidth) || 1,
        // per-feature alpha (baked above) already carries the resolved
        // base opacity — a layer-level opacity on TOP of that would
        // multiply it a second time.
        opacity: dopacityActive ? 1 : baseOpacity
      })];
    }

    // .type("GRIDSIZE") — bins ACTIVE features into a world-pixel grid
    // (cell pitch = style.gridwidthpx screen px at the CURRENT zoom, using
    // the same lngLatToWorldPixel space RELOCATE grouping already uses —
    // simpler than the real engine's own meters-roundtrip conversion, same
    // observable result: cells that look like a constant on-screen size).
    // Only ONE ordered category set is supported here — style.values (or
    // .xaxis), the real engine's own explicit-ranges convention (see
    // _prepare's CATEGORICAL branch) — a record whose bound value isn't in
    // that list is excluded, matching the real engine's explicit-ranges
    // behavior. Rebuilt only when zoom or cell pitch changes, matching the
    // real engine's own geo-anchored-grid behavior (stable under pure pan).
    _ensureGridIndex(zoom) {
      const cellPx = styleNum(this.style.gridwidthpx) || GRID_WIDTH_PX_DEFAULT;
      if (this._gridIndex && this._gridZoom === zoom && this._gridCellPx === cellPx) return;
      this._gridZoom = zoom;
      this._gridCellPx = cellPx;

      const source = this._activeFeatures || this.features;
      const categories = this._plotCategories();

      const cells = new Map();
      source.forEach(f => {
        const ci = this._gridCategoryIndex(f.properties[this.binding.value]);
        if (ci == null) return;
        const [lng, lat] = f.geometry.coordinates;
        const p = lngLatToWorldPixel(lng, lat, zoom);
        // snapToAggregationGrid (RECT square grid, or real ixmaps' default
        // hexagonal tiling) — the snapped point IS the cell's identity AND
        // its position, matching the real engine (no separate "cell
        // center" concept; see snapToAggregationGrid's own comment).
        const snapped = snapToAggregationGrid(p.x, p.y, cellPx, this.flags, zoom);
        const key = `${snapped.x}:${snapped.y}`;
        let cell = cells.get(key);
        if (!cell) {
          cell = { px: snapped.x, py: snapped.y, sums: new Array(categories.length).fill(0), counts: new Array(categories.length).fill(0) };
          cells.set(key, cell);
        }
        const v = this._resolveAggregateValue(f.properties);
        cell.sums[ci] += v;
        cell.counts[ci]++;
      });

      this._gridIndex = Array.from(cells.values());
    }

    // ordered category list for GRIDSIZE binning / PLOT's X axis —
    // style.values/xaxis (explicit, see _prepare) if set, else whatever
    // CATEGORICAL auto-discovered.
    // a per-item PLOT: no GRIDSIZE grid, several value fields per item
    _isItemPlot() {
      return this.flags.has('PLOT') && !this.flags.has('GRIDSIZE') && String(this.binding.value || '').includes('|');
    }
    _itemPlotFields() {
      return String(this.binding.value || '').split('|');
    }
    // x-axis labels of a per-item PLOT (style.xaxis / label, else the fields)
    _itemPlotLabels() {
      const fields = this._itemPlotFields();
      const explicit = Array.isArray(this.style.xaxis) ? this.style.xaxis : typeof this.style.xaxis === 'string' ? this.style.xaxis.split('|')
        : Array.isArray(this.style.label) ? this.style.label : null;
      return explicit ? fields.map((f, i) => String(explicit[i] != null ? explicit[i] : f)) : fields;
    }

    _buildItemPlotLayers(zoom) {
      const fields = this._itemPlotFields();
      const items = [];
      let dMin = Infinity, dMax = -Infinity;
      for (const f of this.features) {
        const pos = itemAnchor(f.geometry);
        if (!pos) continue;
        const values = fields.map(k => parseFloat(f.properties[k]));
        for (const v of values) if (!isNaN(v)) { dMin = Math.min(dMin, v); dMax = Math.max(dMax, v); }
        items.push({ geometry: { type: 'Point', coordinates: pos }, properties: { values, raw: f.properties } });
      }
      if (!items.length) return [];
      const sMin = styleNum(this.style.minvalue), sMaxRaw = this.style.maxvalue;
      const autoMax = String(sMaxRaw) === 'auto';
      const sMax = styleNum(sMaxRaw);
      const rangeFor = values => {
        const own = values.filter(v => !isNaN(v));
        return {
          min: !isNaN(sMin) ? sMin : dMin,
          max: autoMax ? (own.length ? Math.max(...own) : dMax) : !isNaN(sMax) ? sMax : dMax,
        };
      };
      const sizeMax = styleNum(this.style.normalsizevalue) || Math.max(Math.abs(dMin), Math.abs(dMax)) || 1;
      // S in screen px: twice the normal bubble radius (flat: normalX(30)
      // vs a bubble's normalX(15)), × scale, × object scaling
      const S = 2 * NORMAL_RADIUS_PX * (styleNum(this.style.scale) || 1) * objectZoomFactor(zoom, this.mapOptions);
      const color = parseCssColor(Array.isArray(this.style.colorscheme) ? this.style.colorscheme[0] : this.style.colorscheme) || [0, 102, 204];
      const fillOpacity = styleNum(this.style.fillopacity);
      return [new IconLayer({
        id: `ix-itemplot-${this.name}-g${this._iconGeneration}`,
        data: items, pickable: true,
        getPosition: d => d.geometry.coordinates,
        getIcon: d => this._buildItemPlotIcon(d.properties.values, rangeFor(d.properties.values), sizeMax, color, fillOpacity),
        // the icon is drawn in chart units (see _buildItemPlotIcon): its
        // height in S units × S px
        getSize: d => this._buildItemPlotIcon(d.properties.values, rangeFor(d.properties.values), sizeMax, color, fillOpacity).heightUnits * S,
        sizeUnits: 'pixels',
        updateTriggers: { getSize: [S] }
      })];
    }

    // canvas for one per-item PLOT chart (itemPlotGeometry), RASTER px per
    // chart unit; anchored at the chart origin (the item position)
    _buildItemPlotIcon(values, range, sizeMax, color, fillOpacity) {
      const RASTER = 24;
      const key = 'itemplot|' + values.join(',') + '|' + range.min + ':' + range.max + '|' + sizeMax;
      if (this._iconCache.has(key)) return this._iconCache.get(key);
      const g = itemPlotGeometry(values, range, this.style, this.flags, sizeMax);
      const { x0, x1, y0, y1 } = g.bbox;
      const W = Math.max(2, Math.ceil((x1 - x0) * RASTER)), H = Math.max(2, Math.ceil((y1 - y0) * RASTER));
      const px = x => (x - x0) * RASTER, py = y => (y1 - y) * RASTER;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const rgb = color.slice(0, 3).join(',');
      if (g.area) {
        ctx.fillStyle = `rgba(${rgb},${isNaN(fillOpacity) ? 1 : fillOpacity})`;
        ctx.beginPath();
        g.area.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
        ctx.closePath();
        ctx.fill();
      }
      if (this.flags.has('LINES')) {
        ctx.strokeStyle = `rgb(${rgb})`;
        ctx.lineWidth = g.lineWidth * RASTER;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let open = false;
        for (const p of g.points) {
          if (!p) { open = false; continue; }
          if (open) ctx.lineTo(px(p.x), py(p.y)); else { ctx.moveTo(px(p.x), py(p.y)); open = true; }
        }
        ctx.stroke();
      }
      for (const p of g.points) {
        if (!p || !(p.r > 0)) continue;
        ctx.beginPath();
        ctx.arc(px(p.x), py(p.y), p.r * RASTER, 0, 2 * Math.PI);
        ctx.fillStyle = `rgb(${rgb})`;
        ctx.fill();
        ctx.lineWidth = RASTER / 75;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      const icon = { url: canvas.toDataURL(), width: W, height: H, anchorX: px(0), anchorY: py(0), id: key, heightUnits: y1 - y0 };
      return this._cacheIcon(key, icon);
    }

    _plotCategories() {
      const explicit = Array.isArray(this.style.values) ? this.style.values
        : Array.isArray(this.style.xaxis) ? this.style.xaxis : null;
      if (explicit) return explicit.map(String);
      return this.categoryLabels || [];
    }

    // Category-index lookup for GRIDSIZE binning — deliberately NOT the
    // same as matching against _plotCategories()'s display labels: when
    // style.values/xaxis is explicit (the curves-chart case), those labels
    // ARE the raw matchable values ("2019" etc.), but when there's no
    // explicit list and _prepare() instead classed this layer's bound
    // value into numeric partsA buckets (the "grid" mesh companion layer's
    // case — QUANTILE, no CATEGORICAL), categoryLabels holds FORMATTED
    // range strings like "2019.00 - 2020.00", not matchable raw values.
    // Reuses the same _resolveClassIndex the rest of the engine already
    // uses for exactly this "which bucket" question, instead of
    // duplicating a second, narrower matching rule that only worked for
    // the explicit-list case (a real bug caught in verification — the
    // grid mesh layer built zero cells before this fix).
    _gridCategoryIndex(rawValue) {
      const explicit = Array.isArray(this.style.values) ? this.style.values
        : Array.isArray(this.style.xaxis) ? this.style.xaxis : null;
      if (explicit) {
        if (!this._explicitCatIndex) this._explicitCatIndex = new Map(explicit.map((v, i) => [String(v), i]));
        return this._explicitCatIndex.get(String(rawValue));
      }
      return this._resolveClassIndex(rawValue);
    }

    // pure: cellAggregatedValues → see the pure-function sections above the class
    _cellAggregatedValues(cell) { return cellAggregatedValues(cell, this.flags, this.style); }

    // .type("GRIDSIZE|PLOT|LINES|AREA|...") — the per-year curves chart:
    // one small multi-point line/area chart per grid cell, rendered to a
    // canvas icon (same technique as GLOW/_buildBubbleIcon) and placed via
    // IconLayer at each cell's fixed geo center. FIXSIZE means every
    // cell's icon is the SAME SIZE regardless of data — that footprint is
    // set by GRIDSIZE to the full grid cell width (matching the grid-mesh
    // companion layer's own square, times .style({scale})).
    //
    // normalsizevalue does NOT control this chart-box size, and does NOT
    // control the Y-axis scale either — corrected per explicit user
    // clarification: it calibrates the size of a single SYMBOL, which on
    // a PLOT chart is each individual curve point's own marker dot (the
    // exact same role it plays for BUBBLE, just applied to a different
    // symbol). The Y-axis scale is a separate concern — style.minvalue/
    // maxvalue if explicitly set (fixed range), otherwise AUTOMATIC
    // per-cell (each cell's own local min/max, not a shared reference),
    // optionally stretched/compressed by style.rangescale. This config
    // sets neither minvalue nor maxvalue, so scaling here is automatic.
    _buildPlotLayers(zoom, bbox) {
      this._ensureGridIndex(zoom);
      let categories = this._plotCategories();
      if (!categories.length) return [];
      let labels = Array.isArray(this.style.label) ? this.style.label.map(String) : categories;
      // DIFFERENCE: one value less per cell (cellAggregatedValues)
      if (this.flags.has('DIFFERENCE') && categories.length > 1) {
        categories = categories.slice(0, -1);
        labels = labels.slice(0, categories.length);
      }

      const data = this._gridIndex.map(cell => {
        const center = worldPixelToLngLat(cell.px, cell.py, zoom);
        return {
          geometry: { type: 'Point', coordinates: [center.lng, center.lat] },
          properties: { values: this._cellAggregatedValues(cell) }
        };
      });

      const iconSize = (styleNum(this.style.gridwidthpx) || GRID_WIDTH_PX_DEFAULT) * (styleNum(this.style.scale) || 1);

      // Under FIXSIZE, both the Y-axis auto-scale and the curve point
      // markers are calibrated against the WHOLE dataset, not each cell's
      // own local values — every box is the same physical size, so a
      // shared reference keeps cells visually comparable (a low-count and
      // a high-count cell would otherwise both auto-stretch to look
      // "full") and gives every marker dot, in every cell, the SAME size
      // instead of a per-point value-scaled one. Computed once per redraw
      // (not per-icon) — this._buildPlotIcon runs once per grid cell, and
      // rescanning the whole grid inside it would be O(cells^2) before
      // icons are cache-warm.
      let normalSizeValue = styleNum(this.style.normalsizevalue);
      let datasetMax = 0, datasetMin = 0;
      data.forEach(d => d.properties.values.forEach(v => { if (v > datasetMax) datasetMax = v; if (v < datasetMin) datasetMin = v; }));
      datasetMax = datasetMax || 1;
      if (isNaN(normalSizeValue)) normalSizeValue = datasetMax;

      return [new IconLayer({
        id: `ix-plot-${this.name}-g${this._iconGeneration}`,
        data, pickable: true,
        getPosition: d => d.geometry.coordinates,
        getIcon: d => this._buildPlotIcon(d.properties.values, categories, labels, normalSizeValue, datasetMax, datasetMin),
        getSize: iconSize,
        sizeUnits: 'pixels'
      })];
    }

    // Canvas rendering for one cell's mini-chart — BOX background, AREA
    // fill, LINES stroke, point markers, LASTARROW, and XAXIS tick labels,
    // each only drawn when its flag is present, all reading directly from
    // this layer's own style (colorscheme/fillopacity/linewidth/
    // markersize/normalsizevalue/boxopacity/bordercolor) — matching the
    // exact config this was built against, not a generalized
    // reinterpretation of every real PLOT style option.
    _buildPlotIcon(values, categories, labels, normalSizeValue, datasetMax, datasetMin = 0) {
      const W = PLOT_ICON_RASTER_SIZE, H = PLOT_ICON_RASTER_SIZE;
      const hasXAxis = this.flags.has('XAXIS');
      const chartH = hasXAxis ? H - PLOT_XAXIS_HEIGHT : H;
      const marginX = 6;

      // SMOOTH — a literal 3-point centered rolling average over INTERIOR
      // points only, matching the real engine exactly (maptheme.js:21271,
      // confirmed via direct source read): the loop there runs i from
      // length-2 down to 1, so index 0 and index length-1 are never
      // touched — they keep their raw value. Only averaging the edges too
      // (an earlier version of this code did that) artificially dampens
      // sharp first/last swings: for [7936, 4551, 6914] it produced a
      // near-flat [6243.5, 6467, 5732.5] instead of the real engine's
      // [7936, 6467, 6914], which visibly hid a real, large V-shaped dip.
      let plotValues = values;
      if (this.flags.has('SMOOTH') && values.length >= 3) {
        plotValues = values.map((v, i) => {
          if (i === 0 || i === values.length - 1) return v;
          return (values[i - 1] + v + values[i + 1]) / 3;
        });
      }

      // ZEROISVALUE — when set (this config's case), a zero is a real
      // plotted point; when absent, a zero breaks the line into a gap.
      const zeroIsValue = this.flags.has('ZEROISVALUE');

      // Y-axis scale: style.minvalue/maxvalue if explicitly set (a FIXED
      // range, shared and comparable across cells), otherwise AUTOMATIC.
      // Under FIXSIZE the auto MAX is dataset-WIDE (not this cell's own
      // local max) — every cell's chart box is the same physical size, so
      // scaling each to only its own range would stretch every cell to
      // look equally "full" regardless of actual magnitude. Without
      // FIXSIZE (not exercised by this config), per-cell local scaling is
      // the natural fallback. style.rangescale stretches (>1) or
      // compresses (<1) whichever range ends up in effect.
      const rangeScale = styleNum(this.style.rangescale) || 1;
      const definedValues = plotValues.filter(v => v != null && !isNaN(v));
      const styleMin = styleNum(this.style.minvalue);
      const styleMax = styleNum(this.style.maxvalue);
      // flat's plot range starts at the data minimum (maptheme.js 22458:
      // Math.min(this.nMin, ...)) — negative values (a DIFFERENCE series)
      // stay inside the box; positive-only data keeps 0 as the baseline here
      const autoMin = this.flags.has('FIXSIZE')
        ? Math.min(0, datasetMin)
        : Math.min(0, ...(definedValues.length ? definedValues : [0]));
      const autoMax = this.flags.has('FIXSIZE')
        ? (datasetMax || 1)
        : (definedValues.length ? Math.max(0.0001, ...definedValues) : 0.0001);
      const effectiveMin = !isNaN(styleMin) ? styleMin : autoMin;
      const effectiveMax = effectiveMin + (( !isNaN(styleMax) ? styleMax : autoMax) - effectiveMin) / rangeScale;
      const valueSpan = (effectiveMax - effectiveMin) || 1;

      // FIXSIZE: every curve point marker (the "symbol" on this chart
      // type) renders at ONE fixed size, with no dependency on any value
      // (not this point's own, not the dataset's). normalsizevalue scales
      // that uniform size DOWN — style.markersize is the size at
      // normalsizevalue===1 ("typical sparkline" size), and e.g.
      // normalsizevalue:20 renders every dot 20x smaller. Without FIXSIZE
      // (not exercised by this config), each point instead sizes to its
      // own raw value via the same normalsizevalue formula BUBBLE's
      // valueRadius uses.
      const baseMarkerR = styleNum(this.style.markersize) || 0;
      const sizePow = resolveSizePow(this.style, this.flags);
      const markerRadiusFor = v => this.flags.has('FIXSIZE')
        ? baseMarkerR / (normalSizeValue || 1)
        : baseMarkerR * Math.pow(Math.max(0, v || 0) / (normalSizeValue || 1), 1 / sizePow);

      const n = categories.length;
      const stepX = n > 1 ? (W - marginX * 2) / (n - 1) : 0;
      const baselineY = chartH - 3;
      const plotAreaH = chartH - 8;

      // Point Y positions (and marker radii) are quantized to a coarse
      // grid BEFORE anything else happens — including before they become
      // the icon cache key. Without this, a closer zoom means far more,
      // finer grid cells, each with a slightly different sum, each
      // requesting its own pixel-distinct (so uncached) icon — deck.gl's
      // IconLayer packs all distinct icons into one shared texture atlas,
      // and thousands of near-identical variants overflow it, rendering
      // as solid black rectangles. Confirmed live (screenshot from a
      // closer zoom) — same failure mode, and same fix, as the
      // multi-bubble cluster icon's quantized bucket-mix signature
      // earlier in this file.
      const Y_QUANT_PX = 8;
      const R_QUANT_PX = 0.5;
      const points = plotValues.map((v, i) => {
        if (v == null || isNaN(v) || (!zeroIsValue && v === 0)) return null;
        const ratio = (v - effectiveMin) / valueSpan;
        const rawY = baselineY - Math.max(0, Math.min(1, ratio)) * plotAreaH;
        // marker radius reflects this point's own RAW value (values[i]),
        // not the SMOOTH-averaged plotValues[i] used for the line's Y
        // position — SMOOTH is meant to shape the line, not misrepresent
        // what a point's own dot size says its actual data value is
        return {
          x: marginX + i * stepX,
          y: Math.round(rawY / Y_QUANT_PX) * Y_QUANT_PX,
          r: Math.round(markerRadiusFor(values[i]) / R_QUANT_PX) * R_QUANT_PX
        };
      });

      const key = points.map(p => (p ? `${p.y}:${p.r}` : 'x')).join('-') + `|${n}`;
      if (this._iconCache.has(key)) return this._iconCache.get(key);

      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // BOX
      const boxOpacity = styleNum(this.style.boxopacity);
      if (!isNaN(boxOpacity) && boxOpacity > 0) {
        ctx.fillStyle = `rgba(255,255,255,${boxOpacity})`;
        ctx.fillRect(0, 0, W, H);
      }
      const borderColor = this.style.bordercolor;
      if (borderColor && borderColor !== 'none') {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
      }

      const lineColorRaw = (resolveColorScheme(this.style.colorscheme, ['']) || ['#666666'])[0] || '#666666';
      const rgb = hexOrNamedToRgb(lineColorRaw);
      const rgbStr = rgb.join(',');

      // SPLINE — NOT a real ixmaps flag (deliberate addition, see below):
      // traces AREA/LINES through a run's points with a Catmull-Rom-to-
      // Bezier curve instead of straight segments, for a visually smooth
      // line. This is purely how the path is DRAWN — it never touches
      // the plotted Y-values themselves (those still come only from
      // SMOOTH's own literal, real-engine 3-point average, or from the
      // raw per-point values when SMOOTH is absent), so it composes
      // cleanly with SMOOTH rather than replacing it: SMOOTH decides
      // WHERE each point sits, SPLINE decides how the line connects them.
      // Runs are split at gaps (a null point — value missing, or zero
      // without ZEROISVALUE) exactly like the original point-by-point
      // tracing did, each drawn as its own independent curve.
      const useSpline = this.flags.has('SPLINE');
      const runs = [];
      { let cur = []; points.forEach(p => { if (p) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } }); if (cur.length) runs.push(cur); }
      function tracePath(ctx, run) {
        if (useSpline && run.length >= 3) {
          for (let i = 0; i < run.length - 1; i++) {
            const p0 = run[i - 1] || run[i], p1 = run[i], p2 = run[i + 1], p3 = run[i + 2] || p2;
            ctx.bezierCurveTo(
              p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
              p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
              p2.x, p2.y
            );
          }
        } else {
          for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
        }
      }

      // AREA — fill between the line and the baseline
      if (this.flags.has('AREA')) {
        const fillOpacity = styleNum(this.style.fillopacity);
        ctx.fillStyle = `rgba(${rgbStr},${isNaN(fillOpacity) ? 0.15 : fillOpacity})`;
        ctx.beginPath();
        runs.forEach(run => {
          ctx.moveTo(run[0].x, baselineY);
          ctx.lineTo(run[0].x, run[0].y);
          tracePath(ctx, run);
          ctx.lineTo(run[run.length - 1].x, baselineY);
        });
        ctx.closePath();
        ctx.fill();
      }

      // LINES
      if (this.flags.has('LINES')) {
        ctx.strokeStyle = `rgb(${rgbStr})`;
        ctx.lineWidth = styleNum(this.style.linewidth) || 1;
        ctx.beginPath();
        runs.forEach(run => {
          ctx.moveTo(run[0].x, run[0].y);
          tracePath(ctx, run);
        });
        ctx.stroke();
      }

      // point markers — each dot's own radius, calibrated by
      // normalsizevalue per-point (see markerRadiusFor above)
      if (baseMarkerR > 0) {
        ctx.fillStyle = `rgb(${rgbStr})`;
        points.forEach(p => {
          if (!p || p.r <= 0) return;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // LASTARROW — small arrowhead at the final plotted point, oriented
      // along the line's final segment direction
      if (this.flags.has('LASTARROW')) {
        let lastIdx = -1;
        for (let i = points.length - 1; i >= 0; i--) if (points[i]) { lastIdx = i; break; }
        let prevIdx = -1;
        for (let i = lastIdx - 1; i >= 0; i--) if (points[i]) { prevIdx = i; break; }
        if (lastIdx >= 0 && prevIdx >= 0) {
          const p1 = points[prevIdx], p2 = points[lastIdx];
          const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          // style.markersize drives the arrowhead size (a real theme
          // parameter — was hardcoded at 5px here before, ignoring it
          // entirely). Scaled up from baseMarkerR (the same per-point dot
          // radius computed above) rather than used 1:1, since an
          // arrowhead needs to read clearly as an arrow shape, not a dot
          // — factor and floor are this port's own calibration (not
          // independently source-verified), tuned to land close to the
          // original hardcoded 5px at this config's markersize:3.
          const arrowLen = Math.max(3, baseMarkerR * 2);
          ctx.fillStyle = `rgb(${rgbStr})`;
          ctx.beginPath();
          ctx.moveTo(p2.x, p2.y);
          ctx.lineTo(p2.x - arrowLen * Math.cos(angle - Math.PI / 6), p2.y - arrowLen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(p2.x - arrowLen * Math.cos(angle + Math.PI / 6), p2.y - arrowLen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        }
      }

      // XAXIS — small tick labels along the bottom. The first/last labels
      // use left/right alignment instead of center — centering every
      // label (including the ones sitting right at the canvas edges)
      // pushed roughly half their width off-canvas, clipping "2019" down
      // to what looked like "!015".
      if (hasXAxis) {
        ctx.fillStyle = '#888';
        ctx.font = '8px arial';
        labels.forEach((lab, i) => {
          ctx.textAlign = i === 0 ? 'left' : i === labels.length - 1 ? 'right' : 'center';
          ctx.fillText(lab, marginX + i * stepX, H - 2);
        });
      }

      // anchored at the icon's true geometric center (not chartH, even
      // with XAXIS) so the whole chart+axis block sits centered over its
      // grid cell, aligned with the grid-mesh square underneath it —
      // .style({offsetx, offsety}) is deliberately NOT applied as a whole-
      // icon shift (tried that first; it visibly detached each chart from
      // its own cell, floating over the row above instead)
      const icon = { url: canvas.toDataURL(), width: W, height: H, anchorX: W / 2, anchorY: H / 2, id: key };
      return this._cacheIcon(key, icon);
    }

    // .type("GRIDSIZE") without PLOT — the real engine's plain grid-mesh
    // companion layer: every cell renders as a uniform square at the FULL
    // cell pitch (SIZE/QUANTILE/MEAN have no visible effect here in the
    // real source either, confirmed — not a gap in this port), one flat
    // style.colorscheme fill.
    _buildGridMeshLayers(zoom) {
      this._ensureGridIndex(zoom);
      const data = this._gridIndex.map(cell => {
        const center = worldPixelToLngLat(cell.px, cell.py, zoom);
        return { geometry: { type: 'Point', coordinates: [center.lng, center.lat] } };
      });

      const fillColor = (resolveColorScheme(this.style.colorscheme, ['']) || ['rgba(255,255,255,0.3)'])[0] || 'rgba(255,255,255,0.3)';
      const borderColor = styleLineColor(this.style.linecolor);
      const borderWidth = styleNum(this.style.linewidth);
      const cellPx = this._gridCellPx;
      const icon = this._buildGridSquareIcon(fillColor, borderColor, isNaN(borderWidth) ? 0 : borderWidth, cellPx);

      return [new IconLayer({
        id: `ix-grid-${this.name}-g${this._iconGeneration}`,
        data, pickable: false,
        getPosition: d => d.geometry.coordinates,
        getIcon: () => icon,
        getSize: cellPx,
        sizeUnits: 'pixels'
      })];
    }

    // flat's MapTheme fields the user chart reads, from this theme's style
    // (maptheme.js parseStyle: fillopacity → fillOpacity, fadenegative →
    // nFadeNegative, valuescale → nValueScale, …)
    _userChartTheme(values) {
      const st = this.style, num = v => (v == null || v === '' ? undefined : Number(v));
      const colors = (this.categoryColorsRgb || []).map((c, i) => this._userChartColor(i));
      let nMin = Infinity, nMax = -Infinity;
      for (const v of values) { if (v < nMin) nMin = v; if (v > nMax) nMax = v; }
      return {
        szId: themeIdOf(this), szName: themeIdOf(this), szFlag: Array.from(this.flags).join('|'),
        colorScheme: colors, nMin: isFinite(nMin) ? nMin : 0, nMax: isFinite(nMax) ? nMax : 0,
        nNormalSizeValue: st.normalsizevalue, nSizePow: num(st.sizepow), nScale: num(st.scale) || 1,
        fillOpacity: num(st.fillopacity), nOpacity: num(st.opacity),
        szLineColor: st.linecolor != null ? styleLineColor(st.linecolor) : undefined, nLineWidth: st.linewidth,
        nFadeNegative: st.fadenegative != null ? (Number(st.fadenegative) || 0.5) : undefined,
        nValueScale: num(st.valuescale), nValueDecimals: st.valuedecimals, szUnits: st.units,
        szValueColor: st.valuecolor, nTextScale: num(st.textscale), nRangeScale: st.rangescale,
        nValueSizeMin: num(st.minvaluesize != null ? st.minvaluesize : st.clipvaluesize), nMinValue: st.minvalue,
        nValueValueMin: num(st.minvaluevalue)
      };
    }
    // a class color as flat hands it over: the style's own color string
    // for an explicit color list, else the resolved color
    _userChartColor(cat) {
      const cs = this.style.colorscheme;
      if (Array.isArray(cs) && cs.length === (this.categoryColorsRgb || []).length && !isGeneratedColorScheme(cs)) return String(cs[cat]);
      const c = (this.categoryColorsRgb || [])[cat] || [128, 128, 128];
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
    // USER charts (see resolveUserChartFunction): one icon per chart, drawn
    // by the page's function; null → no such function (drawn as bubbles)
    _buildUserChartLayers(combined, liveZoom, sizeValueOf) {
      const name = String(this.style.userdraw || '');
      const draw = resolveUserChartFunction(name);
      if (!draw || typeof document === 'undefined') {
        if (!this._userChartWarned) { this._userChartWarned = true; console.warn(`[ixmaps-gl] USER chart "${name}": no function ixmaps.${name} — drawn as bubbles`); }
        return null;
      }
      // a fresh group, and <name>_init on it, for every drawing of the
      // charts — as flat calls _init per realize into the theme's chart
      // group, which the next draw replaces: chart functions add their defs
      // on every draw (arrowChart a gradient per chart), and a group kept
      // for good grew by thousands of them within a few zooms, slowing every
      // draw until the page blocked. A chart's own image keeps the defs it
      // uses (_drawUserChartSvg).
      // While the map moves the last drawing stays (as flat's freezeOnPan):
      // the charts change with every step of a zoom (size) and a pan (the
      // grid), and drawing them — hundreds of chart functions and image
      // decodes — every 150 ms of a gesture kept the page busy until it
      // hardly reacted. The view is drawn once it stands still ('moveend').
      if (this._viewMoving && this._userChartLastLayers) return this._userChartLastLayers;
      const host = userChartHost();
      if (this._userChartGroup) this._userChartGroup.remove();
      this._userChartGroup = document.createElementNS(SVG_NS, 'g');
      host.appendChild(this._userChartGroup);
      const valueOf = d => (d.properties.counts ? d.properties.total : d.properties.value);
      const theme = this._userChartTheme(combined.map(valueOf).filter(v => typeof v === 'number' && isFinite(v)));
      const init = resolveUserChartFunction(name + '_init');
      try { if (init) init.call(global.ixmaps, document, { target: this._userChartGroup, theme }); } catch (e) {
        if (!this._userChartInitError) console.error(`[ixmaps-gl] ${name}_init:`, e);
        this._userChartInitError = e;
      }
      // px per chart unit: gl's bubble radius of a value over flat's chart
      // radius of it (see USER_CHART_MAX_SIZE)
      const pxPerUnit = NORMAL_RADIUS_PX * objectZoomFactor(liveZoom, this.mapOptions) * (styleNum(this.style.scale) || 1) / USER_CHART_MAX_SIZE;
      const flag = theme.szFlag;
      const maxRasterPx = Math.sqrt(USER_CHART_ATLAS_AREA / Math.max(1, combined.length));
      const data = [];
      let pending = 0;
      for (const d of combined) {
        const value = valueOf(d);
        // the item's class (range classes set it for groups too — a negative
        // group total would make dominant() pick the wrong class)
        const cat = d.properties.cat != null ? d.properties.cat : (d.properties.counts ? dominant(d.properties.counts) : 0);
        const radiusPx = valueRadius(sizeValueOf(d), liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue);
        const size = radiusPx / pxPerUnit;
        const icon = this._userChartIcon(draw, name, theme, flag, d, value, cat, size, sizeValueOf(d), pxPerUnit, maxRasterPx);
        if (!icon || icon.failed) continue;
        if (!icon.canvas) { pending++; continue; }
        data.push({ d, icon });
      }
      // The charts' images come asynchronously (an SVG decodes as an image):
      // until every chart of this view has its image the previous complete
      // drawing stays, then the new one replaces it in one piece — as flat
      // shows a theme once it is drawn. (Drawing the ready part meanwhile,
      // and redrawing batch by batch as images came, left the map on an
      // incomplete or old state after many zooms and pans.)
      if (glDebug()) console.info(`[ixmaps-gl debug] ${themeIdOf(this)}: zoom ${mapLibreToFlatZoom(liveZoom).toFixed(2)}, ${combined.length} charts, ${data.length} ready, ${pending} pending${this._viewMoving ? ' (moving)' : ''}`);
      if (pending) {
        this._userChartWaiting = true;
        return this._userChartLastLayers || [];
      }
      this._userChartWaiting = false;
      if (!data.length) return (this._userChartLastLayers = []);
      // the icon texture is built here, from the chart canvases, and given
      // to deck.gl whole (iconAtlas + iconMapping): deck.gl has nothing to
      // load, and the texture is exactly this view's charts
      const atlas = this._userChartAtlas(data.map(e => e.icon));
      this._userChartLastLayers = [new IconLayer({
        id: `ix-bubbles-${this.name}`,
        data, pickable: true,
        iconAtlas: atlas.canvas, iconMapping: atlas.mapping,
        getPosition: e => e.d.geometry.coordinates,
        getIcon: e => e.icon.id,
        getSize: e => e.icon.unitHeight * pxPerUnit,
        sizeUnits: 'pixels',
        billboard: true,
        // no mipmaps: the charts are drawn at their size on screen
        textureParameters: { minFilter: 'linear', magFilter: 'linear' },
        parameters: ICON_LAYER_GLOBE_PARAMETERS
      })];
      return this._userChartLastLayers;
    }
    // one texture for a view's charts: rows of images, 2048 px wide; the
    // same set of charts keeps its texture
    _userChartAtlas(icons) {
      const ids = icons.map(i => i.id);
      const sig = [...new Set(ids)].sort().join('\n');
      if (this._userChartAtlasCache && this._userChartAtlasCache.sig === sig) return this._userChartAtlasCache;
      const W = 2048, PAD = 2, mapping = {}, seen = new Set(), place = [];
      let x = 0, y = 0, rowH = 0;
      for (const icon of icons) {
        if (seen.has(icon.id)) continue;
        seen.add(icon.id);
        if (x + icon.width + PAD > W) { x = 0; y += rowH + PAD; rowH = 0; }
        place.push([icon, x, y]);
        mapping[icon.id] = { x, y, width: icon.width, height: icon.height, anchorX: icon.anchorX, anchorY: icon.anchorY, mask: false };
        x += icon.width + PAD; rowH = Math.max(rowH, icon.height);
      }
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = Math.max(1, y + rowH);
      const ctx = canvas.getContext('2d');
      for (const [icon, px, py] of place) ctx.drawImage(icon.canvas, px, py);
      this._userChartAtlasCache = { sig, canvas, mapping };
      return this._userChartAtlasCache;
    }
    // user chart images become ready one by one: one redraw once they are
    _scheduleUserChartRedraw() {
      if (this._userChartRedrawTimer) return;
      this._userChartRedrawTimer = setTimeout(() => {
        this._userChartRedrawTimer = null;
        if (this._userChartWaiting && this._triggerRedraw) this._triggerRedraw();
      }, 30);
    }
    // The chart is drawn once (its SVG kept in _userChartSvgs) and rasterised
    // at its size on screen (× devicePixelRatio, in steps of USER_CHART_RASTER
    // px) onto a canvas (icon.canvas, once the SVG image has decoded): one
    // image per chart at a fixed 256 px made the texture of a few hundred
    // charts outgrow the GPU's texture size — WebGL errors, and deck.gl
    // frames that failed, leaving the map un-updated after a zoom.
    _userChartIcon(draw, name, theme, flag, d, value, cat, size, nSize, pxPerUnit, maxRasterPx = Infinity) {
      const base = `user|${name}|${cat}|${Math.round(value * 100) / 100}|${Math.round(size * 2) / 2}|${flag}`;
      if (!this._userChartSvgs) this._userChartSvgs = new Map();
      if (!this._userChartRasters) this._userChartRasters = new Map();
      let chart = this._userChartSvgs.get(base);
      if (chart === undefined) {
        chart = this._drawUserChartSvg(draw, name, theme, flag, d, value, cat, size, nSize);
        if (chart === undefined) return null; // a failing draw is tried again
        if (this._userChartSvgs.size >= ICON_CACHE_MAX) this._userChartSvgs.delete(this._userChartSvgs.keys().next().value);
        this._userChartSvgs.set(base, chart);
      }
      if (!chart) return null;
      const dpr = (global.devicePixelRatio || 1);
      const want = Math.max(chart.vw, chart.vh) * pxPerUnit * dpr;
      const fits = USER_CHART_RASTER.filter(r => r <= maxRasterPx);
      const steps = fits.length ? fits : USER_CHART_RASTER.slice(0, 1);
      const px = steps.find(r => r >= want) || steps[steps.length - 1];
      const key = base + '|' + px;
      const rasters = this._userChartRasters;
      if (rasters.has(key)) {
        // least recently used goes first
        const hit = rasters.get(key);
        rasters.delete(key); rasters.set(key, hit);
        return hit;
      }
      const s = px / Math.max(chart.vw, chart.vh);
      const w = Math.max(1, Math.round(chart.vw * s)), h = Math.max(1, Math.round(chart.vh * s));
      const icon = { canvas: null, width: w, height: h, anchorX: (chart.ox - chart.vx) * s, anchorY: (chart.oy - chart.vy) * s, id: key, unitHeight: chart.vh };
      // a chart whose image fails is left out (not waited for)
      const failed = e => {
        icon.failed = true;
        if (!this._userChartImageError) console.warn(`[ixmaps-gl] USER chart ${name}: chart image failed`, e);
        this._userChartImageError = e || true;
        this._scheduleUserChartRedraw();
      };
      // the SVG goes through a canvas: deck.gl blends an SVG image as decoded
      // (premultiplied), which darkened half-transparent fills (a
      // fadenegative arrow turned grey)
      const img = new Image();
      img.onerror = failed;
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          icon.canvas = canvas;
        } catch (e) { failed(e); return; }
        this._scheduleUserChartRedraw();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(chart.svg.replace('__W__', w).replace('__H__', h));
      if (rasters.size >= ICON_CACHE_MAX) rasters.delete(rasters.keys().next().value);
      rasters.set(key, icon);
      return icon;
    }
    // the page's chart function draws one chart into the hidden SVG: its
    // markup and box (chart units), null when it draws nothing, undefined
    // when it fails
    _drawUserChartSvg(draw, name, theme, flag, d, value, cat, size, nSize) {
      const g = document.createElementNS(SVG_NS, 'g');
      this._userChartGroup.appendChild(g);
      const color = this._userChartColor(cat);
      const raw = d.properties.raw || d.properties;
      const label = this.binding.title && raw && raw[this.binding.title] != null ? String(raw[this.binding.title]) : undefined;
      let chart = null;
      try {
        const ret = draw.call(global.ixmaps, document, {
          target: g, theme, value, values: [value], size, maxSize: USER_CHART_MAX_SIZE, color, class: cat, flag,
          item: { szColor: color, szLabel: label, nCount: d.properties.point_count || 1, nSize }, dbRecord: raw
        });
        const bb = ret ? g.getBBox() : null;
        if (bb && bb.width > 0 && bb.height > 0) {
          const markup = new XMLSerializer().serializeToString(g);
          const ids = new Set([...markup.matchAll(/url\(#([^)"']+)\)/g)].map(m => m[1]));
          const defs = [...ids].map(id => { const el = this._userChartGroup.ownerDocument.getElementById(id); return el ? new XMLSerializer().serializeToString(el) : ''; }).join('');
          // strokes and text halos reach past the geometric box
          const pad = Math.max(bb.width, bb.height) * 0.06 + 10;
          const vx = bb.x - pad, vy = bb.y - pad, vw = bb.width + 2 * pad, vh = bb.height + 2 * pad;
          // the chart's origin (0,0 — or the point flat moves it to, ret) sits at the map position
          const ox = (ret && ret.x) || 0, oy = (ret && ret.y) || 0;
          chart = { vx, vy, vw, vh, ox, oy,
            svg: `<svg xmlns="${SVG_NS}" width="__W__" height="__H__" viewBox="${vx} ${vy} ${vw} ${vh}"><defs>${defs}</defs>${markup}</svg>` };
        }
      } catch (e) {
        if (!this._userChartDrawError) console.error(`[ixmaps-gl] USER chart ${name}:`, e);
        this._userChartDrawError = e;
        g.remove();
        return undefined;
      }
      g.remove();
      return chart;
    }

    // BOX (see the BOX block in _buildChartLayers): a rectangle icon
    // w×h px, rounded corners rx, stroke sw px; drawn at twice the size
    _buildBoxIcon(w, h, rx, sw, look) {
      const q = v => Math.max(0.5, Math.round(v * 2) / 2);
      const W = q(w), H = q(h), R = Math.round(rx * 2) / 2, S = Math.round(sw * 4) / 4;
      const key = `box|${W}|${H}|${R}|${S}|${look.fill}|${look.fillOpacity}|${look.stroke}|${look.strokeOpacity}`;
      if (this._iconCache.has(key)) return this._iconCache.get(key);
      const k = 2, pad = Math.ceil(S * k / 2) + 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(W * k) + pad * 2; canvas.height = Math.ceil(H * k) + pad * 2;
      const ctx = canvas.getContext('2d');
      const path = () => {
        ctx.beginPath();
        const x = pad, y = pad, ww = W * k, hh = H * k, rr = Math.min(R * k, ww / 2, hh / 2);
        ctx.moveTo(x + rr, y); ctx.arcTo(x + ww, y, x + ww, y + hh, rr); ctx.arcTo(x + ww, y + hh, x, y + hh, rr);
        ctx.arcTo(x, y + hh, x, y, rr); ctx.arcTo(x, y, x + ww, y, rr); ctx.closePath();
      };
      path();
      ctx.globalAlpha = look.fillOpacity; ctx.fillStyle = look.fill; ctx.fill();
      if (look.stroke && S > 0) { ctx.globalAlpha = look.strokeOpacity; ctx.strokeStyle = look.stroke; ctx.lineWidth = S * k; ctx.stroke(); }
      // getSize is the icon's height: the padding is part of it
      const icon = { url: canvas.toDataURL(), width: canvas.width, height: canvas.height, anchorX: canvas.width / 2, anchorY: canvas.height / 2, id: key };
      return this._cacheIcon(key, icon);
    }

    _buildGridSquareIcon(fillColor, borderColor, borderWidth, cellPx) {
      const key = `grid|${fillColor}|${borderColor}|${borderWidth}|${cellPx}`;
      if (this._iconCache.has(key)) return this._iconCache.get(key);
      // Raster resolution tracks the cell's actual on-screen size (cellPx,
      // clamped to a sane range) rather than a fixed low-res 32px — a thin
      // config linewidth like "0.2" is a real DISPLAY pixel width, and
      // drawing it on a raster far smaller than the displayed size means
      // scaling it back up magnifies it into a thick border (the original
      // bug); drawing it on a raster far LARGER than needed just wastes
      // texture atlas space. Matching resolution keeps the stroke close to
      // its true 1:1 thickness, visible as a fine line on close inspection
      // — confirmed against the real ixmaps engine on this exact config,
      // which shows a faint grid outline, not an invisible or thick one.
      const size = Math.max(32, Math.min(256, Math.round(cellPx) || 32));
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, size, size);
      if (borderColor && borderColor !== 'none' && borderWidth > 0) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth * (size / (cellPx || size));
        ctx.strokeRect(1, 1, size - 2, size - 2);
      }
      const icon = { url: canvas.toDataURL(), width: size, height: size, anchorX: size / 2, anchorY: size / 2, id: key };
      return this._cacheIcon(key, icon);
    }

    // .type("DOT") — one point per record, always (no clustering, matching
    // the real engine bypassing AGGREGATE for this type). Color comes from
    // a bound value's class — CATEGORICAL (exact match) or numeric
    // range/class (_buildPartsA) — if either is active, otherwise a single
    // style.colorscheme color. Wrapped in the same {value, raw, cat} shape
    // individual CHART points use so buildTooltipHtml/_buildTooltipContext
    // works unchanged.
    _buildDotLayers() {
      const source = this._activeFeatures || this.features;
      const hasClasses = !!this.categoryLabels;
      const fallbackRgb = this._dotFallbackColor();

      const data = source.map(f => ({
        geometry: f.geometry,
        properties: {
          value: this.binding.size ? parseFloat(f.properties[this.binding.size]) : undefined,
          raw: f.properties,
          cat: hasClasses ? this._resolveClassIndex(f.properties[this.binding.value]) : null
        }
      }));

      return [new ScatterplotLayer({
        id: `ix-dot-${this.name}`,
        data, pickable: true,
        getPosition: d => d.geometry.coordinates,
        getRadius: DOT_RADIUS_PX,
        radiusUnits: 'pixels',
        getFillColor: d => (d.properties.cat != null ? this.categoryColorsRgb[d.properties.cat] : null) || fallbackRgb,
        stroked: false,
        opacity: styleNum(this.style.fillopacity) || 1
      })];
    }

    // Fallback color for a DOT with no CATEGORICAL and no numeric
    // binding.value to range-class (i.e. _prepare() never populated
    // categoryLabels at all) — one plain color from style.colorscheme.
    _dotFallbackColor() {
      const cs = this.style.colorscheme;
      const raw = Array.isArray(cs) ? cs[0] : cs;
      if (!raw || raw === 'none') return [90, 90, 90];
      return hexOrNamedToRgb(raw);
    }

    // Turns a bbox + zoom into this runtime's rendered {individual, groups}
    // shape — factored out of _buildChartLayers so the SAME clustering/
    // RELOCATE math can also be run against the FULL data extent (see
    // _ensureAggregateStats) instead of just the current viewport, without
    // duplicating the logic.
    //
    // RELOCATE only ever changes WHERE an aggregated item is drawn, never
    // which records share a cell (aggregateOnGrid, per category). Without
    // RELOCATE an item sits at the center of its RECT/hexbin cell ("aggre-
    // gation by field" is a separate, not-yet-implemented mode); with
    // RELOCATE at the mean of its records' positions, and _groupCoLocated
    // additionally merges same-cell items across categories.
    _computeAggregatedItems(bbox, zoom) {
      // Real ixmaps-flat's plain CHART/BUBBLE theme — no explicit
      // AGGREGATE in the type string — draws exactly one icon per
      // record, full stop. It does NOT merge nearby or even perfectly
      // coincident records into a summed/counted group; overlapping
      // records just overlap. Confirmed live as a real, user-facing
      // deviation from that: with Supercluster running unconditionally
      // for every CHART+SYMBOL theme (the old behavior here), 91 separate
      // WRI power-plant records sharing near-identical coordinates (a
      // real dataset case — co-located generators in one building) were
      // silently merged into a single SUM bubble (517 MW combined) on an
      // un-AGGREGATE-flagged page, verified directly via deck.gl's own
      // pickObject against the rendered layer. AGGREGATE now gates the
      // clustering step entirely — without it, every feature already in
      // `_featuresByCategory` (built regardless, see _usesAggregationIndex
      // — _buildChartLayers still needs SOMETHING to read from) becomes
      // its own "individual" item here, bypassing Supercluster completely
      // rather than just usually-resolving-to-1:1 the way it did before.
      if (!this.flags.has('AGGREGATE')) {
        const individual = [];
        this._featuresByCategory.forEach((feats, cat) => {
          feats.forEach(f => {
            const [lng, lat] = f.geometry.coordinates;
            if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) return;
            individual.push({ geometry: f.geometry, properties: { ...f.properties, cat } });
          });
        });
        return { individual, groups: [] };
      }

      // For a fixed-real-world-METERS gridwidth, the grid aggregation and
      // the RELOCATE grouping run at the SAME fixed reference zoom the
      // cell width was converted at (_ensureClusterIndices), so the cells
      // don't change with the map zoom. Rendering (on-screen bubble size)
      // is unaffected — that scales with the always-live `liveZoom`
      // passed through valueRadius(), not this.
      const effectiveZoom = this._clusterUsesFixedZoom ? GRIDWIDTH_METERS_REFERENCE_ZOOM : zoom;

      const individual = [];
      const clusterFeatures = [];
      this._clusterIndices.forEach((index, cat) => {
        index.getClusters(bbox, effectiveZoom).forEach(f => {
          const tagged = { geometry: f.geometry, properties: { ...f.properties, cat } };
          if (f.properties.cluster) clusterFeatures.push(tagged);
          else individual.push(tagged);
        });
      });

      const doRelocate = this.flags.has('RELOCATE');
      // SEQUENCE: flat's AGGREGATE cell is ONE chart with a part per
      // category (RELOCATE only moves it to the records' mean position) —
      // every category of a cell, single records included, in one group
      if (flatFlag(this.flags, 'SEQUENCE') && this.flags.has('CATEGORICAL')) {
        const groups = groupCoLocated(clusterFeatures.concat(individual), effectiveZoom, this._clusterRadiusPx,
          this.categoryLabels ? this.categoryLabels.length : 1, this.flags, !doRelocate);
        return { individual: [], groups };
      }
      // without RELOCATE a cell's item already sits at the cell center
      // (aggregateOnGrid)
      const groups = doRelocate ? this._groupCoLocated(clusterFeatures, effectiveZoom) : clusterFeatures.map(f => {
        return {
          geometry: f.geometry,
          properties: { counts: this._oneHot(f.properties.cat, f.properties.point_count), total: f.properties.value,
            ...(f.properties.classValue !== undefined ? { classTotal: f.properties.classValue } : {}),
            ...(f.properties.titleRaw ? { titleRaw: f.properties.titleRaw } : {}) }
        };
      });
      return { individual, groups };
    }

    // NOOUTLIER / NORMALIZE / range-classed color breaks are PURE DATA
    // operations on the aggregated dataset — they must NOT depend on
    // which slice of the map happens to be panned into view right now.
    // Confirmed as a real, user-facing bug: computing these from the
    // current viewport's own individual/groups (as this engine originally
    // did) meant NORMALIZE's [0,1] scale shifted every time panning or
    // zooming changed which clusters were "in view" — a cluster whose own
    // raw total never changed could get remapped to a completely
    // different normalized fraction from one refresh to the next, purely
    // because some unrelated cluster entered or left the viewport and
    // moved the min/max. Measured live: zooming steadily into Roma's
    // dataset, the SAME nearby cluster's rendered size sawtoothed
    // (5px -> 19px -> 10px -> 32px -> 17px -> 55px -> 25px) instead of
    // growing smoothly — the viewport-dependent NORMALIZE noise was
    // swamping the actual (correctly smooth) zoom-based size term.
    //
    // Fix: compute mean/stddev (NOOUTLIER), min/max (NORMALIZE), and class
    // breaks (range-classed AGGREGATE) from the FULL dataset's aggregation
    // at this zoom (a world-spanning bbox query, same clustering/RELOCATE
    // pipeline as _computeAggregatedItems), cached by zoom so a pure pan
    // never recomputes it — only an actual zoom change (new clustering
    // radius) or a facet-filter change (_buildAggregationIndex nulls this
    // cache) does. _buildChartLayers then applies these DATASET-WIDE
    // numbers to whatever subset is actually in the current viewport,
    // exactly the "pure data operation, independent of the visualization"
    // split real ixmaps' own NORMALIZE (maptheme.js:12764-12780) has:
    // computed once per theme redraw, not per viewport.
    _ensureAggregateStats(zoom) {
      if (this._aggregateStatsCache && this._aggregateStatsCache.zoom === zoom) return this._aggregateStatsCache;

      const WORLD_BBOX = [-180, -85, 180, 85];
      const { individual, groups } = this._computeAggregatedItems(WORLD_BBOX, zoom);
      let totals = individual.map(d => d.properties.value).concat(groups.map(d => d.properties.total));
      const rawSizeTotals = totals;
      // A separate class value (see _buildAggregationIndex) is what flat's
      // NOOUTLIER / NORMALIZE and classes act on (its nValuesA,
      // maptheme.js:12786-12803) — never the size (nSize), which stays raw.
      if (this._rangeClassed && this._classSeparate) {
        totals = individual.map(d => d.properties.classValue).concat(groups.map(d => d.properties.classTotal));
      }

      // NOOUTLIER — flat's rule, see flatOutlierStats
      let outlier = null;
      if (this.flags.has('NOOUTLIER') && totals.length) {
        outlier = flatOutlierStats(totals, styleNum(this.style.outlierscale) || 3);
        const { mean, threshold } = outlier;
        totals = totals.filter(v => Math.abs(v - mean) <= threshold);
      }

      // NORMALIZE — see the block this replaces for the full real-source
      // citation (maptheme.js:12764-12780). Runs on the OUTLIER-survivors,
      // same order as the real source.
      let normalize = null;
      if (this.flags.has('NORMALIZE') && totals.length) {
        let nMin = Infinity, nMax = -Infinity;
        for (const v of totals) { if (v < nMin) nMin = v; if (v > nMax) nMax = v; }
        normalize = { min: nMin, max: nMax };
        const range = nMax - nMin;
        totals = totals.map(v => (range ? (v - nMin) / range : (v ? 1 : 0)));
      }

      // Range-classed AGGREGATE color breaks — see the block this replaces
      // for the full real-source citation. Computed on whatever the
      // rendering step will actually classify (post-NORMALIZE values, if
      // set), same as the real engine's own order of operations.
      let breaks = null;
      // flat takes the class RANGE (nMin/nMax) from the raw sizes when a
      // size field is bound (maptheme.js:11186-11203) and classifies by the
      // value sums anyway; after NORMALIZE the range is 0..1 either way.
      // (Not ported: flat's NORMALIZE of a size-field theme then scales
      // the value sums by that SIZE range.)
      if (this._rangeClassed && totals.length) {
        // _nRangeParts, not categoryLabels.length: that follows partsA,
        // which is a single class at a zoom where all totals are equal
        const nParts = this._nRangeParts || this.categoryLabels.length;
        const rangeSource = this._classSeparate && this.binding.size && !normalize ? rawSizeTotals : totals;
        let nMin = Infinity, nMax = -Infinity;
        for (const v of rangeSource) { if (v < nMin) nMin = v; if (v > nMax) nMax = v; }
        breaks = flatRangeParts(totals, nMin, nMax, nParts, this.flags, styleNum(this.style.rangecentervalue));
      }

      // The theme's own classes follow the aggregated items, as flat's do
      // (its partsA/nMin/nMax are computed over the aggregated itemA): so
      // the legend, tooltips and getThemeObj describe what the map draws,
      // not the raw records. categoryLabels is updated IN PLACE — the
      // native legend holds that array and re-renders it on every redraw.
      if (breaks) {
        this.partsA = breaks;
        const labels = breaks.map(p => `${this._formatTooltipValue(p.min)} - ${this._formatTooltipValue(p.max)}`);
        this.categoryLabels.splice(0, this.categoryLabels.length, ...labels);
        const sorted = totals.slice().sort((a, b) => a - b);
        this._valueMin = sorted[0];
        this._valueMax = sorted[sorted.length - 1];
        this._valueMedian = sorted[Math.floor((sorted.length - 1) / 2)];
      }

      this._aggregateStatsCache = { zoom, outlier, normalize, breaks };
      return this._aggregateStatsCache;
    }

    // liveZoom (defaults to `zoom` for callers that don't distinguish,
    // e.g. tests): used ONLY for objectscaling:"dynamic"'s zoom-factor in
    // the valueRadius() calls below, deliberately kept separate from
    // `zoom` (frozen to the last settled zoom during an active zoom
    // gesture — see buildDeckLayers' caller). Clustering/grid-snap math
    // MUST keep using the frozen `zoom`: reclustering mid-gesture is what
    // overflows deck.gl's icon atlas (see the comment on refreshLayers).
    // But the SIZE a cached icon is drawn at costs nothing to update every
    // frame — _getGlowIcon/_buildBubbleIcon cache by COLOR/proportions
    // only, never by size or zoom, so scaling the same cached icon
    // bigger/smaller as the user actively zooms is exactly what
    // objectscaling:"dynamic" promises (continuous grow-on-zoom-in/
    // shrink-on-zoom-out, not a one-time jump applied only once the
    // gesture ends) and carries none of the reclustering risk.
    _buildChartLayers(zoom, bbox, liveZoom = zoom, globeCenter = null) {
      if (!this._featuresByCategory) return [];
      // Grid indices are only needed by the AGGREGATE path inside
      // _computeAggregatedItems below — a plain (non-AGGREGATE)
      // BUBBLE/CHART theme never reads them.
      if (this.flags.has('AGGREGATE')) this._ensureClusterIndices(zoom);
      let { individual, groups } = this._computeAggregatedItems(bbox, zoom);
      // Far-hemisphere cull under globe projection — see
      // isOnVisibleHemisphere's own comment for why this is needed at
      // all (this layer's depthCompare/cullMode overrides leave nothing
      // else to hide a far-side bubble). Filtered here, before the
      // NOOUTLIER/splice and VALUES-label steps below read individual/
      // groups, so a hidden bubble never gets a label built for it either
      // (NOOUTLIER/NORMALIZE's own stats come from a SEPARATE world-wide
      // _ensureAggregateStats call, unaffected by this viewport-scoped
      // filter either way).
      if (globeCenter) {
        individual = individual.filter(d => isOnVisibleHemisphere(d.geometry.coordinates[0], d.geometry.coordinates[1], globeCenter));
        groups = groups.filter(d => isOnVisibleHemisphere(d.geometry.coordinates[0], d.geometry.coordinates[1], globeCenter));
      }
      const layers = [];

      if (this.flags.has('NOOUTLIER') || this.flags.has('NORMALIZE') || this._rangeClassed) {
        const stats = this._ensureAggregateStats(zoom);

        // the quantity NOOUTLIER/NORMALIZE/classes act on: the separate
        // class value where there is one (sizes then stay raw), else the
        // size total (see _ensureAggregateStats)
        const sep = this._rangeClassed && this._classSeparate;
        const indValue = d => (sep ? d.properties.classValue : d.properties.value);
        const grpValue = d => (sep ? d.properties.classTotal : d.properties.total);

        if (stats.outlier) {
          const { mean, threshold } = stats.outlier;
          for (let i = individual.length - 1; i >= 0; i--) {
            if (Math.abs(indValue(individual[i]) - mean) > threshold) individual.splice(i, 1);
          }
          for (let i = groups.length - 1; i >= 0; i--) {
            if (Math.abs(grpValue(groups[i]) - mean) > threshold) groups.splice(i, 1);
          }
        }

        if (stats.normalize && sep) {
          const { min: nMin, max: nMax } = stats.normalize;
          const range = nMax - nMin;
          const normalize = v => (range ? (v - nMin) / range : (v ? 1 : 0));
          individual.forEach(d => { d.properties.classValue = normalize(d.properties.classValue); });
          groups.forEach(d => { d.properties.classTotal = normalize(d.properties.classTotal); });
        } else if (stats.normalize) {
          const { min: nMin, max: nMax } = stats.normalize;
          const range = nMax - nMin;
          const normalize = v => (range ? (v - nMin) / range : (v ? 1 : 0));
          individual.forEach(d => { d.properties.value = normalize(d.properties.value); });
          groups.forEach(d => {
            d.properties.total = normalize(d.properties.total);
            // per-category sub-bubble breakdown (this engine's OWN multi-
            // category cluster rendering, see the "Known divergence" note
            // in every port using this pipeline) isn't part of the real
            // engine's NORMALIZE at all, but VALUES prints these numbers
            // too — leaving them as raw sums while the outer bubble's own
            // size/label read a [0,1] fraction would show wildly
            // mismatched numbers on the same bubble. Rescaled by the same
            // range (not re-offset by nMin — these are PARTS of a total,
            // not standalone values) for a consistent, readable scale.
            d.properties.counts = d.properties.counts.map(c => (range ? c / range : c));
          });
        }

        if (this._rangeClassed) {
          const nParts = this.categoryLabels.length;
          const classify = v => (stats.breaks ? (this._resolvePartsClass(v, stats.breaks) ?? 0) : 0);
          individual.forEach(d => { d.properties.cat = classify(indValue(d)); });
          // what the legend's per-class numbers read (flat sums the VISIBLE
          // charts' class values per class while drawing, maptheme.js
          // 16633-16683) — set just below, once every item has its class
          this._legendItems = null;
          groups.forEach(d => {
            const cat = classify(grpValue(d));
            const counts = new Array(nParts).fill(0);
            counts[cat] = d.properties.total;
            d.properties.counts = counts;
            d.properties.cat = cat;
          });
          this._legendItems = individual.map(d => ({ cat: d.properties.cat, value: indValue(d) }))
            .concat(groups.map(d => ({ cat: d.properties.cat, value: grpValue(d) })));
        }
      }

      // Draw order: the real engine sorts every BUBBLE/CHART theme's
      // items before drawing BY DEFAULT — fSortBeforeDraw is initialized
      // true unconditionally (maptheme.js:7828), not behind a flag; the
      // pre-draw sort (maptheme.js:16742-16848) only gets SKIPPED for
      // DOT/NOSRT/NOSIZE themes or bare CATEGORICAL without AGGREGATE —
      // none of which apply to this pipeline (DOT dispatches elsewhere
      // entirely, and this engine's CHART/SYMBOL runtimes always carry
      // AGGREGATE). The default comparator (no SORT+UP together) is
      // sortUpChartObjectsCompare — ASCENDING by size (maptheme.js:19104-
      // 19106) — confirmed as ixmaps' own default draw order: BIGGER
      // symbols on top. SVG paints later document-order elements on top,
      // and deck.gl does the same for flat (non-elevated, no depth test)
      // symbols, so sorting the DATA array ascending (smallest first/
      // underneath, biggest last/on top) reproduces the same stacking.
      //
      // Individual points and cluster bubbles used to be two SEPARATE
      // layers (ScatterplotLayer + IconLayer) pushed in a fixed array
      // order, so every cluster bubble drew over every individual point
      // regardless of which was actually bigger. A GPU depth-test fix
      // (elevating each item by a quantized Z-level, tried here and
      // reverted) turned out unusable: confirmed live to create EXACT Z
      // ties between meaningfully different-sized bubbles — only ~16
      // elevation levels fit inside a budget that's simultaneously
      // pan-safe (bigger spans cause visible parallax drift) and
      // depth-buffer-precision-safe (smaller steps collapse), nowhere
      // near enough for the hundreds of distinct sizes one dense viewport
      // can hold. An exact tie's GPU resolution also isn't stable across
      // a live zoom's continuously-changing camera matrix, so ties
      // flickered mid-gesture AND rendered non-deterministically even
      // once settled.
      //
      // Fix: render individual points and cluster bubbles through ONE
      // shared IconLayer (and one shared GLOW IconLayer), combined into a
      // single array and sorted together — the same array-order mechanism
      // already proven reliable for same-type ordering now covers the
      // individual/cluster split too, with no elevation and no ties.
      // Individual points render as a plain flat-circle icon
      // (_buildSingleIcon) instead of a ScatterplotLayer — same look (no
      // stroke, same fill opacity baked into the icon instead of applied
      // as a layer-wide opacity), just an icon so it can share a layer
      // with cluster bubbles. A grouped item is detected by
      // `properties.counts` (present only on groups — same convention
      // _buildTooltipContext's own `isGroup` check already uses).
      const sizeValueOf = d => d.properties.counts ? d.properties.total : d.properties.value;
      const combined = individual.concat(groups).sort((a, b) => sizeValueOf(a) - sizeValueOf(b));
      if (this.flags.has('USER')) {
        const userLayers = this._buildUserChartLayers(combined, liveZoom, sizeValueOf);
        if (userLayers) return layers.concat(userLayers);
      }
      if (this.flags.has('LABEL')) return layers.concat(this._buildLabelChartLayers(combined, zoom, liveZoom, sizeValueOf));
      if (flatFlag(this.flags, 'SEQUENCE') && this.flags.has('CATEGORICAL') && this.flags.has('AGGREGATE')) {
        return layers.concat(this._buildSequenceChartLayers(combined, zoom, liveZoom));
      }
      const fillOpacity = styleNum(this.style.fillopacity) || 0.85;
      // .style({linecolor, linewidth}) — an individual icon's own border,
      // see _buildSingleIcon's own comment. Real ixmaps-flat symbol
      // markers do draw an outline (confirmed by a real ported page
      // explicitly setting both), unlike this port's own pre-existing
      // bubble icons, which never had one — computed once here (a
      // per-theme constant, not per-record) rather than inside the
      // getIcon callback below.
      const singleBorderColorRgb = this.style.linecolor && styleLineColor(this.style.linecolor) !== 'none' ? hexOrNamedToRgb(styleLineColor(this.style.linecolor)) : null;
      const singleBorderWidthPx = styleNum(this.style.linewidth) || 0;

      const itemRgb = d => this.categoryColorsRgb[d.properties.counts ? dominant(d.properties.counts) : d.properties.cat] || [128, 128, 128];
      const radiusOf = d => valueRadius(sizeValueOf(d), liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue);
      // align / offsetx / offsety: the whole chart moves (flatChartAlignOffset)
      // MULTIQUAD / MULTISQUARE: the items at one position side by side
      // (multiQuadOffsets), added to the chart position
      const baseAlign = this._chartAlignFn(liveZoom, radiusOf);
      const multi = flatFlag(this.flags, 'MULTIQUAD') || flatFlag(this.flags, 'MULTISQUARE')
        ? multiQuadOffsets(combined, NORMAL_RADIUS_PX * objectZoomFactor(liveZoom, this.mapOptions) * (styleNum(this.style.scale) || 1),
          styleNum(this.style.rangescale) || 1, styleNum(this.style.gridx) || 0)
        : null;
      const alignOf = multi
        ? Object.assign(d => { const a = baseAlign(d), m = multi.offset.get(d) || [0, 0]; return [a[0] + m[0], a[1] + m[1]]; }, { active: true })
        : baseAlign;

      // SHADOW (style.shadow, flat's gate: maxshadow, shadowupper/lower — flatShadowOn): a soft
      // drop shadow under each symbol, see _getShadowIcon
      if (flatShadowOn(this.style, combined.length, liveZoom)) {
        const blurPx = styleNum(this.style.shadowblur) || 3;
        const num = (v, d) => (isNaN(styleNum(v)) ? d : styleNum(v));
        const dx = num(this.style.shadowdx, 1.5), dy = num(this.style.shadowdy, 2.5);
        layers.push(new IconLayer({
          id: `ix-symbolshadow-${this.name}-g${this._iconGeneration}`,
          data: combined, pickable: false,
          getPosition: d => d.geometry.coordinates,
          getIcon: d => this._getShadowIcon(radiusOf(d), blurPx, d.properties.counts ? 'circle' : this._resolveSymbolShape(d.properties)),
          getSize: d => radiusOf(d) * 3, // disc = 2/3 of the icon → its diameter is 2r
          getPixelOffset: alignOf.active ? d => { const o = alignOf(d); return [o[0] + dx, o[1] + dy]; } : [dx, dy],
          getColor: d => {
            const rgb = itemRgb(d);
            const gray = Math.round(Math.min(255, 0.1 * (rgb[0] + rgb[1] + rgb[2])));
            return [gray, gray, gray, Math.round(this._iconAlpha(d) * fillOpacity)];
          },
          sizeUnits: 'pixels',
          billboard: true,
          parameters: ICON_LAYER_GLOBE_PARAMETERS,
          updateTriggers: { getIcon: [liveZoom, blurPx], getSize: liveZoom }
        }));
      }

      // GLOW: gradient-texture halo (see _getGlowIcon for why this diverges
      // from the real engine's literal flat-circle formula). Individual
      // and cluster glows keep their own size multiplier (11 vs 9 — a lone
      // point and a packed cluster read differently at the same radius)
      // but share one sorted layer, same as the main bubbles below.
      if (this.flags.has('GLOW') && !glowHiddenByScale(this.style, liveZoom)) {
        layers.push(new IconLayer({
          id: `ix-glow-${this.name}-g${this._iconGeneration}`,
          data: combined, pickable: false,
          getPosition: d => d.geometry.coordinates,
          getIcon: d => this._getGlowIcon(this.categoryColorsRgb[d.properties.counts ? dominant(this._groupIsolation(d) ? d.properties.counts.map((c, i) => (this._markedClasses.has(i) ? c : 0)) : d.properties.counts) : d.properties.cat]),
          getSize: d => valueRadius(sizeValueOf(d), liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue) * (d.properties.counts ? 9 : 11),
          getColor: d => [255, 255, 255, this._iconAlpha(d)],
          ...(alignOf.active ? { getPixelOffset: alignOf } : {}),
          sizeUnits: 'pixels',
          billboard: true,
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      } else if (this.flags.has('AURA') && !this.flags.has('ZOOM')) {
        // AURA (flat maptheme.js 20924-20930, the GLOW branch's `else`): a circle at 1.3 × the
        // radius behind the symbol, in the line color (else the symbol's), at 0.3 opacity
        layers.push(new IconLayer({
          id: `ix-aura-${this.name}-g${this._iconGeneration}`,
          data: combined, pickable: false,
          getPosition: d => d.geometry.coordinates,
          getIcon: d => this._buildSingleIcon(singleBorderColorRgb || itemRgb(d), 0.3, 'circle', null, 0),
          getSize: d => radiusOf(d) * 2 * 1.3,
          getColor: d => [255, 255, 255, this._iconAlpha(d)],
          ...(alignOf.active ? { getPixelOffset: alignOf } : {}),
          sizeUnits: 'pixels',
          billboard: true,
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      }

      // BOX / CIRCULARBOX with TITLE / BOTTOMTITLE — flat's BOX block
      // (maptheme.js 18446-18481, 18756-18925), measured on flat's SVG.
      // u = flat's normalX(1) on screen (its nDynamicObjectScale, the object
      // zoom factor here), r = the chart (bubble) radius, the normal chart
      // is 30u wide. Margin: min(2m, m·2r/30u), m = boxmargin (2) · u.
      //  - CIRCULARBOX: a circle of radius 1.1·r + margin, boxcolor
      //    (#eeeeee) at boxopacity, stroke #dddddd one SVG unit (u/20);
      //    title centered at x + u/2, wrapped to the circle's width.
      //  - BOX: a rectangle around the chart AND its title (its top
      //    trimmed by 0.1 font when titled), plus the margin, boxcolor (white) at
      //    boxopacity, stroke bordercolor (#bbbbbb) at 0.3 opacity
      //    (borderstyle solid/dotted/dashed: opaque, none: no stroke),
      //    borderwidth (1) · 0.2 · 2r/30 wide, corners borderradius ·
      //    min(u, 2r/30); title left-aligned at the chart's left edge
      //    (align "right": right edge), wrapped to the chart's width.
      // Title: the item's title field (a grid cell merging more than 3
      // items: "(n)", maptheme.js 11883), font 5u·textscale in textcolor
      // (#888888) over a half-opaque white halo (stroke font/7); its first
      // baseline one font below the box (BOTTOMTITLE) or 0.7 font above it.
      // Box and title are removed outside boxupper/boxlower.
      // Flat draws box and title in the chart group, which is scaled by
      // style.scale: the units below are u · scale. Its size measure W is
      // the chart's width (2r; with MULTIQUAD the width of the whole grid
      // at the position, the box enclosing all of it); flat's chart size
      // is 30 units.
      const boxShown = flatFlag(this.flags, 'BOX') && !boxHiddenByScale(this.style, liveZoom);
      const circular = flatFlag(this.flags, 'CIRCULAR');
      const unitPx = objectZoomFactor(liveZoom, this.mapOptions) * (styleNum(this.style.scale) || 1);
      const boxMarginU = styleNum(this.style.boxmargin) || 2;
      const titleShown = boxShown && flatFlag(this.flags, 'TITLE') && !!this.binding.title;
      const titleFontPx = 5 * unitPx * (styleNum(this.style.textscale) || styleNum(this.style.valuescale) || 1);
      // flat: fill-opacity (boxopacity || 1) on the raw style value — the
      // usual string "0" is transparent; typed here, a given 0 is too
      const boxOpacity = isNaN(styleNum(this.style.boxopacity)) ? 1 : styleNum(this.style.boxopacity);
      const bottomTitle = flatFlag(this.flags, 'BOTTOMTITLE');
      const alignRight = /right/.test(String(this.style.align || ''));
      // with MULTIQUAD only the first item of a position gets its box/title
      const boxLayout = boxShown ? combined.filter(d => !multi || multi.index.get(d) === 0).map(d => {
        const r = valueRadius(sizeValueOf(d), liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue);
        const ext = multi ? multi.extent.get(d) : [0, 0, 0, 0];
        const chart = [ext[0] - r, ext[1] - r, ext[2] + r, ext[3] + r];
        const w = chart[2] - chart[0];
        const margin = Math.min(2 * boxMarginU * unitPx, boxMarginU * w / 30);
        const boxR = circular ? r * 1.1 + margin : r;
        let title = null;
        if (titleShown) {
          const text = this._itemTitle(d.properties);
          if (text) {
            const f = titleFontPx;
            const lines = wrapTitleLines(text, f, circular ? boxR * 2 : w).split('\n');
            const width = Math.max(...lines.map(l => titleTextWidth(l, f)));
            // first baseline; lines go down one font each
            const base = circular
              ? (bottomTitle ? boxR + f : -boxR - 0.7 * f - (lines.length - 1) * f)
              : (bottomTitle ? chart[3] + f : chart[1] - 0.7 * f - (lines.length - 1) * f);
            const x = circular ? unitPx / 2 : (alignRight ? chart[2] : chart[0]);
            const anchor = circular ? 'middle' : (alignRight ? 'end' : 'start');
            const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
            // arial: ascent 0.905, descent 0.212 of the font size
            title = { text: lines.join('\n'), x, anchor, top: base - 0.8 * f,
              extent: [x0, base - 0.905 * f, x0 + width, base + (lines.length - 1) * f + 0.212 * f] };
          }
        }
        let rect = null;
        if (!circular) {
          const e = chart.slice();
          // with a title flat trims 0.1 font off the top of chart + title
          if (title) { e[0] = Math.min(e[0], title.extent[0]); e[1] = Math.min(e[1], title.extent[1]) + 0.1 * titleFontPx; e[2] = Math.max(e[2], title.extent[2]); e[3] = Math.max(e[3], title.extent[3]); }
          rect = [e[0] - margin, e[1] - margin, e[2] + margin, e[3] + margin];
        }
        return { d, r, w, boxR, rect, title };
      }) : null;
      if (boxShown && circular) {
        const boxRgb = hexOrNamedToRgb(this.style.boxcolor || '#eeeeee');
        const boxAlpha = Math.round(255 * boxOpacity);
        const borderRgb = hexOrNamedToRgb(this.style.bordercolor || '#dddddd');
        // ScatterplotLayer has no pixel offset: a moved chart (align,
        // offsetx/offsety) gets its circle as an icon
        if (alignOf.active) layers.push(new IconLayer({
          id: `ix-box-${this.name}-g${this._iconGeneration}`,
          data: boxLayout, pickable: false,
          getPosition: b => b.d.geometry.coordinates,
          getIcon: b => this._buildSingleIcon(boxRgb, boxAlpha / 255, 'circle', borderRgb,
            Math.round(unitPx / 20 * BUBBLE_ICON_SIZE / Math.max(1, 2 * b.boxR) * 4) / 4),
          getSize: b => b.boxR * 2,
          getPixelOffset: b => alignOf(b.d),
          sizeUnits: 'pixels',
          billboard: true,
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
        else layers.push(new ScatterplotLayer({
          id: `ix-box-${this.name}`,
          data: boxLayout, pickable: false,
          getPosition: b => b.d.geometry.coordinates,
          getRadius: b => b.boxR,
          radiusUnits: 'pixels',
          stroked: true,
          getFillColor: [...boxRgb.slice(0, 3), boxAlpha],
          getLineColor: [...borderRgb.slice(0, 3), 255],
          getLineWidth: unitPx / 20,
          lineWidthUnits: 'pixels',
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      } else if (boxShown) {
        const borderStyle = String(this.style.borderstyle || '');
        const boxLook = {
          fill: this.style.boxcolor || 'white',
          fillOpacity: boxOpacity,
          stroke: borderStyle === 'none' ? null : styleLineColor(this.style.bordercolor) || '#bbbbbb',
          strokeOpacity: /^(solid|dotted|dashed)$/.test(borderStyle) ? 1 : 0.3,
        };
        const borderWidth = styleNum(this.style.borderwidth) || 1;
        const borderRadius = styleNum(this.style.borderradius);
        const strokeOf = b => borderWidth * 0.2 * b.w / 30;
        // a box larger than BOX_ICON_MAX_PX (a MULTIQUAD grid of thousands
        // of items) would need a huge canvas: it is drawn as a polygon in
        // map coordinates instead (square corners)
        const bigBox = b => Math.max(b.rect[2] - b.rect[0], b.rect[3] - b.rect[1]) > BOX_ICON_MAX_PX;
        const iconBoxes = boxLayout.filter(b => !bigBox(b)), polygonBoxes = boxLayout.filter(bigBox);
        iconBoxes.forEach(b => {
          b.icon = this._buildBoxIcon(b.rect[2] - b.rect[0], b.rect[3] - b.rect[1],
            isNaN(borderRadius) ? 0 : borderRadius * Math.min(unitPx, b.w / 30),
            strokeOf(b), boxLook);
        });
        if (polygonBoxes.length) {
          const fillRgb = hexOrNamedToRgb(boxLook.fill);
          const strokeRgb = boxLook.stroke ? hexOrNamedToRgb(boxLook.stroke) : null;
          layers.push(new GeoJsonLayer({
            id: `ix-box-polygons-${this.name}`,
            data: polygonBoxes.map(b => {
              const o = alignOf(b.d), c = b.d.geometry.coordinates, r = b.rect;
              const at = (x, y) => pixelOffsetLngLat(c, [x + o[0], y + o[1]], liveZoom);
              return { type: 'Feature', properties: { stroke: strokeOf(b) },
                geometry: { type: 'Polygon', coordinates: [[at(r[0], r[1]), at(r[2], r[1]), at(r[2], r[3]), at(r[0], r[3]), at(r[0], r[1])]] } };
            }),
            pickable: false,
            filled: boxLook.fillOpacity > 0,
            stroked: !!strokeRgb,
            getFillColor: [...fillRgb.slice(0, 3), Math.round(255 * boxLook.fillOpacity)],
            getLineColor: strokeRgb ? [...strokeRgb.slice(0, 3), Math.round(255 * boxLook.strokeOpacity)] : [0, 0, 0, 0],
            getLineWidth: f => f.properties.stroke,
            lineWidthUnits: 'pixels',
            parameters: ICON_LAYER_GLOBE_PARAMETERS
          }));
        }
        if (iconBoxes.length) layers.push(new IconLayer({
          id: `ix-box-${this.name}-g${this._iconGeneration}`,
          data: iconBoxes, pickable: false,
          getPosition: b => b.d.geometry.coordinates,
          getIcon: b => b.icon,
          // the icon is drawn at 2× with a stroke padding around the box
          getSize: b => b.icon.height / 2,
          getPixelOffset: b => { const o = alignOf(b.d); return [(b.rect[0] + b.rect[2]) / 2 + o[0], (b.rect[1] + b.rect[3]) / 2 + o[1]]; },
          sizeUnits: 'pixels',
          billboard: true,
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      }

      layers.push(new IconLayer({
        id: `ix-bubbles-${this.name}-g${this._iconGeneration}`,
        data: combined, pickable: true,
        getPosition: d => d.geometry.coordinates,
        getIcon: d => d.properties.counts
          ? this._buildBubbleIcon(d.properties.counts, this.categoryColorsRgb, this._groupIsolation(d))
          : this._buildSingleIcon(this.categoryColorsRgb[d.properties.cat], fillOpacity, this._resolveSymbolShape(d.properties), singleBorderColorRgb, singleBorderWidthPx),
        getSize: d => valueRadius(sizeValueOf(d), liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue) * 2,
        getColor: d => [255, 255, 255, this._iconAlpha(d)],
        ...(alignOf.active ? { getPixelOffset: alignOf } : {}),
        sizeUnits: 'pixels',
        billboard: true,
        parameters: ICON_LAYER_GLOBE_PARAMETERS
      }));

      const titleData = boxLayout ? boxLayout.filter(b => b.title) : [];
      if (titleData.length) {
        layers.push(new TextLayer({
          id: `ix-titles-${this.name}`,
          data: titleData, pickable: false,
          getPosition: b => b.d.geometry.coordinates,
          getText: b => b.title.text,
          getSize: titleFontPx,
          sizeUnits: 'pixels',
          fontFamily: 'arial',
          characterSet: 'auto',
          lineHeight: 1,
          getColor: [...hexOrNamedToRgb(this.style.textcolor || '#888888').slice(0, 3), 255],
          fontSettings: { sdf: true },
          outlineWidth: 1 / 7,
          outlineColor: [255, 255, 255, 128],
          getTextAnchor: b => b.title.anchor,
          // top of the text ≈ first baseline − 0.8 font
          getAlignmentBaseline: 'top',
          getPixelOffset: b => { const o = alignOf(b.d); return [b.title.x + o[0], b.title.top + o[1]]; },
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      }

      // VALUES: bold value label centered on each bubble (see
      // flatValueText/valuesFontSizePx above). Labels are their own
      // layers, added last in the array so they draw on top of every icon
      // layer (a small bubble's label can still show over a bigger
      // neighboring bubble's icon — a known, accepted gap). Entries whose
      // computed font size would be sub-pixel are dropped rather than
      // rendered at getSize: 0, matching the real engine's own "too
      // small to bother" gate.
      if (this.flags.has('VALUES') && !valuesHiddenByScale(this.style, zoom)) {
        const valueScale = styleNum(this.style.valuescale) || 1;
        const textOpts = this._valueTextOpts();

        const pointLabels = individual.reduce((out, d) => {
          const radius = valueRadius(d.properties.value, liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue);
          // flat's VALUES label prints the value (nValuesA), not the size
          const text = flatValueText(d.properties.raw, this.binding.title && d.properties.raw ? d.properties.raw[this.binding.title] : undefined,
            d.properties.classValue !== undefined ? d.properties.classValue : d.properties.value, this.style, this.flags, textOpts);
          const fontSize = valuesFontSizePx(radius, text, valueScale);
          if (fontSize > VALUES_MIN_FONT_PX) {
            out.push({ geometry: d.geometry, text, fontSize, color: resolveTextColor(this.style, contrastTextColor(this.categoryColorsRgb[d.properties.cat])), pixelOffset: alignOf(d) });
          }
          return out;
        }, []);

        // Groups (multi-category co-located clusters, see _groupCoLocated
        // and _buildBubbleIcon) draw as several packed sub-bubbles, one per
        // present category — the VALUES label follows that: one label per
        // sub-bubble, each showing THAT category's own aggregated value
        // (counts[i]), positioned via getPixelOffset at that sub-bubble's
        // own on-screen spot (computeBubblePackLayout, shared with the icon
        // raster so the label always lines up with its bubble). Deliberately
        // NOT one combined label showing the cross-category total — that
        // would misrepresent every category's own count as one summed
        // number nobody's individual bubble actually shows.
        const groupLabels = groups.reduce((out, d) => {
          const counts = d.properties.counts;
          const outerRadiusPx = valueRadius(d.properties.total, liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue);
          const iconSizePx = outerRadiusPx * 2; // matches the cluster IconLayer's own getSize (*2) below
          const pxPerCanvasUnit = iconSizePx / BUBBLE_ICON_SIZE;
          const iso = this._groupIsolation(d);
          const { present, radii, offsets, fitScale } = (iso && isolatedBubblePackLayout(counts, BUBBLE_ICON_SIZE, iso)) || computeBubblePackLayout(counts, BUBBLE_ICON_SIZE);

          present.forEach((p, i) => {
            // one part for a range-classed cell: its class value, if separate
            const text = flatValueText(this._categoryValueRecord(p.i), null, d.properties.classTotal !== undefined && present.length === 1 ? d.properties.classTotal : p.c, this.style, this.flags, textOpts);
            const subRadiusPx = radii[i] * fitScale * pxPerCanvasUnit;
            const fontSize = valuesFontSizePx(subRadiusPx, text, valueScale);
            if (fontSize > VALUES_MIN_FONT_PX) {
              out.push({
                geometry: d.geometry, text, fontSize,
                color: resolveTextColor(this.style, contrastTextColor(this.categoryColorsRgb[p.i])),
                pixelOffset: [offsets[i].x * fitScale * pxPerCanvasUnit + alignOf(d)[0], offsets[i].y * fitScale * pxPerCanvasUnit + alignOf(d)[1]]
              });
            }
          });
          return out;
        }, []);

        const textLayerCommonProps = {
          pickable: false,
          getPosition: d => d.geometry.coordinates,
          getText: d => d.text,
          getSize: d => d.fontSize,
          getColor: d => d.color,
          sizeUnits: 'pixels',
          fontFamily: 'arial',
          fontWeight: 'bold',
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center'
        };
        if (pointLabels.length) layers.push(new TextLayer({ id: `ix-points-values-${this.name}`, data: pointLabels, ...(alignOf.active ? { getPixelOffset: d => d.pixelOffset } : {}), ...textLayerCommonProps }));
        if (groupLabels.length) layers.push(new TextLayer({ id: `ix-cluster-values-${this.name}`, data: groupLabels, getPixelOffset: d => d.pixelOffset, ...textLayerCommonProps }));
      }

      return layers;
    }

    // flat's nAllMaxValue for a SEQUENCE chart (maptheme.js 13211-13215):
    // the biggest category part of any chart at this aggregation — over
    // the whole dataset, not the view; cached per zoom
    _sequenceMaxValue(zoom) {
      if (this._seqMaxFor !== this._clusterIndices) { this._seqMaxFor = this._clusterIndices; this._seqMax = new Map(); }
      if (!this._seqMax.has(zoom)) {
        const { groups } = this._computeAggregatedItems([-180, -90, 180, 90], zoom);
        let max = 0;
        groups.forEach(g => g.properties.counts.forEach(c => { if (c > max) max = c; }));
        this._seqMax.set(zoom, max || 1);
      }
      return this._seqMax.get(zoom);
    }

    // CHART|SYMBOL|SEQUENCE on an AGGREGATE CATEGORICAL theme: each cell is
    // one chart of a symbol per category part (sequenceLayout), as flat's
    // SYMBOL branch draws it (maptheme.js 21122-22400):
    //  - part radius: max radius · (v / max value)^(1/sizepow), max value =
    //    normalsizevalue, else the biggest part of any chart (21793)
    //  - circle in the category color at fillopacity, stroked in linecolor
    //    linewidth · unit · min(2r / max radius, 0.2) wide (21966)
    //  - GLOW (and AURA): with SORT only around the first part, else around
    //    every part (22009)
    //  - marked legend classes: the other parts hidden, the marked ones
    //    back on the center (14339-14420, evidence "isolate"); with
    //    "isolate_gray" the others dimmed
    //  - STAR: the center part drawn last, on top of its satellites (23145)
    //  - VALUES: each part's value (COUNT: its records; valuefield: the class name)
    //  - align / offsets as the SYMBOL branch: half size the normal radius
    // A part's pick object carries its chart's properties (tooltip).
    _buildSequenceChartLayers(charts, zoom, liveZoom) {
      const st = this.style;
      const seqMax = this._sequenceMaxValue(zoom);
      const partRadius = v => valueRadius(v, liveZoom, st, this.mapOptions, this.flags, seqMax);
      const unit = objectZoomFactor(liveZoom, this.mapOptions) * (styleNum(st.scale) || 1);
      const normalR = NORMAL_RADIUS_PX * unit;
      const nCats = this.categoryLabels ? this.categoryLabels.length : 1;
      const marking = this._markedClasses.size && !this._onMarksChanged;
      const gray = marking && String(st.evidence || 'isolate') === 'isolate_gray';
      const sorted = [...this.flags].some(f => /\bSORT\b/.test(f));
      const fillOpacity = styleNum(st.fillopacity) || 0.85;
      const borderRgb = st.linecolor && styleLineColor(st.linecolor) !== 'none' ? hexOrNamedToRgb(styleLineColor(st.linecolor)) : null;
      const lineWidth = styleNum(st.linewidth) || 1;
      const symbols = Array.isArray(st.symbols) ? st.symbols : null;
      const shapeOf = i => { const sh = symbols && (symbols[i] || symbols[0]); return /^(circle|square|diamond|triangle)$/.test(sh) ? sh : 'circle'; };
      const colorOf = i => this.categoryColorsRgb[i] || [128, 128, 128];
      const parts = [], glows = [];
      for (const d of charts) {
        let layout = sequenceLayout(d.properties.counts, this.flags, partRadius, { maxRadius: normalR, maxValue: seqMax, nParts: nCats, rangeScale: styleNum(st.rangescale) || 0 });
        if (!layout.length) continue;
        // GLOW belongs to the first part (sorted) or to every part, and
        // hides with it when its class is not marked
        const glowParts = new Set(sorted ? [layout[0].i] : layout.map(p => p.i));
        if (marking && !gray) {
          layout = layout.filter(p => this._markedClasses.has(p.i)).map(p => ({ ...p, x: 0, y: 0 }));
          if (!layout.length) continue;
        }
        // the chart's own ptNull.y: the last part's radius + 5 units (23204)
        d._seqLast = layout[layout.length - 1].r;
        const items = layout.map(p => {
          const item = { geometry: d.geometry, properties: d.properties, chart: d, part: p };
          if (glowParts.has(p.i)) glows.push(item);
          return item;
        });
        // STAR: the first part (its center) is put on top at the end (23145)
        if (flatFlag(this.flags, 'STAR') && items.length > 1) items.push(items.shift());
        parts.push(...items);
      }
      const alignOf = this._chartAlignFn(liveZoom, d => (d.chart || d)._seqLast || 0);
      const offsetOf = item => { const o = alignOf(item.chart); return [o[0] + item.part.x, o[1] + item.part.y]; };
      const alphaOf = item => (gray && !this._markedClasses.has(item.part.i) ? DIMMED_ICON_ALPHA : 255);
      const layers = [];
      if (glows.length && this.flags.has('GLOW') && !glowHiddenByScale(st, liveZoom)) {
        layers.push(new IconLayer({
          id: `ix-glow-${this.name}-g${this._iconGeneration}`,
          data: glows, pickable: false,
          getPosition: d => d.geometry.coordinates,
          getIcon: d => this._getGlowIcon(colorOf(d.part.i)),
          getSize: d => d.part.r * 11,
          getPixelOffset: offsetOf,
          getColor: d => [255, 255, 255, alphaOf(d)],
          sizeUnits: 'pixels', billboard: true,
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      } else if (glows.length && this.flags.has('AURA') && !glowHiddenByScale(st, liveZoom)) {
        layers.push(new IconLayer({
          id: `ix-aura-${this.name}-g${this._iconGeneration}`,
          data: glows, pickable: false,
          getPosition: d => d.geometry.coordinates,
          getIcon: d => this._buildSingleIcon(borderRgb || colorOf(d.part.i), 0.3, 'circle', null, 0),
          getSize: d => d.part.r * 2 * 1.3,
          getPixelOffset: offsetOf,
          getColor: d => [255, 255, 255, alphaOf(d)],
          sizeUnits: 'pixels', billboard: true,
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      }
      layers.push(new IconLayer({
        id: `ix-bubbles-${this.name}-g${this._iconGeneration}`,
        data: parts, pickable: true,
        getPosition: d => d.geometry.coordinates,
        // the stroke, in the icon raster's pixels (the icon is drawn at 2r)
        getIcon: d => this._buildSingleIcon(colorOf(d.part.i), fillOpacity, shapeOf(d.part.i), borderRgb,
          borderRgb ? Math.round(lineWidth * unit * Math.min(2 * d.part.r / normalR, 0.2) * BUBBLE_ICON_SIZE / Math.max(1, 2 * d.part.r) * 4) / 4 : 0),
        getSize: d => d.part.r * 2,
        getPixelOffset: offsetOf,
        getColor: d => [255, 255, 255, alphaOf(d)],
        sizeUnits: 'pixels', billboard: true,
        parameters: ICON_LAYER_GLOBE_PARAMETERS
      }));
      // VALUES on each part (maptheme.js 22188-22250): the part's value — with
      // COUNT its record count, with valuefield on the categorical field the
      // class name — formatted with valuedecimals (else none) plus the unit;
      // font min(1, 3.2 / L) · r · valuescale, L the length of the theme's
      // biggest value text (szMaxText), normal weight, in valuecolor /
      // textcolor, else ChartColors.textColor of the part color
      if (this.flags.has('VALUES') && !valuesHiddenByScale(st, zoom)) {
        const valueScale = styleNum(st.valuescale) || 1;
        const { noBreaks } = this._valueTextOpts();
        const units = st.units ? String(st.units) : '';
        const unit = units ? (units[0] === '.' ? '' : ' ') + units : '';
        const unitText = unit.length <= 5 ? unit : '';
        const dec = styleNum(st.valuedecimals) || 0;
        const fmt = v => flatGroupedValue(v, dec, noBreaks) + unitText;
        const maxLen = fmt(seqMax).length;
        const textOverride = st.valuecolor || st.textcolor;
        const counting = flatFlag(this.flags, 'COUNT');
        const labels = [];
        parts.forEach(d => {
          const rec = this._categoryValueRecord(d.part.i);
          const name = rec ? String(rec[st.valuefield]) : null;
          const t = counting && d.properties.recordCounts ? d.properties.recordCounts[d.part.i] : d.part.v;
          const text = name != null ? name : fmt(t);
          const L = Math.max((name != null ? name.length : 0) + 1, maxLen);
          const fontSize = Math.min(1, 3.2 / L) * d.part.r * valueScale;
          if (fontSize > VALUES_MIN_FONT_PX) {
            labels.push({ geometry: d.geometry, text, fontSize, pixelOffset: offsetOf(d), alpha: alphaOf(d),
              color: textOverride ? hexOrNamedToRgb(textOverride) : flatChartTextRgb(colorOf(d.part.i)) });
          }
        });
        if (labels.length) {
          layers.push(new TextLayer({
            id: `ix-cluster-values-${this.name}`,
            data: labels, pickable: false,
            getPosition: d => d.geometry.coordinates,
            getText: d => d.text,
            getSize: d => d.fontSize,
            getColor: d => [...d.color.slice(0, 3), d.alpha],
            getPixelOffset: d => d.pixelOffset,
            sizeUnits: 'pixels', fontFamily: 'arial', fontWeight: 'normal',
            characterSet: 'auto',
            getTextAnchor: 'middle', getAlignmentBaseline: 'center'
          }));
        }
      }
      return layers;
    }

    // flat's chart position for this build (flatChartAlignOffset): a
    // function item → pixel offset, the same for every part of one chart
    // (symbol, glow, shadow, box, title, value text). unit is flat's
    // normalX(1) on screen, the object zoom × style.scale.
    _chartAlignFn(liveZoom, radiusOf, textOnly = false) {
      const st = this.style;
      const none = () => [0, 0];
      none.active = false;
      if (!st.align && !styleNum(st.offsetx) && !styleNum(st.offsety)) return none;
      const unit = objectZoomFactor(liveZoom, this.mapOptions) * (styleNum(st.scale) || 1);
      const symbol = flatChartBranch(this.flags) === 'symbol';
      const normalR = NORMAL_RADIUS_PX * unit; // flat's normalX(chart size / 2)
      const cache = new Map();
      const fn = d => {
        let v = cache.get(d);
        if (v) return v;
        const r = radiusOf(d);
        v = flatChartAlignOffset(st, { unit, symbolScale: symbol ? r / (2 * normalR) : 1, half: symbol ? normalR : r, orig: r + (textOnly ? 0 : 5 * unit) });
        cache.set(d, v);
        return v;
      };
      fn.active = true;
      return fn;
    }

    // the record an aggregated part of category i stands for in its value
    // text: with style.valuefield the theme's categorical field, flat prints
    // the class name (the records' own valuefield value) — otherwise none
    _categoryValueRecord(i) { return categoryValueRecord(this.style, this.binding, this.flags, this.categoryLabels, i); }

    // value-text options (flatValueText): flat's formatValue NOBREAKS for a
    // theme of values within 1000-3000, the max value for the decimals
    _valueTextOpts() {
      // the range stats (_valueMin/_valueMax, per zoom for AGGREGATE) when
      // there are any, else the value field's range over the data (cached)
      let vMin = this._valueMin, vMax = this._valueMax;
      if (vMin === undefined) {
        if (this._valueTextRangeFor !== this.features) {
          let lo = Infinity, hi = -Infinity;
          const field = this.binding.value;
          for (const f of this.features || []) {
            const v = field === '$item$' ? 1 : parseFloat(f.properties && f.properties[field]);
            if (isNaN(v)) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          this._valueTextRangeFor = this.features;
          this._valueTextRange = [lo, hi];
        }
        [vMin, vMax] = this._valueTextRange;
      }
      return { noBreaks: flatNoBreaks(vMin, vMax), maxValue: styleNum(this.style.normalsizevalue) || (isFinite(vMax) ? vMax : undefined) };
    }

    // CHART|LABEL (maptheme.js 20647-21037), at the chart radius r of the
    // size value:
    //  - LABEL: a rounded rectangle 2.05r wide and 1.6·f high (f = min(0.8r,
    //    3.4r / the value's text length)) from −r and −0.83f, corners 2r/15
    //    (normalX(2r / normal radius)), in the item color at fillopacity
    //    (default 1), stroked in linecolor or the color × 0.7 (NOLINES: none)
    //    linewidth (0.1) · unit · √(r / normal radius) wide (OUTLINE:
    //    unit · min(1, r / normal radius)), opaque with OUTLINE or a
    //    linecolor, else 1 below fillopacity 0.5, 0.3 above; with VALUES the
    //    text in bold, min(0.8r, 3.3r / its length) · valuescale, in
    //    valuecolor / textcolor, else ChartColors.textColor of a class
    //    color (white for a single-color theme). Flat's drop shadow rects
    //    (20950) never draw: they need fOrigShadow without fShadow, which
    //    the shadow gate (16740-16745) leaves equal.
    //  - LABEL|TEXTONLY: no box, only an invisible hit rect (the
    //    hover/tooltip target) and, with VALUES, the text at r·0.8·valuescale
    //    in normal weight, valuecolor/textcolor (else black), over a halo in
    //    the item color (stroke font/7, opacity 0.5).
    // Both moved by the chart position (flatChartAlignOffset). The text is
    // the hover target of TEXTONLY, the box of LABEL.
    _buildLabelChartLayers(combined, zoom, liveZoom, sizeValueOf) {
      const textOnly = this.flags.has('TEXTONLY');
      const showValues = this.flags.has('VALUES') && !valuesHiddenByScale(this.style, zoom);
      if (textOnly && !showValues) return [];
      const radiusOf = d => valueRadius(sizeValueOf(d), liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue);
      const alignOf = this._chartAlignFn(liveZoom, radiusOf, textOnly);
      const valueScale = styleNum(this.style.valuescale) || 1;
      const textOverride = this.style.valuecolor || this.style.textcolor;
      const opts = this._valueTextOpts();
      const itemRgb = props => this.categoryColorsRgb[props.counts ? dominant(props.counts) : props.cat] || [128, 128, 128];
      const valueOf = props => (props.counts ? props.total : (props.classValue !== undefined ? props.classValue : props.value));
      const textOf = props => flatValueText(props.counts ? this._categoryValueRecord(dominant(props.counts)) : props.raw,
        this.binding.title && props.raw ? props.raw[this.binding.title] : undefined, valueOf(props), this.style, this.flags, opts);

      if (textOnly) {
        const textRgb = textOverride ? hexOrNamedToRgb(textOverride) : [0, 0, 0];
        const labels = [];
        for (const d of combined) {
          const r = radiusOf(d);
          const fontSize = r * 0.8 * valueScale;
          if (!(fontSize > 0)) continue;
          labels.push({ ...d, text: textOf(d.properties), fontSize, halo: itemRgb(d.properties), pixelOffset: alignOf(d) });
        }
        // TextLayer's outlineColor is one per layer: a layer per halo color
        const byHalo = new Map();
        for (const l of labels) {
          const key = l.halo.slice(0, 3).join(',');
          if (!byHalo.has(key)) byHalo.set(key, []);
          byHalo.get(key).push(l);
        }
        return [...byHalo.values()].map((data, i) => new TextLayer({
          // the ix-bubbles- id (generation-like suffix) routes hover/click to this theme
          id: `ix-bubbles-${this.name}-g${i}`,
          data, pickable: true,
          getPosition: d => d.geometry.coordinates,
          getText: d => d.text,
          getSize: d => d.fontSize,
          getColor: d => [...textRgb.slice(0, 3), this._iconAlpha(d)],
          getPixelOffset: d => d.pixelOffset,
          sizeUnits: 'pixels',
          fontFamily: 'arial',
          fontWeight: 'normal',
          characterSet: 'auto',
          fontSettings: { sdf: true },
          outlineWidth: 1 / 7,
          outlineColor: [...data[0].halo.slice(0, 3), 128],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      }

      const unit = objectZoomFactor(liveZoom, this.mapOptions) * (styleNum(this.style.scale) || 1);
      const normalR = NORMAL_RADIUS_PX * unit;
      const fillOpacity = styleNum(this.style.fillopacity) || 1;
      const lineWidth = styleNum(this.style.linewidth) || 0.1;
      const outline = flatFlag(this.flags, 'OUTLINE');
      const lineColor = this.style.linecolor && styleLineColor(this.style.linecolor) !== 'none' ? styleLineColor(this.style.linecolor) : null;
      const noLines = flatFlag(this.flags, 'NOLINES');
      const strokeOpacity = outline || lineColor ? 1 : (fillOpacity < 0.5 ? 1 : 0.3);
      const multiColor = (this.categoryColorsRgb || []).length > 1;
      const css = rgb => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      // the box is sized by the value's own text, not the valuefield's
      const boxStyle = Object.assign({}, this.style, { valuefield: undefined });
      const boxes = [], texts = [];
      for (const d of combined) {
        const r = radiusOf(d);
        if (!(r > 0)) continue;
        const props = d.properties;
        const rgb = itemRgb(props);
        const boxText = flatValueText(null, null, valueOf(props), boxStyle, this.flags, opts);
        const f = Math.min(r * 0.8, r * 3.4 / Math.max(1, boxText.length));
        const ratio = r / normalR;
        const icon = this._buildBoxIcon(2.05 * r, 1.6 * f, 2 * r / 15,
          outline ? unit * Math.min(1, ratio) : unit * lineWidth * Math.sqrt(ratio),
          { fill: css(rgb), fillOpacity, stroke: noLines ? null : (lineColor || css(flatDerivateRgb(rgb, 0.7))), strokeOpacity });
        const o = alignOf(d);
        // the box's center relative to the chart's: x from −r to 1.05r, y from −0.83f to 0.77f
        boxes.push({ ...d, icon, pixelOffset: [o[0] + 0.025 * r, o[1] - 0.03 * f] });
        if (showValues) {
          const text = textOf(props);
          const fontSize = Math.min(r * 0.8, r * 3.3 / Math.max(1, text.length)) * valueScale;
          const color = textOverride ? hexOrNamedToRgb(textOverride) : (multiColor ? flatChartTextRgb(rgb) : [255, 255, 255]);
          if (fontSize > 0) texts.push({ ...d, text, fontSize, color, pixelOffset: o });
        }
      }
      const layers = [];
      if (boxes.length) {
        layers.push(new IconLayer({
          id: `ix-bubbles-${this.name}-g${this._iconGeneration}`,
          data: boxes, pickable: true,
          getPosition: d => d.geometry.coordinates,
          getIcon: d => d.icon,
          // the icon is drawn at 2× with a stroke padding around the box
          getSize: d => d.icon.height / 2,
          getPixelOffset: d => d.pixelOffset,
          getColor: d => [255, 255, 255, this._iconAlpha(d)],
          sizeUnits: 'pixels',
          billboard: true,
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      }
      if (texts.length) {
        layers.push(new TextLayer({
          id: `ix-labels-${this.name}`,
          data: texts, pickable: false,
          getPosition: d => d.geometry.coordinates,
          getText: d => d.text,
          getSize: d => d.fontSize,
          getColor: d => [...d.color.slice(0, 3), this._iconAlpha(d)],
          getPixelOffset: d => d.pixelOffset,
          sizeUnits: 'pixels',
          fontFamily: 'arial',
          fontWeight: 'bold',
          characterSet: 'auto',
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          parameters: ICON_LAYER_GLOBE_PARAMETERS
        }));
      }
      return layers;
    }

    // pure: oneHot → see the pure-function sections above the class
    _oneHot(cat, value) { return oneHot(cat, value, this.categoryLabels.length); }

    // pure: groupCoLocated → see the pure-function sections above the class
    _groupCoLocated(clusterFeatures, zoom) { return groupCoLocated(clusterFeatures, zoom, this._clusterRadiusPx, this.categoryLabels ? this.categoryLabels.length : 1, this.flags); }
  }

  function dominant(counts) {
    let best = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
    return best;
  }

  // Traces a symbol shape's outline into an already-`ctx.beginPath()`'d
  // canvas context, centered at (cx, cy) with "radius" r (each shape's
  // own natural half-extent, chosen so all four read as roughly
  // comparable in size to a circle of that same radius — a reasoned
  // visual approximation, not verified against the real engine's own
  // exact proportions, since maptheme.js's SVG symbol drawing wasn't
  // part of this feature's source-verification pass). Triangle points
  // DOWN, confirmed against a real ported page's own comment ("il motore
  // disegna il triangolo con la punta in basso" — "the engine draws the
  // triangle with the tip at the bottom").
  function drawSymbolPath(ctx, shape, cx, cy, r) {
    switch (shape) {
      case 'square': {
        const s = r * Math.SQRT2;
        ctx.rect(cx - s / 2, cy - s / 2, s, s);
        break;
      }
      case 'diamond':
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        break;
      case 'triangle':
        ctx.moveTo(cx - r, cy - r * 0.6);
        ctx.lineTo(cx + r, cy - r * 0.6);
        ctx.lineTo(cx, cy + r);
        break;
      default: // circle
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }

  // a color's own opacity, 0..1, as SVG paints it in flat: "none" (SVG's
  // no paint — a polygon with only its outline, or a class not painted)
  // 0, rgba()/hsla() its alpha, #rrggbbaa / #rgba its alpha digits, else 1
  function cssColorAlpha(v) {
    if (typeof v !== 'string') return 1;
    const c = v.trim().toLowerCase();
    if (c === 'none' || c === 'transparent') return 0;
    const m = c.match(/^(?:rgba|hsla)\([^)]*,\s*([\d.]+%?)\s*\)$/) || c.match(/^(?:rgb|hsl)a?\([^)]*\/\s*([\d.]+%?)\s*\)$/);
    if (m) return Math.max(0, Math.min(1, m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1])));
    const h = c.match(/^#(?:[0-9a-f]{3}([0-9a-f])|[0-9a-f]{6}([0-9a-f]{2}))$/);
    if (h) return parseInt(h[1] ? h[1] + h[1] : h[2], 16) / 255;
    return 1;
  }
  // [r, g, b] with an alpha 0..1 — the plain [r, g, b] (opaque) when it is 1
  function withAlpha(rgb, a) {
    return a >= 1 ? rgb.slice(0, 3) : [...rgb.slice(0, 3), Math.round(255 * Math.max(0, a))];
  }
  function hexOrNamedToRgb(v) {
    const NAMED = { gray: [128, 128, 128], grey: [128, 128, 128], black: [0, 0, 0], white: [255, 255, 255] };
    return parseCssColor(v) || NAMED[v] || [130, 130, 130];
  }
  // style.linecolor may be a list (the dialog's ["#dd8800"]); flat strokes
  // with its LAST entry (maptheme.js 1597-1599)
  function styleLineColor(v) {
    return Array.isArray(v) ? v[v.length - 1] : v;
  }

  // Unlike this engine's tooltip/description HTML (deliberately raw,
  // real-page-authored markup — see _buildTooltipContext/the legend's own
  // meta.description rendering), the legend's country-select dropdown
  // (style.legendfilter, see build()) injects raw DATA VALUES straight
  // from a CSV a page merely points at — untrusted in the sense that
  // nothing here authored that string. Escaped before going into
  // innerHTML so a stray `<`/`&`/quote in a source field can't break the
  // option markup (or worse).
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // a legend's row labels as HTML: the page's .style({label}) as given,
  // values from the data escaped
  function legendRowLabels(rt) {
    const display = rt.categoryDisplayLabels;
    if (display && display !== rt.categoryLabels) return display;
    return (rt.categoryLabels || []).map(v => escapeHtml(v));
  }

  // ===============================================================
  // FLAT-COMPATIBILITY API — what a page written for ixmaps-flat calls on
  // the global `ixmaps` object; it acts on the last built map:
  //  - page hooks gl calls: htmlgui_onNewTheme, htmlgui_onDrawTheme,
  //    htmlgui_onZoomAndPan
  //  - the map handle ixmaps.map() and its methods (MAP_HANDLE_METHODS)
  //  - view: getZoom, getCenter, getMapTypeId, getBoundingBox
  //  - themes: getThemeObj (flat's theme object, with its data table and
  //    the items on the map), getThemeDefinitionObj, getThemes,
  //    changeThemeStyle / removeTheme / setBasemapOpacity (map name first),
  //    setThemeTimeFrame (themeId, min, max),
  //    refreshTheme, markThemeClass / unmarkThemeClass
  //  - data: ixmaps.data (facets: getFacets, showFacets, …), the
  //    embeddedSVG.window tables (setExternalData is with the data loading)
  //  - projects: getProjectString, setProjectJSON, loadProject
  //  - page UI: setTitle, setTitleBox, formatValue; message,
  //    filterThemeItems and highlightThemeItems are accepted but not ported
  // The object itself is assembled at the end of this section (global.ixmaps).
  // ===============================================================

  // flat's page hook ixmaps.htmlgui_onNewTheme(szId), called when a theme
  // is created (maptheme.js 927) — with the theme's id (its name)
  // flat's tooltip for a theme without its own template (ui/js/tools/
  // tooltip_mustache.js 394)
  // tooltip_mustache.js 394) — the same parts, structured: the theme title
  // as h2, the item title as h3, the chart (tooltipTable) below
  // (inline styles throughout: a page's own h2 / table / td rules must not
  // restyle the tooltip)
  const FLAT_DEFAULT_TOOLTIP = "<h2 style='margin:0 0 0.15em;padding:0;font-size:1.25em;font-weight:600;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>{{theme.title}}</h2>"
    + "{{#theme.item.title}}<h3 style='margin:0 0 0.4em;padding:0;font-size:1.1em;font-weight:600;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>{{theme.item.title}}</h3>{{/theme.item.title}}"
    + "{{theme.item.chart}}";
  // {{theme.item.chart}} as a table: per row a color swatch (or none), the
  // label (left, one line) and the value (right-aligned)
  function tooltipTable(rows) {
    if (!rows.length) return '';
    const swatch = rgb => (rgb ? `<span style="display:inline-block;width:0.75em;height:0.75em;border-radius:50%;background:rgb(${rgb.slice(0, 3).join(',')})"></span>` : '');
    const td = 'border:none;background:transparent;font:inherit;color:inherit;line-height:1.15;';
    return '<table style="border-collapse:collapse;border:none;background:transparent;margin:0.2em 0;font-size:1em;line-height:1.15">'
      + rows.map(r => '<tr>'
        + `<td style="${td}padding:0.05em 0.4em 0.05em 0;vertical-align:middle">${swatch(r.rgb)}</td>`
        // one line: a long label ends in an ellipsis (full text as its title)
        + `<td style="${td}padding:0.05em 0.8em 0.05em 0;text-align:left"><span title="${escapeHtml(String(r.label).replace(/<[^>]*>/g, ''))}" style="display:inline-block;max-width:13em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom">${r.label}</span></td>`
        + `<td style="${td}padding:0.05em 0;text-align:right;white-space:nowrap">${r.value}</td></tr>`).join('')
      + '</table>';
  }
  function themeIdOf(rt) {
    return (rt.style && rt.style.name) || (rt.meta && rt.meta.name) || rt.name;
  }
  function notifyNewTheme(rt) {
    const hook = pageIxmaps() && pageIxmaps().htmlgui_onNewTheme;
    if (typeof hook !== 'function') return;
    try { hook.call(global.ixmaps, themeIdOf(rt)); } catch (e) { console.error('[ixmaps-gl] htmlgui_onNewTheme:', e); }
  }

  // flat's ixmaps.map() — the running map's handle (htmlgui.js 173ff,
  // htmlgui_flat.js). Its methods act on the last built map; called while
  // the map is still building, they run once it is ready.
  const MAP_HANDLE_METHODS = ['replace', 'add', 'remove', 'removeTheme', 'replaceTheme', 'changeThemeStyle', 'setThemeStyle',
    'refreshTheme', 'setBasemapOpacity', 'setMapType', 'setMapTypeId', 'mapType', 'resize', 'view', 'options', 'layer', 'loadProject', 'require', 'setThemeVisible', 'setThemeTimeFrame', 'attribution'];
  const _mapHandle = {};
  for (const m of MAP_HANDLE_METHODS) {
    _mapHandle[m] = (...args) => {
      if (_lastMapApi) { const r = _lastMapApi[m](...args); return r === _lastMapApi ? _mapHandle : r; }
      _mapReady.then(api => api[m](...args));
      return _mapHandle;
    };
  }
  _mapHandle.getZoom = () => (_lastMapApi ? _lastMapApi.getZoom() : undefined);
  _mapHandle.getThemeObj = id => getThemeObj(id);
  function mapHandle() { return _mapHandle; }

  // flat's ixmaps.formatValue(value, precision, flag) (ui/js/tools/format.js),
  // which user chart scripts call: thousands separated by "." (BLANK: a
  // space), the decimals after "," (BLANK: "."), CEIL / FLOOR rounding
  function flatFormatPart(nPart, szLeading) {
    szLeading = szLeading || '';
    let szPart = '';
    if (nPart < 100) szPart += szLeading;
    if (nPart < 10) szPart += szLeading;
    if (nPart === 0) szPart += szLeading;
    else szPart += String(nPart);
    return szPart;
  }
  function flatFormatValue(nValue, nPrecision, szFlag) {
    nValue = Number(nValue);
    if (!isFinite(nValue) || !isFinite(nPrecision)) return String(nValue);
    if (nValue === 0) return String(nValue);
    if (nValue > 1000000000000 || nValue < -1000000000000) return String(nValue);
    nPrecision = Math.max(0, nPrecision || 0);
    if (nValue > 0.0000001 && nPrecision > 0) {
      while (Number(nValue.toFixed(nPrecision - 1)) === 0) nPrecision++;
    }
    let v = Number(nValue.toFixed(nPrecision + 1));
    const clip = Math.pow(10, nPrecision);
    if (szFlag && /CEIL/.test(szFlag)) v = Math.ceil(v * clip) / clip;
    else if (szFlag && /FLOOR/.test(szFlag)) v = Math.floor(v * clip) / clip;
    else v = Math.round(v * clip) / clip;
    let szDecimals = String(v);
    if (/\./.test(szDecimals)) {
      szDecimals = szDecimals.split('.')[1];
      while (szDecimals.length < nPrecision) szDecimals += '0';
    } else szDecimals = '';
    let szReturn = v < 0 ? '-' : '';
    let szLeading = '';
    let n = Math.floor(Math.abs(v));
    if (!szFlag || !/NOBREAKS/.test(szFlag)) {
      let nClip = 1000;
      while (n > nClip) nClip *= 1000;
      nClip /= 1000;
      let szBreak = ' ';
      while (nClip >= 1000) {
        const nPart = Math.floor(n / nClip);
        szReturn += flatFormatPart(nPart, szLeading);
        n = n % nClip;
        nClip /= 1000;
        if (nPart) {
          szLeading = '0';
          szBreak = szFlag && /SPACE/.test(szFlag) ? '<span style="font-size:0.5em;">&nbsp;</span>' : szFlag && /BLANK/.test(szFlag) ? '&nbsp;' : '.';
        }
        szReturn += szBreak;
      }
    }
    szReturn += flatFormatPart(n, szLeading);
    if (!szReturn.length || szReturn === '-') szReturn += '0';
    if (szDecimals.length && szDecimals !== '00') szReturn += (szFlag && /BLANK/.test(szFlag) ? '.' : ',') + szDecimals;
    return szReturn;
  }

  function getZoom() { return _lastMapApi ? _lastMapApi.getZoom() : undefined; }

  // flat's ixmaps.getBoundingBox() (htmlgui_sync_Leaflet_VT.js
  // htmlMap_getBounds): [{lat, lng} south-west, {lat, lng} north-east] of
  // the view, latitude clamped to ±85.05, longitude not capped. Set by the
  // last build(): a broker (data.type "ext") is called while its map is
  // still building, so until the MapLibre map exists the bounds come from
  // the requested view and the container size (MapLibre's 512 px tiles).
  let _boundsSource = null;
  function viewBounds(lat, lng, mlZoom, width, height) {
    const world = 512 * Math.pow(2, mlZoom);
    const x = (lng + 180) / 360 * world;
    const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world;
    const lngAt = px => px / world * 360 - 180;
    const latAt = py => Math.atan(Math.sinh(Math.PI * (1 - 2 * py / world))) * 180 / Math.PI;
    return [{ lat: latAt(y + height / 2), lng: lngAt(x - width / 2) }, { lat: latAt(y - height / 2), lng: lngAt(x + width / 2) }];
  }
  function getBoundingBox() {
    const b = _boundsSource ? _boundsSource() : null;
    if (!b) return null;
    return [{ lat: Math.max(b[0].lat, -85.05), lng: b[0].lng }, { lat: Math.min(b[1].lat, 85.05), lng: b[1].lng }];
  }

  // flat's ixmaps.setTitle(html) / setTitleBox(text, color) (htmlgui.js
  // 1311-1331): a message line over the last built map, same markup as
  // flat's default (legend not aligned left); '' clears it.
  let _titleHost = null;
  function setTitle(szTitle) {
    if (!_titleHost) return;
    let box = _titleHost.querySelector(':scope > .ixmaps-gl-title');
    if (!box) {
      box = document.createElement('div');
      box.className = 'ixmaps-gl-title';
      box.style.cssText = 'position:absolute;top:11px;left:0;z-index:3;pointer-events:none;';
      _titleHost.appendChild(box);
    }
    box.innerHTML = szTitle
      ? "<div style='position:relative;left:100px;top:2px;font-style:arial,helvetica;font-size:22px'>" + szTitle + '</div>'
      : '';
  }
  function setTitleBox(szTitle, szColor) {
    setTitle("<span style='display:inline-flex;align-items:center;height:38px;box-sizing:border-box;padding:0 12px;border:1px solid #46494c;border-radius:8px;font-size:14px;font-family:courier new,Raleway,arial,helvetica;background:" + (szColor || 'rgba(255,255,255,0.95)') + ';color:' + (szColor ? '#fff' : '#222') + "'>" + szTitle + '</span>');
  }
  // flat's ixmaps.refreshTheme(szId): reloads the theme's data on the last
  // built map (a broker is called again) — see engineApi.refreshTheme
  function refreshTheme(szId) {
    if (!_lastMapApi || !_lastMapApi.refreshTheme) return;
    _lastMapApi.refreshTheme(szId).catch(err => console.error('[ixmaps-gl] refreshTheme:', err));
  }


  // GL-PORT COMPAT: real ixmaps-flat's ixmaps.getThemeObj(szId) — a
  // global lookup by theme id, independent of which map built it — looked
  // up from _globalThemeRegistry (see its own comment for the "last
  // definition wins" caveat). Returns null for an unknown id, same as the
  // real engine, rather than throwing.
  function getThemeObj(szId) {
    // no id: flat's current theme — here the one a page's facets were
    // built for (its own facet script sets ixmaps.filterThemeId), else the
    // last chart / choropleth theme
    let rt = szId != null ? _globalThemeRegistry.get(szId) : null;
    if (szId == null) {
      const pid = pageIxmaps() && pageIxmaps().filterThemeId;
      rt = (pid != null && _globalThemeRegistry.get(pid))
        || [..._globalThemeRegistry.values()].reverse().find(r => r.flags.has('CHART') || r.flags.has('CHOROPLETH')) || null;
    }
    if (!rt) return null;
    const rgbHex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    let items = null;
    const onMap = () => items || (items = themeItemsOnMap(rt));
    return {
      // flat's theme id (style.name) — a .layer() name may be shared by
      // several themes of a page
      szId: themeIdOf(rt),
      szName: rt.name,
      // the filter in force: a runtime one (changeThemeStyle "filter")
      // replaces the definition's
      szFilter: rt._runtimeFilterExpr || rt._filterExpr || '',
      szFlag: Array.from(rt.flags).join('|'),
      // flat's fVisible is false for a FEATURE theme outside its
      // featureupper/featurelower scales too (maptheme.js 2609-2611) — a
      // broker reads it to skip refreshing a hidden theme
      fVisible: !rt._hidden && !(_lastMapApi && _lastMapApi.map && themeHiddenByScale(rt.flags, rt.style, _lastMapApi.map.getZoom())),
      nScale: styleNum(rt.style.scale) || 1,
      szUnits: rt.style.units || '',
      // flat stores the unit with a leading space unless it starts with "."
      szUnit: rt.style.units ? (String(rt.style.units)[0] === '.' ? '' : ' ') + rt.style.units : '',
      szTitleField: rt.binding.title || null,
      szFieldsA: rt.binding.value ? String(rt.binding.value).split('|') : [],
      szSizeField: rt.binding.size || null,
      // the classes, as flat's facet / legend scripts read them:
      // colorScheme by class, nStringToValueA value → class + 1,
      // szLabelA / szValuesA the style's label / values lists
      colorScheme: (rt.categoryColorsRgb || []).map(rgbHex),
      nStringToValueA: rt.categoryLabels ? Object.fromEntries(rt.categoryLabels.map((v, i) => [v, i + 1])) : {},
      szLabelA: Array.isArray(rt.style.label) ? rt.style.label.map(String) : (rt.categoryDisplayLabels || null),
      szValuesA: Array.isArray(rt.style.values) ? rt.style.values.map(String) : null,
      partsA: rt.partsA || [],
      // flat's own data surface, as a page's own facet / list scripts
      // (flat's ui/js/tools facet.js, list.js) read it: the theme's data
      // table (objTheme.dbTable/dbFields/dbRecords — records as arrays in
      // field order) and the items on the map (indexA → itemA[i].dbIndexA,
      // the records of each item). Here one item holds every record of
      // the theme within the current view (shown, in scale, facet filters
      // applied) — computed when read
      get objTheme() { return themeDbTable(rt); },
      // computed once per theme object (a page's loop reads itemA per record)
      get indexA() { return onMap().indexA; },
      get itemA() { return onMap().itemA; }
    };
  }
  const _warnedOnce = new Set();
  function warnOnce(key, msg) { if (!_warnedOnce.has(key)) { _warnedOnce.add(key); console.info(msg); } }
  // the theme's records as flat's dbFields/dbRecords (cached per data)
  function themeDbTable(rt) {
    const features = rt.features || [];
    if (rt._dbTableFor === features) return rt._dbTable;
    const rowOf = f => (f.properties && f.properties.raw) || f.properties || {};
    const names = [];
    const seen = new Set();
    for (const f of features.slice(0, 1000)) for (const k of Object.keys(rowOf(f))) if (!seen.has(k)) { seen.add(k); names.push(k); }
    const indexOf = new Map();
    const dbRecords = features.map((f, i) => { indexOf.set(f, i); const row = rowOf(f); return names.map(k => (row[k] == null ? '' : row[k])); });
    rt._dbTableFor = features;
    rt._dbIndexOf = indexOf;
    const dbFields = names.map(id => ({ id, typ: 0, width: 16, decimals: 0 }));
    // dbTable: data.js Table's own table header ({records, fields} counts)
    rt._dbTable = { dbTable: { records: dbRecords.length, fields: dbFields.length }, dbFields, dbRecords };
    return rt._dbTable;
  }
  // the records on the map now: none for a hidden / out of scale theme,
  // else the (facet-filtered) records within the view
  function themeItemsOnMap(rt) {
    themeDbTable(rt);
    const map = _lastMapApi && _lastMapApi.map;
    const shown = map && !rt._hidden && !themeHiddenByScale(rt.flags, rt.style, map.getZoom());
    if (!shown) return { indexA: [], itemA: {} };
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const dbIndexA = [];
    for (const f of (rt._activeFeatures || rt.features || [])) {
      const g = f.geometry;
      if (g && g.type === 'Point' && !pointInBbox(g, bbox)) continue;
      const i = rt._dbIndexOf.get(f);
      if (i != null) dbIndexA.push(i);
    }
    return { indexA: ['view'], itemA: { view: { dbIndexA } } };
  }
  // flat's ixmaps.getThemeDefinitionObj(szId): the theme's definition —
  // type, style (sizefield/valuefield as flat names them), meta
  function getThemeDefinitionObj(szId) {
    const rt = _globalThemeRegistry.get(szId);
    if (!rt) return null;
    const style = Object.assign({}, rt.style);
    if (rt.binding.size && !style.sizefield) style.sizefield = rt.binding.size;
    if (rt.binding.title && !style.titlefield) style.titlefield = rt.binding.title;
    if (rt.binding.time && !style.timefield) style.timefield = rt.binding.time;
    style.type = rt.flags.typeString != null ? rt.flags.typeString : [...rt.flags].join('|');
    const data = Object.assign({}, rt._definition && rt._definition.data);
    if (!data.name) data.name = themeDataName(rt);
    return { layer: rt.name, type: style.type, field: rt.binding.value, data, style, meta: Object.assign({}, rt.meta) };
  }
  // a theme's data table name — flat keeps named data tables in its map
  // window (ixmaps.embeddedSVG.window[name], read by a page's own list
  // scripts): the .data({name}) given, else one made from the theme id
  function themeDataName(rt) {
    const d = rt._definition && rt._definition.data;
    return (d && d.name) || ('themeData_' + String(themeIdOf(rt)).replace(/\W/g, '_'));
  }
  // flat's ixmaps.embeddedSVG.window: here only its named data tables, as
  // data.js Table objects {table, fields, records} of the themes' data
  const embeddedSVG = {
    window: new Proxy({}, {
      get(target, key) {
        if (typeof key !== 'string') return undefined;
        const rt = [...new Set(_globalThemeRegistry.values())].find(r => themeDataName(r) === key);
        if (!rt) return undefined;
        const t = themeDbTable(rt);
        return { table: t.dbTable, fields: t.dbFields, records: t.dbRecords };
      }
    })
  };

  // GL-PORT COMPAT: real ixmaps-flat's global ixmaps.markThemeClass(szId,
  // index)/unmarkThemeClass(szId, index) (htmlgui.js:2196/2208 — a bare
  // add/remove pair, with the calling page's own onclick handler deciding
  // which one to call, i.e. the toggle logic lives in the CALLER, not
  // here, same as the real engine's doMarkClass wrapper). The native
  // legend's own row clicks (see build()) call these same two functions
  // rather than reaching into the runtime directly, so a page's own
  // custom UI can drive the exact same isolate/dim behavior. Resolved via
  // _globalThemeRegistry, same "unknown id -> silently no-op" contract as
  // getThemeObj above (never throws on a bad szId). rt._triggerRedraw is
  // wired up per-runtime inside build()'s legend block — a runtime built
  // before that block ran (there is none, currently) would just no-op
  // here instead of redrawing.
  function markThemeClass(szId, index) {
    const rt = _globalThemeRegistry.get(szId);
    if (rt) markRuntimeClass(rt, index);
  }
  function unmarkThemeClass(szId, index) {
    const rt = _globalThemeRegistry.get(szId);
    if (rt) unmarkRuntimeClass(rt, index);
  }
  // the legend's own rows mark their theme directly: its .layer() name
  // may be shared with other themes of the page
  function markRuntimeClass(rt, index) {
    // flat: a non-CHART theme (choropleth) marks ONE class at a time —
    // MapTheme.markClass unmarks the previous class first (maptheme.js
    // 14301-14305); chart themes can mark several
    // (sub-theme choropleths — DOMINANT/COMPOSECOLOR — can mark several)
    if (!rt.flags.has('CHART') && !rt._onMarksChanged) rt._markedClasses.clear();
    rt._markedClasses.add(index);
    if (rt._onMarksChanged) rt._onMarksChanged();
    else if (rt._triggerRedraw) rt._triggerRedraw();
  }
  function unmarkRuntimeClass(rt, index) {
    rt._markedClasses.delete(index);
    if (rt._onMarksChanged) rt._onMarksChanged();
    else if (rt._triggerRedraw) rt._triggerRedraw();
  }

  // GL-PORT COMPAT: real ixmaps-flat's ixmaps.data.getFacets(filterExpr,
  // statsId, fields, szId, scope, mode) — a global facet query keyed by
  // theme id. filterExpr/statsId/scope/mode have no equivalent here (this
  // engine's own per-runtime getFacets(fields, opts) is already scoped to
  // the runtime's OWN static filter + the current viewport bbox — see its
  // own comment) and are accepted-but-ignored rather than requiring the
  // caller to stop passing them. Returns [] for an unknown szId, matching
  // "no facets" rather than throwing. A 7th, GL-port-only `opts` argument
  // (real signature has none) forwards straight through to the runtime's
  // own getFacets(fields, opts) — e.g. `{sizeField: "capacity_mw"}` to
  // weight bars by a field's sum rather than a plain record count, the
  // one extra capability this port's facet browser has that the real
  // 6-arg signature has no room to express.
  //
  // Resolved via _lastMapApi.getFacets (which itself resolves szId
  // through build()'s own findRuntime — matching EITHER a runtime's
  // .layer() name OR its style.name, and preferring a non-FEATURE/
  // FEATURES runtime on a collision), NOT _globalThemeRegistry directly.
  // Confirmed as a real, necessary distinction, not an arbitrary
  // preference: a page styling its theme with .style({name:"chart"})
  // while calling .layer("AREU") (a real, common pattern — the theme id
  // callers use is the STYLE name, "chart", not the layer name) plus a
  // SEPARATE second runtime sharing that same .layer("AREU") name (e.g.
  // a companion grid/curves overlay) broke exactly this way: looking up
  // "chart" in _globalThemeRegistry (keyed only by .layer() name) found
  // nothing, and even looking up "AREU" would have returned whichever of
  // the two same-named runtimes was registered LAST — the wrong one —
  // not the one actually named "chart". _lastMapApi's own findRuntime
  // already handles both cases correctly.
  const ixmapsData = {
    fShowFacetValues: true,
    getFacets(filterExpr, statsId, fields, szId, scope, mode, opts) {
      return _lastMapApi ? _lastMapApi.getFacets(szId, fields, opts || {}) : [];
    },
    // GL-PORT COMPAT: real ixmaps-flat's ixmaps.data.showFacets(szFilter,
    // szDiv, facetsA) — the companion renderer to getFacets() above,
    // confirmed (real ui/js/tools/show_facets.js + several real pages
    // under pages/AREU_facets, pages/CinquePerMille, etc., all following
    // the identical "call getFacets(), then showFacets() into an empty
    // container div" two-step) rather than guessed. Same real names,
    // deliberately adapted body:
    //   - Real showFacets has NO theme-id parameter at all — its
    //     generated click handlers (__setFacetFilter/__setFilter/
    //     __removeFacets, also real names, see below) broadcast a filter
    //     to EVERY theme on the map via ixmaps.changeThemeStyle(id,
    //     "filter:...") for each of ixmaps.getThemes(), relying on a
    //     non-matching theme's own field lookup to just harmlessly not
    //     match. This engine's OWN setFacetFilter (build()'s engineApi,
    //     see its own comment) deliberately scopes to sibling runtimes
    //     sharing the SAME DATA SOURCE instead — a real, reasoned
    //     improvement from earlier in this file's history, not
    //     something to regress by reintroducing a global broadcast. The
    //     4th `szId` parameter here (absent from the real signature) is
    //     what lets this call through to that existing, already-correct
    //     mechanism instead of reinventing global broadcast.
    //   - Real showFacets renders Bootstrap-flavored markup (list-group/
    //     form-control/badge classes) sized for pages that already load
    //     Bootstrap; this engine has no such dependency (no page built
    //     against it so far does), so this generates its own minimal,
    //     dark-theme default styling instead (injected once, see
    //     ensureFacetStyles below) — same OBSERVABLE behavior (per-field
    //     header, proportional value bars, click-to-filter, search box
    //     past a threshold, +N expand, active-state highlight), not
    //     byte-identical DOM/CSS.
    //   - Real plugin also exposes __setRangeFilter/__makeWordCloud/
    //     __toggleSortActiveFacets for numeric-range sliders, a word-
    //     cloud view, and a sort-order toggle — none of those are ported
    //     here (no page has asked for them yet); only the three
    //     click-to-filter/search-to-filter/remove-filter primitives that
    //     actually drive a bar-list facet browser are.
    showFacets(szFilter, szDiv, facetsA, szId) {
      ensureFacetStyles();
      const container = document.getElementById(szDiv);
      if (!container) { console.warn(`[ixmaps-gl] showFacets: no element with id "${szDiv}"`); return; }

      // Space-grouped thousands, same convention as _formatTooltipValue/
      // the legend's own value formatting elsewhere in this file — not
      // toLocaleString() with no explicit locale, which would otherwise
      // pick up whatever locale the VIEWER's browser happens to default
      // to (comma vs. period thousands/decimal separators), inconsistent
      // with the rest of this engine's own number formatting.
      const fmtCount = n => Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      const html = (facetsA || []).map(facet => {
        const headerClass = facet.isActive ? 'ix-facet ix-facet-active' : 'ix-facet';
        let body = `<div class="${headerClass}" data-field="${escapeHtml(facet.id)}">`
          + `<div class="ix-facet-header" data-role="header">${escapeHtml(facet.id)}</div>`;

        if (facet.type === 'freetext') {
          const activeText = (facet.isActive && facet.activeClause && typeof facet.activeClause === 'object') ? facet.activeClause.like : '';
          body += `<div class="ix-facet-search"><input type="text" placeholder="Filter by ... (e.g. ${escapeHtml(facet.example || '')})" value="${escapeHtml(activeText || '')}" data-role="search">`
            + `<button data-role="search-btn">&#128269;</button></div></div>`;
          return body;
        }

        const SEARCH_THRESHOLD = 10, MAX_SHOWN_UNCLIPPED = 12, MAX_SHOWN_CLIPPED = 10;
        if (facet.values.length > SEARCH_THRESHOLD) {
          const activeText = (facet.isActive && facet.activeClause && typeof facet.activeClause === 'object') ? facet.activeClause.like : '';
          body += `<div class="ix-facet-search"><input type="text" placeholder="Filter by ..." value="${escapeHtml(activeText || '')}" data-role="search">`
            + `<button data-role="search-btn">&#128269;</button></div>`;
        }

        const maxShown = facet.values.length < MAX_SHOWN_UNCLIPPED ? facet.values.length : MAX_SHOWN_CLIPPED;
        const renderBar = value => {
          const count = facet.valuesCount[value] || 0;
          const pct = facet.nValuesSum ? Math.min(100, (count / facet.nValuesSum) * 100) : 0;
          const rgb = szId && _lastMapApi ? _lastMapApi.getCategoryColor(szId, value) : null;
          const bg = rgb ? `rgb(${rgb.join(',')})` : '#5a7688';
          const selected = facet.isActive && facet.activeClause === value;
          // facet.valuesLabels (set by rt.getFacets when a theme's own
          // .style({label:[...]}) applies to this field — see that
          // method's own comment) is a display-text override for coded
          // values (e.g. German UART accident-type codes -> their real
          // names); filtering itself always stays keyed by the raw value
          // (data-value/activeClause), only the shown text changes.
          const displayText = (facet.valuesLabels && facet.valuesLabels[value]) || value;
          // facet.unit (see rt.getFacets' own comment) — appended only
          // when this facet's numbers are size-field sums, matching real
          // show_facets.js:776's own units-suffix condition exactly.
          const unitSuffix = facet.unit ? ' ' + facet.unit : '';
          return `<div class="ix-facet-bar${selected ? ' ix-facet-bar-selected' : ''}" data-role="value" data-value="${escapeHtml(value)}">`
            + `<div class="ix-facet-row"><span class="ix-facet-label">${escapeHtml(displayText)}</span>`
            + `<span class="ix-facet-count">${fmtCount(count)}${unitSuffix}</span></div>`
            + `<div class="ix-facet-underline" style="width:${pct}%;background:${bg}"></div></div>`;
        };

        facet.values.slice(0, maxShown).forEach(v => { body += renderBar(v); });
        if (facet.values.length > maxShown) {
          const extra = facet.values.slice(maxShown);
          body += `<button class="ix-facet-more" data-role="more">+ ${extra.length}</button>`
            + `<div class="ix-facet-extra" hidden>${extra.map(renderBar).join('')}</div>`;
        }
        body += '</div>';
        return body;
      }).join('');

      container.innerHTML = html;

      // Wired once per container (not once per showFacets call — a page
      // calls this again on every redraw, matching the real plugin's own
      // "call getFacets+showFacets again inside htmlgui_onDrawTheme"
      // pattern) via a dataset flag guard, delegated rather than the real
      // plugin's inline onclick="javascript:__setFacetFilter(...)"
      // strings — a facet VALUE can contain quotes/apostrophes/accents
      // that would break an inline attribute (confirmed as a real,
      // deliberately-avoided gotcha the first time this exact facet UI
      // was built, see global_power_plants_sidebar.html's own comment on
      // this). window.__setFacetFilter/__setFilter/__removeFacets (see
      // their own comments) are still real, directly-callable globals a
      // page's OWN custom UI can use too — only THIS generated markup
      // happens to reach them via delegation instead of inline HTML.
      if (!container.dataset.ixFacetsWired) {
        container.dataset.ixFacetsWired = '1';
        container.addEventListener('click', e => {
          const moreBtn = e.target.closest('[data-role="more"]');
          if (moreBtn) { moreBtn.hidden = true; moreBtn.nextElementSibling.hidden = false; return; }

          const searchBtn = e.target.closest('[data-role="search-btn"]');
          if (searchBtn) {
            const input = searchBtn.previousElementSibling;
            global.__setFilter(szId, searchBtn.closest('[data-field]').dataset.field, input.value);
            return;
          }

          const header = e.target.closest('[data-role="header"]');
          if (header) {
            const facetEl = header.closest('[data-field]');
            if (facetEl.classList.contains('ix-facet-active')) global.__removeFacets(szId, facetEl.dataset.field);
            return;
          }

          const valueEl = e.target.closest('[data-role="value"]');
          if (valueEl) {
            global.__setFacetFilter(szId, valueEl.closest('[data-field]').dataset.field, valueEl.dataset.value);
          }
        });
        container.addEventListener('keyup', e => {
          if (e.key !== 'Enter') return;
          const input = e.target.closest('[data-role="search"]');
          if (input) global.__setFilter(szId, input.closest('[data-field]').dataset.field, input.value);
        });
      }
    }
  };

  // Minimal default dark-theme styling for ixmaps.data.showFacets — see
  // its own comment for why this diverges from the real plugin's
  // Bootstrap-flavored markup. Injected once (id-guarded), and as the
  // FIRST child of <head> rather than appended at the end — showFacets()
  // typically first runs well after the page's own <head> (with its own
  // <style> block, if any) has already parsed, so appending would put
  // this LAST in source order and let it win ties over a page's own
  // same-specificity override attempt (confirmed a real problem: a
  // light-themed page overriding e.g. .ix-facet-header would otherwise
  // have its rule silently beaten by this one). Inserted first instead,
  // so a page's own plain `.ix-facet-header {...}` rule — no extra
  // specificity needed — reliably wins, the way a caller would expect
  // "my page's CSS overrides the library default" to work.
  function ensureFacetStyles() {
    if (document.getElementById('ix-facet-styles')) return;
    const style = document.createElement('style');
    style.id = 'ix-facet-styles';
    style.textContent = `
      .ix-facet { margin-bottom: 0.9em; font: 14px/1.4 -apple-system,Arial,sans-serif; }
      .ix-facet-header { padding: 0.45em 0.6em; border-radius: 5px; background: #1c2b3a; color: #cfe3ee; margin-bottom: 0.4em; }
      .ix-facet-active .ix-facet-header { background: #2c4a63; cursor: pointer; color: #fff; }
      .ix-facet-active .ix-facet-header::after { content: " \\00d7"; float: right; }
      .ix-facet-search { display: flex; gap: 0.3em; margin-bottom: 0.4em; }
      .ix-facet-search input { flex: 1 1 auto; min-width: 0; font-size: 0.85em; border: 1px solid #2a3f4d; border-radius: 3px; padding: 0.25em 0.5em; background: #0f1b2a; color: #cfe3ee; }
      .ix-facet-search button { border: 1px solid #2a3f4d; background: #0f1b2a; color: #cfe3ee; border-radius: 3px; cursor: pointer; font-size: 0.85em; }
      .ix-facet-bar { cursor: pointer; padding: 0.3em 0.1em; border-bottom: 1px solid rgba(255,255,255,0.06); }
      .ix-facet-bar:hover { background: rgba(79,195,247,0.08); }
      .ix-facet-bar-selected { background: rgba(79,195,247,0.16); }
      .ix-facet-row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; }
      .ix-facet-label { color: #cfe3ee; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ix-facet-count { flex: none; color: #9fb4c2; font-weight: 600; white-space: nowrap; }
      .ix-facet-underline { height: 4px; border-radius: 2px; margin-top: 0.2em; background: #2a3f4d; }
      .ix-facet-more { margin: 0.2em 0 0.4em 0; font-size: 0.8em; padding: 0.2em 0.6em; border: 1px solid #2a3f4d; background: #0f1b2a; color: #cfe3ee; border-radius: 3px; cursor: pointer; }
    `;
    document.head.insertBefore(style, document.head.firstChild);
  }

  // GL-PORT COMPAT: real ixmaps-flat's window.__setFacetFilter/__setFilter/
  // __removeFacets (ui/js/tools/show_facets.js — bare globals the
  // plugin's own generated HTML calls via inline onclick, confirmed by
  // direct source read; a page can also call them directly). Real
  // __setFacetFilter(szFilter) takes one combined filter STRING and
  // __removeFacets(szField)/__setFilter(szField, szFilter) take no theme
  // id at all — this port's versions take a leading szId instead (see
  // showFacets' own comment for why: this engine's setFacetFilter is
  // scoped per data-source rather than broadcast to every theme, so it
  // needs an anchor theme id these bare globals wouldn't otherwise have).
  // All three are thin wrappers over the SAME already-correct
  // setFacetFilter/clearFacetFilter/getActiveFacetFilters this file's
  // own build()-time engineApi already exposes, reached via _lastMapApi
  // (same "last-built map" convention as getProjectString/setProjectJSON/
  // markThemeClass above) — no new filtering logic, just the real names.
  function __setFacetFilter(szId, field, value) {
    if (!_lastMapApi) return;
    const active = _lastMapApi.getActiveFacetFilters(szId)[field];
    if (active === value) _lastMapApi.clearFacetFilter(szId, field);
    else _lastMapApi.setFacetFilter(szId, field, value);
  }
  function __setFilter(szId, field, value) {
    if (!_lastMapApi) return;
    const trimmed = value == null ? '' : String(value).trim();
    if (trimmed) _lastMapApi.setFacetFilter(szId, field, { like: trimmed });
    else _lastMapApi.clearFacetFilter(szId, field);
  }
  function __removeFacets(szId, field) {
    if (!_lastMapApi) return;
    _lastMapApi.clearFacetFilter(szId, field);
  }

  // GL-PORT COMPAT: real ixmaps-flat's runtime projection-toggle pair
  // (ixmaps.getProjectString()/.setProjectJSON(project), documented in
  // the create-ixmap skill's "Switching projection at runtime" section —
  // a page reads the current project JSON, overwrites project.map.map
  // with a target projection SVG path plus project.map.center/.zoom, and
  // hands the whole object back). This engine has no SVG projection file
  // to swap — MapLibre GL's own native globe projection
  // (map.setProjection({type:'globe'|'mercator'}), needs the maplibre-gl
  // build actually loaded to be >=5.0.1, see LIB_URLS above) is the
  // equivalent mechanism. The exact `project.map.map` STRING a real page
  // builds is never itself resolved/fetched here — only checked for an
  // "orthographic.svg" suffix, exactly the one real convention every
  // known real page's globe toggle actually uses (see
  // example-world-bubble-projection-toggle.md) — so `ixmaps.szResourceBase`
  // only needs to be SOME string, not a real, working resource base URL.
  const ixmapsSzResourceBase = '';
  function getProjectString() {
    if (!_lastMapApi || !_lastMapApi.map) return JSON.stringify({ map: {} });
    const map = _lastMapApi.map;
    const center = map.getCenter();
    const proj = (typeof map.getProjection === 'function' && map.getProjection()) || { type: 'mercator' };
    return JSON.stringify({
      map: {
        map: proj.type === 'globe' ? 'maps/svg/maps/generic/orthographic.svg' : 'maps/svg/maps/generic/mercator.svg',
        center: { lat: center.lat, lng: center.lng },
        zoom: mapLibreToFlatZoom(map.getZoom())
      }
    });
  }
  // Real ixmaps-flat's global project API — applied to the most recently
  // built map (see _lastMapApi); both resolve to loadProject's report.
  function setProjectJSON(project, flags) {
    if (!_lastMapApi || !_lastMapApi.loadProject) return Promise.resolve(null);
    return _lastMapApi.loadProject(project, flags);
  }
  function loadProject(src, flags) {
    if (!_lastMapApi || !_lastMapApi.loadProject) return Promise.reject(new Error('[ixmaps-gl] loadProject: no map yet — call it on the map handle, or after ixmaps.Map() has resolved'));
    return _lastMapApi.loadProject(src, flags);
  }

  global.ixmaps = {
    layer, Map: createMap, setExternalData: setExternalDataBridge, getThemeObj, data: ixmapsData,
    szResourceBase: ixmapsSzResourceBase, getProjectString, setProjectJSON, loadProject,
    markThemeClass, unmarkThemeClass, getBoundingBox, setTitle, setTitleBox, refreshTheme, formatValue: flatFormatValue,
    map: mapHandle, getZoom, getThemeDefinitionObj, embeddedSVG,
    // flat's theme list: the theme objects of every theme
    getThemes: () => [...new Set(_globalThemeRegistry.values())].map(rt => getThemeObj(themeIdOf(rt))).filter(Boolean),
    // flat shows a short status message on the map; not ported
    message: () => {},
    // flat's item highlight / item filter (facet histogram hovers): not ported
    filterThemeItems: () => warnOnce('filterThemeItems', '[ixmaps-gl] ixmaps.filterThemeItems is not supported yet'),
    highlightThemeItems: () => warnOnce('highlightThemeItems', '[ixmaps-gl] ixmaps.highlightThemeItems is not supported yet'),
    // flat's global forms with the map name first (htmlgui.js) — the map
    // handle's methods on the last built map
    getCenter: () => (_lastMapApi && _lastMapApi.map ? _lastMapApi.map.getCenter() : null),
    getMapTypeId: () => (_lastMapApi && _lastMapApi.getMapTypeId ? _lastMapApi.getMapTypeId() : ''),
    // flat's attribution: ixmaps.setAttribution(text) and its htmlgui_ pair
    setAttribution: (text) => { if (_lastMapApi && _lastMapApi.setAttribution) _lastMapApi.setAttribution(text); },
    htmlgui_setAttributionString: (text) => { if (_lastMapApi && _lastMapApi.setAttribution) _lastMapApi.setAttribution(text); },
    htmlgui_getAttributionString: () => (_lastMapApi && _lastMapApi.getAttribution ? _lastMapApi.getAttribution() : ''),
    changeThemeStyle: (szMap, szId, szStyle, szFlag) => _mapHandle.changeThemeStyle(szId, szStyle, szFlag),
    removeTheme: (szMap, szId) => _mapHandle.remove(szId),
    // flat's time slider: show the records of a theme (null = all themes) whose timefield lies in [min, max)
    setThemeTimeFrame: (szId, nMin, nMax) => _mapHandle.setThemeTimeFrame(szId, nMin, nMax),
    setBasemapOpacity: (szMap, nOpacity, szMode) => _mapHandle.setBasemapOpacity(nOpacity, szMode),
    // this engine's version (flat's own ixmaps.version numbers flat)
    glVersion: IXMAPS_GL_VERSION,
    // flat always has this page hook (its layer legend tool defines it,
    // ui/js/tools/layer_legend.js 702-712): pages wrap it and call the one
    // they replaced — the chain ends here
    htmlgui_onZoomAndPan: function (nZoom) {},
    // flat calls it when a theme is drawn (htmlgui.js) — pages wrap it
    // (statistics, facets); called after each settled redraw, notifyRedraw
    htmlgui_onDrawTheme: function (szId) {},
    // carried over from a page's own pre-load `ixmaps.validate = ...`
    validate: _preloadValidate
  };
  // gl's own API names — a project's broker name must not call these
  // (loadBrokerData: a page-function broker is PAGE code, not engine API)
  const _engineIxmapsApi = new Set(Object.keys(global.ixmaps));
  // Bare globals, not namespaced under ixmaps — matches the real engine's
  // own convention (see their shared comment above) of exposing these
  // directly on window for inline-HTML/onclick callers, not only via a
  // library object.
  global.__setFacetFilter = __setFacetFilter;
  // test-only: lets test/unit/*.test.mjs call pure internals directly (the
  // engine runs in a Node vm there); deliberately NOT on the ixmaps object
  global.__ixmapsGlInternals = {
    IXMAPS_GL_VERSION, youtubeClickToPlay, tooltipTable, legendRowLabels, scaleDenom, cssColorAlpha, aggregatedCategoricalClass, dominantDopacityAlpha, isAggregatedCategoricalChoropleth, computeBubblePackLayout, isolatedBubblePackLayout, sequenceLayout, multiQuadOffsets, pixelOffsetLngLat,
    normalizeTheme, projectThemeToDefinition, withoutProjectCode, groupRecordCount, resolveBasemapStyleUrl, resolveMapTypeColor, LayerBuilder, LayerRuntime, typeStyleNumbers, styleNum,
    resolveScriptUrl, isTrustedScriptUrl, loadProcessingScript, loadBrokerData, applyBrokerThemePatch, makeBrokerTheme,
    equalIntervalBreaks, quantileBreaks, naturalBreaks, evenStrideSample, jenksBreakValues, partsFromBreakValues, resolvePartsClass,
    computeAlphaStats, computeMultiFieldClasses, computeDominantStats, resolveDominantClass, computeComposeColorStats,
    resolveComposedColor, computeRangeClasses, colorSchemeClassCount, resolveDopacityAlpha,
    flatColorSweep, applyClassesToColorScheme, resolveClassColors, flatOutlierStats, parseCssColor, flatLegendLook,
    flatToMapLibreZoom, mapLibreToFlatZoom, scaleDenominatorAt, resolveZoomReference, resolveAggregationPx, valuesHiddenByScale,
    fetchLayerData, parseCsvText, dataTableRows, geometryRowsToFeatureCollection, filterFlatValues, applyField100, field100Binding, rangeClassLegendTotals, resolveAggregateValue, classValueSeparate, cellAggregatedValues, oneHot, groupCoLocated, aggregateOnGrid, GridAggregateIndex, flatRangeParts, aggregateField100, valueRadius, itemPlotGeometry, itemAnchor, objectZoomFactor, resolveZoomReference, defaultNormalSizeValue,
    applyWhereFilter, joinChartPositions, flatLookupKey, flatShapeCenter, chartHiddenByScale, glowHiddenByScale, isSymbolChart, flatChartAlignOffset, flatChartBranch, flatValueText, categoryValueRecord, flatDerivateRgb, flatChartTextRgb, flatGroupedValue, flatNoBreaks, featuresHiddenByScale, boxHiddenByScale, flatShadowOn, snapToAggregationGrid,
    flatFormatValue,
    dataCacheKey, dataCacheDisabled, cachedLayerData, featuresBounds, wantsZoomToExtent, legendIsOn,
  };
  global.__setFilter = __setFilter;
  global.__removeFacets = __removeFacets;
})(window);
