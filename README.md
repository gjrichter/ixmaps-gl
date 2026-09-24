# ixmaps-gl

A from-scratch, config-driven map/theme engine that exposes the **same declarative
builder API** as the original [ixmaps](https://ixmaps.com) framework —

```js
ixmaps.Map(id, options)
ixmaps.layer(name, layer => layer.data().binding().filter().type().style().meta())
```

— but renders through **MapLibre GL JS + deck.gl** instead of ixmaps' own SVG/Leaflet
engine. The goal is drop-in compatibility: a real, unmodified ixmaps page should be
able to run against this engine by swapping only the `<script>` tag that loads it.

## Why

ixmaps' declarative model (a page describes *what* to show — a data source, a field
binding, a chart type, a style — not *how* to draw it) is a good fit for a modern
WebGL rendering stack: MapLibre for basemap/vector-tile rendering and camera control,
deck.gl for large-scale, GPU-instanced point/polygon layers and clustering. This
project re-implements the ixmaps theme grammar on top of that stack rather than
patching the original SVG engine.

## Status

This engine is under active, compatibility-driven development: every gap found by
pointing a real ixmaps page at it gets fixed **in the engine**, never by rewriting the
page. It currently implements:

- **FEATURE / FEATURES** — polygon/line rendering from GeoJSON/TopoJSON
- **CHOROPLETH** — polygon fill from a bound value: single-field numeric range
  (equal-interval, QUANTILE, NATURAL/Jenks breaks) or multi-field DOMINANT
  (per-polygon argmax, plain/`PERCENTOFMEAN`/`DEVIATION`) or COMPOSECOLOR (additive or
  `SUBTRACTIVE` color blend); plus DOPACITY/DOPACITYMIN/DOPACITYMAX/DOPACITYMINMAX for
  value- or density-driven fill opacity
- **CHART\|SYMBOL\|GLOW\|CATEGORICAL\|AGGREGATE\|COUNT\|RELOCATE\|VALUES** — the
  bubble-map pipeline: categorical clustering, dynamic sizing, glow, multi-point
  grouping, on-bubble value labels, `NORMALIZE`
- **DOT** — the simplest base symbol (fixed-radius, unclustered points)
- A native interactive legend (default bars, `SIMPLELEGEND`, `COMPACTLEGEND`,
  `NOLEGEND`, `TEXTLEGEND`; light/dark color themes; corner `align` option;
  collapsible, collapsed by default on narrow/mobile screens)
- A standard facets API (`ixmaps.data.getFacets`/`showFacets`,
  `window.__setFacetFilter`) for building filterable sidebars
- Globe (orthographic) projection alongside flat Mercator

Not yet implemented: `CATEGORICAL` choropleths, and the `QUAD`/`BEZIER`/`VECTOR`/
`PIE`/`DONUT`/`WAFFLE`/`BAR` base types and SYMBOL shape variants beyond
circle/square/diamond/triangle. See the top-of-file comment in
[`ixmaps-gl.js`](./ixmaps-gl.js) for the exact, currently-accurate scope note.

## Quick start

```html
<script src="ixmaps-gl.js"></script>
<div id="map_div" style="position:absolute;inset:0;"></div>

<script>
  var __theme = ixmaps.layer("my_theme", layer => layer
    .data({ url: "data.topojson.gz", type: "topojson" })
    .binding({ position: "geometry", value: "CATEGORY_FIELD", size: "SIZE_FIELD" })
    .type("CHART|SYMBOL|GLOW|CATEGORICAL|AGGREGATE|COUNT|RELOCATE|VALUES")
    .style({ colorscheme: ["#ddbb22", "#0066cc", "#ff0088"] })
    .meta({ title: "My theme", tooltip: "<b>{{theme.title}}</b><br>{{theme.item.chart}}" })
  );

  ixmaps.Map("map_div", { mapType: "VT_BRIGHT_LIGHT", mode: "pan", legend: "open" })
    .view({ center: { lat: 45.47, lng: 9.19 }, zoom: 10 })
    .layer(__theme);
</script>
```

See [`demo_accidents.html`](./demo_accidents.html) for a minimal working page copied
verbatim (config included) from a real ixmaps page — the only change is which script
provides `ixmaps.layer`/`ixmaps.Map`.

## Grammar validation (opt-in)

ixmaps-gl can check every theme definition against the shared ixmaps grammar
([ixmaps-grammar](https://github.com/gjrichter/ixmaps-grammar), extracted from the real
ixmaps-flat sources) and report — once per keyword, in the browser console — typos and
features this engine doesn't implement:

```text
[ixmaps-gl validate] error unknown-style-key — layer "points": unknown style key "fillOpacity" — did you mean "fillopacity"?
[ixmaps-gl validate] warning gl-unsupported — layer "pie": type flag "PIE" is not implemented by ixmaps-gl
```

It is **off by default** — nothing is fetched and nothing changes. Turn it on with any of:

```js
ixmaps.Map("map_div", {...}).options({ validate: true })  // or a validator module URL
ixmaps.validate = true                                     // before or after loading ixmaps-gl.js
```

or by adding `?ixmaps-validate` to the page URL (this only switches validation on; the
validator URL can only be set from page code).

Checked: Map() options, `.options()`, each layer's `.type()` flags, `.style()`, `.meta()`,
`.binding()`, `.data()`; layers added later (`defineLayer`); runtime `setThemeStyle` /
`changeThemeStyle` patches; and reads of `ixmaps.*` functions this engine lacks (the
`ixmaps` global becomes a Proxy in validation mode only; missing properties still read as
`undefined`). `map.getValidationReport()` returns the findings as data (`null` when off).
If the validator can't be loaded, the map loads normally without it. See
[`examples/validate_demo.html`](./examples/validate_demo.html).

For checking page files before they run, use the static checker in ixmaps-grammar
(`ixmaps-check --engine gl page.html`).

## Example / demo pages

| Page | What it shows |
|---|---|
| [`demo_accidents.html`](./demo_accidents.html) | Minimal quick-start example |
| [`accidents_app.html`](./accidents_app.html) / [`germany_accidents_app.html`](./germany_accidents_app.html) | Full app with a facets sidebar (standard facets API) |
| [`global_power_plants_world_map.html`](./global_power_plants_world_map.html) | Native legend, globe projection toggle |
| [`global_power_plants_sidebar.html`](./global_power_plants_sidebar.html) | Same dataset with a facets sidebar instead of the native legend |
| [`mappa_stranieri_30.html`](./mappa_stranieri_30.html) | Symbol shapes, city picker, runtime `changeThemeStyle` filtering, light legend theme |
| [`roma_incidenti_pericolosita_sidebar_gl.html`](./roma_incidenti_pericolosita_sidebar_gl.html) | AGGREGATE + gridwidth clustering, facets sidebar |
| [`roma_incidenti_pericolosita_sidebar.html`](./roma_incidenti_pericolosita_sidebar.html) | The same page on the **real** ixmaps-flat engine, kept for side-by-side reference |
| [`uk_collisions_2023.html`](./uk_collisions_2023.html), [`ixmaps-loader_70.html`](./ixmaps-loader_70.html) | Additional real-page compatibility tests |
| [`examples/`](./examples) | Smaller feature-by-feature test pages (choropleth classing modes, bubble ranges, etc.) |

Serve any of these with a static file server (they fetch remote data over HTTPS, so
`file://` won't work for most):

```bash
python3 -m http.server 8000
```

## License

BSD 3-Clause — see [`LICENSE.txt`](./LICENSE.txt).
