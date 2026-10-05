import { FaceCountError } from './errors.js';

// Landmarkers must be created with numFaces >= 2; with numFaces: 1 a second person is invisible.
export const MIN_NUM_FACES_SETTING = 2;

export function countFaces(landmarkerResult) {
  return landmarkerResult?.faceLandmarks?.length ?? 0;
}

// Run on the full, uncropped frame so a second person outside the portrait crop still rejects.
export function assertSingleFace(landmarkerResult, stage) {
  const count = countFaces(landmarkerResult);
  if (count !== 1) throw new FaceCountError(count, stage);
  return landmarkerResult.faceLandmarks[0];
}
