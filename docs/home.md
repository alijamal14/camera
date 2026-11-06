<div class="hero">

# Identity photo capture

<p class="lede">
Browser SDK and harness for <strong>480×640</strong> identity photos: live white-background preview,
PAD-bound capture, and a decoded-JPEG audit. Built so agents and humans can implement the pipeline
without guessing.
</p>

<div class="hero-actions">
  <a class="btn btn-primary" href="#/guide/quick-start">Quick start</a>
  <a class="btn btn-ghost" href="#/guide/how-it-works">How it works</a>
  <a class="btn btn-ghost" href="https://github.com/alijamal14/camera">GitHub</a>
</div>

</div>

<div class="callout callout-warn">
  <strong>Not an official identity product</strong>
  Not affiliated with, endorsed by, or connected to any government identity authority.
  Do not present outputs as officially compliant.
</div>

<div class="grid-3">
  <div class="card">
    <h3>Preview</h3>
    <p>Mirrored live view with background removal for guidance. Export and evidence stay unmirrored.</p>
  </div>
  <div class="card">
    <h3>Capture</h3>
    <p>One frame, one face, PAD binding, 480×640 white composite, JPEG under 30 KB, then audit.</p>
  </div>
  <div class="card">
    <h3>Review</h3>
    <p>Optional local telemetry bundles for developers. Never persisted as product biometric storage.</p>
  </div>
</div>

## Start in three steps

<ol class="steps">
  <li><code>npm test</code> — unit suite must pass.</li>
  <li><code>npm run serve</code> — open <code>http://localhost:5173/web/</code> (camera needs localhost or HTTPS).</li>
  <li>Read <a href="#/guide/how-it-works">How capture works</a>, then use the agent skills when iterating.</li>
</ol>

## Where to go next

| Need | Page |
| :--- | :--- |
| Run the harness safely | [Quick start](guide/quick-start.md) |
| Understand the pipeline | [How it works](guide/how-it-works.md) |
| Module map & gates | [Architecture](architecture.md) |
| Smoke-test in a browser | [Harness check skill](skills/harness-check.md) |
| Judge a JPEG | [Capture review skill](skills/capture-review.md) |
| Biometric / telemetry rules | [Privacy](guide/privacy.md) |

## Status

Prototype. The provider is a labelled mock with no PAD evaluation. Results are at most
`ClientValidated`, never `ProviderAccepted`. Written approval from the target identity authority
for synthetic background editing remains a production gate.
