# How capture works

A plain-language map of the pipeline. For module-level detail, see [Architecture](/architecture).

**Implementing?** The browser and the provider are separate jobs:
[Client-only](/guide/client-only) vs [Server / provider](/guide/server-provider)
([choose path](/guide/choose-path)).

## Two modes

| Mode | Purpose | Mirroring |
| :--- | :--- | :--- |
| **Preview** | Help the person frame their face | Display is mirrored |
| **Capture** | Produce evidence and the identity JPEG | Never mirrored |

Only the DOM preview is mirrored. Export, PAD evidence, and coordinates stay unmirrored.

## Capture transaction

During an active provider challenge, `IdentityPhotoCapture.capture(session)` does this:

<ol class="steps">
  <li>Grab one unmirrored <code>ImageBitmap</code>.</li>
  <li>Exclusive scheduler job: count faces on the full frame (must be exactly one), then segment.</li>
  <li>Send that exact frame to the provider as PAD evidence; stop if PAD fails.</li>
  <li>Crop to 480×640 from eye/head geometry; reject if the crop leaves the frame.</li>
  <li>Composite onto white; encode JPEG ≤ 30,000 bytes (quality floor 0.55).</li>
  <li>Decode and audit with a separate IMAGE-mode landmarker.</li>
  <li>Submit the candidate to the provider. The mock never accepts.</li>
</ol>

A `finally` block releases the raw frame, segmentation result, and decoded bitmap on every path.

## What “good” looks like

- MIME `image/jpeg`, exactly **480×640**, ≤ **30 KB**
- Exactly one face in the full frame and in the decoded output
- White background after composite
- Framing targets are **advisory** until calibrated (chin-to-crown, eye line, roll)

## Engines and ownership

- VIDEO-mode engines run only through the scheduler (preview can drop).
- Audits use a separate IMAGE-mode landmarker instance.
- Every bitmap, mask, and segmentation result has one owner and is released in `finally`.
- Do not close engines while work is in flight; teardown goes through `LifecycleController`.
- One capture at a time (`CAPTURE_BUSY`).

## Diagnostics (optional)

`observe(event, payload)` fires in stage order: `frame` → `segmented` → `cropped` → `encoded` →
`audited`, plus `stage` timings and `rejected` on failure. Observer errors never fail a capture.

## Next

- [Choose path](/guide/choose-path) — client vs server
- [Client-only](/guide/client-only) / [Server / provider](/guide/server-provider)
- [Privacy rules](/guide/privacy)
- [Architecture](/architecture)
- [Capture review skill](/skills/capture-review)
