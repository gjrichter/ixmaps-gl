/*********************************************************************
layer_compare.js

$Comment: provides JavaScript layer definitions for ixmaps
$Source : layer_compare.js,v $

$InitialAuthor: guenter richter $
$InitialDate: $
$Author: guenter richter $
$Id: layer.js 8 2025-01-11 08:14:02Z Guenter Richter $

Copyright (c) Guenter Richter
$Log: layer_compare.js,v $
**********************************************************************/


(function () {

    var regione = "R" + String(ixmaps.regione);
    var filter = "WHERE PROCOM like \"" + ixmaps.procom + "\" ";
    var filter_compare = "WHERE PROCOM.2 like \"" + ixmaps.procom + "\"";

    //filter = "";
    // ------------------------------------------------------------------------
    // ISTAT SITUAS comune-code translation, as a static snapshot - NOT a live
    // call to situas-servizi.istat.it. That was tried first (22/08/2026) and
    // reverted: SITUAS is a live government reporting service
    // (Cache-Control: no-store, no CDN) meant for occasional interactive
    // lookups, not for being hit by every visitor of a public map on every
    // pan/zoom - it caused unpredictable hangs and, once, a genuine page
    // freeze in real browser testing, despite curl always working fine.
    // See censimenti_2011_2021_metodo_di_confronto.md for the full history.
    //
    // The static file below is produced by
    // ixmaps-data/scripts/fetch_situas_censimenti_2011_2021.py (re-run
    // periodically - administrative changes are rare, monthly is plenty) and
    // combines reports 99 and 129 exactly as query_data_procom_all()/
    // query_data() need them: already de-padded to the PROCOM convention
    // used throughout this file, already date-cut to the census epoch
    // (31/12/2021 - must match the "2021" procom/sezioni data vintage; do
    // NOT reproject to "today", or 2011 codes would be remapped past where
    // the 2021 side of the comparison sits, e.g. the 2026 Sardinia province
    // reorganization must not apply here).
    //
    // Attached to ixmaps (a true global), not an IIFE closure var:
    // query_data() and query_data_procom_all() below are toString()'d and
    // eval'd elsewhere (as ixmaps.pop_diff / ixmaps.all_data_condensed) in a
    // scope that can't see closure variables from this file - a bare var
    // here would throw ReferenceError the moment either function is called.
    // ------------------------------------------------------------------------

    ixmaps.__SITUAS_CODES_URL = "https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-data@main/by-project/censimenti-2011-2021/situas_codes.json";

    ixmaps.__getSituasCodes = function (callback) {
        if (ixmaps.__situasCodes) {
            callback(ixmaps.__situasCodes);
            return;
        }
        if (!ixmaps.__situasCodesPromise) {
            ixmaps.__situasCodesPromise = fetch(ixmaps.__SITUAS_CODES_URL)
                .then(function (response) { return response.json(); })
                .catch(function (e) {
                    console.error("SITUAS static codes fetch failed:", e);
                    return { comune_translation: {}, ap_only_translation: {} };
                })
                .then(function (data) {
                    ixmaps.__situasCodes = data;
                    return data;
                });
        }
        ixmaps.__situasCodesPromise.then(callback);
    };

    // report 99 (already resolves AP + CS/fusione + ES incorporations
    // together, and correctly leaves comuni born from portions of territory
    // - Mappano, Misiliscemi - unmapped rather than inventing a fake
    // predecessor); used by query_data_procom_all() at comune level
    ixmaps.__getSituasComuneTranslation = function (callback) {
        ixmaps.__getSituasCodes(function (data) {
            callback(data.comune_translation || {});
        });
    };

    // report 129, AP-type events only, up to the census epoch; used by
    // query_data() at census-SECTION level, where fusion-type changes must
    // NOT be remapped onto section-ID prefixes (spatially wrong in the
    // majority of cases - method doc §7.3) - report 99's blended
    // translation can't be filtered by type, so it's not safe to reuse here
    ixmaps.__getSituasApOnlyTranslation = function (callback) {
        ixmaps.__getSituasCodes(function (data) {
            callback(data.ap_only_translation || {});
        });
    };

    // ------------------------------------------------------------------------
    // data query and processing
    // ------------------------------------------------------------------------

    query_data = function (theme, options) {

        // newPROCOM here comes from ISTAT SITUAS report 129 (AP-type variations
        // only, up to the census epoch) via ixmaps.__getSituasApOnlyTranslation
        // below - always a plain object (never null), so no "not loaded yet"
        // guard is needed here (unlike the old static-CSV version)
        var __runMerge = function (newPROCOM) {

            // this whole merge runs synchronously; any exception in here would
            // otherwise propagate up into htmlgui.js's ext-query dispatch and
            // surface as the misleading "external data function: 'pop_diff'
            // not defined!" alert - log the real cause instead and bail out,
            // the next refreshTheme() retries
            try {

                var data_2011 = dataquery_flatgeobuffer;
                var data_2021 = dataquery_flatgeobuffer_2;
                //ixmaps.szThemeNameA[options.theme.szName] = options.theme.szName;

                // sezioni_censimento_11/_21 (flatgeobuf) reload asynchronously on
                // pan/zoom/resize, independently of this theme; if this fires
                // before that reload produced data, bail out - the next
                // refreshTheme() retries with fresh data
                if (ixmaps.in_query_1 || ixmaps.in_query_2 || !data_2011 || !data_2021) {
                    return;
                }

                data_2011 = data_2011.select("WHERE SEZ2011 NOT 888888");
                data_2021 = data_2021.select("WHERE SEZ21_ID NOT 888888");

                // remap only the comune-code PREFIX of 2011 section IDs for pure
                // province reassignments (SITUAS "AP-..." events); fusion-type
                // changes are deliberately NOT remapped at section level - see
                // censimenti_2011_2021_metodo_di_confronto.md §7.3
                // -------------------------------------------------------------------------------
                data_2011.column("SEZ2011").map(function (value) {
                    let procom = value.substr(0, value.length - 7);
                    if (newPROCOM[procom]) {
                        value = value.replace(procom, newPROCOM[procom]);
                    }
                    return value;
                });

                var lookup1 = data_2011.lookupStringArray({ key: "SEZ2011", value: "P1" });
                var lookup2 = data_2021.lookupStringArray({ key: "SEZ21_ID", value: "P1" });
                for (var i in lookup1) {
                    if (!lookup2[i]) {
                        data_2021.addRow({ "SEZ21_ID": i });
                    }
                }
                for (var i in lookup2) {
                    if (!lookup1[i]) {
                        data_2011.addRow({ "SEZ2011": i });
                    }
                }

                // -------------------------------------------------------------------------------

                var merger = new Data.Merger()
                    .addSource(data_2011, {
                        lookup: "SEZ2011"
                    })
                    .addSource(data_2021, {
                        lookup: "SEZ21_ID"
                    })
                    .realize(
                        function (mergedTable) {
                            //mergedTable = mergedTable.select("WHERE SEZ2011.1 like 42009");

                            ixmaps.setExternalData(mergedTable, {
                                type: "dbtable",
                                name: options.name
                            });
                        });

            } catch (e) {
                console.error("query_data/pop_diff merge failed:", e);
            }
        };

        ixmaps.__getSituasApOnlyTranslation(__runMerge);
    };

    query_data_procom = function (theme, options) {

        var broker = new Data.Broker()

            .addSource("https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2011/" + options.name.substr(0, 3) + "_indicatori_2011_sezioni.csv.gz", "csv")
            .addSource("https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + options.name.substr(0, 3) + "_indicatori_2021_sezioni.csv.gz", "csv")

            .realize(
                function (dataA) {

                    var data_2011 = dataA[0];
                    var data_2021 = dataA[1];

                    data_2011 = data_2011.condense({
                        lead: "PROCOM",
                        keep: "PROCOM"
                    });
                    data_2021 = data_2021.condense({
                        lead: "PROCOM",
                        keep: "PROCOM"
                    });

                    var merger = new Data.Merger()
                        .addSource(data_2011, {
                            lookup: "PROCOM"
                        })
                        .addSource(data_2021, {
                            lookup: "PROCOM"
                        })
                        .realize(
                            function (mergedTable) {
                                //mergedTable = mergedTable.select("WHERE P1.2 > 0");
                                ixmaps.setExternalData(mergedTable, {
                                    type: "dbtable",
                                    name: options.name
                                });
                            });
                });
    };

    query_data_procom_all = function (theme, options) {

        // fetch the census CSVs and the ISTAT SITUAS comune translation in
        // parallel; run the merge once BOTH have resolved (whichever finishes
        // last triggers it) - avoids a serial wait on first (uncached) load
        var __brokerData = null;
        var __newPROCOM = null;

        var __tryMerge = function () {
            if (!__brokerData || !__newPROCOM) {
                return;
            }

            var data_2011 = __brokerData[0];
            var data_2021 = __brokerData[1];
            var newPROCOM = __newPROCOM;

            // ISTAT SITUAS report 99: comune-code translation table,
            // 31/12/2011 -> census epoch; already resolves province changes
            // (AP), fusions (CS) and incorporations (ES) together, and
            // correctly leaves comuni born from portions of territory
            // (Mappano, Misiliscemi) unmapped - see
            // censimenti_2011_2021_metodo_di_confronto.md
            //
            // single lookup, NOT a chain-following while loop: report 99
            // already gives the fully-resolved code for the whole requested
            // period in one row. The old CSV-based code chained
            // (while (newPROCOM[value]) value = newPROCOM[value]) because
            // that lookup only ever listed actual changes; report 99 lists
            // EVERY comune, including the ~7600 unchanged ones as
            // self-mappings ("1001" -> "1001") - a while loop against that
            // spins forever the moment it hits the first unchanged comune.
            // Confirmed live: this is what froze the page, not SITUAS/CORS.
            data_2011.column("PROCOM").map(function (value) {
                return newPROCOM[value] || value;
            });

            data_2011 = data_2011.condense({ lead: "PROCOM", keep: ["PROCOM", "CODREG", "CODPRO", "CODCOM"] });

            var merger = new Data.Merger()
                .addSource(data_2011, {
                    lookup: "PROCOM"
                })
                .addSource(data_2021, {
                    lookup: "PROCOM"
                })
                .realize(
                    function (mergedTable) {
                        //mergedTable = mergedTable.select("WHERE P1.2 > 0");

                        let st11_index = mergedTable.column("ST1.1").index
                        let p11_index = mergedTable.column("P1.1").index
                        let p12_index = mergedTable.column("P1.2").index
                        mergedTable.addColumn({ destination: "ST1.12" }, function (row) {
                            return Math.floor(row[st11_index] * row[p12_index] / row[p11_index]);
                        });

                        ixmaps.setExternalData(mergedTable, {
                            type: "dbtable",
                            name: options.name
                        });
                    });
        };

        ixmaps.__getSituasComuneTranslation(function (newPROCOM) {
            __newPROCOM = newPROCOM;
            __tryMerge();
        });

        var broker = new Data.Broker()

            .addSource("https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2011/all_indicatori_2011_procom.csv.gz", "csv")
            .addSource("https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/all_indicatori_2021_procom.csv.gz", "csv")

            .realize(
                function (dataA) {
                    __brokerData = dataA;
                    __tryMerge();
                });
    };

    process_data = function (data) {
        return data.select("WHERE SEZ21_ID NOT 88888");
    }

    // ------------------------------------------------------------------------
    // data position layer (poligoni delle sezioni)  
    // ------------------------------------------------------------------------


    __georef_sez2011_fgb = () => {
        return ixmaps.layer("sezioni_censimento_11", layer => layer
            .data({
                type: "ext",
                name: "dataquery_flatgeobuffer",
                ext: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/TestData/istat_basi_territoriali_2011_indicatore_joined.fgb"
            })
            .type("FEATURE")
            .binding({
                id: "SEZ2011",
                size: "Shape_Area"
            })
            .style({
                colorscheme: ["none"],
                opacity: "1",
                linecolor: "none",
                linewidth: "0.5",
                name: "sezioni_2011",
                featureupper: "1:150000"
            })
        );
    };
    __georef_sez2021_fgb = () => {
        return ixmaps.layer("sezioni_censimento_21", layer => layer
            .data({
                type: "ext",
                name: "dataquery_flatgeobuffer_2",
                ext: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/TestData/istat_basi_territoriali_2021_indicatore_joined.fgb"
            })
            .type("FEATURE")
            .binding({
                id: "SEZ21_ID",
                size: "SHAPE_Area"
            })
            .style({
                colorscheme: ["none"],
                opacity: "1",
                linecolor: "none",
                linewidth: "0.5",
                name: "sezioni_2021",
                featureupper: "1:150000"
            })
        );
    };


    /* 1. centroids of 2011, by curtesy of Andrea Borruso */
    __georef_urban = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                url: "https://raw.githubusercontent.com/aborruso/centroidiurbanfabric/master/output/ElencoUnitaAmministrative2011.geojson",
                type: "geojson"
            })
            .binding({
                id: "PRO_COM",
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

    /* 2. last istat data (2022), for changes since 2011 */
    __georef = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                url: "https://s3.eu-central-1.amazonaws.com/maps.ixmaps.com/Istat/comuni_2022/Com01012022_s_WGS84.topojson.gz",
                type: "topojson"
            })
            .binding({
                id: "PRO_COM",
                position: "geometry"
            })
            .type("FEATURES|NOLEGEND")
            .style({
                colorscheme: ["none"],
                linecolor: "gray",
                linewidth: "0.01",
                sizefield: "Shape_Area",
                featurelower: "1:150000"
            })
        );
    };


    // ------------------------------------------------------------------------
    // data visualizzation layer 
    // - using above defined data query function and position layer
    // ------------------------------------------------------------------------

    __pop_procom_circle = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHART|BUBBLE|SIZE|AGGREGATE|NOLEGEND")
            .binding({
                value: "P1.2",
                position: "PROCOM.1",
                tonumber: true
            })
            .style({
                colorscheme: [
                    "#aaaaaa"
                ],
                fillopacity: 0.2,
                linecolor: "RGBA(0,0,0,0.1)",
                linewidth: "0.5",

                units: "",
                normalsizevalue: "30000",
                sizepow: 2,
                chartupper: "1:500000",
                chartlower: "1:150000",
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "10px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                lookupdigits: "6"
            })
            .meta({
                name: "chart_procom_pop",
                title: "Popolazione 2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    /**
     ** general population change
     **/

    __sez2021_pop_choropleth = () => {
        return ixmaps.layer("sezioni_censimento_21", layer => layer
            .data({
                name: "dataquery_flatgeobuffer_2"
            })
            .filter("WHERE SEZ21_ID NOT 8888888")
            .type("CHOROPLETH|HEADTAIL|DENSITY|ZEROISVALUE|DOPACITY")
            .binding({
                value: "P1",
                alpha: "P1",
                position: "SEZ21_ID",
                tonumber: true
            })
            .style({
                colorscheme: [
                    "8",
                    "#F2d246",
                    "#100050",
                    "3colors",
                    "#CC4878"
                ],
                units: "",
                alphafield100: "$density$",
                dopacitypow: "2",
                dopacityscale: "1",
                fillopacity: 1,
                showdata: true,
                nodatacolor: "RGB(255,253,216)",
                chartupper: "1:150000"
            })
            .meta({
                name: "choropleth",
                title: "Densità di popolazione 2021",
                description: "<b>poligoni</b> delle sezioni di censimento",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez2021_eta_choropleth = () => {
        return ixmaps.layer("sezioni_censimento_21", layer => layer
            .data({
                name: "dataquery_flatgeobuffer_2"
            })
            .filter("WHERE SEZ21_ID NOT 8888888")
            .type("CHOROPLETHE|DOMINANT|DEVIATION|DOPACITY|HORZ|SIMPLELEGEND")
            .binding({
                value: "P14|P15|P16|P17|P18|P19|P20|P21|P22|P23|P24|P25|P26|P27|P20|P29",
                value100: "P83",
                alpha: "P83",
                position: "SEZ21_ID",
                tonumber: true
            })
            .style({
                colorscheme: [
                    "16",
                    "RGB(143,244,0)",
                    "RGB(150,120,149)",
                    "RGB(116,188,200)",
                    "2colors"
                ],
                label: [
                    "meno di 5",
                    "5 - 9",
                    "10 - 14",
                    "15 - 19",
                    "20 - 24",
                    "25 - 29",
                    "30 - 34",
                    "35 - 39",
                    "40 - 44",
                    "45 - 49",
                    "50 - 54",
                    "55 - 59",
                    "60 - 64",
                    "65 - 69",
                    "70 - 74",
                    "> 74"
                ],
                units: "%",
                alphafield100: "$density$",
                dopacitypow: 1.5,
                dopacityscale: 1
            })
            .meta({
                name: "choropleth",
                title: "Classe d'età sopra alla media",
                tooltip: "<h2 style='margin-top:0'>{{theme.title}}</h2>{{theme.item.chart}}"

            })
        );
    };

    __sez2021_edu_choropleth = () => {
        return ixmaps.layer("sezioni_censimento_21", layer => layer
            .data({
                name: "dataquery_flatgeobuffer_2"
            })
            .filter("WHERE SEZ21_ID NOT 8888888")
            .type("CHOROPLETHE|DOMINANT|DOPACITY|HORZ|SIMPLELEGEND")
            .binding({
                value: "P90|P89|P88|P87|P86",
                value100: "P83",
                alpha: "P83",
                position: "SEZ21_ID",
                tonumber: true
            })
            .style({
                colorscheme: [
                    "red",
                    "orange",
                    "#00cccc",
                    "green",
                    "yellow"
                ],
                label: [
                    "titoli terziari",
                    "diploma di scuola superiore",
                    "licenza media",
                    "licenza elementare",
                    "senza titolo di studio"
                ],
                units: "%",
                alphafield100: "$density$",
                dopacitypow: 1,
                dopacityscale: 2
            })
            .meta({
                name: "choropleth",
                title: "Grado istruzione predominante",
                tooltip: "<h2 style='margin-top:0'>{{theme.title}}</h2>{{theme.item.chart}}"

            })
        );
    };


    __sez2011_stranieri_choropleth = () => {
        return ixmaps.layer("sezioni_censimento_21", layer => layer
            .data({
                name: "dataquery_flatgeobuffer_2"
            })
            .filter("WHERE SEZ21_ID NOT 8888888")
            .type("CHOROPLETHE|DOMINANT|DOPACITY|HORZ|SIMPLELEGEND")
            .binding({
                value: "ST9|ST10|ST11|ST12|ST13",
                alpha: "ST15",
                position: "SEZ2011",
                tonumber: true
            })
            .style({
                colorscheme: [
                    "#00A8E6",
                    "#FFAD01",
                    "#E901AF",
                    "#99FE00",
                    "cyan"
                ],
                label: [
                    "Europa",
                    "Africa",
                    "America",
                    "Asia",
                    "Oceania"
                ],
                units: "",
                alphafield100: "$density$",
                dopacitypow: 1.5,
                dopacityscale: 2.5
            })
            .meta({
                name: "choropleth",
                title: "Provenienza stranieri predominante",
                tooltip: "<h2 style='margin-top:0'>{{theme.title}}</h2>{{theme.item.chart}}"

            })
        );
    };

    __sez2021_stranieri_choropleth = () => {
        return ixmaps.layer("sezioni_censimento_21", layer => layer
            .data({
                name: "dataquery_flatgeobuffer_2"
            })
            .filter("WHERE SEZ21_ID NOT 8888888")
            .type("CHOROPLETHE|DOMINANT|DOPACITY|HORZ|SIMPLELEGEND")
            .binding({
                value: "ST16|ST19",
                value100: "P1",
                alpha: "ST1",
                position: "SEZ21_ID",
                tonumber: true
            })
            .style({
                colorscheme: [
                    "#00A8E6",
                    "#FFAD01"
                ],
                label: [
                    "Unione Europea",
                    "Extra-EU"
                ],
                units: "%",
                alphafield100: "P1",
                dopacitypow: 1,
                dopacityscale: 1
            })
            .meta({
                name: "choropleth",
                title: "Provenienza stranieri predominante",
                tooltip: "<h2 style='margin-top:0'>{{theme.title}}</h2>{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_user = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZE|3D|DIFFERENCE|AGGREGATE|RELOCATE|SUM|VALUES|SIMPLELEGEND|NOOUTLIER")
            .binding({
                value: "P1.1|P1.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "red",
                    "#9A384E"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "0",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                sizepow: "1.5",
                fillopacity: 1,
                fadenegative: 1,
                linewidth: "0.5",
                normalsizevalue: "1000",
                valuecolor: "black",
                minvaluesize: "2",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                description: "livello: sezioni di censimento, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_user_relative = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P1.1|P1.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .filter("WHERE P1.1 > 50 AND P1.2 > 50")
            .style({
                datacache: "false",
                userdraw: "arrowChart",
                colorscheme: [
                    "red",
                    "#9A384E"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "%",
                showdata: true,
                aggregationscale: [
                    "1:1", "0",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                sizepow: "2.5",
                fillopacity: 1,
                fadenegative: 1,
                linewidth: "0.5",
                normalsizevalue: "100",
                valuecolor: "black",
                minvaluesize: "2",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                description: "livello: <b>sezioni di censimento</b>, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2011_2021_arrow_user = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|SIZE|3D|DIFFERENCE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P1.1|P1.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "red",
                    "#9A384E"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "10px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                sizepow: "2",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "5000",
                valuecolor: "black",
                minvaluesize: "5",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2011_2021_arrow_user_stranieri = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|SIZE|3D|DIFFERENCE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "ST1.1|ST1.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#4488dd"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "10px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                sizepow: "2",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "10000",
                valuecolor: "black",
                minvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2011_2021_arrow_user_educazione_terzo = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|SIZE|3D|DIFFERENCE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P47.1|P90.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#dd0044"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "10px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                sizepow: "2",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "10000",
                valuecolor: "black",
                minvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021<br><b>educazione terzo grado </b>",
                description: "a livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    /**
    ***
    *** Variazioni relativi
    ***
    **/

    __procom_2011_2021_arrow_user_relative = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P1.1|P1.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "red",
                    "#9A384E"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "%",
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:10000", "50px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                xxsizepow: "2",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "25",
                valuecolor: "black",
                valuescale: 1.8,
                xxminvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021",
                description: "a livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2011_2021_arrow_user_relative_meno_5 = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P14.1|P14.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .filter("WHERE P1.2 > 1000 AND P1.1 > 1000")
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "green",
                    "green"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "%",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "50px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                xxsizepow: "2",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "200",
                valuecolor: "black",
                valuescale: 1.8,
                minvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021<br><b>fascia età da 0 a 5 anni</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2011_2021_arrow_user_relative_piu_75 = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P25.1|P25.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .filter("WHERE P1.2 > 1000 AND P1.1 > 1000")
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#aa44aa"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "%",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "50px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                xxsizepow: "2",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "200",
                valuecolor: "black",
                valuescale: 1.8,
                minvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021<br><b>fascia età 75+ anni</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    // here we compare two %, one from 2011 and 2021 showuìing the difference
    // to be able to create the % of 2011 with the total population of 2021 (due to aggregation we must calculate the % for every zoom)
    // we created in the data query function the number of strangers from 2011 projected to the popolation of 2021 (ST1.12)
    // than we can calcolate the difference of the % like below (value = ST1.12|ST1.2, value100 = P1.2 and type DIFFERENCE)

    __procom_2011_2021_arrow_user_relative_stranieri = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "ST1.1|ST1.2",
                value100: "P1.1|P1.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#4488dd"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "%",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "50px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                xxsizepow: "2",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "20",
                valuecolor: "black",
                valuescale: 1.5,
                minvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021<br><b>stranieri o aploidi</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };


    __procom_2011_2021_arrow_user_relative_educazione_terzo = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P47.1|P90.2",
                value100: "P1.1|P1.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .filter("WHERE P1.2 > 500 AND P1.1 > 500")
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#dd0044"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "%",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "50px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                sizepow: "1.5",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "20",
                valuecolor: "black",
                valuescale: 1.5,
                minvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021<br><b>educazione terzo grado</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2011_2021_arrow_user_relative_educazione_secondaria = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P48.1|P89.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .filter("WHERE P1.2 > 500 AND P1.1 > 500")
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd8844",
                    "#dd8844"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "%",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "50px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                sizepow: "1.5",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "200",
                valuecolor: "black",
                valuescale: 1.5,
                minvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021<br><b>educazione secondaria</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };


    __procom_2011_2021_arrow_user_relative_educazione_media = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P49.1|P88.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .filter("WHERE P1.2 > 5000 AND P1.1 > 5000")
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#dd8844"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "%",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "50px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                sizepow: "1.5",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "50",
                valuecolor: "black",
                valuescale: 1.5,
                minvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021<br><b>educazione scuola media</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2011_2021_arrow_user_relative_educazione_elementare = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P50.1|P87.2",
                position: "PROCOM.2",
                tonumber: true
            })
            .filter("WHERE P1.2 > 5000 AND P1.1 > 5000")
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#dd0044"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "%",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "50px",
                    "1:2000000", "25px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                sizepow: "1.5",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "200",
                valuecolor: "black",
                valuescale: 1.5,
                minvaluesize: "20",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021<br><b>educazione scuola elementare</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"
            })
        );
    };

    __procom_2011_2021_arrow_user_A2 = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|SIZE|3D|DIFFERENCE|AGGREGATE|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "A2.1|A2.2",
                position: "PROCOM.1",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "red",
                    "#9A384E"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "PROCOM.1",
                    "1:100000", "25px",
                    "1:2000000", "50px",
                    "1:7000000", "REGIONE.1"
                ],
                xxxgridwidth: "50px",
                chartlower: "1:150000",
                scale: "1",
                sizepow: "2",
                fillopacity: 1,
                fadenegative: 0.3,
                normalsizevalue: "500",
                chartlower: "1:100000",
                valuecolor: "black",
                minvaluesize: "5",
                rangecentervalue: "0",
                showdata: "true",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart_procom_all",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2011_2021_arrow_user_grid = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .filter("WHERE P1.2 > 10 AND P1.1 > 10")
            .type("CHART|SYMBOL|AGGREGATE|SUM|GRIDSIZE|SIMPLELEGEND")
            .binding({
                value: "P1.2",
                position: "PROCOM.1",
                tonumber: true
            })
            .style({
                symbols: "hexagon",
                colorscheme: [
                    "none"
                ],
                units: "",
                valuecolor: "rgba(0,0,0,0.1)",
                linecolor: "#aaaaaa",
                linewidth: "10",
                showdata: true,
                gridwidth: "50px",
                chartlower: "1:500000",
                scale: "1"
            })
            .meta({
                name: "chart_grid_all",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    /**
     ** age specific population change
     **/

    __sez_2011_2021_pop_arrow_eta_meno_5 = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZE|SHADOW|GRADIENT|3D|DIFFERENCE|AGGREGATE|RELOCATE|CLIPTOGEOBOUNDS|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P14.1|P14.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "red",
                    "#46C14C"
                ],
                label: [
                    " decrescità",
                    " crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                sizepow: "1.5",
                fillopacity: 1,
                fadenegative: 0.1,
                valuecolor: "#008800",
                linecolor: "#66D14C",
                linewidth: 0.5,
                normalsizevalue: "100",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della popolazione 2011-2021<br><b>fascia età da 0 a 5 anni</b>",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_eta_5_9 = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|BAR|POINTER|ARROW|SIZE|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P15.1|P15.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                colorscheme: [
                    "#dd0044",
                    "#43C30B"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                fillopacity: 1,
                fadenegative: 0.003,
                linecolor: "white",
                linewidth: 0.8,
                normalsizevalue: "100",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_eta_piu_75 = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|3D|SIZE|SHADOW|GRADIENT|DIFFERENCE|AGGREGATE|RECT|RELOCATE|CLIPTOGEOBOUNDS|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P29.1|P29.2",
                position: "SEZ2011.1",
                label: "SEZ2011.1",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#aa44aa"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                sizepow: "1.5",
                fillopacity: 1,
                fadenegative: 0.003,
                linecolor: "white",
                linewidth: 0.5,
                minvaluesize: 1,
                valuecolor: "black",
                normalsizevalue: "100",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_edu_terzo = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P47.1|P90.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#dd0044"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                fillopacity: 1,
                fadenegative: 0.003,
                valuecolor: "#880022",
                linecolor: "white",
                linewidth: 0.3,
                normalsizevalue: "500",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_edu_secondaria = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P48.1|P89.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd8844",
                    "#dd8844"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                fillopacity: 1,
                fadenegative: 0.003,
                linecolor: "white",
                linewidth: 0.2,
                normalsizevalue: "500",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_edu_media = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P49.1|P88.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#54DCDA"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                fillopacity: 1,
                fadenegative: 0.003,
                linecolor: "white",
                linewidth: 0.2,
                normalsizevalue: "500",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_edu_elementare = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P50.1|P87.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "#dd0044",
                    "#54A952"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                fillopacity: 1,
                fadenegative: 0.003,
                linecolor: "white",
                linewidth: 0.2,
                normalsizevalue: "500",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_edu_senzaxxx = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|BAR|POINTER|ARROW|SIZE|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P51.1|P91.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                colorscheme: [
                    "#dd0044",
                    "#54A952"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                fillopacity: 1,
                fadenegative: 0.003,
                linecolor: "white",
                linewidth: 1,
                normalsizevalue: "100",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_edu_senza = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|SYMBOL|SIZE|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P50.1|P87.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                colorscheme: [
                    "#dd0044",
                    "#54A952"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                symbols: [
                    "../../../../pages/DataVizi/Censimenti/up-arrow.svg"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                fillopacity: 1,
                fadenegative: 0.003,
                linecolor: "white",
                linewidth: 1,
                normalsizevalue: "100",
                rangecentervalue: "0",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2011_2021_pop_arrow_stranieri = () => {
        return ixmaps.layer("sezioni_censimento_11|sezioni_censimento_21", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND|NOOUTLIER")
            .binding({
                value: "ST1.1|ST1.2",
                position: "SEZ2011.1",
                tonumber: true
            })
            .style({
                userdraw: "arrowChart",
                colorscheme: [
                    "red",
                    "#4488dd"
                ],
                label: [
                    "decrescità",
                    "crescità"
                ],
                units: "",
                showdata: true,
                aggregationscale: [
                    "1:1", "1",
                    "1:10000", "50px"
                ],
                chartupper: "1:150000",
                scale: "1",
                fillopacity: 1,
                fadenegative: 0.3,
                valuecolor: "#880022",
                linecolor: "white",
                linewidth: 0.3,
                normalsizevalue: "200",
                rangecentervalue: "0",
                minvaluesize: "1",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                name: "chart",
                title: "Variazione della  popolazione straniera 2011-2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };


})();

// -----------------------------
// EOF
// -----------------------------
