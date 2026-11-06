# Client-only implementation

Ship the **browser** half only: camera → preview → capture → 480×640 white JPEG → client audit.

Use [`MockProvider`](https://github.com/alijamal14/camera/blob/main/src/mock-provider.js) (or a stub
with the same shape) until a real server exists.

<div class="callout callout-ok">
  <strong>Done when</strong>
  The harness captures a JPEG, hard audit checks pass, and status is
  <span class="badge badge-client">ClientValidated</span>.
  The mock must <strong>never</strong> return <code>accepted: true</code>.
</div>

## At a glance

| | |
| :--- | :--- |
| **You own** | Camera, preview, crop, compose, encode, client audit |
| **You do not own** | Authority acceptance, real PAD, independent server face count |
| **Ceiling** | `ClientValidated` |
| **Reference wiring** | [`web/app.js`](https://github.com/alijamal14/camera/blob/main/web/app.js) |

## What this path is not

- Not authority acceptance (`ProviderAccepted`)
- Not real PAD evaluation
- Not production `assertManifestReady(manifest, { production: true })` until hashes and server
  runtime are pinned

Need the backend contract? See [Server / provider](/guide/server-provider).

## Requirements

- Node.js 20+
- Chromium-based browser with a camera
- `localhost` or HTTPS (camera permission)

## Run the reference harness

```bash
npm test
npm run serve
```

Open [http://localhost:5173/web/](http://localhost:5173/web/).

> Agent smoke tests: use `harness-verify` on port **5181** with
> `--telemetry-dir=%LOCALAPPDATA%/camera-telemetry-verify`. Do not take over 5173 while someone is testing.

## Wire the SDK (mirror the harness)

<ol class="steps">
  <li>Load <code>assets/manifest.json</code> and call <code>assertManifestReady(manifest, { production: false })</code> in prototype mode.</li>
  <li>Open the camera with <code>getUserMedia</code>; keep the raw video element <strong>unmirrored</strong> for capture.</li>
  <li><code>createEngines(manifest)</code> — VIDEO segmenter + landmarker, plus a separate IMAGE-mode <code>auditLandmarker</code>.</li>
  <li>Build <code>Compositor</code> + <code>encodeJpegUnderCap</code> for export; a second compositor may paint the mirrored preview.</li>
  <li>Construct <code>MockProvider</code> (optional: pass <code>countFaces</code> that uses the audit landmarker as a stand-in for server count).</li>
  <li>Construct <code>IdentityPhotoCapture</code> with the injections below.</li>
  <li><code>provider.initSession()</code> → <code>startChallenge(session)</code> → <code>capture(session)</code> while the challenge is active.</li>
  <li><code>dispose()</code> through the lifecycle when tearing down; do not close engines while a capture is in flight.</li>
</ol>

### Required injections

| Injection | Role |
| :--- | :--- |
| `engines` | `segmenter`, `landmarker` (VIDEO, scheduler-only), `auditLandmarker` (IMAGE, audit) |
| `grabFrame()` | Returns a **new unmirrored** `ImageBitmap` owned by the capture |
| `compose({ rawFrame, segmentation, crop })` | Returns a JPEG `Blob` (white background, ≤ 30 KB) |
| `decode(blob)` | Returns a closable decoded bitmap for audit |
| `provider` | Adapter implementing the [provider API](/guide/provider-api) |
| `observe(event, payload)` | Optional; synchronous; must never fail the capture |

Sketch (abbreviated from the harness):

```js
import { IdentityPhotoCapture } from '../src/capture.js';
import { MockProvider } from '../src/mock-provider.js';
import { createEngines } from '../src/browser/engines.js';
import { Compositor } from '../src/browser/compositor.js';
import { encodeJpegUnderCap } from '../src/browser/encoder.js';

const { engines } = await createEngines(manifest, { production: false });
const exportCompositor = new Compositor();
const provider = new MockProvider();

const capture = new IdentityPhotoCapture({
  engines,
  provider,
  grabFrame: () => createImageBitmap(video), // unmirrored
  compose: async ({ rawFrame, segmentation, crop }) => {
    const canvas = exportCompositor.composite({
      source: rawFrame,
      frameWidth: rawFrame.width,
      frameHeight: rawFrame.height,
      mask: segmentation.confidenceMasks[personMaskIndex],
      crop,
    });
    return encodeJpegUnderCap(canvas);
  },
  decode: (blob) => createImageBitmap(blob),
});

const session = await provider.initSession();
await provider.startChallenge(session);
const result = await capture.capture(session);
// result.status === 'ClientValidated' with the mock
```

## Hard rules (client)

| Rule | Why |
| :--- | :--- |
| Mirror **only** the DOM preview | Export, PAD evidence, and coordinates stay unmirrored |
| VIDEO engines only via the scheduler | Preview jobs are droppable; capture is exclusive |
| One capture at a time | Second call → `CAPTURE_BUSY` so export surfaces are never shared |
| Own and release every bitmap / mask | `finally` / `ResourceScope`; no leaks on reject paths |
| Do not close engines while work is in flight | Teardown through `LifecycleController` |
| Mock must never return `accepted: true` | Prevents fake `ProviderAccepted` in prototypes |

## What the client returns

On success, `capture(session)` resolves to roughly:

| Field | Meaning |
| :--- | :--- |
| `jpeg` | Candidate identity JPEG |
| `frameId` | Selected evidence frame id from the provider |
| `crop` | Portrait crop used for compose |
| `report` | Decoded-JPEG audit (HARD / ADVISORY / PENDING) |
| `provider` | Provider response object |
| `status` | `ProviderAccepted` only if `provider.accepted === true`; else `ClientValidated` |

Hard client audit (must pass before submit): MIME, byte cap, 480×640, face count on decoded output.
Framing is **advisory** until calibrated.

## Pitfalls

<div class="callout callout-warn">
  <strong>Common mistakes</strong>
  Using a mirrored bitmap for <code>grabFrame</code>; calling VIDEO engines outside the scheduler;
  sharing one compositor canvas across concurrent captures; treating <code>ClientValidated</code> as
  production acceptance; enabling <code>production: true</code> before pinning hashes.
</div>

## Next

1. [How capture works](/guide/how-it-works) — pipeline narrative  
2. [Server / provider](/guide/server-provider) — when you need real acceptance  
3. [Harness check](/skills/harness-check) — smoke-test engines and encoder  
4. [Privacy](/guide/privacy) — no biometric persistence in the product path  
