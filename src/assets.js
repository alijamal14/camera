// Asset manifest checks. Production refuses unpinned hashes and an unpinned server runtime.

export function listManifestProblems(manifest) {
  const problems = [];
  const requireHash = (label, entry) => {
    if (!entry?.url) problems.push(`${label}: missing url`);
    if (!/^[0-9a-f]{64}$/.test(entry?.sha256 ?? '')) problems.push(`${label}: sha256 not pinned`);
  };

  for (const [name, model] of Object.entries(manifest.models ?? {})) requireHash(`models.${name}`, model);

  const tv = manifest.client?.tasksVision;
  if (!tv?.version) problems.push('client.tasksVision: version not pinned');
  requireHash('client.tasksVision.bundle', tv?.bundle);
  (tv?.wasmFiles ?? []).forEach((file, i) => requireHash(`client.tasksVision.wasmFiles[${i}]`, file));

  for (const side of ['client', 'server']) {
    for (const name of manifest[side]?.models ?? []) {
      if (!manifest.models?.[name]) problems.push(`${side}.models: unknown model "${name}"`);
    }
  }

  const server = manifest.server ?? {};
  for (const key of ['runtime', 'jpegEncoder']) {
    if (!server[key]?.name || !server[key]?.version) problems.push(`server.${key}: name/version not pinned`);
  }
  if (server.fullFrameFaceCount?.numFaces < 2) problems.push('server.fullFrameFaceCount: numFaces must be >= 2');

  return problems;
}

export function assertManifestReady(manifest, { production }) {
  const problems = listManifestProblems(manifest);
  if (production && problems.length > 0) {
    throw new Error(`Asset manifest is not production-ready:\n- ${problems.join('\n- ')}`);
  }
  return problems;
}

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fetches a model and checks its pinned hash. Unpinned models load only outside production.
export async function fetchVerified(entry, { production, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(entry.url);
  if (!response.ok) throw new Error(`Fetch failed (${response.status}) for ${entry.url}`);
  const buffer = await response.arrayBuffer();
  const actual = await sha256Hex(buffer);
  if (entry.sha256 && entry.sha256 !== actual) {
    throw new Error(`Integrity mismatch for ${entry.url}: expected ${entry.sha256}, got ${actual}`);
  }
  if (!entry.sha256 && production) throw new Error(`Unpinned asset refused in production: ${entry.url}`);
  return { bytes: new Uint8Array(buffer), sha256: actual, pinned: Boolean(entry.sha256) };
}
