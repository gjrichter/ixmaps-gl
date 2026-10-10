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

- **FEATURE / FEATURES** — polygon/line rendering from GeoJSON/TopoJSON and the data.js geo
  formats; `featureupper`/`featurelower` hide the layer outside their scales, and, as in flat, a
  FEATURE theme out of scale loads its data only once it comes into scale (for that view);
  flat's drop `shadow` (`shadowblur`/`shadowdx`/`shadowdy`, `maxshadow`, `shadowupper`/`shadowlower`),
  approximated with translucent outlines since deck.gl has no blur
- **CHOROPLETH** — polygon fill from a bound value: single-field numeric range
  (equal-interval, QUANTILE, NATURAL/Jenks breaks) or multi-field DOMINANT
  (per-polygon argmax, plain/`PERCENTOFMEAN`/`DEVIATION`; with a `value100` the field means are
  flat's pooled Σ field ÷ Σ value100) or COMPOSECOLOR (additive or
  `SUBTRACTIVE` color blend) or, with `CATEGORICAL|AGGREGATE` on one field, the dominant category of
  each polygon's records (sum of the size field per category); `HEADTAIL` breaks, `DENSITY` (value per km²), flat's
  `ZEROISNOTVALUE`/`UNDEFINEDISNOTVALUE`; plus DOPACITY/DOPACITYMIN/DOPACITYMAX/DOPACITYMINMAX for
  value- or density-driven fill opacity
- **CHART\|SYMBOL\|GLOW\|CATEGORICAL\|AGGREGATE\|COUNT\|RELOCATE\|VALUES** — the
  bubble-map pipeline: AGGREGATE on ixmaps-flat's grid (hexagonal, or square with
  `RECT`; cell width from `aggregation`/`gridwidth`/`gridwidthpx`, values summed per
  cell, class breaks and legend from the aggregated cells), dynamic sizing, glow (between
  `glowlower` and `glowupper`),
  multi-point grouping, on-bubble value labels, `NORMALIZE`, chart boxes (`BOX`, `CIRCULARBOX`)
  with the item title above or below (`TITLE`, `BOTTOMTITLE`), between `boxlower` and `boxupper`.
  A `CATEGORICAL` `BUBBLE` (also `EXACT`/`AGGREGATE`) is filled and outlined as in flat, each
  bubble and each part of a grouped one: `fillopacity` (1), outlined in the category color × 0.7
  or `linecolor` (none with `NOLINES`), `linewidth` (0.1) growing with √radius (`OUTLINE`: up to the
  normal radius), the outline opaque with `linecolor`/`OUTLINE` or below fillopacity 0.5, else 0.3
- **CHART\|LABEL** — flat's value label: a rounded box sized by the bubble radius of the size value
  in the item color, with `VALUES` the value in bold; with `TEXTONLY` only the text, over a halo of
  the theme color
- Chart values (`VALUES`, labels) as flat prints them: the `valuefield` value, flat's number format
  (thousands with spaces, `valuedecimals`, years without breaks), `units` after a space
- `align` (`left`, `2left`, `right`, `above`, `below`, …) and `offsetx`/`offsety` move a whole
  chart — symbol, glow, shadow, box, title and value — as flat does
- A range theme of at most two classes gets flat's one-row legend (the value range, or for a
  `$item$` count the label or field name)
- **CHART\|SYMBOL\|SEQUENCE** on AGGREGATE CATEGORICAL data — one chart per cell (or aggregation
  field value) with a symbol per category, laid out as flat does (`STAR`, `HORZ`, centered), with
  flat's part sizes, glow and value labels
- **CHART\|USER** — a page's own chart function (`style.userdraw`: `ixmaps.<name>(SVGDocument, opt)`
  and its `_init`, as flat calls them), drawn in flat's chart units and shown as an icon at flat's size
- **CHART\|PIE** (and `PIE|DONUT`) — a pie per record (placed on its FEATURE shape by
  `binding.lookup`), a slice per value field, as flat lays them out: `SIZE` by the size field (or
  the parts' sum), `SORT`, `SYMMETRIC`/`BIGTOTOP`, `HALF*`, `AUTOCOMPLETE`, `CENTER` (the center
  part as a disc, `GLOW`), `CENTERVALUE`, `VALUES` (flat's leader-line labels; one part: inside),
  `THIN`/`XTHIN`/`THICK` donuts. `3D`, `VOLUME`, `STARBURST`, `RAYS`/`FLOWER`, `BOW`, `ZOOM` are
  noted in the console and drawn as a flat pie. `AGGREGATE` and `CATEGORICAL` (`EXACT`) pies: a pie
  per position (or aggregation grid cell, `RELOCATE`), a slice per category of the value field
  (`style.values`; other values count in the pie's size only) or per value field, slices summed
  (`SUM`, `MAX`/`MIN`, `MEAN`, `FIRST`/`LAST`, `AUTO100`), sized by the summed size field, legend
  rows summed per category; `GRIDSIZE`, `AUTOSIZE`, `DOPACITY`, the chart box/title and field100
  arithmetic on them are noted in the console, not ported
- **CHART\|VECTOR / CHART\|BEZIER** — flow lines from an item's position to its second one
  (`binding.position2` / `style.lookupfield2`: a key joined to the FEATURE shapes like `position`,
  or `"lat|lon"` fields), per record or `AGGREGATE`d per origin–destination pair (`SUM`, `MAX`,
  `MIN`), as flat draws them: BEZIER's curve (`rangescale` bow, `SHORT`, `GAP`, `REVERSE`,
  `RANDOM`), width by the size (`sizepow`, `normalsizevalue`) or `linewidth`, `POINTER`/`ARROW`
  heads (`markersize`), `GRADIENT`/`FADEIN`, `DOPACITY`/`DOPACITYMIN`, static `DASH` dashes; colored
  by `linecolor`, `colorfield` or the `CATEGORICAL`/`EXACT` category; densified, so they follow the
  globe. `VALUES` text along the curve, `DYNAMICWIDTH`, `LONG` and the dash animation are noted in
  the console, not drawn. `3D` (ixmaps-gl only; flat draws its flows flat) lifts each flow into an
  arc above the map — both ends on the ground, the top at `archeight` (default 0.3) times the
  flow's length; tilt the map with `.options({pitch: 60})` (and `bearing`, degrees) or by dragging
  with the right mouse button
- **CHART\|BAR** (and `BARS`) — a bar chart per record or, with `AGGREGATE`/`CATEGORICAL`, per
  item (aggregated as the pies), a bar per value field or category, as flat draws it: width and
  length by `SIZE` (size field or the values' sum, `sizepow`), `normalsizevalue`, `rangescale`,
  `COMPRESS`/`EXPAND`; `HORZ` (to the right, the first bar on top), `STACKED` (one column, values on
  leader lines with their share), `SORT`, `UP`, `CENTER`, `SPACED`, `THIN`/`THICK`, `NOZERO`,
  `NONEGATIVE`/`ONLYNEGATIVE`, `LEFT`; negative bars; `POINTER`/`ARROW` pointers (sized by the
  value with `SIZE`, negative ones pointing down in `fadenegative`), `OFFSETMEAN`/`OFFSETMEDIAN`/
  `DEVIATION`; `VALUES` (beyond the bar or inside it, `valuedecimals`, `units`, `DTEXT`,
  `VALUEBACKGROUND`/`CTEXT`), `FADEIN`/`FADENEGATIVE`, `fillopacity`/`linecolor`/`linewidth`;
  `BOX` and `TITLE`. `3D`, `VOLUME`, `COLUMN`, `DOTTED`, `TRENDLINE`, the `XAXIS` labels, `ZOOM` and
  field100 arithmetic are noted in the console and drawn as plain bars (`SMALLARROW` as `ARROW`)
- **DOT** — the simplest base symbol (fixed-radius, unclustered points)
- **PLOT** — a small line/area chart per item over its value fields (flat's per-item PLOT
  geometry: first point at the item, `scale`/`rangescale`, FIXSIZE markers), or one per grid
  cell with `GRIDSIZE` (a categorical field's series, e.g. one value per year)
- A native interactive legend (default bars, `SIMPLELEGEND`, `COMPACTLEGEND`,
  `NOLEGEND`, `TEXTLEGEND`; light/dark color themes; corner or flat `align` option;
  collapsible, collapsed by default on narrow/mobile screens). As flat's `#map-legend` it is one box:
  the themes' legends one after the other in theme order, leaving out a theme hidden or out of scale;
  a range theme of 5 classes or more without `label` gets flat's one-line color bar (with DOPACITY and an
  alpha field, flat's three-row opacity grid); `style.label` names the classes; the opacity slider comes
  with the type word `CHOROPLETH`, the size slider with `CHART`/`BUBBLE`/`DOT`, as in flat
- A standard facets API (`ixmaps.data.getFacets`/`showFacets`,
  `window.__setFacetFilter`) for building filterable sidebars
- Globe (orthographic) projection alongside flat Mercator

Not yet implemented: plain (non-AGGREGATE) `CATEGORICAL` choropleths, and the `QUAD`/
`WAFFLE` base types, and SYMBOL shape variants beyond
circle/square/diamond/triangle. See the top-of-file comment in
[`ixmaps-gl.js`](./ixmaps-gl.js) for the exact, currently-accurate scope note.

### Page scripts, named data and the runtime API

A page's `.require(url)` scripts (page code, e.g. a user chart function) load in order before the
layers are built. `ixmaps.map()` is the map handle as in flat — its calls wait until the map is ready —
with `add(theme, flags)` / `replace` / `replaceTheme` / `remove`, `changeThemeStyle` for any style key,
`getZoom()` (flat's zoom), `resize()`, `attribution(text)` (the page's attribution, bottom left on the map as in flat, in the style of the basemap credit and on its line — also
`.attribution()` on the builder, the `attribution` map option and `ixmaps.setAttribution(text)`; the basemap's credit stays bottom right), `setBasemapOpacity` and `setMapType(id)` (also `setMapTypeId`, `mapType`: a basemap name reading dark/black/night/matter loads CARTO Dark Matter, any other name CARTO Positron, a color a plain background — the same rule the `mapType` option follows at start); the page's `htmlgui_onNewTheme(id)` and
`htmlgui_onZoomAndPan()` (also once on load) are called (as in flat, a theme swapped in with `replace` comes last
in the legend, while FEATURE and CHOROPLETH shapes always draw under the charts), and `map`, `getZoom` and flat's
`formatValue` exist as globals. `.data({name})` without a URL waits for data of that name: from
`ixmaps.setExternalData(data, {name})`, or from a broker — `.data({query, name, type: "ext"})`
registers the query function as `ixmaps[name]` and calls it with flat's options (`ext`, `theme`,
`setData`); a theme reloads when new data of its name arrives. Charts on a FEATURE layer are placed
as in flat: joined by `lookup` (`lookupdigits`, `lookuptonumber`, `lookuptoupper`), the first shape of
an id wins, a polygon's position is flat's shape center (the vertex mean in Mercator), a theme on
`"a|b"` is placed on each layer (with `DIFFERENCE`, on the last). `aggregationscale` (alias of
`aggregation`) picks px, meters or a grouping field by scale on flat's grid origin; `chartupper`/
`chartlower` (else `layerupper`/`layerlower`) hide a theme outside their scales; `.filter()` takes
flat's grammar (`WHERE a > 5 AND b NOT x`, `LIKE`, `IN`, `BETWEEN`, `$field$`, or a plain regex).

### Handle API

The main interface is flat's handle chain: `ixmaps.map()` — or `ixmaps.map("name")` for the map
with that `name` in its `Map()` options, so several maps on one page can be addressed separately
(no name: the last built map, as in flat). From the map handle, `map("name").theme("themename")`
returns the theme handle (flat's `themeApi`):

```js
ixmaps.map("map1").theme("mytheme").changeStyle("scale:1.2", "factor");
ixmaps.map().theme("mytheme").show();  // also hide(), toggle(), remove(),
                                       // replace(theme), markClass(n), unmarkClass(n)
```

Projection changes never need the project machinery: `map().setProjection("globe")` (or `"mercator"`)
swaps the MapLibre projection and rebuilds the projection-dependent layers — themes, data and the
current view are never touched (unlike `setProjectJSON`, which re-defines every theme to change
the projection and, without `"keepview"`, resets the view).

`CHART|USER` themes (a page's own `userdraw` chart function) render as live SVG in a pane over
the map, as flat renders them — vector-crisp at every zoom, labels as real text, following every
pan via transform-only updates (≈3ms for 8,000 charts). Picking/tooltips run on a transparent
deck layer at the same positions.

The historic global forms remain as compatibility wrappers and dispatch on arity: the canonical
theme-first `ixmaps.changeThemeStyle(themeId, "style:value", "set")` and `ixmaps.removeTheme(id)`
(htmlgui.js), the handle method `map().changeThemeStyle(theme, style, flag)`, and the older
map-first pages calling `ixmaps.changeThemeStyle(null|mapName, themeId, style, flag)` /
`ixmaps.removeTheme(null|mapName, id)` / `ixmaps.setBasemapOpacity(null|mapName, opacity, mode)`
— where a registered map name targets that map and a null or unknown name the last built one.
The `ixmaps.Map(div, opts, callback)` callback receives the builder for its own
`.options().view().layer()` chain, which also carries flat's mapApi handle methods
(`setView`, `replace`, `show`, `getThemes`, … — htmlgui_flat.js), each delegated to the handle
of that map's options name — so a page that keeps the callback object as its map handle,
as flat pages do, works unmodified.

### Zoom levels

Zoom numbers in the ixmaps API are ixmaps-flat's, i.e. Leaflet's (256px tiles):
`.view({center, zoom})`, `view([lat, lng], zoom)`, the `zoom` of a project map
(`loadProject`/`setProjectJSON`) and the `zoom` `getProjectString()` returns. MapLibre
works on 512px tiles, so ixmaps-gl shows ixmaps zoom *z* at MapLibre zoom *z* − 1 — the
same area a flat page shows. Map scales (`aggregation`, `valueupper`, `featureupper`/`featurelower`
and `boxupper`/`boxlower` thresholds, `normalSizeScale`) are computed from the zoom that is
actually displayed; the `normalSizeScale` option key is matched in any spelling
(`normalsizescale`), as flat does. Code that talks
to the MapLibre map directly (`api.map.getZoom()`, `jumpTo`) sees MapLibre zooms.

Flat's Equal Earth and Winkel world maps (`map: ".../generic/equalearth.svg"`, `winkel.svg`) are
drawn in Mercator, but framed and scaled as flat shows them: flat fits its Leaflet view's bounds
into the projected map, so the same zoom shows a different area there (Equal Earth at zoom 2:
1.55× the Mercator scale). ixmaps-gl converts every API zoom to the MapLibre zoom with the same
pixels per degree of longitude at the view's center, and back, and sizes dynamically scaled
symbols (`objectscaling: "dynamic"`) from flat's own map scale for that map file.

### Theme normalization

Every layer definition passes through one pure function, `normalizeTheme()`, before any
renderer sees it. Its input has real ixmaps-flat's theme-definition shape (`{layer, data,
binding, style: {type, filter, title, …}, meta}` — the same shape as a theme in a flat
project JSON), and every alias rule lives there: `BUBBLE` implies `SYMBOL`, `geo` is read
as `position`, `.title()` is the legend-title fallback, and all of real ixmaps-flat's
binding aliases resolve to their targets (`values`/`fields`/`field` → `value`,
`sizefield` → `size`, `itemfield` → `id`, `text`/`valuefield` → the value-label field, …),
also when given as a style key (`.style({sizefield})` ≡ `.binding({size})`, as in flat).
flat's single lookup field (`geo`, `position`, `lookup`, `georef`, `lookupfield`, …) is read
by flat's own rule: `"lat|lon"` → points; `"geometry"` or GeoJSON/TopoJSON data → the
features' own geometry; any other single field on tabular data → a join key against the
same-named FEATURE layer — so a flat-style choropleth `.binding({geo: "code"})` works.
And as in flat, `.meta()` is merged into style first (meta wins): a style property given in
`.meta()` applies, and the meta keys (`title`, `tooltip`, `name`, `snippet`, `description`)
work when given in `.style()` too. The layer builder has all of flat's methods, including
`.field()`, `.field100()`, `.geo()`, `.lookup()`, `.encoding()`, `.query()`, `.process()` and
`.json()`; each writes the slot flat writes. Repeated `.binding()`, `.style()` and `.meta()` calls merge, as in flat
(a later value for the same key wins). The style keys read as numbers (`fillopacity`, `linewidth`, `scale`, `classes`,
…) are typed here once: `"0.8"` becomes `0.8`, also in runtime style changes (`setThemeStyle`, the legend sliders),
while anything that isn't a plain number (`"auto"`, `"12px"`) stays as given.
A page's own data processing function (`.data({process})` or `.process()`, as a function or
its `toString()`) runs like in flat: after loading, it gets the data as a data.js Table
(`column()`, `addColumn()`, …) and returns it, or nothing to keep the changed table.
The alias table is generated from the shared grammar (`test/sync-grammar.mjs`); targets
this engine doesn't implement yet (`colorfield`, `timefield`, `titlefield`, …) are resolved
but unused. It never mutates the page's own objects. Unit tests: `cd test && npm run unit`.

### World copies

At an extreme zoom-out MapLibre repeats the world side by side, and the themes are repeated on
every copy (flat repeats only its basemap tiles). `.options({worldcopies: false})` draws the
world once, but MapLibre then also stops the zoom-out where the world gets narrower than the
window.

### Data formats and data.js

Like flat, ixmaps-gl loads the real [data.js](https://github.com/gjrichter/data.js) by default
(from flat's CDN URL, alongside MapLibre and deck.gl), unless the page has it already;
`.options({datajs: url})` loads another build, `.options({datajs: false})` none. It reads every
`.data({url, type})` format data.js knows — `csv`, `json`, `jsondb`, `jsonstat`, `ndjson`/`jsonl`,
`rss`, `kml`, `gml`, `geobuf`, `pbf`, `flatgeobuf`/`fgb`, `geopackage`/`gpkg`, `parquet` — and hands
the table to `.data({process})`, `.data({query})` and project scripts, as flat does. A data.js geo
format comes as a table with a `geometry` column; `.binding({geo: "geometry"})` turns it into
points, lines or polygons. GeoJSON and TopoJSON are read by ixmaps-gl itself (features directly),
and without data.js CSV falls back to ixmaps-gl's own parser (same rows, ~10 % faster on 1.2M rows).

### Loading ixmaps-flat project files

`map.loadProject(src, flags)` (and the global `ixmaps.loadProject` / `ixmaps.setProjectJSON`)
loads a real ixmaps-flat project — an object, a JSON string or a URL — the way flat's own
`setProjectJSON` does: the map part (projection from flat's map file, `center`/`zoom`,
`options`) and then the themes, in order; without `add` the first theme clears the existing
ones, `replace` swaps themes by `style.name`/`meta.name`, `themeonly`/`maponly`/`keepview`
work as in flat. Themes in flat's older shape (data source in `style.dbtable*`, value field at
the top level) are translated first. It resolves to `{ themes, skipped, notes }`: a theme
that can't load is skipped with a warning, the rest still load. **Code a project names is not
run by default** — `required` scripts, `ext` data scripts and a project's `process` and `query`
functions and function-string `colorscheme`s are reported, not executed (only a page's own
`.data({process, query})` and colorscheme functions run) — and the basemap isn't switched.

A page can opt in to a project's **scripts** (`data.ext`) for script URLs under prefixes it lists —
no built-in prefixes, and a project file's own `options.trustedscripts` is ignored. Both of flat's
script contracts work: a **processing script** on a loaded file (`ixmaps.<data.name>.after` /
`.process(table, options)`), and a **broker** (`data.type: "ext"`), which loads the data itself in
`ixmaps.<data.name>(theme, options)` and hands it over with `ixmaps.setExternalData(data, {type, name})`:

```js
ixmaps.Map("map_div", {...}).options({
  trustedscripts: ["https://gjrichter.github.io/viz/", "https://raw.githubusercontent.com/gjrichter/"]
})
```

Prefixes match whole path segments; relative script paths resolve against the page. Data is parsed
by data.js, and a script runs right before its own theme loads. The
theme properties a broker sets from its data (flat's `szFields`, `szField100`, `szSnippet`,
`szTitle`, `szLabelA`, `setProperties()`, …) are applied to the theme, where flat's own style keys
would put them. As in flat, a broker whose function the page itself already defines
(`ixmaps.<name>`, page code — no opt-in needed) is called directly, and gets `data.ext` (or the
`data.url`) as `options.ext`, its data URL; only otherwise is `data.ext` loaded as the broker's
script. For brokers that query by view, like flat's bbox data providers, ixmaps-gl has flat's
`ixmaps.getBoundingBox()`, `ixmaps.refreshTheme(id)` (loads the theme's data again, in place),
`ixmaps.setTitle(html)`/`setTitleBox(text, color)`, `ixmaps.getThemeObj(id).fVisible` (false for a
FEATURE theme out of scale) and calls a page's `ixmaps.htmlgui_onZoomAndPan(zoom)` after each zoom
or pan — and also during a zoom, at the pace of the layer refresh (about every 150 ms, zoom changes only),
so zoom-dependent page state (e.g. a basemap opacity ramp) changes in step with the scale gates
(`featurelower`, `chartupper`, …) instead of after the gesture has ended. Scripts that reach further into flat's internals (`ixmaps.parentApi`, other `htmlgui_*`
hooks) aren't supported. `test/project-report.mjs` shows which themes
of your own project files gl can render.

## Quick start

Load the engine from jsDelivr, pinned to a release tag (or `@main` for the latest commit):

```html
<script src="https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-gl@v0.2.23/ixmaps-gl.js"></script>
```

or from unpkg, the npm package [`ixmaps-gl`](https://www.npmjs.com/package/ixmaps-gl)
(`https://unpkg.com/ixmaps-gl` for the latest version; `npm install ixmaps-gl` installs the same
browser script, which defines the global `ixmaps`):

```html
<script src="https://unpkg.com/ixmaps-gl@0.2.23/ixmaps-gl.js"></script>
```

or use a local copy (`<script src="ixmaps-gl.js"></script>`). A minimal page:

```html
<script src="https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-gl@v0.2.23/ixmaps-gl.js"></script>
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

See [`demo_accidents.html`](./stage/demo_accidents.html) for a minimal working page copied
verbatim (config included) from a real ixmaps page — the only change is which script
provides `ixmaps.layer`/`ixmaps.Map`.

## Grammar validation (opt-in)

ixmaps-gl can check every theme definition against the shared ixmaps grammar
([ixmaps-grammar](https://github.com/gjrichter/ixmaps-grammar), extracted from the real
ixmaps-flat sources) and report — once per keyword, in the browser console — typos and
features this engine doesn't implement:

```text
[ixmaps-gl validate] error unknown-style-key — layer "points": unknown style key "fillOpacity" — did you mean "fillopacity"?
[ixmaps-gl validate] warning gl-unsupported — layer "waffle": type flag "WAFFLE" is not implemented by ixmaps-gl
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
| [`demo_accidents.html`](./stage/demo_accidents.html) | Minimal quick-start example |
| [`accidents_app.html`](./stage/accidents_app.html) / [`germany_accidents_app.html`](./stage/germany_accidents_app.html) | Full app with a facets sidebar (standard facets API) |
| [`global_power_plants_world_map.html`](./stage/global_power_plants_world_map.html) | Native legend, globe projection toggle |
| [`global_power_plants_sidebar.html`](./stage/global_power_plants_sidebar.html) | Same dataset with a facets sidebar instead of the native legend |
| [`mappa_stranieri_30.html`](./stage/mappa_stranieri_30.html) | Symbol shapes, city picker, runtime `changeThemeStyle` filtering, light legend theme |
| [`roma_incidenti_pericolosita_sidebar_gl.html`](./stage/roma_incidenti_pericolosita_sidebar_gl.html) | AGGREGATE on a gridwidth grid, facets sidebar |
| [`roma_incidenti_pericolosita_sidebar.html`](./stage/roma_incidenti_pericolosita_sidebar.html) | The same page on the **real** ixmaps-flat engine, kept for side-by-side reference |
| [`uk_collisions_2023.html`](./stage/uk_collisions_2023.html), [`app/ixmaps-loader_70.html`](./app/ixmaps-loader_70.html) | Additional real-page compatibility tests |
| [`examples/`](./examples) | Smaller feature-by-feature test pages (choropleth classing modes, bubble ranges, etc.) |

Serve any of these with a static file server (they fetch remote data over HTTPS, so
`file://` won't work for most):

```bash
python3 -m http.server 8000
```

## Testing

[`test/`](./test) holds an output-regression harness: it loads every example and real-page
test in headless Chromium, records what the engine produces (every deck.gl layer's
per-item accessor output, each theme's class breaks and colors, legend and tooltips) and
compares it against committed baselines, so a refactor that changes any output is caught
with the exact layer and field.

```bash
cd test && npm install && npm test
```

See [`test/README.md`](./test/README.md).

## License

BSD 3-Clause — see [`LICENSE.txt`](./LICENSE.txt).
