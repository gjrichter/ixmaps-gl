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

Not yet implemented: the `QUAD`/`WAFFLE` base types. SYMBOL shapes: the built-in ones and image-URL
symbols are described under [Symbols](#symbols).
The top-of-file comment in [`ixmaps-gl.js`](./ixmaps-gl.js) is the single source of truth
for scope; this list only summarises it.

### Page scripts, named data and the runtime API

A page's `.require(url)` scripts (page code, e.g. a user chart function) load in order before the
layers are built. `ixmaps.map()` is the map handle as in flat — its calls wait until the map is ready —
with `add(theme, flags)` / `replace` / `replaceTheme` / `remove`, `changeThemeStyle` for any style key,
`getZoom()` (flat's zoom), `resize()`, `attribution(text)` (the page's attribution, bottom left on the map as in flat, in the style of the basemap credit and on its line, dark on a dark map like the zoom buttons — also
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

At an extreme zoom-out MapLibre repeats the world side by side. The themes are drawn once, as in
flat (which repeats only its basemap tiles): the map pans freely past the world's edge, with empty
space beside it. `.options({themecopies: true})` (also at runtime) repeats the themes on every world
copy. `.options({worldcopies: false})` draws the world once for the map itself, but MapLibre then
also stops the zoom-out where the world gets narrower than the window.

### Map events, bounds and the MapLibre map

`map.on("zoomend moveend", fn)` (flat's `mapApi.on`; on the builder chain, the callback object or
`ixmaps.map()`) fires:

| event | when | handler receives |
|---|---|---|
| `ready` | the map has loaded (called at once if it already has) | `{type, szMap}` |
| `viewchange` (`zoompan`) | after every pan or zoom | `{type, szMap, nZoom, zoomChanged, panChanged}` |
| `zoomend` / `moveend` | the zoom changed / the centre moved without a zoom change | as `viewchange` |
| `click` (`itemclick`) | an item was clicked — every item, also of a theme bound by geometry only | `{type, szMap, szId, id, theme, record, lngLat, point}` |
| `mapclick` | any click on the map, background included (gl addition) | `{type, szMap, lngLat: {lng, lat}, point: {x, y}}` |
| `layerdraw` (`drawtheme`) | after every redraw, once per theme | `{type, szMap, szId, id}` |

`szId` is `theme::key` and `id` the key: the theme's selection field value (the `id`, position or lookup
field), else the feature's `id`, else its position `"lng,lat"`; `record` is the item's data record (gl
addition). `szMap` is the map's `name` option, or `null`. flat's `frozenDynamic` is not provided.
`map.off("click", fn)` removes a handler, as in flat; several event names may be given, separated by
spaces, and the names in brackets are flat's aliases.

Differences from flat: `layerdraw` fires for every theme on every redraw, panning included (flat: once per
theme as it is drawn); `ready` means the MapLibre map has loaded, themes may still be loading; view events
fire when a movement ends, not during it. The other flat event names (`mouseover`/`itemover`,
`mouseout`/`itemout`, `resize`, `layeradd`/`newtheme`, `layerremove`/`removetheme`) are accepted but never
fire; the console says so once. `ixmaps.onItemAction(null, null, {lngLat, point})` gets the click position on
a background click as a third argument; it is still called for items only when the theme has a selection
field.

`ixmaps.map().getBounds()` returns flat's `[swLat, swLng, neLat, neLng]` (`ixmaps.getBoundingBox()`
the same box as `[{lat, lng} SW, {lat, lng} NE]`); `ixmaps.map().getMapLibre()` returns the MapLibre
map itself, or `undefined` until it is built.

### Click to action

flat's click-to-action (`ui/js/tools/tooltip_to_action.js`, e.g. a click on a country filters every
theme of the page to it) works as on flat: on a click on an item the engine calls the page's
`ixmaps.onItemAction(szId, item, themeObj)`, `item.szSelectionId` being the value of the theme's
selection field, and `ixmaps.onItemAction(null, null)` on a click on the map background. The
selection field, `getThemeObj(id).szSelectionField`, is the `id` binding, else the position (or
lookup) field; an aggregated item gives its first record's value. The flat script's own
`htmlgui_onItemClick`, which reads flat's SVG, is not called — the page only needs
`.require(".../tooltip_to_action.js")` (or its own `ixmaps.onItemAction`). The click still pins the
tooltip. See [`ports/index_embed_migration - Zeit online data - 2015-2020 - click2filter.html`](./ports/index_embed_migration%20-%20Zeit%20online%20data%20-%202015-2020%20-%20click2filter.html).

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

### Symbols

`CHART|SYMBOL` draws one symbol per item (per category with `CATEGORICAL`, per part with `SEQUENCE`).
`style.symbols` names them, by color class: class `i` (the `i`-th entry of `values`, else the range
class) takes `symbols[i]`, and the last entry repeats when the array is shorter than the classes.

- **Built-in shapes:** `circle` (default), `square`, `diamond` (= `carot`), `triangle`, `roundrect`,
  `hexagon`, `cross`, `label`, `empty`. An unknown name draws a circle.
- **Image symbols:** a URL ending in `.svg`, `.png`, `.jpg` or `.jpeg` (a query or `#` may follow), or a
  `data:image/svg+xml|png|jpeg` URI. The image is drawn as is, not tinted by the class color. An SVG is
  fetched and rasterized once per URL (a `viewBox` is enough, it needs no width/height); a PNG/JPEG is
  loaded by deck.gl. A page opened from `file://` cannot fetch symbol files: serve it over http(s) or use
  `data:` URIs.
- **By record field:** `symbolfield: "type"` with `symbolvalues: ["a", "b"]` maps the value of that field
  to `symbols[i]` by position, independent of the color class (for individual items, not aggregated cells).

```js
.type("CHART|SYMBOL|CATEGORICAL")
.style({ values: ["school", "shop"], colorscheme: ["#d9534f", "#428bca"],
         symbols: ["icons/school.svg", "icons/shop.svg"] })
```

### Zoom gates: `chartupper` and `chartlower`

`style.chartupper` / `style.chartlower` (`layerupper` / `layerlower` when unset) take a scale `"1:N"`. The
theme is **hidden when zoomed out beyond `chartupper`** (the scale denominator is above N) and **hidden when
zoomed in to `chartlower` or closer** (the scale denominator is at or below N). So `chartlower: "1:20000"`
shows the layer only while the view is zoomed out past 1:20000, and `chartupper: "1:20000"` only from there on
in. The scale is flat's, about `442913385 / 2^z` for the zoom `z` you give `.view()` on a Mercator map:

| zoom | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|---|---|---|---|---|---|---|---|---|
| scale 1: | 432533 | 216266 | 108133 | 54067 | 27033 | 13517 | 6758 | 3379 |

`featureupper`/`featurelower` gate FEATURE themes the same way, `glowupper`/`glowlower` the glow halo.

### Aggregation grid and symbol size

`AGGREGATE` groups items into grid cells. The cell size is read, first match wins, from:

1. `aggregation` (flat's alias `aggregationscale`): scale/width pairs, e.g. `["1:1", "3px", "1:500000", "1px"]`,
   the width of the last pair for which the view is zoomed out past `1:N` (the example gives 3 px, and 1 px once
   the view is zoomed out past 1:500000); `"Npx"` is screen pixels, a bare number meters
2. `gridwidthpx`: screen pixels, constant over zoom (the recommended spelling for a fixed cell)
3. `gridwidth: "Npx"`: the same, as a string
4. `gridwidth: N` (a bare number): meters, the same cells at every zoom
5. none of them: no grid, items stay at their positions

With `CATEGORICAL|COUNT` and no size field the size of a symbol follows the number of records in its cell:
radius = `15 px × scale × (count / normalsizevalue)^(1/sizepow)`, scaled with the zoom (`objectscaling`) and
clamped to a minimum and maximum radius.
`normalsizevalue` is the count drawn at normal size, the dataset's maximum when unset. A `normalsizevalue` of
`30` therefore draws a single-record cell at 1/30 of the normal radius: pick it near the biggest cell you expect.

### Basemaps (`mapType`)

`mapType` is resolved in this order; a name that matches nothing falls back to the last two rules, so an
unknown flat name such as `VT_TONER_LITE` draws CARTO Positron:

| `mapType` | style |
|---|---|
| `ArcGIS - Topo` (`terrain`), `ArcGIS - Light Gray Base`, `ArcGIS - Ocean Basemap`, `ArcGIS - Hillshade` | Esri raster tiles |
| `CARTO - Voyager` (`VT_VOYAGER`), `CARTO - Voyager (no labels)` (`VT_VOYAGER_LIGHT`), `CARTO - Positron (no labels)`, `CARTO - Dark Matter (no labels)` | CARTO vector styles |
| `OpenFreeMap - Liberty`, `OpenFreeMap - Bright`, `OpenFreeMap - Positron` | OpenFreeMap vector styles |
| any name containing `dark`, `black`, `night` or `matter` | CARTO Dark Matter |
| everything else | CARTO Positron |

### Adding and replacing themes at runtime

`ixmaps.map().add(theme, "replace")` adds the theme the first time and swaps it on later calls, matched by
the theme id, `style.name` or `meta.name`. Give the theme a `name` in `.meta()`: the name passed to
`ixmaps.layer("name", …)` is not the id, and without one `"replace"` cannot find the old theme and adds a second. `ixmaps.map().remove(id)` removes it.

### Theme tools add-on (right-click menu)

As in ixmaps-flat, every map has a context menu. Its code is a separate file,
[`ixmaps-gl-tools.js`](./ixmaps-gl-tools.js), which the engine loads from the same folder as `ixmaps-gl.js` (so
the CDN copy of the same version when the engine comes from the CDN) on the first right-click on a map, not
with the map; Ace and the grammar registry load only when edit or config first opens. The map option
`themetools` changes this:

```js
ixmaps.Map("map_div", { mapService: "leaflet_vt", themetools: false }, map => …) // no tool bar
ixmaps.Map("map_div", { themetools: "https://example.org/ixmaps-gl-tools.js" }, …) // the add-on from there
```

(MapLibre keeps the browser's own menu off the map either way, for right-drag rotation.) A page can also load
the add-on itself, after the engine and before its own map script; the engine then loads nothing:

```html
<script src="ixmaps-gl.js"></script>
<script src="ixmaps-gl-tools.js"></script>
```

A right-click without dragging opens a tool bar;
right-drag still rotates the map. **tune** opens a dialog for the theme under the cursor (otherwise the
topmost chart or choropleth theme, with a picker when the map has several):

- sliders that change the style live: size (`scale`), opacity (`fillopacity`), `linewidth`, value label size
  (`valuescale`, VALUES themes), glow strength (`opacity`, GLOW themes) and the aggregation width (AGGREGATE
  themes: a factor of the original `aggregation` brackets, `gridwidthpx` or `gridwidth`), plus `shadow`
- switches for the GLOW, VALUES and AGGREGATE flags; they rebuild the theme, keeping the tuned style and its
  place in the stack
- Reset rebuilds the theme as it was when first tuned

CHOROPLETH and FEATURE themes get opacity and line width.

**edit** shows the theme's definition (`layer`, `data`, `binding`, `style` with its `type`, `meta`, including
the values tuned since) as JSON in a code editor. The editor is [Ace](https://ace.c9.io), loaded from cdnjs
the first time edit opens; until then, or offline, it is a plain text box. Inline data (`data.obj` and other
large values under `data`) and functions show as `"<kept: data.obj — 120 features>"` strings and are put
back on Apply. Apply (or Ctrl/Cmd+Enter) rebuilds the theme in its place in the stack; a JSON syntax error is
shown with the cursor at it, and nothing is applied. Revert rebuilds the theme as the editor first showed it.
Set `ixmaps.themeTools.aceUrl` before the first edit to load Ace from elsewhere.

**config** is the complete theme configurator, in six tabs; Apply rebuilds the theme, Revert goes back to it as
first shown:

- **visual** (the first): the [Smart Data Loader](./app/ixmaps-loader_70.html)'s way of setting a theme, read
  from the theme on the map. A picker with the loader's visualizations and icons — dots, sized bubbles,
  hexbin, hexbin sized, heatmap, MapLibre heatmap, KDE — writes the loader's type, flags and style for the
  chosen one and keeps the theme's other flags, data and position (a theme's `aggregation` brackets wait while
  it is a hexbin, which takes its own grid). The value and size (or weight) fields are lists of the data's
  fields; a text value makes the theme `CATEGORICAL`, with its values and one color per value. The theme's
  colors are editable one by one, and about 110 palettes (the loader's and ixmaps-flat's, with swatches)
  apply with the theme's class count. Sliders for the chosen visualization (opacity, size, size ramp, grid
  width, heatmap radius and intensity, KDE bandwidth, line width; opacity, size and line width live) and
  switches for glow, aura, values and shadow. Choropleth and feature themes keep their kind (a choropleth's
  field switches it between `CATEGORICAL` and classed); other chart types (pie, bar, …) show as custom
- **type**: the kind (`CHART|BUBBLE`, `CHART|PIE`, `CHOROPLETH`, `HEATMAP`, …) and the flags, the common ones
  as switches by group (classification, aggregation, size, look, legend), any other one added from a list
- **style**, **binding**, **data**, **meta**: the common keys by group, with color pickers (one per color of a
  `colorscheme`), opacity sliders, the data's field names offered for binding fields and the data types for
  `data.type`; the theme's other keys below them, and any key added from a list. A value that does not parse
  (a number field with text in it) is marked and blocks Apply; an empty field removes the key

The lists of every key and flag come from the [ixmaps-grammar](https://github.com/gjrichter/ixmaps-grammar)
registry (`grammar.runtime.json`, loaded from jsDelivr the first time config opens; `ixmaps.themeTools.grammarUrl`
overrides it). Keys and flags the registry says ixmaps-gl ignores show in grey italics. Without the registry the
dialog shows the common keys only. Inline data and functions show as kept, not editable.

**save** downloads the map as a standalone HTML page (or copies its HTML): `ixmaps-gl` from jsDelivr at the
running version, `ixmaps.Map()` with the map's options (`getMapOptions()`: the `Map()` options with the current
`mapType`, and those set with `.options()`), the current view (center, zoom; bearing, pitch and the globe
projection after load) and one `ixmaps.layer(name, l => l.data().binding().type().style().meta())` per theme,
in stack order, as defined now — tune, edit and config changes included. Relative data URLs are made absolute
against the page; inline data is embedded up to about 2 MB, and a theme with more (or with data a page cannot
hold, e.g. a class instance) is left out with a comment. Functions are saved as their source, with a warning:
they may need code of the original page. The page's own code (panels, buttons, scripts) is not part of the
saved page. The file name comes from the title (`Injured (AREU)` → `injured_areu.html`).

The add-on also defines flat's `ixmaps.popupTools()`, `ixmaps.popupThemeEditor(themeId)` and
`ixmaps.popupThemeConfigurator(themeId)` unless the page has its own, and `ixmaps.themeTools.tune(themeId)` /
`.edit(themeId)` / `.config(themeId)` / `.save()` / `.close()`; `ixmaps.themeTools.mapHtml(title)` returns the
saved page's HTML of the last built map. Demo:
[`examples/theme_tools.html`](./examples/theme_tools.html).

### Text on labels

`CHART|LABEL` (with `TEXTONLY` for the text alone) writes the item's value. A text field bound as the *value*
reads as 0, as in flat, and shows nothing visible; the console says so once. To show a text, as in flat, keep a
numeric `value` (or `size`) binding and name the text field in `style.valuefield`, or `"$title$"` for the
`title` binding:

```js
.binding({ geo: "geometry", value: "count" })
.type("CHART|LABEL|TEXTONLY|VALUES")
.style({ valuefield: "name" })
```

With `CATEGORICAL` the value field holds the categories and `valuefield` names the text. The text is drawn as a
single-color glyph with a halo, so an emoji comes out as a monochrome silhouette (seen in a headless Chromium
test): use image symbols (see Symbols) for colored icons.

### Runtime filtering

A theme's records can be filtered in place, without redefining it, with flat's `changeThemeStyle`:

```js
ixmaps.changeThemeStyle("mytheme", 'filter:WHERE "type" = "school"', "set");
ixmaps.changeThemeStyle("mytheme", "filter", "remove");
```

The same through the handles, `ixmaps.map().changeThemeStyle(id, style, flag)` and
`ixmaps.map().theme(id).changeStyle(style, flag)`; with `null` as the id every theme but the FEATURE ones is
changed. The expression is flat's filter grammar: `WHERE field op value` clauses joined by `AND` with `=`, `!=`,
`<>`, `<`, `>`, `<=`, `>=`, `BETWEEN … AND …`, `IN (…)`, `LIKE` and `NOT` (see `test/unit/filter.test.mjs`).
(`npm run runtime` in `test/` checks these calls in a browser.)

### Porting a flat page

How the calls of a flat page map to gl; "tested" means `test/runtime.mjs` runs it in a browser.

| flat | gl |
|---|---|
| `ixmaps.Map(div, opts, function (map) { … })` | the same; the callback gets the map builder (`view`, `options`, `layer`, `on`, …) |
| `var myMap = ixmaps.Map(div, opts).view(…)`, `myMap.then(map => …)` | the same, `myMap` is the builder and a thenable |
| `myMap.layer("name").data(…)…define()` | the same, before and after the map is built (tested) |
| `myMap.layer(theme)`, `myMap.layer(theme, "direct")` after the map is built | the same (tested); up to v0.2.33 these silently added nothing |
| `ixmaps.map().layer(theme)`, `ixmaps.map().add(theme, "replace")` | the same (tested) |
| `ixmaps.changeThemeStyle(id, 'filter:…', "set")` | the same (tested), see Runtime filtering |
| `map.getBounds()` | `ixmaps.map().getBounds()`, from v0.2.33 |
| `map.on(event, fn)` | `map.on` / `map.off`, see Map events |
| `ixmaps.hideTheme(id)` / `ixmaps.showTheme(id)` | not provided: `ixmaps.map().theme(id).hide()` / `.show()` or `ixmaps.map().setThemeVisible(id, bool)` |
| `ixmaps.flyTo(…)` | not provided: `ixmaps.map().view([lat, lng], zoom)` |

### `CHART|USER` draw function

`style.userdraw` names a function (`ixmaps[name]`, or a dotted path on `window`). It is called as
`fn(document, opt)` for each chart, after an optional `name_init(document, {target, theme})` once per draw.
`opt` holds `target` (the SVG group to draw into), `theme`, `value`, `values`, `size`, `maxSize`, `color`,
`class`, `flag`, `ccolor`, `item` (`{szColor, szLabel, szTitle, nCount, nSize}`) and `dbRecord` (the item's data
record, also the place to read the category). `size` is in flat's chart units, `maxSize` (300) being the
normal radius: one unit is `15 px × scale × zoom factor / 300`. The chart is drawn around 0,0.

### Headless, CI and offline

A headless Chromium has no GPU: start it with `--use-gl=swiftshader --enable-unsafe-swiftshader
--ignore-gpu-blocklist`. deck.gl then logs "GPU stall due to ReadPixels", which is harmless. The engine loads
`maplibre-gl@6.11.2` (module and css) and `deck.gl@9.4.0` and `mustache@4.2.0` from unpkg, `data.js` from
jsDelivr (`gh/gjrichter/data.js`), and on demand `d3-array@3.2.4` and `d3-contour@4.0.2` (jsDelivr) and the
`ixmaps-grammar` validator; mirror these to run offline. Page-level script and data URLs are not
configurable yet.

## Quick start

Load the engine from jsDelivr, pinned to a release tag (or `@main` for the latest commit):

```html
<script src="https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-gl@v0.2.37/ixmaps-gl.js"></script>
```

or from unpkg, the npm package [`ixmaps-gl`](https://www.npmjs.com/package/ixmaps-gl)
(`https://unpkg.com/ixmaps-gl` for the latest version; `npm install ixmaps-gl` installs the same
browser script, which defines the global `ixmaps`):

```html
<script src="https://unpkg.com/ixmaps-gl@0.2.37/ixmaps-gl.js"></script>
```

or use a local copy (`<script src="ixmaps-gl.js"></script>`). A minimal page:

```html
<script src="https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-gl@v0.2.37/ixmaps-gl.js"></script>
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
| [`theme_tools.html`](./examples/theme_tools.html) | Theme tools add-on: right-click tool bar, live tune dialog, JSON theme editor, theme configurator, save as HTML page |
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
