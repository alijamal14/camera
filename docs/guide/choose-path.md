# Choose your path

**One question:** are you shipping the browser half, or the server that can actually accept a photo?

Mixing the two is how teams ship a client that *looks* accepted while the server never verified anything.

<div class="callout callout-warn">
  <strong>Not an official identity product</strong>
  Not affiliated with, endorsed by, or connected to any government identity authority.
  Do not present <code>ClientValidated</code> results as officially compliant.
</div>

## Pick a lane

<div class="grid-3">
  <div class="card">
    <h3>Client-only</h3>
    <p>Wire the browser SDK: camera, preview, crop, white composite, JPEG audit. Use the mock provider.</p>
    <p><strong>Ceiling:</strong> <span class="badge badge-client">ClientValidated</span></p>
    <p><a href="#/guide/client-only">Implement the client →</a></p>
  </div>
  <div class="card">
    <h3>Server / provider</h3>
    <p>Own session, PAD, selected-frame binding, independent face count, and accept/reject.</p>
    <p><strong>Ceiling:</strong> <span class="badge badge-provider">ProviderAccepted</span></p>
    <p><a href="#/guide/server-provider">Implement the provider →</a></p>
  </div>
  <div class="card">
    <h3>Need white background?</h3>
    <p>Person-on-white is client-owned (segmenter + compositor). Server approval is a separate gate.</p>
    <p><a href="#/guide/background-removal">Background removal →</a></p>
  </div>
</div>

<p>Provider method tables: <a href="#/guide/provider-api">Provider API</a>.</p>

<div class="callout callout-ok">
  <strong>Done when</strong>
  You know which ceiling you are aiming for, and you open exactly one guide below — not both at once.
</div>

## Who owns what

| Layer | Owns | Does **not** own |
| :--- | :--- | :--- |
| **Client** | Camera, mirrored preview, scheduler, segment / crop / composite / encode, client audit, inject `provider` | Authority acceptance, PAD truth, independent face count |
| **Server / provider** | Session nonce / expiry / single-use, PAD on the selected evidence frame, server face count, accept / reject | DOM preview, MediaPipe VIDEO loop |

## Status labels

| Status | Meaning | Who can set it |
| :--- | :--- | :--- |
| `ClientValidated` | Client pipeline finished; JPEG passed hard client audit. **Not** authority acceptance. | Client (mock or real provider with `accepted: false`) |
| `ProviderAccepted` | Provider returned `accepted: true`. | Real server only — the mock **never** does this |

## Still a production gate (both paths)

<details>
<summary>Shared gates before production (click to expand)</summary>

Written approval for synthetic background editing, a real PAD provider with selected-frame
provenance, pinned asset hashes and server runtime, calibrated thresholds, privacy and deletion
configuration. See [Architecture — production gates](/architecture#production-gates).

</details>

## Next

1. [Client-only](/guide/client-only) **or** [Server / provider](/guide/server-provider)  
2. [Quick start](/guide/quick-start) — run the harness  
3. [Provider API](/guide/provider-api) — method tables when wiring both sides  
