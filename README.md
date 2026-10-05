# Photo capture prototype

Browser capture SDK and test harness for the consolidated plan at
`C:\Users\ali\.gemini\antigravity-cli\brain\52d83028-6147-4872-8694-e09a8943af2b\live-background-removal-plan.md`.

Status: prototype. The provider is a labelled mock with no PAD evaluation; results are at most
`ClientValidated`, never `ProviderAccepted`. NADRA's written approval of synthetic background
editing remains a production gate.

## Run

```bash
npm test
```

```bash
npm run serve
```

Then open http://localhost:5173/web/ (camera access needs localhost or HTTPS). One terminal is enough:
`serve` replaces an older copy of this harness on the port (never another program), prints the
telemetry store summary at startup, and logs one line per saved capture bundle.

Optional review telemetry: choose **Save captures** (Off / Basic / Diagnostic) on the page. Bundles go to
`%LOCALAPPDATA%\camera-telemetry` (outside the repo), expire after 7 days, and can be listed or deleted:

```bash
npm run telemetry:report
```

```bash
npm run telemetry:purge
```

## Layout

| Path | Role |
| :--- | :--- |
| `src/lifecycle.js` | Operation tracking and the disposal contract (TC-08) |
| `src/scheduler.js` | FIFO VIDEO-mode scheduler, droppable preview, monotonic timestamps (TC-03) |
| `src/resources.js` | Ownership scope for bitmaps, masks and engines (TC-11) |
| `src/capture.js` | `NadraPhotoCapture`: preview tick and PAD-bound capture transaction |
| `src/face-count.js` | Full-frame single-face gate (TC-10) |
| `src/geometry.js` | Crop placement, mask mapping, framing measurements |
| `src/audit.js` | Decoded-JPEG audit with HARD / ADVISORY / PENDING items |
| `src/mock-provider.js` | Mock provider adapter: session expiry, single use, selected-frame binding |
| `src/assets.js`, `assets/manifest.json` | Pinned client and server assets; production refuses unpinned hashes |
| `src/browser/` | MediaPipe engine creation, compositor, JPEG encoder |
| `web/` | Test harness page |
| `docs/architecture.md` | Plan-to-code map, test status, production gates |
| `src/telemetry.js`, `scripts/server.mjs`, `scripts/telemetry-*.mjs`, `web/recorder.js` | Opt-in local review telemetry |

## Pinning assets

`assets/manifest.json` ships with `sha256: null`. `npm run pin-assets` fetches each URL and records
its hash; review the versions before committing. The server runtime and JPEG encoder stay unpinned
until a backend is chosen, so `assertManifestReady(manifest, { production: true })` fails until then.
