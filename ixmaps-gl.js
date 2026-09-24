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
// CATEGORICAL choropleths aren't implemented, see
// _buildChoroplethLayers), and the CHART|SYMBOL|
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
// equal-interval by default, or QUANTILE, or NATURAL/Jenks; see
// _equalIntervalBreaks/_quantileBreaks/_naturalBreaks). A CHOROPLETH
// layer's geometry is borrowed from a FEATURE base layer sharing the same
// .layer() name (the real engine's own convention), joined via
// binding.lookup — see joinChoroplethFeatures. HEADTAIL/LOG/POW2/POW3 are
// recognized type flags but not implemented, see KNOWN_INERT_FLAGS. These
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
  // script; MapLibre GL, deck.gl, Supercluster, and Mustache are fetched
  // on first use, matching the real ixmaps-flat engine's own single-
  // <script src="ixmaps.js"> convention instead of this port's earlier
  // per-page 5-tag boilerplate (a page may still include them statically:
  // ensureLibrariesLoaded below reuses compatible copies and replaces
  // outdated ones — deck.gl < 9.4, maplibre-gl < 4.5.1 — with a warning).
  // Same CDN builds every example page already pinned; centralized here
  // so bumping a version is a one-file edit, not a 13-file one.
  // ---------------------------------------------------------------
  const LIB_URLS = {
    // Bumped 3.6.2 -> 5.x (2026-09-21, globe-projection compat fix): native
    // globe projection (map.setProjection({type:'globe'})) needs >=5.0.1
    // (5.0.0 shipped a style-spec regression, reverted in 5.0.1). Requires
    // MapLibre GL JS v4.5.1, v5, or v6 on the deck.gl side (see `deck`
    // below) — v5 satisfies that.
    maplibreCss: 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css',
    maplibreJs: 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js',
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
    supercluster: 'https://unpkg.com/supercluster@8.0.1/dist/supercluster.min.js',
    mustache: 'https://unpkg.com/mustache@4.2.0/mustache.min.js'
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
  // pageMaplibreUsable/pageDeckUsable). Supercluster/Mustache are reused
  // as found.
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
    console.warn(`[ixmaps-gl] this page loads maplibre-gl ${v || '(unknown version)'}; deck.gl needs >= ${MAPLIBRE_MIN_VERSION.join('.')} — loading ${LIB_URLS.maplibreJs.match(/maplibre-gl@([\d.]+)/)[1]}.x instead (it replaces window.maplibregl); remove the page's own maplibre-gl <script> tag`);
    return false;
  }
  function ensureLibrariesLoaded() {
    if (!_librariesPromise) {
      _librariesPromise = Promise.all([
        pageMaplibreUsable() ? Promise.resolve() : loadScript(LIB_URLS.maplibreJs),
        pageDeckUsable() ? Promise.resolve() : loadScript(LIB_URLS.deck),
        global.Supercluster ? Promise.resolve() : loadScript(LIB_URLS.supercluster),
        global.Mustache ? Promise.resolve() : loadScript(LIB_URLS.mustache),
        [...document.styleSheets].some(s => s.href === LIB_URLS.maplibreCss) ? Promise.resolve() : loadStylesheet(LIB_URLS.maplibreCss)
      ]).then(() => {
        ({ IconLayer, ScatterplotLayer, GeoJsonLayer, MapLibreOverlay, TextLayer } = global.deck);
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
  // v0.1.2: knows this engine's binding aliases (FLAT_BINDING_ALIASES/GL_BINDING_TARGETS)
  const VALIDATOR_URL_DEFAULT = 'https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-grammar@v0.1.2/dist/validate.mjs';
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
    layer(lb) {
      this.v.theme(lb.definition(), { layer: lb.name });
    }
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
  function installRuntimeApiProxy(validation) {
    const target = global.ixmaps;
    if (!target || target.__ixmapsGlValidationProxy) return;
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
  function parseCsvText(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\r\n|\n/).filter(l => l.length);
    if (!lines.length) return [];
    const delimiter = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(delimiter);
    const rows = new Array(lines.length - 1);
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(delimiter);
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
  function rowsResult(rows, binding) {
    if (binding && binding.lookup && !binding.position) return { type: 'Table', rows };
    return csvRowsToFeatureCollection(rows, binding && binding.position);
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
  function setExternalDataBridge(dataObj) {
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

  async function fetchLayerData(dataConfig, binding) {
    if (!dataConfig || (!dataConfig.url && !dataConfig.urls && !dataConfig.query && !dataConfig.obj)) {
      throw new Error('[ixmaps-gl] layer .data() needs a url, urls, query, or obj');
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
      const rows = typeof dataConfig.obj.json === 'function' ? dataConfig.obj.json() : dataConfig.obj;
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
      return rowsResult(dataObj.json(), binding);
    }

    if (dataConfig.type === 'csv') {
      const urls = dataConfig.urls || [dataConfig.url];
      const texts = await Promise.all(urls.map(async url => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`[ixmaps-gl] failed to fetch ${url}: ${resp.status}`);
        return resp.text();
      }));
      let rows = [].concat(...texts.map(parseCsvText));
      if (dataConfig.remap) {
        Object.entries(dataConfig.remap).forEach(([field, map]) => {
          rows.forEach(row => { if (row[field] in map) row[field] = map[row[field]]; });
        });
      }
      return rowsResult(rows, binding);
    }

    const resp = await fetch(dataConfig.url);
    if (!resp.ok) throw new Error(`[ixmaps-gl] failed to fetch ${dataConfig.url}: ${resp.status}`);
    if (dataConfig.type === 'topojson') return topojsonToFeatureCollection(await resp.json());
    if (dataConfig.type === 'geojson') return sanitizeGeoJSON(await resp.json());
    throw new Error(`[ixmaps-gl] unsupported data type "${dataConfig.type}" (topojson/geojson/csv implemented)`);
  }

  // ---------------------------------------------------------------
  // .filter("WHERE field = value") — the one predicate form our real
  // layer config uses; unsupported expressions are left unfiltered with
  // a warning rather than silently mis-filtering. Accepts "=" or "=="
  // (both seen in ported configs) — "={1,2}" not "==?", so it still
  // requires at least one: confirmed live as a real, silent bug when this
  // only accepted a single "=": "WHERE s == \"3\"" matched the regex
  // (greedy \S+ still found "s"), but only consumed ONE of the two "="
  // characters, leaving the second "=" as part of the "value" capture —
  // every row's stringified field was compared against the literal
  // (garbage) value ‘= "3"’ instead of "3", so the filter matched nothing
  // and looked like the theme quietly rendered zero features.
  // ---------------------------------------------------------------

  function applyWhereFilter(fc, filterExpr) {
    if (!filterExpr) return fc;
    const m = /^\s*WHERE\s+(\S+)\s*={1,2}\s*(.+?)\s*$/i.exec(filterExpr);
    if (!m) {
      console.warn('[ixmaps-gl] unsupported filter expression, left unfiltered:', filterExpr);
      return fc;
    }
    const [, rawField, rawValue] = m;
    // CORRECTED: only rawValue's quotes were stripped here — rawField was
    // used AS-IS. Confirmed as a real, silent bug: a real page's own
    // runtime filter (mappa_stranieri_30.html's changeThemeStyle(id,
    // 'filter:WHERE "tipo" == "Liceo"', "set")) quotes the FIELD NAME too
    // (unlike every .filter() config this function was originally built
    // against — e.g. `WHERE DEN_REG = Lombardia`, `WHERE s == "3"` —
    // where only the value, if anything, is quoted). Left unfixed, `field`
    // stayed `'"tipo"'` (literal quote characters included), so
    // f.properties['"tipo"'] was always undefined and the filter matched
    // zero records — no error, no warning, just a silently-empty result,
    // exactly the same failure shape as the earlier documented single-"="
    // filter bug this function's own comment above already describes.
    const field = rawField.replace(/^['"]|['"]$/g, '');
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    if (fc.type === 'Table') return { type: 'Table', rows: fc.rows.filter(row => String(row[field]) === value) };
    return { type: 'FeatureCollection', features: fc.features.filter(f => String(f.properties[field]) === value) };
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
  function joinChoroplethFeatures(spec, table, runtimes) {
    const geomRt = runtimes.find(r => r.name === spec.name && (r.flags.has('FEATURE') || r.flags.has('FEATURES')));
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
    const rowsByKey = new Map(table.rows.map(row => [String(row[lookupField]), row]));
    // Unmatched polygons (no CSV row for that id) keep their geometry with
    // empty properties — real-world data: not every comune necessarily has
    // a row in every demographic source. Renders as "no data" (see
    // _buildChoroplethLayers's fallback color), not silently dropped from
    // the map.
    const features = geomRt.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: rowsByKey.get(String(f.properties[idField])) || {}
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
  // engine's diverging N-step sweep (colorscheme.js:123 createColorScheme
  // / _circ_createColorScheme, confirmed by direct source read against
  // the dev tree): a 3-anchor cc1 -> cc3 -> cc2 sweep, where cc3 is taken
  // from POSITION 5 (nParam2) and cc2 (position 3) is ALWAYS exact at the
  // final step. nParam1 selects the split fraction between the two
  // halves: "3colors"/"auto" (default) is a symmetric 50/50 split,
  // "3high" is 23/77 (expands the cc3->cc2 half), "3low" is 75/25 (the
  // mirror) — verified against colorscheme.js:394-457. A bare color in
  // the nParam1 slot (no keyword) hits the exact same branch as
  // "3colors"/"auto" in the real source — so ["N",cc1,cc2,cc3] and
  // ["N",cc1,cc2,"3colors",cc3] are computationally identical there, not
  // two different features; this port only implements the 5-element form
  // actually used (values/DOMINANT_COLORS-style configs always pass
  // nParam1 explicitly).
  //
  // Only this ONE real colorscheme.js code path is ported — not the rest
  // of its API surface (2-anchor sweeps, other nParam1/nParam2 shapes),
  // matching what real configs ported into this engine so far actually
  // use.
  function isDivergingColorScheme(colorscheme) {
    return Array.isArray(colorscheme) && colorscheme.length === 5 && /^\d+$/.test(String(colorscheme[0]));
  }

  // Deliberate deviation from the real source: real colorscheme.js takes
  // nSteps (the array's own leading "N") literally, which can silently
  // drift out of sync with the theme's actual label count (confirmed:
  // CATEGORICAL/SEQUENCE themes even overwrite their OWN nSteps before
  // calling in, precisely because of this). This port always uses
  // `labels.length` as the step count instead — the one value that
  // actually has to match categoryColorsRgb's indexing in this engine —
  // and only uses the array's leading element to DETECT this colorscheme
  // shape (isDivergingColorScheme above), never as the real step count.
  function divergingColorSweep(cc1Hex, cc2Hex, cc3Hex, nParam1, nSteps) {
    const nPart1 = nParam1 === '3high' ? 0.23 : nParam1 === '3low' ? 0.75 : 0.5;
    const nPart2 = 1 - nPart1;
    const [r1, g1, b1] = hexToRgb(cc1Hex);
    const [r2, g2, b2] = hexToRgb(cc2Hex);
    const [r3, g3, b3] = hexToRgb(cc3Hex);
    const denom1 = (nSteps - 1) * nPart1 || 1;
    const denom2 = (nSteps - 1) * nPart2 || 1;
    const dr1 = (r3 - r1) / denom1, dg1 = (g3 - g1) / denom1, db1 = (b3 - b1) / denom1;
    const dr2 = (r3 - r2) / denom2, dg2 = (g3 - g2) / denom2, db2 = (b3 - b2) / denom2;
    const threshold = (nSteps - 1) * nPart1;
    const colors = [];
    let rr = r1, gg = g1, bb = b1;
    for (let i = 0; i < nSteps - 1; i++) {
      colors.push([Math.round(rr), Math.round(gg), Math.round(bb)]);
      if (i < threshold) { rr += dr1; gg += dg1; bb += db1; }
      else { rr -= dr2; gg -= dg2; bb -= db2; }
    }
    colors.push([r2, g2, b2]); // forced exact final step, matching real source
    return colors;
  }

  function resolveColorScheme(colorscheme, labels) {
    if (!colorscheme) return labels.map((_, i) => FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]);
    if (isDivergingColorScheme(colorscheme)) {
      const [, cc1, cc2, nParam1, nParam2] = colorscheme;
      return divergingColorSweep(cc1, cc2, nParam2, nParam1, labels.length);
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
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // resolveColorScheme can now return either hex strings (plain array /
  // colorscheme-function paths) or already-RGB triplets (the diverging
  // sweep above) — every caller needs actual RGB arrays for deck.gl, so
  // this is the one place that normalizes either shape, instead of each
  // of the three call sites (_prepare's CATEGORICAL branch, _buildPartsA,
  // _prepareDominant) doing its own `.map(hexToRgb)` that would break on
  // the diverging sweep's own output.
  function resolveClassColors(colorscheme, labels) {
    const resolved = resolveColorScheme(colorscheme, labels);
    return (resolved || labels.map((_, i) => FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]))
      .map(c => Array.isArray(c) ? c : hexToRgb(c));
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
    'HEADTAIL', 'LOG', 'POW2', 'POW3', 'NOSORT'];
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
    // aliases (geo → position, ...) are resolved in normalizeTheme, not here
    binding(b) {
      this._binding = b;
      return this;
    }
    filter(expr) { this._filterExpr = expr; return this; }
    // flags (and their implications, e.g. BUBBLE → SYMBOL) are resolved in
    // normalizeTheme, not here
    type(t) {
      this._typeStr = t;
      return this;
    }
    style(s) { this._style = s; return this; }
    meta(m) { this._meta = m; return this; }
    // Real-engine chain method setting the legend panel's own HEADING
    // text (not a value-field label, despite the name reading that way at
    // first glance — confirmed against real pages, e.g. the power-plants
    // sample's .title("Global Power Plants") becomes that legend's title
    // line). Stored separately (not merged into _meta here) since
    // .meta() REPLACES this._meta wholesale, and callers can chain
    // .title() before OR after .meta() — definition() puts it where real
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
    // builder's fields on every call — .style()/.meta() still REPLACE
    // wholesale, so chaining semantics are unchanged. normalizeTheme() turns
    // it into what the renderers read.
    definition() {
      const style = Object.assign({}, this._style);
      if (this._typeStr) style.type = this._typeStr;
      if (this._filterExpr != null) style.filter = this._filterExpr;
      if (this._titleField != null) style.title = this._titleField;
      return { layer: this.name, data: this._data, binding: this._binding, style, meta: this._meta };
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
  // generated from ixmaps-grammar 0.1.2 (ixmaps-flat 1.0.41, eaaf2b7 2026-09-20) — 52 aliases
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

  // Which of those flat targets this engine implements, and under which name
  // its renderers read it. Targets missing here (theme.field100,
  // style.colorfield, style.timefield, ...) are still resolved into
  // spec.targets, just not used yet — the validator reports them as
  // gl-unsupported. The style.lookupfield family (geo/position/lookup/...)
  // keeps this engine's own position-vs-lookup handling for now (flat's
  // single-target rule comes in a separate change).
  const GL_BINDING_TARGETS = {
    'theme.field': ['binding', 'value'],
    'style.sizefield': ['binding', 'size'],
    'style.itemfield': ['binding', 'id'],
    'style.alphafield': ['binding', 'alpha'],
    'style.alphafield100': ['binding', 'alpha100'],
    'style.valuefield': ['style', 'valuefield'],
  };
  const LOOKUPFIELD_TARGET = 'style.lookupfield';

  // flat's own resolution order (htmlgui.js newTheme): a target given as a
  // STYLE key first (in flat, .style({sizefield}) and .binding({size}) are the
  // same thing), then every .binding() alias in object order — the last
  // alias for a target wins.
  function resolveBindingTargets(style, rawBinding) {
    const targets = {};
    const styleTargets = new Set(Object.values(FLAT_BINDING_ALIASES).filter(t => t.startsWith('style.')));
    for (const [k, v] of Object.entries(style)) {
      if (styleTargets.has('style.' + k) && 'style.' + k !== LOOKUPFIELD_TARGET) targets['style.' + k] = v;
    }
    for (const [k, v] of Object.entries(rawBinding)) {
      const t = FLAT_BINDING_ALIASES[k];
      if (t && t !== LOOKUPFIELD_TARGET) targets[t] = v;
    }
    return targets;
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
  //   - binding.geo (real flat's name) → binding.position (this engine's)
  //   - style.title (.title()) → meta.title fallback (legend heading)
  //   - style.type/filter/title are taken out of style, so rt.style holds
  //     only real style properties
  // Pure: returns new objects and never mutates the caller's definition
  // (the page's own binding/style/meta objects stay untouched).
  function normalizeTheme(def) {
    const style = Object.assign({}, def.style);
    const typeStr = style.type != null ? String(style.type) : '';
    const filter = style.filter;
    const title = style.title;
    delete style.type;
    delete style.filter;
    delete style.title;

    const flags = new Set(typeStr ? typeStr.split('|') : []);
    if (flags.has('BUBBLE')) flags.add('SYMBOL');
    flags.forEach(flag => {
      if (KNOWN_INERT_FLAGS.includes(flag) && !_warnedFlags.has(flag)) {
        _warnedFlags.add(flag);
        console.info(`[ixmaps-gl] type flag "${flag}" recognized, no distinct rendering behavior implemented yet`);
      }
    });

    const rawBinding = Object.assign({}, def.binding);
    const targets = resolveBindingTargets(style, rawBinding);
    // every original key is kept (position/lookup/geo, and keys flat ignores);
    // implemented targets are then written under this engine's own names
    const binding = rawBinding;
    for (const [t, [where, name]] of Object.entries(GL_BINDING_TARGETS)) {
      if (targets[t] !== undefined) (where === 'binding' ? binding : style)[name] = targets[t];
    }
    if (binding.geo != null && binding.position == null) binding.position = binding.geo;

    const meta = Object.assign({}, def.meta);
    if (title && !meta.title) meta.title = title;

    return { name: def.layer, data: def.data, binding, targets, flags, typeStr, style, meta, filter };
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
  function buildBlankBackgroundStyle(color) {
    return {
      version: 8,
      sources: {},
      layers: [{ id: BLANK_BACKGROUND_LAYER_ID, type: 'background', paint: { 'background-color': color } }]
    };
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
    attribution(a) { this._attributionText = a; return this; }
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

      // shown for the whole build() (library lazy-load + every layer's own
      // data fetch, real-world verified as the two slowest phases) through
      // to MapLibre's own 'load' event, below — .options({splashText:...})
      // overrides the default message, .options({splash:false}) skips it
      // entirely (e.g. for a map embedded somewhere a full-cover overlay
      // would be wrong, or one that's expected to load near-instantly).
      const splash = this._engineOptions.splash === false ? null
        : showSplash(el, this._engineOptions.splashText || 'loading…');

      // fast local check (missing container) before the network round
      // trip — MapLibre/deck.gl/Supercluster/Mustache + MapLibre's own
      // CSS, all in parallel; a no-op per-library for anything a page's
      // own <script>/<link> tags already loaded (see ensureLibrariesLoaded).
      await ensureLibrariesLoaded();

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
      const dataCache = new Map();
      const runtimes = [];
      for (const lb of this._layerBuilders) {
        const spec = normalizeTheme(lb.definition());
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
        if (spec.data && spec.data.obj) {
          raw = await fetchLayerData(spec.data, spec.binding);
          cacheKey = 'obj:' + spec.name;
        } else {
          cacheKey = JSON.stringify({ url: spec.data && spec.data.url, urls: spec.data && spec.data.urls, type: spec.data && spec.data.type, query: spec.data && spec.data.query });
          if (!dataCache.has(cacheKey)) dataCache.set(cacheKey, fetchLayerData(spec.data, spec.binding));
          raw = await dataCache.get(cacheKey);
        }
        const filtered = applyWhereFilter(raw, spec.filter);
        const fc = filtered.type === 'Table' ? joinChoroplethFeatures(spec, filtered, runtimes) : filtered;
        const rt = new LayerRuntime(spec, fc, this._engineOptions);
        // tags which underlying data source this runtime came from — see
        // setFacetFilter/clearFacetFilter/clearAllFacetFilters below,
        // which use this to propagate a facet filter to every theme
        // sharing the SAME data, not just the one the sidebar was built
        // against.
        rt._dataSourceKey = cacheKey;
        runtimes.push(rt);
        _globalThemeRegistry.set(rt.name, rt);
        // See findRuntime's own comment on the three real theme-id
        // conventions (.layer() name / style.name / meta.name) — this
        // module-level registry (used by getThemeObj/markThemeClass/the
        // global ixmaps.data.getFacets) needs the SAME meta.name fallback
        // findRuntime just got, or those globals would silently miss a
        // theme addressed only by its meta.name, same bug different
        // resolution path.
        if (rt.meta && rt.meta.name && rt.meta.name !== rt.name) _globalThemeRegistry.set(rt.meta.name, rt);
      }

      const [lat, lon] = this._viewCenter || [45.5, 9.2];
      const mapTypeColor = resolveMapTypeColor(this.mapOptions.mapType);
      const map = new maplibregl.Map({
        container: this.containerId,
        style: mapTypeColor ? buildBlankBackgroundStyle(mapTypeColor)
                             : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [lon, lat],
        zoom: this._viewZoom || 8,
        // .attribution(a) (MapBuilder, above) was stored but never read —
        // unlike .legend()'s parallel _legendHtml, which the splash/legend
        // block below actually renders. MapLibre's own AttributionControl
        // is added automatically (not disabled anywhere in this file) and
        // accepts extra text via customAttribution, appended alongside the
        // basemap's own required CARTO/OpenStreetMap credit rather than
        // replacing it.
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
        ...(this._attributionText ? { customAttribution: this._attributionText } : {})
      });

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
      function findRuntimeForLayerId(layerId) {
        // icon-atlas-based layer ids (ix-bubbles-/ix-glow-/ix-plot-/
        // ix-grid-) carry a rotating "-gN" generation suffix (see
        // ICON_ATLAS_RESET_AFTER) — strip it before matching so
        // hover/click tooltip lookup keeps working across a rotation.
        // Non-atlas layers (ix-dot-/ix-features-/ix-choropleth-) never
        // carry the suffix; stripping a pattern that isn't there is a
        // no-op.
        const base = layerId.replace(/-g\d+$/, '');
        return runtimes.find(r => {
          if (base === `ix-bubbles-${r.name}`) return r.flags.has('CHART') && r.flags.has('SYMBOL');
          if (base === `ix-dot-${r.name}`) return r.flags.has('DOT');
          if (base === `ix-choropleth-${r.name}`) return r.flags.has('CHOROPLETH');
          if (base === `ix-features-${r.name}`) return r.flags.has('FEATURE') || r.flags.has('FEATURES');
          if (base === `ix-plot-${r.name}`) return r.flags.has('GRIDSIZE') && r.flags.has('PLOT');
          if (base === `ix-grid-${r.name}`) return r.flags.has('GRIDSIZE') && !r.flags.has('PLOT');
          return false;
        });
      }

      // Click-to-pin tooltip: matches the real ixmaps engine's own
      // click-pins-the-tooltip convention in pan mode (a hover tooltip is
      // transient; a click keeps one visible until dismissed). This is a
      // separate DOM element from deck.gl's own hover tooltip (so hovering
      // a DIFFERENT bubble still shows a normal transient tooltip even
      // while one is pinned) — its content is a snapshot of buildTooltipHtml
      // at click time (not live-updating), but its screen POSITION is kept
      // in sync with the map on every pan/zoom via map.project().
      let pinned = null; // { runtime, object, lngLat }
      const pinnedTooltipEl = document.createElement('div');
      pinnedTooltipEl.style.cssText = 'position:absolute;top:0;left:0;z-index:6;display:none;' +
        'pointer-events:auto;max-width:320px;max-height:320px;overflow:auto;' +
        'background:rgb(41,50,60);color:rgb(160,167,180);padding:0.6em 1.6em 0.6em 0.7em;' +
        'border-radius:4px;font-size:0.85em;box-shadow:0 2px 8px rgba(0,0,0,0.3)';

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

      const overlay = new MapLibreOverlay({
        interleaved: true,
        layers: [],
        // pointer becomes a hand over anything pickable (bubbles/points),
        // so hovering something clickable actually looks clickable
        getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : (isHovering ? 'pointer' : 'grab')),
        getTooltip: ({ object, layer }) => {
          if (!object || !layer) return null;
          // suppress the hover tooltip ONLY for the specific item that's
          // pinned (showing both would just duplicate the same content) —
          // every OTHER item still gets its normal hover preview even
          // while something else stays pinned
          if (pinned && isSameAsPinned(layer.id, object)) return null;
          const rt = findRuntimeForLayerId(layer.id);
          if (!rt) return null;
          const html = rt.buildTooltipHtml(object);
          return html ? { html } : null;
        },
        onClick: (info) => {
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
      });
      map.addControl(overlay);
      map.addControl(new maplibregl.NavigationControl(), 'top-left');
      map.on('move', updatePinnedTooltipPosition);

      if (el.parentElement) {
        el.parentElement.style.position = el.parentElement.style.position || 'relative';
        el.parentElement.appendChild(pinnedTooltipEl);
      }

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

      const engineApi = {
        map,
        overlay,
        // delta: the new absolute opacity (0-1), or a +/- amount when
        // mode==='relative' (matching the real page's own +/- button
        // idiom, e.g. setBasemapOpacity(-0.1,'relative')/(0.1,'relative')).
        // Clamped to [0,1] either way.
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
          } else {
            console.warn(`[ixmaps-gl] changeThemeStyle: unsupported style key "${key}" (only "filter" implemented — use setThemeStyle(themeId, {...}) for other style properties)`);
          }
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
        defineLayer: async (layerBuilder) => {
          if (validation) validation.layer(layerBuilder);
          // No cross-call fetch cache here (unlike build()'s own loop) —
          // a dynamic add is a one-off call, not part of a batch of
          // layers sharing one data source.
          const spec = normalizeTheme(layerBuilder.definition());
          const raw = await fetchLayerData(spec.data, spec.binding);
          const filtered = applyWhereFilter(raw, spec.filter);
          const fc = filtered.type === 'Table' ? joinChoroplethFeatures(spec, filtered, runtimes) : filtered;
          const rt = new LayerRuntime(spec, fc, this._engineOptions);
          rt._dataSourceKey = JSON.stringify({ url: spec.data && spec.data.url, urls: spec.data && spec.data.urls, type: spec.data && spec.data.type, query: spec.data && spec.data.query, obj: !!(spec.data && spec.data.obj) });
          runtimes.push(rt);
          _globalThemeRegistry.set(rt.name, rt);
          if (rt.meta && rt.meta.name && rt.meta.name !== rt.name) _globalThemeRegistry.set(rt.meta.name, rt);
          refresh();
          notifyRedraw();
          return rt.name;
        },
        // Removes every runtime whose OWN .layer(name) matches — a theme
        // may legitimately be split across more than one runtime sharing
        // one name (the CHOROPLETH/FEATURE-donor pair above), so this
        // removes all of them, not just the first match.
        removeTheme: (name) => {
          let removed = false;
          const removedRuntimes = [];
          for (let i = runtimes.length - 1; i >= 0; i--) {
            if (runtimes[i].name === name) { removedRuntimes.push(runtimes[i]); runtimes.splice(i, 1); removed = true; }
          }
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
          if (removed) { refresh(); notifyRedraw(); }
          return removed;
        }
      };

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
      //   - BUBBLE/DOT clustering (Supercluster) reclusters on every
      //     distinct zoom it's queried at, each producing its own new set
      //     of aggregated group icons through _buildBubbleIcon. A smooth
      //     zoom gesture passes through MANY intermediate zoom levels in
      //     quick succession, and the icon cache is never evicted — so
      //     confirmed live, a real scroll-wheel zoom accumulates icons
      //     from every one of those intermediate clustering states over
      //     the course of one gesture, eventually overflowing deck.gl's
      //     shared icon atlas into solid black squares, on top of being
      //     visibly slow (a fresh Supercluster query + icon batch on every
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
        const zoom = isZooming ? stableGridZoom : liveZoom;
        const bounds = map.getBounds();
        const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
        // Only meaningful under globe projection (see buildDeckLayers'
        // own comment on the far-hemisphere bubble leak this fixes) —
        // null under mercator, where every in-bbox point is always on
        // the visible, flat surface and there's no "far side" to hide.
        const proj = (typeof map.getProjection === 'function' && map.getProjection()) || { type: 'mercator' };
        const globeCenter = proj.type === 'globe' ? map.getCenter() : null;
        let layers = [];
        runtimes.forEach(rt => layers.push(...rt.buildDeckLayers(zoom, bbox, liveZoom, globeCenter)));
        if (isZooming) layers = layers.filter(l => !(l.id.startsWith('ix-plot-') || l.id.startsWith('ix-grid-')));
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
      // re-running Supercluster clustering (_ensureClusterIndices) and
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
        // isZooming is already false here — 'zoomend' (if this gesture
        // included any zooming at all) always fires before 'moveend' —
        // so refreshLayers()'s own zoom = isZooming ? stableGridZoom :
        // liveZoom resolves to the current live zoom, exactly as wanted.
        refresh();
      });

      function notifyRedraw() {
        redrawListeners.forEach(cb => { try { cb(); } catch (err) { console.error('[ixmaps-gl] onRedraw callback failed:', err); } });
      }

      // For explicit, discrete API calls (setFacetFilter, setSizeField,
      // setThemeStyle, ...): rebuild layers AND notify onRedraw listeners
      // immediately. These aren't part of a continuous pan/zoom stream, so
      // there's no jank risk to throttle away — the caller expects instant
      // feedback.
      function refresh() {
        refreshLayers();
        notifyRedraw();
      }

      map.on('load', () => {
        refresh();
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
          refreshLayers();
        } else {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => { lastRefreshAt = Date.now(); refreshLayers(); }, REFRESH_INTERVAL_MS - elapsed);
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
      // this.mapOptions (see mapOptions.legend below) — since there's no
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
      if (this.mapOptions.legend === 'open' && el.parentElement) {
        el.parentElement.style.position = el.parentElement.style.position || 'relative';
        // Map-level `align` option positions the legend panel — a map-
        // wide placement choice, not per-theme (unlike legendtheme/
        // legendfilter above), so read once from this.mapOptions rather
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
        const legendAlignCss = ALIGN_CSS[this.mapOptions.align] || ALIGN_CSS['top-right'];
        runtimes
          // .type("...|NOLEGEND") — the fourth real legend-related type()
          // token: opts a theme OUT of the legend entirely (real engine's
          // own per-layer "skip this one" flag, distinct from the map-
          // level legend:"open"/"closed" option gating the whole panel).
          // Same free-parsing story as SIMPLELEGEND/COMPACTLEGEND above —
          // just one more flag to exclude on, no new plumbing.
          .filter(rt => rt.categoryLabels && rt.categoryLabels.length && !rt.flags.has('FEATURE') && !rt.flags.has('FEATURES') && !rt.flags.has('NOLEGEND'))
          .forEach((rt) => {
            const panel = document.createElement('div');
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
            const isLightLegend = rt.style.legendtheme === 'light';
            const legendColors = isLightLegend
              ? { bg: 'rgba(255,255,255,0.92)', fg: '#1a1a1a', shadow: '0 2px 10px rgba(0,0,0,0.18)',
                  rowMarked: 'rgba(0,0,0,0.08)', track: 'rgba(0,0,0,0.08)',
                  selectBg: 'rgba(0,0,0,0.04)', selectBorder: 'rgba(0,0,0,0.2)' }
              : { bg: 'rgba(28,30,34,0.92)', fg: '#eee', shadow: '0 2px 10px rgba(0,0,0,0.45)',
                  rowMarked: 'rgba(255,255,255,0.14)', track: 'rgba(255,255,255,0.08)',
                  selectBg: 'rgba(255,255,255,0.08)', selectBorder: 'rgba(255,255,255,0.25)' };
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
            panel.style.cssText = 'position:absolute;' + legendAlignCss + 'z-index:6;width:280px;'
              + 'display:flex;flex-direction:column;max-height:66%;'
              + 'background:' + legendColors.bg + ';color:' + legendColors.fg + ';font:12px/1.4 -apple-system,Arial,sans-serif;'
              + 'border-radius:6px;padding:10px 12px 12px;pointer-events:auto;'
              + 'box-shadow:' + legendColors.shadow + ';';
            el.parentElement.appendChild(panel);

            // SUM+valuefield mirrors the real engine's own "SUM style
            // aggregation" reading (style.valuefield, falling back to
            // the bound size field); anything else (plain CATEGORICAL,
            // no SUM) falls back to a per-category record COUNT.
            const useSum = rt.flags.has('SUM') && rt.style.valuefield;
            const valueField = rt.style.valuefield || rt.binding.size;
            // legendunits wins over the theme's general-purpose units
            // (used elsewhere for tooltips, e.g. _renderItemChartHtml) —
            // a page may want a different/no unit string specifically on
            // the legend's own value column. Appended as-is (no extra
            // space injected), matching how style.units/legendunits are
            // themselves authored with their own leading space (e.g.
            // " MW") in real pages.
            const legendUnit = rt.style.legendunits || rt.style.units || '';
            const labels = rt.categoryDisplayLabels || rt.categoryLabels;
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
            renderRows = function() {
              rowsEl.innerHTML = order.map(i => {
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
              // the module-level ixmaps.markThemeClass/unmarkThemeClass
              // (see their own comment) — so a page's OWN custom UI
              // calling those same two globals drives this exact legend
              // too, not just these rows.
              rowsEl.querySelectorAll('.ix-legend-row').forEach(rowEl => {
                rowEl.addEventListener('click', () => {
                  const idx = parseInt(rowEl.dataset.idx, 10);
                  if (rt._markedClasses.has(idx)) window.ixmaps.unmarkThemeClass(rt.name, idx);
                  else window.ixmaps.markThemeClass(rt.name, idx);
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
            let collapsed = window.innerWidth < MOBILE_LEGEND_BREAKPOINT;
            function applyCollapsed() {
              bodyEl.style.display = collapsed ? 'none' : 'flex';
              panel.style.maxHeight = collapsed ? 'none' : '66%';
              collapseBtn.textContent = collapsed ? '▸' : '▾';
              collapseBtn.title = collapsed ? 'Expand legend' : 'Collapse legend';
            }
            collapseBtn.addEventListener('click', () => { collapsed = !collapsed; applyCollapsed(); });
            applyCollapsed();

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
            const sliderRow = document.createElement('div');
            sliderRow.style.cssText = 'margin-top:10px;font-size:11px;opacity:0.8;';
            const initialPct = Math.round((parseFloat(rt.style.scale) || 1) * 100);
            sliderRow.innerHTML = 'Chart size: <span class="ix-legend-scale-val">' + initialPct + '</span>%';
            bodyEl.appendChild(sliderRow);
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '25';
            slider.max = '200';
            slider.value = String(initialPct);
            slider.style.cssText = 'width:100%;margin-top:2px;';
            slider.addEventListener('input', () => {
              const pct = parseInt(slider.value, 10);
              sliderRow.querySelector('.ix-legend-scale-val').textContent = pct;
              rt.setStyle({ scale: pct / 100 });
              refresh();
            });
            bodyEl.appendChild(slider);
          });
      }

      _lastMapApi = engineApi;
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
          const [latlonOrOpts, zoom] = args;
          const c = (latlonOrOpts && typeof latlonOrOpts === 'object' && !Array.isArray(latlonOrOpts) && latlonOrOpts.center) ? latlonOrOpts.center : latlonOrOpts;
          const z = (latlonOrOpts && typeof latlonOrOpts === 'object' && !Array.isArray(latlonOrOpts) && latlonOrOpts.center) ? latlonOrOpts.zoom : zoom;
          const lngLat = Array.isArray(c) ? [c[1], c[0]] : [c.lng, c.lat];
          resolvedApi.map.jumpTo(Object.assign({ center: lngLat }, z != null ? { zoom: z } : {}));
        } else {
          builder.view(...args);
        }
        return promise;
      };
      promise.options = (...args) => { builder.options(...args); return promise; };
      promise.attribution = (...args) => { builder.attribution(...args); return promise; };
      promise.legend = (...args) => { builder.legend(...args); return promise; };
      promise.local = (...args) => { builder.local(...args); return promise; };
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

  // NORMAL_RADIUS_PX is the engine's own calibration constant: the pixel
  // radius a symbol gets when its bound value equals normalsizevalue (or,
  // when the theme doesn't set one, the dataset's own max value on the
  // bound size field — see LayerRuntime._prepare's _maxSizeValue and
  // maptheme.js ~line 5059; there is no fixed-number default in the real
  // engine, a fallback of 50 here would be fabricated). Chosen so that
  // our real theme's normalsizevalue=50 reproduces the prior tuned slope
  // of 0.25 px/unit exactly (12.5 / 50 = 0.25).
  const NORMAL_RADIUS_PX = 12.5;
  const DEFAULT_ZOOM_REFERENCE = 10;
  const DEFAULT_DYNAMIC_SCALE_POW = 3;
  // Near-zero rather than a real floor: for aggressive-size-contrast themes
  // (small values must actually stay small at zoomed-out views, not clamp
  // to a visible minimum), keeping the real engine's own behavior — its
  // per-symbol radius code has no floor at all, values can shrink toward 0.
  // 0.1 instead of a literal 0 just avoids a zero/negative-radius edge case
  // in the renderer, not a deliberate visual floor.
  const VALUE_RADIUS_MIN = 0.1;
  const VALUE_RADIUS_MAX = 40;
  const CLUSTER_RADIUS_PX_DEFAULT = 2;
  // Reference zoom for converting a real-world-METERS .style({gridwidth})
  // into the single, fixed pixel radius Supercluster's own constructor
  // takes — see _ensureClusterIndices' own comment for why this MUST be a
  // constant, never the live viewport zoom. The actual value is
  // arbitrary (Supercluster's own multi-resolution index already scales
  // a fixed radius correctly across every zoom it serves internally,
  // matching how real-world meters per pixel halves each zoom step) —
  // fixed at 0 purely so metersToWorldPixels' own formula needs no
  // separate zoom-less variant.
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

  // standard 96dpi Web Mercator scale-denominator constant: scale = this / 2^zoom
  const WEBMERCATOR_SCALE_CONSTANT = 559082264.028;

  // Map-level .options({objectscaling, normalSizeScale}) — the zoom-anchor
  // half of dynamic symbol scaling (normalsizevalue/sizepow, above, is the
  // *value*-driven half). normalSizeScale is a map SCALE DENOMINATOR (e.g.
  // "259302", meaning 1:259302) at which symbols render at their
  // configured normal size, converted here to the equivalent zoom level
  // via the same scale formula used for style.aggregation thresholds.
  // objectscaling:"dynamic" (the default, matching this engine's prior
  // always-on behavior) means symbols DO scale with zoom; anything else
  // (e.g. "fixed") means they don't — same pixel size at every zoom.
  function resolveZoomReference(mapOptions) {
    const scaleDenominator = parseFloat(mapOptions && mapOptions.normalSizeScale);
    if (!scaleDenominator) return DEFAULT_ZOOM_REFERENCE;
    return Math.log2(WEBMERCATOR_SCALE_CONSTANT / scaleDenominator);
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
  function resolveAutoFillOpacity(zoom, mapOptions) {
    const zoomReference = resolveZoomReference(mapOptions) - AUTO_OPACITY_EARLY_START_ZOOM;
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
    return parseFloat(style.fillopacity) || 1;
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
    const parsed = parseFloat(style.sizepow);
    return isNaN(parsed) ? 2 : parsed;
  }

  // Real formula (maptheme.js): radius = normalRadius * (value/normalValue)
  // ^(1/nSizePow) — note the exponent is 1/sizePow, not sizePow itself, so
  // a LARGER sizepow COMPRESSES size differences (2 ~ area/sqrt-like, 3 ~
  // volume/cube-root-like), the opposite of a naive reading of "power".
  function valueRadius(value, zoom, style, mapOptions, flags, maxSizeValue) {
    const objectScaling = (mapOptions && mapOptions.objectscaling) || 'dynamic';
    const zoomReference = resolveZoomReference(mapOptions);
    const dynamicScalePow = resolveDynamicScalePow(mapOptions);
    const zoomFactor = objectScaling === 'dynamic'
      ? Math.pow(2, ((zoom == null ? zoomReference : zoom) - zoomReference) / dynamicScalePow)
      : 1;
    // Real default (maptheme.js ~line 5059) when the theme sets no
    // normalsizevalue: the dataset's own max value on the bound size
    // field (maxSizeValue, from LayerRuntime._prepare), not a fixed
    // constant. Final `|| 1` only guards a pathological empty dataset.
    const normalValue = parseFloat(style.normalsizevalue) || maxSizeValue || 1;
    const sizePow = resolveSizePow(style, flags || new Set());
    const ratio = Math.pow(Math.max(0, value || 0) / normalValue, 1 / sizePow);
    // NOTE: valuescale (nValueScale) is deliberately NOT here — checked the
    // real source (maptheme.js), every one of its usages is font/label
    // sizing (nFontSize/nTextSize), never symbol radius. An earlier version
    // of this engine multiplied it into the radius, which was a fabricated
    // behavior not present in ixmaps.
    const k = NORMAL_RADIUS_PX * ratio * (parseFloat(style.scale) || 1);
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
    if (!Array.isArray(aggregation) || aggregation.length < 2) return { px: fallbackPx, isMeters: false };
    const scaleDenominator = WEBMERCATOR_SCALE_CONSTANT / Math.pow(2, zoom == null ? DEFAULT_ZOOM_REFERENCE : zoom);
    let chosenPx = fallbackPx, chosenIsMeters = false;
    for (let i = 0; i + 1 < aggregation.length; i += 2) {
      const ratioMatch = /^1:(\d+(?:\.\d+)?)$/.exec(aggregation[i]);
      if (!ratioMatch) continue;
      const lower = parseFloat(ratioMatch[1]);
      if (!(lower && scaleDenominator > lower)) continue;
      const valueStr = String(aggregation[i + 1]);
      const pxMatch = /^(\d+(?:\.\d+)?)\s*px$/i.exec(valueStr);
      if (pxMatch) {
        chosenPx = parseFloat(pxMatch[1]);
        chosenIsMeters = false;
      } else {
        const meters = parseFloat(valueStr);
        if (!isNaN(meters)) {
          chosenPx = metersToWorldPixels(meters, refLat || 0, GRIDWIDTH_METERS_REFERENCE_ZOOM);
          chosenIsMeters = true;
        }
      }
      // no break — see this function's own comment on why the real
      // engine's own last-match-wins scan is reproduced faithfully here.
    }
    return { px: chosenPx, isMeters: chosenIsMeters };
  }

  // .style({aggregation}) can carry a bare-METERS entry (see
  // resolveAggregationPx's own comment) just like standalone
  // .style({gridwidth}) can — this just needs to know WHETHER one exists
  // at _prepare() time, to decide whether the one-time full-extent
  // reference-latitude scan is worth doing at all.
  function aggregationHasMetersEntry(aggregation) {
    if (!Array.isArray(aggregation)) return false;
    for (let i = 1; i < aggregation.length; i += 2) {
      if (!/px\s*$/i.test(String(aggregation[i]))) return true;
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

  function roundBubbleValue(value, style) {
    const parsedDecimals = parseInt(style.valuedecimals, 10);
    const decimals = !isNaN(parsedDecimals) ? parsedDecimals : (value < 1 ? 1 : 0);
    return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
  }

  function formatBubbleValue(value, style) {
    const rounded = roundBubbleValue(value, style);
    const unit = style.units || '';
    return unit.length && unit.length <= 5 ? rounded + unit : rounded;
  }

  function valuesFontSizePx(radiusPx, text, valueScale) {
    return Math.min(radiusPx * 0.8, radiusPx * (3.3 / Math.max(1, text.length))) * (valueScale || 1);
  }

  // .style({valueupper: "1:200000"}) — the real engine's fHideValues gate
  // (maptheme.js ~line 16969/19542): value LABELS (not the whole layer,
  // that's clipupper, out of scope) hide once the map is zoomed out past
  // this scale-denominator threshold, since at that scale the bubbles are
  // too small/numerous for a value label to be legible or useful anyway.
  function valuesHiddenByScale(style, zoom) {
    const m = /^1:(\d+(?:\.\d+)?)$/.exec(style.valueupper || '');
    if (!m) return false;
    const upperRatio = parseFloat(m[1]);
    const scaleDenominator = WEBMERCATOR_SCALE_CONSTANT / Math.pow(2, zoom == null ? DEFAULT_ZOOM_REFERENCE : zoom);
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
  function snapToAggregationGrid(x, y, cellPx, flags) {
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

  // deck.gl 8.9.35's IconLayer auto-packing atlas (icon-manager.ts) has NO
  // eviction and NO cap of its own: its texture is 1024px wide (fixed) but
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
      this.features = fc.features;
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
        if (this._iconsSinceAtlasReset > ICON_ATLAS_RESET_AFTER) {
          this._iconGeneration++;
          this._iconsSinceAtlasReset = 0;
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
      if (this.binding.size) {
        this._maxSizeValue = this.features.reduce((max, f) => {
          const v = parseFloat(f.properties[this.binding.size]);
          return isNaN(v) ? max : Math.max(max, v);
        }, 0);
      }

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

      if (this.flags.has('DOMINANT') && this.binding.value) {
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
        this.categoryColorsRgb = resolveClassColors(this.style.colorscheme, this.categoryDisplayLabels);
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

      // GRIDSIZE layers (PLOT curves-chart, or its grid-mesh companion)
      // also carry AGGREGATE in their type string, but they bin into a
      // spatial grid (_ensureGridIndex), not Supercluster's per-category
      // clustering — building _featuresByCategory for them would be wasted
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
    _prepareAlphaField() {
      if (!this.binding.alpha) return;
      const alpha100 = this.binding.alpha100;
      const isDensity = alpha100 === '$density$';
      this._alphaByFeature = new WeakMap();
      let maxAlpha = -Infinity;
      this.features.forEach(f => {
        let v = parseFloat(f.properties[this.binding.alpha]);
        if (isNaN(v)) return;
        if (isDensity) {
          const areaKm2 = geodesicPolygonAreaKm2(f.geometry);
          if (!areaKm2) return;
          v = v / areaKm2;
        } else if (alpha100) {
          const v100 = parseFloat(f.properties[alpha100]);
          if (!isNaN(v100) && v100) v = 100 / v100 * v;
        }
        this._alphaByFeature.set(f, v);
        if (v > maxAlpha) maxAlpha = v;
      });
      this._alphaMax = isFinite(maxAlpha) ? maxAlpha : 0;
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
    _prepareMultiFieldChoropleth() {
      const fields = this.binding.value.split('|');
      this._multiFields = fields;
      const explicit = Array.isArray(this.style.values) && this.style.values.length === fields.length
        ? this.style.values.map(String) : fields;
      this.categoryLabels = explicit;
      this.categoryDisplayLabels = explicit;
      this.categoryColorsRgb = resolveClassColors(this.style.colorscheme, this.categoryLabels);
      return fields;
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
    // loop per mode. Values are filtered by JS truthiness (skips NaN AND
    // exactly 0), matching the real source's own `nValuesA[i]||0`-style
    // pooling (maptheme.js:13154, confirmed by direct source read) — not
    // merely a NaN guard.
    _prepareDominant() {
      const fields = this._prepareMultiFieldChoropleth();
      const sums = fields.map(() => 0), counts = fields.map(() => 0), mins = fields.map(() => Infinity);
      const valuesByField = fields.map(() => []);
      this.features.forEach(f => {
        fields.forEach((field, i) => {
          const v = parseFloat(f.properties[field]);
          if (!v) return; // skips NaN and 0 — real source's own truthy pooling, not just a NaN guard
          sums[i] += v; counts[i]++;
          if (v < mins[i]) mins[i] = v;
          valuesByField[i].push(v);
        });
      });
      this._dominantMeans = sums.map((s, i) => counts[i] ? s / counts[i] : 0);
      this._dominantMins = mins.map(m => isFinite(m) ? m : 0);
      // Population standard deviation (divide by N, no Bessel's
      // correction) — matches getDeviationOfArray exactly.
      this._dominantStdDevs = valuesByField.map((vals, i) => {
        if (!vals.length) return 0;
        const mean = this._dominantMeans[i];
        const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length;
        return Math.sqrt(variance);
      });
    }

    // Which piped field "wins" for one joined polygon's properties — three
    // relevance formulas, real engine confirmed by direct source read:
    //
    // PERCENTOFMEAN (maptheme.js:13491/13505): nRelevanz = 100 * value /
    // mean[i].
    // DEVIATION (maptheme.js:13493/13502-13503, stddev from
    // getDeviationOfArray): nRelevanz = (value - mean[i]) / stddev[i] — a
    // z-score. Both share the SAME filter: a field can only win if its own
    // value is strictly greater than that field's own dataset-wide MIN
    // (real default nFilterA[i] = nMinA[i]; szDominantFilter
    // "mean"/"median" variants aren't implemented, not used by any config
    // ported here). Both deliberately unguarded against divide-by-zero
    // (mean=0 or stddev=0) — matching the real source exactly: that
    // naturally yields Infinity/NaN, and NaN can never win the `>`
    // comparison below (though +Infinity CAN — a real, confirmed-unguarded
    // quirk of the source itself, not introduced here).
    //
    // Plain DOMINANT (no PERCENTOFMEAN/DEVIATION, per explicit
    // correction): nRelevanz = value itself — the field with the highest
    // raw value wins outright, no mean/min filter. "Which band dominates
    // this comune's own local profile," not a cross-record comparison.
    //
    // All three: the winning threshold starts at 0, not -Infinity (real
    // source: maptheme.js:13440, nLastRelevant reset to 0 per record,
    // shared by every relevance mode) — a field must have a STRICTLY
    // POSITIVE relevance score to win at all, so DEVIATION in particular
    // only ever picks a field ABOVE its own mean, never the most anomalous
    // in either direction. Ties go to the first (lowest-index) field
    // (strict `>`).
    _resolveDominantClass(props) {
      const fields = this._multiFields;
      const usePercentOfMean = this.flags.has('PERCENTOFMEAN');
      const useDeviation = this.flags.has('DEVIATION');
      const needsFilter = usePercentOfMean || useDeviation;
      let bestIndex = -1, bestRelevance = 0, bestValue = null;
      for (let i = 0; i < fields.length; i++) {
        const v = parseFloat(props[fields[i]]);
        if (needsFilter && !(v > this._dominantMins[i])) continue;
        const relevance = useDeviation ? (v - this._dominantMeans[i]) / this._dominantStdDevs[i]
          : usePercentOfMean ? 100 * v / this._dominantMeans[i]
          : v;
        if (relevance > bestRelevance) { bestRelevance = relevance; bestIndex = i; bestValue = v; }
      }
      return bestIndex === -1 ? null : { index: bestIndex, value: bestValue };
    }

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
    _prepareComposeColor() {
      const fields = this._prepareMultiFieldChoropleth();
      let nMax = 0;
      this.features.forEach(f => fields.forEach(field => {
        const v = parseFloat(f.properties[field]);
        if (v > nMax) nMax = v;
      }));
      this._composeColorMax = nMax;
      const rgbs = this.categoryColorsRgb;
      this._composeColorSumIntensity = rgbs.reduce((s, c) => s + c[0] + c[1] + c[2], 0) / rgbs.length;
      this._composeColorMeanMaxIntensity = rgbs.reduce((s, c) => s + Math.max(c[0], c[1], c[2]), 0) / rgbs.length;
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
    _resolveComposedColor(props) {
      const fields = this._multiFields;
      const rgbs = this.categoryColorsRgb;
      const nMax = this._composeColorMax || 1;
      const subtractive = this.flags.has('SUBTRACTIVE');
      let rr = 0, gg = 0, bb = 0;
      for (let i = 0; i < fields.length; i++) {
        const v = parseFloat(props[fields[i]]) || 0;
        const weight = v / nMax;
        const [r, g, b] = rgbs[i];
        if (subtractive) { rr += (255 - r) * weight; gg += (255 - g) * weight; bb += (255 - b) * weight; }
        else { rr += r * weight; gg += g * weight; bb += b * weight; }
      }
      const peak = Math.max(rr, gg, bb) || 1;
      const styleBrightness = parseFloat(this.style.brightness);
      if (subtractive) {
        const brightness = !isNaN(styleBrightness) ? Math.floor(styleBrightness * 255)
          : (Math.min(Math.floor(this._composeColorSumIntensity), 300) || 255);
        return [rr, gg, bb].map(c => Math.max(0, Math.min(255,
          brightness - Math.floor(c / peak * this._composeColorMeanMaxIntensity))));
      }
      const scale = !isNaN(styleBrightness) ? Math.floor(styleBrightness * 255) : this._composeColorMeanMaxIntensity;
      return [rr, gg, bb].map(c => Math.max(0, Math.min(255, Math.floor(c / peak * scale))));
    }

    // .style({classes: N}) numeric range/class buckets — real engine's
    // "distributeValues" (maptheme.js ~12817-13166). Three classification
    // methods implemented: equal-interval/"EQUIDISTANT" (the DEFAULT when
    // no method flag is present, ~line 12983), QUANTILE (~line 13024), and
    // NATURAL/Jenks (~line 13017). Other real methods (HEADTAIL, LOG,
    // POW2, POW3) aren't implemented yet (documented gap, not silently
    // guessed). Class count
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
    _buildPartsA() {
      const values = this.features
        .map(f => parseFloat(f.properties[this.binding.value]))
        .filter(v => !isNaN(v));
      if (!values.length) return;

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
      this._valueMin = nMin;
      this._valueMax = nMax;
      const sorted = values.slice().sort((a, b) => a - b);
      this._valueMedian = sorted[Math.floor((sorted.length - 1) / 2)];
      const nParts = parseInt(this.style.classes, 10) || DEFAULT_RANGE_CLASSES;
      const placeholders = new Array(nParts).fill('');
      const colorsRgb = resolveClassColors(this.style.colorscheme, placeholders);

      this.partsA = this.flags.has('QUANTILE') ? this._quantileBreaks(values, nParts)
        : this.flags.has('NATURAL') ? this._naturalBreaks(values, nParts)
        : this._equalIntervalBreaks(nMin, nMax, nParts);

      this.categoryLabels = this.partsA.map(p => `${this._formatTooltipValue(p.min)} - ${this._formatTooltipValue(p.max)}`);
      this.categoryColorsRgb = colorsRgb;
      // Marks "numeric range/class coloring" (as opposed to CATEGORICAL
      // exact-match, or DOMINANT/COMPOSECOLOR, neither of which call
      // _buildPartsA at all) — _buildAggregationIndex/_buildChartLayers
      // use this to decide whether an AGGREGATE bubble's color must be
      // resolved from the aggregated CELL TOTAL instead of each record's
      // own raw value (see the reclassify step in _buildChartLayers).
      this._rangeClassed = true;
    }

    _equalIntervalBreaks(nMin, nMax, nParts) {
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
    _quantileBreaks(values, nParts) {
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
    _naturalBreaks(values, nParts) {
      const sorted = values.slice().sort((a, b) => a - b);
      const n = sorted.length;

      if (n <= nParts) {
        // not enough distinct items to fill every class -> identity breaks
        const identity = [sorted[0] || 0].concat(sorted);
        while (identity.length < nParts + 1) identity.push(identity[identity.length - 1]);
        return this._partsFromBreakValues(identity, nParts, sorted[n - 1]);
      }

      const sample = n > NATURAL_BREAKS_MAX_SAMPLE ? this._evenStrideSample(sorted, NATURAL_BREAKS_MAX_SAMPLE) : sorted;
      const breakValues = this._jenksBreakValues(sample, nParts);
      return this._partsFromBreakValues(breakValues, nParts, sorted[n - 1]);
    }

    _evenStrideSample(sortedValues, sampleSize) {
      const n = sortedValues.length;
      return new Array(sampleSize).fill(null).map((_, i) =>
        sortedValues[Math.min(Math.round(i * (n - 1) / (sampleSize - 1)), n - 1)]);
    }

    // core Fisher-Jenks DP, ported line-for-line from getNaturalBreaks —
    // mat1/mat2 are the lower-class-limit / cumulative-variance matrices;
    // v is the within-segment sum-of-squared-deviations for the trailing
    // run ending at l, recomputed incrementally as the window grows.
    _jenksBreakValues(valuesA, nParts) {
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
    _partsFromBreakValues(breakValues, nParts, trueMax) {
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
    _resolvePartsClass(value, partsA = this.partsA) {
      if (!partsA || isNaN(value)) return null;
      for (let i = 0; i < partsA.length; i++) {
        const isLast = i === partsA.length - 1;
        const inLower = value >= partsA[i].min;
        const inUpper = isLast ? value <= partsA[i].max : value < partsA[i].max;
        if (inLower && inUpper) return i;
      }
      return null; // outside every class (e.g. explicit user ranges that don't cover the data) -> caller drops the feature
    }

    // Single entry point for "which color-class bucket does this feature's
    // bound value belong to" — CATEGORICAL (exact match), range/class
    // (_buildPartsA, numeric bucket), or neither (a single implicit
    // bucket, today's behavior for any other theme).
    _resolveClassIndex(rawValue) {
      if (this.categoryIndexByLabel) return this.categoryIndexByLabel.get(rawValue);
      if (this.partsA) return this._resolvePartsClass(parseFloat(rawValue));
      return 0;
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
    _resolveDopacityAlpha(f, value, baseOpacity) {
      const scale = parseFloat(this.style.dopacityscale) || 1;
      const pow = 1 / (parseFloat(this.style.dopacitypow) || 1);
      if (this.binding.alpha) {
        if (!this._alphaByFeature) return null;
        const nAlpha = this._alphaByFeature.get(f);
        if (nAlpha == null) return null;
        let nOpacity = scale / Math.pow(this._alphaMax || 1, pow) * Math.pow(nAlpha, pow);
        if (nOpacity < 0.0001) nOpacity = 0;
        return Math.max(0, Math.min(baseOpacity || 0.9, nOpacity));
      }
      if (isNaN(value) || this._valueMin == null) return null;
      const nMin = this._valueMin, nMax = this._valueMax, nMedian = this._valueMedian;
      const bipolar = this.flags.has('DOPACITYMINMAX') || this.flags.has('BIPOLAR') || (nMin < 0 && nMax > 0);
      let nOpacity;
      if (bipolar) {
        nOpacity = value >= nMedian
          ? Math.pow(Math.abs(value - nMedian), pow) / Math.pow((nMax - nMedian) || 1, pow)
          : Math.pow(Math.abs(value - nMedian), pow) / Math.pow((nMedian - nMin) || 1, pow);
      } else if (this.flags.has('DOPACITYMIN')) {
        nOpacity = Math.pow(nMax - value, pow) / Math.pow((nMax - nMin) || 1, pow);
      } else if (this.flags.has('DOPACITYMAX')) {
        nOpacity = Math.pow(value - nMin, pow) / Math.pow((nMax - nMin) || 1, pow);
      } else {
        nOpacity = (value - nMin) / ((nMedian - nMin) || 1) * 0.5;
      }
      nOpacity *= baseOpacity * scale;
      if (nOpacity < 0.0001) nOpacity = 0;
      return Math.max(0, Math.min(baseOpacity || 0.9, nOpacity));
    }

    // group raw features by category — cheap, radius-independent. The
    // actual Supercluster indices are built lazily per resolved aggregation
    // radius (see _ensureClusterIndices), since that radius is a
    // construction-time parameter that can change with zoom per
    // style.aggregation, and Supercluster can't vary it after .load().
    // Re-run whenever the active feature set changes (facet filter, or
    // .binding.size rebound via setSizeField) so clustering always reflects
    // what's actually visible/bound right now.
    // GL-PORT COMPAT: this engine's own idiom for "what to sum per cell" is
    // a dedicated binding.size (independent of binding.value, which drives
    // color/class) — but a real-ixmaps-flat page ported straight across,
    // unmodified, often has only ONE field bound (binding.value) plus an
    // explicit SUM flag, expecting THAT field to be summed (real engine
    // semantics: AGGREGATE|SUM on the bound value sums it). Falling back to
    // a per-record COUNT (this engine's default when binding.size is unset)
    // would silently produce nonsense totals for such a page — this makes
    // SUM without a separate size binding behave like the real source
    // instead of requiring the page to be rewritten with an extra binding.
    _resolveAggregateValue(props) {
      if (this.binding.size) return parseFloat(props[this.binding.size]) || 0;
      if (this.flags.has('SUM') && this.binding.value != null) {
        const v = parseFloat(props[this.binding.value]);
        if (!isNaN(v)) return v;
      }
      return 1;
    }

    _buildAggregationIndex(sourceFeatures) {
      // Range-classed (non-CATEGORICAL numeric) coloring: DON'T pre-split
      // by class here — the real engine aggregates every record together
      // first and classes color from the resulting CELL TOTAL afterward
      // (see the reclassify step in _buildChartLayers), never from each
      // record's own raw value. Splitting by pre-class here would do
      // exactly that wrong thing (and would also keep same-cell,
      // different-class records in separate Supercluster indices, so
      // they'd never even cluster together in the first place). Every
      // feature goes into ONE bucket; _buildChartLayers resolves the real
      // 7-class color once it knows each cell's actual aggregated total.
      if (this._rangeClassed) {
        this._featuresByCategory = [sourceFeatures.map(f => ({
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            value: this._resolveAggregateValue(f.properties),
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

    // `_featuresByCategory` (plain per-category bucketing — NOT yet
    // Supercluster; that's a separate, later step gated by AGGREGATE
    // alone, see _computeAggregatedItems) is needed whenever this runtime
    // will dispatch to _buildChartLayers, i.e. explicit AGGREGATE or
    // CHART+SYMBOL on its own — _buildChartLayers has no other data
    // source to read from (a real page's un-AGGREGATE-flagged BUBBLE type
    // still needs to render, just without any clustering — see
    // _computeAggregatedItems's own AGGREGATE check for that half).
    _usesAggregationIndex() {
      return (this.flags.has('AGGREGATE') || (this.flags.has('CHART') && this.flags.has('SYMBOL'))) && !this.flags.has('GRIDSIZE');
    }

    _rebuildActiveFeatures() {
      // Base set: this.features narrowed by the runtime WHERE-filter
      // (changeThemeStyle's own mechanism, see _runtimeFilterExpr's own
      // comment) if one is active — reusing applyWhereFilter, the SAME
      // parser the layer's load-time .filter(expr) already uses, just
      // invoked again here instead of once at build time.
      const base = this._runtimeFilterExpr
        ? applyWhereFilter({ type: 'FeatureCollection', features: this.features }, this._runtimeFilterExpr).features
        : this.features;
      if (this.facetFilters.size === 0) {
        this._activeFeatures = this._runtimeFilterExpr ? base : null;
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
      this._maxSizeValue = this.binding.size
        ? this.features.reduce((max, f) => {
          const v = parseFloat(f.properties[this.binding.size]);
          return isNaN(v) ? max : Math.max(max, v);
        }, 0)
        : 0;
      if (this._usesAggregationIndex()) this._buildAggregationIndex(this._activeFeatures || this.features);
    }

    setStyle(patch) {
      Object.assign(this.style, patch);
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

    // (re)builds the per-category Supercluster indices at the aggregation
    // radius resolved for the given zoom, but only when that radius has
    // actually changed since the last build — rebuilding on every pan/zoom
    // tick would be wasteful when most moves don't cross a threshold.
    // .style({gridwidth}) (meters, see metersToWorldPixels) takes
    // precedence over .style({aggregation}) (a fixed screen-pixel radius)
    // when both are set.
    //
    // CORRECTED (2026-09-22, user-reported: a 25-meter gridwidth theme was
    // visibly re-aggregating — different cell memberships, different
    // computed per-cell totals — on every zoom change, when a fixed-
    // meters grid must have the SAME membership at every zoom, "always
    // calculated for the entire geographic data extent"). Root cause: the
    // meters branch below used to call `metersToWorldPixels(meters,
    // refLat, zoom)` with the LIVE viewport zoom AND the current
    // viewport bbox's own center latitude — meaning `radiusPx` (and so
    // `this._clusterRadiusPx`, the cache key just below) changed on
    // every zoom tick, forcing Supercluster's entire index to be thrown
    // away and REBUILT from scratch each time, with a DIFFERENT radius
    // parameter. That's backwards: Supercluster's own `radius` option is
    // a SINGLE fixed value applied consistently across every zoom level
    // its own multi-resolution index serves internally — real-world
    // meters per pixel already halves every zoom step in that same
    // convention, so a fixed radius computed ONCE already represents a
    // constant real-world distance at any zoom Supercluster is later
    // queried at (see GRIDWIDTH_METERS_REFERENCE_ZOOM's own comment).
    // Fixed: the reference zoom is now the fixed
    // GRIDWIDTH_METERS_REFERENCE_ZOOM constant (never live `zoom`), and
    // the reference latitude is `this._gridRefLat` — the FULL dataset's
    // own extent, computed once in _prepare() — never the current,
    // panning-dependent viewport bbox. `radiusPx` for this branch is now
    // a true per-theme constant: computed once, cached forever, the
    // Supercluster index built exactly once for the runtime's lifetime
    // (barring an explicit style change to gridwidth/aggregation itself).
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
      if (gridwidthPxMatch) {
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
        const resolved = resolveAggregationPx(this.style.aggregation, zoom, CLUSTER_RADIUS_PX_DEFAULT, this._gridRefLat);
        radiusPx = resolved.px;
        this._clusterUsesFixedZoom = resolved.isMeters;
      }
      if (this._clusterIndices && this._clusterRadiusPx === radiusPx) return;
      this._clusterRadiusPx = radiusPx;
      this._clusterIndices = this._featuresByCategory.map(feats => new global.Supercluster({
        radius: radiusPx,
        maxZoom: 15,
        map: p => ({ value: p.value }),
        reduce: (acc, p) => { acc.value += p.value; }
      }).load(feats));
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

    _buildBubbleIcon(counts, colors) {
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
      const key = counts.map(c => Math.round((c / total) * RATIO_BUCKETS)).join('-');
      if (this._iconCache.has(key)) return this._iconCache.get(key);
      const size = BUBBLE_ICON_SIZE;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const { present, radii, offsets, fitScale } = computeBubblePackLayout(counts, size);
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
    buildTooltipHtml(object) {
      if (!this.meta.tooltip) return null;
      if (!global.Mustache) {
        console.warn('[ixmaps-gl] .meta({tooltip}) is set but Mustache.js is not loaded — ' +
          'include https://unpkg.com/mustache@4.2.0/mustache.min.js before ixmaps-gl.js.');
        return null;
      }
      return global.Mustache.render(this.meta.tooltip, this._buildTooltipContext(object));
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
            title: isGroup ? '' : (this.categoryDisplayLabels ? (this.categoryDisplayLabels[props.cat] || '') : ''),
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
      const swatch = rgb => `<span style="display:inline-block;width:0.7em;height:0.7em;border-radius:50%;background:rgb(${rgb.join(',')});margin-right:0.4em;vertical-align:middle"></span>`;
      const unit = this.style.units ? ' ' + this.style.units : '';

      // PLOT|GRIDSIZE curve cells: properties.values is an array parallel
      // to _plotCategories() (e.g. one FERITI sum per year), not a single
      // category/value pair — none of the shapes below match it. No
      // per-category color here (PLOT's colorscheme is one line color,
      // not a category ramp), so just label: value per line.
      if (Array.isArray(props.values)) {
        const categories = this._plotCategories();
        const labels = Array.isArray(this.style.label) ? this.style.label.map(String) : categories;
        return props.values.map((v, i) => {
          if (v == null || isNaN(v)) return null;
          return `<div>${labels[i] || categories[i] || i}: ${this._formatTooltipValue(v)}${unit}</div>`;
        }).filter(Boolean).join('');
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
        return labels.map((label, i) => {
          if (!(props.counts[i] > 0)) return null;
          const rgb = this.categoryColorsRgb[i];
          return `<div>${swatch(rgb)}${label || '(n/d)'}: ${this._formatTooltipValue(props.counts[i])}${unit}</div>`;
        }).filter(Boolean).join('');
      }
      if (props.cat != null) {
        const label = this.categoryDisplayLabels ? (this.categoryDisplayLabels[props.cat] || '') : '';
        const rgb = this.categoryColorsRgb ? this.categoryColorsRgb[props.cat] : null;
        // no bound size field (e.g. a plain DOT|CATEGORICAL layer) -> just
        // the category label, no ": undefined" value suffix
        const valueSuffix = this._hasValue(props.value) ? `: ${this._formatTooltipValue(props.value)}${unit}` : '';
        return `<div>${rgb ? swatch(rgb) : ''}${label}${valueSuffix}</div>`;
      }
      return '';
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
      return `<table style="font-size:0.85em;border-collapse:collapse">${rows}</table>`;
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
      const rawDecimals = parseFloat(this.style.valuedecimals);
      const decimals = isNaN(rawDecimals) ? 2 : rawDecimals;
      const [intPart, dec] = num.toFixed(decimals).split('.');
      const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      return dec ? `${grouped}.${dec}` : grouped;
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
      if (this.flags.has('FEATURE') || this.flags.has('FEATURES')) return this._buildFeaturesLayers();
      if (this.flags.has('CHART') && this.flags.has('SYMBOL')) return this._buildChartLayers(zoom, bbox, liveZoom, globeCenter);
      console.warn(`[ixmaps-gl] layer "${this.name}": type "${[...this.flags].join('|')}" has no implemented renderer`);
      return [];
    }

    _buildFeaturesLayers() {
      const cs = this.style.colorscheme;
      const raw = Array.isArray(cs) ? cs[0] : cs;
      const filled = raw !== 'none';
      return [new GeoJsonLayer({
        id: `ix-features-${this.name}`,
        data: { type: 'FeatureCollection', features: this.features },
        stroked: true,
        filled,
        // A FEATURES/FEATURE base layer has one flat fill color for every
        // polygon (style.colorscheme[0], or plain style.colorscheme) —
        // unlike CHOROPLETH, there's no per-feature classification here.
        getFillColor: filled ? hexOrNamedToRgb(raw) : [0, 0, 0, 0],
        getLineColor: this.style.linecolor ? hexOrNamedToRgb(this.style.linecolor) : [130, 130, 130],
        lineWidthMinPixels: parseFloat(this.style.linewidth) || 1,
        opacity: parseFloat(this.style.fillopacity) || 1,
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
      })];
    }

    // .type("CHOROPLETH") — a polygon fill from a bound value, three ways:
    // numeric range (QUANTILE/NATURAL/equal-interval, _buildPartsA/
    // _resolveClassIndex, single-field binding.value); DOMINANT's
    // per-polygon argmax across MULTIPLE piped fields (_resolveDominantClass
    // — plain/PERCENTOFMEAN/DEVIATION); or COMPOSECOLOR's per-polygon
    // BLEND across the same piped fields (_resolveComposedColor — no
    // single winning class, so no `cat`/tooltip chart line, just the
    // blended color directly). CATEGORICAL choropleths (exact-match,
    // single field) aren't implemented — no ported config uses that
    // combination yet. Geometry + properties are already the joined
    // FeatureCollection from joinChoroplethFeatures. `zoom` is only used
    // for style.fillopacity:"auto" (see resolveAutoFillOpacity) — every
    // other branch here is zoom-independent.
    _buildChoroplethLayers(zoom) {
      const source = this._activeFeatures || this.features;
      const fallbackRgb = [200, 200, 200]; // unclassified / no joined data for this polygon
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
      const data = source.map(f => {
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
        const value = parseFloat(f.properties[this.binding.value]);
        const cat = this._resolveClassIndex(f.properties[this.binding.value]);
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            value, raw: f.properties, cat,
            dopacityAlpha: dopacityActive ? this._resolveDopacityAlpha(f, value, baseOpacity) : null
          }
        };
      });
      return [new GeoJsonLayer({
        id: `ix-choropleth-${this.name}`,
        data: { type: 'FeatureCollection', features: data },
        pickable: true,
        stroked: true,
        filled: true,
        getFillColor: d => {
          const rgb = d.properties.composedColor
            || (d.properties.cat != null ? this.categoryColorsRgb[d.properties.cat] : null) || fallbackRgb;
          return d.properties.dopacityAlpha != null ? [...rgb, Math.round(d.properties.dopacityAlpha * 255)] : rgb;
        },
        getLineColor: this.style.linecolor ? hexOrNamedToRgb(this.style.linecolor) : [255, 255, 255],
        lineWidthMinPixels: parseFloat(this.style.linewidth) || 1,
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
      const cellPx = parseFloat(this.style.gridwidthpx) || GRID_WIDTH_PX_DEFAULT;
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
        const snapped = snapToAggregationGrid(p.x, p.y, cellPx, this.flags);
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

    // real engine's SUM (default) vs MEAN aggregation per cell per
    // category — resolved at consumption time from the raw sums/counts
    // _ensureGridIndex stores, not baked in, so the same grid index could
    // serve either without rebinning.
    _cellAggregatedValues(cell) {
      const useMean = this.flags.has('MEAN');
      return cell.sums.map((s, i) => (useMean && cell.counts[i] > 0 ? s / cell.counts[i] : s));
    }

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
      const categories = this._plotCategories();
      if (!categories.length) return [];
      const labels = Array.isArray(this.style.label) ? this.style.label.map(String) : categories;

      const data = this._gridIndex.map(cell => {
        const center = worldPixelToLngLat(cell.px, cell.py, zoom);
        return {
          geometry: { type: 'Point', coordinates: [center.lng, center.lat] },
          properties: { values: this._cellAggregatedValues(cell) }
        };
      });

      const iconSize = (parseFloat(this.style.gridwidthpx) || GRID_WIDTH_PX_DEFAULT) * (parseFloat(this.style.scale) || 1);

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
      let normalSizeValue = parseFloat(this.style.normalsizevalue);
      let datasetMax = 0;
      data.forEach(d => d.properties.values.forEach(v => { if (v > datasetMax) datasetMax = v; }));
      datasetMax = datasetMax || 1;
      if (isNaN(normalSizeValue)) normalSizeValue = datasetMax;

      return [new IconLayer({
        id: `ix-plot-${this.name}-g${this._iconGeneration}`,
        data, pickable: true,
        getPosition: d => d.geometry.coordinates,
        getIcon: d => this._buildPlotIcon(d.properties.values, categories, labels, normalSizeValue, datasetMax),
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
    _buildPlotIcon(values, categories, labels, normalSizeValue, datasetMax) {
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
      const rangeScale = parseFloat(this.style.rangescale) || 1;
      const definedValues = plotValues.filter(v => v != null && !isNaN(v));
      const styleMin = parseFloat(this.style.minvalue);
      const styleMax = parseFloat(this.style.maxvalue);
      const autoMin = 0;
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
      const baseMarkerR = parseFloat(this.style.markersize) || 0;
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
      const boxOpacity = parseFloat(this.style.boxopacity);
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
        const fillOpacity = parseFloat(this.style.fillopacity);
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
        ctx.lineWidth = parseFloat(this.style.linewidth) || 1;
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
      const borderColor = Array.isArray(this.style.linecolor) ? this.style.linecolor[0] : this.style.linecolor;
      const borderWidth = Array.isArray(this.style.linewidth) ? parseFloat(this.style.linewidth[0]) : parseFloat(this.style.linewidth);
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
        opacity: parseFloat(this.style.fillopacity) || 1
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
    // RELOCATE only ever changes WHERE an already-aggregated group is
    // drawn — never which records get grouped together (that's
    // Supercluster's per-category radius clustering, unaffected either
    // way). Without RELOCATE, a grid-aggregated value (this pipeline —
    // "aggregation by field" is a separate, not-yet-implemented mode) is
    // positioned at the center of its RECT/hexbin grid element, not at
    // Supercluster's own internally-computed centroid: snap that
    // cluster's centroid through the SAME shared snapToAggregationGrid
    // (hex by default, RECT if flagged) _groupCoLocated uses below, at
    // the same cell width Supercluster itself just clustered with. With
    // RELOCATE, _groupCoLocated instead positions at the mean of the
    // ORIGINAL member positions (and additionally merges same-cell
    // clusters across categories) — the two branches share the same grid
    // math, they just use it for a different purpose.
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

      // For a fixed-real-world-METERS gridwidth, BOTH the Supercluster
      // query and the RELOCATE/grid-snap positioning below must run at
      // the SAME fixed reference zoom the index itself was built at
      // (_ensureClusterIndices) — querying Supercluster's own multi-
      // resolution hierarchy at the LIVE zoom instead would still return
      // a DIFFERENT level of its internal merge hierarchy per zoom (more
      // aggressive merging as you zoom "out" through that hierarchy),
      // even though the underlying index itself is now built exactly
      // once — Supercluster is fundamentally a zoom-ADAPTIVE multi-
      // resolution structure, and only querying it at a CONSTANT zoom
      // yields a truly zoom-invariant result. Rendering (on-screen bubble
      // size) is unaffected — that already scales with the separate,
      // always-live `liveZoom` passed through valueRadius(), not this.
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
      const groups = doRelocate ? this._groupCoLocated(clusterFeatures, effectiveZoom) : clusterFeatures.map(f => {
        const cellPx = this._clusterRadiusPx || CLUSTER_RADIUS_PX_DEFAULT;
        const [lng, lat] = f.geometry.coordinates;
        const p = lngLatToWorldPixel(lng, lat, effectiveZoom);
        const snapped = snapToAggregationGrid(p.x, p.y, cellPx, this.flags);
        const ll = worldPixelToLngLat(snapped.x, snapped.y, effectiveZoom);
        return {
          geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
          properties: { counts: this._oneHot(f.properties.cat, f.properties.point_count), total: f.properties.value }
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

      // NOOUTLIER — see the block this replaces for the full real-source
      // citation (maptheme.js distributeValues, population mean/stddev).
      let outlier = null;
      if (this.flags.has('NOOUTLIER') && totals.length) {
        const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
        const variance = totals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / totals.length;
        const threshold = Math.sqrt(variance) * (parseFloat(this.style.outlierscale) || 3);
        outlier = { mean, threshold };
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
      if (this._rangeClassed && totals.length) {
        const nParts = this.categoryLabels.length;
        let nMin = Infinity, nMax = -Infinity;
        for (const v of totals) { if (v < nMin) nMin = v; if (v > nMax) nMax = v; }
        breaks = this.flags.has('QUANTILE') ? this._quantileBreaks(totals, nParts)
          : this.flags.has('NATURAL') ? this._naturalBreaks(totals, nParts)
          : this._equalIntervalBreaks(nMin, nMax, nParts);
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
      // Supercluster indices are only needed by the AGGREGATE clustering
      // path inside _computeAggregatedItems below — building them for a
      // plain (non-AGGREGATE) BUBBLE/CHART theme would be pure waste (a
      // full re-index of the whole dataset, every redraw, for indices
      // that branch never reads).
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

        if (stats.outlier) {
          const { mean, threshold } = stats.outlier;
          for (let i = individual.length - 1; i >= 0; i--) {
            if (Math.abs(individual[i].properties.value - mean) > threshold) individual.splice(i, 1);
          }
          for (let i = groups.length - 1; i >= 0; i--) {
            if (Math.abs(groups[i].properties.total - mean) > threshold) groups.splice(i, 1);
          }
        }

        if (stats.normalize) {
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
          individual.forEach(d => { d.properties.cat = classify(d.properties.value); });
          groups.forEach(d => {
            const cat = classify(d.properties.total);
            const counts = new Array(nParts).fill(0);
            counts[cat] = d.properties.total;
            d.properties.counts = counts;
          });
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
      const fillOpacity = parseFloat(this.style.fillopacity) || 0.85;
      // .style({linecolor, linewidth}) — an individual icon's own border,
      // see _buildSingleIcon's own comment. Real ixmaps-flat symbol
      // markers do draw an outline (confirmed by a real ported page
      // explicitly setting both), unlike this port's own pre-existing
      // bubble icons, which never had one — computed once here (a
      // per-theme constant, not per-record) rather than inside the
      // getIcon callback below.
      const singleBorderColorRgb = this.style.linecolor && this.style.linecolor !== 'none' ? hexOrNamedToRgb(this.style.linecolor) : null;
      const singleBorderWidthPx = parseFloat(this.style.linewidth) || 0;

      // GLOW: gradient-texture halo (see _getGlowIcon for why this diverges
      // from the real engine's literal flat-circle formula). Individual
      // and cluster glows keep their own size multiplier (11 vs 9 — a lone
      // point and a packed cluster read differently at the same radius)
      // but share one sorted layer, same as the main bubbles below.
      if (this.flags.has('GLOW')) {
        layers.push(new IconLayer({
          id: `ix-glow-${this.name}-g${this._iconGeneration}`,
          data: combined, pickable: false,
          getPosition: d => d.geometry.coordinates,
          getIcon: d => this._getGlowIcon(this.categoryColorsRgb[d.properties.counts ? dominant(d.properties.counts) : d.properties.cat]),
          getSize: d => valueRadius(sizeValueOf(d), liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue) * (d.properties.counts ? 9 : 11),
          getColor: d => [255, 255, 255, this._iconAlpha(d)],
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
          ? this._buildBubbleIcon(d.properties.counts, this.categoryColorsRgb)
          : this._buildSingleIcon(this.categoryColorsRgb[d.properties.cat], fillOpacity, this._resolveSymbolShape(d.properties), singleBorderColorRgb, singleBorderWidthPx),
        getSize: d => valueRadius(sizeValueOf(d), liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue) * 2,
        getColor: d => [255, 255, 255, this._iconAlpha(d)],
        sizeUnits: 'pixels',
        billboard: true,
        parameters: ICON_LAYER_GLOBE_PARAMETERS
      }));

      // VALUES: bold value label centered on each bubble (see
      // formatBubbleValue/valuesFontSizePx above). Labels are their own
      // layers, added last in the array so they draw on top of every icon
      // layer (a small bubble's label can still show over a bigger
      // neighboring bubble's icon — a known, accepted gap). Entries whose
      // computed font size would be sub-pixel are dropped rather than
      // rendered at getSize: 0, matching the real engine's own "too
      // small to bother" gate.
      if (this.flags.has('VALUES') && !valuesHiddenByScale(this.style, zoom)) {
        const valueScale = parseFloat(this.style.valuescale) || 1;

        const pointLabels = individual.reduce((out, d) => {
          const radius = valueRadius(d.properties.value, liveZoom, this.style, this.mapOptions, this.flags, this._maxSizeValue);
          const text = formatBubbleValue(d.properties.value, this.style);
          const fontSize = valuesFontSizePx(radius, text, valueScale);
          if (fontSize > VALUES_MIN_FONT_PX) {
            out.push({ geometry: d.geometry, text, fontSize, color: resolveTextColor(this.style, contrastTextColor(this.categoryColorsRgb[d.properties.cat])) });
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
          const { present, radii, offsets, fitScale } = computeBubblePackLayout(counts, BUBBLE_ICON_SIZE);

          present.forEach((p, i) => {
            const text = formatBubbleValue(p.c, this.style);
            const subRadiusPx = radii[i] * fitScale * pxPerCanvasUnit;
            const fontSize = valuesFontSizePx(subRadiusPx, text, valueScale);
            if (fontSize > VALUES_MIN_FONT_PX) {
              out.push({
                geometry: d.geometry, text, fontSize,
                color: resolveTextColor(this.style, contrastTextColor(this.categoryColorsRgb[p.i])),
                pixelOffset: [offsets[i].x * fitScale * pxPerCanvasUnit, offsets[i].y * fitScale * pxPerCanvasUnit]
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
        if (pointLabels.length) layers.push(new TextLayer({ id: `ix-points-values-${this.name}`, data: pointLabels, ...textLayerCommonProps }));
        if (groupLabels.length) layers.push(new TextLayer({ id: `ix-cluster-values-${this.name}`, data: groupLabels, getPixelOffset: d => d.pixelOffset, ...textLayerCommonProps }));
      }

      return layers;
    }

    _oneHot(cat, value) {
      const arr = new Array(this.categoryLabels.length).fill(0);
      arr[cat] = value;
      return arr;
    }

    _groupCoLocated(clusterFeatures, zoom) {
      // Merge tolerance MUST track the same theme-driven, scale-dependent
      // aggregation width the clustering itself just used (this._clusterRadiusPx,
      // set by _ensureClusterIndices right before this runs) — not an
      // independent constant. Grouping and clustering are two views of the
      // same "how close counts as the same spot" question at the current
      // map scale, so they need the same answer.
      const cellPx = this._clusterRadiusPx || CLUSTER_RADIUS_PX_DEFAULT;
      const cells = new Map();
      const n = this.categoryLabels.length;
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
        const snapped = snapToAggregationGrid(p.x, p.y, cellPx, this.flags);
        const key = `${snapped.x}:${snapped.y}`;
        let cell = cells.get(key);
        if (!cell) { cell = { sumX: 0, sumY: 0, n: 0, counts: new Array(n).fill(0), recordCounts: new Array(n).fill(0) }; cells.set(key, cell); }
        cell.sumX += p.x; cell.sumY += p.y; cell.n++;
        cell.counts[f.properties.cat] += f.properties.value;
        // point_count is Supercluster's own built-in aggregated-record
        // count (absent on an un-clustered leaf, which is exactly 1 record)
        // — tracked separately from counts (the summed bound VALUE) purely
        // for the tooltip's theme.item.count.
        cell.recordCounts[f.properties.cat] += (f.properties.point_count || 1);
      });
      return Array.from(cells.values()).map(cell => {
        const ll = worldPixelToLngLat(cell.sumX / cell.n, cell.sumY / cell.n, zoom);
        return {
          geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
          properties: { counts: cell.counts, total: cell.counts.reduce((a, c) => a + c, 0), recordCounts: cell.recordCounts }
        };
      });
    }
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

  function hexOrNamedToRgb(v) {
    if (typeof v === 'string' && v[0] === '#') return hexToRgb(v);
    const NAMED = { gray: [128, 128, 128], grey: [128, 128, 128], black: [0, 0, 0], white: [255, 255, 255] };
    return NAMED[v] || [130, 130, 130];
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

  // GL-PORT COMPAT: real ixmaps-flat's ixmaps.getThemeObj(szId) — a
  // global lookup by theme id, independent of which map built it — looked
  // up from _globalThemeRegistry (see its own comment for the "last
  // definition wins" caveat). Returns null for an unknown id, same as the
  // real engine, rather than throwing.
  function getThemeObj(szId) {
    const rt = _globalThemeRegistry.get(szId);
    if (!rt) return null;
    return {
      szId: rt.name,
      szName: rt.name,
      szFilter: rt._filterExpr || '',
      szFlag: Array.from(rt.flags).join('|'),
      fVisible: !rt._hidden
    };
  }

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
    if (!rt) return;
    rt._markedClasses.add(index);
    if (rt._triggerRedraw) rt._triggerRedraw();
  }
  function unmarkThemeClass(szId, index) {
    const rt = _globalThemeRegistry.get(szId);
    if (!rt) return;
    rt._markedClasses.delete(index);
    if (rt._triggerRedraw) rt._triggerRedraw();
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
        zoom: map.getZoom()
      }
    });
  }
  function setProjectJSON(project) {
    if (!_lastMapApi || !_lastMapApi.map) return;
    const map = _lastMapApi.map;
    const m = (project && project.map) || {};
    const wantsGlobe = /orthographic\.svg$/i.test(String(m.map || ''));
    if (typeof map.setProjection === 'function') {
      try { map.setProjection({ type: wantsGlobe ? 'globe' : 'mercator' }); }
      catch (e) { console.warn('[ixmaps-gl] setProjectJSON: map.setProjection failed (needs maplibre-gl >=5.0.1)', e); }
    } else {
      console.warn('[ixmaps-gl] setProjectJSON: map.setProjection not available on the loaded maplibre-gl build (needs >=5.0.1) — projection unchanged');
    }
    const c = m.center;
    const z = typeof m.zoom === 'number' ? m.zoom : undefined;
    if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
      map.jumpTo(Object.assign({ center: [c.lng, c.lat] }, z !== undefined ? { zoom: z } : {}));
    } else if (z !== undefined) {
      map.jumpTo({ zoom: z });
    }
  }

  global.ixmaps = {
    layer, Map: createMap, setExternalData: setExternalDataBridge, getThemeObj, data: ixmapsData,
    szResourceBase: ixmapsSzResourceBase, getProjectString, setProjectJSON,
    markThemeClass, unmarkThemeClass,
    // carried over from a page's own pre-load `ixmaps.validate = ...`
    validate: _preloadValidate
  };
  // Bare globals, not namespaced under ixmaps — matches the real engine's
  // own convention (see their shared comment above) of exposing these
  // directly on window for inline-HTML/onclick callers, not only via a
  // library object.
  global.__setFacetFilter = __setFacetFilter;
  // test-only: lets test/unit/*.test.mjs call pure internals directly (the
  // engine runs in a Node vm there); deliberately NOT on the ixmaps object
  global.__ixmapsGlInternals = { normalizeTheme, LayerBuilder };
  global.__setFilter = __setFilter;
  global.__removeFacets = __removeFacets;
})(window);
