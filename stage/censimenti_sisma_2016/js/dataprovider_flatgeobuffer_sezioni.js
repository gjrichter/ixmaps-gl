/**
 * Data Provider for FlatGeobuffer Spatial Queries
 * 
 * This module provides partial loading capabilities for FlatGeobuffer data sources.
 * When the map is zoomed or panned, the data is loaded based on the current map bounds with 10% padding.
 * 
 * This happens in 2 steps:
 * 
 * 1. the code detects if the map bounds have changed and if so, it triggers a refresh of the theme.
 * 2. on refresh, the code loads the data based on the current map bounds with 10% padding.
 * 
 * It implements debounced refresh logic to efficiently handle map pan and zoom events.
 * 
 * @module ixmaps.dataprovider.flatgeobuffer_partial
 */

window.ixmaps = window.ixmaps || {};
(function () {

	const MIN_ZOOM = 11; // Minimum zoom level to trigger data queries
	const padding = 0.2;

	ixmaps.szThemeNameA = []; // Array to track active theme names

    let __oldBounds = null; // Previous map bounds for change detection
	let __oldBounds_2 = null; // Previous map bounds for change detection

	// ---------------------------------------------------------------------
	// Data Query Function
	//
	// Queries data from a FlatGeobuffer source, applying spatial filtering
	// based on the current map bounds with 10% padding.
	// ---------------------------------------------------------------------

    ixmaps.dataquery_flatgeobuffer = function (data, option) {

		console.log("*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!");

		ixmaps.szThemeNameA[option.theme.szName] = option.theme.szName;
		let szThemeUrl = option.ext;

        let bounds = __oldBounds = ixmaps.getBoundingBox();

		// If zoom level is too low, return empty dataset
		if (ixmaps.getZoom() < MIN_ZOOM ){
			ixmaps.setExternalData(new Data.Table(), {
				type: "jsonDB",
				name: option.name
			});
			__oldBounds = [{lat: 0, lng: 0}, {lat: 0, lng: 0}];
			ixmaps.in_query_1 = false;
			return;
		}

        // Add 10% padding to bounding box for smoother edge loading
        let width = bounds[1].lng - bounds[0].lng;
        let height = bounds[1].lat - bounds[0].lat;

        let bbox = [
            bounds[0].lng - width * padding,
            bounds[0].lat - height * padding,
            bounds[1].lng + width * padding,
            bounds[1].lat + height * padding
        ];

		ixmaps.setTitleBox("querying data ...");
		ixmaps.in_query_1 = true;

        // Query FlatGeobuffer data source with spatial filter
        Data.feed({
                "source": szThemeUrl,
                "type": "fgb",
                "bbox": bbox
            }).load(function (mydata) {
				ixmaps.in_query_1 = false;
				ixmaps.setTitle("");
				ixmaps.setExternalData(mydata, {
                        type: "jsonDB",
                        name: option.name
                    });
            })
            .error(function (e) {
                ixmaps.in_query_1 = false;
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
            });

    };
    ixmaps.dataquery_flatgeobuffer_2 = function (data, option) {

		console.log("*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!*!");

		ixmaps.szThemeNameA[option.theme.szName] = option.theme.szName;
		let szThemeUrl = option.ext;

        let bounds = __oldBounds_2 = ixmaps.getBoundingBox();

		// If zoom level is too low, return empty dataset
		if (ixmaps.getZoom() < MIN_ZOOM ){
			ixmaps.setExternalData(new Data.Table(), {
				type: "jsonDB",
				name: option.name
			});
			__oldBounds_2 = [{lat: 0, lng: 0}, {lat: 0, lng: 0}];
			ixmaps.in_query_2 = false;
			return;
		}

        // Add 10% padding to bounding box for smoother edge loading
        let width = bounds[1].lng - bounds[0].lng;
        let height = bounds[1].lat - bounds[0].lat;

        let bbox = [
            bounds[0].lng - width * padding,
            bounds[0].lat - height * padding,
            bounds[1].lng + width * padding,
            bounds[1].lat + height * padding
        ];

		ixmaps.setTitleBox("querying data ...");
		ixmaps.in_query_2 = true;

        // Query FlatGeobuffer data source with spatial filter
        Data.feed({
                "source": szThemeUrl,
                "type": "fgb",
                "bbox": bbox
            }).load(function (mydata) {
				ixmaps.in_query_2 = false;
				ixmaps.setTitle("");
				ixmaps.setExternalData(mydata, {
                        type: "jsonDB",
                        name: option.name
                    });
            })
            .error(function (e) {
                ixmaps.in_query_2 = false;
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
            });

    };

	// ---------------------------------------------------------------------
	// Map Event Handler
	//
	// Listens to map zoom/pan events and refreshes themes when:
	// - Zoom level is above MIN_ZOOM
	// - Map bounds have expanded beyond previous bounds
	// - No query is currently in progress
	// 
	// Uses debouncing to prevent excessive refresh calls during rapid interactions
	// ---------------------------------------------------------------------

	/**
	 * Debounce utility function
	 * Limits the rate at which a function can be invoked
	 * @param {Function} func - Function to debounce
	 * @param {number} wait - Wait time in milliseconds
	 * @returns {Function} Debounced function
	 */
	let __debounce = function(func, wait) {
		let timeout;
		return function executedFunction(...args) {
			const later = () => {
				clearTimeout(timeout);
				func(...args);
			};
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
		};
	};
	
	/**
	 * Debounced refresh function
	 * Refreshes all registered themes with a 500ms delay
	 */
	let __debouncedRefresh = __debounce(() => {
		for (let szThemeName in ixmaps.szThemeNameA) {
			console.log("0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0===0");
			ixmaps.refreshTheme(szThemeName);
		}
	}, 500);
	
	// Override the default zoom/pan handler
	ixmaps.htmlgui_onZoomAndPan_old = ixmaps.htmlgui_onZoomAndPan;
	ixmaps.htmlgui_onZoomAndPan = function(nZoom){ 

		// Skip refresh if zoom is too low
		if (ixmaps.getZoom() < MIN_ZOOM ){
			ixmaps.htmlgui_onZoomAndPan_old(nZoom);
			return;
		}

		// Wait if a query is in progress
		if ( ixmaps.in_query_1 || ixmaps.in_query_2 ){
			ixmaps.setTitleBox("theme busy ...");
			setTimeout(() => {
				ixmaps.htmlgui_onZoomAndPan(nZoom);
			},250);
			if ( ixmaps.htmlgui_onZoomAndPan_old ){	
				ixmaps.htmlgui_onZoomAndPan_old(nZoom);
			}
			return;
		}

		// Check if bounds have expanded beyond previous bounds
		let bounds = ixmaps.getBoundingBox();
		if ( __oldBounds || __oldBounds_2 ){
			__oldBounds == __oldBounds || __oldBounds_2;
			// If new bounds are completely within old bounds, no refresh needed
			if ( (bounds[0].lat >= __oldBounds[0].lat) && 
				 (bounds[0].lng >= __oldBounds[0].lng) &&
				 (bounds[1].lat <= __oldBounds[1].lat) &&
				 (bounds[1].lng <= __oldBounds[1].lng) 
			   ){
				ixmaps.setTitle("");
				if ( ixmaps.htmlgui_onZoomAndPan_old ){	
					ixmaps.htmlgui_onZoomAndPan_old(nZoom);
				}
				return;
			}
		}else{
			return;
		}

		// Trigger debounced refresh of themes
		__debouncedRefresh();
		__oldBounds = oldBounds_2 = bounds;

		// Call original handler
		if ( ixmaps.htmlgui_onZoomAndPan_old ){	
			ixmaps.htmlgui_onZoomAndPan_old(nZoom);
		}
	};

})();
