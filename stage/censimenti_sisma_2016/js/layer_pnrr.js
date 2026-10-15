/*********************************************************************
layer_pnrr.js

$Comment: PNRR layers (stars per comune, single projects) for the sisma 2016
          crater, ported from ports/PNRR/index_embed_Open_Data_PNRR_Dati_Universo_REGIS_13.html
          - data: slim extract of the REGIS universe v13 (06.2026) for the 138 crater
            comuni (PROCOM, missione, importo, project fields), loaded on first use from ixmaps-data (ixmaps.pnrr.dataUrl)
          - theme ids carry the pnrr_ prefix: the census page already uses
            "chart" / "choropleth" / "details" as theme ids
          - loaded on demand (ixmaps.pnrr.set(true)), shown / hidden afterwards
**********************************************************************/

(function () {

    var P = ixmaps.pnrr = ixmaps.pnrr || {};

    // the data (window.PNRR_CRATERE, rows as objects) is fetched and parsed on first use. The page may override the URL.
    P.dataUrl = P.dataUrl || "https://raw.githubusercontent.com/gjrichter/ixmaps-data/8603caa/by-project/sisma-2016-cratere/pnrr/pnrr_cratere.csv";

    P.missioni = [
        { code: "M1", color: "#5BBBEB", label: "M1 - Digitalizz., innov., competi., cultura e turismo" },
        { code: "M2", color: "#92C151", label: "M2 - Rivoluzione verde e trans. eco." },
        { code: "M3", color: "#EA425B", label: "M3 - Infrastrutture per una mobilità sostenibile" },
        { code: "M4", color: "#F49E4B", label: "M4 - Istruzione e ricerca" },
        { code: "M5", color: "#B671DC", label: "M5 - Inclusione e coesione" },
        { code: "M6", color: "#FACB49", label: "M6 - Salute" },
        { code: "M7", color: "#7B8794", label: "M7 - REPowerEU" }
    ];
    var values = P.missioni.map(function (m) { return m.code; });
    var labels = P.missioni.map(function (m) { return m.label; });
    var colors = P.missioni.map(function (m) { return m.color; });

    var THEMES = ["pnrr_chart", "pnrr_details"];
    var BASE_SCALE = { chart: 1.2, details: 0.3 };
    var loaded = false;
    var currentMissione = "";

    /* position layer: the centroids of the comuni (A. Borruso), exactly as on the PNRR page */
    P.georef = function () {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                url: "https://raw.githubusercontent.com/aborruso/centroidiurbanfabric/master/output/ElencoUnitaAmministrative2011.geojson",
                type: "geojson"
            })
            .binding({
                id: "PRO_COM_T",
                position: "geometry"
            })
            .type("FEATURES|NOLEGEND")
            .style({
                colorscheme: ["none"],
                linecolor: "none",
                linewidth: "1",
                scale: "0.0001"
            })
        );
    };

    /* stars: the amount per mission, aggregated per comune */
    P.chart = function () {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({ obj: window.PNRR_CRATERE, type: "json" })
            .binding({
                position: "PROCOM",
                value: "missione",
                size: "importo",
                title: "Descrizione Comune"
            })
            .type("CHART|SYMBOL|SEQUENCE|STAR|DOPACITY|GLOW|SORT|DOWN|SIZE|CATEGORICAL|ORDER|AGGREGATE|SUM|VALUES|INLINETEXT|TITLE|BOX|COMPACTLEGEND")
            .style({
                values: values,
                label: labels,
                colorscheme: colors,
                fillopacity: "0.66",
                linecolor: "white",
                linewidth: "1",
                valuescale: "1.2",
                showdata: "true",
                units: "€",
                scale: "1.2",
                dopacitypow: "2",
                textscale: "0.5",
                boxopacity: "0",
                bordercolor: "none",
                normalsizevalue: "10000000",
                aggregationscale: [
                    "1:1", "PROCOM",
                    "1:10000000", "Descrizione Provincia"
                ],
                boxupper: "1:250000",
                glowlower: "1:250000",
                valueupper: "1:1000000",
                chartupper: "1:1000000",
                chartlower: "1:150000",
                name: "pnrr_chart"
            })
            .meta({
                title: "<b>PNRR - progetti nei comuni del cratere</b>",
                description: "Universo REGIS v13, 06.2026. Livello comunale: <b>solo</b> i progetti direttamente associati a un comune",
                splash: "scaricando dati ..."
            })
        );
    };

    /* the single projects, from close up */
    P.details = function () {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({ obj: window.PNRR_CRATERE, type: "json" })
            .binding({
                position: "PROCOM",
                value: "missione",
                title: "Descrizione Comune"
            })
            .type("CHART|SYMBOL|VALUES|FIXSIZE|INLINETEXT|MULTIQUAD|SORT|CATEGORICAL|SUM|BOX|TITLE|COMPACTLEGEND")
            .style({
                values: values,
                label: labels,
                colorscheme: colors,
                fillopacity: "0.8",
                showdata: "true",
                valuefield: "importo",
                sizefield: "importo",
                units: "€",
                gridx: "20",
                scale: "0.3",
                normalsizevalue: "1",
                linecolor: "white",
                linewidth: "0.1",
                rangescale: "1.1",
                valuescale: "0.3",
                boxopacity: "0.5",
                boxmargin: "2",
                textscale: "7",
                textcolor: "black",
                chartupper: "1:150000",
                name: "pnrr_details"
            })
            .meta({
                title: "<b>PNRR - i singoli progetti</b>",
                tooltip: "<b>{{Descrizione Comune}}</b> ({{Descrizione Provincia}})<br>" +
                         "<i>{{Sintesi progetto}}</i><br>" +
                         "{{missione}} - {{Descrizione Misura}}<br>" +
                         "Soggetto attuatore: {{Soggetto attuatore}}<br>" +
                         "Finanziamento PNRR: {{Finanziamento PNRR}} € (totale {{Finanziamento Totale}} €)<br>" +
                         "Stato: {{stato di avanzamento}} - {{Descrizione Fase Attuale}}<br>" +
                         "CUP: {{CUP}}",
                splash: "scaricando dati ..."
            })
        );
    };

    function eachTheme(fn) { THEMES.forEach(function (id) { try { fn(id); } catch (e) { console.warn("[pnrr]", id, e); } }); }

    // semicolon CSV with quoted fields -> array of row objects (numbers for the amount fields)
    function parseCSV(text) {
        var rows = [], row = [], cur = "", q = false;
        for (var i = 0; i < text.length; i++) {
            var c = text[i];
            if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
            else if (c === '"') q = true;
            else if (c === ";") { row.push(cur); cur = ""; }
            else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
            else if (c !== "\r") cur += c;
        }
        if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
        var h = rows.shift(), num = { importo: 1, "Finanziamento Totale": 1, "Finanziamento PNRR": 1, pop_2022: 1 };
        return rows.filter(function (r) { return r.length === h.length; }).map(function (r) {
            var o = {};
            h.forEach(function (k, j) { o[k] = num[k] ? (+r[j] || 0) : r[j]; });
            return o;
        });
    }

    // the CSV is on a CORS-enabled host (raw.githubusercontent.com), so this also works from file://
    // (a <script> from there is refused: served as text/plain with nosniff)
    var dataWaiting = null;
    function ensureData(cb) {
        if (window.PNRR_CRATERE) return cb();
        if (dataWaiting) return dataWaiting.push(cb);
        dataWaiting = [cb];
        fetch(P.dataUrl).then(function (r) { return r.text(); }).then(function (t) {
            window.PNRR_CRATERE = parseCSV(t);
            var w = dataWaiting; dataWaiting = null; w.forEach(function (f) { f(); });
        }).catch(function (e) { console.error("[pnrr] data not loaded: " + P.dataUrl, e); dataWaiting = null; loaded = false; });
    }

    /* on / off. The first "on" loads the data and defines the themes, later ones only show / hide them */
    var wanted = false;
    P.set = function (on) {
        var map = ixmaps.map();
        wanted = !!on;
        if (on && !loaded) {
            loaded = true;
            ensureData(function () {
                // no "replace": the position layer and both themes share the layer name
                // "ITALIA_Comuni_2022" (the join key), replace would swap the position layer out
                map.add(P.georef(), "silent");
                // the themes join their positions to the centroids once these are loaded
                setTimeout(function () {
                    map.add(P.chart(), "silent");
                    map.add(P.details(), "silent");
                }, 4000);
                // the themes are defined one after the other: apply what was asked meanwhile
                setTimeout(function () {
                    if (sizeFactor !== 1) P.setSize(sizeFactor);
                    if (currentMissione) P.setMissione(currentMissione);
                    if (!wanted) eachTheme(function (id) { map.setThemeVisible(id, false); });
                }, 7000);
            });
        } else if (loaded) {
            eachTheme(function (id) { map.setThemeVisible(id, !!on); });
        }
    };

    var currentMisura = "";

    function applyFilter() {
        if (!loaded) return;
        var map = ixmaps.map(), f = "";
        if (currentMissione) f = 'WHERE missione = "' + currentMissione + '"';
        if (currentMissione && currentMisura) f += ' AND "Descrizione Misura" = "' + currentMisura.replace(/"/g, '') + '"';
        eachTheme(function (id) {
            if (f) map.changeThemeStyle(id, "filter:" + f, "set");
            else map.changeThemeStyle(id, "filter", "remove");
        });
    }

    /* size factor (1 = as defined) for the stars and the single projects; applied to themes defined later too */
    var sizeFactor = 1;
    P.setSize = function (f) {
        sizeFactor = +f || 1;
        if (!loaded) return;
        var map = ixmaps.map();
        clearTimeout(P._sizeTimer);
        P._sizeTimer = setTimeout(function () {
            map.changeThemeStyle("pnrr_chart", "scale:" + (BASE_SCALE.chart * sizeFactor), "set");
            map.changeThemeStyle("pnrr_details", "scale:" + (BASE_SCALE.details * sizeFactor), "set");
        }, 30);
    };

    /* "" = all missions, else M1..M7 (resets the measure) */
    P.setMissione = function (code) {
        currentMissione = code || "";
        currentMisura = "";
        applyFilter();
    };

    /* "" = all measures of the mission, else one "Descrizione Misura" */
    P.setMisura = function (name) {
        currentMisura = name || "";
        applyFilter();
    };

    /* centroids of the comuni with projects (the same file as the position layer): PROCOM -> [lng, lat] */
    var centroids = null, centroidsWaiting = null;
    function ensureCentroids(cb) {
        if (centroids) return cb();
        if (centroidsWaiting) return centroidsWaiting.push(cb);
        centroidsWaiting = [cb];
        var url = "https://raw.githubusercontent.com/aborruso/centroidiurbanfabric/master/output/ElencoUnitaAmministrative2011.geojson";
        fetch(url).then(function (r) { return r.json(); }).then(function (g) {
            var used = {};
            window.PNRR_CRATERE.forEach(function (r) { used[r.PROCOM] = 1; });
            centroids = {};
            g.features.forEach(function (f) {
                var k = f.properties.PRO_COM_T;
                if (used[k]) centroids[k] = f.geometry.coordinates;
            });
            var w = centroidsWaiting; centroidsWaiting = null; w.forEach(function (f) { f(); });
        }).catch(function (e) { console.warn("[pnrr] centroids not loaded, facets are not clipped", e); centroids = {}; var w = centroidsWaiting; centroidsWaiting = null; w.forEach(function (f) { f(); }); });
    }

    /* facets of one mission, clipped to the map view: measures with project count and amount.
       Computed from the whole extract (the theme's own item list holds only what is in view and drawn). */
    P.facets = function (code, cb) {
        ensureData(function () {
            ensureCentroids(function () {
                var bb = ixmaps.getBoundingBox && ixmaps.getBoundingBox();
                var inView = function (r) {
                    var c = centroids[r.PROCOM];
                    if (!bb || !c || !Object.keys(centroids).length) return true;
                    return c[0] >= bb[0].lng && c[0] <= bb[1].lng && c[1] >= bb[0].lat && c[1] <= bb[1].lat;
                };
                var g = {};
                window.PNRR_CRATERE.forEach(function (r) {
                    if (r.missione !== code || !inView(r)) return;
                    var m = r["Descrizione Misura"] || "-";
                    var o = g[m] = g[m] || { misura: m, n: 0, sum: 0 };
                    o.n++; o.sum += +r.importo || 0;
                });
                cb(Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.sum - a.sum; }));
            });
        });
    };

    /* call fn (debounced) whenever the map view changes */
    var viewListeners = [], viewTimer = null;
    P.onViewChange = function (fn) {
        if (!viewListeners.length) {
            var prev = ixmaps.htmlgui_onZoomAndPan;
            ixmaps.htmlgui_onZoomAndPan = function () {
                var r = typeof prev === "function" ? prev.apply(this, arguments) : undefined;
                clearTimeout(viewTimer);
                viewTimer = setTimeout(function () { viewListeners.forEach(function (f) { f(); }); }, 400);
                return r;
            };
        }
        viewListeners.push(fn);
    };

})();
