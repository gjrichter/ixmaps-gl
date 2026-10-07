/** 
 * @fileoverview This file provides functions to list filter facets
 *
 * @author Guenter Richter guenter.richter@medienobjekte.de
 * @version 1.0 
 * @copyright CC BY SA
 * @license MIT
 */

ixmaps = ixmaps || {};
ixmaps.data = ixmaps.data || {};

(function () {

	// ===========================================
	//
	// h e l p e r
	//
	// ===========================================

	/**
	 * Create a distribution of data values for histograms  
	 * @param szMapDiv the id of the div, where to create the SVG map
	 * @param options javascript object with the creation options
	 * @type object
	 * @return the new ixmaps object
	 */
	var __getScatterArray = function (data, nMin, nMax, nTicks, szFlag) {

		var nValuePos = 0;
		var nCountMax = 0;
		var dValue = 0;
		var a;

		if (szFlag.match(/LOG/)) {
			dValue = nMin ? 0 : 0.1;
			nMin = Math.log(nMin + dValue);
			nMax = Math.log(nMax + dValue);
		}

		var nPop = (nMax - nMin) / (nTicks - 1);

		var nPopA = [];
		var nTickA = [];
		var nTickVal = nMin;
		for (var i = 0; i < nTicks + 1; i++) {
			nPopA[i] = 0;
			nTickA[i] = Math.floor(szFlag.match(/LOG/) ? (Math.exp(nTickVal)) : nTickVal);
			nTickVal += nPop

		}
		data.forEach(function (value) {
			var xValue = value;
			if (typeof (xValue) == 'number') {
				if (szFlag.match(/LOG/)) {
					xValue = Math.log(xValue + dValue);
				}
				nPos = Math.max(0, Math.min(nTicks - 1, Math.floor((xValue - nMin) / nPop)));
				nPopA[nPos]++;
				nCountMax = Math.max(nCountMax, nPopA[nPos]);
			}
		});

		return {
			min: nTickA,
			count: nPopA
		};
	};

	// get unique values array via filter
	var __onlyUnique = function (value, index, self) {
		return self.indexOf(value) === index;
	};

	// get unique values array via named array
	var __getUniqueValues = function (a) {
		var u = [];
		for (var i in a) {
			u[String(a[i])] = 1;
		}
		var retA = [];
		for (var v in u) {
			retA.push(v);
		}
		return retA;
	};

	// get numbers from formatted values like 235 678.98 or 235.678,98
	var __scanValue = function (nValue) {
		if (String(nValue).match(/:/)) {
			return "date";
		} else
			// strips blanks inside numbers (e.g. 1 234 456 --> 1234456)
			if (String(nValue).match(/,/)) {
				return parseFloat(String(nValue).replace(/\./gi, "").replace(/,/gi, "."));
			} else {
				return parseFloat(String(nValue).replace(/ /gi, ""));
			}
	};

	
	const hex2rgba = (hex, alpha = 1) => {
	  if (hex.match(/rgb/i)){
		  return hex;
	  }	
	  const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16));
	  return `rgba(${r},${g},${b},${alpha})`;
	};	
	
	
	
	// ===========================================
	//
	// facet filter handling 
	//
	// ===========================================

	// -----------------------------------------------
	// set the selected facet filter
	// if this filter is already active, clear filter
	// -----------------------------------------------
	__setFacetFilter = function (szFilter) {

		// if new filter given, add to filter array (delete existent filter of the same data column)
		if (szFilter.length) {

			// get filter without WHERE 
			szFilter = szFilter.split(/WHERE /)[1];

			// add, or remove filter, if exists  
			__facetFilterA = __facetFilterA.filter(function (value, index, self) {
				return !(szFilter.split(/"/)[1] == value.split(/"/)[1]);
			});

			__facetFilterA.push(szFilter);
		}

		// make final filter from actual parts stored in __facetFilterA
		szFilter = __facetFilterA.length ? ("WHERE " + __facetFilterA.join(" AND ")) : null;

		// show filter in input field
		$("#query").val(szFilter);

		// filter items on map
		var objTheme = ixmaps.getThemeObj();
		var objThemesA = ixmaps.getThemes();
		for (a in objThemesA) {
			objTheme = objThemesA[a];
			if (objTheme.szFlag.match(/CHART|CHOROPLETH/) && !objTheme.szFlag.match(/NOFILTER/)) {
				ixmaps.message('&#9881;');
				if (szFilter) {
					ixmaps.map().changeThemeStyle(objTheme.szId, "filter:" + (szFilter || " "), "set");
				} else {
					ixmaps.map().changeThemeStyle(objTheme.szId, "filter", "remove");
				}
			}
		}

	};

	// -------------------------------------------------------------------------
	// set a range filter for a data field
	// if a range is already active on this data field, remove this range before
	// --------------------------------------------------------------------------
	__setRangeFilter = function (szField, szRange, min, max) {
		rangeA = szRange.split(",");
		szFilter = "WHERE \"" + szField + "\" BETWEEN " + rangeA[0] + " AND " + rangeA[1];
		// delete filter with same field
		__facetFilterA = __facetFilterA.filter(function (value, index, self) {
			return !(value.split("\"")[1] == szField);
		});
		__setFacetFilter(szFilter);
	};

	// -------------------------------------------------------------------------
	// set a input field filter
	// --------------------------------------------------------------------------
	__setFilter = function (szField, szFilter) {
		szQuery = "WHERE \"" + szField + "\" like \"" + szFilter + "\"";
		// delete filter with same field
		__facetFilterA = __facetFilterA.filter(function (value, index, self) {
			return !(value.split("\"")[1] == szField);
		});
		__setFacetFilter(szFilter.length ? szQuery : "");
	};

	// -----------------------------------------------
	// remove all filter of one data field
	// -----------------------------------------------
	__removeFacets = function (szField) {
		__facetFilterA = __facetFilterA.filter(function (value, index, self) {
			return !(value.split("\"")[1] == szField);
		});
		__setFacetFilter("");
	};

	// -----------------------------------------------
	// set word cloud field name
	// -----------------------------------------------
	__szFilter = null;
	__szDiv = null;
	__facetsA = null;
	__worldCloudField = null;
	__makeWordCloud = function (szField) {
		if ( __worldCloudField == szField ){
			__worldCloudField = null;	
		}else{
			__worldCloudField = szField;
		}
		ixmaps.data.showFacets(__szFilter, __szDiv, __facetsA);
	};
	
	var __makeHistogram = function (id, szRange) {

		var rangeA = szRange.split(",");

		var facet = null;

		for (i in facetsA) {
			if (facetsA[i].id == id) {
				facet = facetsA[i];
			}
		}

		if (facet && facet.data) {

			var objThemeDefinition = ixmaps.getThemeDefinitionObj();
			var objTheme = ixmaps.getThemeObj();

			var fOnMap = false;
			if ((objThemeDefinition.field == facet.id)) {
				fOnMap = true;
			}

			var min = __rangesA[facet.id].min;
			var max = __rangesA[facet.id].max;
			var sliderId = facet.id;
			var nTicks = Math.min(40, (max - min + 1));
			nTicks = (nTicks >= 5) ? nTicks : 40;
			var nStep = pop = (max - min) / nTicks;
			if (nStep > 1 && nStep < 2) {
				nTicks = max - min + 1;
			}

			var szScale = ((max - min) < 40) ? "" : "LOG";
			var fDiscret = (nTicks == max - min);

			var barA = __getScatterArray(__rangesA[facet.id].data, min, max, nTicks, szScale);
			var maxHeight = 0;
			barA.count.forEach(function (height) {
				maxHeight = Math.max(maxHeight, height);
			});
			var scale = 75 / maxHeight;
			var width = 210 / nTicks;
			szHtml = "";

			for (b = 0; b < barA.count.length - 1; b++) {
				var height = barA.count[b];
				var bMin = barA.min[b];
				var bMax = fDiscret ? barA.min[b] : barA.min[b + 1];
				var color = ((bMax >= rangeA[0]) && (bMin <= rangeA[1])) ? "#888" : "#ddd";

				if (fOnMap) {
					//color = objTheme.partsA[0].color;
					objTheme.partsA.forEach(function (part) {
						if (bMin >= part.min) {
							color = part.color;
						}
					});
				}
				var szFilter = "ixmaps.filterThemeItems(null, null, '', { field: '" + facet.id + "', min: " + bMin + ", max: " + bMax + " }";
				var szHighlight = "$(this).css('background','#880000');" + szFilter;
				var szClearHighlight = "$(this).css('background','');ixmaps.filterThemeItems(null,null,'','remove');"
				bMin = ixmaps.formatValue(bMin, 2, "BLANK");
				bMax = ixmaps.formatValue(bMax, 2, "BLANK");
				szHtml += "<div style='display:inline-block;width:" + width + "px;background-color:" + color + ";height:" + (1 + (height * scale)) + "px;' data-toggle='tooltip' title='" + (bMin + ' - ' + bMax) + " onmouseover='" + szHighlight + "' onmouseout='" + szClearHighlight + "'></div>";
			}
			szHtml += "</div>";

			$("#" + sliderId + "histogram").html(szHtml);
		}
	};

	__oldFilter = "";

	// ---------------------------------------------------
	// highlight map theme items by query
	// select data by query and create list of theme items 
	// highlight this item on the map
	// ---------------------------------------------------

	__HighlightFacetItems = function (szField, szValue) {
		var objTheme = ixmaps.getThemeObj();
		__oldFilter = objTheme.szFilter;
		if (objTheme && (objTheme.szFlag.match(/AGGREGATE/) || objTheme.szFlag.match(/MULTI/))) {
			if (__oldFilter.match(/WHERE/)) {
				ixmaps.filterThemeItems(null, null, __oldFilter + ' AND "' + szField + '" = "' + szValue + '"', 'set');
			} else {
				ixmaps.filterThemeItems(null, null, 'WHERE "' + szField + '" = "' + szValue + '"', 'set');
			}
		} else {
			ixmaps.filterThemeItems(null, null, "", {
				field: szField,
				txt: szValue
			});
		}
		return;

		// theme
		// ------------------------------------
		var objThemeDefinition = ixmaps.getThemeDefinitionObj();
		var objTheme = ixmaps.getThemeObj();

		// theme data
		// ------------------------------------
		var szData = objThemeDefinition.style.dbtable;
		var dataObj = eval("ixmaps.embeddedSVG.window." + (szData || "themeDataObj"));

		// create data object from theme data
		// ------------------------------------
		var mydata = new Data.Table(dataObj);

		// create highlight item list
		// -----------------------------------
		var layer = null;
		for (item in objTheme.itemA) {
			layer = item.split("::")[0];
		}

		var valuesA = [];
		var x = mydata.select(szQuery);
		var lookupA = objThemeDefinition.style.lookupfield.split("|");
		lookupA.forEach(function (id) {
			valuesA.push(x.column(id).values());
		});

		var itemA = [];
		for (k = 0; k < valuesA[0].length; k++) {
			var itemJ = [];
			for (kk = 0; kk < valuesA.length; kk++) {
				itemJ.push(valuesA[kk][k]);
			}
			itemA.push(layer + "::" + itemJ.join(','));
		}

		ixmaps.highlightThemeItems(null, itemA.join("|"), '|');
	};

	// ===========================================
	//
	// create the html facet list
	//
	// ===========================================

	ixmaps.data.showFacets = function (szFilter, szDiv, facetsA) {
		
		__szFilter = szFilter;
		__szDiv = szDiv;
		__facetsA = facetsA;
		
		var fTest = true;
		var sliderA = [];

		var objThemeDefinition = ixmaps.data.objThemeDefinition;
		var objTheme = ixmaps.data.objTheme;

		var szHtml = "";
		var	szHighlight = '$(".popupIcon").show()';
		var szClearHighlight = '$(".popupIcon").hide()';
		szHtml += "<div id='list-facets' class='list-group' style='width:100%;margin-bottom:5em;' onmouseover='" + szHighlight + "' onmouseout='" + szClearHighlight + "'>";
		
		szDiv = (szDiv || "facets");

		$("#"+szDiv).html(szHtml);

		// create an array of the filter to pass them to the executing function
		// to avoid problems with special characters " and '
		__queryA = [];

		// check if we have already a filter defined
		// and facets are elements of the filter
		var nSelectA = [];
		for (var i = 0; i < facetsA.length; i++) {
			__facetFilterA.forEach(function (szFilter) {
				if (szFilter.split("\"")[1] == facetsA[i].id) {
					nSelectA.push(i);
				}
			});
		}

		// loop over facets array and create HTML top show the facets
		//

		console.log(facetsA);
		console.log("all facets ===>");
		
		for (var i = 0; i < facetsA.length; i++) {

			var fActiveFacet = false;
			var szActiveFilter = null;

			// replace all non word characters with underscore
			var szSafeId = facetsA[i].id.replace(/ |\W/g, "_");

			__facetFilterA.forEach(function (szFilter, index) {
				if (szFilter.split("\"")[1] == facetsA[i].id) {
					fActiveFacet = true;
					szActiveFilter = szFilter;
				}
			});

			szHtml += fActiveFacet ? "<div class='facet-active'>" : "<div class='facet'>";

			// ------------------------------
			// facet header - with fieldname
			// ------------------------------

			var bgColor = fActiveFacet ? "#884444" : "#888888";

			var szMin = ixmaps.formatValue(facetsA[i].min, 2, "BLANK");
			var szMax = ixmaps.formatValue(facetsA[i].max, 2, "BLANK");

			szHtml += fActiveFacet ? "<a href='javascript:__removeFacets(\"" + (facetsA[i].id) + "\");' style='color:white' >" : "";
			szHtml += "<div style='font-family:arial;font-size:1.1em;text-align:left;padding:0.5em 0.5em 0.5em 0.5em;margin:1em 0 0.4em 0;background:" + bgColor + ";border-radius:5px;color:white'>";
			szHtml += facetsA[i].id;

			if (facetsA[i].data &&
				facetsA[i].data.length &&
				!isNaN(facetsA[i].min) &&
				!isNaN(facetsA[i].max) &&
				(facetsA[i].min < facetsA[i].max)) {
				szHtml += (typeof (facetsA[i].min) != "undefined") ? ((facetsA[i].min != facetsA[i].max) ? (": " + szMin + " - " + szMax) : (": " + szMin)) : "";
			}

			szHtml += fActiveFacet ? "<span style='float:right;margin-right:0em;padding-top:0em;'><i class='icon shareIcon share_bitly icon-cancel-circle' title='Share a short link' tabindex='-1'></i></span>" : "";
			if ((facetsA[i].type == "textual") && !facetsA[i].values){
				szHtml += "<a href='javascript:__makeWordCloud(\"" + (facetsA[i].id) + "\")'><span style='float:right;margin-right:0em;padding-top:0em;color:white'><i class='icon shareIcon share_bitly icon-cloud' title='Share a short link' tabindex='-1'></i></span></a>";
			}
			
			szHtml += "</div>";
			szHtml += fActiveFacet ? "</a>" : "";

			if (facetsA[i].type == "textual") {
				var placeholder = "Cerca ..." + ((!facetsA[i].values) ? (" (e.g. " + (facetsA[i].example || " ") + ")") : "");
				var value = "";
				if (fActiveFacet) {
					value = placeholder = szActiveFilter.split("\"")[3];
				}
				if ( !facetsA[i] || !facetsA[i].values || facetsA[i].values.length > 10){
					szHtml += '<div class="input-group" style="margin-bottom:0.5em;margin-left:0.1em;width:100%" >';
					szHtml += '<input id="' + (szSafeId + "query") + '" type="text" class="form-control" style="background:transparent;border:none" value="' + value + '" placeholder="' + placeholder + '"';
					szHtml += 'onKeyUp="if(event.which == 13){var value = $(\'#' + (szSafeId + "query") + '\').val();__setFilter(\'' + facetsA[i].id + '\',value);}">';
					szHtml += '<span class="input-group-btn" style="float:right;margin-left:-0.5em;margin-right:0.2em;">';
					szHtml += '<button class="btn btn-search" style="border:none" type="button" onclick="var value = $(\'#' + (szSafeId + "query") + '\').val();__setFilter(\'' + facetsA[i].id + '\',value);"><i class="icon shareIcon share_bitly icon-search" title="Search by text" tabindex="-1"></i> </button>';
					szHtml += '</span></input>';
					szHtml += '</div>'
				}else{
					szHtml += '<div class="input-group" style="margin-bottom:0.5em" >';
					szHtml += '</div>'
				}
				if ( facetsA[i].id == __worldCloudField ){
					szTarget = "thisismywordcloud"+facetsA[i].id.replace(/[\W_]/g, "_");
					szHtml += "<div id='"+szTarget+"'><div style='width:100%;text-align:center'><i class='icon shareIcon share_bitly icon-cloud' title='Share a short link' style='color:#888888;font-size:36px' tabindex='-1'></i><br><img src='./img/loading_blue.gif' style='height:28px'></div></div>";
					setTimeout("ixmaps.data.makeWordCloud('"+objTheme.szId+"','"+facetsA[i].id+"','"+szTarget+"')",100);
				}
			}

			// ------------------------------------
			// make facet content, different types
			// ------------------------------------
			
			var localTextA = {};
			localTextA.M1 = "M1 - Digitalizz., innov., competi., cultura e turismo";
			localTextA.M2 = "M2 - Rivoluzione verde e trans. eco.";
			localTextA.M3 = "M3 - Infrastrutture per una mobilità sostenibile";
			localTextA.M4 = "M4 - Istruzione e ricerca";
			localTextA.M5 = "M5 - Inclusione e coesione";
			localTextA.M6 = "M6 - Salute";
 

			if (typeof (facetsA[i].min) != "undefined" &&
				!isNaN(facetsA[i].min) &&
				!isNaN(facetsA[i].max) &&
				(facetsA[i].min < facetsA[i].max)) {

				// ---------------------------------
				// type A
				// continous value facet
				// make min/max slider
				// ---------------------------------
				
				console.log(facetsA[i]);
				console.log("continous value facet");
				
				if (!__rangesA[facetsA[i].id] || !fActiveFacet) {
					__rangesA[facetsA[i].id] = {
						min: facetsA[i].min,
						max: facetsA[i].max,
						data: facetsA[i].data,
						id: facetsA[i].id
					};
				}

				var min = __rangesA[facetsA[i].id].min;
				var max = __rangesA[facetsA[i].id].max;
				var szMin = ixmaps.formatValue(__rangesA[facetsA[i].id].min, 2, "BLANK");
				var szMax = ixmaps.formatValue(__rangesA[facetsA[i].id].max, 2, "BLANK");

				var href = "#";
				var bgColor = "#eeeeee";
				var szCount = "";

				// make histogram
				// ---------------------------------

				if (facetsA[i].data) {

					var fOnMap = false;
					if ((objThemeDefinition.field == facetsA[i].id)) {
						fOnMap = true;
					}

					var sliderId = szSafeId;
					var nTicks = Math.min(40, (max - min + 1));
					nTicks = (nTicks >= 5) ? nTicks : 40;

					var nStep = pop = (max - min) / nTicks;
					if (nStep > 1 && nStep < 2) {
						nTicks = max - min;
					}

					var szScale = ((max - min) < 40) ? "" : "LOG";

					var barA = __getScatterArray(__rangesA[facetsA[i].id].data, min, max, nTicks, szScale);
					var maxHeight = 0;
					barA.count.forEach(function (height) {
						maxHeight = Math.max(maxHeight, height);
					});
					var fDiscret = (nTicks == max - min + 1);
					var scale = 75 / maxHeight;
					var width = 210 / nTicks;
					szHtml += '<div style="background:#eeeeee;margin-top:0.4em;border-radius:5px;">'

					szHtml += '<div id="' + sliderId + 'histogram" style="padding-top:2em">';
					for (b = 0; b < barA.count.length - 1; b++) {
						var height = barA.count[b];
						var bMin = barA.min[b];
						var bMax = fDiscret ? barA.min[b] : barA.min[b + 1];
						var szbMin = ixmaps.formatValue(bMin, bMin < 100 ? 2 : 0, "BLANK");
						var szbMax = ixmaps.formatValue(bMax, bMax < 100 ? 2 : 0, "BLANK");
						var fActive = ((bMax >= facetsA[i].min) && (bMin <= facetsA[i].max));
						var color = fActive ? "#888" : "#ddd";
						if (fOnMap) {
							//color = objTheme.partsA[0].color;
							objTheme.partsA.forEach(function (part) {
								if (bMin >= part.min) {
									color = part.color;
								}
							});
						}

						var szTooltip =
							fDiscret ? String(bMin) : ixmaps.formatValue(bMin, 2, "BLANK") + ' - ' + ixmaps.formatValue(bMax, 2, "BLANK");
						var szFilter = "ixmaps.filterThemeItems(null, null, \"\", { field: \"" + facetsA[i].id + "\", min: " + bMin + ", max: " + bMax + " });";
						var szHighlight = "__origBg=$(this).css(\"background\");$(this).css(\"background\",\"#880000\");"; //+szFilter;
						var szClearHighlight = "$(this).css(\"background\",__origBg);"; //ixmaps.filterThemeItems(null,null,\"\",\"remove\");"
						var szHighlight = "$(this).css(\"border\",\"solid #ffffff 0.5px\");"; //+szFilter;
						var szClearHighlight = "$(this).css(\"border\",\"\");"; //ixmaps.filterThemeItems(null,null,\"\",\"remove\");"
						var szRange = "__setRangeFilter(\"" + facetsA[i].id + "\", \"" + bMin + "," + bMax + "\", 0, 0)";

						szHtml += "<div style='display:inline-block;width:" + width + "px;background-color:" + color + ";height:" + (1 + (height * scale)) + "px;' ";
						szHtml += " data-toggle='tooltip' title='" + szTooltip + "' onClick='" + szRange + "'";
						szHtml += fActive ? (" onmouseover='" + szHighlight + "' onmouseout='" + szClearHighlight + "'>") : ">";
						szHtml += "</div>";
						//szHtml += "<div style='display:inline-block;width:" + width + "px;background-color:" + color + ";height:" + (1 + (height * scale)) + "px;' data-toggle='tooltip' title='" + (szbMin + ' - ' + szbMax) + "'></div>";
					}
					szHtml += "</div>";

					// make slider
					// ---------------------------------

					sliderA.push({
						id: sliderId,
						field: facetsA[i].id,
						scale: szScale,
						min: min,
						max: max,
						ticks: nTicks
					});
					szHtml += '<div style="margin:0em 0em 0.5em 0em;background:#eee;border-radius:5px;height:2.5em;padding-top:0.5em"><span class="minvalue">' + szMin + '</span> <input id="' + sliderId + '" type="text" class="span2" value="" data-slider-min="' + min + '" data-slider-max="' + max + '" data-slider-step="5" data-slider-value="[' + facetsA[i].min + ',' + facetsA[i].max + ']"/> <span class="maxvalue">' + szMax + '</span></div>';

					szHtml += '</div>'
				}
			} else
			if (facetsA[i].values) {

				// ---------------------------------
				// type B
				// unique value facet
				// ---------------------------------
				
				console.log(facetsA[i]);
				console.log("unique value facet");
				
				szHtml += '<div>'

				// if more than 20 items, clip list to 10
				// --------------------------------------
				var maxII = (facetsA[i].values.length < 12) ? facetsA[i].values.length : 10;

				for (var ii = 0; ii < facetsA[i].values.length; ii++) {
					
					if (facetsA[i].values[ii].length && (facetsA[i].values[ii] != " ")) {

						// make the facet filter 
						var szQuery = "WHERE \"" + facetsA[i].id + "\" = \"" + facetsA[i].values[ii] + "\"";

						// make href, pass filter by filter array to avoid " or ' conflicts
						__queryA.push(szQuery);
						var href = "javascript:__setFacetFilter(__queryA[" + (__queryA.length - 1) + "]);";

						// how often is the value in the column
						var nCount = facetsA[i].valuesCount ? facetsA[i].valuesCount[facetsA[i].values[ii]] : null;
						var nMaxCount = facetsA[i].nValuesSum || facetsA[i].nCount;

						var bgColor = "";
						var szCount = ixmaps.formatValue(nCount, 0, "BLANK") + " " + (ixmaps.data.fShowFacetValues ? (objTheme.szUnits || "") : ""); //String(nCount || "");
						
						var szText = facetsA[i].values[ii];
						
						if ((objThemeDefinition.field == facetsA[i].id) && 
                            objTheme.colorScheme[objTheme.nStringToValueA[facetsA[i].values[ii]] - 1] ) {
							bgColor = hex2rgba(objTheme.colorScheme[objTheme.nStringToValueA[facetsA[i].values[ii]] - 1],0.7);
							if ( objTheme.szLabelA && objTheme.szValuesA ){
								szText = objTheme.szLabelA[objTheme.nStringToValueA[facetsA[i].values[ii]] - 1];
							}
						}

						if ( localTextA[szText] ){
							szText = localTextA[szText];
						}

						// facet button with one unique value
						// -----------------------------------
						szHtml += '<a href="' + href + '">';
						szHtml += '<div class="input-group" style="margin-bottom:0.5em;width:100%">';
						if ((objThemeDefinition.field == facetsA[i].id)) {
							szHtml += '<span class="input-group-addon" id="btnGroupAddon" style="background:' + bgColor + ';"></span>';
						}
						if (szText.match(/M1C/)){
							var bgColor = hex2rgba(objTheme.colorScheme[0],0.3);
							szHtml += '<span class="input-group-addon" id="btnGroupAddon" style="background:' + bgColor + ';"></span>';
						}
						if (szText.match(/M2C/)){
							var bgColor = hex2rgba(objTheme.colorScheme[1],0.3);
							szHtml += '<span class="input-group-addon" id="btnGroupAddon" style="background:' + bgColor + ';background-opacity:0.5;"></span>';
						}
						if (szText.match(/M3C/)){
							var bgColor = hex2rgba(objTheme.colorScheme[2],0.3);
							szHtml += '<span class="input-group-addon" id="btnGroupAddon" style="background:' + bgColor + ';background-opacity:0.5;"></span>';
						}
						if (szText.match(/M4C/)){
							var bgColor = hex2rgba(objTheme.colorScheme[3],0.3);
							szHtml += '<span class="input-group-addon" id="btnGroupAddon" style="background:' + bgColor + ';background-opacity:0.5;"></span>';
						}
						if (szText.match(/M5C/)){
							var bgColor = hex2rgba(objTheme.colorScheme[4],0.3);
							szHtml += '<span class="input-group-addon" id="btnGroupAddon" style="background:' + bgColor + ';background-opacity:0.5;"></span>';
						}
						if (szText.match(/M6C/)){
							var bgColor = hex2rgba(objTheme.colorScheme[5],0.3);
							szHtml += '<span class="input-group-addon" id="btnGroupAddon" style="background:' + bgColor + ';background-opacity:0.5;"></span>';
						}
						
						if (facetsA[i].type == "textual") {
							if (fActiveFacet) {
								value = szActiveFilter.split("\"")[3];
								if ( value ){
									value = value.replace("\/", "\\\/");
									if ( value != "*" ){
										var szTextA = eval("szText.split(/" + value + "/i)");
										szText = szTextA.join("<span style='color:#000000;background:#ffff00;padding:0 0.2em;'>" + value + "</span>");
									}
								}
							}
						}
						szHtml += '<button type="button" class="btn btn-block btn-primary " style="width:100%;border:none;border-bottom:solid #000000 0.1px;border-radius:0;background:'+bgColor+'"><span style="margin-left:-0.5em;float:left;white-space:normal;text-align:left;margin-top:0.2em">' + szText + '</span><span class="badge badge-primary badge-pill pull-right" style="top:0.1em;right:-0.25em;float:right;text-align:right;font-size:18px" onmouseover=\'' + szHighlight + '\' onmouseout=\'' + szClearHighlight + '\'>' + szCount + '</span></button>';

						var nWidth = (100 / nMaxCount * nCount);
						if (!isNaN(nWidth) && (nWidth < 100) && (facetsA[i].uniqueValues > 2)) {
							szHtml += '<div style="position:relative;top:3px;left:0.1em;background:rgba(208,208,208,1);line-height:0.4em;width:' + nWidth + '%;border-radius:0 0.5em 0.5em 0">&nbsp;</div>';
						}

						szHtml += '</div>';
						szHtml += '</a>';
					}

					// clip list to max itema
					// --------------------------------------
					if (ii == maxII) {
						szHtml += '</div>';
						szHtml += '<div id="' + (szSafeId + "plus") + '" style="display:none">';
					}

				}

				szHtml += '</div>';
				szHtml += '<div>';

				// if list clipped, make butto to expand 
				// --------------------------------------
				if (facetsA[i].values.length > maxII) {
					szHtml += '<a ><button type="button" class="btn btn-default " style="padding:0.2em 0.5em" onclick="$(this).hide();$(\'#' + (szSafeId + "plus") + '\').toggle();">+ ' + (facetsA[i].values.length - maxII) + '</button></a>';
				}

				szHtml += "</div>";
			} else {
				
				console.log(facetsA[i]);
				console.log("facet has no properties");

				// facet has no property .values 
				// may be there are 0 or to many unique values when creating the facet
				//szHtml += '(too many values)';
			}
			szHtml += "</div>";

		}
		szHtml += "</div>";
		
		$("#"+szDiv).html(szHtml);
		
		if ($(".facet-active")[0]){
			$("#"+szDiv).parent().scrollTop($(".facet-active")[0].offsetTop-$("#"+szDiv)[0].offsetTop)+"px";
		}
		
		/**
		 ** to be done, actually no bootstrap, slider support
		 ** *****************************************************
		 
		sliderA.forEach(function (x) {

			$("#" + x.id + "histogram").css("margin-left", ($("#" + x.id).prev().offset().left + $("#" + x.id).prev().width()) + "px");

			var nStep = ((x.max - x.min) == x.ticks)?1:Math.min(1, Math.pow(10, Math.floor(Math.log((x.max - x.min) / 100))));

			var mySlider = $("#" + x.id).slider({
				step: nStep,
				tooltip_split: true,
				tooltip_position: "bottom",
				scale: (x.scale == "LOG") ? 'logarithmic' : 'linear'
			}).on("slideStop", function () {
				__setRangeFilter(x.field, $(this).context.value, $(this).attr("data-slider-min"), $(this).attr("data-slider-max"));
			}).on("slide", function () {
				__makeHistogram($(this).attr("id"), $(this).context.value);
			});
		});
		
		** ***************************************************/

	};

	/**
	 * end of namespace
	 */

})();

// -----------------------------
// EOF
// -----------------------------
