<div class="hero">

# Identity photo capture

<p class="lede">
Browser SDK and harness for <strong>480×640</strong> identity photos: live white-background preview,
PAD-bound capture, and a decoded-JPEG audit. Implement the <strong>client</strong> and the
<strong>server / provider</strong> as separate jobs — they are not the same finish line.
</p>

<div class="hero-actions">
  <a class="btn btn-primary" href="#/guide/client-only">Client-only</a>
  <a class="btn btn-ghost" href="#/guide/server-provider">Server / provider</a>
  <a class="btn btn-ghost" href="#/guide/choose-path">Choose path</a>
</div>

</div>

<div class="callout callout-warn">
  <strong>Not an official identity product</strong>
  Not affiliated with, endorsed by, or connected to any government identity authority.
  Do not present outputs as officially compliant.
</div>

<div class="grid-3">
  <div class="card">
    <h3>Client</h3>
    <p>Camera, mirrored preview, crop, white JPEG ≤ 30 KB, decoded audit. Ceiling: <code>ClientValidated</code>.</p>
    <p><a href="#/guide/client-only">Guide →</a></p>
  </div>
  <div class="card">
    <h3>Server</h3>
    <p>Session, PAD, selected-frame binding, independent face count, accept/reject. Only path to <code>ProviderAccepted</code>.</p>
    <p><a href="#/guide/server-provider">Guide →</a></p>
  </div>
  <div class="card">
    <h3>Harness</h3>
    <p><code>npm test</code> then <code>npm run serve</code> → <code>http://localhost:5173/web/</code></p>
    <p><a href="#/guide/quick-start">Quick start →</a></p>
  </div>
</div>

## Start in three steps

<ol class="steps">
  <li><a href="#/guide/choose-path">Choose path</a> — client-only or server/provider.</li>
  <li><code>npm test</code> then <code>npm run serve</code> (camera needs localhost or HTTPS).</li>
  <li>Follow the matching guide; use agent skills when iterating.</li>
</ol>

## Where to go next

| Need | Page |
| :--- | :--- |
| Pick client vs server | [Choose path](guide/choose-path.md) |
| Wire the browser SDK | [Client-only](guide/client-only.md) |
| Build the real provider | [Server / provider](guide/server-provider.md) |
| Provider method tables | [Provider API](guide/provider-api.md) |
| Pipeline in plain language | [How it works](guide/how-it-works.md) |
| Module map & gates | [Architecture](architecture.md) |
| Smoke-test / review / route skills | [Implement path](skills/implement-path.md), [Harness check](skills/harness-check.md), [Capture review](skills/capture-review.md) |

## Status

Prototype. The included provider is a labelled mock with no PAD evaluation. Results are at most
`ClientValidated`, never `ProviderAccepted`. Written approval from the target identity authority
for synthetic background editing remains a production gate.
