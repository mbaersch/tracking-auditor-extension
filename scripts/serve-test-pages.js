// Serves test-pages/ over http so pixel SDKs run under a real origin (file://
// breaks cookies, referrer and CSP). Dependency-free; capture with the Tracking
// Auditor panel open, then export the HAR.
//
// Run:  npm run testpage   →  http://localhost:8787/openai-pixel.html

import http from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), 'test-pages');
const port = Number(process.argv[2] || process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') {
    const list = readdirSync(root).filter((f) => f.endsWith('.html'));
    res.setHeader('Content-Type', MIME['.html']);
    res.end(`<h1>Test pages</h1><ul>${list.map((f) => `<li><a href="/${f}">${f}</a></li>`).join('')}</ul>`);
    return;
  }
  const abs = join(root, p);
  if (!abs.startsWith(root) || !existsSync(abs) || !statSync(abs).isFile()) {
    res.statusCode = 404; res.end('not found'); return;
  }
  res.setHeader('Content-Type', MIME[extname(abs)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(readFileSync(abs));
});

server.listen(port, () => {
  console.log(`test pages  →  http://localhost:${port}/`);
  for (const f of readdirSync(root).filter((f) => f.endsWith('.html'))) {
    console.log(`             http://localhost:${port}/${f}`);
  }
});
