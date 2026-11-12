// Local-only server for smoke-testing the exported web build, including route URLs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../.expo/qa-export');
const port = Number(process.env.MOBILE_EXPORT_PORT || 8091);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
http.createServer((request, response) => {
  let requested;
  try { requested = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
  catch { response.writeHead(400).end(); return; }
  const candidate = path.resolve(root, `.${requested}`);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  const file = [candidate, candidate + '.html', path.join(candidate, 'index.html')]
    .find(value => fs.existsSync(value) && fs.statSync(value).isFile());
  if (!file) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Serving mobile export at http://127.0.0.1:${port}`));
