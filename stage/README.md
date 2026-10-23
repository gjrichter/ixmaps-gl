<style>
.markdown-body .gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 2em 1.4em;
  margin: 1.5em 0;
}
.markdown-body .gallery .card {
  min-width: 0;
}
.markdown-body .gallery .card img {
  width: 100%;
  height: auto;
  display: block;
}
.markdown-body .gallery .card b {
  display: block;
  margin-top: 0.6em;
}
.markdown-body .gallery .card sub {
  display: inline-block;
  line-height: 1.3;
  margin: 0.3em 0 0.6em;
}
</style>

# ixmaps-gl Stage

Interactive map examples built with [ixmaps-gl](https://github.com/gjrichter/ixmaps-gl) — the same declarative ixmaps API, rendered with MapLibre GL JS + deck.gl. Live at **https://gl.ixmaps.com/stage/**

---

## Root

<div class="gallery">
<div class="card">
<a href="https://gl.ixmaps.com/stage/accidents_app.html"><img src="screenshots/accidents_app.png" width="100%"></a><br>
<b>ISTAT road accidents, Lombardia 2019–2021</b><br>
<sub>Certified ISTAT accident microdata (GEOMIS / AREU): accident type sized by injuries, per-year curves and a facet browser.</sub><br>
<a href="https://gl.ixmaps.com/stage/accidents_app.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/accidents_app.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/demo_accidents.html"><img src="screenshots/demo_accidents.png" width="100%"></a><br>
<b>ISTAT road accidents — minimal</b><br>
<sub>The same Lombardia accident data as the map above, stripped down to the map alone: accident type by number of injured.</sub><br>
<a href="https://gl.ixmaps.com/stage/demo_accidents.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/demo_accidents.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/germany_accidents_app_2023_2025.html"><img src="screenshots/germany_accidents_app_2023_2025.png" width="100%"></a><br>
<b>Germany road accidents 2023–2025</b><br>
<sub>Unfallatlas accident locations across Germany, coloured by accident type, with per-year curves and step-by-step loading messages.</sub><br>
<a href="https://gl.ixmaps.com/stage/germany_accidents_app_2023_2025.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/germany_accidents_app_2023_2025.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/germany_accidents_app.html"><img src="screenshots/germany_accidents_app.png" width="100%"></a><br>
<b>Germany road accidents 2020–2025</b><br>
<sub>The full Unfallatlas series 2020–2025, over a million accident locations, with per-year curves and a facet browser.</sub><br>
<a href="https://gl.ixmaps.com/stage/germany_accidents_app.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/germany_accidents_app.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/uk_collisions_2023.html"><img src="screenshots/uk_collisions_2023.png" width="100%"></a><br>
<b>UK road collisions 2023</b><br>
<sub>All recorded UK road collisions (STATS19, DfT) on a 3 px grid, coloured by severity, with totals per year; pan and zoom to filter.</sub><br>
<a href="https://gl.ixmaps.com/stage/uk_collisions_2023.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/uk_collisions_2023.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/global_power_plants_sidebar.html"><img src="screenshots/global_power_plants_sidebar.png" width="100%"></a><br>
<b>Global power plants — facet browser</b><br>
<sub>Installed capacity by fuel type from the WRI Global Power Plant Database; click a facet value to filter the map.</sub><br>
<a href="https://gl.ixmaps.com/stage/global_power_plants_sidebar.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/global_power_plants_sidebar.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/global_power_plants_world_map.html"><img src="screenshots/global_power_plants_world_map.png" width="100%"></a><br>
<b>Global power plants — map / globe switch</b><br>
<sub>The same power-plant data with a live switch between a flat map and a globe projection.</sub><br>
<a href="https://gl.ixmaps.com/stage/global_power_plants_world_map.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/global_power_plants_world_map.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/roma_incidenti_pericolosita_sidebar_gl.html"><img src="screenshots/roma_incidenti_pericolosita_sidebar_gl.png" width="100%"></a><br>
<b>Rome road accidents — danger index (ixmaps-gl)</b><br>
<sub>Accidents in Rome, March 2021 – March 2022: circle size shows the average severity (fatal = 9, injured = 3, unhurt = 1). Runs on ixmaps-gl.</sub><br>
<a href="https://gl.ixmaps.com/stage/roma_incidenti_pericolosita_sidebar_gl.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/roma_incidenti_pericolosita_sidebar_gl.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/roma_incidenti_pericolosita_sidebar.html"><img src="screenshots/roma_incidenti_pericolosita_sidebar.png" width="100%"></a><br>
<b>Rome road accidents — danger index (ixmaps-flat)</b><br>
<sub>The original ixmaps-flat version of the same map, for comparison with the ixmaps-gl one.</sub><br>
<a href="https://gl.ixmaps.com/stage/roma_incidenti_pericolosita_sidebar.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/roma_incidenti_pericolosita_sidebar.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/mappa_stranieri_30.html"><img src="screenshots/mappa_stranieri_30.png" width="100%"></a><br>
<b>Foreign pupils per school</b><br>
<sub>Schools as bubbles coloured by class, sized by the number of foreign pupils, with filters by city and school type.</sub><br>
<a href="https://gl.ixmaps.com/stage/mappa_stranieri_30.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/mappa_stranieri_30.html">see code →</a>
</div>
</div>

---

## censimenti/

<div class="gallery">
<div class="card">
<a href="https://gl.ixmaps.com/stage/censimenti/index_embed_italia_censimenti_compare_procom_2023.html"><img src="screenshots/censimenti--index_embed_italia_censimenti_compare_procom_2023.png" width="100%"></a><br>
<b>Data Viz Italia — censimenti 2021–2023</b><br>
<sub>Population change 2021–2023 by municipality, aggregated dynamically from ISTAT census sections: growth, age groups, education and foreign residents.</sub><br>
<a href="https://gl.ixmaps.com/stage/censimenti/index_embed_italia_censimenti_compare_procom_2023.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/censimenti/index_embed_italia_censimenti_compare_procom_2023.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/censimenti/index_embed_italia_censimenti_compare_procom.html"><img src="screenshots/censimenti--index_embed_italia_censimenti_compare_procom.png" width="100%"></a><br>
<b>Data Viz Italia — censimenti 2011–2021</b><br>
<sub>ISTAT 2011–2021 census comparison: population, education and foreign residents by census section, aggregated to municipalities.</sub><br>
<a href="https://gl.ixmaps.com/stage/censimenti/index_embed_italia_censimenti_compare_procom.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/censimenti/index_embed_italia_censimenti_compare_procom.html">see code →</a>
</div>
</div>

---

## GHS/

<div class="gallery">
<div class="card">
<a href="https://gl.ixmaps.com/stage/GHS/ghs2024_sidebar.html"><img src="screenshots/GHS--ghs2024_sidebar.png" width="100%"></a><br>
<b>GHS Urban Centres 2024 — thematic explorer</b><br>
<sub>11,422 urban centres of the world (GHS Urban Centre Database R2024A): air quality, climate and hazards, and urban settlement themes in one page, with a flat map / globe switch and a light / dark mode.</sub><br>
<a href="https://gl.ixmaps.com/stage/GHS/ghs2024_sidebar.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/GHS/ghs2024_sidebar.html">see code →</a>
</div>
</div>

---

## live/

Maps fed by live data sources, refreshed on every load.

<div class="gallery">
<div class="card">
<a href="https://gl.ixmaps.com/stage/live/index_embed_terremoti_ultima_settimana.html"><img src="screenshots/live--index_embed_terremoti_ultima_settimana.png" width="100%"></a><br>
<b>Earthquakes of the last week</b><br>
<sub>Live INGV earthquake catalogue (magnitude ≥ 1, last 7 days) over the DISS seismogenic sources; circle size by magnitude or by energy, with a size-exponent slider.</sub><br>
<a href="https://gl.ixmaps.com/stage/live/index_embed_terremoti_ultima_settimana.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/live/index_embed_terremoti_ultima_settimana.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/live/incendi_attivi_effis_kde_regioni.html"><img src="screenshots/live--incendi_attivi_effis_kde_regioni.png" width="100%"></a><br>
<b>Active fires in Italy — EFFIS</b><br>
<sub>NASA FIRMS / EFFIS active-fire hotspots with known industrial heat sources excluded, optional KDE density surface and regional filter.</sub><br>
<a href="https://gl.ixmaps.com/stage/live/incendi_attivi_effis_kde_regioni.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/live/incendi_attivi_effis_kde_regioni.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/live/prezzi_carburanti.html"><img src="screenshots/live--prezzi_carburanti.png" width="100%"></a><br>
<b>Fuel prices in Italy</b><br>
<sub>MISE fuel prices (LPG, petrol, diesel, methane) as labels, dots, clusters or an aggregated grid, for the visible area or all of Italy.</sub><br>
<a href="https://gl.ixmaps.com/stage/live/prezzi_carburanti.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/live/prezzi_carburanti.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/live/temperature_attuali_wbgt_kde.html"><img src="screenshots/live--temperature_attuali_wbgt_kde.png" width="100%"></a><br>
<b>Temperature and heat stress (WBGT)</b><br>
<sub>Real-time MeteoHub station data: measured and apparent temperature, humidity and WBGT, with a KDE surface of the ISO 7243 risk zones.</sub><br>
<a href="https://gl.ixmaps.com/stage/live/temperature_attuali_wbgt_kde.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/live/temperature_attuali_wbgt_kde.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/live/facets_status_time.html"><img src="screenshots/live--facets_status_time.png" width="100%"></a><br>
<b>NYC 311 complaints by status</b><br>
<sub>Service requests to New York City's 311 line over a selectable time scope (24 hours, 7 days, 1 month), with facets that count the complaints in view.</sub><br>
<a href="https://gl.ixmaps.com/stage/live/facets_status_time.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/live/facets_status_time.html">see code →</a>
</div>
</div>

---

## video/

<div class="gallery">
<div class="card">
<a href="https://gl.ixmaps.com/stage/video/parler_dc_riot_timeline.html"><img src="screenshots/video--parler_dc_riot_timeline.png" width="100%"></a><br>
<b>Jan 6, 2021 — Parler video geolocations</b><br>
<sub>Over a thousand geolocated Parler videos from the US Capitol riot, sized by duration, with a time slider and play button to replay the day.</sub><br>
<a href="https://gl.ixmaps.com/stage/video/parler_dc_riot_timeline.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/video/parler_dc_riot_timeline.html">see code →</a>
</div>
<div class="card">
<a href="https://gl.ixmaps.com/stage/video/Palestine_video.html"><img src="screenshots/video--Palestine_video.png" width="100%"></a><br>
<b>Gaza, West Bank and East Jerusalem — located videos</b><br>
<sub>B'Tselem and Peace Now boundary layers (Areas A/B/C, settlements, barrier, Green Line) with B'Tselem's located videos.</sub><br>
<a href="https://gl.ixmaps.com/stage/video/Palestine_video.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/stage/video/Palestine_video.html">see code →</a>
</div>
</div>

---

## Tools

Standalone tools (not map demos).

<div class="gallery">
<div class="card">
<a href="https://gl.ixmaps.com/app/ixmaps-loader_70.html"><img src="screenshots/ixmaps-loader_70.png" width="100%"></a><br>
<b>iXmaps Smart Data Loader</b><br>
<sub>Paste a URL or load a file (CSV, JSON, GeoJSON, TopoJSON, …) to inspect it and build an ixmaps layer, with optional AI-assisted configuration.</sub><br>
<a href="https://gl.ixmaps.com/app/ixmaps-loader_70.html">OPEN →</a> &nbsp;·&nbsp; <a href="https://gjrichter.github.io/MapCodeViewer/?url=https://gl.ixmaps.com/app/ixmaps-loader_70.html">see code →</a>
</div>
</div>
