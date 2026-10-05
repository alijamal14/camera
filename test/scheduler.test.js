// TC-03: FIFO ownership, droppable preview, exclusive capture and monotonic timestamps.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DROPPED, InferenceScheduler } from '../src/scheduler.js';
import { deferred } from './fakes.js';

describe('TC-03 scheduler', () => {
  test('timestamps increase by at least 1 ms even when the clock stalls', () => {
    const scheduler = new InferenceScheduler({ now: () => 1000 });
    assert.deepEqual([1, 2, 3].map(() => scheduler.nextTimestamp()), [1000, 1001, 1002]);
  });

  test('timestamps follow the clock when it moves faster', () => {
    let now = 0;
    const scheduler = new InferenceScheduler({ now: () => (now += 50) });
    assert.deepEqual([1, 2].map(() => scheduler.nextTimestamp()), [50, 100]);
  });

  test('each job receives its own result and a distinct timestamp', async () => {
    const scheduler = new InferenceScheduler({ now: () => 0 });
    const results = await Promise.all([
      scheduler.runCapture(({ timestamp }) => ['a', timestamp]),
      scheduler.runCapture(({ timestamp }) => ['b', timestamp]),
    ]);
    assert.deepEqual(results, [
      ['a', 0],
      ['b', 1],
    ]);
  });

  test('capture waits for the active preview, drops queued previews, and runs exclusively', async () => {
    const scheduler = new InferenceScheduler();
    const order = [];
    const gate = deferred();
    const active = scheduler.runPreview(async () => {
      order.push('preview-1 start');
      await gate.promise;
      order.push('preview-1 end');
      return 'p1';
    });
    const queuedPreview = scheduler.runPreview(() => 'p2');
    const capture = scheduler.runCapture(() => {
      order.push('capture');
      return 'c';
    });
    const lateRequest = scheduler.runPreview(() => 'p3');

    assert.equal(await queuedPreview, DROPPED);
    assert.equal(await lateRequest, DROPPED, 'previews are dropped while a capture is pending');
    gate.resolve();
    assert.equal(await active, 'p1');
    assert.equal(await capture, 'c');
    assert.deepEqual(order, ['preview-1 start', 'preview-1 end', 'capture']);
    assert.equal(await scheduler.runPreview(() => 'p4'), 'p4', 'preview resumes after capture');
  });

  test('a newer preview replaces a queued one', async () => {
    const scheduler = new InferenceScheduler();
    const gate = deferred();
    const first = scheduler.runPreview(() => gate.promise);
    const second = scheduler.runPreview(() => 'second');
    const third = scheduler.runPreview(() => 'third');
    gate.resolve('first');
    assert.deepEqual(await Promise.all([first, second, third]), ['first', DROPPED, 'third']);
  });

  test('a failing job rejects only its own caller', async () => {
    const scheduler = new InferenceScheduler();
    const failing = scheduler.runCapture(() => {
      throw new Error('inference failed');
    });
    const next = scheduler.runCapture(() => 'ok');
    await assert.rejects(failing, /inference failed/);
    assert.equal(await next, 'ok');
  });

  test('close() rejects queued jobs and lets the active job finish', async () => {
    const scheduler = new InferenceScheduler();
    const gate = deferred();
    const active = scheduler.runCapture(() => gate.promise);
    const queued = scheduler.runCapture(() => 'never');
    const closed = new Error('disposed');
    scheduler.close(closed);
    await assert.rejects(queued, (error) => error === closed);
    await assert.rejects(scheduler.runPreview(() => 'x'), (error) => error === closed);
    gate.resolve('done');
    assert.equal(await active, 'done');
    assert.equal(scheduler.pending, 0);
  });
});
