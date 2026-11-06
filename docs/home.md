<div class="hero">

# Identity photo capture

<p class="lede">
Capture a <strong>480×640</strong> white-background identity JPEG in the browser, then optionally
verify it on a real server. Two jobs, two finish lines — do not mix them up.
</p>

<div class="hero-actions">
  <a class="btn btn-primary" href="#/guide/choose-path">Choose your path</a>
  <a class="btn btn-ghost" href="#/guide/quick-start">Quick start</a>
  <a class="btn btn-ghost" href="#/guide/how-it-works">How it works</a>
  <a class="btn btn-ghost" href="#/guide/background-removal">Background removal</a>
</div>

</div>

<div class="callout callout-warn">
  <strong>Not an official identity product</strong>
  Not affiliated with, endorsed by, or connected to any government identity authority.
  Do not present outputs as officially compliant.
</div>

## Two finish lines

| Path | You build | Ceiling | Start here |
| :--- | :--- | :--- | :--- |
| **Client-only** | Camera, preview, crop, white JPEG, client audit | `ClientValidated` | [Client-only guide](/guide/client-only) |
| **Server / provider** | Session, PAD, frame binding, face count, accept/reject | `ProviderAccepted` | [Server / provider guide](/guide/server-provider) |

Only a real provider that sets `accepted: true` can reach `ProviderAccepted`. The included mock never does.

<div class="grid-3">
  <div class="card">
    <h3>Client</h3>
    <p>Browser SDK + mock provider. Good for UX and hard JPEG audit.</p>
    <p><span class="badge badge-client">ClientValidated</span></p>
    <p><a href="#/guide/client-only">Client guide →</a></p>
  </div>
  <div class="card">
    <h3>Server</h3>
    <p>Trust boundary lives here. Client checks are untrusted for acceptance.</p>
    <p><span class="badge badge-provider">ProviderAccepted</span></p>
    <p><a href="#/guide/server-provider">Provider guide →</a></p>
  </div>
  <div class="card">
    <h3>Harness</h3>
    <p><code>npm test</code> then <code>npm run serve</code> → localhost:5173/web/</p>
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
| Pick client vs server | [Choose path](/guide/choose-path) |
| Need white background? | [Background removal](/guide/background-removal) |
| Wire the browser SDK | [Client-only](/guide/client-only) |
| Build the real provider | [Server / provider](/guide/server-provider) |
| Provider method tables | [Provider API](/guide/provider-api) |
| Pipeline in plain language | [How it works](/guide/how-it-works) |
| Module map & gates | [Architecture](/architecture) |
| Smoke-test / review / route skills | [Implement path](/skills/implement-path), [Harness check](/skills/harness-check), [Capture review](/skills/capture-review) |

## Status

Prototype. The included provider is a labelled mock with no PAD evaluation. Results are at most
`ClientValidated`, never `ProviderAccepted`. Written approval from the target identity authority
for synthetic background editing remains a production gate.
