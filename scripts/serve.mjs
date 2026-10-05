// Minimal static server for the harness. localhost is a secure context, so camera access works.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 5173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/') {
    res.writeHead(302, { Location: '/web/' }).end();
    return;
  }
  const file = resolve(root, `.${decodeURIComponent(pathname)}${pathname.endsWith('/') ? 'index.html' : ''}`);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
})
  .on('error', (error) => {
    if (error.code !== 'EADDRINUSE') throw error;
    console.error(`Port ${port} is already in use; the harness may already be running at http://localhost:${port}/web/`);
    console.error(`Use another port with: PORT=5174 npm run serve (PowerShell: $env:PORT=5174; npm run serve)`);
    process.exitCode = 1;
  })
  .listen(port, '127.0.0.1', () => console.log(`Harness: http://localhost:${port}/web/`));
