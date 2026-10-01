// ═══════════════════════════════════════════════════════
//  ixmaps-loader-chat.js — free-form chat panel, lazy-loaded on first open
//  (see openLoaderChat() in ixmaps-loader_70.html)
//
//  Not an iframe embed of ixMaps' own Chat2Map app (app/Chat/) — that app's regex-based intent
//  router (ai_agent_prototype.js) and "match colors" handler are welded to its own theme/record
//  data model (dbRecords/indexA/itemA, changeThemeStyle) and global state, not portable as-is.
//  This re-implements the same PATTERN (classify the message, dispatch to a direct DOM/STATE
//  mutation for known commands, fall back to a free-form AI question otherwise) against this
//  app's own much simpler config-driven state, and reuses what already exists here rather than
//  duplicating it: callAIText/buildColorDomainGuidance/requestSemanticCategoryColors/
//  requestSemanticColorGradient (all in ixmaps-loader_70.html, themselves ported from
//  app/Chat/js/ai_agent_prototype.js earlier this session) are called directly as globals —
//  this file shares the host page's window scope, no postMessage/iframe boundary involved.
// ═══════════════════════════════════════════════════════

(function () {
  var panelBuilt = false;

  // ── command history: ↑/↓ in the input recall earlier messages, shell-style; persisted
  // across reloads (per-browser convenience only, so storage failures are just ignored) ──
  var HISTORY_KEY = 'ixmaps-loader-chat-history';
  var HISTORY_MAX = 50;
  var history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') || []; } catch (e) { history = []; }
  var histPos = history.length; // == history.length means "not browsing, editing the draft"
  var draft = '';

  function pushHistory(text) {
    if (history[history.length - 1] !== text) history.push(text);
    if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
    histPos = history.length;
    draft = '';
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {}
  }

  function recallHistory(input, dir) {
    if (!history.length) return;
    if (histPos === history.length) draft = input.value;
    histPos = Math.max(0, Math.min(history.length, histPos + dir));
    input.value = histPos === history.length ? draft : history[histPos];
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function buildPanel() {
    if (panelBuilt) return;
    panelBuilt = true;

    var root = document.createElement('div');
    root.id = 'chat-panel';
    root.innerHTML =
      '<div class="chat-panel-header">' +
        '<span>💬 Chat</span>' +
        '<button type="button" class="chat-panel-close" onclick="ixmapsChatClose()" title="Chiudi">✕</button>' +
      '</div>' +
      '<div class="chat-panel-messages" id="chat-panel-messages"></div>' +
      '<div class="chat-panel-input-row">' +
        '<input type="text" id="chat-panel-input" placeholder="Scrivi un comando o una domanda…" autocomplete="off">' +
        '<button type="button" id="chat-panel-send" onclick="ixmapsChatSend()" title="Invia">➤</button>' +
      '</div>';
    // docked as the last #body flex column, right of #map-wrap (see #chat-panel CSS)
    document.getElementById('body').appendChild(root);

    document.getElementById('chat-panel-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); window.ixmapsChatSend(); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); recallHistory(this, -1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); recallHistory(this, +1); }
    });

    appendMessage('assistant',
      'Ciao! Posso <strong>abbinare i colori</strong> ai valori attuali, cambiare la visualizzazione ' +
      '(es. <em>"colora per popolazione"</em>, <em>"cambia tipo in choropleth"</em>, <em>"dimensiona per superficie"</em>, ' +
      '<em>"tooltip nome"</em>), impostare l\'<strong>aggregazione spaziale</strong> (es. <em>"cambia tipo in hexbin"</em>, ' +
      '<em>"griglia 20px"</em>, <em>"aggrega con la media"</em>), aggiungere <strong>modificatori di stile</strong> ' +
      '(es. <em>"aggiungi glow"</em>, <em>"mostra i valori"</em>, <em>"linee bianche"</em>, <em>"dimensione normale 1"</em>), <strong>filtrare</strong> i dati (es. <em>"filtra dove popolazione &gt; 1000000"</em>, ' +
      '<em>"rimuovi i filtri"</em>), rispondere a domande sui dati caricati, oppure eseguire richieste libere ' +
      '(con una chiave AI configurata), anche <strong>analizzare i dati</strong> (es. <em>"analizza i dati"</em>, <em>"quale paese ha più capacità solare?"</em>; ' +
      'il <strong>codice</strong> della mappa: <em>"mostra codice"</em>, <em>"codice del layer"</em>, <em>"modifica codice"</em> (editor JSON); senza AI: <em>"statistiche"</em>, <em>"statistiche di capacity"</em>, <em>"quanti Solar in primary_fuel"</em>). ' +
      '<span style="color:var(--muted)">Per le analisi l\'AI riceve statistiche aggregate e risultati di query sui dati (mai le righe complete). ↑/↓ richiama i comandi precedenti.</span>');
  }

  function appendMessage(role, html) {
    var list = document.getElementById('chat-panel-messages');
    if (!list) return;
    var div = document.createElement('div');
    div.className = 'chat-msg chat-msg-' + role;
    div.innerHTML = html;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  // ── fuzzy lookups against the currently loaded dataset ──
  function findFieldByFuzzyName(text) {
    var norm = (text || '').toLowerCase().trim();
    var fields = (window.STATE && STATE.fields) || [];
    if (!norm) return null;
    var exact = fields.find(function (f) { return f.name.toLowerCase() === norm; });
    if (exact) return exact;
    return fields.find(function (f) {
      var n = f.name.toLowerCase();
      return norm.indexOf(n) !== -1 || n.indexOf(norm) !== -1;
    }) || null;
  }

  var VIZ_ALIASES = {
    'mappa a bolle': 'bubble', 'bolle': 'bubble', 'proporzionali': 'bubble',
    'choropleth': 'choropleth', 'coropletica': 'choropleth', 'aree colorate': 'choropleth',
    'punti': 'dot', 'punti semplici': 'dot',
    'heatmap': 'heatmap', 'calore': 'heatmap', 'densità': 'heatmap',
    // 'hexbin'/'waffle' are disabled in #viz-type (not supported by the GL engine) — the hexagon
    // words go to the supported, aggregating 'hexbin_sized' instead
    'esagoni': 'hexbin_sized', 'hexbin': 'hexbin_sized',
    'categorie': 'categorical', 'categorico': 'categorical', 'categorical': 'categorical',
    'feature': 'feature', 'poligoni': 'feature', 'linee': 'feature'
  };
  // viz keys the #viz-type <select> actually offers (disabled options excluded)
  function enabledVizKeys() {
    var sel = document.getElementById('viz-type');
    return Array.prototype.filter.call(sel.options, function (o) { return !o.disabled; })
      .map(function (o) { return o.value; });
  }
  function findVizTypeByFuzzyName(text) {
    var norm = (text || '').toLowerCase().trim();
    if (!norm) return null;
    var labels = window.VIZ_LABELS || {};
    var enabled = enabledVizKeys();
    var keys = Object.keys(labels).filter(function (k) { return enabled.indexOf(k) !== -1; });
    for (var i = 0; i < keys.length; i++) {
      var lbl = labels[keys[i]].toLowerCase();
      if (lbl.indexOf(norm) !== -1 || norm.indexOf(lbl) !== -1) return keys[i];
    }
    for (var a in VIZ_ALIASES) { if (norm.indexOf(a) !== -1) return VIZ_ALIASES[a]; }
    for (i = 0; i < keys.length; i++) { if (norm.indexOf(keys[i]) !== -1) return keys[i]; }
    return null;
  }

  // ── direct commands (no AI call — instant, mirrors chat2map's fast regex paths) ──
  // Each returns true/false: whether it actually resolved and applied the command. On false,
  // handleCommand() falls through to the AI classifier below instead of dead-ending — these
  // regexes are eager (e.g. "size"/"dimensione" alone) and will often capture noisy, real-world
  // phrasing (filler words, unrelated trailing text) that doesn't fuzzy-match any real field;
  // that's exactly the case the AI classifier exists to handle, not a final "not found" answer.
  function colorByCommand(fieldText) {
    var f = findFieldByFuzzyName(fieldText);
    if (!f) return false;
    document.getElementById('value-field').value = f.name;
    if (typeof drawMap === 'function') drawMap();
    appendMessage('assistant', 'Fatto — coloro per <strong>' + escHtml(f.name) + '</strong>.');
    return true;
  }

  function changeVizCommand(vizText) {
    var viz = findVizTypeByFuzzyName(vizText);
    if (!viz) return false;
    document.getElementById('viz-type').value = viz;
    if (typeof onVizChange === 'function') onVizChange();
    if (typeof drawMap === 'function') drawMap();
    appendMessage('assistant', 'Fatto — visualizzazione impostata su <strong>' + escHtml((window.VIZ_LABELS || {})[viz] || viz) + '</strong>.');
    return true;
  }

  function tooltipCommand(fieldText) {
    var f = findFieldByFuzzyName(fieldText);
    if (!f) return false;
    document.getElementById('title-field').value = f.name;
    if (typeof drawMap === 'function') drawMap();
    appendMessage('assistant', 'Fatto — tooltip impostato su <strong>' + escHtml(f.name) + '</strong>.');
    return true;
  }

  // 'bubble' uses a single field for both color and size (see onVizChange()'s size-row, only
  // shown for 'bivariate'); a bare "size by X" from 'bubble' switches to 'bivariate' instead of
  // overwriting the color field, so the current color choice survives
  function sizeByCommand(fieldText) {
    var f = findFieldByFuzzyName(fieldText);
    if (!f) return false;
    var viz = document.getElementById('viz-type').value;
    var valueField = document.getElementById('value-field').value;

    if (viz !== 'bivariate') {
      if (viz === 'bubble' && valueField && valueField !== f.name) {
        document.getElementById('viz-type').value = 'bivariate';
      } else if (viz !== 'bubble') {
        document.getElementById('viz-type').value =
          (valueField && valueField !== '__NONE__' && valueField !== f.name) ? 'bivariate' : 'bubble';
      }
      if (typeof onVizChange === 'function') onVizChange();
      viz = document.getElementById('viz-type').value;
    }

    if (viz === 'bivariate') document.getElementById('size-field').value = f.name;
    else document.getElementById('value-field').value = f.name; // plain bubble: one field drives both

    if (typeof drawMap === 'function') drawMap();
    appendMessage('assistant', 'Fatto — dimensiono le bolle in base a <strong>' + escHtml(f.name) + '</strong>.');
    return true;
  }

  // "spatial aggregation" for this single-layer app means one of the grid-based aggregate viz
  // types (heatmap/hexbin/hexbin_sized/waffle — see onVizChange()'s isAggregateViz) with a
  // chosen cell size (#grid-width, e.g. "10px"); switching the viz TYPE to one of these already
  // works via set_viz_type (colorByCommand's sibling commands / the AI classifier both accept
  // those vizType keys already), so the one genuinely new lever here is the cell size itself.
  function gridWidthCommand(sizeText) {
    var m = String(sizeText).match(/(\d+(?:\.\d+)?)\s*(px|%)?/i);
    if (!m) return false;
    var value = m[1] + (m[2] || 'px');
    var viz = document.getElementById('viz-type').value;
    // the cell size only applies to these two (buildLayer's style.aggregation); 'hexbin' and
    // 'waffle' are disabled in the GL loader, so the aggregating fallback is 'hexbin_sized'
    var isAggregateViz = (viz === 'heatmap' || viz === 'hexbin_sized');
    if (!isAggregateViz) {
      document.getElementById('viz-type').value = 'hexbin_sized';
      if (typeof onVizChange === 'function') onVizChange();
    }
    document.getElementById('grid-width').value = value;
    if (typeof drawMap === 'function') drawMap();
    appendMessage('assistant', 'Fatto — dimensione griglia impostata su <strong>' + escHtml(value) + '</strong>.');
    return true;
  }

  // ── style modifiers / basic styles / aggregation method — all land in STATE.typeModifiers /
  // STATE.styleOverrides (or an existing slider), which buildLayer's applyLayerTweaks() reads on
  // every redraw; the allowed vocabularies (LAYER_MODIFIERS, STYLE_OVERRIDE_KEYS,
  // AGGREGATION_METHODS) live in the main file, next to applyLayerTweaks ──
  var POINT_VIZ = ['bubble', 'bivariate', 'dot', 'categorical', 'heatmap', 'hexbin_sized'];
  function requirePointLayer() {
    if (POINT_VIZ.indexOf(document.getElementById('viz-type').value) !== -1) return true;
    appendMessage('assistant', 'Modificatori e stili si applicano solo ai layer a punti (bolle, punti, categorie, heatmap, hexbin) — non a feature/choropleth.');
    return false;
  }
  function redrawWithTweaks() {
    if (typeof renderLayerTweaks === 'function') renderLayerTweaks();
    if (typeof drawMap === 'function') drawMap();
  }

  var MODIFIER_ALIASES = {
    glow: 'GLOW', alone: 'GLOW', bagliore: 'GLOW',
    valori: 'VALUES', values: 'VALUES', numeri: 'VALUES',
    box: 'BOX', riquadro: 'BOX', cornice: 'BOX',
    titolo: 'TITLE', titoli: 'TITLE', title: 'TITLE',
    outlier: 'NOOUTLIER', outliers: 'NOOUTLIER',
    sizelog: 'SIZELOG', fixsize: 'FIXSIZE'
  };
  function setModifierCommand(mod, on) {
    if (!window.LAYER_MODIFIERS || !LAYER_MODIFIERS[mod]) return false;
    if (!requirePointLayer()) return true;
    var mods = (STATE.typeModifiers || []).filter(function (m) { return m !== mod; });
    if (on) mods.push(mod);
    STATE.typeModifiers = mods;
    redrawWithTweaks();
    appendMessage('assistant', 'Fatto — <strong>' + escHtml(mod) + '</strong> (' + escHtml(LAYER_MODIFIERS[mod]) + ') ' + (on ? 'attivato' : 'disattivato') + '.');
    return true;
  }
  // "aggiungi glow", "togli i valori", "rimuovi la legenda" — returns false (→ AI classifier)
  // when the word isn't a known modifier
  function modifierWordCommand(verb, word) {
    var on = !/^(togli|rimuovi|disattiva|nascondi|remove|disable|hide)/i.test(verb);
    var w = word.toLowerCase();
    if (w === 'legenda' || w === 'legend') return setModifierCommand('NOLEGEND', !on);
    var mod = MODIFIER_ALIASES[w] || (window.LAYER_MODIFIERS && LAYER_MODIFIERS[word.toUpperCase()] ? word.toUpperCase() : null);
    return mod ? setModifierCommand(mod, on) : false;
  }

  // basic styles: keys with an existing slider set the slider (panel stays the source of
  // truth); the rest become validated STATE.styleOverrides entries
  var STYLE_SLIDERS = { fillopacity: 'fill-opacity', opacity: 'fill-opacity', scale: 'chart-scale', sizepow: 'size-ramp' };
  function setStyleCommand(key, value) {
    key = String(key || '').toLowerCase();
    if (!requirePointLayer()) return true;
    var slider = STYLE_SLIDERS[key];
    if (slider) {
      var el = document.getElementById(slider);
      var n = parseFloat(value);
      if (!isFinite(n)) { appendMessage('assistant', 'Valore non valido per <strong>' + escHtml(key) + '</strong>.'); return true; }
      el.value = String(Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), n)));
      redrawWithTweaks();
      appendMessage('assistant', 'Fatto — <strong>' + escHtml(key) + '</strong> = ' + escHtml(el.value) + '.');
      return true;
    }
    var kind = window.STYLE_OVERRIDE_KEYS && STYLE_OVERRIDE_KEYS[key];
    if (!kind) return false;
    var v = value;
    if (kind === 'color' && !(window.CSS && CSS.supports && CSS.supports('color', String(v)))) {
      appendMessage('assistant', '"' + escHtml(String(v)) + '" non è un colore valido.'); return true;
    }
    if (kind === 'number') {
      v = parseFloat(String(v).replace(',', '.'));
      if (!isFinite(v) || (key === 'normalsizevalue' && v <= 0)) { appendMessage('assistant', 'Valore non valido per <strong>' + escHtml(key) + '</strong>' + (key === 'normalsizevalue' ? ' (deve essere &gt; 0)' : '') + '.'); return true; }
    }
    STATE.styleOverrides = STATE.styleOverrides || {};
    STATE.styleOverrides[key] = kind === 'string' ? String(v) : v;
    redrawWithTweaks();
    appendMessage('assistant', 'Fatto — stile <strong>' + escHtml(key) + '</strong> = ' + escHtml(String(v)) + '.');
    return true;
  }

  // "dimensione normale auto" — drop the override, back to the loader's own per-viz value
  // (computeNormValue: sample max of the size field)
  function normalSizeCommand(valueText) {
    if (/^(auto|reset|default|predefinit\w*)$/i.test(valueText)) {
      if (!requirePointLayer()) return true;
      if (STATE.styleOverrides) delete STATE.styleOverrides.normalsizevalue;
      redrawWithTweaks();
      appendMessage('assistant', 'Fatto — <strong>normalsizevalue</strong> torna automatico.');
      return true;
    }
    return setStyleCommand('normalsizevalue', valueText);
  }

  // aggregation method: SUM / MEAN (mutually exclusive); COUNT = neither (the GL engine counts
  // records when no size field is bound); MAX/MIN are not implemented in ixmaps-gl
  var AGG_WORDS = { media: 'MEAN', mean: 'MEAN', average: 'MEAN', avg: 'MEAN', somma: 'SUM', sum: 'SUM', totale: 'SUM',
                    conteggio: 'COUNT', count: 'COUNT', numero: 'COUNT', massimo: 'MAX', max: 'MAX', minimo: 'MIN', min: 'MIN' };
  function setAggregationCommand(method) {
    method = String(method || '').toUpperCase();
    method = AGG_WORDS[method.toLowerCase()] || method;
    if (method === 'MAX' || method === 'MIN') {
      appendMessage('assistant', 'Aggregazione <strong>' + method + '</strong> non è supportata dal motore GL — disponibili: somma, media, conteggio.');
      return true;
    }
    if (['SUM', 'MEAN', 'COUNT'].indexOf(method) === -1) return false;
    if (!requirePointLayer()) return true;
    var mods = (STATE.typeModifiers || []).filter(function (m) { return (window.AGGREGATION_METHODS || []).indexOf(m) === -1; });
    if (method !== 'COUNT') mods.push(method);
    STATE.typeModifiers = mods;
    redrawWithTweaks();
    var viz = document.getElementById('viz-type').value;
    appendMessage('assistant', 'Fatto — aggregazione: <strong>' + ({ SUM: 'somma', MEAN: 'media', COUNT: 'conteggio' })[method] + '</strong>.' +
      (viz === 'heatmap' || viz === 'hexbin_sized' ? '' : ' Per aggregare in celle usa ad es. <em>"griglia 20px"</em>.'));
    return true;
  }

  // filters reuse TABLE.fieldFilters/tableFieldFilter() exactly as-is (main file, TABLE section) —
  // that's the SAME mechanism the table/facets per-column filter inputs already drive, which in
  // turn schedules the live map filter (buildMapFilterClause()/applyMapFilter()) itself. No new
  // filter engine here, just structured extraction of {field, term} pairs from natural language;
  // "term" is that engine's own tiny DSL: ">N" "<N" ">=N" "<=N" "=N" "!=N", "/regex/flags",
  // "*wildcard*", or a plain substring — see matchFilterTerm()'s doc comment in the main file.
  function clearFilterCommand() {
    var names = Object.keys(TABLE.fieldFilters);
    if (!names.length) { appendMessage('assistant', 'Non ci sono filtri attivi.'); return true; }
    names.forEach(function (name) { tableFieldFilter(name, ''); });
    appendMessage('assistant', 'Fatto — filtri rimossi.');
    return true;
  }

  function infoCommand(kind) {
    if (!window.STATE || !STATE.rawData) { appendMessage('assistant', 'Nessun dataset caricato.'); return true; }
    var text;
    if (kind === 'count') {
      text = 'Il dataset ha <strong>' + STATE.rawData.length.toLocaleString() + '</strong> record.';
    } else if (kind === 'fields') {
      text = 'Campi disponibili: ' + (STATE.fields || []).map(function (f) {
        return '<strong>' + escHtml(f.name) + '</strong> (' + f.type + ')';
      }).join(', ') + '.';
    } else if (kind === 'source') {
      var url = STATE.dataUrl || '';
      text = 'Fonte dati: <a href="' + escHtml(url) + '" target="_blank" rel="noopener">' + (escHtml(url) || '—') + '</a> (' + (STATE.fileType || '').toUpperCase() + ').';
    } else { // 'config'
      text = 'Visualizzazione attuale: <strong>' + escHtml((window.VIZ_LABELS || {})[document.getElementById('viz-type').value] || document.getElementById('viz-type').value) + '</strong>' +
        ', campo valore: <strong>' + escHtml(document.getElementById('value-field').value || 'nessuno') + '</strong>' +
        ', tooltip: <strong>' + escHtml(document.getElementById('title-field').value) + '</strong>.';
      var activeFilters = Object.keys(TABLE.fieldFilters);
      if (activeFilters.length) {
        text += ' Filtri attivi: ' + activeFilters.map(function (n) { return escHtml(n) + ' ' + escHtml(TABLE.fieldFilters[n]); }).join(', ') + '.';
      }
    }
    appendMessage('assistant', text);
    return true;
  }

  // reuses requestSemanticCategoryColors/requestSemanticColorGradient as-is (see file header) —
  // both guard on STATE.suggestion.valueField matching the field just asked about, so it's
  // synced here first; feedback on success/failure already comes via their own showToast() calls
  function matchColorsCommand() {
    if (!window.STATE || !STATE.rawData) { appendMessage('assistant', 'Carica prima un dataset.'); return; }
    var valueField = document.getElementById('value-field').value;
    if (!valueField || valueField === '__NONE__') {
      appendMessage('assistant', 'Non c\'è un campo colore attivo da abbinare — imposta prima un "Campo valore".');
      return;
    }
    if (document.getElementById('ai-provider').value === 'none') {
      appendMessage('assistant', 'Serve una chiave AI configurata (pulsante <strong>✦ AI</strong> in alto) per abbinare i colori.');
      return;
    }
    STATE.suggestion = STATE.suggestion || {};
    STATE.suggestion.valueField = valueField;
    appendMessage('assistant', 'Cerco colori semanticamente coerenti per <strong>' + escHtml(valueField) + '</strong>…');

    if (typeof fieldIsNumeric === 'function' && fieldIsNumeric(valueField)) {
      requestSemanticColorGradient(valueField);
      return;
    }
    var values = [];
    try {
      values = STATE.dataTable.column(valueField).uniqueValues().slice(0, 50).map(String);
    } catch (e) {
      (STATE.rawData || []).forEach(function (r) {
        var v = String(r[valueField] || '');
        if (values.indexOf(v) === -1) values.push(v);
      });
      values = values.slice(0, 50);
    }
    requestSemanticCategoryColors(valueField, values);
  }

  // ── free-form fallback: a plain question about the current dataset/visualization ──
  // ── data analysis: the AI never sees raw rows — it gets a compact per-field profile (from
  // computeFacets(), the Facets panel's own statistics) and can ask for exact aggregates via
  // the "query" action, executed here, locally. Both cover the rows currently on the map:
  // the dataset after the active per-column filters (TABLE.fieldFilters, same as the map). ──
  function analysisRows() {
    var rows = STATE.rawData || [];
    var names = Object.keys((window.TABLE && TABLE.fieldFilters) || {});
    if (!names.length) return rows;
    var typeByName = {};
    (STATE.fields || []).forEach(function (f) { typeByName[f.name] = f.type; });
    return rows.filter(function (r) {
      return names.every(function (n) { return matchFilterTerm(r[n], TABLE.fieldFilters[n], typeByName[n]); });
    });
  }

  var profileCache = { key: null, text: '' };
  function fmtStat(n) {
    if (n == null || !isFinite(n)) return '–';
    return Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 100) / 100);
  }
  function buildDataProfile(rows) {
    var key = STATE.dataUrl + '|' + rows.length + '|' + JSON.stringify((window.TABLE && TABLE.fieldFilters) || {});
    if (profileCache.key === key) return profileCache.text;
    var facets = computeFacets(rows === STATE.rawData ? undefined : rows);
    var text = facets.slice(0, 80).map(function (f) {
      if (f.isNumeric) {
        return '- ' + f.name + ' (' + f.type + '): n=' + f.count + ', vuoti=' + f.undef +
          ', min=' + fmtStat(f.min) + ', max=' + fmtStat(f.max) + ', media=' + fmtStat(f.mean);
      }
      return '- ' + f.name + ' (' + f.type + '): ' + f.uniqueCount + ' valori distinti, vuoti=' + f.undef +
        '; top: ' + f.top.slice(0, 5).map(function (t) { return String(t.value).slice(0, 40) + ' (' + t.count + ')'; }).join(', ');
    }).join('\n');
    profileCache = { key: key, text: text };
    return text;
  }

  // {"action":"query","groupBy":f|null,"metric":"count|sum|mean|min|max","field":f,
  //  "filters":[{field,term}],"sort":"desc|asc","limit":N} → result object (or {error}) that goes
  // back to the AI. Fields are checked against the schema; filter terms use matchFilterTerm(),
  // the same syntax as the table/facets filter inputs.
  var QUERY_METRICS = ['count', 'sum', 'mean', 'min', 'max'];
  function runQuery(q) {
    var fieldsByName = {};
    (STATE.fields || []).forEach(function (f) { fieldsByName[f.name] = f; });
    var metric = String(q.metric || 'count').toLowerCase();
    if (QUERY_METRICS.indexOf(metric) === -1) return { error: 'metric must be one of ' + QUERY_METRICS.join(', ') };
    if (q.groupBy && !fieldsByName[q.groupBy]) return { error: 'unknown groupBy field "' + q.groupBy + '"' };
    if (metric !== 'count' && !fieldsByName[q.field]) return { error: 'unknown field "' + q.field + '"' };
    var filters = Array.isArray(q.filters) ? q.filters : [];
    for (var i = 0; i < filters.length; i++) {
      if (!filters[i] || !fieldsByName[filters[i].field]) return { error: 'unknown filter field "' + (filters[i] && filters[i].field) + '"' };
    }
    var limit = Math.max(1, Math.min(20, parseInt(q.limit, 10) || 10));
    var base = analysisRows();
    var rows = base.filter(function (r) {
      return filters.every(function (f) { return matchFilterTerm(r[f.field], String(f.term), fieldsByName[f.field].type); });
    });
    if (!rows.length) return { rowsMatched: 0, groups: 0, result: [], explanation: explainEmpty(base, filters) };

    var groups = {};
    rows.forEach(function (r) {
      var g = q.groupBy ? String(r[q.groupBy] == null || r[q.groupBy] === '' ? '(vuoto)' : r[q.groupBy]) : 'tutti';
      var acc = groups[g] || (groups[g] = { n: 0, sum: 0, min: Infinity, max: -Infinity, vals: 0 });
      acc.n++;
      if (metric !== 'count') {
        var v = parseFloat(String(r[q.field]).replace(',', '.'));
        if (isFinite(v)) { acc.vals++; acc.sum += v; if (v < acc.min) acc.min = v; if (v > acc.max) acc.max = v; }
      }
    });
    var out = Object.keys(groups).map(function (g) {
      var a = groups[g], value;
      if (metric === 'count') value = a.n;
      else if (!a.vals) value = null;
      else value = metric === 'sum' ? a.sum : metric === 'mean' ? a.sum / a.vals : metric === 'min' ? a.min : a.max;
      return { group: g, value: value == null ? null : Math.round(value * 1000) / 1000, rows: a.n };
    });
    var asc = String(q.sort || 'desc').toLowerCase() === 'asc';
    out.sort(function (a, b) { return asc ? (a.value - b.value) : (b.value - a.value); });
    return { rowsMatched: rows.length, groups: out.length, result: out.slice(0, limit) };
  }

  // why did 0 records match? Each filter tried on its own against the same base rows:
  // one that alone finds nothing → name it with the field's frequent values (from the profile);
  // otherwise the combination is too strict. Used by queries and by set_filter.
  function explainEmpty(base, filters) {
    var activeMap = base !== STATE.rawData && Object.keys((window.TABLE && TABLE.fieldFilters) || {}).length;
    if (!base.length) return 'nessun record sulla mappa: i filtri attivi escludono tutto';
    if (!filters || !filters.length) return '';
    var typeByName = {};
    (STATE.fields || []).forEach(function (f) { typeByName[f.name] = f.type; });
    var counts = filters.map(function (f) {
      return base.filter(function (r) { return matchFilterTerm(r[f.field], String(f.term), typeByName[f.field]); }).length;
    });
    var dead = filters.filter(function (f, i) { return counts[i] === 0; });
    if (dead.length) {
      return dead.map(function (f) {
        var facet = computeFacets(base).find(function (x) { return x.name === f.field; });
        var hint = '';
        if (facet && facet.isNumeric) hint = ' (valori tra ' + fmtStat(facet.min) + ' e ' + fmtStat(facet.max) + ')';
        else if (facet && facet.top) hint = '; valori frequenti: ' + facet.top.slice(0, 5).map(function (t) { return t.value; }).join(', ');
        return 'nessun valore di ' + f.field + ' corrisponde a "' + f.term + '"' + hint;
      }).join('; ') + (activeMap ? ' (tra i record già filtrati sulla mappa)' : '');
    }
    return 'ogni filtro trova record da solo (' + filters.map(function (f, i) { return f.field + ' ' + f.term + ': ' + counts[i]; }).join(', ') +
      ') ma insieme nessuno';
  }

  // compact HTML table under a 🔎 line / for local stats — all cell text escaped
  function htmlTable(head, rows, more) {
    return '<div class="chat-table-wrap"><table class="chat-table"><tr>' +
      head.map(function (h, i) { return '<th' + (i ? ' class="num"' : '') + '>' + escHtml(h) + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c, i) { return '<td' + (i ? ' class="num"' : '') + '>' + escHtml(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table>' + (more ? '<div class="chat-table-more">' + escHtml(more) + '</div>' : '') + '</div>';
  }
  function fmtNumIt(n) {
    if (n == null || !isFinite(n)) return '–';
    return Number(n).toLocaleString('it-IT', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });
  }
  // statistics table: 1M+ in short form ("5,71 Mln") so 6 columns fit the 380px panel; the
  // query result table keeps exact values (fmtNumIt)
  function fmtNumShort(n) {
    if (n == null || !isFinite(n)) return '–';
    if (Math.abs(n) < 1e6) return fmtNumIt(n);
    return Number(n).toLocaleString('it-IT', { notation: 'compact', maximumFractionDigits: 2 });
  }
  function renderResultTable(q, result) {
    if (!result || result.error || !result.result || !result.result.length) return '';
    var shown = result.result.slice(0, 10);
    var label = describeQuery(q).split(' per ')[0].split(' dove ')[0];
    var more = result.groups > shown.length ? '+' + (result.groups - shown.length).toLocaleString() + ' altri gruppi' : '';
    return htmlTable([q.groupBy || '', label, 'record'], shown.map(function (g) {
      return [g.group, fmtNumIt(g.value), g.rows.toLocaleString()];
    }), more);
  }

  // ── 1: local statistics — no AI call, works without a key ──
  // "statistiche" / "riepilogo" / "summary" [di <campo>] over the rows on the map
  function statsCommand(fieldText) {
    if (!window.STATE || !STATE.rawData) { appendMessage('assistant', 'Nessun dataset caricato.'); return true; }
    var rows = analysisRows();
    var facets = computeFacets(rows === STATE.rawData ? undefined : rows);
    if (fieldText) {
      var f = findFieldByFuzzyName(fieldText);
      if (!f) return false;
      facets = facets.filter(function (x) { return x.name === f.name; });
    }
    var num = facets.filter(function (x) { return x.isNumeric && x.type !== 'lat' && x.type !== 'lon'; });
    var txt = facets.filter(function (x) { return !x.isNumeric; });
    var nActive = Object.keys((window.TABLE && TABLE.fieldFilters) || {}).length;
    var html = '<strong>' + rows.length.toLocaleString() + '</strong> record' + (nActive ? ' (con i filtri attivi)' : '') + '.';
    if (num.length) {
      html += htmlTable(['campo', 'n', 'somma', 'media', 'min', 'max'], num.map(function (x) {
        return [x.name, fmtNumShort(x.count), fmtNumShort(x.mean == null ? null : x.mean * x.count), fmtNumShort(x.mean), fmtNumShort(x.min), fmtNumShort(x.max)];
      }));
    }
    if (txt.length) {
      var txtMore = txt.length > 8 ? ' … +' + (txt.length - 8) + ' altri' : '';
      html += (fieldText && !num.length ? '' : '<br>') + 'Campi di testo: ' + txt.slice(0, 8).map(function (x) {
        return '<strong>' + escHtml(x.name) + '</strong> ' + x.uniqueCount.toLocaleString() + ' valori' +
          (x.top && x.top[0] ? ' (più frequente: ' + escHtml(String(x.top[0].value).slice(0, 30)) + ', ' + x.top[0].count.toLocaleString() + ')' : '');
      }).join('; ') + txtMore + '.';
    }
    appendMessage('assistant', html);
    document.getElementById('chat-panel-messages').lastElementChild.classList.add('chat-msg-table');
    return true;
  }

  // "quanti Solar in primary_fuel" — same matching rules as the table/facets filter inputs
  function countInFieldCommand(valueText, fieldText) {
    var f = findFieldByFuzzyName(fieldText);
    if (!f || !valueText) return false;
    var base = analysisRows();
    var term = valueText.trim();
    var n = base.filter(function (r) { return matchFilterTerm(r[f.name], term, f.type); }).length;
    var text = '<strong>' + n.toLocaleString() + '</strong> record con ' + escHtml(f.name) + ' "' + escHtml(term) + '"' +
      ' su ' + base.length.toLocaleString() + '.';
    if (!n) text += ' ' + escHtml(explainEmpty(base, [{ field: f.name, term: term }])) + '.';
    appendMessage('assistant', text);
    return true;
  }

  function describeQuery(q) {
    var m = { count: 'conteggio', sum: 'somma', mean: 'media', min: 'minimo', max: 'massimo' }[String(q.metric || 'count').toLowerCase()] || q.metric;
    return m + (q.field && String(q.metric).toLowerCase() !== 'count' ? ' ' + q.field : ' record') +
      (q.groupBy ? ' per ' + q.groupBy : '') +
      (Array.isArray(q.filters) && q.filters.length ? ' dove ' + q.filters.map(function (f) { return f.field + ' ' + f.term; }).join(', ') : '') +
      (q.groupBy ? ' (top ' + Math.max(1, Math.min(20, parseInt(q.limit, 10) || 10)) + ')' : '');
  }

  // escaped first, then a tiny markdown subset: **bold**, "- " list lines, line breaks
  function formatAnswer(text) {
    return escHtml(text || '')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^\s*[-•]\s+(.*)$/gm, '• $1')
      .replace(/\n/g, '<br>');
  }

  var MAX_QUERIES = 3;
  var QUERY_GAP_MS = 1100;
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // the model sometimes wraps its JSON in prose — take the outermost {...}
  function parseActionJson(reply) {
    if (!reply) return null;
    try { return JSON.parse(reply); } catch (e) {}
    var a = reply.indexOf('{'), b = reply.lastIndexOf('}');
    if (a !== -1 && b > a) { try { return JSON.parse(reply.slice(a, b + 1)); } catch (e) {} }
    return null;
  }

  function buildDatasetContext() {
    if (!window.STATE || !STATE.rawData) return 'Nessun dataset caricato.';
    var rows = analysisRows();
    var filters = Object.keys((window.TABLE && TABLE.fieldFilters) || {});
    return [
      'Dataset: ' + STATE.rawData.length.toLocaleString() + ' record, tipo file ' + (STATE.fileType || '').toUpperCase() + '.' +
        (filters.length ? ' Filtri attivi: ' + filters.map(function (n) { return n + ' ' + TABLE.fieldFilters[n]; }).join(', ') +
          ' → ' + rows.length.toLocaleString() + ' record sulla mappa (profilo e query usano questi).' : ''),
      'Profilo dei campi:',
      buildDataProfile(rows),
      'Visualizzazione attuale: tipo=' + document.getElementById('viz-type').value +
        ', campo valore=' + (document.getElementById('value-field').value || 'nessuno') +
        ', campo etichetta=' + document.getElementById('title-field').value +
        ', schema colori=' + document.getElementById('color-scheme').value
    ].join('\n');
  }

  // ── free-form fallback: ask the AI to CLASSIFY the message first, not just answer it ──
  // The regex fast-paths above only catch clean phrasings ("colora per X"); real messages carry
  // filler words ("cambia la dimensione delle bolle in base alla circonferenza del fusto") that
  // those patterns can't reliably strip. Rather than silently degrading to "here's some prose,
  // go do it yourself in your GIS tool" (the actual failure this was built to fix), the model is
  // asked to return ONE structured action from a fixed, validated vocabulary — the real
  // "structured query" idea this chat was meant to bring in, just implemented against this
  // app's own state instead of chat2map's. A field/vizType the model returns is always checked
  // against the real current schema/VIZ_LABELS before being applied — never trusted blindly.
  function freeformAsk(text) {
    if (document.getElementById('ai-provider').value === 'none') {
      appendMessage('assistant', 'Per richieste libere serve una chiave AI configurata (pulsante <strong>✦ AI</strong> in alto). Nel frattempo posso eseguire comandi diretti come "colora per …", "cambia tipo in …", "dimensiona per …", "tooltip …".');
      return;
    }
    var fieldNames = (STATE.fields || []).map(function (f) { return f.name; });
    var vizKeys = enabledVizKeys();
    var systemMsg = [
      'You are an assistant embedded in a geospatial data-loading tool. Decide whether the ',
      'user message is a REQUEST TO CHANGE the map visualization, or something else (a question, ',
      'small talk, an unsupported request). Respond with ONLY a single JSON object, no extra text:',
      '{"action":"set_value_field","field":"<exact field name>"} — color/value the map by a field',
      '{"action":"set_size_field","field":"<exact field name>"} — size bubbles by a field (bivariate)',
      '{"action":"set_title_field","field":"<exact field name>"} — set the tooltip field',
      '{"action":"set_viz_type","vizType":"<exact viz key>"} — change the visualization type',
      '{"action":"set_grid_width","value":"<e.g. \\"20px\\">"} — spatial aggregation cell size, for heatmap/hexbin_sized (switches to hexbin_sized first if the current vizType is not one of those)',
      '{"action":"set_modifier","modifier":"<modifier>","on":true|false} — turn a chart style modifier on/off. modifier MUST be one of: ' +
        Object.keys(window.LAYER_MODIFIERS || {}).filter(function (k) { return (window.AGGREGATION_METHODS || []).indexOf(k) === -1; })
          .map(function (k) { return k + ' (' + LAYER_MODIFIERS[k] + ')'; }).join(', '),
      '{"action":"set_style","key":"<style key>","value":<value>} — set a basic style. key MUST be one of: fillopacity (0.1-1), scale (0.2-3, chart size multiplier), sizepow (1-3), ' +
        Object.keys(window.STYLE_OVERRIDE_KEYS || {}).map(function (k) { return k + ' (' + STYLE_OVERRIDE_KEYS[k] + ')'; }).join(', ') +
        '. Colors as CSS colors, e.g. "#ffffff" or "white". normalsizevalue (> 0) is the data value drawn at the normal symbol size — lower it to make all symbols bigger for the same value, raise it to make them smaller (default: the size field\'s maximum).',
      '{"action":"set_aggregation","method":"SUM|MEAN|COUNT"} — how aggregated points/cells combine their values (sum, mean/average, count of records). MAX/MIN are not supported: use "answer" to say so.',
      '{"action":"set_filter","filters":[{"field":"<exact field name>","term":"<term>"}, ...]} — filter the map/table to only matching rows. term syntax: ">N" "<N" ">=N" "<=N" "=N" "!=N" for a numeric comparison against N, or plain text for a case-insensitive substring match (e.g. a region/category name), or "*wildcard*" using * and ? as wildcards.',
      '{"action":"clear_filter"} — remove all active filters',
      '{"action":"match_colors"} — give the current value field\'s values/classes semantically meaningful colors (e.g. energy source → its typical color, land use → its typical map color)',
      '{"action":"answer","text":"<answer, in Italian>"} — anything else: data questions and analyses (based on the field profile and your query results — never invent numbers that neither shows), or requests you cannot fulfill',
      'field MUST be exactly one of: ' + fieldNames.join(', '),
      'vizType MUST be exactly one of: ' + vizKeys.join(', '),
      '{"action":"query","groupBy":"<field or null>","metric":"count|sum|mean|min|max","field":"<numeric field, not needed for count>","filters":[{"field":"<field>","term":"<term, same syntax as set_filter>"}],"sort":"desc|asc","limit":<1-20>} — compute an exact aggregate over the data locally. You get the result back and can then answer or query again (at most ' + MAX_QUERIES + ' queries). Use this for any data/analysis question that needs exact numbers, rankings, or per-group comparisons — never guess numbers.',
      'For "analyze the data"-style requests: use the field profile above plus a few queries, then answer with a short structured analysis in Italian (key facts, distributions, notable groups). In "answer" text you may use **bold** and "- " list lines.',
      'If no listed field/vizType clearly matches, use "answer" instead of guessing.'
    ].join('\n');
    var prompt = buildDatasetContext() + '\n\nMessaggio utente: ' + text;
    appendMessage('assistant', '<em style="color:var(--muted)">…</em>');
    var thinkingEl = document.getElementById('chat-panel-messages').lastElementChild;

    // query loop: each "query" reply is run locally and its result appended to the prompt, up
    // to MAX_QUERIES; rounds are spaced QUERY_GAP_MS apart (provider rate limits, see the 429
    // retry in callAIText)
    var queriesRun = 0, limitNoted = false;
    function round(p) {
      return callAIText(p, systemMsg, 900).then(function (reply) {
        var parsed = parseActionJson(reply);
        if (!parsed || !parsed.action) {
          thinkingEl.innerHTML = reply ? formatAnswer(reply) : 'Nessuna risposta disponibile.';
          return;
        }
        if (parsed.action !== 'query') { applyStructuredAction(parsed, thinkingEl); return; }
        if (queriesRun >= MAX_QUERIES) {
          // one "answer now" reminder; a model that still insists on querying gets stopped here
          if (limitNoted) { thinkingEl.innerHTML = 'Analisi interrotta: troppe query richieste dall\'AI. Prova una domanda più specifica.'; return; }
          limitNoted = true;
          return delay(QUERY_GAP_MS).then(function () {
            return round(p + '\n\nLimite di query raggiunto: rispondi ora con "answer" usando i risultati già ottenuti.');
          });
        }
        queriesRun++;
        var result = runQuery(parsed);
        var line = document.createElement('div');
        line.className = 'chat-msg chat-msg-assistant';
        line.style.cssText = 'color:var(--muted);font-size:11.5px;padding:4px 10px';
        line.textContent = '🔎 ' + describeQuery(parsed) + (result.error ? ' — errore: ' + result.error : ' → ' + result.rowsMatched.toLocaleString() + ' record') +
          (result.explanation ? ' — ' + result.explanation : '');
        thinkingEl.parentNode.insertBefore(line, thinkingEl);
        var table = renderResultTable(parsed, result);
        if (table) {
          var tableEl = document.createElement('div');
          tableEl.className = 'chat-msg chat-msg-assistant chat-msg-table';
          tableEl.innerHTML = table;
          thinkingEl.parentNode.insertBefore(tableEl, thinkingEl);
        }
        return delay(QUERY_GAP_MS).then(function () {
          return round(p + '\n\nQuery ' + queriesRun + ': ' + JSON.stringify(parsed) + '\nRisultato: ' + JSON.stringify(result));
        });
      });
    }
    round(prompt).catch(function (err) {
      console.error('[ixmaps-loader chat] AI request failed:', err);
      thinkingEl.innerHTML = 'Errore nella richiesta AI' + (err && err.message ? ': ' + escHtml(err.message) : '.');
    });
  }

  function applyStructuredAction(action, msgEl) {
    if (STATE.codeMode && action.action !== 'answer') setTimeout(codeModeNote, 0);
    var field = (STATE.fields || []).find(function (f) { return f.name === action.field; });

    if (action.action === 'set_value_field' && field) {
      document.getElementById('value-field').value = field.name;
      if (typeof drawMap === 'function') drawMap();
      msgEl.innerHTML = 'Fatto — coloro per <strong>' + escHtml(field.name) + '</strong>.';
    } else if (action.action === 'set_size_field' && field) {
      sizeByCommand(field.name); // reuse the bubble/bivariate switching logic above
      msgEl.parentNode.removeChild(msgEl); // sizeByCommand appends its own confirmation message
    } else if (action.action === 'set_title_field' && field) {
      document.getElementById('title-field').value = field.name;
      if (typeof drawMap === 'function') drawMap();
      msgEl.innerHTML = 'Fatto — tooltip impostato su <strong>' + escHtml(field.name) + '</strong>.';
    } else if (action.action === 'set_modifier' && action.modifier) {
      msgEl.parentNode.removeChild(msgEl); // the command appends its own message
      if (!setModifierCommand(String(action.modifier).toUpperCase(), action.on !== false)) {
        appendMessage('assistant', 'Il modificatore <strong>' + escHtml(String(action.modifier)) + '</strong> non è supportato.');
      }
    } else if (action.action === 'set_style' && action.key) {
      msgEl.parentNode.removeChild(msgEl);
      if (!setStyleCommand(action.key, action.value)) {
        appendMessage('assistant', 'Lo stile <strong>' + escHtml(String(action.key)) + '</strong> non è supportato.');
      }
    } else if (action.action === 'set_aggregation' && action.method) {
      msgEl.parentNode.removeChild(msgEl);
      if (!setAggregationCommand(action.method)) {
        appendMessage('assistant', 'Metodo di aggregazione <strong>' + escHtml(String(action.method)) + '</strong> non supportato.');
      }
    } else if (action.action === 'set_viz_type' && window.VIZ_LABELS && VIZ_LABELS[action.vizType] &&
               enabledVizKeys().indexOf(action.vizType) !== -1) {
      document.getElementById('viz-type').value = action.vizType;
      if (typeof onVizChange === 'function') onVizChange();
      if (typeof drawMap === 'function') drawMap();
      msgEl.innerHTML = 'Fatto — visualizzazione impostata su <strong>' + escHtml(VIZ_LABELS[action.vizType]) + '</strong>.';
    } else if (action.action === 'set_grid_width' && action.value) {
      var gwHandled = gridWidthCommand(action.value);
      if (gwHandled) msgEl.parentNode.removeChild(msgEl); // gridWidthCommand appends its own confirmation
      else msgEl.innerHTML = 'Non ho capito quale dimensione di griglia usare.';
    } else if (action.action === 'set_filter' && Array.isArray(action.filters) && action.filters.length) {
      var applied = [];
      action.filters.forEach(function (f) {
        var fld = (STATE.fields || []).find(function (sf) { return sf.name === f.field; });
        if (fld && f.term) { tableFieldFilter(fld.name, String(f.term)); applied.push(fld.name + ' ' + f.term); }
      });
      var onMap = applied.length ? analysisRows().length : 0;
      msgEl.innerHTML = applied.length
        ? 'Fatto — filtro applicato: <strong>' + escHtml(applied.join(', ')) + '</strong> → ' + onMap.toLocaleString() + ' record. Guarda i risultati in Tabella/Facets.' +
          (onMap ? '' : '<br>' + escHtml(explainEmpty(STATE.rawData || [], Object.keys(TABLE.fieldFilters).map(function (n) { return { field: n, term: TABLE.fieldFilters[n] }; }))) + '.')
        : 'Non sono riuscito a individuare un campo valido per il filtro richiesto.';
    } else if (action.action === 'clear_filter') {
      Object.keys(TABLE.fieldFilters).forEach(function (name) { tableFieldFilter(name, ''); });
      msgEl.innerHTML = 'Fatto — filtri rimossi.';
    } else if (action.action === 'match_colors') {
      msgEl.parentNode.removeChild(msgEl); // matchColorsCommand appends its own messages
      matchColorsCommand();
    } else if (action.action === 'answer') {
      msgEl.innerHTML = formatAnswer(action.text || '');
    } else {
      // action named a field/vizType that doesn't actually exist in the schema — don't guess
      msgEl.innerHTML = 'Non sono sicuro di come applicare questa richiesta ai dati caricati.';
    }
  }

  // matchColorsCommand's trigger phrase is deliberate/low-ambiguity (unlike the field/vizType
  // fuzzy-matchers below) and always gives a meaningful response even when it "fails" (missing
  // value field, no AI key) — so it always counts as handled, no AI-classifier fallthrough.
  var COMMAND_PATTERNS = [
    // "modifica codice" / "edit code" → the JSON layer editor (main file, openCodeEditor)
    { ro: true, re: /^\s*(?:modifica|edita|apri\s+l'editor\s+del|edit|open)\s+(?:il\s+|the\s+)?(?:codice|code|json|layer)(?:\s+(?:del|dei)\s+layer)?\s*[?.!]?\s*$/i, handler: function () { return editCodeCommand(); } },
    // before the generic "dimensiona/size …" pattern below, which would otherwise try "normale 1" as a field name
    { re: /(?:normal\s*size\w*|normalsizevalue|dimensione\s+normale|valore\s+normale)\D{0,20}?(\d+(?:[.,]\d+)?|auto|reset|default|predefinit\w*)/i, handler: function (m) { return normalSizeCommand(m[1]); } },
    { re: /\b(match|abbina|coordina)\w*\b.{0,25}?\bcolou?r|\bcolori?\s+semantic|\bsemantic\w*\s+colou?r/i, handler: function () { matchColorsCommand(); return true; } },
    { re: /(?:colora|colour|color)\s*(?:by|per|con|in base a)?\s+(.+)/i, handler: function (m) { return colorByCommand(m[1]); } },
    { re: /(?:cambia|change)\s+(?:il\s+)?(?:tipo|type|visualizzazione|viz)\s*(?:a|in|to)?\s+(.+)/i, handler: function (m) { return changeVizCommand(m[1]); } },
    { re: /(?:tooltip|etichetta|label)\s+(?:per\s+|for\s+)?(.+)/i, handler: function (m) { return tooltipCommand(m[1]); } },
    { re: /(?:dimension\w*|size)\s*(?:by|per|con|in base a)?\s+(.+)/i, handler: function (m) { return sizeByCommand(m[1]); } },
    { re: /(?:griglia|grid|cella|cell)\D*?(\d+(?:\.\d+)?\s*(?:px|%)?)/i, handler: function (m) { return gridWidthCommand(m[1]); } },
    // filter-clear and the info queries below never need an AI call — chat2map itself answers
    // these kinds of questions straight from its own state too, no LLM round-trip
    { re: /(?:rimuovi|togli|cancella|reset|clear|remove)\s+(?:tutti\s+)?(?:i\s+|il\s+)?filtr\w*/i, handler: function () { return clearFilterCommand(); } },
    // style modifiers ("aggiungi glow", "togli i valori", "nascondi la legenda") and the
    // aggregation method ("aggrega con la media") — both fall through to the AI on unknown words
    { re: /\b(aggiungi|attiva|metti|mostra|add|enable|show|togli|rimuovi|disattiva|nascondi|remove|disable|hide)\s+(?:il\s+|lo\s+|la\s+|le\s+|l'|i\s+|gli\s+|the\s+)?([a-zà-ù]+)/i, handler: function (m) { return modifierWordCommand(m[1], m[2]); } },
    { re: /aggreg\w*\s+(?:con|per|come|in|by|as|using)?\s*(?:la\s+|il\s+|lo\s+|the\s+)?(media|mean|average|avg|somma|sum|totale|conteggio|count|massimo|max|minimo|min)\b/i, handler: function (m) { return setAggregationCommand(m[1]); } },
    { ro: true, re: /quant\w+\s+(?:record|righe|rows)|numero di record|row count|how many (?:records|rows)/i, handler: function () { return infoCommand('count'); } },
    { ro: true, re: /che campi|quali campi|elenco (?:dei )?campi|list.*fields|what fields/i, handler: function () { return infoCommand('fields'); } },
    { ro: true, re: /fonte dati|data source|url dei dati|dataset url|che (?:file|url) è/i, handler: function () { return infoCommand('source'); } },
    { ro: true, re: /configurazione attuale|visualizzazione attuale|filtri attivi|current (?:config|viz)/i, handler: function () { return infoCommand('config'); } },
    // "mostra codice" / "show code" / "codice html" / "codice del layer" — before the stats/AI paths
    { ro: true, re: /^\s*(?:mostra(?:mi)?|dammi|visualizza|show|get|give)?\s*(?:il\s+|the\s+)?(?:codice|code)(?:\s+(?:html|della mappa|of the map|ixmaps))?\s*[?.!]?\s*$|^\s*(?:mostra(?:mi)?|dammi|show)?\s*(?:il\s+|the\s+)?(?:codice\s+html|html\s+code)\s*$/i, handler: function () { return showCodeCommand(false); } },
    { ro: true, re: /^\s*(?:mostra(?:mi)?|dammi|show)?\s*(?:il\s+|the\s+)?(?:codice\s+(?:del|dei)\s+layer|layer\s+code|theme\s+code|codice\s+del\s+tema)\s*[?.!]?\s*$/i, handler: function () { return showCodeCommand(true); } },
    // local statistics / counts — no AI call
    { ro: true, re: /^\s*(?:mostra\s+(?:le\s+)?|show\s+(?:the\s+)?)?(?:statistic\w*|riepilogo|riassunto|sommario|summary|summarize|stats)(?:\s+(?:di|del|della|dei|delle|per|of|for)\s+(.+?))?\s*[?.!]?\s*$/i, handler: function (m) { return statsCommand(m[1]); } },
    { ro: true, re: /^\s*quant[ieao]\s+(.+?)\s+(?:ci sono\s+)?(?:in|nel campo|nel|per)\s+([\w.]+)\s*\??\s*$/i, handler: function (m) { return countInFieldCommand(m[1], m[2]); } }
  ];

  function handleCommand(text) {
    for (var i = 0; i < COMMAND_PATTERNS.length; i++) {
      var m = text.match(COMMAND_PATTERNS[i].re);
      if (m && COMMAND_PATTERNS[i].handler(m)) {
        if (STATE.codeMode && !COMMAND_PATTERNS[i].ro) codeModeNote();
        return;
      }
    }
    freeformAsk(text);
  }

  window.ixmapsChatOpen = function () {
    buildPanel();
    document.getElementById('chat-panel').classList.add('active');
    document.getElementById('chat-panel-input').focus();
  };
  window.ixmapsChatClose = function () {
    var p = document.getElementById('chat-panel');
    if (p) p.classList.remove('active');
  };
  // ── "mostra codice": the current map as a standalone ixmaps page (generateMapCode() in the
  // main file, from the layers drawMap() just defined), with copy + download ──
  function showCodeCommand(layersOnly) {
    if (!STATE.hasDrawnMap) { appendMessage('assistant', 'Crea prima la mappa.'); return true; }
    appendMessage('assistant', '<em style="color:var(--muted)">…</em>');
    var msgEl = document.getElementById('chat-panel-messages').lastElementChild;
    generateMapCode({ layersOnly: layersOnly }).then(function (code) {
      if (!code) { msgEl.innerHTML = 'Nessun layer da mostrare.'; return; }
      msgEl.classList.add('chat-msg-table');
      msgEl.innerHTML = (layersOnly
        ? 'Codice dei layer (<code>map.layer(…)</code>, da usare dentro <code>ixmaps.Map(…).then(map =&gt; { … })</code>):'
        : 'Pagina HTML autonoma con la mappa attuale (vista, basemap, layer, filtri, modificatori). I dati vengono caricati dall\'URL originale.') +
        '<div class="chat-code-actions"><button type="button" data-act="copy">⧉ Copia</button><button type="button" data-act="download">⬇ Scarica</button><button type="button" data-act="edit" title="Editor JSON dei layer accanto alla mappa">✎ Modifica</button></div>' +
        '<pre class="chat-code"></pre>';
      var pre = msgEl.querySelector('pre');
      pre.textContent = code;
      // colored once highlight.js is there; plain text (still fine) if it can't load
      loadHighlighter().then(function (hljs) {
        try {
          pre.innerHTML = hljs.highlight(code, { language: layersOnly ? 'javascript' : 'xml', ignoreIllegals: true }).value;
        } catch (e) { console.warn('[ixmaps-loader chat] highlighting failed:', e); }
      }, function () {});
      var fileName = (STATE.dataUrl.split('/').pop() || 'mappa').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') + (layersOnly ? '_layer.js' : '_ixmaps.html');
      msgEl.querySelector('[data-act="copy"]').onclick = function () {
        var btn = this;
        navigator.clipboard.writeText(code).then(function () { btn.textContent = '✓ Copiato'; },
          function () { btn.textContent = 'Copia non riuscita'; });
      };
      msgEl.querySelector('[data-act="edit"]').onclick = function () { editCodeCommand(); };
      msgEl.querySelector('[data-act="download"]').onclick = function () {
        var url = URL.createObjectURL(new Blob([code], { type: layersOnly ? 'text/javascript' : 'text/html;charset=utf-8' }));
        var a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      };
      var list = document.getElementById('chat-panel-messages');
      list.scrollTop = list.scrollHeight;
    }).catch(function (err) {
      msgEl.innerHTML = 'Errore nella generazione del codice: ' + escHtml(err && err.message || String(err));
    });
    return true;
  }
  // highlight.js (cdnjs, common bundle: xml + javascript), fetched on first use only.
  // Rejects if it can't load — callers then just keep the plain text.
  var HLJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
  var hljsPromise = null;
  function loadHighlighter() {
    if (window.hljs) return Promise.resolve(window.hljs);
    if (!hljsPromise) {
      hljsPromise = new Promise(function (resolve, reject) {
        var sc = document.createElement('script');
        sc.src = HLJS_URL;
        sc.onload = function () { window.hljs ? resolve(window.hljs) : reject(new Error('hljs missing')); };
        sc.onerror = function () { hljsPromise = null; reject(new Error('highlight.js failed to load')); };
        document.head.appendChild(sc);
      });
    }
    return hljsPromise;
  }

  // code mode (JSON layer editor applied): panel-changing commands still update the panel
  // state, but the map shows the edited layers until "Torna alla configurazione" — say so
  function codeModeNote() {
    appendMessage('assistant', '<span style="color:var(--muted)">Modalità codice attiva: la modifica vale per la configurazione e si vedrà tornando a essa (pulsante nel pannello). Per cambiare la mappa ora, modifica il JSON nell\'editor.</span>');
  }
  function editCodeCommand() {
    if (!STATE.hasDrawnMap) { appendMessage('assistant', 'Crea prima la mappa.'); return true; }
    openCodeEditor();
    appendMessage('assistant', 'Editor aperto accanto alla mappa: le modifiche al JSON si applicano da sole quando sono valide (o con <strong>Applica</strong>). Errori e avvisi della grammatica ixmaps compaiono sotto l\'editor.');
    return true;
  }

  // the "</>" button in the config panel (showMapCode() in the main file)
  window.ixmapsChatShowCode = function () { showCodeCommand(false); };

  window.ixmapsChatIsOpen = function () {
    var p = document.getElementById('chat-panel');
    return !!(p && p.classList.contains('active'));
  };
  window.ixmapsChatSend = function () {
    var input = document.getElementById('chat-panel-input');
    var text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    pushHistory(text);
    appendMessage('user', escHtml(text));
    handleCommand(text);
  };
})();
