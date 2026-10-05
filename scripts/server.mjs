// Harness server: static allowlist + authenticated local telemetry API.
//
// Static: /web/*, /src/*, /assets/manifest.json only. Dotfile segments and symlink escapes are
// refused. Telemetry is stored outside this root and is never served.
// Telemetry: exact Host and Origin checks, a per-process token injected into the page, no CORS,
// bounded bodies, server-generated ids and fixed artifact names.

import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { ARTIFACT_NAMES, TelemetryStore } from './telemetry-store.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const STATIC_PATTERN = /^\/(?:web|src)\/[A-Za-z0-9_\-./]*$/;
const TOKEN_PLACEHOLDER = '__TELEMETRY_TOKEN__';
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_LOG_BYTES = 256 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) return reject(new HttpError(413, 'body too large'));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolveBody(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export function createAppServer({ root: servedRoot, store, token = randomBytes(24).toString('hex'), log = () => {} }) {
  const root = realpathSync(servedRoot);
  let port = 0;
  const origins = () => [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  const hosts = () => [`localhost:${port}`, `127.0.0.1:${port}`];

  async function serveStatic(pathname, res) {
    if (pathname === '/') {
      res.writeHead(302, { Location: '/web/' }).end();
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const allowed = pathname === '/assets/manifest.json' || STATIC_PATTERN.test(pathname);
    const dotSegment = pathname.split('/').some((segment) => segment.startsWith('.'));
    if (!allowed || dotSegment) throw new HttpError(404, 'not found');
    let file;
    try {
      file = await realpath(resolve(root, `.${pathname}`));
    } catch {
      throw new HttpError(404, 'not found');
    }
    if (!file.startsWith(root + sep)) throw new HttpError(404, 'not found');
    let body = await readFile(file);
    if (pathname === '/web/index.html') body = Buffer.from(body.toString('utf8').replace(TOKEN_PLACEHOLDER, token));
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  async function telemetry(req, res, pathname) {
    if (!origins().includes(req.headers.origin)) throw new HttpError(403, 'origin not allowed');
    if (req.headers['x-telemetry-token'] !== token) throw new HttpError(403, 'bad token');
    const parts = pathname.split('/').filter(Boolean); // ['telemetry', 'bundles', id?, name?]
    if (parts[1] !== 'bundles') throw new HttpError(404, 'not found');
    const [, , id, action] = parts;
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };

    if (req.method === 'POST' && !id) return json(201, { id: await store.create() });
    if (req.method === 'DELETE' && !id) {
      await store.removeAll();
      return res.writeHead(204).end();
    }
    if (req.method === 'DELETE' && id && !action) {
      await store.remove(id);
      return res.writeHead(204).end();
    }
    if (req.method === 'PUT' && id && ARTIFACT_NAMES.includes(action)) {
      await store.putArtifact(id, action, await readBody(req, MAX_ARTIFACT_BYTES));
      return res.writeHead(204).end();
    }
    if (req.method === 'POST' && id && action === 'complete') {
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'json required');
      let logBody;
      try {
        logBody = JSON.parse(Buffer.from(await readBody(req, MAX_LOG_BYTES)).toString('utf8'));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, 'invalid json');
      }
      const saved = await store.complete(id, logBody);
      const crop = logBody.crop ? ` crop ${Math.round(logBody.crop.sw)}x${Math.round(logBody.crop.sh)} upscale ${logBody.crop.upscale?.toFixed?.(2)}` : '';
      const bytes = logBody.encoder?.bytes ? ` ${logBody.encoder.bytes} B` : '';
      log(`[telemetry] saved ${logBody.level ?? ''} ${logBody.outcome ?? ''}${logBody.stage && logBody.stage !== 'done' ? ` at ${logBody.stage}` : ''}${bytes}${crop}\n            ${saved}`);
      return json(200, { id, status: 'complete' });
    }
    throw new HttpError(405, 'method not allowed');
  }

  const server = createServer(async (req, res) => {
    try {
      if (!hosts().includes(req.headers.host)) throw new HttpError(421, 'host not allowed');
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/telemetry' || pathname.startsWith('/telemetry/')) return await telemetry(req, res, pathname);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
      return await serveStatic(decodeURIComponent(pathname), res);
    } catch (error) {
      const status = error.status ?? 500;
      if (status === 500) log(`server error: ${error.message}`);
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(status === 500 ? 'internal error' : error.message);
    }
  });

  server.on('listening', () => {
    port = server.address().port;
  });
  return { server, token };
}

export { TelemetryStore };
