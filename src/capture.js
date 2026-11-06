import { auditJpeg } from './audit.js';
import { CaptureRejectedError, PadRejectedError } from './errors.js';
import { assertSingleFace } from './face-count.js';
import { computePortraitCrop, measureFace } from './geometry.js';
import { InstanceDisposedError, LifecycleController } from './lifecycle.js';
import { ResourceScope } from './resources.js';
import { InferenceScheduler } from './scheduler.js';

const DEFAULT_POLICY = Object.freeze({
  // Class B product policy, not an external identity-authority rule. Reported as advisory unless enforced.
  maxUpscale: 1.0,
  enforceUpscale: false,
});

/**
 * Capture SDK core. Browser specifics are injected so the ownership rules are testable:
 *
 * engines.segmenter, engines.landmarker  VIDEO-mode, used only through the scheduler
 * engines.auditLandmarker                separate IMAGE-mode instance for the decoded audit
 * grabFrame()                            returns a new unmirrored ImageBitmap owned by the capture
 * compose({ rawFrame, segmentation, crop }) returns a JPEG Blob (client fallback/prototype path)
 * decode(blob)                           returns a closable decoded bitmap
 * provider                               provider adapter (see mock-provider.js)
 * observe(event, payload)                optional synchronous diagnostics observer; resources in
 *                                        the payload are valid only during the call
 */
export class IdentityPhotoCapture {
  #engines;
  #provider;
  #grabFrame;
  #compose;
  #decode;
  #policy;
  #scheduler;
  #lifecycle;
  #observe;
  #clock;
  #captureActive = false;
  #diagnosticErrors = 0;

  constructor({
    observe = null,
    clock = () => performance.now(),
    engines,
    provider,
    grabFrame,
    compose,
    decode,
    policy = {},
    stopSources = () => {},
    releaseExtras = () => [],
    drainTimeoutMs = 2000,
    timers,
    now,
  }) {
    this.#engines = engines;
    this.#provider = provider;
    this.#grabFrame = grabFrame;
    this.#compose = compose;
    this.#decode = decode;
    this.#policy = { ...DEFAULT_POLICY, ...policy };
    this.#observe = observe;
    this.#clock = clock;
    this.#scheduler = new InferenceScheduler({ now });
    this.#lifecycle = new LifecycleController({
      drainTimeoutMs,
      timers,
      stop: () => {
        this.#scheduler.close(new InstanceDisposedError('Queued inference cancelled by disposal.'));
        stopSources();
      },
      // Runs only after in-flight operations reach zero, so no engine is closed mid-inference.
      teardown: () => {
        const scope = new ResourceScope();
        for (const engine of Object.values(this.#engines)) scope.adopt(engine);
        const errors = [...scope.releaseAll(), ...releaseExtras()];
        if (errors.length > 0) throw new AggregateError(errors, 'Engine teardown failed.');
      },
    });
  }

  get cleanupPromise() {
    return this.#lifecycle.cleanupPromise;
  }

  get isDisposed() {
    return this.#lifecycle.isDisposed;
  }

  dispose() {
    return this.#lifecycle.dispose();
  }

  // One preview inference on a live source (e.g. HTMLVideoElement). The segmentation result
  // is valid only inside onResult and is closed afterwards. Resolves DROPPED when skipped.
  previewTick(source, onResult) {
    return this.#lifecycle.track(() =>
      this.#scheduler.runPreview(({ timestamp, jobId }) => {
        const scope = new ResourceScope();
        try {
          const segmentation = scope.adopt(this.#engines.segmenter.segmentForVideo(source, timestamp));
          const faces = this.#engines.landmarker.detectForVideo(source, timestamp);
          onResult({ segmentation, faces, timestamp, jobId });
        } finally {
          this.#lifecycle.recordCleanupError(...scope.releaseAll());
        }
      }),
    );
  }

  // Captures one frame during an active provider challenge and returns the client candidate.
  // Every raw frame, segmentation result and decoded bitmap is released on every path.
  //
  // One capture at a time: a second call rejects with CAPTURE_BUSY so injected compose/export
  // surfaces are never shared between captures.
  capture(session) {
    if (this.#captureActive) {
      return Promise.reject(new CaptureRejectedError('CAPTURE_BUSY', 'A capture is already in progress.'));
    }
    this.#captureActive = true;
    return this.#lifecycle
      .track(() => this.#runCapture(session))
      .finally(() => {
        this.#captureActive = false;
      });
  }

  async #runCapture(session) {
    const scope = new ResourceScope();
    let stage = 'frame';
    let stageStart = this.#clock();
    const enter = (next) => {
      const now = this.#clock();
      this.#emit('stage', { name: stage, ms: now - stageStart });
      stage = next;
      stageStart = now;
    };
    try {
      const rawFrame = scope.adopt(await this.#grabFrame());
      this.#checkpoint();
      this.#emit('frame', { rawFrame });

      enter('inference');
      const { face, segmentation } = await this.#scheduler.runCapture(({ timestamp }) => {
        // Full uncropped frame: a second person outside the portrait crop still rejects.
        const face = assertSingleFace(
          this.#engines.landmarker.detectForVideo(rawFrame, timestamp),
          'full raw frame',
        );
        const segmentation = scope.adopt(this.#engines.segmenter.segmentForVideo(rawFrame, timestamp));
        return { face, segmentation };
      });
      this.#checkpoint();
      this.#emit('segmented', { rawFrame, segmentation, face });

      // The exact selected frame is part of the evidence PAD evaluates.
      enter('pad');
      const frameId = await this.#provider.recordChallengeFrame(session, rawFrame, { selected: true });
      const pad = await this.#provider.finishChallenge(session, frameId);
      if (!pad.passed) throw new PadRejectedError(pad);
      this.#checkpoint();

      enter('crop');
      const crop = computePortraitCrop(
        measureFace(face, rawFrame.width, rawFrame.height),
        rawFrame.width,
        rawFrame.height,
      );
      if (crop.outOfFrame) {
        throw new CaptureRejectedError(
          'OUT_OF_FRAME',
          'The head and shoulders do not fit in the camera frame. Step back and centre your face.',
          { crop },
        );
      }
      if (this.#policy.enforceUpscale && crop.upscale > this.#policy.maxUpscale) {
        throw new CaptureRejectedError(
          'UPSCALE_LIMIT',
          `Face is too small in the camera frame (needs ${crop.upscale.toFixed(2)}x upscaling). Move closer.`,
          { crop },
        );
      }

      this.#emit('cropped', { rawFrame, segmentation, crop });

      enter('compose');
      const jpeg = await this.#compose({ rawFrame, segmentation, crop });
      this.#checkpoint();
      this.#emit('encoded', { jpeg, crop });

      enter('audit');
      const report = await auditJpeg(jpeg, { decode: this.#decode, landmarker: this.#engines.auditLandmarker });
      report.items.push({
        id: 'upscale',
        enforcement: this.#policy.enforceUpscale ? 'HARD' : 'ADVISORY',
        status: crop.upscale <= this.#policy.maxUpscale ? 'PASS' : 'FAIL',
        value: crop.upscale,
        profile: report.profile,
        reason: `Product policy: <= ${this.#policy.maxUpscale}x`,
      });

      this.#emit('audited', { report });

      enter('provider');
      const provider = await this.#provider.generateOrVerifyPhoto(session, { frameId, candidateJpeg: jpeg, crop });
      enter('done');
      return {
        jpeg,
        frameId,
        crop,
        report,
        provider,
        status: provider.accepted === true ? 'ProviderAccepted' : 'ClientValidated',
      };
    } catch (error) {
      this.#emit('stage', { name: stage, ms: this.#clock() - stageStart });
      this.#emit('rejected', { stage, error });
      throw error;
    } finally {
      this.#lifecycle.recordCleanupError(...scope.releaseAll());
    }
  }

  get diagnosticErrors() {
    return this.#diagnosticErrors;
  }

  // Observers are synchronous and read-only. A throwing observer never affects the capture.
  #emit(event, payload) {
    if (!this.#observe) return;
    try {
      this.#observe(event, payload);
    } catch {
      this.#diagnosticErrors++;
    }
  }

  // Stops a capture between steps once disposal has begun; the finally block still releases.
  #checkpoint() {
    if (this.#lifecycle.isDisposed) throw new InstanceDisposedError('Capture cancelled by disposal.');
  }
}
