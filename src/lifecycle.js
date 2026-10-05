// Operation tracking and disposal contract (plan section 7.1).
//
// - dispose() returns one shared promise and always resolves, even when releases fail.
// - cleanupPromise resolves after a successful teardown or rejects with AggregateError.
// - Teardown never runs while tracked operations are in flight. If the drain times out,
//   teardown is deferred until the in-flight count reaches zero.

export class InstanceDisposedError extends Error {
  constructor(message = 'Instance is disposed.') {
    super(message);
    this.name = 'InstanceDisposedError';
  }
}

export class LifecycleController {
  isDisposed = false;
  inFlightOperations = 0;

  #stop;
  #teardown;
  #drainTimeoutMs;
  #timers;
  #drainWaiters = [];
  #cleanupErrors = [];
  #disposePromise = null;
  #teardownPromise = null;
  #cleanupResolve;
  #cleanupReject;

  constructor({
    stop = () => {},
    teardown = async () => {},
    drainTimeoutMs = 2000,
    timers = { setTimeout, clearTimeout },
  } = {}) {
    this.#stop = stop;
    this.#teardown = teardown;
    this.#drainTimeoutMs = drainTimeoutMs;
    this.#timers = timers;
    this.cleanupPromise = new Promise((resolve, reject) => {
      this.#cleanupResolve = resolve;
      this.#cleanupReject = reject;
    });
    // Callers that only await dispose() must not see an unhandled rejection.
    this.cleanupPromise.catch(() => {});
  }

  // Release failures from normal operations are reported in the teardown aggregate.
  recordCleanupError(...errors) {
    this.#cleanupErrors.push(...errors);
  }

  async track(operation, cleanupResult = null) {
    if (this.isDisposed) throw new InstanceDisposedError('Operation rejected: instance is disposed.');
    this.inFlightOperations++;
    try {
      const result = await operation();
      if (this.isDisposed) {
        try {
          if (cleanupResult) await cleanupResult(result);
          else if (typeof result?.close === 'function') result.close();
          else result?.decodedImage?.close?.();
        } catch (error) {
          this.#cleanupErrors.push(error);
        }
        throw new InstanceDisposedError('Late result suppressed after disposal.');
      }
      return result;
    } finally {
      this.inFlightOperations--;
      if (this.inFlightOperations === 0) {
        for (const callback of this.#drainWaiters.splice(0)) callback();
      }
    }
  }

  dispose() {
    return (this.#disposePromise ??= this.#executeDispose());
  }

  async #executeDispose() {
    this.isDisposed = true;
    try {
      this.#stop();
    } catch (error) {
      this.#cleanupErrors.push(...(error instanceof AggregateError ? error.errors : [error]));
    }

    const drained = await this.#drain();
    const teardown = () => this.#teardownOnce().catch(() => {});
    // The last operation may settle after the timeout but before this continuation.
    if (drained || this.inFlightOperations === 0) await teardown();
    else this.#drainWaiters.push(teardown); // No await between the check and registration.
  }

  #drain() {
    if (this.inFlightOperations === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onDrain = () => {
        this.#timers.clearTimeout(timer);
        resolve(true);
      };
      const timer = this.#timers.setTimeout(() => {
        const index = this.#drainWaiters.indexOf(onDrain);
        if (index !== -1) this.#drainWaiters.splice(index, 1);
        resolve(false);
      }, this.#drainTimeoutMs);
      this.#drainWaiters.push(onDrain);
    });
  }

  #teardownOnce() {
    return (this.#teardownPromise ??= this.#performTeardown().then(
      () => this.#cleanupResolve(),
      (error) => {
        this.#cleanupReject(error);
        throw error;
      },
    ));
  }

  async #performTeardown() {
    const errors = [...this.#cleanupErrors];
    try {
      await this.#teardown();
    } catch (error) {
      errors.push(...(error instanceof AggregateError ? error.errors : [error]));
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Teardown failed on ${errors.length} resource(s).`);
    }
  }
}
