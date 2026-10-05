import { assertManifestReady } from '../src/assets.js';
import { Compositor } from '../src/browser/compositor.js';
import { createEngines } from '../src/browser/engines.js';
import { encodeJpegUnderCap } from '../src/browser/encoder.js';
import { NadraPhotoCapture } from '../src/capture.js';
import { BiometricAuditError, CaptureRejectedError } from '../src/errors.js';
import { countFaces } from '../src/face-count.js';
import { OUTPUT, computePortraitCrop, measureFace } from '../src/geometry.js';
import { InstanceDisposedError } from '../src/lifecycle.js';
import { MOCK_LABEL, MockProvider } from '../src/mock-provider.js';
import { TelemetryClient } from '../src/telemetry.js';
import { createCaptureRecorder } from './recorder.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const previewCtx = $('preview').getContext('2d');

let capture = null;
let provider = null;
let stream = null;
let rafId = 0;
let previewBusy = false;
let personMaskIndex = 0;
let resultUrl = null;
let lastPreview = null;
let recorder = null; // Telemetry recorder for the capture in progress (one capture at a time).
let pipelineInfo = {};

// Session-only: the level is never persisted, so every page load starts with telemetry off.
const telemetry = new TelemetryClient({ token: document.querySelector('meta[name="telemetry-token"]')?.content });

$('mock-banner').textContent = `${MOCK_LABEL}. Results are ClientValidated at most, never ProviderAccepted.`;

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  $('log').textContent = `${line}\n${$('log').textContent}`;
}

function setStatus(text) {
  $('status').textContent = text;
}

function setButtons({ start, captureBtn, dispose }) {
  $('start').disabled = !start;
  $('capture').disabled = !captureBtn;
  $('dispose').disabled = !dispose;
}

$('consent').addEventListener('change', (event) => {
  setButtons({ start: event.target.checked && !capture, captureBtn: false, dispose: Boolean(capture) });
});

async function start() {
  setButtons({ start: false, captureBtn: false, dispose: false });
  try {
    setStatus('Loading asset manifest...');
    const manifest = await (await fetch('../assets/manifest.json')).json();
    const problems = assertManifestReady(manifest, { production: false });
    log(`Manifest ${manifest.version}: ${problems.length} production problem(s) (allowed in prototype).`);
    personMaskIndex = manifest.models.selfieSegmenter.personMaskIndex ?? 0;

    setStatus('Opening camera...');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    log(`Camera ${video.videoWidth}x${video.videoHeight}.`);

    setStatus('Loading MediaPipe models...');
    const { engines, delegate, models } = await createEngines(manifest, { production: false, log });
    log(`Engines ready on ${delegate}.`);
    pipelineInfo = {
      manifestVersion: manifest.version,
      tasksVision: manifest.client.tasksVision.version,
      segmenterModel: 'selfie_segmenter/float16/1',
      segmenterSha256: models.selfieSegmenter.sha256,
      segmenterPinned: models.selfieSegmenter.pinned,
      landmarkerSha256: models.faceLandmarker.sha256,
      landmarkerPinned: models.faceLandmarker.pinned,
      delegate,
      matteSource: 'mediapipe-confidence',
    };

    const exportCompositor = new Compositor();
    const previewCompositor = new Compositor();
    provider = new MockProvider({
      // Stands in for the backend's independent full-frame count on the selected evidence frame.
      countFaces: (frame) => countFaces(engines.auditLandmarker.detect(frame)),
    });

    capture = new NadraPhotoCapture({
      engines,
      provider,
      grabFrame: () => createImageBitmap(video), // Unmirrored camera pixels.
      compose: async ({ rawFrame, segmentation, crop }) => {
        const canvas = exportCompositor.composite({
          source: rawFrame,
          frameWidth: rawFrame.width,
          frameHeight: rawFrame.height,
          mask: segmentation.confidenceMasks[personMaskIndex],
          crop,
        });
        safely(() => recorder?.onComposite(exportCompositor, canvas));
        return encodeJpegUnderCap(canvas, { onEncoded: (info) => safely(() => recorder?.onEncoded(info)) });
      },
      observe: (event, payload) => recorder?.observe(event, payload),
      decode: (blob) => createImageBitmap(blob),
      stopSources: () => {
        cancelAnimationFrame(rafId);
        stream?.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
      },
    });

    const renderPreview = ({ segmentation, faces, jobId }) => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const crop = { sw: vh * 0.75, sh: vh, sx: (vw - vh * 0.75) / 2, sy: 0 };
      const mask = segmentation.confidenceMasks?.[personMaskIndex];
      if (mask) {
        const canvas = previewCompositor.composite({ source: video, frameWidth: vw, frameHeight: vh, mask, crop });
        previewCtx.setTransform(-1, 0, 0, 1, OUTPUT.width, 0); // Mirror the display only.
        previewCtx.drawImage(canvas, 0, 0);
        previewCtx.setTransform(1, 0, 0, 1, 0, 0);
        lastPreview = { jobId, at: performance.now() };
      }
      $('guidance').textContent = guidanceFor(faces, vw, vh);
    };

    const loop = () => {
      rafId = requestAnimationFrame(loop);
      if (previewBusy || video.readyState < 2) return;
      previewBusy = true;
      capture
        .previewTick(video, renderPreview)
        .catch((error) => {
          if (!(error instanceof InstanceDisposedError)) log(`Preview error: ${error.message}`);
        })
        .finally(() => {
          previewBusy = false;
        });
    };
    loop();

    setStatus('Live.');
    setButtons({ start: false, captureBtn: true, dispose: true });
  } catch (error) {
    log(`Start failed: ${error.message}`);
    setStatus(`Start failed: ${error.message}`);
    stream?.getTracks().forEach((track) => track.stop());
    setButtons({ start: $('consent').checked, captureBtn: false, dispose: Boolean(capture) });
  }
}

function guidanceFor(faces, frameWidth, frameHeight) {
  const count = countFaces(faces);
  if (count !== 1) return count === 0 ? 'No face detected.' : `Only one person may be in view (found ${count}).`;
  const measure = measureFace(faces.faceLandmarks[0], frameWidth, frameHeight);
  const crop = computePortraitCrop(measure, frameWidth, frameHeight);
  if (crop.outOfFrame) return 'Centre your face and step back so head and shoulders fit.';
  if (Math.abs(measure.rollDeg) > 3) return `Level your head (tilt ${measure.rollDeg.toFixed(1)} deg).`;
  if (crop.upscale > 1) return `Ready (advisory: move closer, ${crop.upscale.toFixed(2)}x upscaling).`;
  return 'Ready.';
}

// Diagnostics must never affect a capture.
function safely(fn) {
  try {
    fn();
  } catch (error) {
    log(`Telemetry copy failed: ${error.message}`);
  }
}

function cameraInfo() {
  const settings = stream?.getVideoTracks()[0]?.getSettings() ?? {};
  return { videoWidth: video.videoWidth, videoHeight: video.videoHeight, track: settings };
}

async function doCapture() {
  $('capture').disabled = true;
  setStatus('Capturing...');
  const bundle = telemetry.begin(); // null when telemetry is off: no copies, no requests.
  recorder = null;
  if (bundle) {
    safely(() => {
      recorder = createCaptureRecorder(bundle, {
        previewCanvas: $('preview'),
        lastPreview,
        camera: cameraInfo(),
        pipeline: pipelineInfo,
        personMaskIndex,
        threshold: 0.5,
      });
    });
  }
  const session = await provider.initSession();
  let result = null;
  try {
    await provider.startChallenge(session);
    result = await capture.capture(session);
    showResult(result);
    setStatus(`Captured: ${result.status} (${result.provider.status}).`);
    log(`Capture ${result.frameId}: ${result.jpeg.size} bytes, ${result.status}.`);
  } catch (error) {
    if (error instanceof BiometricAuditError) showReport(error.report);
    const code = error instanceof CaptureRejectedError ? ` [${error.code}]` : '';
    setStatus(`Rejected${code}: ${error.message}`);
    log(`Capture rejected${code}: ${error.message}`);
  } finally {
    await provider.cancelSession(session); // Mock evidence deleted after use.
    if (!capture.isDisposed) $('capture').disabled = false;
  }
  const finishing = recorder;
  recorder = null;
  if (finishing) {
    const outcome = result ? (result.status === 'ProviderAccepted' ? 'provider-accepted' : 'client-validated') : 'rejected';
    const saved = await finishing.finish({ outcome, result, diagnosticErrors: capture.diagnosticErrors });
    setTelemetryStatus(saved.status === 'saved' ? `Saved bundle ${saved.id}.` : `Telemetry ${saved.status}${saved.error?.code ? ` (${saved.error.code})` : ''}.`);
  }
}

function setTelemetryStatus(text) {
  $('telemetry-status').textContent = text;
}

$('telemetry-level').addEventListener('change', (event) => {
  telemetry.setLevel(event.target.value); // Lowering aborts uploads and discards pending bundles.
  setTelemetryStatus(event.target.value === 'off' ? 'Off. Nothing is copied or saved.' : `On (${event.target.value}) for this page session only.`);
});

$('telemetry-delete').addEventListener('click', async () => {
  try {
    await telemetry.deleteAll();
    setTelemetryStatus('All saved telemetry deleted.');
  } catch (error) {
    setTelemetryStatus(`Delete failed: ${error.code ?? error.message}`);
  }
});

function showResult(result) {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(result.jpeg);
  $('result-img').src = resultUrl;
  $('result-img').hidden = false;
  $('download').href = resultUrl;
  $('download').hidden = false;
  const c = result.crop;
  $('result-meta').textContent =
    `${result.jpeg.size} bytes, ${result.status}. Crop ${Math.round(c.sw)}x${Math.round(c.sh)} at ` +
    `(${Math.round(c.sx)}, ${Math.round(c.sy)}), upscale ${c.upscale.toFixed(2)}x.`;
  showReport(result.report);
}

function showReport(report) {
  const format = (value) => (typeof value === 'number' ? Number(value.toFixed(3)) : value ?? '');
  $('report').replaceChildren(
    ...report.items.map((item) => {
      const row = document.createElement('tr');
      for (const [text, cls] of [
        [item.id],
        [item.enforcement],
        [item.status, item.status],
        [format(item.value)],
        [item.reason],
      ]) {
        const cell = document.createElement('td');
        cell.textContent = String(text);
        if (cls) cell.className = cls;
        row.append(cell);
      }
      return row;
    }),
  );
}

async function doDispose() {
  setButtons({ start: false, captureBtn: false, dispose: false });
  setStatus('Disposing...');
  await capture.dispose();
  setStatus('Disposed. Waiting for cleanup...');
  capture.cleanupPromise.then(
    () => {
      setStatus('Disposed; all resources released.');
      log('cleanupPromise resolved.');
    },
    (error) => {
      setStatus(`Disposed with ${error.errors?.length ?? 1} release failure(s).`);
      log(`cleanupPromise rejected: ${error.message}`);
    },
  );
}

$('start').addEventListener('click', start);
$('capture').addEventListener('click', doCapture);
$('dispose').addEventListener('click', doDispose);
