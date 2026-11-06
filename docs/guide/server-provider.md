# Server / provider implementation

Build the half the browser **must not** be trusted for: session lifetime, PAD on the selected
evidence frame, an independent face count, and accept / reject.

[`MockProvider`](https://github.com/alijamal14/camera/blob/main/src/mock-provider.js) is the
**behaviour spec** for the client SDK — not a production backend. It performs no PAD and
**never** returns `accepted: true`.

<div class="callout callout-ok">
  <strong>Done when</strong>
  Your provider enforces the state machine below, binds the candidate to the PAD-selected frame,
  counts faces server-side (exactly one), and only then may return <code>accepted: true</code>
  → client status <span class="badge badge-provider">ProviderAccepted</span>.
</div>

## At a glance

| | |
| :--- | :--- |
| **You own** | Session, PAD, selected-frame binding, independent face count, accept / reject |
| **You do not own** | DOM preview, MediaPipe VIDEO loop |
| **Ceiling** | `ProviderAccepted` (only when your server sets `accepted: true`) |
| **Contract** | [Provider API](/guide/provider-api) |

## Trust boundary

| Client may do | Server must do |
| :--- | :--- |
| UX framing, client face gate, JPEG audit | Treat client checks as **untrusted** for acceptance |
| Send selected frame + candidate JPEG | PAD on that exact frame; bind `frameId` to the candidate |
| Show `ClientValidated` | Decide `accepted` only after server verification |

## Session state machine

The mock enforces this sequence. Your server should match it (names can differ; behaviour must not).

```text
initialized  --startChallenge-->  challenge
challenge    --finishChallenge--> evaluated   (PAD result)
evaluated    --generateOrVerifyPhoto--> consumed   (single use)
```

Also enforce on every call:

- Unknown session / bad nonce → reject  
- Expiry (`expiresAt`) → reject  
- Wrong state for the method → reject  
- `generateOrVerifyPhoto` with a `frameId` that is not the selected PAD frame → `FRAME_MISMATCH`

## What to implement

<ol class="steps">
  <li><strong>initSession</strong> — create id + nonce + expiry; return a frozen session object the client will echo.</li>
  <li><strong>startChallenge</strong> — move session into challenge; ready to receive evidence frames.</li>
  <li><strong>recordChallengeFrame</strong> — accept the evidence bitmap (or upload); store metadata; mark <code>selected</code> when the client nominates the capture frame. Do not take ownership of the client bitmap if the client still needs it.</li>
  <li><strong>finishChallenge</strong> — run PAD on the selected frame; run an <strong>independent</strong> full-frame face count (see below); return <code>{ passed, ... }</code>.</li>
  <li><strong>generateOrVerifyPhoto</strong> — verify <code>frameId</code> matches the PAD-selected frame; optionally re-encode or re-verify the JPEG server-side; return <code>{ accepted, ... }</code>. Mark session consumed (single use).</li>
  <li><strong>cancelSession</strong> — drop state; safe if already gone.</li>
</ol>

### Server-side face count

From [`assets/manifest.json`](https://github.com/alijamal14/camera/blob/main/assets/manifest.json):

- `server.fullFrameFaceCount.numFaces` must be **≥ 2** (detector capacity)  
- Required visible faces: **exactly 1**  
- Must not simply trust the client’s landmarker output  

The mock’s optional `countFaces(frame)` stands in for this independent detector.

### Acceptance

```js
// Only a real provider may do this after PAD + binding + policy checks:
return { accepted: true, /* … */ };

// Mock / prototype:
return {
  accepted: false,
  mock: true,
  status: 'PENDING_SERVER_VERIFICATION',
  reason: '…',
};
```

The client sets `status` to `ProviderAccepted` **only** when `provider.accepted === true`
([`src/capture.js`](https://github.com/alijamal14/camera/blob/main/src/capture.js)).

## Asset pinning (production)

[`src/assets.js`](https://github.com/alijamal14/camera/blob/main/src/assets.js) refuses production
startup when:

- Model / WASM / bundle `sha256` values are null  
- `server.runtime` or `server.jpegEncoder` lack `name` / `version`  
- `server.fullFrameFaceCount.numFaces < 2`  

Pin client hashes with `npm run pin-assets` after reviewing versions. Choose and pin the server
runtime and JPEG encoder when the backend is selected. Shared model hashes in the manifest apply
to both sides.

<details>
<summary>Production gates beyond the API (click to expand)</summary>

From [Architecture — production gates](/architecture#production-gates):

- Written approval for synthetic background editing  
- Real PAD with selected-frame provenance  
- Server-side generation or verified fallback  
- Pinned hashes and server runtime  
- Calibrated thresholds (do not promote ADVISORY / PENDING to HARD without data)  
- Privacy and deletion configuration  

</details>

## Pitfalls

<div class="callout callout-warn">
  <strong>Common mistakes</strong>
  Accepting a JPEG that is not bound to the PAD-selected <code>frameId</code>; trusting the
  client face count; allowing session replay after <code>generateOrVerifyPhoto</code>; returning
  <code>accepted: true</code> from a mock or test double used in demos; skipping expiry / nonce checks.
</div>

## Next

1. [Provider API](/guide/provider-api) — method reference  
2. [Client-only](/guide/client-only) — how the browser calls you  
3. [Privacy](/guide/privacy) — biometric retention rules  
