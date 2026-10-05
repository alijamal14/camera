// Harness server: static allowlist, telemetry auth, storage safety and atomic bundles.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createAppServer } from '../scripts/server.mjs';
import { MARKER, TelemetryStore, imageDimensions, validateStoreDir } from '../scripts/telemetry-store.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function png(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

export function jpeg(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff]);
  return bytes;
}

let dir;
let server;
let token;
let port;

function call({ method = 'GET', path, headers = {}, body, host, origin = 'default' }) {
  return new Promise((resolveCall, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          host: host ?? `localhost:${port}`,
          ...(origin === 'default' ? { origin: `http://localhost:${port}` } : origin ? { origin } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolveCall({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const authed = (options) => call({ ...options, headers: { 'x-telemetry-token': token, ...options.headers } });

before(async () => {
  dir = await validateStoreDir(await mkdtemp(join(tmpdir(), 'camera-telemetry-test-')), { servedRoot: root });
  ({ server, token } = createAppServer({ root, store: new TelemetryStore(dir, { quotaBytes: 4096 }) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

describe('static allowlist', () => {
  test('serves the harness and injects the token', async () => {
    const res = await call({ path: '/web/' });
    assert.equal(res.status, 200);
    assert.ok(res.body.includes(token));
    assert.equal((await call({ path: '/src/capture.js' })).status, 200);
    assert.equal((await call({ path: '/assets/manifest.json' })).status, 200);
  });

  test('refuses files outside the allowlist, dotfiles and traversal', async () => {
    for (const path of ['/package.json', '/.claude/launch.json', '/.git/HEAD', '/web/../package.json', '/web/%2e%2e/package.json', '/src/.hidden', '/test/fakes.js', '/scripts/server.mjs']) {
      assert.equal((await call({ path })).status, 404, path);
    }
  });

  test('refuses foreign Host headers (DNS rebinding)', async () => {
    assert.equal((await call({ path: '/web/', host: 'evil.example:80' })).status, 421);
  });

  test('telemetry is never readable over GET', async () => {
    assert.equal((await call({ path: '/telemetry/bundles' })).status, 403);
  });
});

describe('telemetry API', () => {
  test('requires exact Origin and the token', async () => {
    assert.equal((await authed({ method: 'POST', path: '/telemetry/bundles', origin: 'http://evil.example' })).status, 403);
    assert.equal((await authed({ method: 'POST', path: '/telemetry/bundles', origin: null })).status, 403);
    assert.equal((await call({ method: 'POST', path: '/telemetry/bundles', headers: { 'x-telemetry-token': 'wrong' } })).status, 403);
    assert.equal((await call({ method: 'POST', path: '/telemetry/bundles' })).status, 403);
  });

  test('no CORS headers are ever sent', async () => {
    const res = await authed({ method: 'POST', path: '/telemetry/bundles' });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    await authed({ method: 'DELETE', path: `/telemetry/bundles/${JSON.parse(res.body).id}` });
  });

  test('bundle appears atomically only after completion', async () => {
    const { id } = JSON.parse((await authed({ method: 'POST', path: '/telemetry/bundles' })).body);
    assert.equal((await authed({ method: 'PUT', path: `/telemetry/bundles/${id}/preview.png`, body: png(480, 640) })).status, 204);
    assert.equal((await authed({ method: 'PUT', path: `/telemetry/bundles/${id}/output.jpg`, body: jpeg(480, 640) })).status, 204);
    assert.deepEqual(await readdir(join(dir, 'bundles')), [], 'nothing published before complete');

    const log = JSON.stringify({ schema: 1, outcome: 'client-validated' });
    const done = await authed({ method: 'POST', path: `/telemetry/bundles/${id}/complete`, headers: { 'content-type': 'application/json' }, body: log });
    assert.equal(done.status, 200);
    const [day] = await readdir(join(dir, 'bundles'));
    const files = (await readdir(join(dir, 'bundles', day, id))).sort();
    assert.deepEqual(files, ['complete', 'log.json', 'output.jpg', 'preview.png']);
    assert.equal(JSON.parse(await readFile(join(dir, 'bundles', day, id, 'log.json'), 'utf8')).captureId, id);
    assert.equal((await readdir(join(dir, 'partial'))).length, 0);

    assert.equal((await authed({ method: 'DELETE', path: `/telemetry/bundles/${id}` })).status, 204);
    assert.equal(existsSync(join(dir, 'bundles', day, id)), false);
  });

  test('rejects unknown names, bad ids, wrong formats and wrong output size', async () => {
    const { id } = JSON.parse((await authed({ method: 'POST', path: '/telemetry/bundles' })).body);
    assert.equal((await authed({ method: 'PUT', path: `/telemetry/bundles/${id}/evil.sh`, body: 'x' })).status, 405);
    const traversal = await authed({ method: 'PUT', path: `/telemetry/bundles/../../x/preview.png`, body: png(1, 1) });
    assert.ok([404, 405].includes(traversal.status), `traversal refused (${traversal.status})`);
    assert.equal((await authed({ method: 'PUT', path: `/telemetry/bundles/not-a-uuid/preview.png`, body: png(1, 1) })).status, 404);
    assert.equal((await authed({ method: 'PUT', path: `/telemetry/bundles/${id}/preview.png`, body: jpeg(480, 640) })).status, 422);
    assert.equal((await authed({ method: 'PUT', path: `/telemetry/bundles/${id}/output.jpg`, body: jpeg(640, 480) })).status, 422);
    assert.equal((await authed({ method: 'PUT', path: `/telemetry/bundles/${id}/raw-crop.png`, body: png(9000, 10) })).status, 422);
    assert.equal((await authed({ method: 'PUT', path: `/telemetry/bundles/${id}/confidence.f32`, body: new Uint8Array(7) })).status, 422);
    assert.equal((await authed({ method: 'POST', path: `/telemetry/bundles/${id}/complete`, headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);
    await authed({ method: 'DELETE', path: `/telemetry/bundles/${id}` });
  });

  test('enforces the disk quota', async () => {
    const { id } = JSON.parse((await authed({ method: 'POST', path: '/telemetry/bundles' })).body);
    assert.equal((await authed({ method: 'PUT', path: `/telemetry/bundles/${id}/confidence.f32`, body: new Uint8Array(8192) })).status, 507);
    await authed({ method: 'DELETE', path: `/telemetry/bundles/${id}` });
  });

  test('delete-all clears completed and partial bundles', async () => {
    await authed({ method: 'POST', path: '/telemetry/bundles' });
    assert.equal((await authed({ method: 'DELETE', path: '/telemetry/bundles' })).status, 204);
    assert.deepEqual(await readdir(join(dir, 'partial')), []);
  });
});

describe('telemetry store safety', () => {
  test('refuses relative, root, home, served-root and unmarked non-empty directories', async () => {
    await assert.rejects(validateStoreDir('relative/dir', { servedRoot: root }), /absolute/);
    await assert.rejects(validateStoreDir(resolve('/'), { servedRoot: root }), /root/);
    await assert.rejects(validateStoreDir(join(root, 'telemetry'), { servedRoot: root }), /outside the served root/);
    await assert.rejects(validateStoreDir(resolve(root, '..'), { servedRoot: root }), /outside the served root/);
    const unrelated = await mkdtemp(join(tmpdir(), 'camera-unrelated-'));
    await writeFile(join(unrelated, 'important.txt'), 'keep me');
    await assert.rejects(validateStoreDir(unrelated, { servedRoot: root }), /no \.camera-telemetry-store marker/);
    assert.equal(await readFile(join(unrelated, 'important.txt'), 'utf8'), 'keep me');
    await rm(unrelated, { recursive: true, force: true });
  });

  test('purge path requires an existing marked store', async () => {
    const missing = join(tmpdir(), `camera-missing-${Date.now()}`);
    await assert.rejects(validateStoreDir(missing, { servedRoot: root, create: false }), /does not exist/);
    assert.ok(existsSync(join(dir, MARKER)));
  });

  test('sweep removes expired bundles and abandoned partials', async () => {
    const store = new TelemetryStore(dir, { retentionMs: 1000 });
    const id = await store.create();
    await store.complete(id, { schema: 1 });
    const stale = await store.create();
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    await utimes(join(dir, 'partial', stale), old, old);
    const [day] = await readdir(join(dir, 'bundles'));
    await utimes(join(dir, 'bundles', day, id), old, old);
    assert.equal(await store.sweep(), 2);
    assert.deepEqual(await readdir(join(dir, 'partial')), []);
  });

  test('parses PNG and JPEG dimensions', () => {
    assert.deepEqual(imageDimensions('a.png', png(480, 640)), { width: 480, height: 640 });
    assert.deepEqual(imageDimensions('a.jpg', jpeg(480, 640)), { width: 480, height: 640 });
    assert.equal(imageDimensions('a.png', jpeg(1, 1)), null);
    void mkdir;
  });
});
