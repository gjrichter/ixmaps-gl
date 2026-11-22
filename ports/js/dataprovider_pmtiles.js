/**
 * Data provider for remote PMTiles vector tile sources.
 *
 * Queries a PMTiles archive (e.g. EUBUCCO on S3) with a spatial filter based on
 * the current map bounds: only the vector tiles intersecting the viewport are
 * read. PMTiles is clustered and tile-sorted, so a viewport costs a handful of
 * HTTP range requests (root directory + leaf directory + the tile run) - no
 * server and no full download needed. The MVT tiles are decoded to GeoJSON in
 * the browser and handed to the theme via ixmaps.setExternalData().
 *
 * Re-queries when the user zooms or pans outside the last loaded bounds (with
 * debouncing) - same pattern as dataprovider_remote_parquet.js. A zoom that
 * changes the tile zoom always re-queries: the tiles are LOD-generalized per
 * zoom (lower zooms drop tiny polygons), so every view shows ONE tile zoom -
 * a uniform, screen-wide polygon resolution; zooming back in must not get
 * stuck on zoomed-out LOD data.
 *
 * Options in the layer definition:
 *   .data({type: "ext", name: "dataquery_pmtiles", url: "<pmtiles url>"})
 * The defaults below suit the EUBUCCO buildings archive. Any other archive
 * sets what differs, as extra keys of the same .data({...}) call:
 *   layer       MVT layer name inside the tiles           (default "buildings")
 *   minzoom     flat zoom below which nothing is queried  (default 13)
 *   tilemin     lowest tile zoom the archive holds        (default 12)
 *   tilemax     highest tile zoom the archive holds       (default 14)
 *   stitch      feature property that identifies the pieces of a polygon
 *               clipped at tile borders, which are unioned back together;
 *               "false" disables (use when the features have no such id)
 *                                                         (default "id")
 *   maxtiles    viewport tile budget for one query        (default 16)
 *   maxfeatures abort above this feature count            (default 150000)
 *   label       what the features are, for the status box (default "buildings")
 * The archive must contain MVT tiles with the named layer and properties on
 * the features. With stitching on, polygons clipped at tile borders
 * (fragments share the same id property) are stitched back into whole
 * polygons, so layer transparency shows no seams along tile bounds and
 * split polygons count once in the legend.
 *
 * Several themes may use this provider on one page, each with its own archive
 * and options (e.g. two PMTiles hazard layers): the archive handle, options
 * and loaded tile zoom are kept per theme, the viewport bounds are shared.
 */

window.ixmaps = window.ixmaps || {};
(function () {

	"use strict";

	const DEBOUNCE_MS = 500;
	const BBOX_PADDING = 0.1;     // 10% padding around the viewport

	// per-archive defaults (EUBUCCO buildings); every key can be overridden in
	// the layer's .data({...}) - see the header
	//   minzoom: flat zoom gate (below: no query, show hint)
	//   tilemin/tilemax: archive tile zoom range - EUBUCCO's header says 12-15,
	//     but z15 is only sparsely populated - z14 is the effective coverage zoom
	//     (the eubucco map pins maxzoom 14 for the same reason; beyond, tiles
	//     are overzoomed)
	const DEFAULTS = {
		layer: "buildings", minzoom: 13, tilemin: 12, tilemax: 14,
		stitch: "id", maxtiles: 16, maxfeatures: 150000, label: "buildings"
	};

	const PMTILES_LIB = "https://unpkg.com/pmtiles@3.2.0/dist/pmtiles.js";
	const VECTORTILE_LIB = "https://esm.sh/@mapbox/vector-tile@1.3.1";
	const PBF_LIB = "https://esm.sh/pbf@3.2.1";
	const POLYGONCLIPPING_LIB = "https://esm.sh/polygon-clipping@0.15.3";

	// ixmaps-gl: flat zoom = MapLibre zoom + 1 (FLAT_ZOOM_OFFSET in the engine);
	// the tile zoom is chosen from the MapLibre zoom
	const FLAT_ZOOM_OFFSET = 1;

	let szThemeNameA = [];
	let __oldBounds = null;
	let __cfgA = {};              // theme name -> its resolved options
	let __loadedTileZoomA = {};   // theme name -> tile zoom of its last successful query
	let __loadedBoundsA = {};     // theme name -> viewport bounds of its last query

	const __pmtilesInstances = new Map();   // archive url -> PMTiles handle
	let __VectorTile = null;
	let __Pbf = null;
	let __polygonUnion = null;
	let __retryPending = false;  // one busy-retry at a time (two providers on
	                             // a page would otherwise multiply retries)

	// bounds no viewport is inside: the next zoom/pan re-queries
	const __noBounds = () => [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }];

	// -------------------------------------------------------------------------
	// Library loading
	// -------------------------------------------------------------------------

	// the option values arrive as strings or numbers (.data() may be JSON)
	function __resolveConfig(option) {
		const cfg = Object.assign({}, DEFAULTS);
		for (const k of Object.keys(DEFAULTS)) {
			if (option[k] == null || option[k] === "") continue;
			cfg[k] = (typeof DEFAULTS[k] === "number") ? Number(option[k]) : option[k];
		}
		if (cfg.stitch === false || String(cfg.stitch).toLowerCase() === "false") cfg.stitch = null;
		cfg.url = option.ext;
		return cfg;
	}

	function __ensurePmtiles(url) {
		if (__pmtilesInstances.has(url)) return Promise.resolve(__pmtilesInstances.get(url));
		return new Promise((resolve, reject) => {
			const create = () => {
				try {
					const inst = new window.pmtiles.PMTiles(url);
					__pmtilesInstances.set(url, inst);
					resolve(inst);
				} catch (e) {
					reject(e);
				}
			};
			if (window.pmtiles) { create(); return; }
			const script = document.createElement("script");
			script.src = PMTILES_LIB;
			script.onload = create;
			script.onerror = () => reject(new Error("failed to load pmtiles.js from " + PMTILES_LIB));
			document.head.appendChild(script);
		});
	}

	async function __ensureVectorTile() {
		if (__VectorTile) return;
		const [vt, pbf, pc] = await Promise.all([
			import(VECTORTILE_LIB), import(PBF_LIB), import(POLYGONCLIPPING_LIB)
		]);
		if (!vt || !vt.VectorTile || !pbf || !(pbf.default || pbf)) {
			throw new Error("failed to load the MVT decoder (@mapbox/vector-tile)");
		}
		__VectorTile = vt.VectorTile;
		__Pbf = pbf.default || pbf;
		__polygonUnion = pc && (pc.union || (pc.default && pc.default.union)) || null;
	}

	// -------------------------------------------------------------------------
	// Helpers (debounce, theme refresh, empty table)
	// -------------------------------------------------------------------------

	function __debounce(fn, wait) {
		let timeout;
		return function executedFunction(...args) {
			clearTimeout(timeout);
			timeout = setTimeout(() => fn(...args), wait);
		};
	}

	function __isThemeVisible(themeObj) {
		if (!themeObj) return false;
		if (themeObj.fHide === true) return false;
		if (typeof themeObj.fShow !== "undefined") return themeObj.fShow === true;
		if (typeof themeObj.fVisible !== "undefined") return themeObj.fVisible === true;
		return true;
	}

	function __refreshThemes() {
		let nRefresh = 0;
		for (let szThemeName in szThemeNameA) {
			let themeObj = ixmaps.getThemeObj && ixmaps.getThemeObj(szThemeName);
			if (__isThemeVisible(themeObj)) {
				++nRefresh;
				ixmaps.refreshTheme(szThemeName);
			}
		}
		if ( nRefresh === 0 ) {
			__oldBounds = __noBounds();
			__loadedTileZoomA = {};
		}
	}

	const __debouncedRefresh = __debounce(__refreshThemes, DEBOUNCE_MS);

	// empty jsonDB table to clear the theme's display (out-of-scale zoom,
	// load error, no data url) - ixmaps.setExternalData() alerts on null
	function __emptyTable() {
		return new Data.Table().setArray([["id"]]);
	}

	// -------------------------------------------------------------------------
	// Web Mercator tile math
	// -------------------------------------------------------------------------

	// tile zoom for a flat zoom, clamped to the archive's coverage range
	function __tileZoomFor(cfg, nFlatZoom) {
		return Math.max(cfg.tilemin, Math.min(cfg.tilemax, Math.round(nFlatZoom - FLAT_ZOOM_OFFSET)));
	}

	// latitude -> fractional tile y at zoom z (Mercator, clamp at the poles)
	function __latToY(lat, n) {
		const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
		const rad = clamped * Math.PI / 180;
		return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
	}

	// tiles intersecting a bbox [minLng, minLat, maxLng, maxLat] at zoom z
	function __tileCover(bbox, z) {
		const n = 1 << z;
		const x0 = Math.max(0, Math.min(n - 1, Math.floor((bbox[0] + 180) / 360 * n)));
		const x1 = Math.max(0, Math.min(n - 1, Math.floor((bbox[2] + 180) / 360 * n)));
		const y0 = Math.max(0, Math.min(n - 1, Math.floor(__latToY(bbox[3], n))));
		const y1 = Math.max(0, Math.min(n - 1, Math.floor(__latToY(bbox[1], n))));
		const tiles = [];
		for (let x = x0; x <= x1; x++) {
			for (let y = y0; y <= y1; y++) {
				tiles.push({ x, y });
			}
		}
		return tiles;
	}

	// -------------------------------------------------------------------------
	// Tile fragment stitching
	// -------------------------------------------------------------------------
	// A building crossing a tile border is clipped into one fragment per tile
	// (fragments share the source 'id' property). With layer transparency the
	// fragments' shared edges and the tiles' buffer strips show as overlapping
	// seams along the tile bounds - so fragments of the same id are unioned
	// back into the whole building polygon.

	// idProp: the feature property that identifies the pieces of one polygon
	// (null: no stitching - features without such an id cannot be matched)
	function __stitchTileFragments(features, idProp) {
		if (!__polygonUnion || !idProp) return features;

		// group features by source id
		const groups = new Map();
		for (const f of features) {
			const pid = (f.properties && f.properties[idProp] != null) ? String(f.properties[idProp]) : null;
			if (pid == null) continue;
			const g = groups.get(pid);
			if (g) g.push(f); else groups.set(pid, [f]);
		}

		// union the groups of clipped fragments (>1 feature with the same id)
		const mergedIds = new Set();
		for (const [pid, arr] of groups) {
			if (arr.length < 2) continue;
			try {
				const polys = arr.map(function (f) {
					const g = f.geometry;
					if (g && g.type === "Polygon") return [g.coordinates];
					if (g && g.type === "MultiPolygon") return g.coordinates;
					return null;
				});
				if (polys.some(function (p) { return !p; })) continue;
				const merged = polys.length === 1 ? polys[0] : __polygonUnion(polys[0], ...polys.slice(1));
				if (!merged || !merged.length) continue;
				arr[0].geometry = (merged.length === 1)
					? { type: "Polygon", coordinates: merged[0] }
					: { type: "MultiPolygon", coordinates: merged };
				arr.length = 1;
				mergedIds.add(pid);
			} catch (e) {
				// union failed (numeric edge case) - keep the fragments as they are
			}
		}

		// rebuild: a merged group contributes only its first (stitched) feature
		const out = [];
		for (const f of features) {
			const pid = (f.properties && f.properties[idProp] != null) ? String(f.properties[idProp]) : null;
			if (pid == null || !mergedIds.has(pid)) { out.push(f); continue; }
			if (groups.get(pid)[0] === f) out.push(f);
		}
		return out;
	}

	// -------------------------------------------------------------------------
	// Data query: PMTiles tiles of the viewport -> GeoJSON
	// -------------------------------------------------------------------------

	ixmaps.dataquery_pmtiles = async function (data, option) {

		const szTheme = option.theme.szName;
		szThemeNameA[szTheme] = szTheme;
		const cfg = (__cfgA[szTheme] = __resolveConfig(option));

		if (!cfg.url) {
			ixmaps.setTitleBox("error while loading: no data url", "RGBA(128,0,0,0.5)");
			__oldBounds = __noBounds();
			ixmaps.setExternalData(__emptyTable(), { type: "jsonDB", name: option.name });
			return;
		}

		if (ixmaps.getZoom() < cfg.minzoom) {
			ixmaps.setTitleBox("zoom in to load " + cfg.label + " ...");
			__oldBounds = __noBounds();
			delete __loadedTileZoomA[szTheme];
			ixmaps.setExternalData(__emptyTable(), { type: "jsonDB", name: option.name });
			return;
		}

		let bounds = (__oldBounds = ixmaps.getBoundingBox());
		__loadedBoundsA[szTheme] = bounds;

		// bbox with padding, so small pans don't re-fetch
		let width = bounds[1].lng - bounds[0].lng;
		let height = bounds[1].lat - bounds[0].lat;
		let bbox = [
			bounds[0].lng - width * BBOX_PADDING,
			bounds[0].lat - height * BBOX_PADDING,
			bounds[1].lng + width * BBOX_PADDING,
			bounds[1].lat + height * BBOX_PADDING
		];

		ixmaps.setTitleBox("querying data ...");
		ixmaps.in_query = true;

		try {
			const pmtiles = await __ensurePmtiles(cfg.url);
			await __ensureVectorTile();

			// tile zoom from the MapLibre zoom, clamped to the archive's coverage
			const z = __tileZoomFor(cfg, ixmaps.getZoom());
			__loadedTileZoomA[szTheme] = z;

			const tiles = __tileCover(bbox, z);
			if (tiles.length > cfg.maxtiles) {
				throw new Error("viewport covers " + tiles.length + " tiles (limit " + cfg.maxtiles + ") - zoom in");
			}

			const incoming = [];
			await Promise.all(tiles.map(async (t) => {
				// missing tile = area without features (normal, not an error)
				const resp = await pmtiles.getZxy(z, t.x, t.y);
				if (!resp) return;
				const tile = new __VectorTile(new __Pbf(resp.data));
				const layer = tile.layers[cfg.layer];
				if (!layer) return;
				for (let i = 0; i < layer.length; i++) {
					incoming.push(layer.feature(i).toGeoJSON(t.x, t.y, z));
				}
			}));

			// one tile zoom for the whole screen: a uniform polygon resolution
			// reads better than mixing LOD levels across the view; polygons
			// clipped at tile borders are stitched back into whole polygons
			const features = __stitchTileFragments(incoming, cfg.stitch);

			if (features.length > cfg.maxfeatures) {
				throw new Error("viewport selects " + features.length.toLocaleString() + " " + cfg.label + " (limit " + cfg.maxfeatures.toLocaleString() + ") - zoom in");
			}

			ixmaps.setTitle("");
			ixmaps.setExternalData(
				{ type: "FeatureCollection", features: features },
				{ type: "geojson", name: option.name }
			);
		} catch (e) {
			ixmaps.setTitleBox("error while loading: " + (e && e.message ? e.message : e), "RGBA(128,0,0,0.5)");
			__oldBounds = __noBounds();
			delete __loadedTileZoomA[szTheme];
			ixmaps.setExternalData(__emptyTable(), { type: "jsonDB", name: option.name });
		} finally {
			ixmaps.in_query = false;
		}
	};

	// -------------------------------------------------------------------------
	// Zoom/pan: re-query only when bounds leave the last loaded area
	// -------------------------------------------------------------------------

	function __boundsInsideOld(bounds) {
		if (!__oldBounds) return false;
		return (
			bounds[0].lat >= __oldBounds[0].lat &&
			bounds[0].lng >= __oldBounds[0].lng &&
			bounds[1].lat <= __oldBounds[1].lat &&
			bounds[1].lng <= __oldBounds[1].lng
		);
	}

	// A theme that was hidden while the map was panned/zoomed is not refreshed
	// by the hook below (only visible themes are), so it still holds the data of
	// an older viewport. Showing a theme runs htmlgui_onDrawTheme(id): there,
	// reload the theme if its viewport no longer covers the current one.
	const __oldDrawHook = ixmaps.htmlgui_onDrawTheme;
	ixmaps.htmlgui_onDrawTheme = function (szId) {
		if (__oldDrawHook) __oldDrawHook.apply(this, arguments);
		try {
			if (!szThemeNameA[szId] || ixmaps.in_query) return;
			if (!__isThemeVisible(ixmaps.getThemeObj && ixmaps.getThemeObj(szId))) return;
			const loaded = __loadedBoundsA[szId];
			const b = ixmaps.getBoundingBox();
			const covered = loaded &&
				b[0].lat >= loaded[0].lat && b[0].lng >= loaded[0].lng &&
				b[1].lat <= loaded[1].lat && b[1].lng <= loaded[1].lng;
			if (!covered) ixmaps.refreshTheme(szId);
		} catch (e) { /* a refresh problem must never break the draw hook */ }
	};

	// the previous hook, captured ONCE at load: a shared 'htmlgui_onZoomAndPan_old'
	// property gets overwritten when a second provider loads, and this wrapper
	// would then call ITSELF through it - capture locally instead
	const __oldZoomHook = ixmaps.htmlgui_onZoomAndPan;
	ixmaps.htmlgui_onZoomAndPan = function (nZoom) {

		// If a query is in progress, retry after a short delay - one at a
		// time: the page-level name re-enters every provider's wrapper, so
		// an unguarded retry multiplies itself per provider per 250ms
		if (ixmaps.in_query) {
			ixmaps.setTitleBox("theme busy ...");
			if (!__retryPending) {
				__retryPending = true;
				setTimeout(() => { __retryPending = false; ixmaps.htmlgui_onZoomAndPan(nZoom); }, 250);
			}
			if (__oldZoomHook) __oldZoomHook(nZoom);
			return;
		}

		let bounds = ixmaps.getBoundingBox();

		// No previous bounds: let the theme load normally
		if (!__oldBounds) {
			if (__oldZoomHook) __oldZoomHook(nZoom);
			return;
		}

		// Still inside the loaded bbox AND at the loaded tile zoom: no refetch.
		// The tile zoom must match too: the tiles are LOD-generalized per zoom
		// (lower zooms drop tiny polygons), so data loaded for a zoomed-out
		// view must not be reused when zooming back in - it would leave holes
		// where the dropped buildings were.
		// (every theme of this provider must still be at its own loaded tile zoom)
		let nFlatZoom = (nZoom != null ? nZoom : ixmaps.getZoom());
		const __allAtLoadedZoom = Object.keys(szThemeNameA).every(
			n => __cfgA[n] && __tileZoomFor(__cfgA[n], nFlatZoom) === __loadedTileZoomA[n]);
		if (__boundsInsideOld(bounds) && __allAtLoadedZoom) {
			ixmaps.setTitle("");
			if (__oldZoomHook) __oldZoomHook(nZoom);
			return;
		}

		// Map has panned/zoomed outside loaded area: debounced refresh
		__debouncedRefresh();
		__oldBounds = bounds;

		if (__oldZoomHook) __oldZoomHook(nZoom);
	};

})();
