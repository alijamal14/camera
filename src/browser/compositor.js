import { OUTPUT, mapCropToMask } from '../geometry.js';

// Clean subject-on-white compositing (plan section 5). Surfaces are reused per instance;
// use separate instances for preview and export so they never share state.
export class Compositor {
  #threshold;
  #maskCanvas = new OffscreenCanvas(1, 1);
  #maskCtx = this.#maskCanvas.getContext('2d');
  #maskImage = null;
  #cutout = new OffscreenCanvas(OUTPUT.width, OUTPUT.height);
  #cutoutCtx = this.#cutout.getContext('2d');
  #output = new OffscreenCanvas(OUTPUT.width, OUTPUT.height);
  #outputCtx = this.#output.getContext('2d');

  // threshold: confidence below this is background. Remapping is a product policy, not matting.
  constructor({ threshold = 0.5 } = {}) {
    this.#threshold = threshold;
  }

  get threshold() {
    return this.#threshold;
  }

  // Subject cutout from the last composite(); its alpha is the matte used. Valid until the next call.
  get cutout() {
    return this.#cutout;
  }

  // source: unmirrored frame (ImageBitmap or video). mask: MPMask spanning the full frame.
  // Returns the 480x640 output canvas, valid until the next composite() call.
  composite({ source, frameWidth, frameHeight, mask, crop }) {
    this.#writeMaskAlpha(mask);
    const maskCrop = mapCropToMask(crop, frameWidth, frameHeight, mask.width, mask.height);
    const { width, height } = OUTPUT;

    const cut = this.#cutoutCtx;
    cut.setTransform(1, 0, 0, 1, 0, 0);
    cut.globalCompositeOperation = 'source-over';
    cut.clearRect(0, 0, width, height);
    cut.imageSmoothingQuality = 'high';
    cut.drawImage(this.#maskCanvas, maskCrop.sx, maskCrop.sy, maskCrop.sw, maskCrop.sh, 0, 0, width, height);
    cut.globalCompositeOperation = 'source-in';
    cut.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
    cut.globalCompositeOperation = 'source-over';

    const out = this.#outputCtx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = 'source-over';
    out.fillStyle = '#FFFFFF';
    out.fillRect(0, 0, width, height);
    out.drawImage(this.#cutout, 0, 0);
    return this.#output;
  }

  #writeMaskAlpha(mask) {
    const { width, height } = mask;
    if (this.#maskCanvas.width !== width || this.#maskCanvas.height !== height) {
      this.#maskCanvas.width = width;
      this.#maskCanvas.height = height;
      this.#maskImage = null;
    }
    this.#maskImage ??= this.#maskCtx.createImageData(width, height);
    const alpha = this.#maskImage.data;
    const values = mask.getAsFloat32Array();
    const t = this.#threshold;
    for (let i = 0; i < values.length; i++) {
      const p = values[i];
      alpha[i * 4 + 3] = p > t ? Math.min(255, Math.round(((p - t) / (1 - t)) * 255)) : 0;
    }
    this.#maskCtx.putImageData(this.#maskImage, 0, 0);
  }
}
