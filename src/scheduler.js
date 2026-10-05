// Single FIFO scheduler for VIDEO-mode inference (plan section 4).
//
// - One job runs at a time; only this scheduler invokes VIDEO-mode engines.
// - Preview jobs are droppable: a newer preview replaces a queued one, and previews are
//   dropped while a capture is queued or running.
// - Every job receives a fresh timestamp: max(now, last + 1) ms, strictly increasing.
// - Tasks must not call the scheduler themselves (that would deadlock); use ctx.nextTimestamp().

export const DROPPED = Object.freeze({ dropped: true });

export class InferenceScheduler {
  #queue = [];
  #active = null;
  #closedError = null;
  #lastTimestamp = -Infinity;
  #nextJobId = 1;
  #now;

  constructor({ now = () => performance.now() } = {}) {
    this.#now = now;
  }

  get pending() {
    return this.#queue.length + (this.#active ? 1 : 0);
  }

  get capturePending() {
    return this.#active?.kind === 'capture' || this.#queue.some((job) => job.kind === 'capture');
  }

  nextTimestamp() {
    this.#lastTimestamp = Math.max(this.#now(), this.#lastTimestamp + 1);
    return this.#lastTimestamp;
  }

  runPreview(task) {
    if (this.#closedError) return Promise.reject(this.#closedError);
    if (this.capturePending) return Promise.resolve(DROPPED);
    this.#dropQueuedPreviews();
    return this.#enqueue('preview', task);
  }

  runCapture(task) {
    if (this.#closedError) return Promise.reject(this.#closedError);
    this.#dropQueuedPreviews();
    return this.#enqueue('capture', task);
  }

  // Rejects queued jobs; the active job finishes and is drained by the lifecycle.
  close(error) {
    this.#closedError ??= error;
    for (const job of this.#queue.splice(0)) job.reject(this.#closedError);
  }

  #dropQueuedPreviews() {
    this.#queue = this.#queue.filter((job) => {
      if (job.kind !== 'preview') return true;
      job.resolve(DROPPED);
      return false;
    });
  }

  #enqueue(kind, task) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ id: this.#nextJobId++, kind, task, resolve, reject });
      this.#pump();
    });
  }

  async #pump() {
    if (this.#active) return;
    while (this.#queue.length > 0) {
      const job = (this.#active = this.#queue.shift());
      try {
        const ctx = {
          jobId: job.id,
          kind: job.kind,
          timestamp: this.nextTimestamp(),
          nextTimestamp: () => this.nextTimestamp(),
        };
        job.resolve(await job.task(ctx));
      } catch (error) {
        job.reject(error);
      } finally {
        this.#active = null;
      }
    }
  }
}
