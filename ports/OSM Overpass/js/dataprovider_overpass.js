/**
 * data provider for OSM Overpass Queries
 */

window.ixmaps = window.ixmaps || {};
(function () {

    ixmaps.oldBounds = null;

    ixmaps.OSM_dataquery_streetmap = function (data, option) {

        ixmaps.setTitleBox("Overpass API &#8644;", "RGBA(95, 185, 135,0.5)");
        ixmaps.in_query = true;

        var bounds = ixmaps.oldBounds = ixmaps.getBoundingBox();
        var szBounds = bounds[0].lng + '/' + bounds[0].lat + '/' + bounds[1].lng + '/' + bounds[1].lat;

        query =
            '[out:json][timeout:250][bbox:' +
            bounds[0].lat + ',' +
            bounds[0].lng + ',' +
            bounds[1].lat + ',' +
            bounds[1].lng + '];' +
            '(' +
            'way["barrier"];' +
            '(way["highway"];);' +
            ');' +
            'out body center qt;' +
            '>;' +
            'out skel qt;';


        var szUrl = "https://overpass.kumi.systems/api/interpreter?data=" + query;
        var myfeed = Data.feed({
                "source": szUrl,
                "type": "json"
            }).load(function (mydata) {

                if (myfeed.data.elements) {

                    geo = osmtogeojson(myfeed.data);

                    var xgeo = {
                        type: "featurecollection",
                        features: []
                    }
                    for (i in geo.features) {
                        if (!geo.features[i].geometry.type.match(/Point/)) {
                            xgeo.features.push(geo.features[i]);
                        }
                    }

                    ixmaps.in_query = false;
                    ixmaps.setTitle("");
                    ixmaps.setExternalData(xgeo, {
                        type: "geojson",
                        name: options.name
                    });

                }

            })
            .error(function (e) {
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
                ixmaps.in_query = false;
            });

    };

    ixmaps.OSM_dataquery_tourism = function (data, option) {

        var bounds = ixmaps.oldBounds = ixmaps.getBoundingBox();
        var szBounds = bounds[0].lng + '/' + bounds[0].lat + '/' + bounds[1].lng + '/' + bounds[1].lat;

        query =
            '[out:json][timeout:100][bbox:' +
            bounds[0].lat + ',' +
            bounds[0].lng + ',' +
            bounds[1].lat + ',' +
            bounds[1].lng + '];' +
            '(' +
            'node["amenity"];' +
            'way["amenity"];' +
            'relation["amenity"];' +
            ');' +
            'out body center qt;' +
            '>;' +
            'out skel qt;';

        var szUrl = "https://overpass.kumi.systems/api/interpreter?data=" + query;
        var myfeed = Data.feed({
                "source": szUrl,
                "type": "json"
            }).load(function (mydata) {

                ixmaps.in_query = false;
                ixmaps.setTitle("");
                if (myfeed.data.elements) {
                    geo = osmtogeojson(myfeed.data);
                    ixmaps.setExternalData(geo, {
                        type: "geojson",
                        name: option.name
                    });
                }

            })
            .error(function (e) {
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
                ixmaps.in_query = false;
            });

    };


    ixmaps.OSM_dataquery_bus_stop = function (data, option) {

        var bounds = ixmaps.oldBounds = ixmaps.getBoundingBox();
        var szBounds = bounds[0].lng + '/' + bounds[0].lat + '/' + bounds[1].lng + '/' + bounds[1].lat;

        query =
            '[out:json][timeout:100][bbox:' +
            bounds[0].lat + ',' +
            bounds[0].lng + ',' +
            bounds[1].lat + ',' +
            bounds[1].lng + '];' +
            '(' +
            ' node["highway"="bus_stop"];' +
            ');' +
            'out body center qt;' +
            '>;' +
            'out skel qt;';

        var szUrl = "https://overpass-api.de/api/interpreter?data=" + query;
        var myfeed = Data.feed({
                "source": szUrl,
                "type": "json"
            }).load(function (mydata) {

                ixmaps.in_query = false;
                ixmaps.setTitle("");

                if (myfeed.data.elements) {
                    geo = osmtogeojson(myfeed.data);
                    geo = Data.import({
                        source: geo,
                        type: "geojson"
                    });
                    if (!geo.column('wheelchair')) {
                        geo.addColumn({
                            destination: "wheelchair"
                        }, function (row) {
                            return "undefined";
                        })
                    }
                    ixmaps.setExternalData(geo, {
                        type: "jsonDB",
                        name: option.name
                    });
                }

            })
            .error(function (e) {
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
                ixmaps.in_query = false;
            });

    };

    ixmaps.OSM_dataquery_bike_rental = function (data, option) {

        var bounds = ixmaps.oldBounds = ixmaps.getBoundingBox();
        var szBounds = bounds[0].lng + '/' + bounds[0].lat + '/' + bounds[1].lng + '/' + bounds[1].lat;

        query =
            '[out:json][timeout:100][bbox:' +
            bounds[0].lat + ',' +
            bounds[0].lng + ',' +
            bounds[1].lat + ',' +
            bounds[1].lng + '];' +
            '(' +
            ' node["amenity"="bicycle_rental"];' +
            ');' +
            'out body center qt;' +
            '>;' +
            'out skel qt;';

        var szUrl = "https://overpass-api.de/api/interpreter?data=" + query;
        var myfeed = Data.feed({
                "source": szUrl,
                "type": "json"
            }).load(function (mydata) {

                ixmaps.in_query = false;
                ixmaps.setTitle("");

                if (myfeed.data.elements && myfeed.data.elements.length) {
                    geo = osmtogeojson(myfeed.data);
                    data = Data.import({
                        source: geo,
                        type: "geojson"
                    });
                    if (!data.column("capacity")) {
                        data.addColumn({
                            destination: "capacity"
                        }, (row) => {
                            return "1";
                        });
                    }
                    ixmaps.setExternalData(data, {
                        type: "jsonDB",
                        name: option.name
                    });
                } else {
                    ixmaps.setTitleBox("no points in map view");
                    ixmaps.setExternalData(null, {
                        type: "geojson",
                        name: option.name
                    });
                }

            })
            .error(function (e) {
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
                ixmaps.in_query = false;
            });

    };

    ixmaps.OSM_dataquery_recycling = function (data, option) {

        var bounds = ixmaps.oldBounds = ixmaps.getBoundingBox();
        var szBounds = bounds[0].lng + '/' + bounds[0].lat + '/' + bounds[1].lng + '/' + bounds[1].lat;

        query =
            '[out:json][timeout:100][bbox:' +
            bounds[0].lat + ',' +
            bounds[0].lng + ',' +
            bounds[1].lat + ',' +
            bounds[1].lng + '];' +
            '(' +
            ' node["amenity"="waste_basket"];' +
            ' node["amenity"="recycling"];' +
            ');' +
            'out body center qt;' +
            '>;' +
            'out skel qt;';

        var szUrl = "https://overpass-api.de/api/interpreter?data=" + query;
        var myfeed = Data.feed({
                "source": szUrl,
                "type": "json"
            }).load(function (mydata) {

                ixmaps.in_query = false;
                ixmaps.setTitle("");

                if (myfeed.data.elements && myfeed.data.elements.length) {
                    geo = osmtogeojson(myfeed.data);
                    ixmaps.setExternalData(geo, {
                        type: "geojson",
                        name: option.name
                    });
                } else {
                    ixmaps.setTitleBox("no points in map view");
                    ixmaps.setExternalData();
                }

            })
            .error(function (e) {
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
                ixmaps.in_query = false;
            });

    };

    ixmaps.OSM_dataquery_echarge = function (data, option) {

        var bounds = ixmaps.oldBounds = ixmaps.getBoundingBox();
        var szBounds = bounds[0].lng + '/' + bounds[0].lat + '/' + bounds[1].lng + '/' + bounds[1].lat;

        query =
            '[out:json][timeout:100][bbox:' +
            bounds[0].lat + ',' +
            bounds[0].lng + ',' +
            bounds[1].lat + ',' +
            bounds[1].lng + '];' +
            '(' +
            ' node["amenity"="charging_station"];' +
            ');' +
            'out body center qt;' +
            '>;' +
            'out skel qt;';

        var szUrl = "https://overpass-api.de/api/interpreter?data=" + query;
        var myfeed = Data.feed({
                "source": szUrl,
                "type": "json"
            }).load(function (mydata) {

                ixmaps.in_query = false;
                ixmaps.setTitle("");

                if (myfeed.data.elements && myfeed.data.elements.length) {
                    geo = osmtogeojson(myfeed.data);
                    ixmaps.setExternalData(geo, {
                        type: "geojson",
                        name: option.name
                    });
                } else {
                    ixmaps.setTitleBox("no points in map view");
                    ixmaps.setExternalData();
                }

            })
            .error(function (e) {
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
                ixmaps.in_query = false;
            });

    };

    ixmaps.OSM_dataquery_trees = function (data, option) {

        var bounds = ixmaps.oldBounds = ixmaps.getBoundingBox();
        var szBounds = bounds[0].lng + '/' + bounds[0].lat + '/' + bounds[1].lng + '/' + bounds[1].lat;
        
        query =
            '[out:json][timeout:100][bbox:' +
            bounds[0].lat + ',' +
            bounds[0].lng + ',' +
            bounds[1].lat + ',' +
            bounds[1].lng + '];' +
            '(' +
            ' node["amenity"="tree"];' +
            ' node["natural"="tree"];' +
            ');' +
            'out body center qt;' +
            '>;' +
            'out skel qt;';

        var szUrl = "https://overpass-api.de/api/interpreter?data=" + query;
        var myfeed = Data.feed({
                "source": szUrl,
                "type": "json"
            }).load(function (mydata) {

                ixmaps.in_query = false;
                ixmaps.setTitle("");
            
                if (myfeed.data.elements && myfeed.data.elements.length) {
                    // from OSD format to geojson
                    geo = osmtogeojson(myfeed.data);
                    // make data table and add "genus" column if not exists
                    table = Data.import({
                        "source": geo,
                        "type": "geojson"
                    });
                    if (!table.column("genus")) {
                        table.addColumn({
                            destination: "genus"
                        }, function (row) {
                            return "";
                        });
                    }
                    if (table.column("circumference")) {
                        table.column("circumference").map(function (value) {
                            return value || 20
                        });
                    }
                    ixmaps.setExternalData(table, {
                        type: "dbtable",
                        name: option.name
                    });
                } else {
                    ixmaps.setTitleBox("no points in map view");
                    ixmaps.setExternalData();
                }

            })
            .error(function (e) {
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
                ixmaps.in_query = false;
            });

    };

    ixmaps.OSM_dataquery_housenumbers = function (data, option) {

        var bounds = ixmaps.oldBounds = ixmaps.getBoundingBox();
        var szBounds = bounds[0].lng + '/' + bounds[0].lat + '/' + bounds[1].lng + '/' + bounds[1].lat;
        
        query =
            '[out:csv(::type,::id,"addr:street","addr:housenumber",::lat,::lon)][timeout:100][bbox:' +
            bounds[0].lat + ',' +
            bounds[0].lng + ',' +
            bounds[1].lat + ',' +
            bounds[1].lng + '];' +
            '(' +
            ' node["addr:housenumber"];' +
            ' way["addr:housenumber"];' +
            ' relation["addr:housenumber"];' +
            ');' +
            'out body center qt;' +
            '>;' +
            'out skel qt;';

        var szUrl = "https://overpass-api.de/api/interpreter?data=" + query;
        var myfeed = Data.feed({
                "source": szUrl,
                "type": "csv"
            }).load(function (mydata) {

                ixmaps.in_query = false;
                ixmaps.setTitle("");
            
                ixmaps.setExternalData(mydata, {
                    type: "dbtable",
                    name: option.name
                });

            })
            .error(function (e) {
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
                ixmaps.in_query = false;
            });

    };

    ixmaps.OSM_dataquery_women = function (data, option) {

        var bounds = ixmaps.oldBounds = ixmaps.getBoundingBox();
        var szBounds = bounds[0].lng + '/' + bounds[0].lat + '/' + bounds[1].lng + '/' + bounds[1].lat;

        query =
        '[out:json][timeout:100][bbox:' +
        bounds[0].lat + ',' +
        bounds[0].lng + ',' +
        bounds[1].lat + ',' +
        bounds[1].lng + '];' +
        '(' +
        // Childcare & Early Education
        ' node["amenity=childcare"];' +
        ' way["amenity=childcare"];' +
        ' node["amenity=kindergarten"];' +
        ' way["amenity=kindergarten"];' +
        ' node["amenity=toy_library"];' +
        ' node["amenity=baby_hatch"];' +
        // Healthcare
        ' node["amenity=clinic"];' +
        ' way["amenity=clinic"];' +
        ' node["amenity=doctors"];' +
        ' way["amenity=doctors"];' +
        ' node["amenity=pharmacy"];' +
        ' way["amenity=pharmacy"];' +
        ' node["healthcare=midwife"];' +
        ' node["healthcare=birthing_centre"];' +
        ' node["healthcare=postpartum_care"];' +
        // Baby Care Facilities
        ' node["amenity=nursing_room"];' +
        ' way["amenity=nursing_room"];' +
        ' node["amenity=toilets"]["changing_table=yes"];' +
        ' way["amenity=toilets"]["changing_table=yes"];' +
        // Recreation & Play
        ' node["leisure=playground"];' +
        ' way["leisure=playground"];' +
        ' node["leisure=indoor_play"];' +
        ' way["leisure=indoor_play"];' +
        // Food & Dining (child-friendly)
        ' node["amenity=cafe"];' +
        ' way["amenity=cafe"];' +
        ' node["amenity=restaurant"];' +
        ' way["amenity=restaurant"];' +
        ' node["amenity=ice_cream"];' +
        ' way["amenity=ice_cream"];' +
        // Shopping
        ' node["shop=toys"];' +
        ' way["shop=toys"];' +
        ' node["shop=baby_goods"];' +
        ' way["shop=baby_goods"];' +
        ' node["shop=supermarket"]["changing_table=yes"];' +
        ' way["shop=supermarket"]["changing_table=yes"];' +
        // Libraries & Community
        ' node["amenity=library"];' +
        ' way["amenity=library"];' +
        ' node["amenity=community_centre"];' +
        ' way["amenity=community_centre"];' +
        ');' +
        'out body center qt;' +
        '>;' +
        'out skel qt;';
      
        var szUrl = "https://corsme.herokuapp.com/https://overpass.fr/api/interpreter?data=" + query;
        console.log(szUrl);
        var myfeed = Data.feed({
                "source": szUrl,
                "type": "json"
            }).load(function (mydata) {

                ixmaps.in_query = false;
                ixmaps.setTitle("");

                if (myfeed.data.elements && myfeed.data.elements.length) {
                    geo = osmtogeojson(myfeed.data);
                    ixmaps.setExternalData(geo, {
                        type: "geojson",
                        name: option.name
                    });
                } else {
                    ixmaps.setTitleBox("no points in map view");
                    ixmaps.setExternalData();
                }

            })
            .error(function (e) {
                ixmaps.setTitleBox("error while loading", "RGBA(128,0,0,0.5)");
                ixmaps.setExternalData(null, {
                    name: option.name
                });
                ixmaps.in_query = false;
            });

    };




         

    ixmaps.setTitleBox = function (szTitle, szColor) {
        ixmaps.setTitle("<span style='padding: 0.3em 1em;border:solid #ddd 1px;border-radius:0.2em;font-family:courier new,Raleway,arial,helvetica;background:" + (szColor || "rgba(255,255,255,0.9)") + ";color:" + (szColor ? "#fff" : "#888") + "'>" + szTitle + "</span");
    };

    //ixmaps.refreshTimeout = null;
    ixmaps.htmlgui_onZoomAndPan_old = ixmaps.htmlgui_onZoomAndPan;
    ixmaps.htmlgui_onZoomAndPan = function (nZoom) {

        //ixmaps.htmlgui_onNewTheme("features");

        if (ixmaps.getZoom() < 14) {
            ixmaps.htmlgui_onRemoveTheme("features");
            ixmaps.setTitleBox("<span style='background-color:white'>please zoom in or ask for <a style='pointer-events:all;border:solid black 0.1px;border-radius:5px;padding:0 0.2em' href='javascript:ixmaps.refreshTheme(\"features\")'>refresh</a></span>");
            ixmaps.htmlgui_onZoomAndPan_old(nZoom);
            return;
        }

        if (0 && ixmaps.in_query) {
            ixmaps.setTitleBox("theme busy ...");
            ixmaps.htmlgui_onZoomAndPan_old(nZoom);
            return;
        }

        ixmaps.setTitleBox("query overpass ...", "RGBA(95, 185, 135,0.5)");

        var bounds = ixmaps.getBoundingBox();
        if (ixmaps.oldBounds) {
            if ((bounds[0].lat >= ixmaps.oldBounds[0].lat) &&
                (bounds[0].lng >= ixmaps.oldBounds[0].lng) &&
                (bounds[1].lat <= ixmaps.oldBounds[1].lat) &&
                (bounds[1].lng <= ixmaps.oldBounds[1].lng)
            ) {
                ixmaps.htmlgui_onZoomAndPan_old(nZoom);
                ixmaps.setTitle("");
                return;
            }
        }

        if (ixmaps.refreshTimeout) {
            clearTimeout(ixmaps.refreshTimeout);
            ixmaps.refreshTimeout = null;
        }
        
        ixmaps.refreshTimeout = setTimeout('ixmaps.resetTheme("features")', 250);

        ixmaps.oldBounds = bounds;
        //ixmaps.htmlgui_onZoomAndPan_old(nZoom);
    };


    // -----------------------------------------------------------------------------------------------               
    // -----------------------------------------------------------------------------------------------               
    // user defined color schemes
    // ----------------------------------------------------------------------------------------------- 
    // ----------------------------------------------------------------------------------------------- 

    ixmaps.colorScheme_trees = function (objTheme) {
        
         for (i = 0; i < objTheme.szExactA.length; i++) {
            if (objTheme.szLabelA[i].match(/Platanus/i)) {
                objTheme.colorScheme[i] = "#EDC640";
            } else
            if (objTheme.szLabelA[i].match(/Prunus/i)) {
                objTheme.colorScheme[i] = "#712A3E";
            } else
            if (objTheme.szLabelA[i].match(/Sophora/i)) {
                objTheme.colorScheme[i] = "#C7AA25";
            } else
            if (objTheme.szLabelA[i].match(/Tilia/i)) {
                objTheme.colorScheme[i] = "#CDAD25";
            } else
            if (objTheme.szLabelA[i].match(/Celtis/i)) {
                objTheme.colorScheme[i] = "#B59F44";
            } else
            if (objTheme.szLabelA[i].match(/Ulmus/i)) {
                objTheme.colorScheme[i] = "rgb(0, 128, 95)";
            } else
            if (objTheme.szLabelA[i].match(/Pyrus/i)) {
                objTheme.colorScheme[i] = "#D42804";
            } else
            if (objTheme.szLabelA[i].match(/Robinia/i)) {
                objTheme.colorScheme[i] = "#DDA424";
            } else
            if (objTheme.szLabelA[i].match(/Populus/i)) {
                objTheme.colorScheme[i] = "#AB5521";
            } else
            if (objTheme.szLabelA[i].match(/Gleditsia/i)) {
                objTheme.colorScheme[i] = "#C7B902";
            } else
            if (objTheme.szLabelA[i].match(/Taxus/i)) {
                objTheme.colorScheme[i] = "#5F8476";
            } else
            if (objTheme.szLabelA[i].match(/Malus/i)) {
                objTheme.colorScheme[i] = "#B2B124";
            } else
            if (objTheme.szLabelA[i].match(/Ailanthus/i)) {
                objTheme.colorScheme[i] = "#6C9BAB";
            } else
            if (objTheme.szLabelA[i].match(/Fraxinus/i)) {
                objTheme.colorScheme[i] = "#C33334";
            } else
            if (objTheme.szLabelA[i].match(/Koelreuteria/i)) {
                objTheme.colorScheme[i] = "#D75004";
            } else
            if (objTheme.szLabelA[i].match(/Cornus/i)) {
                objTheme.colorScheme[i] = "#A10A2C";
            } else
            if (objTheme.szLabelA[i].match(/Pterocarya/i)) {
                objTheme.colorScheme[i] = "#D59D14";
            } else
            if (objTheme.szLabelA[i].match(/Fagus/i)) {
                objTheme.colorScheme[i] = "#D5762B";
            } else
            if (objTheme.szLabelA[i].match(/Betula/i)) {
                objTheme.colorScheme[i] = "#F7DD76";
            } else
            if (objTheme.szLabelA[i].match(/Corylus/i)) {
                objTheme.colorScheme[i] = "#B9A843";
            } else
            if (objTheme.szLabelA[i].match(/Magnolia/i)) {
                objTheme.colorScheme[i] = "#B9A843";
            } else
            if (objTheme.szLabelA[i].match(/Juglans/i)) {
                objTheme.colorScheme[i] = "#EDAA0F";
            } else
            if (objTheme.szLabelA[i].match(/Paulownia/i)) {
                objTheme.colorScheme[i] = "#97512A";
            } else
            if (objTheme.szLabelA[i].match(/Liquidambar/i)) {
                objTheme.colorScheme[i] = "#B81221";
            } else
            if (objTheme.szLabelA[i].match(/Zelkova/i)) {
                objTheme.colorScheme[i] = "#EE9F21";
            } else
            if (objTheme.szLabelA[i].match(/Morus/i)) {
                objTheme.colorScheme[i] = "#D8C20F";
            } else
            if (objTheme.szLabelA[i].match(/Toona/i)) {
                objTheme.colorScheme[i] = "#C07A57";
            } else
            if (objTheme.szLabelA[i].match(/Cercis/i)) {
                objTheme.colorScheme[i] = "#A30007";
            } else
            if (objTheme.szLabelA[i].match(/Quercus/i)) {
                objTheme.colorScheme[i] = "#F3D165";
            } else
            if (objTheme.szLabelA[i].match(/Salix/i)) {
                objTheme.colorScheme[i] = "#ECD314";
            } else
            if (objTheme.szLabelA[i].match(/Cedrus/i)) {
                objTheme.colorScheme[i] = "#5C6F44";
            } else
            if (objTheme.szLabelA[i].match(/Aesculus/i)) {
                objTheme.colorScheme[i] = "#902B00";
            } else
            if (objTheme.szLabelA[i].match(/Pinus/i)) {
                objTheme.colorScheme[i] = "rgb(150, 165, 108)";
            } else
            if (objTheme.szLabelA[i].match(/Ginkgo/i)) {
                objTheme.colorScheme[i] = "rgb(250, 220, 12)";
            } else
            if (objTheme.szLabelA[i].match(/Ciruelo/i)) {
                objTheme.colorScheme[i] = "rgb(180, 45, 111)";
            } else
            if (objTheme.szLabelA[i].match(/acacia/i)) {
                objTheme.colorScheme[i] = "rgb(139, 124, 21)";
            } else
            if (objTheme.szLabelA[i].match(/Falsa acacia/i)) {
                objTheme.colorScheme[i] = "rgb(139, 124, 21)";
            } else
            if (objTheme.szLabelA[i].match(/Almez/i)) {
                objTheme.colorScheme[i] = "rgb(44, 66, 0)";
            } else
            if (objTheme.szLabelA[i].match(/Castaño/i)) {
                objTheme.colorScheme[i] = "rgb(20, 100, 41)";
            } else
            if (objTheme.szLabelA[i].match(/Cedro del Atlas/i)) {
                objTheme.colorScheme[i] = "rgb(135, 153, 167)";
            } else
            if (objTheme.szLabelA[i].match(/Cedro/i)) {
                objTheme.colorScheme[i] = "rgb(121, 80, 34)";
            } else
            if (objTheme.szLabelA[i].match(/Acer/i)) {
                objTheme.colorScheme[i] = "rgb(244, 165, 0)";
            } else
            if (objTheme.szLabelA[i].match(/Ciprés/i)) {
                objTheme.colorScheme[i] = "rgb(71, 101, 24)";
            } else
            if (objTheme.szLabelA[i].match(/Cupressus/i)) {
                objTheme.colorScheme[i] = "rgb(71, 101, 24)";
            } else
            if (objTheme.szLabelA[i].match(/Aligustre/i)) {
                objTheme.colorScheme[i] = "rgb(213, 208, 229)";
            } else
            if (objTheme.szLabelA[i].match(/Aligustre/i)) {
                objTheme.colorScheme[i] = "rgb(213, 208, 229)";
            } else
            if (objTheme.szLabelA[i].match(/undefined/i)) {
                objTheme.colorScheme[i] = "rgb(130, 155, 30)";
            } else {
                var rr = Math.floor(Math.random() * 255);
                var bb = Math.floor(Math.random() * 155);
                var gg = 200;
                objTheme.colorScheme[i] = "RGB(" + rr + "," + gg + "," + bb + ")";
                objTheme.colorScheme[i] = "rgb(130, 155, 30)";
            }
        }
        console.log("ccccccccccccccccccccccccccccccccccc");
        console.log(objTheme.colorScheme);
        console.log("ccccccccccccccccccccccccccccccccccc");
    };



})();

/**
 * end of namespace
 */

// -----------------------------
// EOF
// -----------------------------
