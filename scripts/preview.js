#!/usr/bin/env node
/** Servidor estatico minimo para revisar una landing generada: node scripts/preview.js <slug> */
const http = require('http'), fs = require('fs'), path = require('path');
const slug = process.argv[2];
if (!slug) { console.error('Uso: npm run preview <slug>'); process.exit(1); }
const dir = path.resolve(__dirname, '..', 'dist', slug);
if (!fs.existsSync(dir)) { console.error(`No existe dist/${slug}. Corré primero: npm run build ${slug}`); process.exit(1); }
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.txt': 'text/plain' };
const port = Number(process.env.PORT) || 8080;
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(dir, rel);
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Preview de "${slug}" en http://localhost:${port}`));
