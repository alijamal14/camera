// Owned diagnostic copies for telemetry. Every function copies synchronously so the result stays
// valid after the capture releases its frame, mask and reusable compositor surfaces.

const MAX_DIMENSION = 4096;

export function copyCanvas(source, width = source.width, height = source.height) {
  const copy = new OffscreenCanvas(width, height);
  copy.getContext('2d').drawImage(source, 0, 0, width, height);
  return copy;
}

// Unmirrored source pixels of the crop at native camera resolution (no resampling to 480x640).
export function copyRawCrop(rawFrame, crop) {
  const sx = Math.max(0, Math.floor(crop.sx));
  const sy = Math.max(0, Math.floor(crop.sy));
  const width = Math.min(MAX_DIMENSION, Math.min(rawFrame.width, Math.ceil(crop.sx + crop.sw)) - sx);
  const height = Math.min(MAX_DIMENSION, Math.min(rawFrame.height, Math.ceil(crop.sy + crop.sh)) - sy);
  const copy = new OffscreenCanvas(width, height);
  copy.getContext('2d').drawImage(rawFrame, sx, sy, width, height, 0, 0, width, height);
  return { canvas: copy, originX: sx, originY: sy };
}

// Original float32 confidence for the crop region in mask coordinates (before any remap).
export function copyConfidenceCrop(mask, maskCrop) {
  const values = mask.getAsFloat32Array();
  const x0 = Math.max(0, Math.floor(maskCrop.sx));
  const y0 = Math.max(0, Math.floor(maskCrop.sy));
  const x1 = Math.min(mask.width, Math.ceil(maskCrop.sx + maskCrop.sw));
  const y1 = Math.min(mask.height, Math.ceil(maskCrop.sy + maskCrop.sh));
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    data.set(values.subarray((y0 + y) * mask.width + x0, (y0 + y) * mask.width + x0 + width), y * width);
  }
  return { data, width, height, originX: x0, originY: y0 };
}

// Grayscale PNG of a canvas's alpha channel (the matte actually used for compositing).
export async function alphaToPng(canvas) {
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    px[i] = a;
    px[i + 1] = a;
    px[i + 2] = a;
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export const toPng = (canvas) => canvas.convertToBlob({ type: 'image/png' });
