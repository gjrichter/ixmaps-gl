/*********************************************************************
layer.js

$Comment: provides JavaScript layer definitions for ixmaps
$Source : layer.js,v $

$InitialAuthor: guenter richter $
$InitialDate: $
$Author: guenter richter $
$Id: layer.js 8 2025-01-11 08:14:02Z Guenter Richter $

Copyright (c) Guenter Richter
$Log: layer.js,v $
**********************************************************************/


(function () {

    var regione = "R" + String(ixmaps.regione);
    var filter = "WHERE PROCOM like \"" + ixmaps.procom + "\" ";
    var filter_compare = "WHERE PROCOM.2 like \"" + ixmaps.procom + "\" AND P1.2 > 10 AND P1.1 > 10";

     query_data_procom_all = function (theme, options) {
        
        var broker = new Data.Broker()

            .addSource("https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2011/all_indicatori_2011_procom.csv.gz", "csv")
            .addSource("https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/all_indicatori_2021_procom.csv.gz", "csv")
            .addSource("https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Variazioni_amministrative_territoriali_dal_01011991.csv", "csv")

            .realize(
                function (dataA) {

                    var data_2011 = dataA[0];
                    var data_2021 = dataA[1];

                    //data_2011 = data_2011.select("WHERE SEZ2011 NOT 8888888");
                    //data_2021 = data_2021.select("WHERE SEZ21_ID NOT 8888888");
                    
                    var variazioni = dataA[2];
                    
                    var varianno = variazioni.select("WHERE Anno > 2011 AND \"Tipo variazione\" = AP");
                    varianno.column("Codice Istat del Comune").map(function(value){
                        return String(Number(value));    
                    });
                    varianno.column("Codice Istat del Comune associato alla variazione o nuovo codice Istat del Comune").map(function(value){
                        return String(Number(value));    
                    });
                    
                    var newPROCOM = varianno.lookupStringArray({key:"Codice Istat del Comune",value:"Codice Istat del Comune associato alla variazione o nuovo codice Istat del Comune"});
                    
                    data_2011.column("PROCOM").map(function(value){
                        while (newPROCOM[value]){
                            console.log(value+' ---> '+newPROCOM[value]);
                            value = newPROCOM[value];
                        }
                        return value;
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

    process_data = function (data) {
        return data.select("WHERE SEZ21_ID NOT 88888");
    }

    // ------------------------------------------------------------------------
    // data position layer (poligoni delle sezioni)  
    // ------------------------------------------------------------------------

    __georef_sez2021 = () => {
        let regione = "R" + String(ixmaps.regione);
        return ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-central-1.amazonaws.com/maps.ixmaps.com/Istat/basi_territoriali_2021/" + regione + "_21_P.topojson.gz",
                type: "topojson"
            })
            .type("FEATURE|CLIPTOVIEW|LOCKED")
            .binding({
                id: "SEZ21_ID",
                size: "SHAPE_Area"
            })
            .filter("WHERE PRO_COM like \"" + String(ixmaps.procom) + "\" ")
            .style({
                colorscheme: ["none"],
                opacity: "1",
                linecolor: "none",
                linewidth: "0.1",
                featureupper: "1:150000",
                name: "sezioni"
            })
        );
    };

    __georef_sez2011 = () => {
        let regione = "R" + String(ixmaps.regione);
        return ixmaps.layer("sezioni_2011", layer => layer
            .data({
                url: "https://s3.eu-central-1.amazonaws.com/maps.ixmaps.com/Istat/basi_territoriali_2011/" + regione + "_11_P.topojson.gz",
                type: "topojson"
            })
            .type("FEATURE")
            .binding({
                id: "SEZ2011",
                size: "Shape_Area"
            })
            .filter("WHERE PRO_COM like \"" + String(ixmaps.procom) + "\" ")
            .style({
                colorscheme: ["none"],
                opacity: "1",
                linecolor: "none",
                linewidth: "0.3",
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
                id: "PRO_COM_T",
                position: "geometry"
            })
            .type("FEATURES|NOLEGEND")
            .style({
                colorscheme: ["none"],
                linecolor: "none",
                linewidth: "0.3",
                sizefield: "Shape_Area"
            })
        );
    };

    __sez2021_pop_choropleth = () => {
        let regione = "R" + String(ixmaps.regione);
        return ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: regione+"_DatiCPA_2021"
            })
            //.filter("WHERE SEZ21_ID NOT 8888888")
            .type("CHOROPLETH|RANGES|DENSITY|ZEROISVALUE|DOPACITY")
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
                ranges: "0,2000,10000,20000,30000,40000,50000,100000,1000000",
                units: "",
                alphafield100: "$density$",
                dopacitypow: "2",
                dopacityscale: "1",
                fillopacity: 1,
                showdata: true,
                nodatacolor: "RGB(255,253,216)",
                chartupper: "1:150000",
                name: "choropleth"
            })
            .meta({
                name: "choropleth",
                title: "Densità popolazione",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}{{theme.item.data}}"

            })
        );
    };

    __sez2021_pop_choropleth_log = () => {
        let regione = "R" + String(ixmaps.regione);
        return ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: "R11_DatiCPA_2021"
            })
            .type("CHOROPLETH|HEADTAIL|DENSITY|ZEROISVALUE|DOPACITYLOG|FORCE|TEXTLEGEND|ZOOMTO")
            .binding({
                value: "P1",
                alpha: "P1",
                position: "SEZ21_ID",
                tonumber: true
            })
            //.filter(filter)
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
                dopacityscale: "10",
                showdata: true,
                nodatacolor: "RGB(255,253,216)",
                name: "choropleth"
            })
            .meta({
                title: "Densità popolazione",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };
        
    __pop_procom = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHART|USER|SIZE|3D|SHADOW|AGGREGATE|RELOCATE|SUM|3D|HEADTAIL|VALUES|")
            .binding({
                value: "P1.2",
                position: "PROCOM.1"
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                colorscheme: [
                        "8",
                        "#F2D286",
                        "#100050",
                        "3colors",
                        "#CC4878"
                    ],
                fillopacity: 1,
                units: "",
                scale: "10",
                minvaluevalue: "200000",
                sizepow: 2,
                gridwidth: "5px",
                showdata: "true",
                alphafield100: "$density$",
                normalsizevalue: "3000000",
                nodatacolor: "RGB(255,253,216)",
                chartlower: "1:150000",
                lookupdigits: "6"
            })
            .meta({
                name: "chart_procom_all",
                title: "Popolazione 2021",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}{{theme.item.data}}"

            })
        );
    };
    
    __pop_procom_5 = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHART|USER|SIZE|3D|SHADOW|AGGREGATE|RELOCATE|SUM|3D|HEADTAIL|VALUES|")
            .binding({
                value: "P14.2",
                value100: "P1.2",
                position: "PROCOM.2"
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                 colorscheme: [
                        "8",
                        "#EEEDDF",
                        "#006A36",
                        "dynamic",
                        "cold"],
                units: "%",
                scale: "10",
                minvaluesize: "20",
                sizepow: 0.5,
                gridwidth: "5px",
                showdata: "true",
                alphafield100: "$density$",
                normalsizevalue: "12",
                nodatacolor: "RGB(255,253,216)",
                chartlower: "1:150000",
                lookupdigits: "6"
            })
            .meta({
                name: "chart_procom_all",
                title: "Percentuale delle fasce età<br> da 0 a 5 anni ",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}{{theme.item.data}}"

            })
        );
    };
    

    __pop_procom_75 = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHART|USER|SIZE|3D|SHADOW|AGGREGATE|RELOCATE|SUM|3D|HEADTAIL|VALUES|")
            .binding({
                value: "P29.2",
                value100: "P1.2",
                position: "PROCOM.2"
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                 colorscheme: [
                        "8",
                        "#FEFDDF",
                        "#8A0856",
                        "dynamic",
                        "warm"],
                units: "%",
                scale: "10",
                minvaluesize: "20",
                sizepow: 0.5,
                gridwidth: "5px",
                showdata: "true",
                alphafield100: "$density$",
                normalsizevalue: "50",
                nodatacolor: "RGB(255,253,216)",
                chartlower: "1:150000",
                lookupdigits: "6"
            })
            .meta({
                name: "chart_procom_all",
                title: "Percentuale delle fasce età<br> più di 75 anni ",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}{{theme.item.data}}"

            })
        );
    };
    
    __pop_procom_stranieri_p = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHART|USER|SIZE|3D|SHADOW|AGGREGATE|RELOCATE|SUM|3D|HEADTAIL|VALUES|")
            .binding({
                value: "ST1.2",
                value100: "P1.2",
                position: "PROCOM.2"
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                 colorscheme: [
                        "8",
                        "#FEFDDF",
                        "#4488dd",
                        "dynamic",
                        "warm"],
                units: "%",
                scale: "10",
                minvaluesize: "20",
                sizepow: 0.8,
                gridwidth: "5px",
                showdata: "true",
                alphafield100: "$density$",
                normalsizevalue: "50",
                nodatacolor: "RGB(255,253,216)",
                chartlower: "1:150000",
                lookupdigits: "6"
            })
            .meta({
                name: "chart_procom_all",
                title: "Percentuale di stranieri o aploidi ",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}{{theme.item.data}}"

            })
        );
    };
    
    __pop_procom_stranieri = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHART|USER|SIZE|3D|SHADOW|AGGREGATE|RELOCATE|SUM|3D|HEADTAIL|VALUES|")
            .binding({
                value: "ST1.2",
                position: "PROCOM.2"
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                 colorscheme: [
                        "8",
                        "#FEFDDF",
                        "#224488",
                        "dynamic",
                        "warm"],
                units: "",
                scale: "10",
                minvaluesize: "20",
                sizepow: 2.2,
                gridwidth: "5px",
                showdata: "true",
                xxalphafield100: "$density$",
                normalsizevalue: "1000000",
                nodatacolor: "RGB(255,253,216)",
                chartlower: "1:150000",
                lookupdigits: "6"
            })
            .meta({
                name: "chart_procom_all",
                title: "Stranieri o aploidi",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}{{theme.item.data}}"

            })
        );
    };
    

    __sez2021_pop_1000_square = () => {
        let regione = "R" + String(ixmaps.regione);
        return ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: regione+"_DatiCPA_2021"
            })
            .type("DOPACITY|VALUEBACKGROUND|NOINLINETEXT|VALUES|CHART|SYMBOLS|LOG|GRIDSIZE|AGGREGATEFAST|RECT|SUM")
            .binding({
                value: "P1",
                position: "SEZ21_ID",
                tonumber: true
            })
            .filter(filter)
            .style({
               colorscheme: [
                        "15",
                        "#F2d226",
                        "#CC4858"
                    ],
				fillopacity: "0.5",
				shadow: "false",
				symbols: [
					"square"],
				units: "",
				scale: "1",
				sizepow: "2",
				dopacitypow: "1.5",
				dopacityscale: "1.5",
				textcolor: "#663333",
				linecolor: [
					"black"],
				linewidth: "0.2",
				valueupper: "1:100000",
				valuescale: "0.8",
				gridwidth: "1000"
            })
            .meta({
				title: "Popolazione 2021",
				snippet: "n° abitanti aggregati",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez2021_pop_500_square = () => {
        let regione = "R" + String(ixmaps.regione);
        return ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: regione+"_DatiCPA_2021"
            })
            .type("DOPACITY|VALUEBACKGROUND|NOINLINETEXT|VALUES|CHART|SYMBOLS|LOG|GRIDSIZE|AGGREGATEFAST|RECT|SUM")
            .binding({
                value: "P1",
                position: "SEZ21_ID",
                tonumber: true
            })
            .filter(filter)
            .style({
               colorscheme: [
                        "15",
                        "#F2d226",
                        "#CC4858"
                    ],
				fillopacity: "0.5",
				shadow: "false",
				symbols: [
					"square"],
				units: "",
				scale: "1",
				sizepow: "2",
				dopacitypow: "1.5",
				dopacityscale: "1.5",
				textcolor: "#663333",
				linecolor: [
					"black"],
				linewidth: "0.2",
				valueupper: "1:100000",
				valuescale: "0.8",
				gridwidth: "500"
            })
            .meta({
				title: "Popolazione 2021",
				snippet: "n° abitanti aggregati",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez2021_pop_250_square = () => {
        let regione = "R" + String(ixmaps.regione);
        return ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: regione+"_DatiCPA_2021"
            })
            .type("DOPACITY|VALUEBACKGROUND|NOINLINETEXT|VALUES|CHART|SYMBOLS|LOG|GRIDSIZE|AGGREGATEFAST|RECT|SUM")
            .binding({
                value: "P1",
                position: "SEZ21_ID",
                tonumber: true
            })
            .filter(filter)
            .style({
               colorscheme: [
                        "15",
                        "#F2d226",
                        "#CC4858"
                    ],
				fillopacity: "0.5",
				shadow: "false",
				symbols: [
					"square"],
				units: "",
				scale: "1",
				sizepow: "2",
				dopacitypow: "1.5",
				dopacityscale: "1.5",
				textcolor: "#663333",
				linecolor: [
					"black"],
				linewidth: "0.2",
				valueupper: "1:100000",
				valuescale: "0.8",
				gridwidth: "250"
            })
            .meta({
				title: "Popolazione 2021",
				snippet: "n° abitanti aggregati",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez2021_pop_100_circle = () => {
        let regione = "R" + String(ixmaps.regione);
        return ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: regione+"_DatiCPA_2021"
            })
            .type("CHART|SYMBOL|AUTOSIZE|AGGREGATE|SUM|VALUES")
            .binding({
                value: "P1",
                position: "SEZ21_ID",
                tonumber: true
            })
            .filter(filter)
            .style({
				colorscheme: [
					"#952D44"],
				fillopacity: "0.8",
				shadow: "false",
				symbols: [
					"circle"],
                linecolor: "blaxk",
				units: "",
				align: "center",
				scale: "1.5",
				valuescale: "1",
				gridwidth: "100",
                valueupper: "1:30000",
                aggregationlower: "1:10000"
            })
            .meta({
				title: "Popolazione 2021",
				snippet: "n° abitanti aggregati",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };

    __sez2021_pop_peaks = () => {
        let regione = "R" + String(ixmaps.regione);
        return ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: regione+"_DatiCPA_2021"
            })
            .type("CHART|USER|SIZE|3D|SHADOW|DENSITY|3D|HEADTAIL|VALUES|")
            .binding({
                value: "P1",
                position: "SEZ21_ID",
                tonumber: true
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                colorscheme: [
                        "8",
                        "#F2d226",
                        "#100050",
                        "3colors",
                        "#CC4878"
                    ],
                units: "",
                scale: "0.5",
                rangescale: "0.5",
                minvaluesize: "20",
                sizepow: 1,
                alphafield100: "$density$",
                nodatacolor: "RGB(255,253,216)",
                chartupper: "1:150000"
            })
            .meta({
                name: "chart",
                title: "Densità popolazione",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );
    };


        __sez2021_edu_choropleth =
            ixmaps.layer("sezioni_2021", layer => layer
                .data({
                    url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                    type: "csv",
                    process: process_data.toString(),
                    name: "R11_DatiCPA_2021"
                })
                .type("CHOROPLETHE|DOMINANT|DOPACITY|HORZ|SIMPLELEGEND")
                .binding({
                    value: "P90|P89|P88|P87|P86",
                    value100: "P83",
                    alpha: "P1",
                    position: "SEZ21_ID",
                    tonumber: true
                })
                .filter(filter)
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
                        "titolo di studio"
                    ],
                    units: "%",
                    alphafield100: "$density$",
                    dopacitypow: 2,
                    dopacityscale: 1
                })
                .meta({
                    name: "choropleth",
                    title: "Grado istruzione predominante",
                    tooltip: "<h2 style='margin-top:0'>{{theme.title}}</h2>{{theme.item.chart}}"
                
                })
            );

    __sez2021_edu_aggregate_peaks =
        ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: "R11_DatiCPA_2021"
            })
            .type("CHART|USER|DOMINANT|PERCENTOFMEAN|SIGN|SIZE|3D|AGGREGATE|RELOCATE|SUM|3D|HEADTAIL|VALUES|")
            .binding({
                value: "P90|P89|P88|P87|P86",
                 position: "SEZ21_ID",
                tonumber: true
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                colorscheme: [
                    "red",
                    "orange",
                    "cyan",
                    "green",
                    "yellow"
                ],
                label: [
                    "con titoli terziari",
                    "con Diploma di scuola superiore",
                    "con licenza media",
                    "con licenza elementare",
                    "senza titolo di studio"
                ],
                units: "",
                scale: "0.8",
                rangescale: "0.5",
                minvaluesize: "14",
                sizepow: 1,
                gridwidth: "5px",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                title: "Densità popolazione",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );

    __sez2021_edu_aggregate_symbols =
        ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: "R11_DatiCPA_2021"
            })
            .type("CHART|SYMBOLS|DOMINANT|PERCENTOFMEAN|SIGN|SIZE|3D|SHADOW|AGGREGATE|RELOCATE|SUM|3D|HEADTAIL|VALUES|")
            .binding({
                value: "P90|P89|P88|P87|P86",
                value100: "P83",
                size: "P83",
                position: "SEZ21_ID",
                tonumber: true
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                colorscheme: [
                    "red",
                    "orange",
                    "cyan",
                    "green",
                    "yellow"
                ],
                label: [
                    "con titoli terziari",
                    "con Diploma di scuola superiore",
                    "con licenza media",
                    "con licenza elementare",
                    "senza titolo di studio"
                ],
                units: "%",
                scale: "1",
                rangescale: "0.5",
                minvaluesize: "14",
                sizepow: 1,
                gridwidth: "5px",
                alphafield100: "$density$",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                title: "Densità popolazione",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );

    __sez2021_edu_aggregate_symbols_compose =
        ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: "R11_DatiCPA_2021"
            })
            .type("CHART|SYMBOLS|GLOW|COMPOSECOLOR|SIGN|SIZE|3D|SHADOW|AGGREGATE|RELOCATE|SUM|3D|HEADTAIL|")
            .binding({
                value: "P90|P89|P88|P87|P86",
                value100: "P83",
                size: "P83",
                position: "SEZ21_ID",
                tonumber: true
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                colorscheme: [
                    "red",
                    "orange",
                    "cyan",
                    "green",
                    "yellow"
                ],
                label: [
                    "con titoli terziari",
                    "con Diploma di scuola superiore",
                    "con licenza media",
                    "con licenza elementare",
                    "senza titolo di studio"
                ],
                units: "%",
                scale: "0.15",
                rangescale: "0.5",
                minvaluesize: "14",
                sizepow: 1,
                clipparts: 1,
                gridwidth: "5px",
                fillopacity: 0.00001,
                linecolor: "none",
                alphafield100: "$density$",
                nodatacolor: "RGB(255,253,216)"
            })
            .meta({
                title: "Densità popolazione",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"

            })
        );

    __sez2021_edu_aggregate_pies =
        ixmaps.layer("sezioni_2021", layer => layer
            .data({
                url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                type: "csv",
                process: process_data.toString(),
                name: "R11_DatiCPA_2021"
            })
            .type("CHART|SYMBOL|SEQUENCE|STAR!SORT|DOWN|SIZE|SHADOW|AGGREGATE|RELOCATE|SUM|VALUES|CIRCULARBOX|BOTTOMTITLE")
            .binding({
                value: "P90|P89|P88|P87|P86",
                size: "P83",
                position: "SEZ21_ID",
                title: "SEZ21_ID",
                tonumber: true
            })
            .filter(filter)
            .style({
                userdraw: "pinnacleChart",
                colorscheme: [
                    "red",
                    "orange",
                    "#00cccc",
                    "green",
                    "yellow"
                ],
                fillopacity: 0.9,
                linewidth: 1,
                linecolor: "white",
                label: [
                    "con titoli terziari",
                    "con Diploma di scuola superiore",
                    "con licenza media",
                    "con licenza elementare",
                    "senza titolo di studio"
                ],
                units: "",
                scale: "1.5",
                rangescale: "1",
                normalsizevalue: "2000",
                minvaluesize: "14",
                sizepow: 2.2,
                gridwidth: "5px",
                nodatacolor: "RGB(255,253,216)",
                boxupper: "1:5000",
                boxcolor: "none",
                textscale: 0.3,
                textcolor: "black",
                valuecolor: "white"
            })
            .meta({
                title: "Popolazione > 9 anni",
                tooltip: "<big><b>{{theme.item.value}}</b></big> persone con più di 9 anni<br>suddivisi in titolo di studio:{{theme.item.chart}}<small><em>{{COMUNE}} - Sezione: {{raw.SEZ21_ID}}</em></small>"

            })
        );
    
        __sez2021_eta_choropleth =
            ixmaps.layer("sezioni_2021", layer => layer
                .data({
                    url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/" + regione + "_indicatori_2021_sezioni.csv.gz",
                    type: "csv",
                    process: process_data.toString(),
                    name: "R11_DatiCPA_2021"
                })
                .type("CHOROPLETHE|DOMINANT|DEVIATION|DOPACITY|HORZ|SIMPLELEGEND")
                .binding({
                    value: "P14|P15|P16|P17|P18|P19|P20|P21|P22|P23|P24|P25|P26|P27|P20|P29",
                    value100: "P83",
                    alpha: "P1",
                    position: "SEZ21_ID",
                    tonumber: true
                })
                .filter(filter)
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
                    dopacitypow: 1,
                    dopacityscale: 2
                })
                .meta({
                    name: "choropleth",
                    title: "Grado istruzione predominante",
                    tooltip: "<h2 style='margin-top:0'>{{theme.title}}</h2>{{theme.item.chart}}"
                
                })
            );

        __sez2011_stranieri_choropleth =
            ixmaps.layer("sezioni_2011", layer => layer
                .data({
                    url: "https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2011/" + regione + "_indicatori_2011_sezioni.csv.gz",
                    type: "csv",
                    process: process_data.toString(),
                    name: "R11_DatiCPA_2011"
                })
                .type("CHOROPLETHE|DOMINANT|DOPACITY|HORZ|SIMPLELEGEND")
                .binding({
                    value: "ST9|ST10|ST11|ST12|ST13",
                    alpha: "ST15",
                    position: "SEZ2011",
                    tonumber: true
                })
                .filter(filter)
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

    
    

})();

// -----------------------------
// EOF
// -----------------------------
