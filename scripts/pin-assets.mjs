// Records SHA-256 hashes for every unpinned URL in assets/manifest.json.
// Pinning trusts the bytes served today: review the versions before committing the result.
// Usage: npm run pin-assets [-- --force]   (--force re-hashes entries that are already pinned)
import { readFile, writeFile } from 'node:fs/promises';
import { sha256Hex } from '../src/assets.js';

const manifestUrl = new URL('../assets/manifest.json', import.meta.url);
const force = process.argv.includes('--force');
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

const entries = [
  ...Object.values(manifest.models),
  manifest.client.tasksVision.bundle,
  ...manifest.client.tasksVision.wasmFiles,
];

for (const entry of entries) {
  if (entry.sha256 && !force) continue;
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`Fetch failed (${response.status}) for ${entry.url}`);
  const hash = await sha256Hex(await response.arrayBuffer());
  if (entry.sha256 && entry.sha256 !== hash) console.warn(`CHANGED ${entry.url}\n  was ${entry.sha256}`);
  entry.sha256 = hash;
  console.log(`${hash}  ${entry.url}`);
}

await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Server runtime and JPEG encoder remain unpinned until the backend is chosen.');
