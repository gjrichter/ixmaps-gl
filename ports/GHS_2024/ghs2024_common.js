/* Shared setup for the GHS_2024 ports (ports/GHS_2024/*.html): the maps of ports/GHS/ rebuilt on the
   GHS Urban Centre Database R2024A (11,422 urban centres, parquet tables on S3, read with column
   projection so only the needed columns are downloaded). Same look as ports/GHS: black basemap, dark
   country backdrop, Mercator <-> Globe switch. Each page defines its themes with GHS.centres(...)
   and hands them to GHS.start(). */
window.GHS = (function () {

  var TABLES = "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/Copernicus/GHS/ghs_ucdb_r2024a_parquet/";
  var COUNTRIES_URL = "https://s3.eu-central-1.amazonaws.com/maps.ixmaps.com/topojson/CNTR_RG_10M_2020_4326.json";
  var SOURCE = "data: <a href='https://human-settlement.emergency.copernicus.eu/ucdb2024Overview.php' target='_blank'>GHS Urban Centre Database R2024A</a>";

  // the map look: "dark" (black sea, dark countries; the default of every page) or "light" (white sea, light grey
  // countries), set by start({ look }) and switched live by the Light/Dark switch (start({ lookToggle: true }));
  // legendTheme ("light" | "dark" | null = the engine decides) is put on every theme, for a legend docked into a card
  var look = "dark", legendTheme = null, tiles = false, lightMapType = "";

  // country backdrop, identical on every page of one look
  function countries() {
    var light = look === "light";
    if (light || tiles) return null;   // the light look has the basemap only (as demo_blurr_and_text_GHS_orthographic.html); so has the dark one with start({ tiles: true })
    return ixmaps.layer("World_countries", function (layer) {
      return layer
        .data({ url: COUNTRIES_URL, type: "topojson", cache: "true" })
        .binding({ geo: "geometry", id: "ISO3_CODE" })
        .type("FEATURE|NOLEGEND")
        .style({ colorscheme: ["#444444"], opacity: "1", shadow: "false", linecolor: ["#000000"], linewidth: "0.5" })
        .meta({ name: "countries", tooltip: "{{}}" });
    });
  }

  // one layer on a 2024 table ("emissions" | "exposure" | "ghsl"): only `columns` are read.
  // binding = { value, size, ... } (position: the urban centre geometry), type + style + meta per theme
  var seq = 0;
  function centres(name, table, columns, binding, type, style, meta) {
    binding = Object.assign({ position: "geometry" }, binding);
    var dataName = "ghs24_" + table + "_" + (++seq);
    // the query runs inside ixmaps-gl as source text: constants are embedded
    var query = "function (themeObj, options) { Data.feed({ source: " + JSON.stringify(TABLES + "ucdb_" + table + ".parquet") +
      ", type: 'parquet', columns: " + JSON.stringify(columns.concat(["geometry"])) +
      " }).load(function (d) { ixmaps.setExternalData(d, { type: 'dbtable', name: options.name }); }); }";
    return ixmaps.layer(name, function (layer) {
      return layer
        .data({ name: dataName, query: query, type: "ext" })
        .binding(binding)
        .type(type)
        .style(Object.assign({ shadow: "false" }, legendTheme ? { legendtheme: legendTheme } : {}, style))
        .meta(Object.assign({ name: name, description: SOURCE, tooltip: "<b>{{theme.title}}</b><br>{{theme.item.chart}}" }, meta));
    });
  }

  // the Light/Dark switch of the pill (opts.lookToggle): sets the basemap sea colour and tells the page (onLook(look)),
  // which swaps its backdrop and themes to the new look
  // light: "" = the engine's default light basemap (CARTO Positron, country names), as in demo_blurr_and_text_GHS_orthographic.html
  // dark: a black sea with the dark country layer, or with start({ tiles: true }) the dark tile basemap (CARTO Dark Matter), no country layer
  function mapTypeOf(l) { return l === "light" ? lightMapType : tiles ? "CartoDB - Dark matter" : "black"; }
  function addLookToggle(el, onLook) {
    var sep = document.createElement("span");
    sep.style.cssText = "width:1px;height:14px;background:currentColor;opacity:.3;margin:0 4px";
    el.appendChild(sep);
    el.insertAdjacentHTML("beforeend", '<span class="pt-label" id="pt-label-light">Light</span>' +
      '<div class="pt-switch" id="pt-look-switch"><div class="pt-knob"></div></div>' +
      '<span class="pt-label" id="pt-label-dark">Dark</span>');
    var sw = document.getElementById("pt-look-switch"), ll = document.getElementById("pt-label-light"), ld = document.getElementById("pt-label-dark");
    function paint() {
      var dark = look === "dark";
      sw.classList.toggle("globe", dark); ll.classList.toggle("active", !dark); ld.classList.toggle("active", dark);
      document.body.classList.toggle("ghs-light", !dark);
    }
    paint();
    sw.addEventListener("click", function () {
      look = look === "dark" ? "light" : "dark";
      paint();
      ixmaps.map().setMapType(mapTypeOf(look));
      if (onLook) onLook(look);
    });
  }

  function addToggle(startGlobe, lookToggle, onLook) {
    var css = document.createElement("style");
    css.textContent =
      "html,body{margin:0;height:100%;background:#000;font-family:-apple-system,sans-serif}" +
      "body.ghs-light{background:#fff}" +
      "body.ghs-light #projection-toggle{background:rgba(255,255,255,.92);color:#999;box-shadow:0 1px 6px rgba(0,0,0,.2)}" +
      "body.ghs-light #projection-toggle .pt-label.active{color:#111}" +
      "body.ghs-light #projection-toggle .pt-switch{background:#ccc}" +
      "body.ghs-light #projection-toggle .pt-switch.globe{background:#ff9800}" +
      "#map_div{position:absolute;inset:0}" +
      "#projection-toggle{position:absolute;left:12px;bottom:28px;z-index:10;display:flex;align-items:center;gap:8px;" +
      "background:rgba(20,20,20,.85);color:#888;padding:6px 12px;border-radius:16px;font-size:12px;user-select:none}" +
      "#projection-toggle .pt-label.active{color:#fff;font-weight:600}" +
      "#projection-toggle .pt-switch{position:relative;width:40px;height:20px;border-radius:10px;background:#555;cursor:pointer;flex:none}" +
      "#projection-toggle .pt-switch.globe{background:#ff9800}" +
      "#projection-toggle .pt-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s ease}" +
      "#projection-toggle .pt-switch.globe .pt-knob{left:22px}";
    document.head.appendChild(css);
    var el = document.createElement("div");
    el.id = "projection-toggle";
    el.innerHTML = '<span class="pt-label" id="pt-label-flat">Mercator</span>' +
      '<div class="pt-switch" id="pt-switch"><div class="pt-knob"></div></div>' +
      '<span class="pt-label" id="pt-label-globe">Globe</span>';
    document.body.appendChild(el);
    if (lookToggle) addLookToggle(el, onLook);

    var sw = document.getElementById("pt-switch"), lf = document.getElementById("pt-label-flat"), lg = document.getElementById("pt-label-globe");
    var isGlobe = !!startGlobe;
    function paint() { sw.classList.toggle("globe", isGlobe); lf.classList.toggle("active", !isGlobe); lg.classList.toggle("active", isGlobe); }
    paint();
    sw.addEventListener("click", function () {
      isGlobe = !isGlobe;
      var project = JSON.parse(ixmaps.getProjectString());
      project.map.map = ixmaps.szResourceBase + "maps/svg/maps/generic/" + (isGlobe ? "orthographic" : "mercator") + ".svg";
      ixmaps.setProjectJSON(project, "keepview");
      paint();
    });
  }

  // opts: { view: [lat, lng], zoom, normalSizeScale, globe: true|false, layers: [...] (after the backdrop),
  //         look: "dark" (default) | "light", lookToggle: true (Light/Dark switch), onLook: function (look),
  //         legendTheme: "light" | "dark", options: { ... } (more map options, merged over the defaults),
  //         tiles: true (the dark look is the dark tile basemap, no country layer),
  //         lightMapType: the light look's basemap (ixmaps mapType name, e.g. "ArcGIS - Topo"; default "" = CARTO Positron),
  //         mapOptions: { ... } (more ixmaps.Map options, e.g. align: "left" for the legend) }
  function start(opts) {
    var startGlobe = opts.globe !== false;
    look = opts.look === "light" ? "light" : "dark";
    legendTheme = opts.legendTheme || null;
    tiles = !!opts.tiles;
    lightMapType = opts.lightMapType || "";
    var mapOpts = { mapType: mapTypeOf(look), legend: "true" };
    if (startGlobe) mapOpts.mapProjection = "orthographic";
    Object.assign(mapOpts, opts.mapOptions);
    var back = countries();
    // layers may be a function: built after the look is set (centres() reads it)
    var layers = typeof opts.layers === "function" ? opts.layers() : opts.layers;
    window._mapPromise = ixmaps.Map("map_div", mapOpts, function (map) {
      map = map.view(opts.view || [20, 20], opts.zoom || 2)
        .options(Object.assign({ objectscaling: "dynamic", normalSizeScale: opts.normalSizeScale || "55364168", flushChartDraw: "1000000" }, opts.options))
      if (back) map = map.layer(back);
      layers.forEach(function (l) { map = map.layer(l); });
      return map;
    });
    addToggle(startGlobe, opts.lookToggle, opts.onLook);
    document.body.classList.toggle("ghs-light", look === "light");
    return window._mapPromise;
  }

  return { SOURCE: SOURCE, countries: countries, centres: centres, start: start, look: function () { return look; } };
})();
