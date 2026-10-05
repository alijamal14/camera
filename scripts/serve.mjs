// Harness entry point. localhost is a secure context, so camera access works.
// One command: replaces a stale copy of this harness on the port, serves the page, and prints
// the telemetry summary at startup plus one line per saved bundle.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from './server.mjs';
import { TelemetryStore, defaultTelemetryDir, validateStoreDir } from './telemetry-store.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const port = Number(arg('port') ?? process.env.PORT ?? 5173);

const dir = await validateStoreDir(arg('telemetry-dir') ?? defaultTelemetryDir(), { servedRoot: root });
const store = new TelemetryStore(dir);
const swept = await store.sweep();
setInterval(() => store.sweep().catch((error) => console.error(`sweep failed: ${error.message}`)), 3600 * 1000).unref();

async function countBundles() {
  let count = 0;
  const bundles = join(dir, 'bundles');
  for (const day of existsSync(bundles) ? await readdir(bundles) : []) count += (await readdir(join(bundles, day))).length;
  return count;
}

// Finds the process listening on the port; returns its pid only if it is this harness (serve.mjs).
function staleHarnessPid() {
  try {
    if (process.platform === 'win32') {
      const script =
        `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
        `if ($c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"; "$($p.ProcessId)|$($p.CommandLine)" }`;
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
      const [pid, commandLine = ''] = out.split('|');
      return /scripts[\\/]serve\.mjs/.test(commandLine) && Number(pid) !== process.pid ? Number(pid) : null;
    }
    const pid = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0];
    const commandLine = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' });
    return /scripts\/serve\.mjs/.test(commandLine) ? Number(pid) : null;
  } catch {
    return null;
  }
}

const { server } = createAppServer({ root, store, log: (line) => console.log(line) });
let retried = false;
server
  .on('error', (error) => {
    if (error.code !== 'EADDRINUSE') throw error;
    const pid = retried ? null : staleHarnessPid();
    if (pid) {
      retried = true;
      console.log(`Port ${port} is held by an older harness (pid ${pid}); replacing it.`);
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/F']);
      else process.kill(pid);
      setTimeout(() => server.listen(port, '127.0.0.1'), 500);
      return;
    }
    console.error(`Port ${port} is used by another program. Use another port: PORT=5174 npm run serve (PowerShell: $env:PORT=5174; npm run serve)`);
    process.exitCode = 1;
  })
  .on('listening', async () => {
    console.log(`Harness:   http://localhost:${port}/web/`);
    console.log(`Telemetry: ${dir}`);
    console.log(`           ${await countBundles()} saved bundle(s)${swept ? `, ${swept} expired` : ''}. Saved captures are listed below as they arrive.`);
    console.log('           Full table: npm run telemetry:report');
  })
  .listen(port, '127.0.0.1');
