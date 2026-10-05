// Framing geometry on unmirrored camera coordinates. Landmarks are normalized [0, 1].

export const OUTPUT = Object.freeze({ width: 480, height: 640 });

export const LANDMARKS = Object.freeze({ irisA: 468, irisB: 473, forehead: 10, chin: 152 });

// Class C candidate: forehead-to-chin is not a crown measurement. Uncalibrated.
export const CROWN_MULTIPLIER_CANDIDATE = 1.25;

// Class B product targets (centre of the 70-80% / 35-45% / 47.5-52.5% bands).
export const FRAMING_TARGET = Object.freeze({ headLength: 0.75, eyeFromTop: 0.4, eyeX: 0.5 });

const toPixels = (landmark, width, height) => ({ x: landmark.x * width, y: landmark.y * height });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function measureFace(landmarks, width, height) {
  const a = toPixels(landmarks[LANDMARKS.irisA], width, height);
  const b = toPixels(landmarks[LANDMARKS.irisB], width, height);
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  const forehead = toPixels(landmarks[LANDMARKS.forehead], width, height);
  const chin = toPixels(landmarks[LANDMARKS.chin], width, height);
  return {
    eyeMid: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 },
    rollDeg: (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI,
    headLengthPx: distance(forehead, chin) * CROWN_MULTIPLIER_CANDIDATE,
  };
}

// Crop rectangle in source pixels that places the face at the framing target in 480x640.
export function computePortraitCrop(measure, frameWidth, frameHeight, target = FRAMING_TARGET) {
  const scale = (target.headLength * OUTPUT.height) / measure.headLengthPx; // output px per source px
  const sw = OUTPUT.width / scale;
  const sh = OUTPUT.height / scale;
  const sx = measure.eyeMid.x - target.eyeX * sw;
  const sy = measure.eyeMid.y - target.eyeFromTop * sh;
  return {
    sx,
    sy,
    sw,
    sh,
    upscale: Math.max(OUTPUT.width / sw, OUTPUT.height / sh),
    outOfFrame: sx < 0 || sy < 0 || sx + sw > frameWidth || sy + sh > frameHeight,
  };
}

// Valid only when the mask spans the full raw frame without padding or rotation.
export function mapCropToMask(crop, frameWidth, frameHeight, maskWidth, maskHeight) {
  const kx = maskWidth / frameWidth;
  const ky = maskHeight / frameHeight;
  return { sx: crop.sx * kx, sy: crop.sy * ky, sw: crop.sw * kx, sh: crop.sh * ky };
}

// Framing measured on the 480x640 output, as fractions of the output size.
export function measureFraming(landmarks) {
  const m = measureFace(landmarks, OUTPUT.width, OUTPUT.height);
  return {
    headLength: m.headLengthPx / OUTPUT.height,
    eyeFromTop: m.eyeMid.y / OUTPUT.height,
    eyeX: m.eyeMid.x / OUTPUT.width,
    rollDeg: m.rollDeg,
  };
}
