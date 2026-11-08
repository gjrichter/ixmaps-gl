/**
 * ixmaps-gl-tools.js — optional theme tools for ixmaps-gl
 *
 * Load it AFTER ixmaps-gl.js and before the page's own map script:
 *
 *   <script src="ixmaps-gl.js"></script>
 *   <script src="ixmaps-gl-tools.js"></script>
 *
 * or leave it to the engine: as in flat, every map has the context menu, and
 * the engine loads this file (from next to ixmaps-gl.js) on the first
 * right-click. ixmaps.Map(id, { themetools: false }) turns that off, a URL
 * string loads the file from there.
 *
 * Every map the page then creates with ixmaps.Map() gets a context menu: a
 * right-click (without dragging — right-drag still rotates the map) opens a
 * small tool bar with three tools for the theme under the cursor (or the
 * topmost theme):
 *
 *   tune    sliders and switches that change the theme's style live: size,
 *           opacity, line width, value label size, glow strength, the
 *           aggregation grid width, shadow, and the GLOW / VALUES /
 *           AGGREGATE flags
 *   edit    the theme definition as JSON in a code editor (Ace, loaded from
 *           cdnjs the first time; a plain text box until then, or offline);
 *           Apply rebuilds the theme. Inline data and functions show as
 *           "<kept: …>" placeholders and are put back on Apply
 *   config  the complete theme configurator: first the Smart Data Loader's
 *           visualization picker, fields, palettes and sliders (Visual), then
 *           kind and flags, style, binding, data and meta, as form fields (common keys with color pickers,
 *           sliders, field-name lists), plus every other key and flag of the
 *           ixmaps-grammar registry (loaded from jsDelivr the first time);
 *           Apply rebuilds the theme
 *
 * The engine itself is unchanged: this file only uses what ixmaps.Map()'s
 * promise resolves to (the map's engine API: runtimes, refresh, replace).
 * It also defines flat's ixmaps.popupTools(), ixmaps.popupThemeEditor() and
 * ixmaps.popupThemeConfigurator(), unless the page has its own.
 *
 * BSD-3-Clause, same as ixmaps-gl.js.
 */
(function (global) {
  'use strict';

  const VERSION = '0.5.3';
  // the code editor, loaded on first use (ixmaps.themeTools.aceUrl overrides it)
  const ACE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.44.0/ace.js';
  // the theme grammar the configurator lists every key and flag from
  // (ixmaps.themeTools.grammarUrl overrides it)
  const GRAMMAR_URL = 'https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-grammar@v0.1.31/dist/grammar.runtime.json';
  const ixmaps = global.ixmaps;
  if (!ixmaps || typeof ixmaps.Map !== 'function') {
    console.warn('[ixmaps-gl-tools] ixmaps-gl.js must be loaded first — the theme tools are off');
    return;
  }
  if (ixmaps.themeTools) return; // loaded twice

  // ------------------------------------------------------------------ pure

  const num = v => (v == null || v === '' ? NaN : Number(v));

  // the theme's type words, as the engine's legend reads them
  function typeWordsOf(flags) {
    if (!flags) return '';
    if (flags.typeString != null) return String(flags.typeString);
    return [...flags].join('|');
  }
  const hasWord = (words, w) => new RegExp('(^|\\|)' + w + '(\\||$)').test(words);

  function themeKind(words) {
    if (/\bCHOROPLETH\b/.test(words)) return 'choropleth';
    if (/\bFEATURES?\b/.test(words)) return 'feature';
    if (/\bCHART\b|\bBUBBLE\b|\bDOT\b|\bSYMBOL\b|\bPIE\b|\bBAR\b|\bPLOT\b|\bLABEL\b/.test(words)) return 'chart';
    return 'other';
  }

  // The tune controls for a theme of these type words. Each:
  //   key    the style key it writes (or 'aggregation' for the grid factor)
  //   kind   'range' | 'factor' (a multiplier of the original) | 'check' | 'flag'
  //   live   true: rt.setStyle + refresh; false: the theme is rebuilt (flags)
  // Ranges: the engine reads most of these with `styleNum(x) || default`, so
  // 0 means "default" there — the minimums stay above 0.
  function controlsFor(words) {
    const kind = themeKind(words);
    const c = [];
    const range = (key, label, min, max, step, def, unit) => c.push({ key, label, kind: 'range', min, max, step, def, unit: unit || '', live: true });
    if (kind === 'chart') {
      range('scale', 'Size', 0.1, 5, 0.05, 1, '%');
      range('fillopacity', 'Opacity', 0.05, 1, 0.05, 1, '%');
      range('linewidth', 'Line width', 0.1, 10, 0.1, 1);
      if (hasWord(words, 'VALUES')) range('valuescale', 'Value label size', 0.2, 5, 0.05, 1, '%');
      // GLOW's strength is the theme's overall opacity (glowOpacityOf in the engine)
      if (hasWord(words, 'GLOW')) range('opacity', 'Glow strength', 0.05, 1, 0.05, 1, '%');
      if (hasWord(words, 'AGGREGATE')) c.push({ key: 'aggregation', label: 'Aggregation width', kind: 'factor', min: 0.25, max: 4, step: 0.05, def: 1, unit: '%', live: true });
      c.push({ key: 'shadow', label: 'Shadow', kind: 'check', live: true, hint: 'drawn for at most maxshadow (1000) symbols' });
      for (const f of ['GLOW', 'VALUES', 'AGGREGATE']) c.push({ key: f, label: f, kind: 'flag', live: false });
    } else if (kind === 'choropleth' || kind === 'feature') {
      range('fillopacity', 'Opacity', 0.05, 1, 0.05, kind === 'choropleth' ? 0.9 : 1, '%');
      range('linewidth', 'Line width', 0.1, 10, 0.1, 1);
    }
    return c;
  }

  // scales a numeric width ("30px", "500", 30) by f, keeping its unit
  function scaleWidth(v, f) {
    if (typeof v === 'number') return round3(v * f);
    const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(String(v));
    if (!m) return v; // a field name, or something else: left alone
    return round3(parseFloat(m[1]) * f) + (m[2] ? 'px' : '');
  }
  const round3 = x => Math.round(x * 1000) / 1000;

  // The style patch that sets the aggregation grid to f × the ORIGINAL
  // width. The engine takes the grid from (first match wins) an
  // aggregation / aggregationscale bracket array ["1:1","3px","1:500000",
  // "1px", …] — scale, width pairs — then gridwidthpx, then gridwidth
  // ("Npx" screen pixels, or a number in meters).
  function aggregationPatch(orig, f) {
    const p = {};
    for (const key of ['aggregation', 'aggregationscale']) {
      const a = orig[key];
      if (Array.isArray(a)) p[key] = a.map((v, i) => (i % 2 === 1 ? scaleWidth(v, f) : v));
    }
    if (orig.gridwidthpx != null && orig.gridwidthpx !== '') p.gridwidthpx = scaleWidth(orig.gridwidthpx, f);
    if (orig.gridwidth != null && orig.gridwidth !== '') p.gridwidth = scaleWidth(orig.gridwidth, f);
    // no grid at all: the engine draws no aggregation — start from 30 px
    if (!Object.keys(p).length) p.gridwidth = scaleWidth('30px', f);
    return p;
  }

  // A theme definition (LayerBuilder.definition() form: the type lives in
  // style.type) with the tuned style merged in and type flags switched.
  function patchedDefinition(def, styleSet, flagChanges, typeString) {
    const style = Object.assign({}, def.style || {}, styleSet || {});
    let words = String(style.type || typeString || '').split('|').filter(Boolean);
    for (const [flag, on] of Object.entries(flagChanges || {})) {
      words = words.filter(w => w !== flag);
      if (on) words.push(flag);
    }
    style.type = words.join('|');
    // AGGREGATE without any grid draws nothing different: give it one
    if (flagChanges && flagChanges.AGGREGATE && !style.aggregation && !style.aggregationscale
      && (style.gridwidth == null || style.gridwidth === '') && (style.gridwidthpx == null || style.gridwidthpx === '')) {
      style.gridwidth = '30px';
    }
    return Object.assign({}, def, { style });
  }

  // the value a range control shows: the style's, else the engine default
  function currentValue(style, ctl) {
    const v = num(style[ctl.key]);
    return Number.isFinite(v) && v > 0 ? v : ctl.def;
  }

  // ---- the edit dialog's JSON

  // a plain object or array (also from another realm), i.e. JSON can hold it
  const isPlain = v => Array.isArray(v) || (Object.prototype.toString.call(v) === '[object Object]'
    && (Object.getPrototypeOf(v) === null || (Object.getPrototypeOf(v).constructor || {}).name === 'Object'));
  const KEEP_JSON_CHARS = 2000; // larger values under `data` are kept, not shown

  function keptLabel(path, v) {
    let what = typeof v === 'function' ? 'function'
      : Array.isArray(v) ? v.length + ' items'
      : (v && Array.isArray(v.features)) ? v.features.length + ' features'
      : typeof v === 'string' ? v.length + ' characters'
      : (v && v.constructor && v.constructor.name) || typeof v;
    return '<kept: ' + path + ' \u2014 ' + what + '>';
  }

  // A theme definition as editable JSON. Functions, values JSON cannot hold,
  // and large values under `data` (inline data) become "<kept: path — …>"
  // strings; `kept` maps each such string back to its value.
  function toEditable(def) {
    const kept = new Map();
    const seen = new Set();
    const keep = (path, v) => { const s = keptLabel(path, v); kept.set(s, v); return s; };
    const walk = (v, path, inData) => {
      if (v === undefined) return undefined;
      if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return keep(path, v);
      if (typeof v === 'number' && !Number.isFinite(v)) return keep(path, v);
      if (v === null || typeof v !== 'object') {
        if (inData && typeof v === 'string' && v.length > KEEP_JSON_CHARS) return keep(path, v);
        return v;
      }
      if (!isPlain(v) || seen.has(v)) return keep(path, v);
      if (inData && path !== 'data') { // the values in data, not data itself
        let size = Infinity;
        try { size = JSON.stringify(v).length; } catch (e) { /* cyclic, or not JSON */ }
        if (size > KEEP_JSON_CHARS) return keep(path, v);
      }
      seen.add(v);
      let out;
      if (Array.isArray(v)) out = v.map((x, i) => { const w = walk(x, path + '[' + i + ']', inData); return w === undefined ? null : w; });
      else {
        out = {};
        for (const k of Object.keys(v)) {
          const w = walk(v[k], path ? path + '.' + k : k, inData || (!path && k === 'data'));
          if (w !== undefined) out[k] = w;
        }
      }
      seen.delete(v);
      return out;
    };
    const plain = walk(def || {}, '', false) || {};
    // the usual order, the type first in style
    const ordered = {};
    for (const k of ['layer', 'data', 'binding']) if (k in plain) ordered[k] = plain[k];
    if (plain.style) {
      ordered.style = {};
      if ('type' in plain.style) ordered.style.type = plain.style.type;
      Object.assign(ordered.style, plain.style);
    }
    for (const k of Object.keys(plain)) if (!(k in ordered)) ordered[k] = plain[k];
    return { text: JSON.stringify(ordered, null, 2), kept };
  }

  // Edited JSON back to a theme definition, the "<kept: …>" strings put back.
  // Returns { def } or { error, pos } (pos: character index, or null).
  function fromEditable(text, kept) {
    let v;
    try { v = JSON.parse(text); } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      return { error: e.message, pos: m ? Number(m[1]) : null };
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'the definition must be an object { layer, data, binding, style, meta }', pos: null };
    if (!v.style || typeof v.style !== 'object' || Array.isArray(v.style)) return { error: 'the definition needs a "style" object', pos: null };
    if (typeof v.style.type !== 'string' || !v.style.type.trim()) return { error: 'style.type must be the theme type, e.g. "CHART|BUBBLE"', pos: null };
    const back = x => {
      if (typeof x === 'string') return kept && kept.has(x) ? kept.get(x) : x;
      if (Array.isArray(x)) return x.map(back);
      if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) o[k] = back(x[k]); return o; }
      return x;
    };
    return { def: back(v) };
  }

  // ---- the config dialog: curated UI metadata over the ixmaps-grammar registry

  // the words that make a theme's kind; the rest of the type are flags
  const BASE_WORDS = ['CHART', 'CHOROPLETH', 'FEATURE', 'FEATURES', 'BUBBLE', 'SYMBOL', 'DOT', 'PIE', 'BAR', 'PLOT',
    'LABEL', 'VECTOR', 'USER', 'HEATMAP', 'MLHEATMAP', 'KDE', 'WMS', 'IMAGE'];
  const KINDS = ['CHART|BUBBLE', 'CHART|SYMBOL', 'CHART|DOT', 'CHART|PIE', 'CHART|BAR', 'CHART|PLOT', 'CHART|LABEL',
    'CHART|VECTOR', 'CHART|USER', 'CHOROPLETH', 'FEATURE', 'HEATMAP', 'MLHEATMAP', 'KDE', 'WMS'];
  const FLAG_GROUPS = [
    ['Classification', ['CATEGORICAL', 'QUANTILE', 'NATURAL', 'LOG', 'RANGES', 'DOMINANT', 'DEVIATION', 'PERCENTOFMEAN', 'COMPOSECOLOR', 'SUBTRACTIVE', 'DOPACITYMAX']],
    ['Aggregation', ['AGGREGATE', 'SUM', 'MEAN', 'MIN', 'MAX', 'COUNT', 'RELOCATE', 'GRIDSIZE']],
    ['Size', ['SIZE', 'NOSIZE', 'FIXSIZE', 'SIZELOG', 'SIZEP4', 'NORMSIZE', 'AUTOSIZE']],
    ['Look', ['GLOW', 'AURA', 'VALUES', 'TITLE', 'BOX', 'TEXTONLY', 'CENTERVALUES', 'VALUEBACKGROUND', 'OUTLINE', 'SORT']],
    ['Legend', ['NOLEGEND', 'COMPACTLEGEND', 'SIMPLELEGEND', 'TEXTLEGEND']]
  ];
  // per section: groups of [key, input kind, hint]. Kinds: num, text, color,
  // colors (a color list), list (comma separated), check, range01, area (long text)
  const CURATED = {
    style: [
      ['Color', [['colorscheme', 'colors', 'colors, or a count and anchor colors ["5","#fff","#f00"]'], ['classes', 'num'], ['values', 'list', 'category values, in color order'],
        ['ranges', 'list', 'class breaks'], ['fillopacity', 'range01'], ['opacity', 'range01', 'theme opacity; GLOW strength'], ['nodatacolor', 'color'],
        ['linecolor', 'color'], ['linewidth', 'num'], ['bordercolor', 'color'], ['textcolor', 'color'], ['valuecolor', 'color']]],
      ['Size and labels', [['scale', 'num'], ['normalsizevalue', 'num', 'the value drawn at the normal size'], ['sizepow', 'num'], ['minvalue', 'num'], ['maxvalue', 'num'],
        ['symbols', 'list'], ['valuescale', 'num'], ['valuedecimals', 'num'], ['textscale', 'num'], ['units', 'text'], ['legendunits', 'text']]],
      ['Aggregation', [['gridwidth', 'text', '"30px" screen pixels, or meters'], ['gridwidthpx', 'num'], ['aggregation', 'list', 'scale, width pairs: 1:1, 3px, 1:500000, 1px'], ['maxcharts', 'num']]],
      ['Shadow', [['shadow', 'check', 'drawn for at most maxshadow symbols'], ['maxshadow', 'num'], ['shadowblur', 'num'], ['shadowdx', 'num'], ['shadowdy', 'num']]],
      ['Visible between scales', [['featureupper', 'text', 'e.g. 1:500000'], ['featurelower', 'text'], ['chartupper', 'text'], ['chartlower', 'text'],
        ['labelupper', 'text'], ['valueupper', 'text'], ['glowupper', 'text']]],
      ['Other', [['title', 'text'], ['filter', 'text', 'e.g. WHERE "v" > 3']]]
    ],
    binding: [
      ['Fields', [['position', 'field', 'geometry, or lat|lon fields'], ['geo', 'field'], ['value', 'field', 'one field, or several joined by |'], ['size', 'field'], ['color', 'field'],
        ['title', 'field'], ['id', 'field'], ['lookup', 'field', 'joins to the base layer\'s id'], ['alpha', 'field'], ['time', 'field'], ['text', 'field'],
        ['value100', 'field'], ['position2', 'field']]]
    ],
    data: [
      ['Source', [['url', 'text'], ['type', 'datatype'], ['name', 'text', 'a name other themes can use'], ['cache', 'check'], ['query', 'text']]]
    ],
    meta: [
      ['Text', [['name', 'text', 'the theme id'], ['title', 'text'], ['snippet', 'text', 'under the title in the legend'], ['description', 'area'], ['tooltip', 'area', '{{field}} placeholders']]]
    ]
  };
  const curatedKind = (section, key) => {
    for (const [, rows] of CURATED[section] || []) for (const r of rows) if (r[0] === key) return r[1];
    return null;
  };

  // the theme type as its kind (base words) and its flags, both in order
  function typeParts(type) {
    const words = String(type || '').split('|').map(w => w.trim()).filter(Boolean);
    return { base: words.filter(w => BASE_WORDS.includes(w)).join('|'), flags: words.filter(w => !BASE_WORDS.includes(w)) };
  }
  const joinType = (base, flags) => [...String(base || '').split('|').filter(Boolean), ...flags].join('|');

  // the input kind for a value no curated row knows
  function guessKind(v) {
    if (typeof v === 'boolean') return 'check';
    if (typeof v === 'number') return 'num';
    if (Array.isArray(v) && v.every(x => x == null || typeof x !== 'object')) return 'list';
    if (v != null && typeof v === 'object') return 'json';
    return 'text';
  }

  // an input's text as the value it writes: { value } | { remove: true } | { error }
  // orig: the value before, whose type (number / string, array items) is kept
  function parseValue(kind, text, orig) {
    if (kind === 'check') return text ? { value: true } : { remove: true };
    const t = String(text == null ? '' : text).trim();
    if (t === '') return { remove: true };
    if (kind === 'num' || kind === 'range01') {
      const n = Number(t.replace(',', '.'));
      if (!Number.isFinite(n)) return { error: 'not a number' };
      return { value: typeof orig === 'string' ? String(n) : n };
    }
    if (kind === 'list' || kind === 'colors') {
      const items = t.split(',').map(s => s.trim()).filter(s => s !== '');
      const numeric = Array.isArray(orig) && orig.length && orig.every(x => typeof x === 'number');
      return { value: numeric && items.every(s => Number.isFinite(Number(s))) ? items.map(Number) : items };
    }
    if (kind === 'json') {
      try { return { value: JSON.parse(t) }; } catch (e) { return { error: e.message }; }
    }
    return { value: t };
  }
  // a value as its input's text
  function formatValue(kind, v) {
    if (v == null) return '';
    if (kind === 'check') return v === true || v === 'true' || v === 1 || v === '1';
    if (kind === 'json') return JSON.stringify(v);
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  }
  // the data's field names, from the first records
  function fieldNamesOf(features) {
    const names = new Set();
    (features || []).slice(0, 50).forEach(f => { if (f && f.properties) Object.keys(f.properties).forEach(k => names.add(k)); });
    return [...names];
  }
  // the registry's keys of a section as datalist entries, the ones ixmaps-gl
  // draws first: [{ key, gl }] (gl: false when the registry says gl ignores it)
  function registryKeys(grammar, section) {
    if (!grammar) return [];
    const reg = { style: 'styleKeys', binding: 'bindingKeys', data: 'dataKeys', meta: 'metaKeys', flags: 'flags', datatype: 'dataTypes' }[section];
    const table = grammar[reg] || {};
    const ext = (grammar.glExtensions && grammar.glExtensions[reg]) || {};
    const internal = new Set((grammar.glInternal && grammar.glInternal[reg]) || []);
    const out = [];
    for (const k of Object.keys(table)) if (!internal.has(k)) out.push({ key: k, gl: !table[k].gl || table[k].gl.status !== 'missing' });
    for (const k of Object.keys(ext)) if (!table[k]) out.push({ key: k, gl: true, note: ext[k] });
    return out.sort((a, b) => (b.gl - a.gl) || a.key.localeCompare(b.key));
  }

  // ---- the config dialog's Visual tab: the Smart Data Loader's visualizations
  // (app/ixmaps-loader_70.html, buildLayer), read from and written to an
  // existing theme

  const VIZ = ['dot', 'bubble', 'hexbin', 'hexbin_sized', 'heatmap', 'mlheatmap', 'kde', 'choropleth', 'feature'];
  const POINT_VIZ = ['dot', 'bubble', 'hexbin', 'hexbin_sized', 'heatmap', 'mlheatmap', 'kde'];
  const VIZ_LABELS = { dot: 'Dots', bubble: 'Sized bubbles', hexbin: 'HexBin', hexbin_sized: 'HexBin sized', heatmap: 'Heatmap',
    mlheatmap: 'Heatmap MapLibre', kde: 'KDE', choropleth: 'Choropleth', feature: 'Feature', custom: 'Custom' };
  const VIZ_HINTS = {
    heatmap: 'deck.gl heatmap: a Gaussian kernel per point, summed on the GPU and scaled to the largest density in view; recomputed on every view change; not drawn on the globe',
    mlheatmap: 'MapLibre\'s native heatmap: the points stay in the tiles, the density is absolute, radius and intensity follow the zoom; fast, also on the globe',
    kde: 'kernel density estimate of the points in view as stacked bands at 15/30/50/70% of the maximum; recomputed when the map stands still; not drawn on the globe'
  };
  // the type words a visualization writes; the theme's other flags (GLOW, VALUES, MEAN, …) are kept
  const VIZ_FLAGS = ['CHART', 'SYMBOL', 'BUBBLE', 'DOT', 'HEATMAP', 'MLHEATMAP', 'KDE', 'GRIDSIZE', 'AGGREGATE', 'SUM',
    'DOPACITY', 'CENTER', 'DOMINANT', 'SIZE', 'AUTOSIZE', 'RELOCATE', 'CATEGORICAL'];
  // the style keys a visualization brings, with their defaults (a theme's own value is kept)
  const VIZ_STYLE = {
    hexbin: { symbols: ['hexagon'], gridwidthpx: 15, dopacitypow: '2', dopacityscale: '2' },
    hexbin_sized: { gridwidthpx: 15 },
    heatmap: { radiuspx: 30 },
    mlheatmap: { radiuspx: 5, intensity: 1 },
    kde: {}
  };
  // the loader's ramps for the density visualizations (COLOR_BY_VIZ), when the theme's colors make none
  const HEAT_RAMPS = { heatmap: ['#ffffcc', '#fd8d3c', '#800026'], kde: ['#ffffcc', '#fd8d3c', '#800026'],
    mlheatmap: ['#67a9cf', '#d1e5f0', '#fddbc7', '#ef8a62', '#b2182b'] };
  const GRID_VIZ = ['hexbin', 'hexbin_sized'];
  const TABLEAU = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ac'];
  // the loader's own palettes, then ixmaps-flat's (ui/js/tools/colorselect.js), the same names and strings
  const PALETTES = [
    ['Yellow-orange-red', '#ffffb2,#fecc5c,#fd8d3c,#f03b20,#bd0026'], ['Blues', '#eff3ff,#bdd7e7,#6baed6,#3182bd,#08519c'],
    ['Greens', '#edf8e9,#bae4b3,#74c476,#31a354,#006d2c'], ['Purples', '#f2f0f7,#cbc9e2,#9e9ac8,#756bb1,#54278f'],
    ['Red-blue', '#b2182b,#ef8a62,#fddbc7,#d1e5f0,#67a9cf,#2166ac'], ['Brown-green', '#a6611a,#dfc27d,#f5f5f5,#80cdc1,#018571'],
    ['Viridis-like', '#440154,#31688e,#35b779,#fde725'], ['Tableau', TABLEAU.join(',')], ['Set2', '#66c2a5,#fc8d62,#8da0cb,#e78ac3,#a6d854,#ffd92f'],
    ['Neutral gray', '#888888'],
    ['red', '#ffeeee,#dd0000,dynamic,cold'], ['green', '#eeffee,#00cc00,dynamic,cold'], ['blue', '#eeeeff,#0000cc,dynamic,cold'],
    ['gray', '#eeeeee,#444444,dynamic,cold'], ['warmgray', '#FaF8F8,#888876,dynamic,warm'], ['greengray', '#FEFDDF,#888A56,dynamic,warm'],
    ['darkred', '#FEF0DF,#bb2233,dynamic,warm'], ['petrol', '#FEFDDF,#008A56,dynamic,warm'], ['darkblue', '#FEFDDF,#00308F,dynamic,warm'],
    ['petrol2', '#CEDDF6,#2C516A,dynamic,cold'], ['inkblue', '#D2E3F4,#104482,3colors,#4A90E1'], ['density1', '#FFFDD8,#B5284B,3colors,#FCBA6C'],
    ['density2', '#FFFFFF,#BC0225,3colors,#FC8C3D'], ['density3', '#FFEDA0,#800026,3colors,#FC5E2A'], ['density4', '#FEE5D9,#A50F15,3colors,#FB6A4A'],
    ['density5', '#D1EC6E,#F7C025,null,null'], ['heatmap', 'blue,#ffcc77,3low,red'], ['heatmap0', '#eeffaa,#9944B5,3colors,#ff8800'],
    ['heatmap01', '#6E4AF6,#F9FA84,3colors,#F52926'], ['heatmap1', '#ddff66,#AA7FB5,3low,#DB706D'], ['viridis-b', '#440154,#FDE725,3colors,#238A8D'],
    ['viridis-a', '#FDE725,#440154,3colors,#238A8D'], ['magma-b', '#100050,#F2F226,3colors,#CC4878'], ['magma-a', '#F2F226,#100050,3colors,#CC4878'],
    ['heatmap2', '#000523,#446CFF,3colors,#2239FC'], ['heatmap3', '#000523,#ffffFF,3colors,#2239FC'], ['heatmap31', '#334455,#88eeFF,dynamic,cold'],
    ['heatmap4', 'RGB(74,74,255)|RGB(245,41,38)|dynamic'], ['heatmap5', 'RGB(245,41,38)|RGB(74,74,255)|dynamic'],
    ['blue-red9', '#36A6B1|#794073|3colors|#DDA729'], ['red-blue9', '#794073|#36A6B1|3colors|#DDA729'], ['green-red9', '#56A651|#794073|3colors|#DDA729'],
    ['red-green9', '#794073|#56A651|3colors|#DDA729'], ['blue-green-red', '#5EB6BA,#DD8356,3colors,#95B526'], ['red-green-blue', '#DD8356,#5EB6BA,3colors,#95B526'],
    ['green-blue-red1', '#95B526,#DD8356,3colors,#5EB6BA'], ['red-blue-green1', '#DD8356,#95B526,3colors,#5EB6BA'], ['green-red', 'green,red,,warm'],
    ['red-green', 'red,green,,warm'], ['green-red2', '#7CB832,#FF4800,auto,#F7FA7A'], ['red-green2', '#FF4800,#7CB832,auto,#F7FA7A'],
    ['green-red3', '#41826C,#EF5D52,3colors,#E1D495'], ['red-green3', '#EF5D52,#41826C,3colors,#E1D495'], ['blue-red', 'blue,red,,warm'],
    ['red-blue', 'red,blue,,warm'], ['blue-red2', '#00308F,#FF4800,,warm'], ['red-blue2', '#FF4800,#00308F,,warm'],
    ['blue-red3', '#C1DAE7,#D95461,3colors,#FBE9CA'], ['red-blue3', '#D95461,#C1DAE7,3colors,#FBE9CA'], ['blue-red4', '#3288BD,#D53E4F,3colors,#F7F7F7'],
    ['red-blue4', '#D53E4F,#3288BD,3colors,#F7F7F7'], ['blue-red5', '#3288BD,#D53E4F,3colors,#d4d898'], ['red-blue5', '#D53E4F,#3288BD,3colors,#d4d898'],
    ['blue-red6', 'RGB(1,175,221)|RGB(253,88,7)|3colors|RGB(230,230,136)'], ['red-blue6', 'RGB(253,88,7)|RGB(1,175,221)|3colors|RGB(230,230,136)'],
    ['blue-red7', '#62D2EA|#FF6801|3colors|#E0E4CB'], ['red-blue7', '#FF6801|#62D2EA|3colors|#E0E4CB'], ['blue-red8', '#80AF9B|#FF3D62|3colors|#FBCDAB'],
    ['red-blue8', '#FF3D62|#80AF9B|3colors|#FBCDAB'], ['blue-redA', '#276E83|#AA0321|3colors|#FBF7B6'], ['red-blueA', '#AA0321|#276E83|3colors|#FBF7B6'],
    ['green-brown', '#828A4D,#CF926D,3colors,#FFFFFF'], ['brown-green', '#CF926D,#828A4D,3colors,#FFFFFF'], ['blue-orange', '#88A6B7,#FD9807,3colors,#FFFFFF'],
    ['orange-blue', '#FD9807,#88A6B7,3colors,#FFFFFF'], ['blue-orange2', '#04A3F4,#F5A506,3colors,#F4E4C0'], ['orange-blue2', '#F5A506,#04A3F4,3colors,#F4E4C0'],
    ['green-blue-red2', 'RGB(207,255,51)|RGB(221,0,0)|3colors|RGB(148,204,200)'], ['red-blue-green2', 'RGB(221,0,0)|RGB(207,255,51)|3colors|RGB(148,204,200)'],
    ['green-dark', '#CFFF33,#000523,3colors,#94CCC8'], ['dark-green', '#000523,#CFFF33,3colors,#94CCC8'], ['green-blue2', '#CFFF33,#2239FC,3colors,#f8f8f8'],
    ['blue-green2', '#2239FC,#CFFF33,3colors,#f8f8f8'], ['blue-green3', '#88A6B7,#97AB5E,3colors,#FFFFFF'], ['green-blue3', '#97AB5E,#88A6B7,3colors,#FFFFFF'],
    ['green-viola', '#CFFF33,#9A5195,3colors,#94CCC8'], ['viola-green', '#9A5195,#CFFF33,3colors,#94CCC8'], ['brown-viola', '#DB9151,#8B79B9,3colors,#F9F9DF'],
    ['viola-brown', '#8B79B9,#DB9151,3colors,#F9F9DF'], ['brown-blue4', '#CC8400,#3F3FFF,3colors,#FFE8BF'], ['blue4-brown', '#3F3FFF,#CC8400,3colors,#FFE8BF'],
    ['brown-blue5', '#ffaa88,#0044dd,dynamic'], ['blue5-brown', '#0044dd,#ffaa88,dynamic'], ['spectral', 'spectrum,default,200,0'],
    ['rev-spec.', 'spectrum,default,0,200'], ['office', 'office,,,'], ['mineral', 'mineral,,'], ['pastel', 'pastel,,'], ['harvest', 'harvest,,,'],
    ['fruit', 'fruit,,,'], ['kmeans', 'kmeans,,,'], ['kmeansp', 'kmeansp,,,'], ['pimp', 'pimp,,,'], ['intense', 'intense,,,'], ['fluo', 'fluo,,,'],
    ['tableau', 'tableau,,,'], ['tableau10', 'tableau10,,,'], ['tableau20', 'tableau20,,,'], ['viridis', 'viridis,,,'], ['plasma', 'plasma,,,'], ['magma', 'magma,,,']
  ];
  const SCHEME_KEYWORDS = /^(dynamic|auto|linear|warm|cold|shift|null|[23](colors|wide|narrow|low|high))$/i;
  const NAMED_PALETTES = /^(office|mineral|minaral|pastel|harvest|fruit|kmeansp?|pimp|intense|fluo|tableau(10|20)?|viridis|plasma|magma)$/i;
  const paletteTokens = raw => { raw = String(raw || ''); return (raw.includes('|') ? raw.split('|') : raw.split(',')).map(t => t.trim()); };
  // a flat gradient definition or named palette (generated by the engine), not a list of colors
  function isFlatGradient(raw) {
    const t = paletteTokens(raw);
    return t.length > 1 && (NAMED_PALETTES.test(t[0]) || t.some((x, i) => i > 0 && (x === '' || SCHEME_KEYWORDS.test(x))));
  }
  // n colors of a palette: a color list cycles (qualitative) or is taken as it is; a flat definition is
  // swept by the engine (sweep: ixmaps-gl's flatColorSweep); [] when that cannot be done
  function paletteColors(raw, n, sweep) {
    const t = paletteTokens(raw);
    if (!isFlatGradient(raw)) {
      const cols = t.filter(c => /^#|^rgb/i.test(c));
      return n && cols.length ? Array.from({ length: n }, (_, i) => cols[i % cols.length]) : cols;
    }
    if (!sweep) return [];
    try {
      const rgb = sweep(t[0], t[1], n || 7, t[2], t[3]);
      return rgb ? rgb.map(c => (typeof c === 'string' ? c : 'rgb(' + c.join(',') + ')')) : [];
    } catch (e) { return []; }
  }
  // a palette as a numeric theme's colorscheme: a color list as it is, a flat definition in the
  // engine's generated form [classes, colorA, colorB, param1, param2]
  const paletteScheme = (raw, classes) => (isFlatGradient(raw) ? [String(classes || 7), ...paletteTokens(raw)] : paletteTokens(raw));

  // the data's fields: name, numeric (most values are numbers), from the first records
  function fieldInfoOf(features) {
    const out = new Map();
    for (const f of (features || []).slice(0, 300)) {
      const p = f && f.properties;
      if (!p) continue;
      for (const k of Object.keys(p)) {
        const e = out.get(k) || { name: k, n: 0, num: 0 };
        const v = p[k];
        if (v == null || v === '') { out.set(k, e); continue; }
        e.n++;
        if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))))) e.num++;
        out.set(k, e);
      }
    }
    return [...out.values()].filter(e => !/^\$/.test(e.name)).map(e => ({ name: e.name, numeric: e.n > 0 && e.num / e.n >= 0.8 }));
  }
  // the distinct values of a field, in data order (at most 100)
  function categoriesOf(features, field) {
    const seen = new Set();
    for (const f of features || []) {
      const v = f && f.properties && f.properties[field];
      if (v == null || v === '') continue;
      seen.add(String(v));
      if (seen.size >= 100) break;
    }
    return [...seen];
  }
  // the largest value of a field, for normalsizevalue (the loader's computeNormValue)
  function normValueOf(features, field) {
    let max = -Infinity;
    for (const f of (features || []).slice(0, 500)) {
      const v = parseFloat(String(f && f.properties ? f.properties[field] : '').replace(',', '.'));
      if (Number.isFinite(v) && v > max) max = v;
    }
    return Number.isFinite(max) ? Math.max(1, Math.round(max)) : 1;
  }

  // a theme definition in the Visual tab's terms: { viz, value, size, categorical }
  function readVisual(def) {
    const style = (def && def.style) || {};
    const { base, flags } = typeParts(style.type);
    const b = base.split('|'), has = w => b.includes(w) || flags.includes(w);
    const symbols = [].concat(style.symbols || []).map(String);
    let viz = 'custom';
    if (has('KDE')) viz = 'kde';
    else if (has('MLHEATMAP')) viz = 'mlheatmap';
    else if (has('HEATMAP')) viz = 'heatmap';
    else if (b.includes('CHOROPLETH')) viz = 'choropleth';
    else if (b.includes('FEATURE') || b.includes('FEATURES')) viz = 'feature';
    else if (b.includes('CHART') && !['PIE', 'BAR', 'PLOT', 'VECTOR', 'LABEL', 'USER'].some(w => b.includes(w))) {
      if (has('GRIDSIZE') && (symbols.includes('hexagon') || has('DOPACITY'))) viz = 'hexbin';
      else if (has('BUBBLE') && has('AUTOSIZE') && has('RELOCATE')) viz = 'hexbin_sized';
      else if (has('DOT')) viz = 'dot';
      else if (has('SYMBOL') || has('BUBBLE')) viz = 'bubble';
    }
    const binding = (def && def.binding) || {};
    return { viz, value: binding.value, size: binding.size, categorical: flags.includes('CATEGORICAL') };
  }

  // A theme definition changed to a visualization and fields, as the loader builds it.
  // want: { viz, value, size }; data: { isNumeric(field), categories(field), normValue(field), sweep }.
  // Keeps the theme's data, position binding, other flags and other style keys. Returns a new definition.
  // stash (optional, kept by the caller per theme): where a theme's aggregation brackets wait while it is
  // a hexbin — they are clustering radii, the hexbin takes its own grid — to come back afterwards.
  function writeVisual(def, want, data, stash) {
    const now = readVisual(def);
    const viz = want.viz || now.viz;
    const style = Object.assign({}, def.style || {});
    const binding = Object.assign({}, def.binding || {});
    const parts = typeParts(style.type);
    const value = want.value !== undefined ? want.value : binding.value;
    const isCat = !!value && value !== '$item$' && !data.isNumeric(value);
    if (value === undefined || value === '' || value === '__NONE__') delete binding.value; else binding.value = value;

    if (viz === 'choropleth' || viz === 'feature' || viz === 'custom' || !POINT_VIZ.includes(viz)) {
      // no shape change here: only the value field, and CATEGORICAL by its type (CHOROPLETH)
      let flags = parts.flags;
      if (viz === 'choropleth' && value !== undefined && value !== now.value) {
        flags = flags.filter(f => f !== 'CATEGORICAL');
        if (isCat) flags.push('CATEGORICAL');
        else if (!flags.some(f => ['QUANTILE', 'NATURAL', 'LOG', 'RANGES', 'EQUIDISTANT', 'DOMINANT'].includes(f))) flags.push('QUANTILE');
        setCategories(style, isCat, value, data);
      }
      style.type = joinType(parts.base, flags);
      return Object.assign({}, def, { style, binding });
    }

    let size = want.size !== undefined ? want.size : binding.size;
    if (!size) size = isCat || !value || value === '$item$' ? '$item$' : value;
    const keep = parts.flags.filter(f => !VIZ_FLAGS.includes(f));
    const sum = size !== '$item$' && !keep.includes('MEAN') ? ['SUM'] : [];
    let base, flags;
    if (viz === 'dot') { base = isCat ? 'CHART|SYMBOL' : 'CHART|DOT'; flags = isCat ? ['CATEGORICAL', 'AGGREGATE'] : []; }
    else if (viz === 'bubble') { base = 'CHART|SYMBOL'; flags = [...(isCat ? ['CATEGORICAL'] : size === value ? ['SIZE'] : []), 'AGGREGATE', ...sum]; }
    else if (viz === 'hexbin') { base = 'CHART|SYMBOL'; flags = ['GRIDSIZE', 'AGGREGATE', 'SUM', 'DOPACITY', ...(isCat ? ['CATEGORICAL', 'CENTER', 'DOMINANT'] : [])]; }
    else if (viz === 'hexbin_sized') { base = 'CHART|BUBBLE'; flags = ['SIZE', 'AGGREGATE', 'AUTOSIZE', 'RELOCATE', ...sum, ...(isCat ? ['CATEGORICAL'] : [])]; }
    else { base = viz.toUpperCase(); flags = []; }
    style.type = joinType(base, [...flags, ...keep.filter(f => !flags.includes(f))]);

    if (viz === 'dot') delete binding.size; else binding.size = size;
    if (viz !== now.viz && GRID_VIZ.includes(viz) && !GRID_VIZ.includes(now.viz)) {
      for (const k of ['aggregation', 'aggregationscale']) if (Array.isArray(style[k])) { if (stash) stash[k] = style[k]; delete style[k]; }
    } else if (viz !== now.viz && !GRID_VIZ.includes(viz) && GRID_VIZ.includes(now.viz) && stash) {
      for (const k of ['aggregation', 'aggregationscale']) if (stash[k] && style[k] == null) { style[k] = stash[k]; delete stash[k]; }
    }
    if (viz !== now.viz) {
      // the old visualization's own style keys go, the new one's defaults come (the theme's grid stays)
      const old = VIZ_STYLE[now.viz] || {};
      for (const k of Object.keys(old)) if (!(VIZ_STYLE[viz] && k in VIZ_STYLE[viz])) {
        if (k === 'symbols' && [].concat(style.symbols || []).join() !== 'hexagon') continue;
        if (k === 'gridwidthpx' && (viz === 'hexbin' || viz === 'hexbin_sized')) continue;
        delete style[k];
      }
      const hasGrid = style.gridwidthpx != null || style.gridwidth != null || Array.isArray(style.aggregation) || Array.isArray(style.aggregationscale);
      for (const [k, v] of Object.entries(VIZ_STYLE[viz] || {})) {
        if (k === 'gridwidthpx' && hasGrid) continue;
        if (style[k] == null) style[k] = Array.isArray(v) ? [...v] : v;
      }
    }
    if (viz === 'bubble' && size !== '$item$') style.normalsizevalue = String(data.normValue(size));
    else if (viz === 'dot' && isCat) style.normalsizevalue = '1';
    else if (viz !== 'bubble' && viz !== 'dot' && now.viz !== viz) delete style.normalsizevalue;
    setCategories(style, isCat, value, data);
    // a hexbin of a number: one color, its opacity ramps (the loader's lastSchemeColor)
    if (viz === 'hexbin' && !isCat && now.viz !== 'hexbin') {
      const cols = schemeColorsOf(style.colorscheme, data.sweep);
      if (cols.length) style.colorscheme = [cols[cols.length - 1]];
    }
    // a density surface needs a ramp: the loader's, when the theme's colors are fewer than three
    if (HEAT_RAMPS[viz] && now.viz !== viz && schemeColorsOf(style.colorscheme, data.sweep).length < 3) style.colorscheme = [...HEAT_RAMPS[viz]];
    return Object.assign({}, def, { style, binding });
  }
  // CATEGORICAL themes: style.values and one color per category (from the theme's colors)
  function setCategories(style, isCat, value, data) {
    if (isCat) {
      const vals = data.categories(value);
      const had = schemeColorsOf(style.colorscheme, data.sweep);
      style.values = vals;
      style.colorscheme = vals.map((v, i) => (had.length >= 2 ? had[i % had.length] : TABLEAU[i % TABLEAU.length]));
    } else if (Array.isArray(style.values)) {
      delete style.values;
    }
  }
  // the colors a colorscheme stands for: a list as it is, the engine's generated form swept
  function schemeColorsOf(cs, sweep) {
    const a = [].concat(cs == null ? [] : cs).map(String);
    if (a.length && Number.isFinite(Number(a[0])) && a.length > 2) return paletteColors(a.slice(1).join(a.some(c => /rgb/i.test(c)) ? '|' : ','), Number(a[0]), sweep);
    return a.filter(c => /^#|^rgb|^[a-z]+$/i.test(c));
  }
  // a palette applied to a theme: one color per category, or the scheme with the theme's class count
  function withPalette(def, raw, sweep) {
    const style = Object.assign({}, def.style || {});
    const { viz, categorical } = readVisual(def);
    if (categorical && Array.isArray(style.values)) {
      const cols = paletteColors(raw, style.values.length, sweep);
      if (cols.length) style.colorscheme = cols;
    } else if (viz === 'hexbin') {
      const cols = paletteColors(raw, 7, sweep);
      if (cols.length) style.colorscheme = [cols[cols.length - 1]];
    } else {
      const cur = [].concat(style.colorscheme || []);
      const classes = Number(style.classes) || (cur.length && Number.isFinite(Number(cur[0])) ? Number(cur[0]) : cur.length >= 2 ? cur.length : 5);
      style.colorscheme = paletteScheme(raw, classes);
    }
    return Object.assign({}, def, { style });
  }

  const fmt = (ctl, v) => (ctl.unit === '%' ? Math.round(v * 100) + '%' : String(round3(v)));

  // ------------------------------------------------------------------ themes

  const themeIdOf = rt => (rt.style && rt.style.name) || (rt.meta && rt.meta.name) || rt.name;
  // a blank title (" " hides the legend heading) is no label: fall back to the layer name, then the theme id
  // the picker's label: the title as text (a title may hold HTML, "<h3>…</h3><hr>"), blank → the layer name, then the id
  const titleOf = rt => String((rt.meta && rt.meta.title) || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || rt.name || themeIdOf(rt);

  // the themes a user can pick: not a theme's own sub theme
  function themesOf(api) {
    const rts = (api && api.runtimes) || [];
    const subs = new Set(rts.map(r => r._subTheme).filter(Boolean));
    return rts.filter(r => !subs.has(r));
  }
  // the tools' key for a theme: its id, with "#n" when several themes share it
  // (themes on one layer with no style.name / meta.name all have the layer name as id)
  function keyOf(api, rt) {
    const id = themeIdOf(rt);
    const same = themesOf(api).filter(r => themeIdOf(r) === id);
    return same.length > 1 ? id + '#' + same.indexOf(rt) : id;
  }
  // default: the topmost chart / choropleth theme, else the topmost theme
  function defaultTheme(api) {
    const list = themesOf(api);
    return [...list].reverse().find(r => /chart|choropleth/.test(themeKind(typeWordsOf(r.flags)))) || list[list.length - 1] || null;
  }
  // the theme drawn under the point (deck.gl layer ids carry the layer name)
  function themeAt(api, x, y) {
    try {
      const info = api.overlay && api.overlay.pickObject && api.overlay.pickObject({ x, y, radius: 4 });
      const id = info && info.layer && info.layer.id;
      if (!id) return null;
      const hits = themesOf(api).filter(r => id.includes('-' + r.name + '-') || id.endsWith('-' + r.name));
      return hits.length === 1 ? hits[0] : null;
    } catch (e) { return null; }
  }

  // ---- save map: the map as a standalone HTML page

  const INLINE_DATA_CHARS = 2000000; // a theme with more inline data than this is left out of a saved page
  const SAVE_ENGINE_CDN = 'https://cdn.jsdelivr.net/npm/ixmaps-gl';

  // a value as JavaScript source: plain objects and arrays, with functions as
  // their source text; pretty: indented, short parts on one line.
  // { src } or { error } (a cycle, a class instance, a symbol)
  function jsLiteral(v, pretty, pad) {
    const fns = [];
    const stack = new Set();
    let error = null;
    const key = k => /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    const pr = (x, p) => {
      if (error) return '';
      if (typeof x === 'function') { fns.push(x); return String(x); }
      if (x === undefined) return 'undefined';
      if (typeof x === 'number') return String(x); // Infinity / NaN are JavaScript too
      if (typeof x === 'symbol' || typeof x === 'bigint') { error = 'a ' + typeof x + ' value'; return ''; }
      if (x === null || typeof x !== 'object') return JSON.stringify(x);
      if (!isPlain(x)) { error = 'a ' + ((x.constructor && x.constructor.name) || 'non-plain') + ' object'; return ''; }
      if (stack.has(x)) { error = 'a cyclic object'; return ''; }
      stack.add(x);
      const arr = Array.isArray(x);
      const ks = arr ? null : Object.keys(x).filter(k => x[k] !== undefined);
      const n = arr ? x.length : ks.length;
      let out;
      if (!n) out = arr ? '[]' : '{}';
      else {
        const parts = q => arr ? x.map(e => pr(e, q)) : ks.map(k => key(k) + (pretty ? ': ' : ':') + pr(x[k], q));
        const flat = parts(p);
        const one = arr ? '[' + flat.join(pretty ? ', ' : ',') + ']' : (pretty ? '{ ' + flat.join(', ') + ' }' : '{' + flat.join(',') + '}');
        if (!pretty || (one.length + p.length <= 100 && !one.includes('\n'))) out = one;
        else {
          const q = p + '  ';
          out = (arr ? '[' : '{') + '\n' + parts(q).map(s => q + s).join(',\n') + '\n' + p + (arr ? ']' : '}');
        }
      }
      stack.delete(x);
      return out;
    };
    const src = pr(v, pad || '');
    return error ? { error } : { src, functions: fns.length };
  }

  // one theme's ixmaps.layer(...) source for a saved page, from its definition
  // ({ layer, data, binding, style: { type, ... }, meta, field, field100 });
  // base: the page address relative data urls resolve against.
  // { code, label, warnings } or { skipped: reason, label, warnings }
  function themeCode(def, base) {
    const warnings = [];
    const style = Object.assign({}, def.style);
    const meta = def.meta || {};
    const label = String(meta.title || style.name || meta.name || def.layer || 'theme');
    const type = style.type;
    delete style.type;
    let data = def.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      data = Object.assign({}, data);
      if (typeof data.url === 'string' && data.url && base) {
        try { data.url = new URL(data.url, base).href; } catch (e) { /* not a url: kept as it is */ }
      }
      if (data.process) warnings.push('"' + label + '" processes its data with a function: it may need code of the original page');
    }
    const dataSrc = jsLiteral(data, false);
    if (dataSrc.error) return { skipped: 'its data is ' + dataSrc.error + ', not something a page can hold', label, warnings };
    if (dataSrc.src.length > INLINE_DATA_CHARS) return { skipped: 'its inline data is ' + Math.round(dataSrc.src.length / 1e6) + ' MB, more than a page should hold', label, warnings };
    const pad = '      ';
    const lines = [];
    let fns = dataSrc.functions;
    const part = (method, v) => {
      if (v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) return null;
      const s = jsLiteral(v, true, pad);
      if (s.error) return s.error;
      fns += s.functions;
      lines.push(pad + '.' + method + '(' + s.src + ')');
      return null;
    };
    if (data != null) lines.push(pad + '.data(' + (dataSrc.src.length <= 300 ? jsLiteral(data, true, pad).src : dataSrc.src) + ')');
    const bad = part('binding', def.binding) || part('type', type) || part('style', style) || part('meta', def.meta)
      || part('field', def.field) || part('field100', def.field100);
    if (bad) return { skipped: 'its definition holds ' + bad, label, warnings };
    if (fns) warnings.push('"' + label + '" holds functions: they may need code of the original page');
    return { code: 'ixmaps.layer(' + JSON.stringify(String(def.layer == null ? label : def.layer)) + ', l => l\n' + lines.join('\n') + ')', label, warnings };
  }

  // the HTML page of a saved map. m: { title, engineUrl, map (the Map()
  // options), options (.options()), center: {lat, lng}, zoom, bearing, pitch,
  // globe, attribution, themes (themeCode results), notes, source, saved }
  function pageHtml(m) {
    const r = (v, d) => Math.round(Number(v) * 10 ** d) / 10 ** d;
    const lit = (v, p) => { const s = jsLiteral(v || {}, true, p); return s.error ? '{}' : s.src; };
    let js = '  // saved with ixmaps-gl-tools ' + VERSION + (m.saved ? ' on ' + m.saved : '') + (m.source ? ' from ' + m.source : '') + '\n';
    (m.notes || []).forEach(n => { js += '  // ' + String(n).replace(/\s+/g, ' ') + '\n'; });
    js += '  ixmaps.Map("map", ' + lit(m.map, '  ') + ', map => map\n';
    js += '    .view([' + r(m.center.lat, 6) + ', ' + r(m.center.lng, 6) + '], ' + r(m.zoom, 3) + ')\n';
    if (m.options && Object.keys(m.options).length) js += '    .options(' + lit(m.options, '    ') + ')\n';
    if (m.attribution) js += '    .attribution(' + JSON.stringify(String(m.attribution)) + ')\n';
    m.themes.forEach(t => {
      if (t.skipped) js += '    // left out: "' + t.label.replace(/\s+/g, ' ') + '" — ' + t.skipped + '\n';
      else js += '    .layer(' + t.code + ')\n';
    });
    js += '  )';
    const after = [];
    if (m.globe) after.push('    api.setProjection("globe");');
    if (r(m.bearing, 1) || r(m.pitch, 1)) after.push('    api.map.jumpTo({ bearing: ' + r(m.bearing, 1) + ', pitch: ' + r(m.pitch, 1) + ' });');
    if (after.length) js += '.then(api => {\n' + after.join('\n') + '\n  })';
    js += ';\n';
    // nothing in the script may end it or open an HTML comment
    js = js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
    return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + '<title>' + esc(m.title || 'map') + '</title>\n'
      + '<script src="' + esc(m.engineUrl) + '"></script>\n'
      + '<style>html, body { margin: 0; height: 100%; } #map { position: absolute; inset: 0; }</style>\n'
      + '</head>\n<body>\n<div id="map"></div>\n<script>\n' + js + '</script>\n</body>\n</html>\n';
  }

  // a file name from a title: "Injured (AREU)" → "injured_areu.html"
  function htmlFileName(title) {
    const s = String(title || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    return (s || 'map') + '.html';
  }

  // ------------------------------------------------------------------ UI

  const CSS = `
.ixgt-menu, .ixgt-dialog { position: fixed; z-index: 10000; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #222; background: #fff; border: 1px solid rgba(0,0,0,0.15); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.18); }
.ixgt-menu { display: flex; gap: 2px; padding: 3px; }
.ixgt-menu button { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 52px; padding: 5px 6px 4px;
  border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; font-size: 11px; cursor: pointer; }
.ixgt-menu button:hover:not(:disabled), .ixgt-menu button:focus-visible { background: #eef2f7; outline: none; }
.ixgt-menu button:disabled { opacity: 0.4; cursor: default; }
.ixgt-menu svg { width: 18px; height: 18px; }
.ixgt-dialog { width: 260px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); display: flex; flex-direction: column; }
.ixgt-head { display: flex; align-items: center; gap: 6px; padding: 7px 8px 7px 12px; border-bottom: 1px solid #eee; cursor: move; user-select: none; }
.ixgt-head b { flex: 1; font-size: 13px; }
.ixgt-head button { border: 0; background: none; font-size: 18px; line-height: 1; cursor: pointer; color: #666; padding: 0 4px; }
.ixgt-body { padding: 8px 12px 4px; overflow: auto; }
.ixgt-body select { width: 100%; margin-bottom: 8px; font: inherit; }
.ixgt-row { display: grid; grid-template-columns: 1fr 52px; align-items: center; column-gap: 8px; margin: 2px 0 8px; }
.ixgt-row label { grid-column: 1 / -1; color: #555; }
.ixgt-row input[type=range] { width: 100%; margin: 0; }
.ixgt-row output { text-align: right; font-variant-numeric: tabular-nums; }
.ixgt-checks { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 4px 0 8px; }
.ixgt-checks label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.ixgt-sub { color: #888; font-size: 11px; margin: 10px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.ixgt-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 12px 10px; }
.ixgt-foot .ixgt-note { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ixgt-foot button { font: inherit; padding: 3px 10px; cursor: pointer; }
.ixgt-note { color: #888; font-size: 11px; }
.ixgt-dialog.ixgt-edit { width: 500px; }
.ixgt-edit .ixgt-body { display: flex; flex-direction: column; overflow: hidden; }
.ixgt-code { position: relative; height: 360px; min-height: 120px; resize: vertical; overflow: hidden; border: 1px solid #ddd; border-radius: 4px; }
.ixgt-code textarea, .ixgt-code .ace_editor { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; box-sizing: border-box; border: 0;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 2; resize: none; outline: none; padding: 4px 6px; }
.ixgt-code .ace_editor { padding: 0; }
.ixgt-foot .ixgt-error { color: #b00020; white-space: normal; }
.ixgt-foot .ixgt-btns { display: flex; gap: 6px; flex: none; }
.ixgt-dialog.ixgt-config { width: 380px; }
.ixgt-config .ixgt-body { display: flex; flex-direction: column; overflow: hidden; }
.ixgt-tabs { display: flex; gap: 2px; border-bottom: 1px solid #ddd; margin-bottom: 6px; }
.ixgt-tabs button { border: 0; background: none; font: inherit; padding: 4px 10px; cursor: pointer; color: #555; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.ixgt-tabs button[aria-selected=true] { color: #111; border-bottom-color: #3b6fb6; font-weight: 600; }
.ixgt-panel { overflow: auto; max-height: 52vh; padding-right: 2px; }
.ixgt-panel details { margin: 0 0 6px; }
.ixgt-panel summary { cursor: pointer; color: #555; font-weight: 600; padding: 2px 0; }
.ixgt-field { display: grid; grid-template-columns: 96px 1fr; align-items: center; column-gap: 6px; margin: 3px 0; }
.ixgt-field label { color: #444; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ixgt-field select { width: 100%; font: inherit; margin: 0; }
.ixgt-input { display: flex; align-items: center; gap: 4px; min-width: 0; }
.ixgt-input input[type=text], .ixgt-input textarea { flex: 1; min-width: 0; font: inherit; padding: 2px 4px; border: 1px solid #ccc; border-radius: 3px; }
.ixgt-input textarea { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
.ixgt-input input[type=color] { width: 22px; height: 20px; padding: 0; border: 1px solid #ccc; border-radius: 3px; background: none; flex: none; }
.ixgt-input input[type=range] { width: 90px; flex: none; }
.ixgt-swatches { display: flex; gap: 2px; flex: none; max-width: 45%; overflow: hidden; }
.ixgt-unset { opacity: 0.35; }
.ixgt-bad { border-color: #b00020 !important; background: #fff4f4; }
.ixgt-flat { color: #999 !important; font-style: italic; }
.ixgt-chip { display: inline-flex; align-items: center; gap: 2px; padding: 1px 2px 1px 7px; background: #eef2f7; border-radius: 10px; }
.ixgt-chip button { border: 0; background: none; cursor: pointer; color: #666; font-size: 14px; line-height: 1; padding: 0 3px; }
.ixgt-add { display: flex; gap: 4px; margin: 8px 0 4px; }
.ixgt-add input { flex: 1; min-width: 0; font: inherit; padding: 2px 4px; }
.ixgt-add button { font: inherit; padding: 1px 8px; cursor: pointer; }
.ixgt-viz { margin: 2px 0 8px; }
.ixgt-viz-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 4px 8px; font: inherit; text-align: left; cursor: pointer;
  background: #fff; border: 1px solid #ccc; border-radius: 6px; }
.ixgt-viz-btn svg { width: 40px; height: 27px; flex: none; }
.ixgt-viz-btn span:nth-child(2) { flex: 1; font-weight: 600; }
.ixgt-viz-btn i { font-weight: 400; color: #888; }
.ixgt-chev { color: #888; font-size: 10px; }
.ixgt-viz-pop { display: none; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 6px; }
.ixgt-viz-pop.ixgt-open { display: grid; }
.ixgt-viz-pop .ixgt-note { grid-column: 1 / -1; white-space: normal; }
.ixgt-viz-card { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 3px 4px; font: inherit; font-size: 10px;
  background: #fff; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; color: #333; }
.ixgt-viz-card svg { width: 100%; max-width: 58px; height: 36px; }
.ixgt-viz-card:hover { border-color: #999; }
.ixgt-viz-card.ixgt-on { border-color: #3b6fb6; box-shadow: 0 0 0 1px rgba(59,111,182,0.3); }
.ixgt-hint { white-space: normal; margin: 4px 2px 0; }
.ixgt-vsw { max-width: none; flex: 1; flex-wrap: wrap; }
.ixgt-vsw input[type=color] { width: 18px; height: 18px; }
.ixgt-pal-btn { font: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; flex: none; }
.ixgt-palettes { display: none; max-height: 190px; overflow: auto; border: 1px solid #ddd; border-radius: 4px; margin: 2px 0 6px; }
.ixgt-palettes.ixgt-open { display: block; }
.ixgt-pal { display: flex; align-items: center; gap: 8px; width: 100%; padding: 3px 6px; border: 0; background: none; font: inherit; font-size: 11px; cursor: pointer; text-align: left; }
.ixgt-pal:hover { background: #eef2f7; }
.ixgt-pal-sw { display: inline-flex; gap: 1px; }
.ixgt-pal-sw i { display: inline-block; width: 13px; height: 13px; border-radius: 2px; }
.ixgt-num { width: 46px; flex: none !important; text-align: right; }
.ixgt-config .ixgt-input input[type=range] { flex: 1; width: auto; min-width: 60px; }
.ixgt-dialog.ixgt-save { width: 300px; }
.ixgt-save .ixgt-field { grid-template-columns: 36px 1fr; margin: 4px 0; }
.ixgt-save p { margin: 0 0 8px; color: #555; }
.ixgt-warn { margin: 8px 0 4px; padding-left: 16px; color: #8a5300; font-size: 11px; }
.ixgt-warn li { margin: 2px 0; }
`;
  const ICONS = {
    tune: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
    config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
  };

  function injectCss() {
    if (document.getElementById('ixgt-style')) return;
    const s = document.createElement('style');
    s.id = 'ixgt-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // keeps a fixed element inside the viewport
  function placeAt(node, x, y) {
    const r = node.getBoundingClientRect();
    node.style.left = Math.max(8, Math.min(x, global.innerWidth - r.width - 8)) + 'px';
    node.style.top = Math.max(8, Math.min(y, global.innerHeight - r.height - 8)) + 'px';
  }

  // ------------------------------------------------------------------ per map

  const maps = []; // attached map tool states, newest last
  let openMenu = null;

  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
  }

  function attach(api) {
    if (!api || !api.map || !api.runtimes || api.__ixgtAttached) return;
    api.__ixgtAttached = true;
    const state = {
      api,
      dialog: null,
      themeId: null,
      edit: null, // the edit dialog: { dialog, themeId, editor, kept, shown, drafts }
      config: null, // the config dialog: { dialog, themeId, tab, models, dirty, first, added, invalid }
      save: null, // the save dialog
      // per theme id: the definition and style as first seen (for the
      // factor sliders and Reset), and the tuned values
      origin: new Map(),
      factors: new Map()
    };
    maps.push(state);
    const container = api.map.getContainer();
    let down = null;
    container.addEventListener('mousedown', e => { if (e.button === 2) down = { x: e.clientX, y: e.clientY }; }, true);
    container.addEventListener('contextmenu', e => {
      e.preventDefault();
      // a right-DRAG rotates the map: no menu then
      const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
      down = null;
      if (moved) return;
      const r = container.getBoundingClientRect();
      const rt = themeAt(api, e.clientX - r.left, e.clientY - r.top);
      showMenu(state, e.clientX, e.clientY, rt);
    });
    api.map.on('movestart', closeMenu);
  }

  function showMenu(state, x, y, rt) {
    injectCss();
    closeMenu();
    const menu = el('div', 'ixgt-menu');
    menu.setAttribute('role', 'toolbar');
    const btn = (name, label, enabled, title, onClick) => {
      const b = el('button', null, ICONS[name] + '<span>' + label + '</span>');
      b.type = 'button';
      b.title = title;
      b.disabled = !enabled;
      b.addEventListener('click', () => { closeMenu(); onClick(); });
      menu.appendChild(b);
      return b;
    };
    const first = btn('tune', 'tune', true, 'Tune the theme style', () => openTune(state, rt ? keyOf(state.api, rt) : null, x, y));
    btn('edit', 'edit', true, 'Edit the theme definition', () => openEdit(state, rt ? keyOf(state.api, rt) : null, x, y));
    btn('config', 'config', true, 'Configure the theme: type, style, binding, data, meta', () => openConfig(state, rt ? keyOf(state.api, rt) : null, x, y));
    btn('save', 'save', true, 'Save the map as an HTML page', () => openSave(state, x, y));
    document.body.appendChild(menu);
    placeAt(menu, x - 10, y - 10);
    openMenu = menu;
    first.focus();
    const off = ev => {
      if (ev.type === 'keydown' && ev.key !== 'Escape') return;
      if (ev.type === 'pointerdown' && menu.contains(ev.target)) return;
      closeMenu();
      document.removeEventListener('pointerdown', off, true);
      document.removeEventListener('keydown', off, true);
    };
    document.addEventListener('pointerdown', off, true);
    document.addEventListener('keydown', off, true);
  }

  function findTheme(state, id) {
    const list = themesOf(state.api);
    return (id != null && list.find(r => keyOf(state.api, r) === id)) || null;
  }

  function originOf(state, rt) {
    const id = keyOf(state.api, rt);
    if (!state.origin.has(id)) {
      state.origin.set(id, {
        def: rt._definition ? Object.assign({}, rt._definition, { style: Object.assign({}, rt._definition.style) }) : null,
        style: Object.assign({}, rt.style)
      });
    }
    return state.origin.get(id);
  }

  // live style change, coalesced to one redraw per frame
  let pending = null;
  function applyLive(state, rt, patch) {
    rt.setStyle(patch);
    if (pending) return;
    pending = (global.requestAnimationFrame || (f => setTimeout(f, 16)))(() => { pending = null; state.api.refresh(); });
  }

  // rebuilds the theme from its definition (a flag change, or Reset); the
  // dialog follows the new runtime once it is there
  // newId: the rebuilt theme's id, when the definition renames it
  function rebuild(state, rt, def, newId, onTimeout) {
    const id = keyOf(state.api, rt);
    const target = newId || id;
    // a theme whose id other themes share is replaced by its runtime: replace(id) would take them all
    state.api.replace(id === themeIdOf(rt) ? id : rt, { definition: () => def });
    // only a theme that was not there before is the rebuilt one (until it is, "#n" may point at another)
    const before = new Set(themesOf(state.api));
    const t0 = Date.now();
    const wait = () => {
      const now = findTheme(state, target);
      if (now && !before.has(now)) {
        if (state.themeId === id) { state.themeId = target; renderTune(state); }
        const cf = state.config;
        if (cf && cf.themeId === id) {
          // rebuilt by another tool while the configurator has unapplied changes: keep them
          const keep = !cf.applying && cf.dirty.has(id) ? cf.models.get(id) : null;
          cf.applying = false;
          if (cf.first.has(id) && target !== id) cf.first.set(target, cf.first.get(id));
          cf.themeId = target;
          renderConfig(state, !keep);
        }
        const e = state.edit;
        if (e && e.themeId === id) {
          // rebuilt by tune while the editor has unapplied edits: keep them
          const keepText = !e.applying && e.editor && e.editor.getValue() !== e.shown ? e.editor.getValue() : null;
          e.applying = false;
          if (e.first.has(id) && target !== id) e.first.set(target, e.first.get(id));
          e.themeId = target;
          renderEdit(state, keepText == null);
          if (keepText != null && e.editor) { e.editor.setValue(keepText); e.dialog.querySelector('.ixgt-btns button:last-child').disabled = false; }
        }
        return;
      }
      if (Date.now() - t0 < 15000) setTimeout(wait, 100);
      else { if (state.edit) state.edit.applying = false; if (state.config) state.config.applying = false; if (onTimeout) onTimeout(); }
    };
    setTimeout(wait, 50);
  }

  function openTune(state, themeId, x, y) {
    injectCss();
    const rt = findTheme(state, themeId) || defaultTheme(state.api);
    if (!rt) { console.warn('[ixmaps-gl-tools] the map has no theme to tune'); return; }
    state.themeId = keyOf(state.api, rt);
    if (!state.dialog) {
      state.dialog = makeDialog('Tune', '', () => { state.dialog = null; });
      renderTune(state);
      placeAt(state.dialog, x != null ? x + 12 : 16, y != null ? y - 20 : 16);
    } else {
      renderTune(state);
    }
  }

  function makeDialog(title, cls, onClose) {
    const d = el('div', 'ixgt-dialog' + (cls ? ' ' + cls : ''));
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', title);
    d.innerHTML = '<div class="ixgt-head"><b>' + esc(title) + '</b><button type="button" aria-label="Close">&times;</button></div><div class="ixgt-body"></div><div class="ixgt-foot"></div>';
    d.querySelector('.ixgt-head button').addEventListener('click', () => { d.remove(); onClose(); });
    dragBy(d, d.querySelector('.ixgt-head'));
    document.body.appendChild(d);
    return d;
  }

  // a theme picker <select>, or the theme's title when there is one theme
  function themePicker(state, currentId, onPick) {
    const list = themesOf(state.api);
    const rt = findTheme(state, currentId);
    if (list.length <= 1) return el('div', 'ixgt-sub', esc(rt ? titleOf(rt) : ''));
    const sel = el('select');
    sel.setAttribute('aria-label', 'Theme');
    list.forEach(r => { const o = el('option', null, esc(titleOf(r))); o.value = keyOf(state.api, r); sel.appendChild(o); });
    sel.value = currentId;
    sel.addEventListener('change', () => onPick(sel.value));
    return sel;
  }

  // ------------------------------------------------------------------ edit

  // the code editor: Ace once loaded, a <textarea> until then (or offline)
  let acePromise = null;
  function loadAce() {
    if (global.ace && global.ace.edit) return Promise.resolve(global.ace);
    if (!acePromise) {
      acePromise = new Promise((resolve, reject) => {
        const url = (ixmaps.themeTools && ixmaps.themeTools.aceUrl) || ACE_URL;
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => {
          if (!global.ace) { reject(new Error('no ace')); return; }
          // modes and themes from the same folder
          try { global.ace.config.set('basePath', url.replace(/\/[^/]*$/, '')); } catch (e) { /* older Ace */ }
          resolve(global.ace);
        };
        s.onerror = () => reject(new Error('could not load ' + url));
        document.head.appendChild(s);
      });
      acePromise.catch(() => { acePromise = null; });
    }
    return acePromise;
  }

  function makeEditor(box, text, onApply, onChange) {
    const ta = el('textarea');
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'Theme definition (JSON)');
    ta.value = text;
    box.appendChild(ta);
    ta.addEventListener('input', onChange);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onApply(); }
      else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); onChange(); }
    });
    const ed = {
      kind: 'text',
      getValue: () => ta.value,
      setValue: v => { ta.value = v; },
      gotoIndex: i => { ta.focus(); ta.setSelectionRange(i, i); },
      focus: () => ta.focus(),
      destroy: () => {}
    };
    loadAce().then(ace => {
      if (!box.isConnected) return;
      const div = el('div');
      box.appendChild(div);
      const a = ace.edit(div, { mode: 'ace/mode/json', useWorker: false, tabSize: 2, useSoftTabs: true, showPrintMargin: false, fontSize: 12 });
      a.session.setValue(ta.value);
      a.session.on('change', onChange);
      a.commands.addCommand({ name: 'ixgtApply', bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter|Ctrl-Enter' }, exec: onApply });
      ta.remove();
      const ro = global.ResizeObserver ? new global.ResizeObserver(() => a.resize()) : null;
      if (ro) ro.observe(box);
      Object.assign(ed, {
        kind: 'ace',
        getValue: () => a.getValue(),
        setValue: v => { a.session.setValue(v); },
        gotoIndex: i => { const p = a.session.doc.indexToPosition(i, 0); a.focus(); a.gotoLine(p.row + 1, p.column, true); },
        focus: () => a.focus(),
        destroy: () => { if (ro) ro.disconnect(); a.destroy(); }
      });
      box.dataset.editor = 'ace';
    }, err => {
      console.warn('[ixmaps-gl-tools] the code editor (Ace) did not load — plain text editing:', err.message);
      box.dataset.editor = 'text';
    });
    return ed;
  }

  function openEdit(state, themeId, x, y) {
    injectCss();
    const rt = findTheme(state, themeId) || defaultTheme(state.api);
    if (!rt) { console.warn('[ixmaps-gl-tools] the map has no theme to edit'); return; }
    if (!state.edit) {
      const e = state.edit = { dialog: null, themeId: keyOf(state.api, rt), editor: null, kept: null, shown: null, drafts: new Map(), first: new Map(), applying: false };
      e.dialog = makeDialog('Edit theme', 'ixgt-edit', () => { if (e.editor) e.editor.destroy(); state.edit = null; });
      renderEdit(state, true);
      placeAt(e.dialog, x != null ? x + 12 : 16, y != null ? y - 20 : 16);
    } else {
      switchEdit(state, keyOf(state.api, rt));
    }
  }

  // shows another theme, keeping the edits of this one as a draft
  function switchEdit(state, id) {
    const e = state.edit;
    if (e.themeId === id) return;
    if (e.editor && e.shown != null && e.editor.getValue() !== e.shown) e.drafts.set(e.themeId, e.editor.getValue());
    e.themeId = id;
    renderEdit(state, false);
  }

  // fresh: the theme was just rebuilt — show its new definition, drop the draft
  function renderEdit(state, fresh) {
    const e = state.edit;
    if (!e) return;
    const d = e.dialog;
    const rt = findTheme(state, e.themeId) || defaultTheme(state.api);
    const body = d.querySelector('.ixgt-body');
    const foot = d.querySelector('.ixgt-foot');
    if (e.editor) { e.editor.destroy(); e.editor = null; }
    body.innerHTML = '';
    foot.innerHTML = '';
    if (!rt) { body.textContent = 'No theme on the map.'; return; }
    e.themeId = keyOf(state.api, rt);
    originOf(state, rt); // tune's Reset still goes back to the theme as first seen
    if (fresh) e.drafts.delete(e.themeId);
    body.appendChild(themePicker(state, e.themeId, id => switchEdit(state, id)));

    if (!rt._definition) { body.appendChild(el('div', 'ixgt-note', 'This theme has no definition to edit.')); return; }
    const words = typeWordsOf(rt.flags);
    // what is drawn: the definition with the values tuned since
    const current = patchedDefinition(rt._definition, rt._styleSet, null, words);
    const ed = toEditable(current);
    e.kept = ed.kept;
    e.shown = ed.text;
    // Revert goes back to the definition as this dialog first showed it
    if (!e.first.has(e.themeId)) e.first.set(e.themeId, current);

    const note = el('span', 'ixgt-note');
    const say = (msg, isError) => { note.textContent = msg; note.title = msg; note.classList.toggle('ixgt-error', !!isError); };
    const box = el('div', 'ixgt-code');
    body.appendChild(box);
    const dirty = () => e.editor && e.editor.getValue() !== e.shown;
    const onChange = () => { applyBtn.disabled = false; if (note.classList.contains('ixgt-error')) say(''); };
    const apply = () => {
      if (!e.editor) return;
      const r = fromEditable(e.editor.getValue(), e.kept);
      if (r.error) {
        say(r.error, true);
        if (r.pos != null) e.editor.gotoIndex(r.pos);
        return;
      }
      const id = (r.def.style && r.def.style.name) || (r.def.meta && r.def.meta.name) || e.themeId;
      applyBtn.disabled = revertBtn.disabled = true;
      say('rebuilding the theme…');
      e.applying = true;
      try {
        rebuild(state, rt, r.def, id, () => { say('the theme did not come back in 15 s — see the console; Revert restores it', true); revertBtn.disabled = false; });
      } catch (err) { e.applying = false; say(String(err && err.message || err), true); applyBtn.disabled = revertBtn.disabled = false; }
    };
    e.editor = makeEditor(box, e.drafts.get(e.themeId) || ed.text, apply, onChange);
    e.drafts.delete(e.themeId);

    const applyBtn = el('button', null, 'Apply');
    applyBtn.type = 'button';
    applyBtn.title = 'Rebuild the theme from this definition (Ctrl/Cmd+Enter)';
    applyBtn.disabled = !dirty();
    applyBtn.addEventListener('click', apply);
    const revertBtn = el('button', null, 'Revert');
    revertBtn.type = 'button';
    revertBtn.title = 'Back to the theme as this dialog first showed it';
    revertBtn.addEventListener('click', () => {
      const first = e.first.get(e.themeId);
      const firstText = toEditable(first).text;
      if (firstText === e.shown) {
        // the drawn theme is the first one: only the text goes back
        e.editor.setValue(e.shown); applyBtn.disabled = true; say('');
        return;
      }
      revertBtn.disabled = applyBtn.disabled = true;
      say('rebuilding the theme…');
      e.applying = true;
      const now = findTheme(state, e.themeId) || rt;
      const firstId = (first.style && first.style.name) || (first.meta && first.meta.name) || e.themeId;
      rebuild(state, now, first, firstId, () => say('the theme did not come back in 15 s — see the console', true));
    });
    if (ed.kept.size) say(ed.kept.size + ' value' + (ed.kept.size > 1 ? 's' : '') + ' kept as "<kept: …>" (inline data, functions)');
    else say(words);
    const btns = el('div', 'ixgt-btns');
    btns.appendChild(revertBtn);
    btns.appendChild(applyBtn);
    foot.appendChild(note);
    foot.appendChild(btns);
  }

  function dragBy(node, handle) {
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = node.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      const move = ev => placeAt(node, ev.clientX - dx, ev.clientY - dy);
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  // ------------------------------------------------------------------ config

  // the grammar registry (ixmaps-grammar), loaded on first use
  let grammar = null, grammarPromise = null;
  function loadGrammar() {
    if (grammar) return Promise.resolve(grammar);
    if (!grammarPromise) {
      const url = (ixmaps.themeTools && ixmaps.themeTools.grammarUrl) || GRAMMAR_URL;
      grammarPromise = fetch(url).then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); })
        .then(g => { grammar = g; return g; });
      grammarPromise.catch(() => { grammarPromise = null; });
    }
    return grammarPromise;
  }

  const SECTIONS = ['visual', 'type', 'style', 'binding', 'data', 'meta'];
  // a copy of the definition whose sections can be changed in place
  function configModel(def) {
    const m = Object.assign({}, def);
    for (const s of ['data', 'binding', 'style', 'meta']) m[s] = Object.assign({}, def[s] || {});
    return m;
  }
  // values the dialog shows but cannot edit (inline data, functions)
  function isKeptValue(section, v) {
    if (typeof v === 'function') return true;
    if (v && typeof v === 'object' && !isPlain(v)) return true;
    if (section === 'data' && v != null) {
      let n = Infinity;
      try { n = JSON.stringify(v).length; } catch (e) { /* not JSON */ }
      return n > KEEP_JSON_CHARS;
    }
    return false;
  }

  function openConfig(state, themeId, x, y) {
    injectCss();
    const rt = findTheme(state, themeId) || defaultTheme(state.api);
    if (!rt) { console.warn('[ixmaps-gl-tools] the map has no theme to configure'); return; }
    if (!state.config) {
      const c = state.config = { dialog: null, themeId: keyOf(state.api, rt), tab: 'visual', models: new Map(), dirty: new Set(), first: new Map(),
        added: new Map(), invalid: new Set(), applying: false };
      c.dialog = makeDialog('Configure theme', 'ixgt-config', () => { state.config = null; });
      renderConfig(state, false);
      placeAt(c.dialog, x != null ? x + 12 : 16, y != null ? y - 20 : 16);
      loadGrammar().then(() => { if (state.config === c) renderConfig(state, false); }, err => {
        console.warn('[ixmaps-gl-tools] the grammar registry did not load — the configurator shows the common keys only:', err.message);
        if (state.config === c) { c.noGrammar = true; renderConfig(state, false); }
      });
    } else if (state.config.themeId !== keyOf(state.api, rt)) {
      state.config.themeId = keyOf(state.api, rt);
      renderConfig(state, false);
    }
  }

  // fresh: the theme was just rebuilt — show its new definition
  function renderConfig(state, fresh) {
    const c = state.config;
    if (!c) return;
    const d = c.dialog;
    const rt = findTheme(state, c.themeId) || defaultTheme(state.api);
    const body = d.querySelector('.ixgt-body');
    const foot = d.querySelector('.ixgt-foot');
    const scroll = body.querySelector('.ixgt-panel') ? body.querySelector('.ixgt-panel').scrollTop : 0;
    body.innerHTML = '';
    foot.innerHTML = '';
    if (!rt) { body.textContent = 'No theme on the map.'; return; }
    c.themeId = keyOf(state.api, rt);
    originOf(state, rt);
    body.appendChild(themePicker(state, c.themeId, id => { c.themeId = id; renderConfig(state, false); }));
    if (!rt._definition) { body.appendChild(el('div', 'ixgt-note', 'This theme has no definition to configure.')); return; }
    const id = c.themeId;
    const current = patchedDefinition(rt._definition, rt._styleSet, null, typeWordsOf(rt.flags));
    if (!c.first.has(id)) c.first.set(id, current);
    if (fresh || !c.models.has(id)) {
      c.models.set(id, configModel(current));
      c.dirty.delete(id);
      c.added.delete(id);
      c.invalid.clear();
    }
    const model = c.models.get(id);
    const fields = fieldNamesOf(rt.features);

    const tabs = el('div', 'ixgt-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const s of SECTIONS) {
      const b = el('button', null, s);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.tab = s;
      b.setAttribute('aria-selected', String(c.tab === s));
      b.addEventListener('click', () => { c.tab = s; renderConfig(state, false); });
      tabs.appendChild(b);
    }
    body.appendChild(tabs);
    const panel = el('div', 'ixgt-panel');
    panel.dataset.section = c.tab;
    body.appendChild(panel);

    const note = el('span', 'ixgt-note');
    const say = (msg, isError) => { note.textContent = msg; note.title = msg; note.classList.toggle('ixgt-error', !!isError); };
    const applyBtn = el('button', null, 'Apply');
    const revertBtn = el('button', null, 'Revert');
    const changed = () => { c.dirty.add(id); applyBtn.disabled = c.invalid.size > 0; if (c.invalid.size) say('fix the marked value first', true); else say(''); };

    if (c.tab === 'visual') renderVisualPanel(panel, state, c, model, rt, changed);
    else if (c.tab === 'type') renderTypePanel(panel, model, changed);
    else renderSectionPanel(panel, c, model, c.tab, fields, changed);
    panel.scrollTop = scroll;

    applyBtn.type = revertBtn.type = 'button';
    applyBtn.title = 'Rebuild the theme with this configuration';
    applyBtn.disabled = !c.dirty.has(id) || c.invalid.size > 0;
    applyBtn.addEventListener('click', () => {
      const def = Object.assign({}, model, { style: Object.assign({}, model.style) });
      if (!String(def.style.type || '').trim()) { say('the theme needs a type', true); return; }
      for (const s of ['binding', 'meta']) if (def[s] && !Object.keys(def[s]).length) delete def[s];
      const newId = (def.style && def.style.name) || (def.meta && def.meta.name) || id;
      applyBtn.disabled = revertBtn.disabled = true;
      say('rebuilding the theme…');
      c.applying = true;
      try {
        rebuild(state, rt, def, newId, () => { say('the theme did not come back in 15 s — see the console; Revert restores it', true); revertBtn.disabled = false; });
      } catch (err) { c.applying = false; say(String(err && err.message || err), true); applyBtn.disabled = revertBtn.disabled = false; }
    });
    revertBtn.title = 'Back to the theme as this dialog first showed it';
    revertBtn.addEventListener('click', () => {
      const first = c.first.get(id);
      if (toEditable(first).text === toEditable(current).text) { c.models.delete(id); renderConfig(state, false); return; }
      revertBtn.disabled = applyBtn.disabled = true;
      say('rebuilding the theme…');
      c.applying = true;
      rebuild(state, rt, first, (first.style && first.style.name) || (first.meta && first.meta.name) || id, () => say('the theme did not come back in 15 s — see the console', true));
    });
    if (c.noGrammar) say('the grammar registry did not load: common keys only');
    else if (!grammar) say('loading the grammar registry…');
    else say(model.style.type || '');
    const btns = el('div', 'ixgt-btns');
    btns.appendChild(revertBtn);
    btns.appendChild(applyBtn);
    foot.appendChild(note);
    foot.appendChild(btns);
  }

  const glOf = (section, key) => {
    if (!grammar) return true;
    const r = registryKeys(grammar, section).find(e => e.key === key);
    return r ? r.gl : true;
  };
  function datalist(id, values) {
    let dl = document.getElementById(id);
    if (!dl) { dl = el('datalist'); dl.id = id; document.body.appendChild(dl); }
    dl.innerHTML = values.map(v => '<option value="' + esc(v.key || v) + '">' + (v.gl === false ? 'ixmaps-gl ignores it' : '') + '</option>').join('');
    return id;
  }

  function renderTypePanel(panel, model, changed) {
    const parts = typeParts(model.style.type);
    const setType = () => { model.style.type = joinType(parts.base, parts.flags); changed(); };
    const kindRow = el('div', 'ixgt-field');
    kindRow.innerHTML = '<label for="ixgt-kind">kind</label>';
    const sel = el('select');
    sel.id = 'ixgt-kind';
    const kinds = KINDS.includes(parts.base) || !parts.base ? KINDS : [parts.base, ...KINDS];
    sel.innerHTML = (parts.base ? '' : '<option value="">(none)</option>') + kinds.map(k => '<option>' + esc(k) + '</option>').join('');
    sel.value = parts.base;
    sel.addEventListener('change', () => { parts.base = sel.value; setType(); });
    kindRow.appendChild(sel);
    panel.appendChild(kindRow);

    const has = f => parts.flags.includes(f);
    const toggle = (f, on) => { parts.flags = parts.flags.filter(x => x !== f); if (on) parts.flags.push(f); setType(); };
    const curated = new Set();
    for (const [group, flags] of FLAG_GROUPS) {
      panel.appendChild(el('div', 'ixgt-sub', esc(group)));
      const box = el('div', 'ixgt-checks');
      for (const f of flags) {
        curated.add(f);
        const lab = el('label', null, `<input type="checkbox" data-flag="${f}"${has(f) ? ' checked' : ''}> ${f}`);
        if (!glOf('flags', f)) { lab.classList.add('ixgt-flat'); lab.title = 'ixmaps-gl ignores it (grammar registry)'; }
        lab.querySelector('input').addEventListener('change', ev => toggle(f, ev.target.checked));
        box.appendChild(lab);
      }
      panel.appendChild(box);
    }
    panel.appendChild(el('div', 'ixgt-sub', 'Other flags'));
    const chips = el('div', 'ixgt-checks');
    for (const f of parts.flags.filter(x => !curated.has(x))) {
      const chip = el('span', 'ixgt-chip' + (glOf('flags', f) ? '' : ' ixgt-flat'), esc(f) + ' <button type="button" aria-label="Remove ' + esc(f) + '">&times;</button>');
      chip.dataset.flag = f;
      chip.querySelector('button').addEventListener('click', () => { toggle(f, false); renderAgain(panel); });
      chips.appendChild(chip);
    }
    panel.appendChild(chips);
    const add = addRow('ixgt-dl-flags', grammar ? registryKeys(grammar, 'flags').filter(e => !curated.has(e.key) && !BASE_WORDS.includes(e.key)) : [], 'add a flag', v => {
      const f = v.toUpperCase();
      if (!f || BASE_WORDS.includes(f) || has(f)) return;
      toggle(f, true);
      renderAgain(panel);
    });
    panel.appendChild(add);
  }
  // the dialog re-renders from its model (after an add / remove)
  function renderAgain(panel) {
    const d = panel.closest('.ixgt-dialog');
    const s = maps.find(m => m.config && m.config.dialog === d);
    if (s) renderConfig(s, false);
  }

  function addRow(listId, entries, placeholder, onAdd) {
    const row = el('div', 'ixgt-add');
    const input = el('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    input.setAttribute('list', datalist(listId, entries));
    const b = el('button', null, 'Add');
    b.type = 'button';
    const go = () => { const v = input.value.trim(); if (v) onAdd(v); };
    b.addEventListener('click', go);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    row.appendChild(input);
    row.appendChild(b);
    return row;
  }

  function renderSectionPanel(panel, c, model, section, fields, changed) {
    const obj = model[section];
    const id = c.themeId;
    const addedKey = id + '|' + section;
    const added = c.added.get(addedKey) || [];
    const shown = new Set();
    const groups = (CURATED[section] || []).map(([name, rows]) => [name, rows.map(r => ({ key: r[0], kind: r[1], hint: r[2] }))]);
    // the keys the theme has that no group shows, and the ones added here
    const more = Object.keys(obj).filter(k => !(section === 'style' && k === 'type') && !curatedKind(section, k));
    for (const k of added) if (!more.includes(k) && !curatedKind(section, k)) more.push(k);
    if (more.length) groups.push(['More keys', more.map(k => ({ key: k, kind: isKeptValue(section, obj[k]) ? 'kept' : guessKind(obj[k]) }))]);
    groups.forEach(([name, rows], gi) => {
      const det = el('details');
      det.open = gi === 0 || name === 'More keys' || rows.some(r => obj[r.key] != null || added.includes(r.key));
      det.appendChild(el('summary', null, esc(name)));
      for (const r of rows) { shown.add(r.key); det.appendChild(fieldRow(c, obj, section, r, fields, changed)); }
      panel.appendChild(det);
    });
    const entries = grammar ? registryKeys(grammar, section).filter(e => !shown.has(e.key) && !(section === 'style' && e.key === 'type')) : [];
    panel.appendChild(addRow('ixgt-dl-' + section, entries, 'add a ' + section + ' key', k => {
      if (shown.has(k)) { const i = panel.querySelector('[data-key="' + CSS_ESC(k) + '"]'); if (i) { i.closest('details').open = true; i.focus(); } return; }
      c.added.set(addedKey, [...added, k]);
      renderAgain(panel);
    }));
  }
  const CSS_ESC = s => (global.CSS && global.CSS.escape ? global.CSS.escape(s) : String(s).replace(/"/g, '\\"'));

  function fieldRow(c, obj, section, r, fields, changed) {
    const { key, kind, hint } = r;
    const row = el('div', 'ixgt-field');
    const inputId = 'ixgt-f-' + section + '-' + key;
    const lab = el('label', null, esc(key));
    lab.htmlFor = inputId;
    if (hint) lab.title = hint;
    if (!glOf(section, key)) { lab.classList.add('ixgt-flat'); lab.title = (hint ? hint + ' — ' : '') + 'ixmaps-gl ignores it (grammar registry)'; }
    row.appendChild(lab);
    const v = obj[key];
    const wrap = el('div', 'ixgt-input');
    row.appendChild(wrap);
    const invalidKey = section + '|' + key;
    const set = (text, input) => {
      const p = parseValue(kind === 'field' || kind === 'datatype' || kind === 'area' || kind === 'color' ? 'text' : kind, text, obj[key]);
      if (p.error) { c.invalid.add(invalidKey); if (input) { input.classList.add('ixgt-bad'); input.title = p.error; } changed(); return; }
      c.invalid.delete(invalidKey);
      if (input) { input.classList.remove('ixgt-bad'); input.title = ''; }
      if (p.remove) delete obj[key]; else obj[key] = p.value;
      changed();
    };
    if (kind === 'kept') {
      wrap.appendChild(el('span', 'ixgt-note', esc(keptLabel(section + '.' + key, v))));
      return row;
    }
    if (kind === 'check') {
      const cb = el('input');
      cb.type = 'checkbox';
      cb.id = inputId;
      cb.dataset.key = key;
      cb.checked = formatValue('check', v);
      cb.addEventListener('change', () => set(cb.checked ? 'true' : '', null));
      wrap.appendChild(cb);
      return row;
    }
    let input;
    if (kind === 'area') { input = el('textarea'); input.rows = 3; }
    else { input = el('input'); input.type = 'text'; }
    input.id = inputId;
    input.dataset.key = key;
    input.value = formatValue(kind, v);
    if (hint) input.placeholder = hint;
    if (kind === 'field' && fields.length) input.setAttribute('list', datalist('ixgt-dl-fields', fields));
    if (kind === 'datatype') input.setAttribute('list', datalist('ixgt-dl-datatypes', grammar ? registryKeys(grammar, 'datatype').filter(e => e.gl) : ['csv', 'geojson', 'topojson', 'json', 'fgb', 'parquet']));
    input.addEventListener('input', () => { set(input.value, input); sync(); });
    wrap.appendChild(input);
    let sync = () => {};
    if (kind === 'color') {
      const pick = el('input');
      pick.type = 'color';
      pick.setAttribute('aria-label', key + ' color');
      sync = () => { const h = hex6(input.value); pick.value = h || '#000000'; pick.classList.toggle('ixgt-unset', !h); };
      pick.addEventListener('input', () => { input.value = pick.value; set(pick.value, input); sync(); });
      wrap.appendChild(pick);
    } else if (kind === 'colors') {
      const strip = el('span', 'ixgt-swatches');
      sync = () => {
        strip.innerHTML = '';
        input.value.split(',').map(s => s.trim()).forEach((s, i) => {
          const h = hex6(s);
          if (!h) return;
          const p = el('input');
          p.type = 'color';
          p.value = h;
          p.title = s;
          p.addEventListener('input', () => {
            const items = input.value.split(',').map(x => x.trim());
            items[i] = p.value;
            input.value = items.join(', ');
            set(input.value, input);
          });
          strip.appendChild(p);
        });
      };
      wrap.appendChild(strip);
    } else if (kind === 'range01') {
      const range = el('input');
      range.type = 'range';
      range.min = '0.05'; range.max = '1'; range.step = '0.05';
      range.setAttribute('aria-label', key);
      sync = () => { const n = Number(input.value); range.value = Number.isFinite(n) && input.value.trim() ? String(n) : '1'; range.classList.toggle('ixgt-unset', !input.value.trim()); };
      range.addEventListener('input', () => { input.value = range.value; set(range.value, input); sync(); });
      wrap.insertBefore(range, input);
    }
    sync();
    return row;
  }
  // "#abc" / "#aabbcc" (/ "#aabbccdd") as a color input's "#aabbcc", else null
  function hex6(s) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(s || '').trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1].slice(0, 6);
    return '#' + h.toLowerCase();
  }

  // ---- the Visual tab

  // the loader's visualization icons (vizIconSvg), in this dialog's colors
  function vizIcon(v) {
    const A = '#3b6fb6', M = '#888';
    const hex = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i; return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1); }).join(' ');
    const hexGrid = fn => { let out = '', n = 0; const r = 7.2; for (let c = 0; c < 5; c++) for (let k = 0; k < 3; k++) { const cx = 8 + c * 1.5 * r, cy = 9 + k * Math.sqrt(3) * r + (c % 2 ? Math.sqrt(3) / 2 * r : 0); if (cy <= 36) out += fn(cx, cy, r, n++); } return out; };
    let body = '';
    if (v === 'dot') [[10, 12], [22, 8], [34, 15], [48, 10], [16, 26], [28, 30], [40, 27], [54, 25], [8, 36], [47, 37]].forEach(p => { body += `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${A}"/>`; });
    else if (v === 'bubble') [[14, 28, 6], [27, 15, 10], [44, 29, 8], [52, 12, 4.5], [34, 35, 3.5], [8, 10, 3]].forEach(p => { body += `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2]}" fill="${A}" fill-opacity="0.45" stroke="${A}" stroke-width="1.2"/>`; });
    else if (v === 'hexbin') { const o = [0.15, 0.3, 0.55, 0.85, 0.4, 0.2, 0.7, 1, 0.6, 0.25, 0.35, 0.9, 0.5, 0.2, 0.1]; body = hexGrid((cx, cy, r, n) => `<polygon points="${hex(cx, cy, r - 0.8)}" fill="${A}" fill-opacity="${o[n % o.length]}"/>`); }
    else if (v === 'hexbin_sized') { const rs = [1.5, 3, 5, 6.2, 3.6, 2, 5.2, 6.4, 4.4, 2.2, 3, 5.8, 3.8, 1.8, 1.2]; body = hexGrid((cx, cy, r, n) => `<polygon points="${hex(cx, cy, r - 0.8)}" fill="none" stroke="${M}" stroke-opacity="0.45" stroke-width="0.8"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rs[n % rs.length]}" fill="${A}" fill-opacity="0.7"/>`); }
    else if (v === 'heatmap') [[22, 24], [44, 18]].forEach((c, i) => [16, 12, 8, 4].forEach(r => { body += `<circle cx="${c[0]}" cy="${c[1] + i * 2}" r="${r}" fill="${A}" fill-opacity="0.16"/>`; }));
    else if (v === 'mlheatmap') [[20, 26, 15], [44, 17, 12], [48, 31, 9]].forEach(c => { body += `<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}" fill="#2166ac" fill-opacity="0.16"/><circle cx="${c[0]}" cy="${c[1]}" r="${(c[2] * 0.66).toFixed(1)}" fill="#67a9cf" fill-opacity="0.45"/><circle cx="${c[0]}" cy="${c[1]}" r="${(c[2] * 0.4).toFixed(1)}" fill="#ef8a62" fill-opacity="0.85"/><circle cx="${c[0]}" cy="${c[1]}" r="${(c[2] * 0.2).toFixed(1)}" fill="#b2182b"/>`; });
    else if (v === 'kde') for (let b = 0; b < 4; b++) { const sc = [1, 0.76, 0.52, 0.28][b]; body += `<path transform="translate(32 21) scale(${sc}) translate(-32 -21)" fill="${A}" fill-opacity="0.2" stroke="${A}" stroke-opacity="0.55" stroke-width="${(0.9 / sc).toFixed(2)}" d="M9,22 C8,11 24,5 37,9 C51,13 58,24 50,32 C42,40 25,39 17,34 C11,30 9,27 9,22 Z"/>`; }
    else if (v === 'custom') body = `<text x="32" y="27" text-anchor="middle" font-size="16" fill="${M}" font-family="sans-serif">…</text>`;
    else {
      const polys = ['6,8 30,5 34,20 14,26', '30,5 58,10 54,24 34,20', '14,26 34,20 54,24 50,38 20,37', '6,8 14,26 20,37 8,34'];
      polys.forEach((p, i) => { body += v === 'choropleth' ? `<polygon points="${p}" fill="${A}" fill-opacity="${[0.2, 0.55, 0.9, 0.35][i]}" stroke="${A}" stroke-width="0.9"/>` : `<polygon points="${p}" fill="${A}" fill-opacity="0.06" stroke="${A}" stroke-width="1.4" stroke-linejoin="round"/>`; });
    }
    return '<svg viewBox="0 0 64 42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + body + '</svg>';
  }

  // the data helpers writeVisual needs, for a theme's runtime
  function visualData(rt) {
    const feats = (rt && rt.features) || [];
    const info = fieldInfoOf(feats);
    const internals = global.__ixmapsGlInternals || {};
    return {
      fields: info,
      isNumeric: f => { const e = info.find(x => x.name === f); return e ? e.numeric : true; },
      categories: f => categoriesOf(feats, f),
      normValue: f => normValueOf(feats, f),
      sweep: internals.flatColorSweep
    };
  }

  // style keys the Visual tab's sliders change live (as tune does); the rest wait for Apply
  const VISUAL_LIVE = ['fillopacity', 'scale', 'linewidth'];

  function renderVisualPanel(panel, state, c, model, rt, changed) {
    const data = visualData(rt);
    const vis = readVisual(model);
    if (!c.stashes) c.stashes = new Map();
    if (!c.stashes.has(c.themeId)) c.stashes.set(c.themeId, {});
    const stash = c.stashes.get(c.themeId);
    const isPoint = POINT_VIZ.includes(vis.viz) || (vis.viz === 'custom' && /CHART/.test(model.style.type || '') && model.binding && (model.binding.position || model.binding.geo));
    // the model is the dialog's: a change replaces its sections, then the tab is drawn again
    const commit = (def, redraw) => {
      Object.assign(model, { style: def.style, binding: def.binding });
      changed();
      if (redraw !== false) renderAgain(panel);
    };

    // ---- the visualization picker
    const pick = el('div', 'ixgt-viz');
    const btn = el('button', 'ixgt-viz-btn', vizIcon(vis.viz) + '<span>' + esc(VIZ_LABELS[vis.viz] || vis.viz) + (vis.viz === 'custom' ? ' <i>' + esc(typeParts(model.style.type).base) + '</i>' : '') + '</span><span class="ixgt-chev">▾</span>');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.dataset.viz = vis.viz;
    const pop = el('div', 'ixgt-viz-pop');
    pop.setAttribute('role', 'listbox');
    const choices = isPoint ? POINT_VIZ : [vis.viz];
    for (const v of choices) {
      const card = el('button', 'ixgt-viz-card' + (v === vis.viz ? ' ixgt-on' : ''), vizIcon(v) + '<span>' + esc(VIZ_LABELS[v]) + '</span>');
      card.type = 'button';
      card.dataset.viz = v;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', String(v === vis.viz));
      card.title = VIZ_LABELS[v] + (VIZ_HINTS[v] ? ' — ' + VIZ_HINTS[v] : '');
      card.addEventListener('click', () => { if (v !== vis.viz) commit(writeVisual(model, { viz: v }, data, stash)); else pop.classList.remove('ixgt-open'); });
      pop.appendChild(card);
    }
    if (!isPoint) pop.appendChild(el('div', 'ixgt-note', vis.viz === 'custom'
      ? 'This chart type has no counterpart here: change its type in the type tab.'
      : 'An area theme keeps its kind; the point visualizations need point data.'));
    btn.addEventListener('click', () => pop.classList.toggle('ixgt-open'));
    pick.appendChild(btn);
    if (VIZ_HINTS[vis.viz]) pick.appendChild(el('div', 'ixgt-note ixgt-hint', esc(VIZ_HINTS[vis.viz])));
    pick.appendChild(pop);
    panel.appendChild(pick);

    // ---- the fields
    const fieldSelect = (key, label, options, current, onPick) => {
      const row = el('div', 'ixgt-field');
      row.innerHTML = `<label for="ixgt-v-${key}">${esc(label)}</label>`;
      const s = el('select');
      s.id = 'ixgt-v-' + key;
      s.dataset.vkey = key;
      const opts = [...options];
      if (current != null && current !== '' && !opts.some(o => o.value === current)) opts.unshift({ value: current, label: current });
      s.innerHTML = opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
      s.value = current == null ? '' : current;
      s.addEventListener('change', () => onPick(s.value));
      row.appendChild(s);
      panel.appendChild(row);
    };
    const all = data.fields.map(f => ({ value: f.name, label: f.name + (f.numeric ? '  (number)' : '  (text)') }));
    const nums = data.fields.filter(f => f.numeric).map(f => ({ value: f.name, label: f.name }));
    const count = { value: '$item$', label: 'count of records' };
    const pos = model.binding && (model.binding.position || model.binding.geo || model.binding.lookup);
    if (pos) {
      const row = el('div', 'ixgt-field');
      row.innerHTML = `<label>${model.binding.lookup && !model.binding.position ? 'joined by' : 'position'}</label><span class="ixgt-note">${esc(pos)}</span>`;
      panel.appendChild(row);
    }
    if (isPoint || vis.viz === 'choropleth') {
      fieldSelect('value', vis.viz === 'choropleth' ? 'color by' : 'value (color)', isPoint ? [count, ...all] : all, vis.value, v => commit(writeVisual(model, { value: v }, data)));
    }
    if (isPoint && vis.viz !== 'dot' && vis.viz !== 'custom') {
      fieldSelect('size', vis.viz === 'heatmap' || vis.viz === 'mlheatmap' || vis.viz === 'kde' ? 'weight' : 'size', [count, ...nums], vis.size || (vis.value && data.isNumeric(vis.value) ? vis.value : '$item$'), v => commit(writeVisual(model, { size: v }, data)));
    }

    // ---- the colors: the theme's own, each editable, and the palettes
    const colorsBox = el('div', 'ixgt-vcolors');
    const cs = [].concat(model.style.colorscheme == null ? [] : model.style.colorscheme);
    const generated = cs.length > 2 && Number.isFinite(Number(cs[0]));
    const shown = generated ? schemeColorsOf(cs, data.sweep) : cs.map(String);
    const labels = vis.categorical && Array.isArray(model.style.values) ? model.style.values : null;
    const sw = el('div', 'ixgt-swatches ixgt-vsw');
    shown.forEach((col, i) => {
      const h = hex6(col);
      const p = el('input');
      p.type = 'color';
      p.value = h || '#000000';
      p.title = (labels ? labels[i] + ': ' : '') + col + (generated ? ' (generated — pick a palette to change)' : '');
      p.disabled = generated || !h;
      p.dataset.index = String(i);
      p.addEventListener('change', () => {
        const next = cs.map(String);
        next[i] = p.value;
        commit({ style: Object.assign({}, model.style, { colorscheme: next }), binding: model.binding });
      });
      sw.appendChild(p);
    });
    const row = el('div', 'ixgt-field');
    row.innerHTML = '<label>colors</label>';
    const right = el('div', 'ixgt-input');
    right.appendChild(sw);
    const palBtn = el('button', 'ixgt-pal-btn', 'palettes ▾');
    palBtn.type = 'button';
    right.appendChild(palBtn);
    row.appendChild(right);
    colorsBox.appendChild(row);
    const palList = el('div', 'ixgt-palettes');
    palBtn.addEventListener('click', () => {
      if (!palList.childNodes.length) {
        for (const [name, raw] of PALETTES) {
          const cols = paletteColors(raw, 9, data.sweep);
          if (!cols.length) continue;
          const item = el('button', 'ixgt-pal', '<span class="ixgt-pal-sw">' + cols.slice(0, 9).map(x => `<i style="background:${esc(x)}"></i>`).join('') + '</span><span>' + esc(name) + '</span>');
          item.type = 'button';
          item.dataset.palette = name;
          item.addEventListener('click', () => commit(withPalette(model, raw, data.sweep)));
          palList.appendChild(item);
        }
      }
      palList.classList.toggle('ixgt-open');
    });
    colorsBox.appendChild(palList);
    panel.appendChild(colorsBox);

    // ---- the sliders of this visualization
    const slider = (key, label, min, max, step, def, live) => {
      const r = el('div', 'ixgt-field');
      r.innerHTML = `<label for="ixgt-v-${key}">${esc(label)}</label>`;
      const w = el('div', 'ixgt-input');
      const range = el('input');
      range.type = 'range';
      range.id = 'ixgt-v-' + key;
      range.dataset.vkey = key;
      range.min = min; range.max = max; range.step = step;
      const cur = num(model.style[key]);
      range.value = String(Number.isFinite(cur) && cur > 0 ? cur : def);
      const out = el('input');
      out.type = 'text';
      out.className = 'ixgt-num';
      out.value = Number.isFinite(cur) && cur > 0 ? String(cur) : '';
      out.placeholder = String(def);
      out.setAttribute('aria-label', label + ' value');
      const set = v => {
        if (v === '' || v == null) delete model.style[key]; else model.style[key] = typeof model.style[key] === 'string' ? String(v) : v;
        changed();
        if (live && v !== '') applyLive(state, rt, { [key]: Number(v) });
      };
      range.addEventListener('input', () => { out.value = range.value; set(Number(range.value)); });
      out.addEventListener('change', () => { const n = Number(out.value); if (out.value.trim() === '') set(''); else if (Number.isFinite(n)) { range.value = String(n); set(n); } });
      w.appendChild(range);
      w.appendChild(out);
      r.appendChild(w);
      panel.appendChild(r);
    };
    panel.appendChild(el('div', 'ixgt-sub', 'Look'));
    slider('fillopacity', 'opacity', 0.05, 1, 0.05, 1, true);
    const v = vis.viz;
    if (['dot', 'bubble', 'hexbin', 'hexbin_sized', 'custom'].includes(v) && isPoint) slider('scale', 'size', 0.1, 5, 0.05, 1, true);
    if (v === 'bubble' || v === 'hexbin_sized') slider('sizepow', 'size ramp', 1, 3, 0.1, 2, false);
    if ((v === 'hexbin' || v === 'hexbin_sized') && !Array.isArray(model.style.aggregation)) slider('gridwidthpx', 'grid width (px)', 4, 100, 1, 15, false);
    if (v === 'heatmap') slider('radiuspx', 'radius (px)', 2, 150, 1, 30, false);
    if (v === 'mlheatmap') { slider('radiuspx', 'radius (px)', 1, 60, 1, 5, false); slider('intensity', 'intensity', 0.1, 5, 0.1, 1, false); }
    if (v === 'kde') slider('bandwidth', 'bandwidth (km)', 0.1, 50, 0.1, '', false);
    if (v === 'feature' || v === 'choropleth') slider('linewidth', 'line width', 0.2, 4, 0.1, 1, true);
    if (isPoint && !['heatmap', 'mlheatmap', 'kde'].includes(v)) {
      const box = el('div', 'ixgt-checks');
      const parts = typeParts(model.style.type);
      for (const f of ['GLOW', 'AURA', 'VALUES']) {
        const lab = el('label', null, `<input type="checkbox" data-vflag="${f}"${parts.flags.includes(f) ? ' checked' : ''}> ${f.toLowerCase()}`);
        lab.querySelector('input').addEventListener('change', ev => {
          const fl = parts.flags.filter(x => x !== f);
          if (ev.target.checked) fl.push(f);
          model.style.type = joinType(parts.base, fl);
          parts.flags = fl;
          changed();
        });
        box.appendChild(lab);
      }
      const sh = el('label', null, `<input type="checkbox" data-vkey="shadow"${formatValue('check', model.style.shadow) ? ' checked' : ''}> shadow`);
      sh.querySelector('input').addEventListener('change', ev => { if (ev.target.checked) model.style.shadow = true; else delete model.style.shadow; changed(); });
      box.appendChild(sh);
      panel.appendChild(box);
    }
  }

  function renderTune(state) {
    const d = state.dialog;
    if (!d) return;
    const rt = findTheme(state, state.themeId) || defaultTheme(state.api);
    const body = d.querySelector('.ixgt-body');
    const foot = d.querySelector('.ixgt-foot');
    body.innerHTML = '';
    foot.innerHTML = '';
    if (!rt) { body.textContent = 'No theme on the map.'; return; }
    state.themeId = keyOf(state.api, rt);
    const origin = originOf(state, rt);
    const words = typeWordsOf(rt.flags);

    body.appendChild(themePicker(state, state.themeId, id => { state.themeId = id; renderTune(state); }));

    const ctls = controlsFor(words);
    if (!ctls.length) body.appendChild(el('div', 'ixgt-note', 'No tune controls for this theme type (' + esc(words) + ').'));
    let checks = null, flags = null;
    for (const ctl of ctls) {
      if (ctl.kind === 'range' || ctl.kind === 'factor') {
        const row = el('div', 'ixgt-row');
        const inputId = 'ixgt-' + ctl.key;
        const value = ctl.kind === 'factor' ? (state.factors.get(state.themeId + '|' + ctl.key) || 1) : currentValue(rt.style, ctl);
        row.innerHTML = `<label for="${inputId}">${esc(ctl.label)}</label><input type="range" id="${inputId}" data-key="${ctl.key}" min="${ctl.min}" max="${ctl.max}" step="${ctl.step}"><output>${fmt(ctl, value)}</output>`;
        const input = row.querySelector('input');
        input.value = String(value);
        input.addEventListener('input', () => {
          const v = Number(input.value);
          row.querySelector('output').textContent = fmt(ctl, v);
          if (ctl.kind === 'factor') {
            state.factors.set(state.themeId + '|' + ctl.key, v);
            applyLive(state, rt, aggregationPatch(origin.style, v));
          } else applyLive(state, rt, { [ctl.key]: v });
        });
        body.appendChild(row);
      } else if (ctl.kind === 'check') {
        if (!checks) { checks = el('div', 'ixgt-checks'); body.appendChild(checks); }
        const on = rt.style[ctl.key] === true || rt.style[ctl.key] === 'true' || rt.style[ctl.key] === 1 || rt.style[ctl.key] === '1';
        const lab = el('label', null, `<input type="checkbox" data-key="${ctl.key}"${on ? ' checked' : ''}> ${esc(ctl.label)}`);
        if (ctl.hint) lab.title = ctl.hint;
        lab.querySelector('input').addEventListener('change', ev => applyLive(state, rt, { [ctl.key]: ev.target.checked }));
        checks.appendChild(lab);
      } else if (ctl.kind === 'flag') {
        if (!flags) {
          body.appendChild(el('div', 'ixgt-sub', 'Type flags'));
          flags = el('div', 'ixgt-checks');
          body.appendChild(flags);
        }
        const lab = el('label', null, `<input type="checkbox" data-flag="${ctl.key}"${hasWord(words, ctl.key) ? ' checked' : ''}> ${esc(ctl.label)}`);
        lab.title = 'rebuilds the theme';
        lab.querySelector('input').addEventListener('change', ev => {
          if (!rt._definition) { console.warn('[ixmaps-gl-tools] this theme has no definition to rebuild from'); ev.target.checked = !ev.target.checked; return; }
          flags.querySelectorAll('input').forEach(i => { i.disabled = true; });
          rebuild(state, rt, patchedDefinition(rt._definition, rt._styleSet, { [ctl.key]: ev.target.checked }, words));
        });
        flags.appendChild(lab);
      }
    }

    const reset = el('button', null, 'Reset');
    reset.type = 'button';
    reset.title = 'Back to the theme as it was first opened here';
    reset.addEventListener('click', () => {
      [...state.factors.keys()].filter(k => k.startsWith(state.themeId + '|')).forEach(k => state.factors.delete(k));
      if (origin.def) rebuild(state, rt, origin.def);
    });
    reset.disabled = !origin.def;
    const type = el('span', 'ixgt-note', esc(words));
    type.title = words;
    foot.appendChild(type);
    foot.appendChild(reset);
  }

  // ------------------------------------------------------------------ save

  // the saved page's model, from the live map: the view now, every theme as defined now
  function savedModel(state, title) {
    const api = state.api;
    const map = api.map;
    const notes = [];
    const got = typeof api.getMapOptions === 'function' ? api.getMapOptions() : null;
    const mapOpts = got ? got.map : { mapType: api.getMapTypeId ? api.getMapTypeId() : undefined };
    if (!got) notes.push('this engine has no getMapOptions(): the basemap is saved, the other map options are not');
    const base = document.baseURI || (global.location && global.location.href) || '';
    // the definition with the values tuned live since (tune's sliders change the style without a rebuild)
    const themes = themesOf(api).map(rt => rt._definition ? themeCode(patchedDefinition(rt._definition, rt._styleSet, null, typeWordsOf(rt.flags)), base)
      : { skipped: 'the engine holds no definition for it', label: titleOf(rt), warnings: [] });
    themes.forEach(t => t.warnings.forEach(w => notes.push(w)));
    const c = map.getCenter();
    const proj = typeof map.getProjection === 'function' ? map.getProjection() : null;
    const ver = global.__ixmapsGlInternals && global.__ixmapsGlInternals.IXMAPS_GL_VERSION;
    const attribution = api.getAttribution ? api.getAttribution() : '';
    return {
      title,
      engineUrl: SAVE_ENGINE_CDN + (ver ? '@' + ver : '') + '/ixmaps-gl.js',
      map: mapOpts,
      options: got ? got.options : {},
      center: { lat: c.lat, lng: c.lng },
      zoom: api.getZoom ? api.getZoom() : map.getZoom(),
      bearing: map.getBearing ? map.getBearing() : 0,
      pitch: map.getPitch ? map.getPitch() : 0,
      globe: !!(proj && proj.type === 'globe'),
      attribution: attribution && attribution !== mapOpts.attribution ? attribution : '',
      themes,
      notes,
      source: global.location && /^https?:/.test(global.location.protocol) ? global.location.href : '',
      saved: new Date().toISOString().slice(0, 10)
    };
  }

  function downloadText(text, fileName, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function copyText(text) {
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = el('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      if (ok) resolve(); else reject(new Error('the browser did not copy'));
    });
  }

  function openSave(state, x, y) {
    injectCss();
    if (state.save) { state.save.remove(); state.save = null; }
    const d = state.save = makeDialog('Save map', 'ixgt-save', () => { state.save = null; });
    const body = d.querySelector('.ixgt-body');
    const foot = d.querySelector('.ixgt-foot');
    const title0 = String(document.title || '').trim() || 'map';
    body.appendChild(el('p', 'ixgt-note', 'An HTML page with the basemap, the view and every theme as it is now. The page\'s own code (panels, buttons, scripts) is not part of it.'));
    const field = (label, value) => {
      const row = el('div', 'ixgt-field');
      const id = 'ixgt-save-' + label;
      row.innerHTML = '<label for="' + id + '">' + label + '</label><div class="ixgt-input"><input type="text" id="' + id + '"></div>';
      const input = row.querySelector('input');
      input.value = value;
      body.appendChild(row);
      return input;
    };
    const title = field('title', title0);
    const file = field('file', htmlFileName(title0));
    let fileEdited = false;
    file.addEventListener('input', () => { fileEdited = true; });
    title.addEventListener('input', () => { if (!fileEdited) file.value = htmlFileName(title.value); });
    const first = savedModel(state, title0);
    const warn = first.notes.concat(first.themes.filter(t => t.skipped).map(t => '"' + t.label + '" is left out: ' + t.skipped));
    if (warn.length) {
      const ul = el('ul', 'ixgt-warn');
      warn.forEach(w => ul.appendChild(el('li', null, esc(w))));
      body.appendChild(ul);
    }
    const note = el('span', 'ixgt-note', esc(first.themes.filter(t => !t.skipped).length + ' of ' + first.themes.length + ' themes'));
    const btns = el('span', 'ixgt-btns');
    const html = () => pageHtml(savedModel(state, title.value.trim() || 'map'));
    const copy = el('button', null, 'copy HTML');
    copy.type = 'button';
    copy.addEventListener('click', () => copyText(html()).then(() => { note.textContent = 'copied'; }, err => { note.textContent = 'not copied: ' + err.message; }));
    const save = el('button', null, 'download');
    save.type = 'button';
    save.addEventListener('click', () => {
      let name = file.value.trim() || htmlFileName(title.value);
      if (!/\.html?$/i.test(name)) name += '.html';
      downloadText(html(), name, 'text/html');
      note.textContent = 'saved ' + name;
    });
    btns.appendChild(copy);
    btns.appendChild(save);
    foot.appendChild(note);
    foot.appendChild(btns);
    placeAt(d, x != null ? x + 12 : 16, y != null ? y - 20 : 16);
    save.focus();
  }

  // ------------------------------------------------------------------ hook

  const origMap = ixmaps.Map;
  const wrappedMap = function () {
    const p = origMap.apply(this, arguments);
    // ixmaps.Map(id, {themetools: false}): this map has no tool bar
    const opt = arguments[1] && arguments[1].themetools;
    const off = opt === false || /^(false|0|off|no)$/i.test(String(opt == null ? '' : opt).trim());
    if (!off && p && typeof p.then === 'function') p.then(attach, () => {});
    return p;
  };
  ixmaps.Map = wrappedMap;

  // flat's ixmaps.popupTools(position): the tools of the last built map
  const lastState = () => maps[maps.length - 1] || null;
  if (typeof ixmaps.popupTools !== 'function') {
    ixmaps.popupTools = function () {
      const s = lastState();
      if (s) openTune(s, null);
    };
  }
  // flat's ixmaps.popupThemeConfigurator(): the config dialog of the last built map
  if (typeof ixmaps.popupThemeConfigurator !== 'function') {
    ixmaps.popupThemeConfigurator = function (themeId) {
      const s = lastState();
      if (s) openConfig(s, typeof themeId === 'string' ? themeId : null);
    };
  }
  // flat's ixmaps.popupThemeEditor(): the edit dialog of the last built map
  if (typeof ixmaps.popupThemeEditor !== 'function') {
    ixmaps.popupThemeEditor = function (themeId) {
      const s = lastState();
      if (s) openEdit(s, typeof themeId === 'string' ? themeId : null);
    };
  }

  ixmaps.themeTools = {
    version: VERSION,
    // opens the tune dialog of the last built map, for a theme id (default: the topmost theme)
    // gives a map built before this file loaded its context menu (the engine
    // calls it for ixmaps.Map(id, {themetools: true})); idempotent
    attach: api => { attach(api); return !!(api && api.__ixgtAttached); },
    // opens the tool bar of a map at a page position (clientX / clientY), for
    // the theme drawn there; the engine calls it for the right-click that
    // loaded this file
    menu: (api, x, y) => {
      attach(api);
      const s = maps.find(m => m.api === api);
      if (!s) return;
      const r = api.map.getContainer().getBoundingClientRect();
      showMenu(s, x, y, themeAt(api, x - r.left, y - r.top));
    },
    tune: (themeId) => { const s = lastState(); if (s) openTune(s, themeId == null ? null : themeId); },
    // opens the edit dialog of the last built map, for a theme id (default: the topmost theme)
    edit: (themeId) => { const s = lastState(); if (s) openEdit(s, themeId == null ? null : themeId); },
    // opens the config dialog of the last built map, for a theme id (default: the topmost theme)
    config: (themeId) => { const s = lastState(); if (s) openConfig(s, themeId == null ? null : themeId); },
    // opens the save dialog of the last built map
    save: () => { const s = lastState(); if (s) openSave(s); },
    // the last built map as a standalone HTML page (the text the save dialog downloads)
    mapHtml: (title) => { const s = lastState(); return s ? pageHtml(savedModel(s, title || String(document.title || '').trim() || 'map')) : null; },
    close: () => {
      closeMenu();
      maps.forEach(s => {
        if (s.dialog) { s.dialog.remove(); s.dialog = null; }
        if (s.edit) { if (s.edit.editor) s.edit.editor.destroy(); s.edit.dialog.remove(); s.edit = null; }
        if (s.config) { s.config.dialog.remove(); s.config = null; }
        if (s.save) { s.save.remove(); s.save = null; }
      });
    },
    // the code editor's script (Ace); set before the first edit to use another copy
    aceUrl: ACE_URL,
    // the grammar registry the configurator lists keys and flags from
    grammarUrl: GRAMMAR_URL,
    // pure helpers, for the unit tests
    _internals: { controlsFor, aggregationPatch, patchedDefinition, scaleWidth, currentValue, themeKind, typeWordsOf, toEditable, fromEditable,
      typeParts, joinType, guessKind, parseValue, formatValue, fieldNamesOf, registryKeys, configModel,
      readVisual, writeVisual, withPalette, paletteColors, paletteScheme, isFlatGradient, fieldInfoOf, categoriesOf, normValueOf, schemeColorsOf, PALETTES,
      jsLiteral, themeCode, pageHtml, htmlFileName, titleOf, keyOf }
  };
})(typeof window !== 'undefined' ? window : globalThis);
