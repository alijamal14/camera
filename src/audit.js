import { BiometricAuditError } from './errors.js';
import { countFaces } from './face-count.js';
import { OUTPUT, measureFraming } from './geometry.js';

export const AUDIT_PROFILE = 'prototype-0';
export const MAX_JPEG_BYTES = 30_000;

const item = (id, enforcement, status, value, reason) => ({
  id,
  enforcement,
  status,
  value,
  profile: AUDIT_PROFILE,
  reason,
});

const inRange = (value, min, max) => value >= min && value <= max;

const advisory = (id, value, ok, reason) => item(id, 'ADVISORY', ok ? 'PASS' : 'FAIL', value, reason);

// Measurements with no validated implementation in this profile. Never reported as PASS.
const PENDING = [
  ['eyes-open', 'No morphology-aware eye-openness profile is validated yet.'],
  ['expression-teeth', 'Lip-gap and blendshape proxies cannot prove hidden teeth.'],
  ['lighting', 'Cheek symmetry, clipping and colour cast are uncalibrated.'],
  ['sharpness', 'Face-interior sharpness is uncalibrated on decoded JPEGs.'],
  ['background', 'White-background tolerance is uncalibrated for this JPEG/mask profile.'],
  ['pose-yaw-pitch', 'Transformation-matrix pose is unvalidated on this device.'],
];

// Independent decoded-JPEG audit. `landmarker` must be a separate IMAGE-mode instance so
// detection does not inherit VIDEO tracking state. The decoded bitmap is closed in finally.
export async function auditJpeg(jpeg, { decode, landmarker, maxBytes = MAX_JPEG_BYTES }) {
  const items = [
    item('mime', 'HARD', jpeg.type === 'image/jpeg' ? 'PASS' : 'FAIL', jpeg.type, 'JPEG required'),
    item('bytes', 'HARD', jpeg.size <= maxBytes ? 'PASS' : 'FAIL', jpeg.size, `<= ${maxBytes} bytes`),
  ];

  const decoded = await decode(jpeg);
  try {
    const dimsOk = decoded.width === OUTPUT.width && decoded.height === OUTPUT.height;
    items.push(item('dimensions', 'HARD', dimsOk ? 'PASS' : 'FAIL', `${decoded.width}x${decoded.height}`, '480x640'));

    const result = landmarker.detect(decoded);
    const faces = countFaces(result);
    items.push(item('face-count', 'HARD', faces === 1 ? 'PASS' : 'FAIL', faces, 'Exactly one face in decoded output'));

    if (faces === 1) {
      const f = measureFraming(result.faceLandmarks[0]);
      items.push(
        advisory('head-length', f.headLength, inRange(f.headLength, 0.7, 0.8), 'Target 70-80%; crown estimate uncalibrated'),
        advisory('eye-vertical', f.eyeFromTop, inRange(f.eyeFromTop, 0.35, 0.45), 'Target 35-45% from top'),
        advisory('eye-horizontal', f.eyeX, inRange(f.eyeX, 0.475, 0.525), 'Target 47.5-52.5% of width'),
        advisory('roll', f.rollDeg, Math.abs(f.rollDeg) <= 3, 'Target <= 3 degrees; landmark profile unvalidated'),
      );
    }
  } finally {
    decoded.close();
  }

  for (const [id, reason] of PENDING) items.push(item(id, 'ADVISORY', 'PENDING_SERVER_VERIFICATION', null, reason));

  const report = {
    profile: AUDIT_PROFILE,
    items,
    hardFailures: items.filter((i) => i.enforcement === 'HARD' && i.status === 'FAIL').map((i) => i.id),
  };
  if (report.hardFailures.length > 0) throw new BiometricAuditError(report);
  return report;
}
