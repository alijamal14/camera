import { MAX_JPEG_BYTES } from '../audit.js';
import { CaptureRejectedError } from '../errors.js';

// Highest JPEG quality (in whole percent) that fits the byte cap, down to a floor.
// The 0.55 floor is an initial Class B candidate; quality is a setting, not a quality measure.
export async function encodeJpegUnderCap(
  canvas,
  { maxBytes = MAX_JPEG_BYTES, minQuality = 0.55, maxQuality = 0.95, onEncoded = () => {} } = {},
) {
  let low = Math.round(minQuality * 100);
  let high = Math.round(maxQuality * 100);
  let best = null;
  while (low <= high) {
    const quality = (low + high) >> 1;
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
    if (blob.size <= maxBytes) {
      best = { blob, quality };
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }
  if (!best) {
    throw new CaptureRejectedError(
      'ENCODING_FLOOR',
      `JPEG exceeds ${maxBytes} bytes even at quality ${minQuality}.`,
      { maxBytes, minQuality },
    );
  }
  if (best.blob.type !== 'image/jpeg') {
    throw new CaptureRejectedError('ENCODING_MIME', `Encoder produced ${best.blob.type}, not image/jpeg.`);
  }
  onEncoded({ name: 'canvas-convertToBlob', quality: best.quality / 100, bytes: best.blob.size, minQuality });
  return best.blob;
}
