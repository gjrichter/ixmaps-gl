/**
 * Data provider for FlatGeoBuffer (FGB) sources.
 *
 * Loads vector tiles from a flat geobuffer URL, applying a spatial filter
 * (bbox) based on the current map bounds. Re-queries when the user zooms
 * or pans outside the last loaded bounds (with debouncing).
 */

window.ixmaps = window.ixmaps || {};
(function () {

	"use strict";

	const MIN_ZOOM = 0;
	const DEBOUNCE_MS = 500;
	const BBOX_PADDING = 0.1;  // 10% padding around viewport

	let szThemeUrl = "";
	let szThemeNameA = [];
	let __oldBounds = null;

	// -------------------------------------------------------------------------
	// Debounce helper
	// -------------------------------------------------------------------------

	/**
	 * Returns a debounced version of fn that runs after `wait` ms of no calls.
	 * @param {Function} fn - Function to debounce
	 * @param {number} wait - Delay in ms
	 * @returns {Function} Debounced function
	 */
	function __debounce(fn, wait) {
		let timeout;
		return function executedFunction(...args) {
			clearTimeout(timeout);
			timeout = setTimeout(() => fn(...args), wait);
		};
	}

	/**
	 * Returns true if the theme should be considered visible (not hidden by user or scale).
	 */
	function __isThemeVisible(themeObj) {
		if (!themeObj) return false;
		if (themeObj.fHide === true) return false;
		if (typeof themeObj.fShow !== "undefined") return themeObj.fShow === true;
		if (typeof themeObj.fVisible !== "undefined") return themeObj.fVisible === true;
		return true;
	}

	/**
	 * Refreshes only themes that use this flat-geobuffer provider and are currently visible,
	 * so they re-query with the new map bounds.
	 */
	function __refreshThemes() {
		let nRefresh = 0;
		for (let szThemeName in szThemeNameA) {
			let themeObj = ixmaps.getThemeObj && ixmaps.getThemeObj(szThemeName);
			if (__isThemeVisible(themeObj)) {
				++nRefresh;
				ixmaps.refreshTheme(szThemeName);
			}
		}
		if ( nRefresh === 0 ){
			__oldBounds = [{lat:0,lng:0},{lat:0,lng:0}];
		}
	}

	const __debouncedRefresh = __debounce(__refreshThemes, DEBOUNCE_MS);

	// -------------------------------------------------------------------------
	// Data query: load FGB with bbox filter
	// -------------------------------------------------------------------------

	/**
	 * Queries data from the flat geobuffer source using the current map bounds.
	 * At zoom &lt; MIN_ZOOM returns empty data. Otherwise requests FGB with a
	 * bbox (with padding) so only visible-area features are loaded.
	 *
	 * @param {*} data - Unused (kept for API compatibility)
	 * @param {Object} option - Theme options; must include option.theme.szName, option.name, option.ext (data URL)
	 */
	ixmaps.dataquery_flatgeobuffer = function (data, option) {

		szThemeNameA[option.theme.szName] = option.theme.szName;
		szThemeUrl = option.ext;

		if (!szThemeUrl) {
			ixmaps.setTitleBox("error while loading: no data url", "RGBA(128,0,0,0.5)");
			ixmaps.setExternalData(null, { name: option.name });
			return;
		}

		let bounds = (__oldBounds = ixmaps.getBoundingBox());

		// Build bbox with padding so we fetch slightly beyond viewport (fewer refetches on small pans)
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

		Data.feed({
			source: szThemeUrl,
			type: "fgb",
			bbox: bbox
		})
			.load(function (mydata) {
				ixmaps.setTitle("");
				ixmaps.setExternalData(mydata, {
					type: "jsonDB",
					name: option.name
				});
				ixmaps.in_query = false;
			})
			.error(function (e) {
				ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
				ixmaps.setExternalData(null, { name: option.name });
				ixmaps.in_query = false;
				ixmaps.setTitle("");
			});
	};

	// -------------------------------------------------------------------------
	// Zoom/pan: re-query only when bounds leave the last loaded area
	// -------------------------------------------------------------------------

	/**
	 * Returns true if `bounds` is fully inside `__oldBounds` (no need to refetch).
	 */
	function __boundsInsideOld(bounds) {
		if (!__oldBounds) return false;
		return (
			bounds[0].lat >= __oldBounds[0].lat &&
			bounds[0].lng >= __oldBounds[0].lng &&
			bounds[1].lat <= __oldBounds[1].lat &&
			bounds[1].lng <= __oldBounds[1].lng
		);
	}

	ixmaps.htmlgui_onZoomAndPan_old = ixmaps.htmlgui_onZoomAndPan;
	ixmaps.htmlgui_onZoomAndPan = function (nZoom) {

		// If a query is in progress, retry after a short delay
		if (ixmaps.in_query) {
			ixmaps.setTitleBox("theme busy ...");
			setTimeout(() => ixmaps.htmlgui_onZoomAndPan(nZoom), 250);
			if (ixmaps.htmlgui_onZoomAndPan_old) {
				ixmaps.htmlgui_onZoomAndPan_old(nZoom);
			}
			return;
		}

		let bounds = ixmaps.getBoundingBox();

		// No previous bounds: let the theme load normally, don’t trigger refresh here
		if (!__oldBounds) {
			if (ixmaps.htmlgui_onZoomAndPan_old) {
				ixmaps.htmlgui_onZoomAndPan_old(nZoom);
			}
			return;
		}

		// Still inside last loaded bbox: no refetch
		if (__boundsInsideOld(bounds)) {
			ixmaps.setTitle("");
			if (ixmaps.htmlgui_onZoomAndPan_old) {
				ixmaps.htmlgui_onZoomAndPan_old(nZoom);
			}
			return;
		}

		// Map has panned/zoomed outside loaded area: debounced refresh
		__debouncedRefresh();
		__oldBounds = bounds;

		if (ixmaps.htmlgui_onZoomAndPan_old) {
			ixmaps.htmlgui_onZoomAndPan_old(nZoom);
		}
	};

})();
