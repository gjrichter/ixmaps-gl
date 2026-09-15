// =======================================================================
// ixmaps-engine.js — a generic, config-driven map/theme engine exposing
// the SAME declarative builder API as the original ixmaps framework
// (ixmaps.Map(...), ixmaps.layer(...).data().binding().filter().type()
// .style().meta()), rendering through MapLibre GL + deck.gl instead of
// ixmaps' own SVG/Leaflet engine.
//
// Scope note (read this before assuming a keyword "works"): this engine
// fully implements the theme-type grammar our real layers exercise —
// FEATURE/FEATURES (polygon/line rendering, singular is the real engine's
// own keyword, plural this port's earlier convention — both accepted),
// CHOROPLETH (polygon fill classed by a bound numeric value — QUANTILE/
// NATURAL/equal-interval only so far; CATEGORICAL/DOMINANT choropleths are
// not implemented yet, see _buildChoroplethLayers), and the CHART|SYMBOL|
// GLOW|CATEGORICAL|AGGREGATE|COUNT|RELOCATE|VALUES pipeline (categorical
// clustering + sizing + glow + multi-bubble grouping + on-bubble value
// labels, generalized to however many distinct category values the DATA
// actually contains — never hardcoded), plus DOT, the real engine's
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

  const { IconLayer, ScatterplotLayer, GeoJsonLayer, MapboxOverlay, TextLayer } = global.deck;

  // Matches the real engine's own ui/js/tools/tooltip_mustache.js, which
  // overrides Mustache.escape to identity: tooltip HTML (the template
  // itself, and this engine's own chart/data-table fragments — see
  // LayerRuntime.buildTooltipHtml) is trusted markup, not user input, so
  // interpolated values are inserted raw rather than HTML-escaped.
  if (global.Mustache) {
    global.Mustache.escape = text => text;
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
      throw new Error('[ixmaps-engine] CSV .data() needs .binding({position: "YFIELD|XFIELD"}) — no embedded geometry to fall back to');
    }
    const features = [];
    for (const row of rows) {
      const lat = parseEuroFloat(row[yField]), lon = parseEuroFloat(row[xField]);
      if (isNaN(lat) || isNaN(lon)) continue;
      features.push({ type: 'Feature', properties: row, geometry: { type: 'Point', coordinates: [lon, lat] } });
    }
    return { type: 'FeatureCollection', features };
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
      console.warn('[ixmaps-engine] ixmaps.setExternalData called with no pending .data({query}) fetch — ignored');
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
  // src=".../data.js"> before ixmaps-engine.js, same as a real page) —
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
    if (!dataConfig || (!dataConfig.url && !dataConfig.urls && !dataConfig.query)) {
      throw new Error('[ixmaps-engine] layer .data() needs a url, urls, or query');
    }

    if (dataConfig.query) {
      if (!global.Data) {
        throw new Error('[ixmaps-engine] .data({query}) needs the real data.js loaded first — ' +
          '<script src="https://cdn.jsdelivr.net/gh/gjrichter/data.js@master/data.js"> before ixmaps-engine.js');
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
        if (!resp.ok) throw new Error(`[ixmaps-engine] failed to fetch ${url}: ${resp.status}`);
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
    if (!resp.ok) throw new Error(`[ixmaps-engine] failed to fetch ${dataConfig.url}: ${resp.status}`);
    if (dataConfig.type === 'topojson') return topojsonToFeatureCollection(await resp.json());
    if (dataConfig.type === 'geojson') return resp.json();
    throw new Error(`[ixmaps-engine] unsupported data type "${dataConfig.type}" (topojson/geojson/csv implemented)`);
  }

  // ---------------------------------------------------------------
  // .filter("WHERE field = value") — the one predicate form our real
  // layer config uses; unsupported expressions are left unfiltered with
  // a warning rather than silently mis-filtering
  // ---------------------------------------------------------------

  function applyWhereFilter(fc, filterExpr) {
    if (!filterExpr) return fc;
    const m = /^\s*WHERE\s+(\S+)\s*=\s*(.+?)\s*$/i.exec(filterExpr);
    if (!m) {
      console.warn('[ixmaps-engine] unsupported filter expression, left unfiltered:', filterExpr);
      return fc;
    }
    const [, field, rawValue] = m;
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
  function joinChoroplethFeatures(lb, table, runtimes) {
    const geomRt = runtimes.find(r => r.name === lb.name && (r.flags.has('FEATURE') || r.flags.has('FEATURES')));
    if (!geomRt) {
      throw new Error(`[ixmaps-engine] CHOROPLETH layer "${lb.name}" needs a FEATURE base layer with the same name, .layer()'d earlier on the map`);
    }
    const idField = geomRt.binding.id;
    const lookupField = lb._binding.lookup;
    if (!idField || !lookupField) {
      throw new Error(`[ixmaps-engine] CHOROPLETH layer "${lb.name}" needs .binding({lookup}), and its FEATURE base needs .binding({id})`);
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

  function resolveColorScheme(colorscheme, labels) {
    if (!colorscheme) return labels.map((_, i) => FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]);
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
        console.warn('[ixmaps-engine] colorscheme function failed to evaluate, using fallback palette:', err);
      }
    }
    return labels.map((_, i) => FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]);
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ---------------------------------------------------------------
  // builder API — chainable, matches the original ixmaps syntax exactly
  // ---------------------------------------------------------------

  // NOSORT: confirmed inert in the REAL engine too, not just unimplemented
  // here — its own drawChart only checks /\bSORT\b/, which never matches
  // inside the substring "NOSORT" (a real self-inflicted no-op flag in the
  // source we're porting, per direct verification against it).
  const KNOWN_INERT_FLAGS = ['SEQUENCE', 'STAR', 'SORT', 'DOWN', 'RECT', 'CLIPTOGEOBOUNDS', 'OUTLIER', 'NOOUTLIER',
    'HEADTAIL', 'LOG', 'POW2', 'POW3', 'NOSORT'];
  const _warnedFlags = new Set();

  class LayerBuilder {
    constructor(name) {
      this.name = name;
      this._data = null;
      this._binding = {};
      this._filterExpr = null;
      this._typeStr = '';
      this._flags = new Set();
      this._style = {};
      this._meta = {};
    }
    data(d) { this._data = d; return this; }
    binding(b) { this._binding = b; return this; }
    filter(expr) { this._filterExpr = expr; return this; }
    type(t) {
      this._typeStr = t;
      this._flags = new Set(t.split('|'));
      this._flags.forEach(flag => {
        if (KNOWN_INERT_FLAGS.includes(flag) && !_warnedFlags.has(flag)) {
          _warnedFlags.add(flag);
          console.info(`[ixmaps-engine] type flag "${flag}" recognized, no distinct rendering behavior implemented yet`);
        }
      });
      return this;
    }
    style(s) { this._style = s; return this; }
    meta(m) { this._meta = m; return this; }
  }

  function layer(name, configFn) {
    const builder = new LayerBuilder(name);
    if (configFn) configFn(builder);
    return builder;
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
    view(latlon, zoom) { this._viewCenter = latlon; this._viewZoom = zoom; return this; }
    options(o) { this._engineOptions = o; return this; }
    local(...args) { this._locals.push(args); return this; }
    attribution(a) { this._attributionText = a; return this; }
    legend(html) { this._legendHtml = html; return this; }
    layer(layerBuilder) { this._layerBuilders.push(layerBuilder); return this; }

    async build() {
      const el = document.getElementById(this.containerId);
      if (!el) throw new Error(`[ixmaps-engine] container #${this.containerId} not found`);

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
        const cacheKey = JSON.stringify({ url: lb._data && lb._data.url, urls: lb._data && lb._data.urls, type: lb._data && lb._data.type, query: lb._data && lb._data.query });
        if (!dataCache.has(cacheKey)) dataCache.set(cacheKey, fetchLayerData(lb._data, lb._binding));
        const raw = await dataCache.get(cacheKey);
        const filtered = applyWhereFilter(raw, lb._filterExpr);
        const fc = filtered.type === 'Table' ? joinChoroplethFeatures(lb, filtered, runtimes) : filtered;
        const rt = new LayerRuntime(lb, fc, this._engineOptions);
        // tags which underlying data source this runtime came from — see
        // setFacetFilter/clearFacetFilter/clearAllFacetFilters below,
        // which use this to propagate a facet filter to every theme
        // sharing the SAME data, not just the one the sidebar was built
        // against.
        rt._dataSourceKey = cacheKey;
        runtimes.push(rt);
      }

      const [lat, lon] = this._viewCenter || [45.5, 9.2];
      const map = new maplibregl.Map({
        container: this.containerId,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [lon, lat],
        zoom: this._viewZoom || 8
      });

      // Tooltip resolution is per-runtime (each theme's own meta.tooltip
      // template), not generic — a layer id exactly matches one of the
      // pickable ids a runtime's buildDeckLayers() produced (ix-points-/
      // ix-cluster-/ix-dot-/ix-features-/ix-choropleth- + that runtime's
      // own name); the glow and values (label) layers are pickable:false
      // so they never reach here.
      //
      // Each id-pattern check is paired with the flag(s) that actually
      // produce it, not matched by name alone — necessary now that a
      // CHOROPLETH runtime and its FEATURE base runtime share the SAME
      // .layer() name by design (joinChoroplethFeatures): matching by name
      // alone would make `.find()` return whichever of the two happens to
      // come FIRST in `runtimes` for every layer id, not the one that
      // actually produced it.
      function findRuntimeForLayerId(layerId) {
        // icon-atlas-based layer ids (ix-cluster-/ix-cluster-glow-/
        // ix-points-glow-/ix-plot-/ix-grid-) carry a rotating "-gN"
        // generation suffix (see ICON_ATLAS_RESET_AFTER) — strip it before
        // matching so hover/click tooltip lookup keeps working across a
        // rotation. Non-atlas layers (ix-points-/ix-dot-/ix-features-/
        // ix-choropleth-) never carry the suffix; stripping a pattern
        // that isn't there is a no-op.
        const base = layerId.replace(/-g\d+$/, '');
        return runtimes.find(r => {
          if (base === `ix-points-${r.name}` || base === `ix-cluster-${r.name}`) return r.flags.has('CHART') && r.flags.has('SYMBOL');
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

      // Identity check for "is this hovered object the same one that's
      // pinned" — object references are rebuilt from scratch on every
      // redraw (new individual/group arrays each buildDeckLayers call), so
      // reference equality never works here. Same layer + same geometry
      // position is a reasonable proxy: individual points and aggregated
      // groups alike are keyed by position within a layer, matching how
      // clustering itself already treats "same position" as "same thing".
      function isSameAsPinned(layerId, object) {
        if (pinned.layerId !== layerId) return false;
        const a = object.geometry && object.geometry.coordinates;
        const b = pinned.object.geometry && pinned.object.geometry.coordinates;
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

      const overlay = new MapboxOverlay({
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
              const lngLat = (info.object.geometry && info.object.geometry.coordinates) || info.coordinate;
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
      // etc. address themes by style.name, so both need to resolve
      function findRuntime(themeId) {
        const rt = runtimes.find(r => r.name === themeId || (r.style && r.style.name === themeId));
        if (!rt) console.warn(`[ixmaps-engine] no layer named "${themeId}"`);
        return rt;
      }

      // Every runtime loaded from the same .data() source (see build()'s
      // _dataSourceKey tag) — used to propagate a facet filter to every
      // theme actually built on that data, not just the one named theme.
      function siblingRuntimes(rt) {
        return runtimes.filter(r => r._dataSourceKey === rt._dataSourceKey);
      }

      const redrawListeners = [];

      const engineApi = {
        map,
        overlay,
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
        setThemeStyle: (themeId, patch) => {
          const rt = findRuntime(themeId);
          if (rt) { rt.setStyle(patch); refresh(); }
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
        refresh: () => refresh()
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
      function refreshLayers() {
        const liveZoom = map.getZoom();
        const zoom = isZooming ? stableGridZoom : liveZoom;
        const bounds = map.getBounds();
        const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
        let layers = [];
        runtimes.forEach(rt => layers.push(...rt.buildDeckLayers(zoom, bbox)));
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
        refreshLayers();
      });

      function notifyRedraw() {
        redrawListeners.forEach(cb => { try { cb(); } catch (err) { console.error('[ixmaps-engine] onRedraw callback failed:', err); } });
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

      map.on('load', refresh);

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

      return engineApi;
    }
  }

  // named createMap (not Map) so it doesn't shadow the built-in ES6 Map
  // class used throughout this file — a real bug caught during testing
  // (every `new Map()` below silently resolved to *this* function instead)
  function createMap(containerId, options, mapFn) {
    const builder = new MapBuilder(containerId, options);
    if (mapFn) mapFn(builder);
    return builder.build();
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
  // (map-scale-ratio threshold, aggregation grid size in pixels). Scale
  // denominator is approximated from zoom using the standard 96dpi Web
  // Mercator formula (this is the one piece of the original engine's
  // internals we don't have source for, so treat the exact threshold
  // crossover as a documented approximation, not a guaranteed match).
  // Picks the finest (smallest-ratio) step whose threshold still covers
  // the current scale, falling back to the coarsest step once zoomed out
  // past all of them.
  function resolveAggregationPx(aggregation, zoom, fallbackPx) {
    if (!Array.isArray(aggregation) || aggregation.length < 2) return fallbackPx;
    const steps = [];
    for (let i = 0; i + 1 < aggregation.length; i += 2) {
      const ratioMatch = /^1:(\d+(?:\.\d+)?)$/.exec(aggregation[i]);
      const pxMatch = /^(\d+(?:\.\d+)?)px$/.exec(aggregation[i + 1]);
      if (ratioMatch && pxMatch) steps.push({ ratio: parseFloat(ratioMatch[1]), px: parseFloat(pxMatch[1]) });
    }
    if (!steps.length) return fallbackPx;
    steps.sort((a, b) => a.ratio - b.ratio);
    const scaleDenominator = WEBMERCATOR_SCALE_CONSTANT / Math.pow(2, zoom || DEFAULT_ZOOM_REFERENCE);
    // real scale denominators (thousands at street level, hundreds of
    // millions zoomed out to the world) are always >= these ratios, so
    // "1:1" only ever means "the finest/default step" — walk ascending and
    // keep the largest threshold the current scale still clears
    let chosen = steps[0];
    for (const step of steps) {
      if (scaleDenominator >= step.ratio) chosen = step; else break;
    }
    return chosen.px;
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
    constructor(builder, fc, mapOptions) {
      this.name = builder.name;
      this.binding = builder._binding || {};
      this.flags = builder._flags || new Set();
      this.style = builder._style || {};
      this.meta = builder._meta || {};
      this.mapOptions = mapOptions || {};
      this.features = fc.features;
      this._iconCache = new Map();
      this._glowIconCache = new Map();
      this._clusterIndices = null;
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

      if (this.flags.has('CATEGORICAL') && this.binding.value) {
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
        const resolved = resolveColorScheme(this.style.colorscheme, this.categoryDisplayLabels);
        this.categoryColorsRgb = (resolved || this.categoryLabels.map((_, i) => FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]))
          .map(hexToRgb);
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

      // GRIDSIZE layers (PLOT curves-chart, or its grid-mesh companion)
      // also carry AGGREGATE in their type string, but they bin into a
      // spatial grid (_ensureGridIndex), not Supercluster's per-category
      // clustering — building _featuresByCategory for them would be wasted
      // work (up to the full dataset, never consumed by buildDeckLayers).
      if (this.flags.has('AGGREGATE') && !this.flags.has('GRIDSIZE')) {
        this._buildAggregationIndex(this.features);
      }
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
    // array / "none" / stringified fn), sliced positionally per class —
    // one color per class, no gradient interpolation between anchors (not
    // needed for a plain N-color array, and this engine has no equivalent
    // to the real engine's diverging 2/3-anchor sweep to begin with).
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
      const nParts = parseInt(this.style.classes, 10) || DEFAULT_RANGE_CLASSES;
      const placeholders = new Array(nParts).fill('');
      const resolved = resolveColorScheme(this.style.colorscheme, placeholders);
      const colorsRgb = (resolved || placeholders.map((_, i) => FALLBACK_PALETTE[i % FALLBACK_PALETTE.length])).map(hexToRgb);

      this.partsA = this.flags.has('QUANTILE') ? this._quantileBreaks(values, nParts)
        : this.flags.has('NATURAL') ? this._naturalBreaks(values, nParts)
        : this._equalIntervalBreaks(nMin, nMax, nParts);

      this.categoryLabels = this.partsA.map(p => `${this._formatTooltipValue(p.min)} - ${this._formatTooltipValue(p.max)}`);
      this.categoryColorsRgb = colorsRgb;
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

    _resolvePartsClass(value) {
      if (!this.partsA || isNaN(value)) return null;
      for (let i = 0; i < this.partsA.length; i++) {
        const isLast = i === this.partsA.length - 1;
        const inLower = value >= this.partsA[i].min;
        const inUpper = isLast ? value <= this.partsA[i].max : value < this.partsA[i].max;
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

    // group raw features by category — cheap, radius-independent. The
    // actual Supercluster indices are built lazily per resolved aggregation
    // radius (see _ensureClusterIndices), since that radius is a
    // construction-time parameter that can change with zoom per
    // style.aggregation, and Supercluster can't vary it after .load().
    // Re-run whenever the active feature set changes (facet filter, or
    // .binding.size rebound via setSizeField) so clustering always reflects
    // what's actually visible/bound right now.
    _buildAggregationIndex(sourceFeatures) {
      const nCategories = this.categoryLabels ? this.categoryLabels.length : 1;
      this._featuresByCategory = new Array(nCategories).fill(null).map(() => []);
      sourceFeatures.forEach(f => {
        const cat = this._resolveClassIndex(f.properties[this.binding.value]);
        if (cat == null) return;
        // no sizefield bound (style.name's sizeField toggled off) -> COUNT
        // aggregation, one unit per record, matching the real engine's
        // fallback when sizefield is empty
        const value = this.binding.size ? (parseFloat(f.properties[this.binding.size]) || 0) : 1;
        this._featuresByCategory[cat].push({
          type: 'Feature',
          geometry: f.geometry,
          properties: { value, raw: f.properties }
        });
      });
      this._clusterIndices = null;
      this._clusterRadiusPx = null;
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

    _rebuildActiveFeatures() {
      if (this.facetFilters.size === 0) {
        this._activeFeatures = null;
      } else {
        const clauses = Array.from(this.facetFilters.entries());
        this._activeFeatures = this.features.filter(f =>
          clauses.every(([field, clause]) => matchesFacetClause(f.properties[field], clause)));
      }
      if (this.flags.has('AGGREGATE')) this._buildAggregationIndex(this._activeFeatures || this.features);
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
      if (this.flags.has('AGGREGATE')) this._buildAggregationIndex(this._activeFeatures || this.features);
    }

    setStyle(patch) {
      Object.assign(this.style, patch);
    }

    // Viewport + active-filter scoped facet stats for szFieldsA, matching
    // the real ixmaps.data.getFacets/showFacets behavior (facet.js /
    // show_facets.js): per field, tally occurrences (weighted by
    // sizeField, defaulting to this.binding.size) and sort descending —
    // only fields with a modest number of distinct values in scope get a
    // bar list (.values); fields with many distinct values (e.g. free-text
    // street names) come back as 'freetext' (search-only, no bar list),
    // matching the real engine's own numeric-input-facet fallback path
    // once forced non-numeric.
    getFacets(fields, opts) {
      opts = opts || {};
      const sizeField = opts.sizeField !== undefined ? opts.sizeField : this.binding.size;
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
          isActive: activeClause != null, activeClause
        };
      });
    }

    // (re)builds the per-category Supercluster indices at the aggregation
    // radius resolved for the given zoom, but only when that radius has
    // actually changed since the last build — rebuilding on every pan/zoom
    // tick would be wasteful when most moves don't cross a threshold.
    _ensureClusterIndices(zoom) {
      const radiusPx = resolveAggregationPx(this.style.aggregation, zoom, CLUSTER_RADIUS_PX_DEFAULT);
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
        console.warn('[ixmaps-engine] .meta({tooltip}) is set but Mustache.js is not loaded — ' +
          'include https://unpkg.com/mustache@4.2.0/mustache.min.js before ixmaps-engine.js.');
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
        return this.categoryDisplayLabels.map((label, i) => {
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
      const decimals = parseFloat(this.style.valuedecimals) || 2;
      const [intPart, dec] = num.toFixed(decimals).split('.');
      const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      return dec ? `${grouped}.${dec}` : grouped;
    }

    buildDeckLayers(zoom, bbox) {
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
      if (this.flags.has('CHOROPLETH')) return this._buildChoroplethLayers();
      // FEATURE is the real engine's own keyword (confirmed in maptheme.js
      // — singular); FEATURES (plural) is this port's own prior
      // convention, still used by demo_accidents.html/accidents_app.html —
      // both accepted so a real config ported verbatim (singular) and this
      // engine's existing pages (plural) both work.
      if (this.flags.has('FEATURE') || this.flags.has('FEATURES')) return this._buildFeaturesLayers();
      if (this.flags.has('CHART') && this.flags.has('SYMBOL')) return this._buildChartLayers(zoom, bbox);
      console.warn(`[ixmaps-engine] layer "${this.name}": type "${[...this.flags].join('|')}" has no implemented renderer`);
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
        opacity: parseFloat(this.style.fillopacity) || 1
      })];
    }

    // .type("CHOROPLETH") — a polygon fill classed by a bound numeric
    // value (QUANTILE/NATURAL/equal-interval, same _buildPartsA/
    // _resolveClassIndex machinery every other classed theme already
    // uses; CATEGORICAL/DOMINANT choropleths are a later phase, not
    // implemented here). Geometry + properties are already the joined
    // FeatureCollection from joinChoroplethFeatures — this only needs to
    // resolve each polygon's own class/color and wrap it in the standard
    // {value, raw, cat} tooltip shape (see _buildDotLayers for the same
    // pattern on points).
    _buildChoroplethLayers() {
      const source = this._activeFeatures || this.features;
      const fallbackRgb = [200, 200, 200]; // unclassified / no joined data for this polygon
      const data = source.map(f => {
        const cat = this._resolveClassIndex(f.properties[this.binding.value]);
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: { value: parseFloat(f.properties[this.binding.value]), raw: f.properties, cat }
        };
      });
      return [new GeoJsonLayer({
        id: `ix-choropleth-${this.name}`,
        data: { type: 'FeatureCollection', features: data },
        pickable: true,
        stroked: true,
        filled: true,
        getFillColor: d => (d.properties.cat != null ? this.categoryColorsRgb[d.properties.cat] : null) || fallbackRgb,
        getLineColor: this.style.linecolor ? hexOrNamedToRgb(this.style.linecolor) : [255, 255, 255],
        lineWidthMinPixels: parseFloat(this.style.linewidth) || 1,
        opacity: parseFloat(this.style.fillopacity) || 1
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
        const v = this.binding.size ? (parseFloat(f.properties[this.binding.size]) || 0) : 1;
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

    _buildChartLayers(zoom, bbox) {
      if (!this._featuresByCategory) return [];
      this._ensureClusterIndices(zoom);
      const individual = [];
      const clusterFeatures = [];
      this._clusterIndices.forEach((index, cat) => {
        index.getClusters(bbox, zoom).forEach(f => {
          const tagged = { geometry: f.geometry, properties: { ...f.properties, cat } };
          if (f.properties.cluster) clusterFeatures.push(tagged);
          else individual.push(tagged);
        });
      });

      const layers = [];
      const doRelocate = this.flags.has('RELOCATE');
      // RELOCATE only ever changes WHERE an already-aggregated group is
      // drawn — never which records get grouped together (that's
      // Supercluster's per-category radius clustering, unaffected either
      // way). Without RELOCATE, a grid-aggregated value (this pipeline —
      // "aggregation by field" is a separate, not-yet-implemented mode)
      // is positioned at the center of its RECT/hexbin grid element, not
      // at Supercluster's own internally-computed centroid: snap that
      // cluster's centroid through the SAME shared snapToAggregationGrid
      // (hex by default, RECT if flagged) _groupCoLocated uses below, at
      // the same cell width Supercluster itself just clustered with. With
      // RELOCATE, _groupCoLocated instead positions at the mean of the
      // ORIGINAL member positions (and additionally merges same-cell
      // clusters across categories) — the two branches share the same
      // grid math, they just use it for a different purpose.
      const groups = doRelocate ? this._groupCoLocated(clusterFeatures, zoom) : clusterFeatures.map(f => {
        const cellPx = this._clusterRadiusPx || CLUSTER_RADIUS_PX_DEFAULT;
        const [lng, lat] = f.geometry.coordinates;
        const p = lngLatToWorldPixel(lng, lat, zoom);
        const snapped = snapToAggregationGrid(p.x, p.y, cellPx, this.flags);
        const ll = worldPixelToLngLat(snapped.x, snapped.y, zoom);
        return {
          geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
          properties: { counts: this._oneHot(f.properties.cat, f.properties.point_count), total: f.properties.value }
        };
      });

      // GLOW: gradient-texture halo (see _getGlowIcon for why this diverges
      // from the real engine's literal flat-circle formula).
      if (this.flags.has('GLOW')) {
        layers.push(new IconLayer({
          id: `ix-points-glow-${this.name}-g${this._iconGeneration}`,
          data: individual, pickable: false,
          getPosition: d => d.geometry.coordinates,
          getIcon: d => this._getGlowIcon(this.categoryColorsRgb[d.properties.cat]),
          getSize: d => valueRadius(d.properties.value, zoom, this.style, this.mapOptions, this.flags, this._maxSizeValue) * 11,
          sizeUnits: 'pixels'
        }));
      }

      layers.push(new ScatterplotLayer({
        id: `ix-points-${this.name}`,
        data: individual, pickable: true,
        getPosition: d => d.geometry.coordinates,
        getRadius: d => valueRadius(d.properties.value, zoom, this.style, this.mapOptions, this.flags, this._maxSizeValue),
        radiusUnits: 'pixels',
        getFillColor: d => this.categoryColorsRgb[d.properties.cat],
        stroked: false, opacity: parseFloat(this.style.fillopacity) || 0.85
      }));

      if (this.flags.has('GLOW')) {
        layers.push(new IconLayer({
          id: `ix-cluster-glow-${this.name}-g${this._iconGeneration}`,
          data: groups, pickable: false,
          getPosition: d => d.geometry.coordinates,
          getIcon: d => this._getGlowIcon(this.categoryColorsRgb[dominant(d.properties.counts)]),
          getSize: d => valueRadius(d.properties.total, zoom, this.style, this.mapOptions, this.flags, this._maxSizeValue) * 9,
          sizeUnits: 'pixels'
        }));
      }

      layers.push(new IconLayer({
        id: `ix-cluster-${this.name}-g${this._iconGeneration}`,
        data: groups, pickable: true,
        getPosition: d => d.geometry.coordinates,
        getIcon: d => this._buildBubbleIcon(d.properties.counts, this.categoryColorsRgb),
        getSize: d => valueRadius(d.properties.total, zoom, this.style, this.mapOptions, this.flags, this._maxSizeValue) * 2,
        sizeUnits: 'pixels'
      }));

      // VALUES: bold value label centered on each bubble (see
      // formatBubbleValue/valuesFontSizePx above) — added last so it draws
      // on top of every bubble/glow layer. Entries whose computed font size
      // would be sub-pixel are dropped rather than rendered at getSize: 0,
      // matching the real engine's own "too small to bother" gate.
      if (this.flags.has('VALUES') && !valuesHiddenByScale(this.style, zoom)) {
        const valueScale = parseFloat(this.style.valuescale) || 1;

        const pointLabels = individual.reduce((out, d) => {
          const radius = valueRadius(d.properties.value, zoom, this.style, this.mapOptions, this.flags, this._maxSizeValue);
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
          const outerRadiusPx = valueRadius(d.properties.total, zoom, this.style, this.mapOptions, this.flags, this._maxSizeValue);
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

  function hexOrNamedToRgb(v) {
    if (typeof v === 'string' && v[0] === '#') return hexToRgb(v);
    const NAMED = { gray: [128, 128, 128], grey: [128, 128, 128], black: [0, 0, 0], white: [255, 255, 255] };
    return NAMED[v] || [130, 130, 130];
  }

  global.ixmaps = { layer, Map: createMap, setExternalData: setExternalDataBridge };
})(window);
