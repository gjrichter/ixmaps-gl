#!/usr/bin/env node
// Keeps ixmaps-gl.js's generated grammar sections in sync with the shared
// ixmaps grammar (github.com/gjrichter/ixmaps-grammar).
//
//   node sync-grammar.mjs            check: exit 1 if a section differs from the grammar
//   node sync-grammar.mjs --write    rewrite the sections from the grammar
//   --grammar <grammar.json>         default: the sibling checkout ../../ixmaps-grammar
//
// Sections are delimited by `// <grammar:NAME>` … `// </grammar:NAME>`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE = path.resolve(TEST, '..', 'ixmaps-gl.js');
export const DEFAULT_GRAMMAR = path.resolve(TEST, '..', '..', 'ixmaps-grammar', 'grammar', 'grammar.json');

// alias → flat target, for every binding alias whose target the grammar knows
function bindingAliasesSection(grammar, pkgVersion) {
  const entries = Object.entries(grammar.bindingKeys)
    .filter(([, e]) => e.target)
    .sort(([a], [b]) => a.localeCompare(b));
  const flat = grammar.sources && grammar.sources.flat;
  const lines = entries.map(([alias, e]) => `    ${JSON.stringify(alias)}: ${JSON.stringify(e.target)},`);
  return [
    `  // generated from ixmaps-grammar ${pkgVersion || '?'} (ixmaps-flat ${flat ? `${flat.version}, ${flat.commit}` : '?'}) — ${entries.length} aliases`,
    '  const FLAT_BINDING_ALIASES = {',
    ...lines,
    '  };',
  ].join('\n');
}

export function expectedSections(grammarFile = DEFAULT_GRAMMAR) {
  const grammar = JSON.parse(fs.readFileSync(grammarFile, 'utf8'));
  const pkgFile = path.resolve(path.dirname(grammarFile), '..', 'package.json');
  const pkgVersion = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version : null;
  return { 'binding-aliases': bindingAliasesSection(grammar, pkgVersion) };
}

const sectionRe = name => new RegExp(`(  // <grammar:${name}>\\n)([\\s\\S]*?)(\\n  // </grammar:${name}>)`);

export function currentSections(src = fs.readFileSync(ENGINE, 'utf8')) {
  const out = {};
  for (const name of ['binding-aliases']) {
    const m = src.match(sectionRe(name));
    if (!m) throw new Error(`section <grammar:${name}> not found in ixmaps-gl.js`);
    out[name] = m[2];
  }
  return out;
}

// → list of section names that differ
export function checkSections(grammarFile = DEFAULT_GRAMMAR) {
  const want = expectedSections(grammarFile), have = currentSections();
  return Object.keys(want).filter(n => want[n] !== have[n]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const gi = argv.indexOf('--grammar');
  const grammarFile = gi >= 0 ? path.resolve(argv[gi + 1]) : DEFAULT_GRAMMAR;
  if (!fs.existsSync(grammarFile)) { console.error(`grammar not found: ${grammarFile}`); process.exit(2); }
  const want = expectedSections(grammarFile);
  if (argv.includes('--write')) {
    let src = fs.readFileSync(ENGINE, 'utf8');
    for (const [name, body] of Object.entries(want)) src = src.replace(sectionRe(name), (_, a, __, c) => a + body + c);
    fs.writeFileSync(ENGINE, src);
    console.log(`wrote ${Object.keys(want).join(', ')} into ixmaps-gl.js from ${path.relative(process.cwd(), grammarFile)}`);
  } else {
    const bad = checkSections(grammarFile);
    if (bad.length) { console.error(`out of sync with the grammar: ${bad.join(', ')} — run: node sync-grammar.mjs --write`); process.exit(1); }
    console.log('ixmaps-gl.js grammar sections are in sync');
  }
}
