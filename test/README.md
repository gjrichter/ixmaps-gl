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
`WARNING remote data changed` line. To test against current remote data and libraries,
delete `.cache/` and run `npm run snapshot`, then review the baseline diff.

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

## Files

| Path | |
|---|---|
| `pages.json` | page list, zoom steps, known-broken pages |
| `browser.js` | injected before page scripts: captures every `ixmaps.Map()` handle, takes snapshots |
| `run.mjs` | static server, data record/replay, settle detection, comparison |
| `unit/` | Node unit tests for pure internals (`normalizeTheme`, …) — the engine runs in a `vm` sandbox |
| `baselines/` | committed snapshots, one per page |
| `data-manifest.json` | committed URL → SHA-256 of recorded remote data |
| `.cache/`, `out/` | git-ignored: recorded data; this run's failed snapshots (`*.actual.json`) |
