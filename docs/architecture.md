# Architecture

Prototype of the capture SDK described in the consolidated plan
(`C:\Users\ali\.gemini\antigravity-cli\brain\52d83028-6147-4872-8694-e09a8943af2b\live-background-removal-plan.md`).
The plan is authoritative; this page maps it to code.

## Flow

1. Preview: `previewTick(video)` runs VIDEO-mode segmentation and landmarks through the scheduler.
   The display is mirrored; nothing else is.
2. Capture: `capture(session)` during an active provider challenge:
   1. Grab one unmirrored `ImageBitmap`.
   2. Exclusive scheduler job: count faces on the full frame (reject unless exactly one), segment.
   3. Send that exact frame to the provider as PAD evidence; stop if PAD fails.
   4. Crop to 480x640 from eye/head geometry; reject if the crop leaves the frame.
   5. Composite onto white, encode JPEG <= 30,000 bytes (quality floor 0.55).
   6. Decode and audit with a separate IMAGE-mode landmarker.
   7. Submit the candidate to the provider. The mock never accepts.
3. `finally` releases the raw frame, segmentation result and decoded bitmap on every path.

## Modules

| Module | Plan section | Notes |
| :--- | :--- | :--- |
| `src/scheduler.js` | 4 | One job at a time; previews droppable; timestamps `max(now, last + 1)` |
| `src/lifecycle.js` | 7.1 | `dispose()` always resolves; failures via `cleanupPromise`; no teardown while work is in flight |
| `src/resources.js` | 4 | LIFO release scope; every release attempted |
| `src/capture.js` | 3, 4, 6 | Orchestration; browser pieces injected for testing |
| `src/face-count.js` | 2 | Landmarkers run with `numFaces: 2` |
| `src/geometry.js` | 2, 5 | Crown multiplier 1.25 is an uncalibrated Class C candidate |
| `src/audit.js` | 6.1 | HARD: MIME, bytes, dimensions, face count. Framing ADVISORY. Others PENDING |
| `src/mock-provider.js` | 3 | Expiry, nonce, single use, selected-frame binding, server-side face count |
| `src/assets.js` | 4 | Production refuses unpinned hashes or server runtime |
| `src/browser/*` | 4, 5, 6 | MediaPipe 0.10.14 engines, compositor, encoder |

## Review telemetry (opt-in, local)

Plan: `docs/premium-quality-plan-review.md` (spec) and the approved phased plan. Phase 1 is built.

- `NadraPhotoCapture` accepts `observe(event, payload)`. Events are emitted in stage order:
  1. `frame`
  2. `segmented`
  3. `cropped`
  4. `encoded`
  5. `audited`

  Each stage also emits `stage {name, ms}`, and a failure emits `rejected {stage, error}`.
  Payload resources are valid only during the call. Observer errors are counted in `diagnosticErrors`.
- `web/recorder.js` copies what each stage has into a `TelemetryBundle`. The preview copy is taken at click time.
- `src/telemetry.js`:
  - Levels: `off`, `basic` (preview, output, log) and `diagnostic` (+ raw crop, alpha, composite, float32 confidence).
  - Lowering the level aborts uploads and discards pending bundles.
  - `buildLog` keeps allowlisted fields only.
- Server (`scripts/server.mjs`, `scripts/telemetry-store.mjs`):
  - Static allowlist (`/web`, `/src`, `/assets/manifest.json`); exact Host/Origin checks and a per-process token.
  - Validated artifact names and formats, quota, and atomic `partial → bundles/<UTC date>/<id>` moves.
  - 7-day retention sweep. Purge refuses unmarked directories.
- `scripts/serve.mjs`: one-terminal workflow. Reclaims the port from a stale harness (matched by
  command line `scripts/serve.mjs`), prints the store summary, logs each saved bundle with its path.

## Observed MediaPipe behaviour (0.10.14)

- `selfie_segmenter` returns one confidence mask at the input resolution; index 0 is the person.
- No-callback `segmentForVideo` returns copied masks; the caller closes them via `result.close()`.
- All three engines create on the GPU delegate in Chromium; CPU fallback is automatic.

## Acceptance tests

| Test | File | Status |
| :--- | :--- | :--- |
| TC-03 scheduling | `test/scheduler.test.js`, `test/capture.test.js` | Automated |
| TC-08 disposal | `test/lifecycle.test.js` | Automated, including the timeout/settle race |
| TC-10 face count | `test/capture.test.js` | Automated |
| TC-11 resource release | `test/capture.test.js` | Automated |
| TC-01, TC-02 | Harness | Manual with a camera |
| TC-04, TC-05, TC-13, TC-14 | — | Need a real provider |
| TC-06, TC-07, TC-09, TC-12 | — | Need calibration data and devices |

## Production gates

Written NADRA approval of synthetic background editing; a real PAD provider with selected-frame
provenance; server-side generation or verified fallback; pinned hashes and server runtime;
calibrated thresholds; privacy and deletion configuration.
