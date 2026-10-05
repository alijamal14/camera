import { MockProvider } from '../src/mock-provider.js';

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));

// Records every closable resource handed out so tests can prove nothing leaks.
export function createTracker() {
  const resources = [];
  const make = (label, props = {}, { closeError = null } = {}) => {
    const resource = {
      label,
      closed: false,
      ...props,
      close() {
        resource.closed = true;
        if (closeError) throw closeError;
      },
    };
    resources.push(resource);
    return resource;
  };
  return {
    bitmap: (width, height, label = 'bitmap', options) => make(label, { width, height }, options),
    segmentation: (label = 'segmentation') => make(label, { confidenceMasks: [] }),
    all: () => resources,
    open: () => resources.filter((r) => !r.closed).map((r) => r.label),
  };
}

// 478 normalized landmarks with the indices used by geometry.js set explicitly.
export function faceLandmarks({ eyes, forehead, chin }, width, height) {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const n = ([x, y]) => ({ x: x / width, y: y / height, z: 0 });
  points[468] = n(eyes[0]);
  points[473] = n(eyes[1]);
  points[10] = n(forehead);
  points[152] = n(chin);
  return points;
}

export const FRAME = { width: 1280, height: 720 };
export const FRAME_FACE = faceLandmarks(
  { eyes: [[610, 300], [670, 300]], forehead: [640, 250], chin: [640, 480] },
  FRAME.width,
  FRAME.height,
);
// Output-space face matching the framing targets: eyes at 40% from top, head 75%.
export const OUTPUT_FACE = faceLandmarks(
  { eyes: [[210, 256], [270, 256]], forehead: [240, 200], chin: [240, 584] },
  480,
  640,
);

export function createEngines(tracker, { frameFaces = 1, auditFaces = 1, closeErrors = {} } = {}) {
  const calls = [];
  const engine = (name, methods) => ({
    name,
    closed: false,
    close() {
      this.closed = true;
      calls.push(['close', name]);
      if (closeErrors[name]) throw closeErrors[name];
    },
    ...methods,
  });
  return {
    calls,
    engines: {
      segmenter: engine('segmenter', {
        segmentForVideo(source, timestamp) {
          calls.push(['segmentForVideo', timestamp, source.label]);
          return tracker.segmentation(`segmentation@${timestamp}`);
        },
      }),
      landmarker: engine('landmarker', {
        detectForVideo(source, timestamp) {
          calls.push(['detectForVideo', timestamp, source.label]);
          return { faceLandmarks: Array.from({ length: frameFaces }, () => FRAME_FACE) };
        },
      }),
      auditLandmarker: engine('auditLandmarker', {
        detect(image) {
          calls.push(['detect', image.label]);
          return { faceLandmarks: Array.from({ length: auditFaces }, () => OUTPUT_FACE) };
        },
      }),
    },
  };
}

export async function createProviderSession({ serverFaces = 1 } = {}) {
  const provider = new MockProvider({ countFaces: () => serverFaces });
  const session = await provider.initSession();
  await provider.startChallenge(session);
  return { provider, session };
}

export const jpegBlob = (size = 20_000) => ({ type: 'image/jpeg', size });
