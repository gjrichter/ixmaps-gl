# ixmaps-gl regression harness

Loads every page in [`pages.json`](./pages.json) in headless Chromium and records **what
ixmaps-gl produces**, not pixels, then compares it with the committed baselines. Any change
to the engine's output shows up as a named, per-field difference.

```bash
cd test
npm install                      # once — Playwright 1.62.1 (uses the cached chromium-1234)
npm test                         # unit tests, then compare all pages against baselines/
npm run unit                     # only the Node unit tests (pure engine internals, ~1 s)
npm run snapshot                 # re-write baselines/ after an INTENDED output change
node run.mjs --page choropleth   # only pages whose path contains "choropleth"
node run.mjs --engine ../x.js    # run the pages against another ixmaps-gl.js build
node run.mjs --jobs 4            # pages in parallel (default 2); a full run takes ~3 min
```

The first run needs network access: it records remote data into `.cache/` (see below).

## What a snapshot contains

For each page, at its initial view and at zoom +1 / −1 (aggregation depends on zoom):

- **every deck.gl layer** — id, type, item count, constant props, and every `get*` accessor
  (`getPosition`, `getFillColor`, `getRadius`, `getIcon`, `getText`, …) evaluated for
  **every item**, normalized (numbers rounded to 1e-6) and stored as SHA-256 digests per
  column, plus the first 20 rows and each column's min/max so a failure shows *what*
  changed. GeoJSON features also get a geometry signature (type, vertex count, first vertex).
- **every theme's computed state** — flags, feature counts, class breaks (`partsA`),
  category labels and colors, value min/max/median.
- **legend text**, the **tooltip HTML** of 3 fixed items per theme, the
  **validation report**, and page **console errors/warnings** (network and GPU-driver
  noise filtered out).

Pixels are deliberately not compared: anti-aliasing and live basemap tiles make pixel diffs
noisy, and they can't tell you which field changed.

A failure reads like this:

```text
FAIL  examples/choropleth_range_quantile.html
      [initial] ix-choropleth-comuni: getFillColor changed; e.g. item 1: [148,218,115] → [77,185,156]
      [initial] theme comuni.partsA: [{"max":2.2374,"min":0},…] → [{"max":2.1695,"min":0},…]
```

If only the order of items changed (same set), it says so separately: that's a draw-order
change, not a value change.

## Remote data: recorded once, then replayed

Every non-local request except basemap tiles, glyphs and sprite images (data files, and the
libraries from unpkg/jsDelivr) is recorded on first use into `.cache/` (git-ignored, ~300 MB,
mostly the German accident CSVs) and replayed on every later run, so a changed remote file
or a new release of an unpinned library (`maplibre-gl@5`) can't produce a false diff.
[`data-manifest.json`](./data-manifest.json) (committed) holds each URL's SHA-256; when a
fresh machine records a file whose hash differs, the run ends with a
`WARNING remote data changed` line. MapTiler URLs are stored without their per-load
session id (`mtsid`) and API key, so a style is recorded once and the manifest holds no
key. To test against current remote data and libraries,
delete `.cache/` and run `npm run snapshot`, then review the baseline diff.

## Equivalence pairs

`pages.json` → `equivalent` lists `[twin, original]` pairs: the twin writes the same map
with a different spelling (real ixmaps-flat's binding aliases, e.g. `fields`/`sizefield`
instead of `value`/`size`, or the size as a style key). Their whole output — every layer,
theme, legend and tooltip — must be identical, which checks that an alias really means the
same thing (`EQUIVALENT` / `NOT EQUIVALENT` at the end of a run). The check has teeth: run
against the engine from before the aliases existed, every twin fails.

## Skipped pages

A page that never calls `ixmaps.Map()` within 15 s is reported as `SKIP` (it needs user
interaction). That is only accepted for a page that never produced a map: a page that throws
before creating its map is an error, and a page whose baseline has views fails if it stops
producing one.

## Known-broken pages

`pages.json` → `knownBroken` lists pages that fail for a known, recorded reason. They still
run every time and are reported as `KNOWN`, not as failures; the runner says when one
starts working again. Currently none.

## How the harness was validated

Before its baselines were trusted: three consecutive full runs were identical (one with 5
pages in parallel); a mutated engine (`DOT_RADIUS_PX` 3 → 4) failed exactly the two DOT
pages with `prop getRadius 3 → 4`; a second mutation (`DEFAULT_RANGE_CLASSES` 5 → 6)
failed exactly the 7 pages that rely on the default class count, and none that set
`classes` explicitly; and the engine from before the splash-options fix (`dcda3a9`)
matched all baselines.

## Comparing with real ixmaps-flat (`--flat-oracle`)

```bash
node run.mjs --flat-oracle                 # all pairs in pages.json → flatOracle
node run.mjs --flat-oracle --page quantile # only pairs whose page paths contain "quantile"
```

Loads each `flat` page of a `{flat, gl}` pair on the **real ixmaps-flat engine**, reads the
classes flat computed from its own theme objects (`map.Themes.themesA`: breaks, colors,
value range) and compares them with the gl twin's baseline, pairing themes by base type in
definition order. For DOMINANT themes, whose `partsA` in flat is one count entry per field
rather than value classes, it compares the category count and the per-field mean, minimum
and standard deviation (`nMeanA`/`nMinA`/`nDeviationA`) instead. Writes `out/flat-oracle.md`. It is a report of differences (exit 0), not a
pass/fail test: each difference is decided on and fixed as its own change. The flat engine is
recorded into `.cache/` like any remote file.

## Project compatibility report

```bash
node project-report.mjs [file-or-dir ...]   # default: the local ixmaps-flat project folders
```

Runs every theme of every real ixmaps-flat project file (`*.json` with `themes`) through
the engine's `projectThemeToDefinition()` and `normalizeTheme()`, validates it against the
shared grammar for engine=gl, and checks what the grammar can't see: code a project names
(gl never runs it), missing data sources, joins to flat's own SVG map layers. Each theme is
`ok`, `partial` (renders; some modifiers ignored) or `blocked` (a missing chart shape/base
type, or one of those blockers). Writes `out/project-compat.md` with a ranking of what
blocks the most themes, and of what alone would unblock the most. Nothing is loaded or run.

## Files

| Path | |
|---|---|
| `pages.json` | page list, zoom steps, known-broken pages |
| `browser.js` | injected before page scripts: captures every `ixmaps.Map()` handle, takes snapshots |
| `run.mjs` | static server, data record/replay, settle detection, comparison |
| `unit/` | Node unit tests for pure internals (`normalizeTheme`, …) — the engine runs in a `vm` sandbox |
| `project-report.mjs` | compatibility report over real ixmaps-flat project files (see above) |
| `sync-grammar.mjs` | writes/checks ixmaps-gl.js's generated grammar sections (the binding-alias table) from the sibling ixmaps-grammar checkout; `npm run unit` fails on drift |
| `baselines/` | committed snapshots, one per page |
| `data-manifest.json` | committed URL → SHA-256 of recorded remote data |
| `.cache/`, `out/` | git-ignored: recorded data; this run's failed snapshots (`*.actual.json`) |
