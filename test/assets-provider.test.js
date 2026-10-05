import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { assertManifestReady, fetchVerified, listManifestProblems, sha256Hex } from '../src/assets.js';
import { MockProvider } from '../src/mock-provider.js';

const manifest = JSON.parse(await readFile(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
const HASH = 'a'.repeat(64);

function pinned(source) {
  const copy = structuredClone(source);
  for (const model of Object.values(copy.models)) model.sha256 = HASH;
  copy.client.tasksVision.bundle.sha256 = HASH;
  for (const file of copy.client.tasksVision.wasmFiles) file.sha256 = HASH;
  copy.server.runtime = { name: 'example-runtime', version: '1.0.0' };
  copy.server.jpegEncoder = { name: 'example-encoder', version: '1.0.0' };
  return copy;
}

describe('asset manifest', () => {
  test('checked-in manifest is not production-ready until hashes and the server runtime are pinned', () => {
    const problems = listManifestProblems(manifest);
    assert.ok(problems.some((p) => p.startsWith('models.selfieSegmenter')));
    assert.ok(problems.includes('server.runtime: name/version not pinned'));
    assert.throws(() => assertManifestReady(manifest, { production: true }), /not production-ready/);
    assert.doesNotThrow(() => assertManifestReady(manifest, { production: false }));
  });

  test('a fully pinned manifest passes', () => {
    assert.deepEqual(listManifestProblems(pinned(manifest)), []);
  });

  test('server must count faces with numFaces >= 2 and use known models', () => {
    const bad = pinned(manifest);
    bad.server.fullFrameFaceCount.numFaces = 1;
    bad.server.models.push('unknownModel');
    const problems = listManifestProblems(bad);
    assert.ok(problems.includes('server.fullFrameFaceCount: numFaces must be >= 2'));
    assert.ok(problems.includes('server.models: unknown model "unknownModel"'));
  });

  test('fetchVerified enforces hashes', async () => {
    const bytes = new TextEncoder().encode('model-bytes');
    const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(0) });
    const good = await sha256Hex(bytes);
    assert.equal((await fetchVerified({ url: 'x', sha256: good }, { production: true, fetchImpl })).pinned, true);
    await assert.rejects(fetchVerified({ url: 'x', sha256: HASH }, { production: false, fetchImpl }), /Integrity mismatch/);
    await assert.rejects(fetchVerified({ url: 'x', sha256: null }, { production: true, fetchImpl }), /Unpinned asset refused/);
    assert.equal((await fetchVerified({ url: 'x', sha256: null }, { production: false, fetchImpl })).pinned, false);
  });
});

describe('mock provider', () => {
  async function evaluated(provider) {
    const session = await provider.initSession();
    await provider.startChallenge(session);
    const frameId = await provider.recordChallengeFrame(session, { width: 10, height: 10 }, { selected: true });
    assert.equal((await provider.finishChallenge(session, frameId)).passed, true);
    return { session, frameId };
  }

  test('never returns provider acceptance and is single-use', async () => {
    const provider = new MockProvider();
    const { session, frameId } = await evaluated(provider);
    const result = await provider.generateOrVerifyPhoto(session, { frameId });
    assert.equal(result.accepted, false);
    assert.equal(result.status, 'PENDING_SERVER_VERIFICATION');
    await assert.rejects(provider.generateOrVerifyPhoto(session, { frameId }), { code: 'BAD_STATE' });
  });

  test('rejects a candidate that does not reference the PAD-selected frame', async () => {
    const provider = new MockProvider();
    const { session } = await evaluated(provider);
    await assert.rejects(provider.generateOrVerifyPhoto(session, { frameId: 'other' }), { code: 'FRAME_MISMATCH' });
  });

  test('rejects expired sessions and forged nonces', async () => {
    let now = 0;
    const provider = new MockProvider({ ttlMs: 100, now: () => now });
    const session = await provider.initSession();
    await assert.rejects(provider.startChallenge({ ...session, nonce: 'forged' }), { code: 'UNKNOWN_SESSION' });
    now = 101;
    await assert.rejects(provider.startChallenge(session), { code: 'EXPIRED' });
  });
});
