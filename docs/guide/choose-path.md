# Choose your path

Pick the lane that matches your job. Mixing them is the usual way teams ship a client that
*looks* accepted while the server never verified anything.

<div class="callout callout-warn">
  <strong>Not an official identity product</strong>
  Not affiliated with, endorsed by, or connected to any government identity authority.
  Do not present <code>ClientValidated</code> results as officially compliant.
</div>

<div class="grid-3">
  <div class="card">
    <h3>Client-only</h3>
    <p>Wire the browser SDK: camera, preview, crop, white composite, JPEG audit. Use the mock provider.</p>
    <p><strong>Ceiling:</strong> <code>ClientValidated</code></p>
    <p><a href="#/guide/client-only">Implement the client →</a></p>
  </div>
  <div class="card">
    <h3>Server / provider</h3>
    <p>Own session, PAD, selected-frame binding, independent face count, and accept/reject.</p>
    <p><strong>Ceiling:</strong> <code>ProviderAccepted</code> (only when your server sets <code>accepted: true</code>)</p>
    <p><a href="#/guide/server-provider">Implement the provider →</a></p>
  </div>
  <div class="card">
    <h3>API cheat sheet</h3>
    <p>Six provider methods, inputs, outputs, and error codes — for agents and backend authors.</p>
    <p><a href="#/guide/provider-api">Provider API →</a></p>
  </div>
</div>

## Who owns what

| Layer | Owns | Does **not** own |
| :--- | :--- | :--- |
| **Client** | Camera, mirrored preview, scheduler, segment / crop / composite / encode, client audit, inject `provider` | Authority acceptance, PAD truth, independent face count |
| **Server / provider** | Session nonce / expiry / single-use, PAD on the selected evidence frame, server face count, accept / reject | DOM preview, MediaPipe VIDEO loop |

## Status labels

| Status | Meaning |
| :--- | :--- |
| `ClientValidated` | Client pipeline finished; JPEG passed hard client audit. **Not** authority acceptance. |
| `ProviderAccepted` | Provider returned `accepted: true`. The mock **never** does this. |

## Still a production gate (both paths)

Written approval for synthetic background editing, a real PAD provider with selected-frame
provenance, pinned asset hashes and server runtime, calibrated thresholds, privacy and deletion
configuration. See [Architecture](../architecture.md#production-gates).
