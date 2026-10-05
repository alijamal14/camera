// Deletes every stored telemetry bundle. Refuses directories without the store marker.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelemetryStore, defaultTelemetryDir, validateStoreDir } from './telemetry-store.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = await validateStoreDir(defaultTelemetryDir(), { servedRoot: root, create: false });
await new TelemetryStore(dir).removeAll();
console.log(`Purged telemetry bundles in ${dir}`);
