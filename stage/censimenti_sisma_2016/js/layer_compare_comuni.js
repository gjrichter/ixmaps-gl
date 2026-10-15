/*********************************************************************
layer_compare_comuni.js

$Comment: comune-level background choropleths for the 2011-2021 compare page
          (the same themes as layer_compare_2023.js, 2021 values = suffix .2 of the
          condensed comune table). They sit on the "ITALIA_Comuni_2022" layer, whose
          polygon base (__georef) gives the geometry, joined like the comune
          bubbles by PROCOM.1 (lookupdigits 6). meta.name "choropleth_comuni" lets
          comune and section backgrounds be on the map at the same time.
          Needs layer_compare.js (query_data_procom_all).
**********************************************************************/

(function () {

    __comuni2021_pop_choropleth = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHOROPLETH|HEADTAIL|DENSITY|ZEROISVALUE|DOPACITY")
            .binding({
                value: "P1.2",
                alpha: "P1.2",
                position: "PROCOM.1",
                lookupdigits: "6",
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
                linecolor: "none",
                linewidth: "0.6",
                units: "",
                alphafield100: "$density$",
                dopacitypow: "4",
                dopacityscale: "1",
                fillopacity: 1,
                showdata: true,
                nodatacolor: "RGB(255,253,216)",
                chartlower: "1:150000"
            })
            .meta({
                name: "choropleth_comuni",
                title: "Densità di popolazione 2021 (comuni)",
                description: "<b>poligoni</b> dei comuni",
                tooltip: "{{theme.title}}: {{theme.item.value}}{{theme.item.chart}}"
            })
        );
    };

    __comuni2021_eta_choropleth = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHOROPLETHE|DOMINANT|DEVIATION|DOPACITY|HORZ|SIMPLELEGEND")
            .binding({
                value: "P14.2|P15.2|P16.2|P17.2|P18.2|P19.2|P20.2|P21.2|P22.2|P23.2|P24.2|P25.2|P26.2|P27.2|P28.2|P29.2",
                value100: "P83.2",
                alpha: "P83.2",
                position: "PROCOM.1",
                lookupdigits: "6",
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
                label: ["meno di 5","5 - 9","10 - 14","15 - 19","20 - 24","25 - 29","30 - 34","35 - 39","40 - 44","45 - 49","50 - 54","55 - 59","60 - 64","65 - 69","70 - 74","> 74"],
                linecolor: "none",
                linewidth: "0.5",
                units: "%",
                alphafield100: "$density$",
                dopacitypow: "4",
                dopacityscale: "1",
                chartlower: "1:150000"
            })
            .meta({
                name: "choropleth_comuni",
                title: "Classe d'età sopra alla media (comuni)",
                tooltip: "<h2 style='margin-top:0'>{{theme.title}}</h2>{{theme.item.chart}}"
            })
        );
    };

    __comuni2021_edu_choropleth = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHOROPLETHE|DOMINANT|DOPACITY|HORZ|SIMPLELEGEND")
            .binding({
                value: "P90.2|P89.2|P88.2|P87.2|P86.2",
                value100: "P83.2",
                alpha: "P83.2",
                position: "PROCOM.1",
                lookupdigits: "6",
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
                linecolor: "none",
                linewidth: "0.2",
                units: "%",
                alphafield100: "$density$",
                dopacitypow: "4",
                dopacityscale: "1",
                chartlower: "1:150000"
            })
            .meta({
                name: "choropleth_comuni",
                title: "Grado istruzione predominante (comuni)",
                tooltip: "<h2 style='margin-top:0'>{{theme.title}}</h2>{{theme.item.chart}}"
            })
        );
    };

    __comuni2021_stranieri_choropleth = () => {
        return ixmaps.layer("ITALIA_Comuni_2022", layer => layer
            .data({
                query: query_data_procom_all.toString(),
                type: "ext",
                name: "all_data_condensed",
                cache: true
            })
            .type("CHOROPLETHE|DOMINANT|DOPACITY|HORZ|SIMPLELEGEND")
            .binding({
                value: "ST16.2|ST19.2",
                value100: "P1.2",
                alpha: "ST1.2",
                position: "PROCOM.1",
                lookupdigits: "6",
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
                linecolor: "none",
                linewidth: "0.2",
                units: "%",
                alphafield100: "P1.2",
                dopacitypow: "4",
                dopacityscale: "1",
                chartlower: "1:150000"
            })
            .meta({
                name: "choropleth_comuni",
                title: "Provenienza stranieri predominante (comuni)",
                tooltip: "<h2 style='margin-top:0'>{{theme.title}}</h2>{{theme.item.chart}}"
            })
        );
    };

})();
