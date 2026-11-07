// Shared by the live checks (events.mjs, runtime.mjs): a static server over the repo that serves
// /ixmaps-gl.js from --engine (default ../ixmaps-gl.js), headless Chromium with software WebGL, and a tiny
// PASS/FAIL reporter. Needs network (MapLibre / deck.gl from unpkg, basemap tiles).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function serve() {
  const i = process.argv.indexOf('--engine');
  const engine = i > 0 ? path.resolve(process.argv[i + 1]) : path.join(root, 'ixmaps-gl.js');
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = url === '/ixmaps-gl.js' ? engine : path.join(root, url);
    if (!file.startsWith(root) && file !== engine) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'text/javascript' }).end(buf);
    });
  }).listen(0);
  return { server, port: server.address().port };
}

export const launch = () => chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

export function reporter() {
  let failed = 0;
  return {
    check(name, fn) { try { fn(); console.log('PASS ', name); } catch (e) { failed++; console.log('FAIL ', name, '—', e.message); } },
    done() { console.log(failed ? `${failed} check(s) failed` : 'all checks passed'); process.exit(failed ? 1 : 0); }
  };
}
