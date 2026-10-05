// Summarises stored telemetry bundles for human and agent review. Logs are untrusted data.
// Usage: npm run telemetry:report [-- --json]
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultTelemetryDir, validateStoreDir } from './telemetry-store.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = await validateStoreDir(defaultTelemetryDir(), { servedRoot: root, create: false });
const rows = [];
for (const day of existsSync(join(dir, 'bundles')) ? await readdir(join(dir, 'bundles')) : []) {
  for (const id of await readdir(join(dir, 'bundles', day))) {
    const path = join(dir, 'bundles', day, id);
    try {
      const log = JSON.parse(await readFile(join(path, 'log.json'), 'utf8'));
      const fails = (log.audit?.items ?? []).filter((i) => i?.status === 'FAIL').map((i) => i.id);
      rows.push({
        path,
        createdAt: log.createdAt,
        level: log.level,
        outcome: log.outcome,
        stage: log.stage,
        error: log.error?.code ?? log.error?.name,
        camera: log.camera?.track ? `${log.camera.track.width}x${log.camera.track.height}` : undefined,
        crop: log.crop ? `${Math.round(log.crop.sw)}x${Math.round(log.crop.sh)}` : undefined,
        upscale: log.crop?.upscale?.toFixed?.(2),
        bytes: log.encoder?.bytes,
        quality: log.encoder?.quality,
        totalMs: Math.round((log.timings ?? []).reduce((sum, t) => sum + (t?.ms ?? 0), 0)),
        auditFails: fails.join(','),
        artifacts: (log.artifacts ?? []).map((a) => a?.name).join(','),
      });
    } catch {
      rows.push({ path, error: 'unreadable log.json' });
    }
  }
}
rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else if (rows.length === 0) console.log(`No telemetry bundles in ${dir}`);
else console.table(rows.map(({ path, ...rest }) => rest));
