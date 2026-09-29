/**
 * comune_selector.js — "Vai a un comune": search box for the censimenti maps.
 *
 * Type a comune name (or focus the empty box for the main cities), pick a
 * result, and the map zooms to that comune. The list comes from the 2024
 * comuni boundaries the maps already load (same URL, so the browser cache
 * serves it): name, province and bounding box per comune, built on first use.
 * The map is centred on the comune's city centre (town hall, data/
 * comuni_centro_2024.json, made by tools/build_comuni_centro.py), not on the
 * middle of its boundary, which for a big or elongated comune (Genova, Roma,
 * Venezia) can lie kilometres from the town. Without that file it falls back
 * to the middle of the bounding box.
 *
 * Needs, on the page: an empty <div id="comune-select"></div> in the sidebar,
 * the styles in css/site_procom.css, and ixmaps-gl (ixmaps.map().view()).
 * window.comuneSelector = { ready, search(q), goTo(proCom) } is exposed for tests.
 */
(function () {
    "use strict";

    // the script's own URL, read now (document.currentScript is gone after load)
    var SCRIPT_SRC = document.currentScript && document.currentScript.src;
    var CENTRES_URL = SCRIPT_SRC ? new URL("../data/comuni_centro_2024.json", SCRIPT_SRC).href : "./data/comuni_centro_2024.json";

    var COMUNI_URL = "https://s3.eu-central-1.amazonaws.com/maps.ixmaps.com/Istat/comuni_2024/ondata_confini_amministrativi_api_v2_it_20240101_comuni.s.topo.json.gz";

    // shown when the box is focused and empty; matched against the index by name + province
    var QUICK = [
        ["Roma", "RM"], ["Milano", "MI"], ["Napoli", "NA"], ["Torino", "TO"], ["Palermo", "PA"],
        ["Genova", "GE"], ["Bologna", "BO"], ["Firenze", "FI"], ["Bari", "BA"], ["Catania", "CT"],
        ["Venezia", "VE"], ["Verona", "VR"], ["Messina", "ME"], ["Padova", "PD"], ["Trieste", "TS"],
        ["Brescia", "BS"], ["Cagliari", "CA"], ["Perugia", "PG"], ["Trento", "TN"], ["Bolzano/Bozen", "BZ"]
    ];
    var MAX_RESULTS = 8;
    var MAX_ZOOM = 15;      // MapLibre zoom cap for the tiniest comuni
    var ZOOM_PAD = 0.3;     // breathing room around the comune, in zoom levels
    var MOBILE_MAX_WIDTH = 768;
    var WORLD_PX = 512;     // MapLibre's world is 512 px wide at zoom 0

    // Never stop short of this zoom: the section layers load their data by
    // the visible bbox, and a big comune (Roma) shown whole is too large a
    // request. Measured for Roma's centre, both section layers together
    // (2021-2023 page): 12.5 -> 48 MB, 13 -> 40, 14 -> 23, 14.5 -> 16,
    // 15 -> 10, 16 -> 5. So a comune that would fit at a lower zoom is shown
    // at MIN_FLAT_ZOOM (flat zoom, as the page's own zoom) instead. It can
    // never be lower than where the section layers start: they carry
    // featureupper "1:150000", and the engine's map scale is
    // FLAT_SCALE_CONSTANT / 2^flatZoom (ixmaps-gl FLAT_OBJECT_SCALE_CONSTANT).
    var MIN_FLAT_ZOOM = 14;
    var SECTIONS_SCALE = 150000;
    var FLAT_SCALE_CONSTANT = 442913385;
    var SECTIONS_FLAT_ZOOM = Math.log2(FLAT_SCALE_CONSTANT / SECTIONS_SCALE) + 0.05; // 11.58
    var SECTIONS_ZOOM = Math.max(MIN_FLAT_ZOOM, SECTIONS_FLAT_ZOOM) - 1;             // MapLibre zoom (flat - 1)

    var comuni = null;      // [{ name, sigla, pro, key, bbox: [w, s, e, n] }]
    var centres = null;     // { pro_com: [lon, lat] } city centres, or null if unavailable
    var byPro = {};
    var loading = null;

    var norm = function (s) {
        return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
            .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    };

    // ---- index: name, province and bbox per comune, from the topojson ----

    var buildIndex = function (topo) {
        var t = topo.transform || { scale: [1, 1], translate: [0, 0] };
        var arcBox = [];
        var boxOfArc = function (i) {
            if (i < 0) { i = ~i; }
            if (arcBox[i]) { return arcBox[i]; }
            var x = 0, y = 0, b = [Infinity, Infinity, -Infinity, -Infinity];
            topo.arcs[i].forEach(function (p) {
                x += p[0]; y += p[1];
                var lon = x * t.scale[0] + t.translate[0], lat = y * t.scale[1] + t.translate[1];
                if (lon < b[0]) { b[0] = lon; } if (lat < b[1]) { b[1] = lat; }
                if (lon > b[2]) { b[2] = lon; } if (lat > b[3]) { b[3] = lat; }
            });
            return (arcBox[i] = b);
        };
        var grow = function (b, arcs) {
            arcs.forEach(function (a) {
                if (typeof a === "number") {
                    var ab = boxOfArc(a);
                    if (ab[0] < b[0]) { b[0] = ab[0]; } if (ab[1] < b[1]) { b[1] = ab[1]; }
                    if (ab[2] > b[2]) { b[2] = ab[2]; } if (ab[3] > b[3]) { b[3] = ab[3]; }
                } else {
                    grow(b, a);
                }
            });
            return b;
        };
        var geoms = topo.objects[Object.keys(topo.objects)[0]].geometries;
        var list = [];
        geoms.forEach(function (g) {
            var p = g.properties || {};
            if (!g.arcs || !p.comune) { return; }
            var entry = {
                name: p.comune, sigla: p.sigla || "", pro: p.pro_com, key: norm(p.comune),
                bbox: grow([Infinity, Infinity, -Infinity, -Infinity], g.arcs)
            };
            list.push(entry);
            byPro[entry.pro] = entry;
        });
        return list;
    };

    var load = function () {
        if (!loading) {
            var centresLoaded = fetch(CENTRES_URL)
                .then(function (r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); })
                .then(function (d) { centres = d.centre; })
                .catch(function (e) { console.warn("[comune_selector] city centres unavailable, using the middle of each boundary:", e.message); });
            loading = fetch(COMUNI_URL)
                .then(function (r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); })
                .then(function (topo) { comuni = buildIndex(topo); return centresLoaded; })
                .then(function () { return comuni; });
            loading.catch(function () { loading = null; }); // allow a retry on the next focus
        }
        return loading;
    };

    // ---- search ----

    var label = function (c) { return c.name + (c.sigla ? " (" + c.sigla + ")" : ""); };

    var search = function (q) {
        var k = norm(q);
        if (!comuni || !k) { return []; }
        var starts = [], contains = [];
        for (var i = 0; i < comuni.length; i++) {
            var pos = comuni[i].key.indexOf(k);
            if (pos === 0) { starts.push(comuni[i]); }
            else if (pos > 0) { contains.push(comuni[i]); }
        }
        var byName = function (a, b) { return a.name.localeCompare(b.name, "it"); };
        // "roma" -> Roma before Romagnano; a word start ("prato" in "Prato allo Stelvio") ranks with prefixes
        return starts.sort(byName).concat(contains.sort(byName)).slice(0, MAX_RESULTS);
    };

    var quickList = function () {
        var out = [];
        QUICK.forEach(function (q) {
            for (var i = 0; i < comuni.length; i++) {
                if (comuni[i].name === q[0] && comuni[i].sigla === q[1]) { out.push(comuni[i]); break; }
            }
        });
        return out;
    };

    // ---- zoom to a comune ----

    // pixels of the map covered by the floating sidebar (desktop only)
    var sidebarInset = function (mapEl) {
        var sb = document.getElementById("main_sidebar");
        if (!sb || getComputedStyle(sb).display === "none") { return 0; }
        var m = mapEl.getBoundingClientRect(), s = sb.getBoundingClientRect();
        if (s.width > m.width * 0.6) { return 0; } // phone: the sidebar covers the map; it is closed on select
        return Math.max(0, m.right - s.left);
    };

    var goTo = function (proCom) {
        var c = byPro[proCom];
        if (!c) { return false; }
        var mapEl = document.getElementById("map_div");
        var W = mapEl.clientWidth, H = mapEl.clientHeight;
        var inset = sidebarInset(mapEl);
        var availW = Math.max(200, W - inset);
        var w = c.bbox[0], s = c.bbox[1], e = c.bbox[2], n = c.bbox[3];
        var mercY = function (lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); };
        var zW = Math.log2(360 * availW / (WORLD_PX * Math.max(e - w, 1e-6)));
        var zH = Math.log2(2 * Math.PI * H / (WORLD_PX * Math.max(mercY(n) - mercY(s), 1e-6)));
        var z = Math.max(SECTIONS_ZOOM, Math.min(MAX_ZOOM, Math.min(zW, zH) - ZOOM_PAD));
        // put the city centre in the middle of the part of the map the sidebar leaves free
        var pxPerDeg = WORLD_PX * Math.pow(2, z) / 360;
        var centre = centres && centres[c.pro];
        var lng = (centre ? centre[0] : (w + e) / 2) + (inset / 2) / pxPerDeg;
        var lat = centre ? centre[1] : (s + n) / 2;
        ixmaps.map().view([lat, lng], z + 1); // view() takes flat zoom = MapLibre zoom + 1
        if (window.innerWidth <= MOBILE_MAX_WIDTH && typeof toggleSidebar === "function") { toggleSidebar(); }
        return true;
    };

    // ---- UI ----

    var init = function () {
        var host = document.getElementById("comune-select");
        if (!host) { return; }
        host.innerHTML =
            '<label class="comune-select-label" for="comune-input">Vai a un comune</label>' +
            '<input id="comune-input" type="search" autocomplete="off" spellcheck="false" placeholder="Cerca un comune…" ' +
            'role="combobox" aria-expanded="false" aria-controls="comune-list" aria-autocomplete="list">' +
            '<ul id="comune-list" role="listbox" hidden></ul>';
        var input = host.querySelector("input"), listEl = host.querySelector("ul");
        var items = [], active = -1;

        var close = function () { listEl.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
        var setActive = function (i) {
            active = i;
            Array.prototype.forEach.call(listEl.querySelectorAll("li[data-pro]"), function (li, k) {
                li.classList.toggle("active", k === i);
                if (k === i) { li.scrollIntoView({ block: "nearest" }); }
            });
        };
        var render = function (results, heading, message) {
            items = results;
            listEl.innerHTML = "";
            if (heading) { listEl.insertAdjacentHTML("beforeend", '<li class="comune-group" role="presentation">' + heading + "</li>"); }
            if (message) { listEl.insertAdjacentHTML("beforeend", '<li class="comune-empty" role="presentation">' + message + "</li>"); }
            results.forEach(function (c) {
                var li = document.createElement("li");
                li.setAttribute("role", "option");
                li.setAttribute("data-pro", c.pro);
                li.textContent = label(c);
                listEl.appendChild(li);
            });
            listEl.hidden = !(results.length || message);
            input.setAttribute("aria-expanded", String(!listEl.hidden));
            active = -1;
        };
        var refresh = function () {
            if (!comuni) { render([], null, loading ? "Carico l'elenco dei comuni…" : null); return; }
            var q = input.value;
            if (!norm(q)) { render(quickList(), "Città principali"); return; }
            var r = search(q);
            render(r, null, r.length ? null : "Nessun comune trovato");
        };
        var pick = function (c) {
            input.value = label(c);
            close();
            goTo(c.pro);
        };

        input.addEventListener("focus", function () {
            load().then(refresh, function () { render([], null, "Elenco dei comuni non disponibile"); });
            refresh();
        });
        input.addEventListener("input", function () { load().then(refresh); refresh(); });
        input.addEventListener("keydown", function (ev) {
            if (ev.key === "ArrowDown") { ev.preventDefault(); if (items.length) { setActive((active + 1) % items.length); } }
            else if (ev.key === "ArrowUp") { ev.preventDefault(); if (items.length) { setActive((active - 1 + items.length) % items.length); } }
            else if (ev.key === "Enter") { ev.preventDefault(); var c = items[active >= 0 ? active : 0]; if (c) { pick(c); } }
            else if (ev.key === "Escape") { close(); }
        });
        // mousedown, not click: the input's blur would close the list before a click lands
        listEl.addEventListener("mousedown", function (ev) {
            var li = ev.target.closest("li[data-pro]");
            if (li) { ev.preventDefault(); pick(byPro[li.getAttribute("data-pro")]); }
        });
        input.addEventListener("blur", function () { setTimeout(close, 120); });
    };

    window.comuneSelector = {
        get ready() { return load(); },
        search: function (q) { return search(q).map(function (c) { return { name: c.name, sigla: c.sigla, pro: c.pro, bbox: c.bbox }; }); },
        goTo: goTo
    };

    if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); } else { init(); }
})();
