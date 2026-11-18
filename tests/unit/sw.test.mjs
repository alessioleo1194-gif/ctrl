import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve('app');
const leggi = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

function tutti(dir) {
  return fs.readdirSync(path.join(APP, dir), { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? tutti(path.posix.join(dir, d.name)) : ['/' + path.posix.join(dir, d.name)]);
}

const shell = [...leggi('sw.js').matchAll(/^\s+'(\/[^']*)',?$/gm)].map(m => m[1]);

/** Moduli raggiunti da app.js con import statici (quelli che servono per avviare l'app). */
function grafoStatico() {
  const visti = new Set();
  const visita = (f) => {
    if (visti.has(f)) return;
    visti.add(f);
    const src = leggi(f.slice(1));
    for (const m of src.matchAll(/^\s*import\s[^'"]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm)) {
      visita(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1] || m[2])));
    }
  };
  visita('/js/app.js');
  return [...visti];
}

test('il service worker mette in cache ogni modulo JS e il CSS: nessun file dimenticato', () => {
  for (const f of tutti('js')) assert.ok(shell.includes(f), 'manca nella cache del service worker: ' + f);
  for (const f of ['/', '/index.html', '/css/ctrl.css', '/manifest.webmanifest']) assert.ok(shell.includes(f), 'manca ' + f);
  for (const f of shell) {
    if (f === '/') continue;
    assert.ok(fs.existsSync(path.join(APP, f)), 'elencato ma inesistente: ' + f);
  }
});

test('le librerie pesanti non sono nella cache iniziale (si caricano al bisogno)', () => {
  assert.ok(!shell.some(f => f.startsWith('/vendor/')));
});

test('index.html precarica in parallelo tutti i moduli necessari all\'avvio', () => {
  const html = leggi('index.html');
  const pre = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]);
  for (const f of grafoStatico()) assert.ok(pre.includes(f), 'manca il modulepreload di ' + f);
  for (const f of pre) assert.ok(fs.existsSync(path.join(APP, f)), 'modulepreload di un file inesistente: ' + f);
});

test('le sezioni pesanti (impostazioni, report, piano, materiali) non pesano sull\'avvio', () => {
  const statici = grafoStatico();
  for (const f of ['/js/views/settings.js', '/js/views/report.js', '/js/views/plan.js', '/js/views/materiali.js', '/js/grid.js', '/js/xlsx.js', '/js/pdf.js']) {
    assert.ok(!statici.includes(f), f + ' è nell\'avvio: va caricato con import() quando serve');
  }
});

test('il service worker non salva mai le chiamate all\'API', () => {
  const sw = leggi('sw.js');
  assert.match(sw, /if \(!sameOrigin && !fonts\) return;/);
  assert.match(sw, /method !== 'GET'\) return;/);
});
