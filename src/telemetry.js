// Opt-in review telemetry (developer harness only). Off by default, session-only consent.
//
// - Levels: 'off' | 'basic' (preview + output + log) | 'diagnostic' (adds raw crop, alpha,
//   pre-JPEG composite and float32 confidence for the crop region).
// - Lowering the level aborts active uploads and discards pending bundles (generation counter).
// - Logs are built from an allowlist; sessions, nonces, tokens and free-form log text never appear.
// - Telemetry failures are returned as a status and never thrown into the capture flow.

export const TELEMETRY_SCHEMA = 1;
export const LEVELS = Object.freeze(['off', 'basic', 'diagnostic']);

export const ARTIFACTS = Object.freeze({
  'preview.png': { level: 'basic', type: 'image/png' },
  'output.jpg': { level: 'basic', type: 'image/jpeg' },
  'raw-crop.png': { level: 'diagnostic', type: 'image/png' },
  'alpha.png': { level: 'diagnostic', type: 'image/png' },
  'composite.png': { level: 'diagnostic', type: 'image/png' },
  'confidence.f32': { level: 'diagnostic', type: 'application/octet-stream' },
});

const rank = (level) => LEVELS.indexOf(level);

export function artifactAllowed(name, level) {
  const spec = ARTIFACTS[name];
  return Boolean(spec) && rank(level) >= rank(spec.level) && level !== 'off';
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const str = (value, max = 64) => (typeof value === 'string' ? value.slice(0, max) : undefined);
const bool = (value) => (typeof value === 'boolean' ? value : undefined);

function pick(source, spec) {
  if (!source || typeof source !== 'object') return undefined;
  const out = {};
  for (const [key, type] of Object.entries(spec)) {
    const value = type(source[key]);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const RECT = { sx: num, sy: num, sw: num, sh: num };

// Error codes and names only, plus a message stripped of URLs and paths.
export function sanitizeError(error) {
  if (!error) return undefined;
  const message = String(error.message ?? '')
    .replace(/[a-z]+:\/\/\S+/gi, '<url>')
    .replace(/(?:[A-Za-z]:)?[\\/][^\s'"]+/g, '<path>')
    .slice(0, 200);
  return pick({ name: error.name, code: error.code, message }, { name: str, code: str, message: (v) => str(v, 200) });
}

function auditSummary(report) {
  if (!report) return undefined;
  return {
    profile: str(report.profile),
    hardFailures: (report.hardFailures ?? []).map((id) => str(id)).filter(Boolean),
    items: (report.items ?? []).map((item) =>
      pick(item, {
        id: str,
        enforcement: str,
        status: str,
        value: (v) => num(v) ?? str(v, 32),
      }),
    ),
  };
}

export function buildLog(input) {
  return {
    schema: TELEMETRY_SCHEMA,
    captureId: str(input.captureId, 64),
    createdAt: new Date(input.createdAt ?? Date.now()).toISOString(),
    level: LEVELS.includes(input.level) ? input.level : undefined,
    outcome: str(input.outcome),
    stage: str(input.stage),
    timings: (input.timings ?? []).map((t) => pick(t, { name: str, ms: num })).filter(Boolean),
    preview: pick(input.preview, { jobId: num, ageMs: num, width: num, height: num, mirrored: bool }),
    camera: {
      ...pick(input.camera, { videoWidth: num, videoHeight: num }),
      track: pick(input.camera?.track, {
        width: num,
        height: num,
        frameRate: num,
        aspectRatio: num,
        facingMode: str,
        resizeMode: str,
      }),
    },
    frame: pick(input.frame, { width: num, height: num, mirrored: bool }),
    crop: pick(input.crop, { ...RECT, upscale: num, outOfFrame: bool }),
    mask: input.mask && {
      ...pick(input.mask, { width: num, height: num, personMaskIndex: num, threshold: num, remap: str }),
      maskCrop: pick(input.mask.maskCrop, RECT),
    },
    confidence: pick(input.confidence, { width: num, height: num, dtype: str, originX: num, originY: num }),
    pipeline: pick(input.pipeline, {
      manifestVersion: str,
      tasksVision: str,
      segmenterModel: str,
      segmenterSha256: str,
      segmenterPinned: bool,
      landmarkerSha256: str,
      landmarkerPinned: bool,
      delegate: str,
      matteSource: str,
      fallbackReason: str,
    }),
    encoder: pick(input.encoder, { name: str, quality: num, bytes: num, minQuality: num }),
    audit: auditSummary(input.audit),
    provider: pick(input.provider, { status: str, accepted: bool, mock: bool }),
    error: sanitizeError(input.error),
    diagnosticErrors: num(input.diagnosticErrors),
    artifacts: (input.artifacts ?? []).map((a) => pick(a, { name: str, bytes: num, sha256: str })).filter(Boolean),
  };
}

export class TelemetryDiscardedError extends Error {
  constructor() {
    super('Telemetry was turned off; bundle discarded.');
    this.name = 'TelemetryDiscardedError';
  }
}

async function toBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value && typeof value.arrayBuffer === 'function') return new Uint8Array(await value.arrayBuffer());
  throw new TypeError('Artifact must be a Blob, ArrayBuffer or typed array.');
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class TelemetryClient {
  #level = 'off';
  #generation = 0;
  #controllers = new Set();
  #token;
  #base;
  #fetch;

  constructor({ token, base = '/telemetry', fetchImpl = (...args) => fetch(...args) } = {}) {
    this.#token = token;
    this.#base = base;
    this.#fetch = fetchImpl;
  }

  get level() {
    return this.#level;
  }

  get activeUploads() {
    return this.#controllers.size;
  }

  setLevel(level) {
    if (!LEVELS.includes(level)) throw new RangeError(`Unknown telemetry level: ${level}`);
    if (rank(level) < rank(this.#level)) {
      this.#generation++;
      for (const controller of this.#controllers) controller.abort();
    }
    this.#level = level;
  }

  // Returns null when telemetry is off, so callers do no copying or encoding at all.
  begin() {
    return this.#level === 'off' ? null : new TelemetryBundle(this, this.#generation, this.#level);
  }

  isCurrent(generation, level) {
    return generation === this.#generation && rank(this.#level) >= rank(level) && this.#level !== 'off';
  }

  deleteAll() {
    return this.request('DELETE', '/bundles', { generation: null });
  }

  async request(method, path, { body, json, generation }) {
    if (generation !== null && generation !== this.#generation) throw new TelemetryDiscardedError();
    const controller = new AbortController();
    this.#controllers.add(controller);
    try {
      const headers = { 'x-telemetry-token': this.#token };
      if (json !== undefined) headers['content-type'] = 'application/json';
      const response = await this.#fetch(`${this.#base}${path}`, {
        method,
        headers,
        body: json !== undefined ? JSON.stringify(json) : body,
        signal: controller.signal,
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const error = new Error(`Telemetry ${method} ${path} failed with ${response.status}`);
        error.code = `HTTP_${response.status}`;
        throw error;
      }
      return response.status === 204 ? null : response.json();
    } catch (error) {
      if (controller.signal.aborted) throw new TelemetryDiscardedError();
      throw error;
    } finally {
      this.#controllers.delete(controller);
    }
  }
}

export class TelemetryBundle {
  #client;
  #generation;
  #artifacts = new Map();
  level;

  constructor(client, generation, level) {
    this.#client = client;
    this.#generation = generation;
    this.level = level;
  }

  get live() {
    return this.#client.isCurrent(this.#generation, 'basic');
  }

  wants(name) {
    return this.live && artifactAllowed(name, this.level);
  }

  // producer() runs immediately; it must already own its pixels (a copy, not a live resource).
  add(name, producer) {
    if (!this.wants(name)) return false;
    this.#artifacts.set(
      name,
      Promise.resolve()
        .then(producer)
        .then(toBytes),
    );
    return true;
  }

  // Never throws. Returns { status: 'saved' | 'discarded' | 'failed', id?, error? }.
  async finish(logInput) {
    let id = null;
    try {
      const settled = await Promise.allSettled(
        [...this.#artifacts].map(async ([name, bytes]) => ({ name, bytes: await bytes })),
      );
      if (!this.live) throw new TelemetryDiscardedError();
      const artifacts = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
      const encodeFailures = settled.filter((s) => s.status === 'rejected').length;

      const request = (method, path, options = {}) =>
        this.#client.request(method, path, { ...options, generation: this.#generation });
      ({ id } = await request('POST', '/bundles'));

      const manifest = [];
      for (const { name, bytes } of artifacts) {
        await request('PUT', `/bundles/${id}/${name}`, { body: bytes });
        manifest.push({ name, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) });
      }
      const log = buildLog({
        ...logInput,
        level: this.level,
        captureId: id,
        artifacts: manifest,
        diagnosticErrors: (logInput.diagnosticErrors ?? 0) + encodeFailures,
      });
      await request('POST', `/bundles/${id}/complete`, { json: log });
      return { status: 'saved', id };
    } catch (error) {
      if (id) this.#client.request('DELETE', `/bundles/${id}`, { generation: null }).catch(() => {});
      if (error instanceof TelemetryDiscardedError) return { status: 'discarded' };
      return { status: 'failed', error: sanitizeError(error) };
    }
  }
}
