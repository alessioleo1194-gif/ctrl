// Server statico minimo per sviluppo e test: serve app/ come farebbe Netlify.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../app');
const port = Number(process.env.PORT || 4173);
// Stesse intestazioni di sicurezza di Netlify (lette da netlify.toml), così i test scoprono i blocchi CSP.
const toml = fs.readFileSync(path.join(root, '../netlify.toml'), 'utf8');
const csp = ((toml.match(/Content-Security-Policy = "([^"]+)"/) || [])[1] || '')
  .replace('connect-src ', 'connect-src ' + (process.env.EXTRA_CONNECT || 'https://api.ctrl.test') + ' ');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Security-Policy': csp });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('CTRL su http://localhost:' + port));
