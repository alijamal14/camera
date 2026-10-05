import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { OUTPUT, computePortraitCrop, mapCropToMask, measureFace, measureFraming } from '../src/geometry.js';
import { FRAME, FRAME_FACE, OUTPUT_FACE, faceLandmarks } from './fakes.js';

const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

describe('geometry', () => {
  test('crop places the eye midpoint and head length at the framing targets', () => {
    const measure = measureFace(FRAME_FACE, FRAME.width, FRAME.height);
    const crop = computePortraitCrop(measure, FRAME.width, FRAME.height);
    const scale = OUTPUT.width / crop.sw;
    close(crop.sw / crop.sh, 0.75);
    close((measure.eyeMid.x - crop.sx) * scale, 240);
    close((measure.eyeMid.y - crop.sy) * scale, 0.4 * 640);
    close(measure.headLengthPx * scale, 0.75 * 640);
    assert.equal(crop.outOfFrame, false);
  });

  test('roll does not depend on which iris landmark is on the left (mirroring safety)', () => {
    const tilted = { eyes: [[100, 100], [200, 110]], forehead: [150, 50], chin: [150, 250] };
    const swapped = { ...tilted, eyes: [tilted.eyes[1], tilted.eyes[0]] };
    const a = measureFace(faceLandmarks(tilted, 400, 400), 400, 400);
    const b = measureFace(faceLandmarks(swapped, 400, 400), 400, 400);
    close(a.rollDeg, b.rollDeg);
    close(a.rollDeg, (Math.atan2(10, 100) * 180) / Math.PI);
  });

  test('crop maps into mask coordinates by independent x/y scale', () => {
    const crop = { sx: 320, sy: 90, sw: 480, sh: 640 };
    const mask = mapCropToMask(crop, 1280, 720, 256, 256);
    close(mask.sx, 64);
    close(mask.sy, 32);
    close(mask.sw, 96);
    close(mask.sh, (640 * 256) / 720);
  });

  test('output framing of the reference face hits the targets', () => {
    const f = measureFraming(OUTPUT_FACE);
    close(f.eyeFromTop, 0.4);
    close(f.eyeX, 0.5);
    close(f.headLength, 0.75);
    close(f.rollDeg, 0);
  });
});
