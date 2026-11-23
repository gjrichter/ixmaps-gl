/* Shared setup for the GHS ports (ports/GHS/*.html), in the style of where_people_live_equal_earth.html:
   black basemap, dark country backdrop, GHS Urban Centre Database 2015 as the data source, and a
   Mercator <-> Globe switch (same project swap as ports/DSMW_Globe_colors.html).
   Each page defines its themes with ixmaps.layer(...) and hands them to GHS.start(). */
window.GHS = (function () {

  var DATA_URL = "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/EuroStat/GHS_STAT_UCDB2015MT_GLOBE_R2019A_V1_1.csv.gz";
  var COUNTRIES_URL = "https://s3.eu-central-1.amazonaws.com/maps.ixmaps.com/topojson/CNTR_RG_10M_2020_4326.json";
  var SOURCE = "data: <a href='https://ghsl.jrc.ec.europa.eu/ucdb2018Overview.php' target='_blank'>GHS Urban Centre Database 2015</a>";

  // dark country backdrop, identical on every page
  function countries() {
    return ixmaps.layer("World_countries", function (layer) {
      return layer
        .data({ url: COUNTRIES_URL, type: "topojson", cache: "true" })
        .binding({ geo: "geometry", id: "ISO3_CODE" })
        .type("FEATURE|NOLEGEND")
        .style({ colorscheme: ["#444444"], opacity: "1", shadow: "false", linecolor: ["#000000"], linewidth: "0.5" })
        .meta({ name: "countries", tooltip: "{{}}" });
    });
  }

  // the urban centres table as one layer: binding = { value, size, ... }, type + style per theme
  function urbanCentres(name, binding, type, style, meta) {
    binding = Object.assign({ lookupfield: "GCPNT_LAT|GCPNT_LON" }, binding);
    return ixmaps.layer(name, function (layer) {
      return layer
        .data({ url: DATA_URL, type: "csv", name: "ghs_ucdb", cache: "true" })
        .binding(binding)
        .type(type)
        .style(Object.assign({ shadow: "false" }, style))
        .meta(Object.assign({ name: name, description: SOURCE, tooltip: "<b>{{theme.title}}</b><br>{{theme.item.chart}}" }, meta));
    });
  }

  function addToggle(startGlobe) {
    var css = document.createElement("style");
    css.textContent =
      "html,body{margin:0;height:100%;background:#000;font-family:-apple-system,sans-serif}" +
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

  // opts: { view: [lat, lng], zoom, normalSizeScale, globe: true|false, layers: [...] (after the backdrop) }
  function start(opts) {
    var startGlobe = opts.globe !== false;
    var mapOpts = { mapType: "black", legend: "true" };
    if (startGlobe) mapOpts.mapProjection = "orthographic";
    var back = countries();
    window._mapPromise = ixmaps.Map("map_div", mapOpts, function (map) {
      map = map.view(opts.view || [20, 20], opts.zoom || 2)
        .options({ objectscaling: "dynamic", normalSizeScale: opts.normalSizeScale || "55364168", flushChartDraw: "1000000" })
        .layer(back);
      opts.layers.forEach(function (l) { map = map.layer(l); });
      return map;
    });
    addToggle(startGlobe);
    return window._mapPromise;
  }

  return { DATA_URL: DATA_URL, SOURCE: SOURCE, countries: countries, urbanCentres: urbanCentres, start: start };
})();
