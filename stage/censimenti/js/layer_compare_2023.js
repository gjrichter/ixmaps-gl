/*********************************************************************
layer_compare_2023.js

$Comment: provides JavaScript layer definitions for ixmaps
          (census comparison 2021 - 2023; derived from layer_compare.js)
$Source : layer_compare_2023.js,v $

$InitialAuthor: guenter richter $
$InitialDate: 2026/09/28 $
$Author: guenter richter $
$Id: layer_compare_2023.js 1 2026-09-28 00:00:00Z Guenter Richter $

Copyright (c) Guenter Richter
$Log: layer_compare_2023.js,v $
**********************************************************************/


(function () {

    // ------------------------------------------------------------------------
    // 2021 vs 2023 - what differs from the 2011 vs 2021 comparison
    // (layer_compare.js):
    //
    // - both releases use the same census-section grid (SEZ21_ID) and the
    //   same variable codes (P1..., ST..., PF..., A...), so no 2011->2021
    //   field translation is needed: every theme compares FIELD.1 with
    //   FIELD.2 of the same code
    // - section IDs are stable across comune mergers: ISTAT keeps the 2021
    //   SEZ21_ID (with its old comune prefix) for sections of merged comuni,
    //   so the section-level merge needs NO code remapping at all
    // - at comune level only a handful of codes changed; they are mapped
    //   below onto the comune geometry used for positioning (ISTAT
    //   01/01/2024), which already includes one merger newer than the 2023
    //   data (Uggiate con Ronago, 01/01/2024) - so 2023 codes are remapped
    //   too, not just the 2021 ones
    //
    // Attached to ixmaps (a true global), not an IIFE closure var:
    // query_data() and query_data_procom_all() below are toString()'d and
    // eval'd elsewhere (as ixmaps.pop_diff / ixmaps.all_data_condensed) in a
    // scope that can't see closure variables from this file.
    // ------------------------------------------------------------------------

    ixmaps.__PROCOM_TO_2024 = {
        "5079": "5122",     // Moransengo           -> Moransengo-Tonengo (2023)
        "5110": "5122",     // Tonengo              -> Moransengo-Tonengo (2023)
        "12009": "12144",   // Bardello             -> Bardello con Malgesso e Bregano (2023)
        "12018": "12144",   // Bregano              -> Bardello con Malgesso e Bregano (2023)
        "12095": "12144",   // Malgesso             -> Bardello con Malgesso e Bregano (2023)
        "18002": "18026",   // Albaredo Arnaboldi   -> Campospinoso Albaredo (2023)
        "13199": "13256",   // Ronago               -> Uggiate con Ronago (2024)
        "13228": "13256"    // Uggiate-Trevano      -> Uggiate con Ronago (2024)
    };

    // ------------------------------------------------------------------------
    // data query and processing
    // ------------------------------------------------------------------------

    query_data = function (theme, options) {

        // this whole merge runs synchronously; any exception in here would
        // otherwise propagate up into htmlgui.js's ext-query dispatch and
        // surface as the misleading "external data function: 'pop_diff'
        // not defined!" alert - log the real cause instead and bail out,
        // the next refreshTheme() retries
        try {

            // unlike layer_compare.js (which first awaits the async SITUAS
            // fetch) this runs synchronously on first build, before the
            // section flatgeobufs ever produced a named dataset - so the
            // names may not exist yet: bail out quietly, refreshTheme() retries
            if (typeof dataquery_flatgeobuffer === "undefined" || typeof dataquery_flatgeobuffer_2 === "undefined") {
                return;
            }

            var data_2021 = dataquery_flatgeobuffer;
            var data_2023 = dataquery_flatgeobuffer_2;

            // sezioni_censimento_21/_23 (flatgeobuf) reload asynchronously on
            // pan/zoom/resize, independently of this theme; if this fires
            // before that reload produced data, bail out - the next
            // refreshTheme() retries with fresh data
            if (ixmaps.in_query_1 || ixmaps.in_query_2 || !data_2021 || !data_2023) {
                return;
            }

            data_2021 = data_2021.select("WHERE SEZ21_ID NOT 888888");
            data_2023 = data_2023.select("WHERE SEZ21_ID NOT 888888");

            // sections present in only one release (populated in one year,
            // empty in the other) get an empty row on the other side, so the
            // difference shows the full gain / loss
            var lookup1 = data_2021.lookupStringArray({ key: "SEZ21_ID", value: "P1" });
            var lookup2 = data_2023.lookupStringArray({ key: "SEZ21_ID", value: "P1" });
            for (var i in lookup1) {
                if (!lookup2[i]) {
                    data_2023.addRow({ "SEZ21_ID": i });
                }
            }
            for (var i in lookup2) {
                if (!lookup1[i]) {
                    data_2021.addRow({ "SEZ21_ID": i });
                }
            }

            var merger = new Data.Merger()
                .addSource(data_2021, {
                    lookup: "SEZ21_ID"
                })
                .addSource(data_2023, {
                    lookup: "SEZ21_ID"
                })
                .realize(
                    function (mergedTable) {
                        ixmaps.setExternalData(mergedTable, {
                            type: "dbtable",
                            name: options.name
                        });
                    });

        } catch (e) {
            console.error("query_data/pop_diff merge failed:", e);
        }
    };

    query_data_procom_all = function (theme, options) {

        var broker = new Data.Broker()

            .addSource("https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/all_indicatori_2021_procom.csv.gz", "csv")
            .addSource("https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2023/all_indicatori_2023_procom.csv.gz", "csv")

            .realize(
                function (dataA) {

                    var data_2021 = dataA[0];
                    var data_2023 = dataA[1];
                    var newPROCOM = ixmaps.__PROCOM_TO_2024;

                    // both sides onto the 01/01/2024 comune codes, then sum
                    // the merged comuni (condense)
                    data_2021.column("PROCOM").map(function (value) {
                        return newPROCOM[value] || value;
                    });
                    data_2023.column("PROCOM").map(function (value) {
                        return newPROCOM[value] || value;
                    });

                    data_2021 = data_2021.condense({ lead: "PROCOM", keep: ["PROCOM", "CODREG", "CODPRO", "CODCOM"] });
                    data_2023 = data_2023.condense({ lead: "PROCOM", keep: ["PROCOM", "CODREG", "CODPRO", "CODCOM"] });

                    var merger = new Data.Merger()
                        .addSource(data_2021, {
                            lookup: "PROCOM"
                        })
                        .addSource(data_2023, {
                            lookup: "PROCOM"
                        })
                        .realize(
                            function (mergedTable) {

                                // foreign residents of 2021 projected onto the
                                // 2023 population (kept for parity with
                                // layer_compare.js)
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
                });
    };

    process_data = function (data) {
        return data.select("WHERE SEZ21_ID NOT 88888");
    }

    // ------------------------------------------------------------------------
    // data position layer (poligoni delle sezioni)
    // - both files carry the same 2021 section polygons; slot 1 (in_query_1)
    //   holds the 2021 values, slot 2 (in_query_2) the 2023 values
    // ------------------------------------------------------------------------


    __georef_sez2021_fgb = () => {
        return ixmaps.layer("sezioni_censimento_21", layer => layer
            .data({
                type: "ext",
                name: "dataquery_flatgeobuffer",
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
    __georef_sez2023_fgb = () => {
        return ixmaps.layer("sezioni_censimento_23", layer => layer
            .data({
                type: "ext",
                name: "dataquery_flatgeobuffer_2",
                ext: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/TestData/istat_basi_territoriali_2021_indicatore_2023_joined.fgb"
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
                name: "sezioni_2023",
                featureupper: "1:150000"
            })
        );
    };


    /* 1. centroids of 2011, by curtesy of Andrea Borruso */
    __georef_urban = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
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

    /* 2. istat comuni 01/01/2024 (onData confini amministrativi), for changes since 2011 */
    __georef = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
            .data({
                url: "https://s3.eu-central-1.amazonaws.com/maps.ixmaps.com/Istat/comuni_2024/ondata_confini_amministrativi_api_v2_it_20240101_comuni.s.topo.json.gz",
                type: "topojson"
            })
            .binding({
                id: "pro_com",
                position: "geometry"
            })
            .type("FEATURES|NOLEGEND")
            .style({
                colorscheme: ["none"],
                linecolor: "gray",
                linewidth: "0.01",
                sizefield: "shape_area",
                featurelower: "1:150000"
            })
        );
    };


    // ------------------------------------------------------------------------
    // data visualizzation layer 
    // - using above defined data query function and position layer
    // ------------------------------------------------------------------------

    __pop_procom_circle = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
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
                title: "Popolazione 2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    /**
     ** general population change
     **/

    __sez2023_pop_choropleth = () => {
        return ixmaps.layer("sezioni_censimento_23", layer => layer
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
                linewidth: "0.6",  
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
                title: "Densità di popolazione 2023",
                description: "<b>poligoni</b> delle sezioni di censimento",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez2023_eta_choropleth = () => {
        return ixmaps.layer("sezioni_censimento_23", layer => layer
            .data({
                name: "dataquery_flatgeobuffer_2"
            })
            .filter("WHERE SEZ21_ID NOT 8888888")
            .type("CHOROPLETHE|DOMINANT|DEVIATION|DOPACITY|HORZ|SIMPLELEGEND")
            .binding({
                value: "P14|P15|P16|P17|P18|P19|P20|P21|P22|P23|P24|P25|P26|P27|P28|P29",
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
                linewidth: "0.5",  
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

    __sez2023_edu_choropleth = () => {
        return ixmaps.layer("sezioni_censimento_23", layer => layer
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
                linewidth: "0.2",  
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


    __sez2023_stranieri_choropleth = () => {
        return ixmaps.layer("sezioni_censimento_23", layer => layer
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
                linewidth: "0.2",  
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

    __sez_2021_2023_pop_arrow_user = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZE|3D|DIFFERENCE|AGGREGATE|RELOCATE|SUM|VALUES|SIMPLELEGEND|NOOUTLIER")
            .binding({
                value: "P1.1|P1.2",
                position: "SEZ21_ID.1",
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
                title: "Variazione della  popolazione 2021-2023",
                description: "livello: sezioni di censimento, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2021_2023_pop_arrow_user_relative = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P1.1|P1.2",
                position: "SEZ21_ID.1",
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
                title: "Variazione della  popolazione 2021-2023",
                description: "livello: <b>sezioni di censimento</b>, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2021_2023_arrow_user = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2021_2023_arrow_user_stranieri = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2021_2023_arrow_user_educazione_terzo = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|SIZE|3D|DIFFERENCE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P90.1|P90.2",
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
                title: "Variazione della  popolazione 2021-2023<br><b>educazione terzo grado </b>",
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

    __procom_2021_2023_arrow_user_relative = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
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
                title: "Variazione della  popolazione 2021-2023",
                description: "a livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2021_2023_arrow_user_relative_meno_5 = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
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
                title: "Variazione della  popolazione 2021-2023<br><b>fascia età da 0 a 5 anni</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2021_2023_arrow_user_relative_piu_75 = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P29.1|P29.2",
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
                title: "Variazione della  popolazione 2021-2023<br><b>fascia età 75+ anni</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    // here we compare two %, one from 2021 and 2023 showing the difference
    // to be able to create the % of 2021 with the total population of 2023 (due to aggregation we must calculate the % for every zoom)
    // we created in the data query function the number of strangers from 2021 projected to the popolation of 2023 (ST1.12)
    // than we can calcolate the difference of the % like below (value = ST1.12|ST1.2, value100 = P1.2 and type DIFFERENCE)

    __procom_2021_2023_arrow_user_relative_stranieri = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
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
                title: "Variazione della  popolazione 2021-2023<br><b>stranieri o aploidi</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };


    __procom_2021_2023_arrow_user_relative_educazione_terzo = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P90.1|P90.2",
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
                title: "Variazione della  popolazione 2021-2023<br><b>educazione terzo grado</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2021_2023_arrow_user_relative_educazione_secondaria = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P89.1|P89.2",
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
                title: "Variazione della  popolazione 2021-2023<br><b>educazione secondaria</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };


    __procom_2021_2023_arrow_user_relative_educazione_media = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P88.1|P88.2",
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
                title: "Variazione della  popolazione 2021-2023<br><b>educazione scuola media</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2021_2023_arrow_user_relative_educazione_elementare = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed"
            })
            .type("CHART|USER|AUTOSIZE|3D|DIFFERENCE|RELATIVE|AGGREGATE|RECT|RELOCATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P87.1|P87.2",
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
                title: "Variazione della  popolazione 2021-2023<br><b>educazione scuola elementare</b>",
                description: "livello comunale, aggregato dinamicamente",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"
            })
        );
    };

    __procom_2021_2023_arrow_user_A2 = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __procom_2021_2023_arrow_user_grid = () => {
        return ixmaps.layer("ITALIA_Comuni_2024", layer => layer
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    /**
     ** age specific population change
     **/

    __sez_2021_2023_pop_arrow_eta_meno_5 = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZE|SHADOW|GRADIENT|3D|DIFFERENCE|AGGREGATE|RELOCATE|CLIPTOGEOBOUNDS|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P14.1|P14.2",
                position: "SEZ21_ID.1",
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
                title: "Variazione della popolazione 2021-2023<br><b>fascia età da 0 a 5 anni</b>",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2021_2023_pop_arrow_eta_5_9 = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|BAR|POINTER|ARROW|SIZE|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P15.1|P15.2",
                position: "SEZ21_ID.1",
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2021_2023_pop_arrow_eta_piu_75 = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|3D|SIZE|SHADOW|GRADIENT|DIFFERENCE|AGGREGATE|RECT|RELOCATE|CLIPTOGEOBOUNDS|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P29.1|P29.2",
                position: "SEZ21_ID.1",
                label: "SEZ21_ID.1",
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2021_2023_pop_arrow_edu_terzo = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P90.1|P90.2",
                position: "SEZ21_ID.1",
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2021_2023_pop_arrow_edu_secondaria = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P89.1|P89.2",
                position: "SEZ21_ID.1",
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2021_2023_pop_arrow_edu_media = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P88.1|P88.2",
                position: "SEZ21_ID.1",
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2021_2023_pop_arrow_edu_elementare = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND")
            .binding({
                value: "P87.1|P87.2",
                position: "SEZ21_ID.1",
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
                title: "Variazione della  popolazione 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez_2021_2023_pop_arrow_stranieri = () => {
        return ixmaps.layer("sezioni_censimento_21|sezioni_censimento_23", layer => layer
            .data({
                query: query_data.toString(),
                type: "ext",
                name: "pop_diff"
            })
            .type("CHART|USER|SIZEP1|SHADOW|3D|GRADIENT|DIFFERENCE|AGGREGATE|SUM|VALUES|SIMPLELEGEND|NOOUTLIER")
            .binding({
                value: "ST1.1|ST1.2",
                position: "SEZ21_ID.1",
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
                title: "Variazione della  popolazione straniera 2021-2023",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };


})();

// -----------------------------
// EOF
// -----------------------------
