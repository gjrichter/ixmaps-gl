#!/usr/bin/env node
// Compatibility report: which themes of real ixmaps-flat project files
// ixmaps-gl could render, and which missing features block the rest.
//
//   node project-report.mjs [file-or-dir ...]   default: the local project folders below
//   --trusted <url prefix> (repeatable): count data.ext processing scripts under
//     it as runnable, as a page's .options({trustedscripts}) would make them
//
// Every theme is translated (projectThemeToDefinition) and normalized
// (normalizeTheme) by the real engine, validated against the shared grammar
// for engine=gl, and checked for blockers the grammar can't see (code gl never
// runs, missing data source, joins to flat's own SVG map layers). Writes
// test/out/project-compat.md and prints a summary. Nothing is loaded or run.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const DEFAULT_SOURCES = [
  path.join(HOME, 'Sites/ixmaps/dev/flat_multi/ixmaps/projects'),
  path.join(HOME, 'Repositories/GitHub/viz'),
];
const VALIDATOR = path.resolve(TEST, '..', '..', 'ixmaps-grammar', 'dist', 'validate.mjs');
const tilde = p => p.replace(HOME, '~');

// ------------------------------------------------------------ inputs
function projectFiles(sources) {
  const out = [];
  const rec = p => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) if (!['node_modules', '.git'].includes(e)) rec(path.join(p, e));
    } else if (p.endsWith('.json') && st.size < 5e6) {
      try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j && (Array.isArray(j.themes) || j.theme)) out.push(p); } catch { /* not JSON */ }
    }
  };
  sources.forEach(rec);
  return out.sort();
}

// ------------------------------------------------------------ engine + validator
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' }, URL,
  document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } } };
win.window = win; win.globalThis = win;
vm.runInNewContext(fs.readFileSync(path.resolve(TEST, '..', 'ixmaps-gl.js'), 'utf8'), win, { filename: 'ixmaps-gl.js' });
const { projectThemeToDefinition, normalizeTheme, isTrustedScriptUrl } = win.__ixmapsGlInternals;
if (!fs.existsSync(VALIDATOR)) { console.error(`validator not found: ${VALIDATOR} (sibling ixmaps-grammar checkout)`); process.exit(2); }
const { createValidator, version: grammarVersion } = await import(pathToFileURL(VALIDATOR).href);

const GENERIC_MAP = /generic\/(mercator|orthographic)\.svg$/i;

// Flags that pick WHAT is drawn — real ixmaps-flat's base types and the chart
// shapes its maptheme.js drawChart() dispatches on. A missing one blocks a
// theme; any other unsupported flag is a modifier gl ignores (FAST, LOCKED,
// TITLE, BOX — the frame around a PLOT/BAR chart, ...) and only makes the
// theme "partial".
const SHAPE_FLAGS = new Set(['FEATURE', 'FEATURES', 'CHOROPLETH', 'CHART', 'DOT', 'BLANK', 'USER', 'PIE', 'DONUT',
  'STARBURST', 'WAFFLE', 'BUBBLE', 'SQUARE', 'LABEL', 'SYMBOL', 'SEQUENCE', 'PLOT', 'PLOTXY', 'PLOTX', 'PLOTY', 'PLOTYX',
  'STAR', 'LINES', 'AREA', 'BUFFER', 'BAR', 'BARS', 'VECTOR', 'BEZIER', 'QUAD', 'WMS', 'IMAGE', 'GAUGE']);
// Shapes gl draws only in combination — the grammar checks flag by flag and
// can't see this: gl draws PLOT charts only on an aggregated grid
// (GRIDSIZE); flat's per-item PLOT (one chart per point/shape) is missing.
function comboShapeGaps(flags) {
  const gaps = [];
  if (flags.has('PLOT') && !flags.has('GRIDSIZE')) gaps.push('PLOT per item (without GRIDSIZE)');
  return gaps;
}

function assessMap(project) {
  const m = project.map || {};
  const notes = [];
  if (project.required || project.require) notes.push('loads scripts (`required`) — never run by gl');
  const svg = typeof m.map === 'string' ? m.map : '';
  if (svg && !GENERIC_MAP.test(svg)) notes.push(`flat SVG map \`${svg.split('/').pop()}\` — not available in gl`);
  if (m.basemap) notes.push(`basemap "${m.basemap}" → gl default basemap`);
  return notes;
}

function assessTheme(theme, project) {
  const def = projectThemeToDefinition(theme);
  const spec = normalizeTheme(def);
  const findings = [];
  createValidator({ engine: 'gl', onFinding: f => findings.push(f) }).theme(def, {});
  const blockers = [];
  const data = def.data || {};
  // a script the PROJECT names vs a function the host PAGE defines
  // a processing script (data.ext on a loaded file) under --trusted runs, as
  // with the page's .options({trustedscripts}); relative paths resolve
  // against the page in gl — unknown here, so they count as untrusted
  const extRuns = data.ext && data.type !== 'ext' && /^https?:/.test(String(data.ext)) && isTrustedScriptUrl(String(data.ext), TRUSTED);
  if (data.ext && !extRuns) blockers.push(data.type === 'ext'
    ? 'data from a broker script the project names (`dbtableExt`, type "ext") — not supported'
    : 'data processed by a script the project names (`dbtableExt`) — not run (not trusted)');
  else if (data.type === 'ext') blockers.push('data from a page function `ixmaps.<name>()` (`ext`, no script)');
  if (data.process) blockers.push('`data.process` function — never run');
  if (!data.url && !data.obj && !data.query && data.type !== 'ext' && !data.ext) blockers.push('no data source');
  const isFeature = spec.flags.has('FEATURE') || spec.flags.has('FEATURES');
  const featureLayers = new Set((project.themes || []).filter(t => /\bFEATURES?\b/.test(String((t.style || {}).type || t.type || ''))).map(t => t.layer));
  if (!isFeature) {
    const g = spec.geometry;
    if (!g) blockers.push(`no position binding — flat joins it to map layer \`${theme.layer}\` by item id`);
    else if (g.kind === 'join' && !featureLayers.has(theme.layer)) blockers.push(`joins to flat SVG map layer \`${theme.layer}\` (no FEATURE theme with that name)`);
  }
  const unsupported = findings.filter(f => f.code === 'gl-unsupported');
  const unsupportedFlags = unsupported.filter(f => f.section === 'flags' && SHAPE_FLAGS.has(f.keyword)).map(f => f.keyword)
    .concat(comboShapeGaps(spec.flags));
  // data.name (flat's table/cache name) and data.cache are bookkeeping flat
  // needs and gl doesn't — reported by the grammar, but no effect on output
  const IGNORABLE = new Set(['dataKeys:name', 'dataKeys:cache']);
  const unsupportedOther = unsupported.filter(f => !(f.section === 'flags' && SHAPE_FLAGS.has(f.keyword)))
    .map(f => `${f.section}:${f.keyword}`).filter(k => !IGNORABLE.has(k));
  const unknown = findings.filter(f => f.severity === 'error').map(f => f.keyword);
  const verdict = blockers.length || unsupportedFlags.length ? 'blocked' : (unsupportedOther.length ? 'partial' : 'ok');
  return { layer: theme.layer, type: spec.typeStr, verdict, blockers, unsupportedFlags, unsupportedOther, unknown };
}

// ------------------------------------------------------------ run
const argv = process.argv.slice(2);
const TRUSTED = [];
for (let i = argv.indexOf('--trusted'); i !== -1; i = argv.indexOf('--trusted')) TRUSTED.push(...argv.splice(i, 2).slice(1));
const sources = argv.length ? argv.map(p => path.resolve(p)) : DEFAULT_SOURCES;
const files = projectFiles(sources);
const results = files.map(f => {
  const project = JSON.parse(fs.readFileSync(f, 'utf8'));
  const themes = project.themes || (project.theme ? [project.theme] : []);
  return { file: f, mapNotes: assessMap(project), themes: themes.map(t => assessTheme(t, project)) };
});

const allThemes = results.flatMap(r => r.themes);
const count = v => allThemes.filter(t => t.verdict === v).length;
const tally = new Map();
const bump = k => tally.set(k, (tally.get(k) || 0) + 1);
for (const t of allThemes) {
  for (const b of t.blockers) bump(b.replace(/`[^`]*`/g, '…'));
  for (const f of t.unsupportedFlags) bump(`chart shape / base type ${f}`);
}
const ranking = [...tally.entries()].sort((a, b) => b[1] - a[1]);
// what would unblock a theme if it were the ONLY thing fixed
const sole = new Map();
for (const t of allThemes.filter(x => x.verdict === 'blocked')) {
  const reasons = [...t.blockers.map(b => b.replace(/`[^`]*`/g, '…')), ...t.unsupportedFlags.map(f => `chart shape / base type ${f}`)];
  if (reasons.length === 1) sole.set(reasons[0], (sole.get(reasons[0]) || 0) + 1);
}
const soleRanking = [...sole.entries()].sort((a, b) => b[1] - a[1]);

const md = [];
md.push(`# ixmaps-gl ↔ ixmaps-flat project compatibility`, '');
md.push(`Grammar ${grammarVersion}; ${files.length} project files, ${allThemes.length} themes: **${count('ok')} ok**, ${count('partial')} partial (renders, some keys ignored), **${count('blocked')} blocked**.`, '');
md.push('## What blocks the most themes', '', '| themes | blocker |', '|---:|---|');
for (const [k, n] of ranking) md.push(`| ${n} | ${k} |`);
md.push('', '## Themes blocked by ONE thing only (fixing it alone would unblock them)', '', '| themes | the only blocker |', '|---:|---|');
for (const [k, n] of soleRanking) md.push(`| ${n} | ${k} |`);
md.push('', '## Per project', '');
for (const r of results) {
  md.push(`### ${tilde(r.file)}`, '');
  for (const n of r.mapNotes) md.push(`- map: ${n}`);
  md.push('', '| verdict | layer | type | blockers / unsupported |', '|---|---|---|---|');
  for (const t of r.themes) {
    const why = [...t.blockers, ...t.unsupportedFlags.map(f => `flag ${f}`), ...t.unsupportedOther].join('; ') || '—';
    md.push(`| ${t.verdict} | ${t.layer} | \`${String(t.type).slice(0, 60)}\` | ${why} |`);
  }
  md.push('');
}
fs.mkdirSync(path.join(TEST, 'out'), { recursive: true });
const outFile = path.join(TEST, 'out', 'project-compat.md');
fs.writeFileSync(outFile, md.join('\n') + '\n');

console.log(`${files.length} project files, ${allThemes.length} themes: ${count('ok')} ok, ${count('partial')} partial, ${count('blocked')} blocked`);
console.log('top blockers:');
for (const [k, n] of ranking.slice(0, 12)) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log('blocked by ONE thing only:');
for (const [k, n] of soleRanking.slice(0, 10)) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log(`report: ${tilde(outFile)}`);
