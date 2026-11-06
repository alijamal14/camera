# Review: premium matting and opt-in capture telemetry

Reviewed 2026-10-05 against Claude's `its-good-uptil-now-streamed-raccoon.md`,
`docs/architecture.md`, the external authoritative architecture plan, current source,
the three supplied images, and the primary sources linked below.

**Verdict: proceed after revision.** The preview/final split and opt-in review bundles
are sound. The current proposal does not yet establish premium quality, browser
compatibility, safe storage, or correct asynchronous teardown. This document is a
review and implementation specification; it does not claim the changes are implemented.

## Evidence from the supplied captures

| Capture | Dimensions | Bytes | Assessment |
| --- | --- | --- | --- |
| `photo-480x640.jpg` | 480x640 | 29,941 | Format checks pass; softened/clipped hair boundary, pale halo, insufficient headroom, uneven facial lighting |
| `e91dc26e-607c-4eb8-951a-bcd11e73d5f0.jpg` | 480x640 | 29,413 | Format checks pass; stair-stepped right hair boundary, retained chair at shoulder, upward/sideways gaze, uneven lighting |

These are visual advisory findings, not calibrated biometric measurements or a
official identity-authority compliance determination. The screenshot reports a 351x468 crop expanded
1.37x. Neither original raw RGB nor alpha is supplied: the contribution of camera
softness, segmentation, resizing and JPEG compression cannot be isolated from these
outputs alone. Do not describe inferred causes as measured results.

## Required corrections to Claude's plan

1. **Preserve confidence before refining.** `src/browser/compositor.js` uses
   `p <= 0.5 -> 0`, followed by a linear remap above 0.5. This is not a fully binary
   threshold, but it destroys low-confidence edge information. A smoothstep alone
   will not restore missing hair. Compare original confidence, calibrated remapping,
   and edge-aware refinement on the same raw frames. Segmentation confidence is not
   physically measured opacity; a true matting model addresses a different task.
2. **Multiclass segmentation requires a new mask adapter.** `web/app.js` currently
   selects one `personMaskIndex`. Multiclass person alpha must combine the actual
   hair/body-skin/face-skin/clothes/accessories classes from model metadata, excluding
   background. Test class mapping, range, normalization and model-version changes;
   swapping the URL without changing this adapter would erase parts of the person.
   Current official documentation and the repo's observed single-mask behavior
   differ, so inspect the actual model output rather than assuming channel indices.
3. **Do not promise chair removal from connected components.** A chair touching the
   body belongs to the same component. Cleanup can also erase disconnected hair or
   clothing. Treat it as an optional, measured cleanup for isolated artifacts. Use
   person semantics or subject-guided matting for attached chair regions; evaluate
   these specifically. Never manufacture a body silhouette from face landmarks.
4. **1920x1080 is already requested.** `web/app.js` already requests these ideal
   dimensions. Record track settings, `videoWidth/videoHeight`, selected-frame size,
   crop size and upscale. Guide distance from actual geometry. A wider camera image
   does not guarantee a sufficiently detailed portrait crop. Keep upscale advisory
   until an explicit validated product profile enables enforcement.
5. **ORT teardown is asynchronous.** `ResourceScope` calls synchronous `.close()`;
   `IdentityPhotoCapture` teardown does not await asynchronous resource releasers.
   ORT uses `await session.release()`. Add a separate awaited teardown path owned by
   `LifecycleController`, dispose tensors/GPU textures explicitly, and test disposal
   during inference, partial initialization, rejection and cleanup failure. Do not
   insert a raw ORT session into the existing synchronous engine loop.
6. **A timeout is not cancellation.** Racing inference against a timer must not
   close its session or tensors while the operation continues. Track completion,
   suppress late output, drain ownership correctly and only then release. A fallback
   needs a declared degraded-quality result and reason; it must not silently claim
   premium processing succeeded.
7. **Preview telemetry is a DOM-preview copy.** Preserve the display-only mirror
   rule: copy the already mirrored DOM preview canvas, record `mirrored: true`, and
   keep RGB, crop, alpha, export and PAD evidence unmirrored. Do not mirror an SDK
   export surface to create a diagnostic preview. The guide overlay may be a
   separate DOM layer: record its geometry separately if needed.
8. **Saving inside the static root exposes the data.** `scripts/serve.mjs` currently
   serves arbitrary files within the repository. `.gitignore` does not prevent HTTP
   downloads. Store telemetry outside the served root and replace broad serving
   with a static allowlist; block telemetry, dotfiles, Git metadata and symlink escapes.
   Loopback binding alone does not authenticate browser requests.
9. **Use structured diagnostic fields.** Do not serialize provider sessions,
   challenge nonces, tokens, arbitrary error objects or complete harness log text.
   Allowlist stage, duration, error code, model/version, encoder, dimensions, crop,
   orientation, audit state and fallback fields. Sanitize error messages.
10. **30 KB makes quality a measured tradeoff.** The plan's claim about browser
    trellis/subsampling is not demonstrated on these files. Compare decoded canvas
    JPEG against MozJPEG at the same byte cap. Quality numbers across encoders are
    not equivalent; benchmark 4:2:0 versus 4:4:4 and progressive versus baseline.
    Preserve the floor contract and report which encoder/profile was used.
11. **Browser-only final processing cannot replace the authoritative backend.** The
    existing architecture makes provider generation or independent verification
    authoritative. Browser MODNet supports the prototype and permitted fallback.
    Production needs selected-frame provenance and server verification/generation.
12. **Hash pinning remains a separate trust decision.** Select immutable versions,
    establish weight provenance, and include every runtime JS/WASM/worker asset,
    not just weights. `fetchVerified` currently covers models; runtime modules are
    imported separately. Do not claim the entire runtime is verified by a model hash.
    Do not run `pin-assets` as a side effect of this review.

## Research and candidate selection

This is a bounded shortlist of relevant primary projects, not an exhaustive survey
of every model or repository. No model has been benchmarked on these raw frames.
Repository license labels do not automatically license every dependency, dataset,
third-party export or checkpoint: record exact artifacts and notices before resale.

| Candidate / source | Role and recommendation |
| --- | --- |
| [MediaPipe Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter) | Retain as preview baseline. Test square/landscape and multiclass variants with explicit class adapters. Low-resolution semantics do not prove hair-level matting quality. |
| [MODNet](https://github.com/ZHKKKe/MODNet) | First browser still-matting candidate. Upstream explicitly licenses its code, models and demos under Apache-2.0, excluding demo GIFs. Verify exported ONNX preprocessing and numerical parity. The online demo uses an unpublished model, so its appearance is not a guarantee for released weights. |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | Strong server/offline comparison candidate, especially published matting and HR-matting variants; upstream repo is MIT. Generic dichotomous segmentation and matting checkpoints are distinct. Verify the selected checkpoint license and provenance; measure runtime/memory before considering browser use. |
| [BEN2](https://github.com/PramaLLC/BEN2) | Secondary still-image comparison. MIT repository; distinguish released Base weights from the separate commercial model. Official project provides ONNX links. Validate the exact Base artifact and compare refinement cost. |
| [BackgroundMattingV2](https://github.com/PeterL1n/BackgroundMattingV2) | MIT alternative for fixed kiosks: requires an additional clean background image. High-resolution refinement is relevant, but its published desktop-GPU throughput is not browser throughput. |
| [RobustVideoMatting](https://github.com/PeterL1n/RobustVideoMatting) | Useful temporal-quality research/reference. GPL-3.0 upstream; excludes it from Claude's permissive-only shipping shortlist. Do not present it as a drop-in permissive dependency. |
| [Matte Anything](https://github.com/hustvl/Matte-Anything) | Interactive, subject-guided matting candidate for offline annotation and hard-chair examples. MIT repo; independently review its component/checkpoint terms and automation needs. Not the default live browser engine. |
| [InSPyReNet](https://github.com/plemeri/InSPyReNet) | MIT high-resolution salient-object detection comparison. Salient foreground can include chairs: person-only behavior and alpha quality must be measured. |
| [Microsoft AdaM](https://github.com/microsoft/AdaM) | Temporal matting research reference. MIT repository, but the inspected repository primarily provides paper/project material rather than a ready browser inference package. Do not treat license metadata as proof of deployability. |
| [BRIA RMBG-2.0 model card](https://huggingface.co/briaai/RMBG-2.0) | Optional commercially licensed comparison. Public weights are noncommercial; commercial use requires an agreement or licensed API. A permissive wrapper does not remove the weight restriction. |

[Google's published Meet pipeline](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/)
describes low-resolution segmentation, joint bilateral refinement, shaders and light
wrapping. This supports the refinement direction, but does not establish that
Claude's proposed EMA reproduces Meet. Light wrapping changes foreground colors;
do not copy cosmetic effects blindly into identity-photo export.

[Microsoft's Person Segmentation in Teams presentation](https://www.microsoft.com/en-us/research/wp-content/uploads/2026/05/mlads_2022_person-_segmentation_in_teams.pdf)
describes temporal information and lightweight high-resolution processing guided by
low-resolution inference. Treat Meet/Teams as visual benchmarks, not reproducible
open-source model packages or proof that the same techniques meet this JPEG budget.

[ONNX Runtime WebGPU documentation](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
supports the browser inference route; WebGPU availability alone does not prove the
selected ONNX graph runs. Test the exact operators, shapes, browser/device and WASM
fallback. [InferenceSession.release](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.html)
returns a Promise and must be awaited during teardown.

[jSquash JPEG](https://github.com/jamsinclair/jSquash/tree/main/packages/jpeg)
provides a browser WASM MozJPEG encoder. Package integration also requires serving
its WASM/glue correctly in this currently bundler-free harness. Preserve notices and
pin the selected package/codec assets.

## Revised implementation sequence

### Phase 1: opt-in review bundles and a trustworthy baseline

The user's explicit request authorizes designing the image-persistence exception.
Implement it narrowly: developer harness only, separate consent, off by default.
Do not treat enabling a diagnostic setting as consent to model training or uploading
images to external AI services. Prefer session-only consent to remembered enablement.

At capture click, copy the currently displayed preview synchronously before its next
render; record preview timestamp/job ID, displayed crop, mirror flag and age relative
to the selected frame. It can differ from the frozen capture frame. Label it
`displayPreview`, not PAD evidence. Never read the camera again to reconstruct the
selected-frame diagnostic. Encode owned copies before raw/mask owners release them.

Minimal bundle: copied display preview PNG, final JPEG when available, structured
`log.json`. Explicit diagnostic consent can additionally save the selected raw frame
or lossless crop, alpha and pre-JPEG white composite. Raw RGB and alpha are necessary
to isolate quality problems; processed JPEGs alone cannot recover erased hair.
Do not collect continuous preview video by default. Use a separately bounded debug
mode for short clips when testing temporal flicker.

Capture bundles are stage-aware. A face-count or PAD rejection has no final JPEG;
an audit rejection may have a candidate JPEG. Record available artifacts and the
failed stage, never invent an empty successful final. Keep failed biometric captures
under the same consent and retention controls.

Storage requirements:

- Dedicated server-generated IDs and fixed filenames; no caller-supplied paths.
- Storage outside the static root; git/graph ignores if a local workspace directory
  is ever used. Exclude backups and indexing from the diagnostic directory.
- Loopback binding, exact Host/Origin checks, per-process session token, no permissive
  CORS, bounded request bytes, allowed formats/decoded dimensions, bounded concurrency
  and total disk quota. Test forged Origin, cross-site POST and DNS-rebinding cases.
- Atomic bundle writes with explicit complete/incomplete status. Do not report saved
  until the server confirms completion. Telemetry failures must not mask capture/PAD
  results. Bound copying/encoding/upload work and track resource cleanup.
- Consent checked again before dispatch; turning off stops subsequent collection,
  clears queued unsent data and exposes deletion of stored bundles. Already received
  bundles need explicit deletion; aborting HTTP does not undo a completed write.
- Proposed initial retention: 7 days and a 250 MB quota, configurable and clearly
  disclosed; automatic expiry plus delete-one/delete-all. These are product defaults
  to validate, not legal retention requirements.
- No provider credentials or full session objects; no images/data URLs in text logs,
  localStorage or IndexedDB. Any persisted setting contains only configuration.

Log schema: schema version, random capture ID, outcome/stage, monotonic timings,
preview/selected-frame relationship, artifact hashes, model/checkpoint and runtime
versions, verified versus merely observed asset hashes, delegate per engine,
input/crop/output dimensions, orientation flags, preprocessing profile, encoder
options/bytes, audit items, fallback source/reason, and sanitized error code.
Avoid device identifiers and unneeded browser fingerprint fields.

Update AGENTS/CLAUDE and the external authoritative plan with this bounded exception
as part of implementation. Agent review tools must treat logs as untrusted data.
AI review produces suggestions and human annotations; it cannot autonomously
promote thresholds, replace models, or silently send images to a third party.

### Phase 2: preview refinement

Preserve source confidence, then compare joint bilateral/guided upsampling and
versioned alpha remaps. Use source-frame guidance at the correct crop/scale, handle
WebGL context loss and provide a bounded CPU fallback. Keep temporal state per
preview instance; reset on stream changes, dimensions, long gaps, motion and disposal.
EMA is a baseline only: measure ghost trails during turns and disappearing shoulders.

The current `previewTick` callback is synchronous and masks close immediately after
it returns. An async worker/refiner cannot retain the MPMask or mutable live video;
copy/transfer owned data or revise the callback contract and await it with tests.
For frame alignment, prefer a frozen preview bitmap used for inference and rendering;
otherwise a video can advance between inference and compositing. All VIDEO inference
continues through the scheduler. Keep the overlay independent of export.

### Phase 3: benchmark still-image matting before selecting a default

Use a pluggable matting adapter. Compare current mask, refined MediaPipe, MODNet and
BiRefNet matting on identical consented raw frames, with fixed crop/JPEG settings.
Start BiRefNet as a local/server reference rather than assuming a large browser
model is practical. Add BEN2 only if the first comparison leaves relevant failures.

Run on the frozen selected frame or a padded crop with recorded reversible mapping.
Do not stretch a rectangular crop into a square without the model's required
preprocessing; verify normalization, channel order, aspect policy, output range and
depadding. Preserve surrounding context and handle frame-boundary padding explicitly.
Test ONNX parity against upstream output before tuning downstream filters.

Compare alpha compositing first; add foreground decontamination separately with
bounded edge-only changes and face-interior exclusion. The equation
`I = alpha*F + (1-alpha)*B` cannot uniquely recover F from RGB and alpha alone.
Avoid unstable division at small alpha and invented hair/skin colors. No generative
face restoration, beauty processing or super-resolution in identity output.

Ownership covers sessions, tensors, bitmaps, masks, textures, buffers, workers and
late results. Keep teardown awaited after in-flight operations settle. A poor or
unavailable matte returns a visible degraded mode/recapture suggestion, retaining
the provider verification status.

### Phase 4: encoding and production service

Compare canvas and MozJPEG after compositing the same 480x640 image. Judge decoded
images at equal bytes, including eye/nose detail, hair boundaries and halos. Store
pre-JPEG composite so codec artifacts are distinguishable from matte artifacts.
Do not change geometry and encoder simultaneously in the first comparison.

Production follows provider-bound selected-frame generation/verification. Local
telemetry is a development facility, not the commercial storage design. A resaleable
service additionally needs tenant isolation, authenticated access, explicit retention
and deletion, approved data use, supportable browser/device profiles, reliability
and measured per-capture cost. The existing provider/PAD and approval gates remain.

## Acceptance evidence required

- Same-frame ablations: raw crop, alpha, lossless composite, decoded JPEG, model and
  encoder variants. Compare full portraits and hair/beard/ear/shoulder/chair patches.
- Consented, diverse test set: dark/light/gray hair, beard, white clothing, glasses,
  head coverings, different skin tones, backlight, low light, textured backgrounds,
  attached chairs and movement. Annotate held-out alpha/subject boundaries; split
  evaluation by person/session to prevent leakage.
- Alpha SAD/MSE plus gradient/connectivity where ground-truth alpha exists; boundary
  foreground loss, chair leakage and halo ratings. Do not substitute IoU or an AI
  visual score for all these checks. Reference annotations require human inspection.
- Temporal flicker and ghosting on consented bounded clips; stills cannot establish
  temporal quality. Compare against Meet/Teams on the same scenes when feasible.
- End-to-end p50/p95 render/inference/capture latency, UI responsiveness, download
  size and peak memory across supported desktop/mobile Chrome/Edge/Safari profiles.
  Proposed 24 FPS preview is a device-tier goal, not established performance; 24 FPS
  allows about 41.7 ms for an entire frame, not just refinement.
- Failure checks: WebGPU/GL loss, WASM fallback, unsupported model operators, disk
  full, interrupted upload, oversized/invalid payload, toggling off mid-capture,
  repeated start/dispose and disposal during inference/export.
- Privacy/storage checks: off means zero image collection, encoding and requests;
  telemetry cannot be fetched through static serving; consent revocation/deletion
  works; logs contain no secrets; malformed paths/origins are rejected.
- `npm test` plus repository harness-check after implementation. Existing tests do
  not verify browser GPU quality, encoder artifacts or camera alignment. Record
  measured results and unresolved failures, not assumed passes.

Implement telemetry/baseline first, preview refinement second, model comparison
third, and select the final model/codec from evidence. This gives agents enough
context to improve the pipeline without equating a new model with premium quality.

## Second review: revised Claude plan, 2026-10-06

**Verdict: the revised direction is sound; Phase 1 can proceed after the contracts
below are made explicit.** The new plan adopts this review and addresses the original
storage, confidence, camera-resolution, chair-cleanup and asynchronous-release
concerns. The repository still contains the original runtime implementation; the
revised plan is not implementation evidence.

### Remaining implementation blockers

1. **Specify staged diagnostics and isolate observer failures.** The proposed
   `capture()` hook cannot receive raw crop, alpha and composite at all stages.
   A face-count/PAD failure occurs before a portrait crop exists; alpha/composite
   are private browser-compositor surfaces, and `compose()` currently returns only
   a JPEG Blob. Define separate stage notifications with optional artifacts:
   selected-frame availability, crop availability, browser-compositor diagnostics,
   encoded candidate availability, audit result and terminal outcome. The compositor
   must expose explicit synchronous copies rather than private reusable canvases.
   Catch copy/observer exceptions independently so they never replace capture or PAD
   results. Track asynchronous encoding of owned copies separately with bounded
   queues and release-on-failure. Test throwing observers and copy failures, not
   only the successful copy-before-release case.
2. **Make consent revocation cover the full pipeline.** Clearing a queue is
   insufficient when a copy is encoding, an upload is running, or a server write
   has completed. Use a consent generation associated with each attempt; recheck
   before copying, encoding and upload, discard stale completions and release their
   resources. Abort active uploads where possible. Clearly distinguish disabling
   future collection from deleting already saved bundles. Apply the same token and
   Origin checks to delete endpoints; require an explicit delete action.
3. **Constrain the purge target before recursive deletion.** `TELEMETRY_DIR` is
   configurable, so purge must not blindly recursively remove its resolved value.
   Reject drive roots, home, repository and served directories; validate a dedicated
   storage marker and canonical location, avoid symlink/junction traversal, and
   delete only recognized server-owned bundle directories. Validate both parent
   storage and child paths. Expiry, quota enforcement and manual purge must follow
   the same policy. Test an accidentally configured unrelated directory.
4. **Connect artifact fidelity to replay.** Record raw-crop dimensions without
   resizing, original frame size, exact floating-point crop rectangle, mask
   dimensions and mask-to-crop mapping, alpha representation and preprocessing
   profile. An 8-bit alpha PNG is useful for visual inspection but loses the original
   float confidence precision; add a bounded float-confidence diagnostic when
   comparing remapping algorithms. Save the selected full frame only under explicit
   diagnostic scope when reproducing full-frame inference is needed. A cropped
   image cannot reproduce full-frame MediaPipe inference exactly.

### Further clarifications before later phases

- **LifecycleController already awaits teardown.** Its `#performTeardown()` uses
  `await this.#teardown()`. The required change is the synchronous teardown callback
  in `IdentityPhotoCapture` and the resource release API/adapters. Preserve the existing
  controller contract rather than rewriting its drain machinery unnecessarily.
  Attempt every release, including after an earlier asynchronous rejection.
- **Parallel captures need a policy.** The scheduler serializes VIDEO inference,
  while composition/encoding happen outside that scheduler. The compositor reuses
  canvases and the encoder awaits several `convertToBlob` calls. Reject overlapping
  SDK capture transactions or allocate independent export surfaces per transaction;
  a disabled harness button is not an SDK concurrency guarantee. Test this before
  adding asynchronous diagnostics and matting sessions.
- **The benchmark runtime is underspecified.** Calling BiRefNet a Node/offline
  reference does not define how it executes. Choose either the upstream Python
  environment or a validated ONNX export with a compatible runtime, pin dependencies,
  and validate reference parity. Keep that optional benchmark tooling separate from
  the dependency-free core unit tests.
- **Capture metadata needs an explicit producer.** The encoder currently returns
  only a Blob, engine creation returns one aggregate delegate, and preview render
  metadata is not retained. Define how quality/options, per-engine delegate,
  displayed preview timestamp/job ID and stage durations reach the telemetry schema.
  Report unavailable values as unavailable rather than fabricating them.
- **The asset validator needs extension.** `listManifestProblems()` currently
  validates MediaPipe runtime assets and model entries. Adding ORT/MozJPEG entries
  alone does not validate or verify those runtimes. Add schema checks and a loading
  path covering their JS/WASM/worker dependencies. Preserve the explicit separate
  authorization required for hash pinning.
- **Keep preview and export quality settings separate.** The current compositor
  class serves both through separate instances. A preview remap change must not
  silently change the final-photo profile before same-frame evaluation. Retain a
  reproducible baseline profile and record the chosen profile in each bundle.
- **Carry acceptance criteria through the abbreviated plan.** The revised plan's
  FPS and patch comparison checks are useful, but preserve the held-out people,
  ground-truth alpha/boundary checks, temporal clips, device matrix, failure cases
  and production-provider gates in this adopted specification. They establish
  whether the result can be marketed as premium; unit tests cannot establish that.

Do not duplicate these requirements across two evolving specifications. Keep this
document as the adopted detailed contract, with the Claude plan as the execution
sequence and phase checklist. No additional model survey is necessary before
implementing the consented baseline collection and diagnostics contracts.
