// TC-08: disposal race, timeout and teardown failure.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { InstanceDisposedError, LifecycleController } from '../src/lifecycle.js';
import { deferred, flush } from './fakes.js';

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

const withTimeout = (promise, ms = 1000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);

describe('TC-08 lifecycle', () => {
  test('concurrent dispose() calls return the identical promise and tear down once', async () => {
    let teardowns = 0;
    const lifecycle = new LifecycleController({ teardown: () => void teardowns++ });
    const a = lifecycle.dispose();
    const b = lifecycle.dispose();
    assert.equal(a, b);
    await a;
    await lifecycle.cleanupPromise;
    assert.equal(teardowns, 1);
  });

  test('clean drain: teardown waits for the in-flight operation', async () => {
    const order = [];
    const lifecycle = new LifecycleController({ teardown: () => void order.push('teardown') });
    const gate = deferred();
    const op = lifecycle.track(async () => {
      await gate.promise;
      order.push('operation finished');
    });
    const disposed = lifecycle.dispose();
    await flush();
    assert.deepEqual(order, [], 'teardown must not start while an operation is in flight');
    gate.resolve();
    await assert.rejects(op, InstanceDisposedError);
    await disposed;
    await lifecycle.cleanupPromise;
    assert.deepEqual(order, ['operation finished', 'teardown']);
  });

  test('drain timeout: dispose resolves, teardown is deferred until the operation settles', async () => {
    let tornDown = false;
    const lifecycle = new LifecycleController({ drainTimeoutMs: 10, teardown: () => void (tornDown = true) });
    const gate = deferred();
    const lateBitmap = { closed: false, close() { this.closed = true; } };
    const op = lifecycle.track(() => gate.promise);

    await lifecycle.dispose();
    assert.equal(tornDown, false, 'teardown is prohibited while the operation is in flight');

    gate.resolve(lateBitmap);
    await assert.rejects(op, InstanceDisposedError);
    await withTimeout(lifecycle.cleanupPromise);
    assert.equal(tornDown, true);
    assert.equal(lateBitmap.closed, true, 'late result is closed');
  });

  // The last operation settles after the drain timer fires but before dispose resumes.
  // Teardown must still run exactly once, whatever the microtask interleaving.
  for (const opFirst of [true, false]) {
    for (let extraTicks = 0; extraTicks <= 4; extraTicks++) {
      test(`timeout/settle race (op ${opFirst ? 'before' : 'after'} timer, +${extraTicks} ticks)`, async () => {
        let teardowns = 0;
        const gate = deferred();
        const timers = {
          setTimeout: (callback) =>
            setTimeout(() => {
              if (opFirst) gate.resolve();
              callback();
              if (!opFirst) gate.resolve();
            }, 0),
          clearTimeout,
        };
        const lifecycle = new LifecycleController({ drainTimeoutMs: 0, timers, teardown: () => void teardowns++ });
        let settled = gate.promise;
        for (let i = 0; i < extraTicks; i++) settled = settled.then((value) => value);
        const op = lifecycle.track(() => settled);

        await lifecycle.dispose();
        await assert.rejects(op, InstanceDisposedError);
        await withTimeout(lifecycle.cleanupPromise);
        assert.equal(teardowns, 1);
        assert.equal(lifecycle.inFlightOperations, 0);
      });
    }
  }

  test('teardown failure: dispose resolves, cleanupPromise rejects with AggregateError', async () => {
    const failure = new Error('engine close failed');
    const lifecycle = new LifecycleController({
      teardown: () => {
        throw new AggregateError([failure], 'teardown');
      },
    });
    await lifecycle.dispose(); // Must not reject.
    await assert.rejects(lifecycle.cleanupPromise, (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [failure]);
      return true;
    });
  });

  test('teardown failure on the deferred path does not leak a rejection', async () => {
    const failure = new Error('deferred close failed');
    const lifecycle = new LifecycleController({
      drainTimeoutMs: 5,
      teardown: () => {
        throw failure;
      },
    });
    const gate = deferred();
    const op = lifecycle.track(() => gate.promise);
    await lifecycle.dispose();
    gate.resolve();
    await assert.rejects(op, InstanceDisposedError);
    await assert.rejects(withTimeout(lifecycle.cleanupPromise), (error) => error.errors[0] === failure);
  });

  test('late custom cleanup failure is recorded; the operation still reports disposal', async () => {
    const cleanupFailure = new Error('custom cleanup failed');
    const lifecycle = new LifecycleController({ drainTimeoutMs: 5 });
    const gate = deferred();
    const op = lifecycle.track(
      () => gate.promise,
      async () => {
        throw cleanupFailure;
      },
    );
    await lifecycle.dispose();
    gate.resolve({});
    await assert.rejects(op, InstanceDisposedError);
    await assert.rejects(withTimeout(lifecycle.cleanupPromise), (error) => error.errors.includes(cleanupFailure));
  });

  test('late result.close() failure is recorded without replacing the disposal error', async () => {
    const closeFailure = new Error('close failed');
    const lifecycle = new LifecycleController({ drainTimeoutMs: 5 });
    const gate = deferred();
    const op = lifecycle.track(() => gate.promise);
    await lifecycle.dispose();
    gate.resolve({
      close() {
        throw closeFailure;
      },
    });
    await assert.rejects(op, InstanceDisposedError);
    await assert.rejects(withTimeout(lifecycle.cleanupPromise), (error) => error.errors.includes(closeFailure));
  });

  test('stop() failure is aggregated and teardown still runs', async () => {
    const stopFailure = new Error('track.stop failed');
    let tornDown = false;
    const lifecycle = new LifecycleController({
      stop: () => {
        throw stopFailure;
      },
      teardown: () => void (tornDown = true),
    });
    await lifecycle.dispose();
    assert.equal(tornDown, true);
    await assert.rejects(lifecycle.cleanupPromise, (error) => error.errors.includes(stopFailure));
  });

  test('operations are rejected after dispose()', async () => {
    const lifecycle = new LifecycleController();
    lifecycle.dispose();
    await assert.rejects(lifecycle.track(async () => 1), InstanceDisposedError);
  });
});
