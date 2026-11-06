// TC-11 (resource release on every path) and TC-10 (face count) on IdentityPhotoCapture.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { IdentityPhotoCapture } from '../src/capture.js';
import { BiometricAuditError, CaptureRejectedError, FaceCountError, PadRejectedError } from '../src/errors.js';
import { InstanceDisposedError } from '../src/lifecycle.js';
import {
  FRAME,
  createEngines,
  createProviderSession,
  createTracker,
  deferred,
  flush,
  jpegBlob,
} from './fakes.js';

let unhandled;
const onUnhandled = (reason) => unhandled.push(reason);
beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  await flush();
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, [], 'no unhandled rejections');
});

async function setup({
  frameFaces = 1,
  auditFaces = 1,
  serverFaces = 1,
  decodedSize = [480, 640],
  closeErrors = {},
  grabFrame,
  compose,
  provider: providerOverrides = {},
  drainTimeoutMs = 20,
} = {}) {
  const tracker = createTracker();
  const { engines, calls } = createEngines(tracker, { frameFaces, auditFaces, closeErrors });
  const { provider, session } = await createProviderSession({ serverFaces });
  Object.assign(provider, providerOverrides);
  let stoppedSources = 0;
  const capture = new IdentityPhotoCapture({
    engines,
    provider,
    grabFrame: grabFrame ?? (async () => tracker.bitmap(FRAME.width, FRAME.height, 'raw')),
    compose: compose ?? (async () => jpegBlob()),
    decode: async () => tracker.bitmap(decodedSize[0], decodedSize[1], 'decoded'),
    stopSources: () => void stoppedSources++,
    drainTimeoutMs,
  });
  return { capture, engines, calls, tracker, provider, session, stoppedSources: () => stoppedSources };
}

describe('TC-11 capture resource ownership', () => {
  test('success releases raw frame, segmentation and decoded bitmap; result is not provider-accepted', async () => {
    const { capture, tracker, session } = await setup();
    const result = await capture.capture(session);

    assert.equal(result.status, 'ClientValidated');
    assert.equal(result.provider.accepted, false);
    assert.deepEqual(result.report.hardFailures, []);
    assert.ok(!('rawFrame' in result), 'public package has no raw bitmap');
    assert.deepEqual(tracker.open(), []);
    const kinds = tracker.all().map((r) => r.label.split('@')[0]).sort();
    assert.deepEqual(kinds, ['decoded', 'raw', 'segmentation']);
  });

  test('PAD rejection releases everything', async () => {
    const { capture, tracker, session } = await setup({ serverFaces: 2 });
    await assert.rejects(capture.capture(session), PadRejectedError);
    assert.deepEqual(tracker.open(), []);
  });

  test('compose failure releases everything', async () => {
    const { capture, tracker, session } = await setup({
      compose: async () => {
        throw new Error('encoder failed');
      },
    });
    await assert.rejects(capture.capture(session), /encoder failed/);
    assert.deepEqual(tracker.open(), []);
  });

  test('decoded audit hard failure (wrong dimensions) closes the decoded bitmap', async () => {
    const { capture, tracker, session } = await setup({ decodedSize: [640, 480] });
    await assert.rejects(capture.capture(session), (error) => {
      assert.ok(error instanceof BiometricAuditError);
      assert.deepEqual(error.report.hardFailures, ['dimensions']);
      return true;
    });
    assert.deepEqual(tracker.open(), []);
  });

  test('oversized JPEG is a hard failure', async () => {
    const { capture, tracker, session } = await setup({ compose: async () => jpegBlob(30_001) });
    await assert.rejects(capture.capture(session), (error) => error.report.hardFailures.includes('bytes'));
    assert.deepEqual(tracker.open(), []);
  });

  test('provider transport failure after PAD releases everything', async () => {
    const { capture, tracker, session } = await setup({
      provider: {
        generateOrVerifyPhoto: async () => {
          throw new Error('network down');
        },
      },
    });
    await assert.rejects(capture.capture(session), /network down/);
    assert.deepEqual(tracker.open(), []);
  });

  test('disposal while waiting for the camera frame: frame released, no inference runs', async () => {
    const tracker = createTracker();
    const frame = deferred();
    const { capture, calls, session } = await setup({ grabFrame: () => frame.promise });
    const pending = capture.capture(session);
    const disposed = capture.dispose();
    frame.resolve(tracker.bitmap(FRAME.width, FRAME.height, 'raw'));
    await assert.rejects(pending, InstanceDisposedError);
    await disposed;
    await capture.cleanupPromise;
    assert.deepEqual(tracker.open(), []);
    assert.equal(calls.filter(([name]) => name === 'detectForVideo').length, 0);
  });

  test('disposal during PAD transport: raw frame kept until transport ends, engines closed only after', async () => {
    const transport = deferred();
    const { capture, tracker, engines, session, provider } = await setup({ drainTimeoutMs: 5 });
    const record = provider.recordChallengeFrame.bind(provider);
    provider.recordChallengeFrame = async (...args) => {
      await transport.promise;
      return record(...args);
    };
    const pending = capture.capture(session);
    await flush();

    await capture.dispose(); // Drain times out; teardown is deferred.
    const raw = tracker.all().find((r) => r.label === 'raw');
    assert.equal(raw.closed, false, 'raw frame stays alive while PAD transport reads it');
    assert.equal(engines.segmenter.closed, false, 'no engine is closed while work is in flight');

    transport.resolve();
    await assert.rejects(pending, InstanceDisposedError);
    await capture.cleanupPromise;
    assert.deepEqual(tracker.open(), []);
    assert.ok(Object.values(engines).every((engine) => engine.closed));
  });

  test('engine close failure: later engines still close, dispose resolves, cleanupPromise rejects', async () => {
    const failure = new Error('landmarker close failed');
    const { capture, engines, stoppedSources } = await setup({ closeErrors: { landmarker: failure } });
    await capture.dispose();
    assert.equal(stoppedSources(), 1);
    assert.ok(engines.segmenter.closed && engines.landmarker.closed && engines.auditLandmarker.closed);
    await assert.rejects(capture.cleanupPromise, (error) => {
      assert.ok(error instanceof AggregateError);
      assert.ok(error.errors.includes(failure));
      return true;
    });
  });

  test('preview releases its segmentation result after the callback', async () => {
    const { capture, tracker } = await setup();
    const source = { label: 'video' };
    let seen;
    await capture.previewTick(source, ({ segmentation }) => {
      seen = segmentation;
      assert.equal(segmentation.closed, false, 'valid inside the callback');
    });
    assert.equal(seen.closed, true);
    assert.deepEqual(tracker.open(), []);
  });

  test('preview and capture inference use strictly increasing timestamps on the same engines', async () => {
    const { capture, calls, session } = await setup();
    await capture.previewTick({ label: 'video' }, () => {});
    await capture.capture(session);
    await capture.previewTick({ label: 'video' }, () => {});
    const stamps = calls.filter(([name]) => name === 'detectForVideo').map(([, timestamp]) => timestamp);
    assert.equal(stamps.length, 3);
    assert.ok(stamps[0] < stamps[1] && stamps[1] < stamps[2]);
    assert.ok(calls.some(([name, label]) => name === 'detect' && label === 'decoded'), 'audit uses the IMAGE-mode instance');
  });
});

describe('diagnostics observer and single-capture policy', () => {
  async function observed(options = {}) {
    const events = [];
    const ctx = await setup({ ...options, drainTimeoutMs: 20 });
    return { ...ctx, events };
  }

  test('emits stage events in order while resources are still owned', async () => {
    const events = [];
    const tracker = createTracker();
    const { engines } = createEngines(tracker);
    const { provider, session } = await createProviderSession();
    const capture = new IdentityPhotoCapture({
      engines,
      provider,
      grabFrame: async () => tracker.bitmap(FRAME.width, FRAME.height, 'raw'),
      compose: async () => jpegBlob(),
      decode: async () => tracker.bitmap(480, 640, 'decoded'),
      observe: (event, payload) => {
        if (event === 'stage') return;
        const owned = [payload.rawFrame, payload.segmentation].filter(Boolean);
        events.push([event, owned.every((r) => !r.closed)]);
      },
    });
    await capture.capture(session);
    assert.deepEqual(events, [
      ['frame', true],
      ['segmented', true],
      ['cropped', true],
      ['encoded', true],
      ['audited', true],
    ]);
    assert.deepEqual(tracker.open(), []);
  });

  test('early rejection reports its stage without crop or image events', async () => {
    const events = [];
    const tracker = createTracker();
    const { engines } = createEngines(tracker, { frameFaces: 2 });
    const { provider, session } = await createProviderSession();
    const capture = new IdentityPhotoCapture({
      engines,
      provider,
      grabFrame: async () => tracker.bitmap(FRAME.width, FRAME.height, 'raw'),
      compose: async () => jpegBlob(),
      decode: async () => tracker.bitmap(480, 640, 'decoded'),
      observe: (event, payload) => events.push([event, payload.stage ?? payload.name]),
    });
    await assert.rejects(capture.capture(session), FaceCountError);
    const names = events.filter(([e]) => e !== 'stage').map(([e, s]) => (e === 'rejected' ? `rejected:${s}` : e));
    assert.deepEqual(names, ['frame', 'rejected:inference']);
  });

  test('a throwing observer never fails the capture', async () => {
    const tracker = createTracker();
    const { engines } = createEngines(tracker);
    const { provider, session } = await createProviderSession();
    const capture = new IdentityPhotoCapture({
      engines,
      provider,
      grabFrame: async () => tracker.bitmap(FRAME.width, FRAME.height, 'raw'),
      compose: async () => jpegBlob(),
      decode: async () => tracker.bitmap(480, 640, 'decoded'),
      observe: () => {
        throw new Error('observer bug');
      },
    });
    const result = await capture.capture(session);
    assert.equal(result.status, 'ClientValidated');
    assert.ok(capture.diagnosticErrors > 0);
    assert.deepEqual(tracker.open(), []);
  });

  test('a second concurrent capture is rejected with CAPTURE_BUSY', async () => {
    const frame = deferred();
    const tracker = createTracker();
    const { capture, session } = await observed({ grabFrame: () => frame.promise });
    const first = capture.capture(session);
    await assert.rejects(capture.capture(session), (error) => error.code === 'CAPTURE_BUSY');
    frame.resolve(tracker.bitmap(FRAME.width, FRAME.height, 'raw'));
    await first;
    assert.deepEqual(tracker.open(), []);
  });
});

describe('TC-10 face count', () => {
  test('two faces in the full raw frame reject before cropping or PAD submission', async () => {
    const { capture, tracker, session, provider } = await setup({ frameFaces: 2 });
    let recorded = 0;
    const record = provider.recordChallengeFrame.bind(provider);
    provider.recordChallengeFrame = (...args) => {
      recorded++;
      return record(...args);
    };
    await assert.rejects(capture.capture(session), (error) => {
      assert.ok(error instanceof FaceCountError);
      assert.equal(error.details.count, 2);
      assert.equal(error.details.stage, 'full raw frame');
      return true;
    });
    assert.equal(recorded, 0);
    assert.deepEqual(tracker.open(), []);
  });

  test('zero faces reject', async () => {
    const { capture, tracker, session } = await setup({ frameFaces: 0 });
    await assert.rejects(capture.capture(session), (error) => error instanceof FaceCountError && error.details.count === 0);
    assert.deepEqual(tracker.open(), []);
  });

  test('server-side full-frame count disagreeing with the client rejects at PAD', async () => {
    const { capture, session } = await setup({ serverFaces: 2 });
    await assert.rejects(capture.capture(session), (error) => /face count is 2/.test(error.message));
  });

  test('second face in decoded output is a hard audit failure', async () => {
    const { capture, tracker, session } = await setup({ auditFaces: 2 });
    await assert.rejects(capture.capture(session), (error) => error.report.hardFailures.includes('face-count'));
    assert.deepEqual(tracker.open(), []);
  });

  test('out-of-frame crop is rejected with guidance', async () => {
    const tracker = createTracker();
    const { capture, session } = await setup({
      // Same normalized face in a frame too narrow for a 3:4 crop around it.
      grabFrame: async () => tracker.bitmap(100, 720, 'raw'),
    });
    await assert.rejects(capture.capture(session), (error) => error instanceof CaptureRejectedError && error.code === 'OUT_OF_FRAME');
    assert.deepEqual(tracker.open(), []);
  });
});
