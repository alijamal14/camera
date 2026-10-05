// Local telemetry store for the developer harness. Lives outside the served root.
//
// Layout:  <dir>/.camera-telemetry-store       marker; purge refuses a directory without it
//          <dir>/partial/<id>/                  in-progress uploads
//          <dir>/bundles/<YYYY-MM-DD>/<id>/     completed bundles (log.json + complete marker)

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, parse, relative, resolve, isAbsolute } from 'node:path';

export const MARKER = '.camera-telemetry-store';
export const ARTIFACT_NAMES = Object.freeze([
  'preview.png',
  'output.jpg',
  'raw-crop.png',
  'alpha.png',
  'composite.png',
  'confidence.f32',
]);
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_DIMENSION = 4096;

export function defaultTelemetryDir(env = process.env) {
  if (env.TELEMETRY_DIR) return env.TELEMETRY_DIR;
  const base = env.LOCALAPPDATA ?? join(homedir(), '.local', 'share');
  return join(base, 'camera-telemetry');
}

const isInside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

// Refuses any directory where creating or purging telemetry could touch unrelated data.
export async function validateStoreDir(dir, { servedRoot, create = true } = {}) {
  if (!dir || !isAbsolute(dir)) throw new Error(`TELEMETRY_DIR must be an absolute path: ${dir}`);
  const target = resolve(dir);
  if (parse(target).root === target) throw new Error(`TELEMETRY_DIR cannot be a drive or filesystem root: ${target}`);
  if (resolve(homedir()) === target) throw new Error('TELEMETRY_DIR cannot be the home directory.');
  if (servedRoot && (isInside(target, servedRoot) || isInside(servedRoot, target))) {
    throw new Error(`TELEMETRY_DIR must be outside the served root (${servedRoot}): ${target}`);
  }
  if (existsSync(target)) {
    const entries = await readdir(target);
    if (entries.length > 0 && !entries.includes(MARKER)) {
      throw new Error(`TELEMETRY_DIR is not empty and has no ${MARKER} marker: ${target}`);
    }
  } else if (!create) {
    throw new Error(`TELEMETRY_DIR does not exist: ${target}`);
  }
  if (create) {
    await mkdir(join(target, 'partial'), { recursive: true });
    await mkdir(join(target, 'bundles'), { recursive: true });
    await writeFile(join(target, MARKER), 'Camera harness telemetry store. Safe to purge.\n');
  }
  return target;
}

export function imageDimensions(name, bytes) {
  if (name.endsWith('.png')) {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (name.endsWith('.jpg')) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      i += 2 + length;
    }
    return null;
  }
  return null;
}

// Returns null when valid, or a reason string.
export function validateArtifact(name, bytes) {
  if (!ARTIFACT_NAMES.includes(name)) return 'unknown artifact name';
  if (name === 'confidence.f32') {
    return bytes.length % 4 === 0 && bytes.length <= MAX_DIMENSION * MAX_DIMENSION * 4 ? null : 'invalid float32 length';
  }
  const dims = imageDimensions(name, bytes);
  if (!dims) return 'not a valid image of the declared type';
  if (!dims.width || !dims.height || dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) return 'invalid dimensions';
  if (name === 'output.jpg' && (dims.width !== 480 || dims.height !== 640)) return 'output.jpg must be 480x640';
  return null;
}

async function directorySize(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const full = join(path, entry.name);
    total += entry.isDirectory() ? await directorySize(full) : (await stat(full)).size;
  }
  return total;
}

export class TelemetryStore {
  constructor(dir, { quotaBytes = 250 * 1024 * 1024, retentionMs = 7 * 24 * 3600 * 1000, maxPartials = 4, now = Date.now } = {}) {
    this.dir = dir;
    this.quotaBytes = quotaBytes;
    this.retentionMs = retentionMs;
    this.maxPartials = maxPartials;
    this.now = now;
  }

  #partial(id) {
    if (!ID_PATTERN.test(id)) throw Object.assign(new Error('bad id'), { status: 404 });
    return join(this.dir, 'partial', id);
  }

  async create() {
    const open = await readdir(join(this.dir, 'partial'));
    if (open.length >= this.maxPartials) throw Object.assign(new Error('too many open bundles'), { status: 429 });
    const id = randomUUID();
    await mkdir(this.#partial(id));
    return id;
  }

  async putArtifact(id, name, bytes) {
    const dir = this.#partial(id);
    if (!existsSync(dir)) throw Object.assign(new Error('unknown bundle'), { status: 404 });
    const reason = validateArtifact(name, bytes);
    if (reason) throw Object.assign(new Error(reason), { status: 422 });
    if ((await directorySize(this.dir)) + bytes.length > this.quotaBytes) {
      throw Object.assign(new Error('telemetry quota exceeded'), { status: 507 });
    }
    await writeFile(join(dir, name), bytes);
  }

  // Atomic: the bundle appears under bundles/ only after log.json and the marker are written.
  async complete(id, log) {
    const dir = this.#partial(id);
    if (!existsSync(dir)) throw Object.assign(new Error('unknown bundle'), { status: 404 });
    await writeFile(join(dir, 'log.json'), `${JSON.stringify({ ...log, captureId: id }, null, 2)}\n`);
    await writeFile(join(dir, 'complete'), new Date(this.now()).toISOString());
    const day = new Date(this.now()).toISOString().slice(0, 10);
    await mkdir(join(this.dir, 'bundles', day), { recursive: true });
    const finalDir = join(this.dir, 'bundles', day, id);
    await rename(dir, finalDir);
    return finalDir;
  }

  async remove(id) {
    await rm(this.#partial(id), { recursive: true, force: true });
    for (const day of await readdir(join(this.dir, 'bundles'))) {
      await rm(join(this.dir, 'bundles', day, id), { recursive: true, force: true });
    }
  }

  async removeAll() {
    for (const sub of ['partial', 'bundles']) {
      await rm(join(this.dir, sub), { recursive: true, force: true });
      await mkdir(join(this.dir, sub));
    }
  }

  // Deletes completed bundles past retention and abandoned partial uploads (> 1 hour).
  async sweep() {
    const cutoff = this.now() - this.retentionMs;
    let removed = 0;
    for (const day of await readdir(join(this.dir, 'bundles'))) {
      for (const id of await readdir(join(this.dir, 'bundles', day))) {
        const path = join(this.dir, 'bundles', day, id);
        if ((await stat(path)).mtimeMs < cutoff) {
          await rm(path, { recursive: true, force: true });
          removed++;
        }
      }
      if ((await readdir(join(this.dir, 'bundles', day))).length === 0) await rm(join(this.dir, 'bundles', day), { recursive: true });
    }
    for (const id of await readdir(join(this.dir, 'partial'))) {
      const path = join(this.dir, 'partial', id);
      if ((await stat(path)).mtimeMs < this.now() - 3600 * 1000) {
        await rm(path, { recursive: true, force: true });
        removed++;
      }
    }
    return removed;
  }
}
