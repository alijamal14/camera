// Telemetry client: consent levels, allowlisted logs, discard on toggle-off, failure isolation.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TelemetryClient, artifactAllowed, buildLog, sanitizeError } from '../src/telemetry.js';
import { deferred } from './fakes.js';

function fakeServer({ failOn } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers, body: options.body, signal: options.signal });
    if (failOn && url.includes(failOn)) return { ok: false, status: 500 };
    if (options.method === 'POST' && url.endsWith('/bundles')) return { ok: true, status: 201, json: async () => ({ id: 'id-1' }) };
    if (url.endsWith('/complete')) return { ok: true, status: 200, json: async () => ({ id: 'id-1' }) };
    return { ok: true, status: 204, json: async () => null };
  };
  return { calls, fetchImpl };
}

const blob = (n = 10) => ({ arrayBuffer: async () => new Uint8Array(n).buffer });

describe('telemetry consent levels', () => {
  test('off by default: begin() returns null so nothing is copied or sent', () => {
    const { calls, fetchImpl } = fakeServer();
    const client = new TelemetryClient({ token: 't', fetchImpl });
    assert.equal(client.level, 'off');
    assert.equal(client.begin(), null);
    assert.equal(calls.length, 0);
  });

  test('basic level excludes diagnostic artifacts', () => {
    assert.equal(artifactAllowed('preview.png', 'basic'), true);
    assert.equal(artifactAllowed('output.jpg', 'basic'), true);
    assert.equal(artifactAllowed('raw-crop.png', 'basic'), false);
    assert.equal(artifactAllowed('confidence.f32', 'diagnostic'), true);
    assert.equal(artifactAllowed('anything.exe', 'diagnostic'), false);
    assert.equal(artifactAllowed('preview.png', 'off'), false);
  });

  test('saved bundle uploads allowed artifacts, then a log with hashes, with the token header', async () => {
    const { calls, fetchImpl } = fakeServer();
    const client = new TelemetryClient({ token: 'secret', fetchImpl });
    client.setLevel('basic');
    const bundle = client.begin();
    assert.equal(bundle.add('preview.png', () => blob(4)), true);
    assert.equal(bundle.add('raw-crop.png', () => blob(4)), false, 'diagnostic artifact refused at basic');
    const result = await bundle.finish({ outcome: 'client-validated', stage: 'done' });
    assert.deepEqual(result, { status: 'saved', id: 'id-1' });
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
      'POST /telemetry/bundles',
      'PUT /telemetry/bundles/id-1/preview.png',
      'POST /telemetry/bundles/id-1/complete',
    ]);
    assert.ok(calls.every((c) => c.headers['x-telemetry-token'] === 'secret'));
    const log = JSON.parse(calls[2].body);
    assert.equal(log.artifacts[0].name, 'preview.png');
    assert.match(log.artifacts[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(log.level, 'basic');
  });

  test('turning telemetry off discards pending encodes before upload', async () => {
    const { calls, fetchImpl } = fakeServer();
    const client = new TelemetryClient({ token: 't', fetchImpl });
    client.setLevel('diagnostic');
    const encode = deferred();
    const bundle = client.begin();
    bundle.add('preview.png', () => encode.promise);
    const finished = bundle.finish({ outcome: 'rejected' });
    client.setLevel('off');
    encode.resolve(blob());
    assert.deepEqual(await finished, { status: 'discarded' });
    assert.equal(calls.length, 0);
  });

  test('turning telemetry off aborts an active upload and requests deletion', async () => {
    const calls = [];
    const upload = deferred();
    const fetchImpl = (url, options) => {
      calls.push(`${options.method} ${url}`);
      if (options.method === 'POST' && url.endsWith('/bundles')) return Promise.resolve({ ok: true, status: 201, json: async () => ({ id: 'id-9' }) });
      if (options.method === 'PUT') {
        options.signal.addEventListener('abort', () => upload.reject(new DOMException('aborted', 'AbortError')));
        return upload.promise;
      }
      return Promise.resolve({ ok: true, status: 204, json: async () => null });
    };
    const client = new TelemetryClient({ token: 't', fetchImpl });
    client.setLevel('basic');
    const bundle = client.begin();
    bundle.add('preview.png', () => blob());
    const finished = bundle.finish({});
    while (client.activeUploads === 0 || !calls.some((c) => c.startsWith('PUT'))) await new Promise((r) => setImmediate(r));
    client.setLevel('off');
    assert.deepEqual(await finished, { status: 'discarded' });
    await new Promise((r) => setImmediate(r));
    assert.ok(calls.includes('DELETE /telemetry/bundles/id-9'));
    assert.ok(!calls.some((c) => c.endsWith('/complete')));
  });

  test('server failure is reported, never thrown', async () => {
    const { fetchImpl } = fakeServer({ failOn: '/complete' });
    const client = new TelemetryClient({ token: 't', fetchImpl });
    client.setLevel('basic');
    const result = await client.begin().finish({});
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'HTTP_500');
  });

  test('a failing artifact encoder is counted, other artifacts still upload', async () => {
    const { calls, fetchImpl } = fakeServer();
    const client = new TelemetryClient({ token: 't', fetchImpl });
    client.setLevel('diagnostic');
    const bundle = client.begin();
    bundle.add('preview.png', () => blob());
    bundle.add('alpha.png', () => {
      throw new Error('encode failed');
    });
    assert.equal((await bundle.finish({})).status, 'saved');
    const log = JSON.parse(calls.at(-1).body);
    assert.equal(log.diagnosticErrors, 1);
    assert.deepEqual(log.artifacts.map((a) => a.name), ['preview.png']);
  });
});

describe('telemetry log allowlist', () => {
  test('drops unknown fields, sessions, nonces and free text', () => {
    const log = buildLog({
      outcome: 'rejected',
      stage: 'pad',
      session: { nonce: 'n-123', id: 's' },
      nonce: 'n-123',
      token: 'secret',
      logText: 'full harness log',
      crop: { sx: 1, sy: 2, sw: 3, sh: 4, upscale: 1.2, extra: 'x' },
      camera: { videoWidth: 1920, videoHeight: 1080, deviceId: 'abc', track: { width: 1920, deviceId: 'abc', groupId: 'g' } },
      audit: { profile: 'p', hardFailures: ['bytes'], items: [{ id: 'bytes', enforcement: 'HARD', status: 'FAIL', value: 30001, reason: 'free text' }] },
    });
    const text = JSON.stringify(log);
    for (const secret of ['n-123', 'secret', 'full harness log', 'abc', 'deviceId', 'groupId', 'free text', 'extra']) {
      assert.ok(!text.includes(secret), `log must not contain ${secret}`);
    }
    assert.deepEqual(log.crop, { sx: 1, sy: 2, sw: 3, sh: 4, upscale: 1.2 });
    assert.deepEqual(log.camera, { videoWidth: 1920, videoHeight: 1080, track: { width: 1920 } });
    assert.equal(log.audit.items[0].value, 30001);
  });

  test('sanitizeError strips URLs and paths', () => {
    const error = Object.assign(new Error('Fetch failed for https://example.com/x?token=1 at C:\\Users\\ali\\secret.txt'), { code: 'E1' });
    const clean = sanitizeError(error);
    assert.equal(clean.code, 'E1');
    assert.ok(!clean.message.includes('example.com'));
    assert.ok(!clean.message.includes('Users'));
  });
});
