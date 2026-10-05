// Harness entry point. localhost is a secure context, so camera access works.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createAppServer } from './server.mjs';
import { TelemetryStore, defaultTelemetryDir, validateStoreDir } from './telemetry-store.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const port = Number(arg('port') ?? process.env.PORT ?? 5173);

const dir = await validateStoreDir(arg('telemetry-dir') ?? defaultTelemetryDir(), { servedRoot: root });
const store = new TelemetryStore(dir);
const swept = await store.sweep();
setInterval(() => store.sweep().catch((error) => console.error(`sweep failed: ${error.message}`)), 3600 * 1000).unref();

const { server } = createAppServer({ root, store, log: (line) => console.log(line) });
server
  .on('error', (error) => {
    if (error.code !== 'EADDRINUSE') throw error;
    console.error(`Port ${port} is already in use; the harness may already be running at http://localhost:${port}/web/`);
    console.error(`Use another port with: PORT=5174 npm run serve (PowerShell: $env:PORT=5174; npm run serve)`);
    process.exitCode = 1;
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Harness: http://localhost:${port}/web/`);
    console.log(`Telemetry store (opt-in, local only): ${dir}${swept ? ` (expired ${swept})` : ''}`);
  });
