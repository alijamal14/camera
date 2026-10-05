// Turns capture observer events into one telemetry bundle. All copies are synchronous, so they
// stay valid after the capture releases its frame and mask. Never throws into the capture.
import { alphaToPng, copyCanvas, copyConfidenceCrop, copyRawCrop, toPng } from '../src/browser/diagnostics.js';
import { BiometricAuditError } from '../src/errors.js';
import { mapCropToMask } from '../src/geometry.js';

export function createCaptureRecorder(bundle, { previewCanvas, lastPreview, camera, pipeline, personMaskIndex, threshold }) {
  const now = performance.now();
  const log = {
    createdAt: Date.now(),
    timings: [],
    camera,
    pipeline,
    preview: lastPreview && {
      jobId: lastPreview.jobId,
      ageMs: now - lastPreview.at,
      width: previewCanvas.width,
      height: previewCanvas.height,
      mirrored: true, // DOM display copy only; never evidence.
    },
  };

  // The displayed preview is copied at click time, before the next render overwrites it.
  if (bundle.wants('preview.png')) {
    const preview = copyCanvas(previewCanvas);
    bundle.add('preview.png', () => toPng(preview));
  }

  const onCropped = ({ rawFrame, segmentation, crop }) => {
    log.crop = crop;
    const mask = segmentation.confidenceMasks?.[personMaskIndex];
    if (!mask) return;
    const maskCrop = mapCropToMask(crop, rawFrame.width, rawFrame.height, mask.width, mask.height);
    log.mask = {
      width: mask.width,
      height: mask.height,
      personMaskIndex,
      threshold,
      remap: 'linear-above-threshold',
      maskCrop,
    };
    if (bundle.wants('raw-crop.png')) {
      const raw = copyRawCrop(rawFrame, crop);
      bundle.add('raw-crop.png', () => toPng(raw.canvas));
    }
    if (bundle.wants('confidence.f32')) {
      const confidence = copyConfidenceCrop(mask, maskCrop);
      log.confidence = { width: confidence.width, height: confidence.height, dtype: 'float32', originX: confidence.originX, originY: confidence.originY };
      bundle.add('confidence.f32', () => confidence.data);
    }
  };

  return {
    observe(event, payload) {
      switch (event) {
        case 'stage':
          log.timings.push({ name: payload.name, ms: payload.ms });
          break;
        case 'frame':
          log.frame = { width: payload.rawFrame.width, height: payload.rawFrame.height, mirrored: false };
          break;
        case 'cropped':
          onCropped(payload);
          break;
        case 'encoded':
          bundle.add('output.jpg', () => payload.jpeg);
          break;
        case 'audited':
          log.audit = payload.report;
          break;
        case 'rejected':
          log.stage = payload.stage;
          log.error = payload.error;
          if (payload.error?.details?.crop) log.crop = payload.error.details.crop;
          if (payload.error instanceof BiometricAuditError) log.audit = payload.error.report;
          break;
        default:
      }
    },

    // Called from compose with the export compositor right after composite(), before encoding.
    onComposite(compositor, outputCanvas) {
      if (bundle.wants('composite.png')) {
        const composite = copyCanvas(outputCanvas);
        bundle.add('composite.png', () => toPng(composite));
      }
      if (bundle.wants('alpha.png')) {
        const cutout = copyCanvas(compositor.cutout);
        bundle.add('alpha.png', () => alphaToPng(cutout));
      }
    },

    onEncoded(info) {
      log.encoder = info;
    },

    finish({ outcome, result, diagnosticErrors }) {
      if (result) {
        log.stage = 'done';
        log.provider = result.provider;
      }
      return bundle.finish({ ...log, outcome, diagnosticErrors });
    },
  };
}
