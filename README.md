# Photo capture prototype

Browser capture SDK and test harness for 480×640 identity photos with live white-background
preview, PAD-bound capture, and decoded-JPEG audit.

**Not affiliated with, endorsed by, or connected to any government identity authority.** This is an
independent prototype. Do not present outputs as officially compliant.

Status: prototype. The provider is a labelled mock with no PAD evaluation; results are at most
`ClientValidated`, never `ProviderAccepted`. Written approval from the target identity authority for
synthetic background editing remains a production gate.

Docs: [ali.mk313.com/camera](https://ali.mk313.com/camera/)

- **Client-only:** [Implement the browser SDK](https://ali.mk313.com/camera/#/guide/client-only) (`ClientValidated`)
- **Server / provider:** [Implement the backend contract](https://ali.mk313.com/camera/#/guide/server-provider) (`ProviderAccepted`)

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
| `src/capture.js` | `IdentityPhotoCapture`: preview tick and PAD-bound capture transaction |
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

## License

MIT. See [LICENSE](LICENSE).
