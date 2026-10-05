// Deletes every stored telemetry bundle. Refuses directories without the store marker.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelemetryStore, defaultTelemetryDir, validateStoreDir } from './telemetry-store.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (!existsSync(defaultTelemetryDir())) {
  console.log(`Nothing to purge: ${defaultTelemetryDir()} does not exist.`);
  process.exit(0);
}
const dir = await validateStoreDir(defaultTelemetryDir(), { servedRoot: root, create: false });
await new TelemetryStore(dir).removeAll();
console.log(`Purged telemetry bundles in ${dir}`);
