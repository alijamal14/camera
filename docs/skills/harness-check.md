---
title: Skill — harness-check
description: Smoke-test the capture harness in a browser - MediaPipe engines, compositor and JPEG encoder. Use after changing src/browser, the manifest, geometry or the compositor.
---

# Harness check

1. `npm test` must pass.
2. Start the `harness-verify` launch config (port 5181, store `%LOCALAPPDATA%\camera-telemetry-verify`).
   Never use port 5173 for checks: `serve` takes over a running harness, which is the user's.
3. In the page at `/web/`, run:

   ```js
   const manifest = await (await fetch('/assets/manifest.json')).json();
   const { createEngines } = await import('/src/browser/engines.js');
   const logs = [];
   const { engines, delegate } = await createEngines(manifest, { log: (m) => logs.push(m) });
   const c = new OffscreenCanvas(640, 480); c.getContext('2d').fillRect(0, 0, 640, 480);
   const bmp = await createImageBitmap(c);
   const seg = engines.segmenter.segmentForVideo(bmp, 1000);
   const out = { delegate, logs, masks: seg.confidenceMasks.length,
     size: [seg.confidenceMasks[0].width, seg.confidenceMasks[0].height] };
   seg.close(); bmp.close(); Object.values(engines).forEach((e) => e.close());
   out;
   ```

   Expect delegate `GPU` (or a logged CPU fallback), 1 mask at the input size (640x480).
   Unpinned-model log lines are expected until `npm run pin-assets` has run.
4. Compositor/encoder: composite a noisy 1280x720 frame with a fake ellipse mask through
   `Compositor` and `encodeJpegUnderCap`. Expect `image/jpeg`, <= 30,000 bytes, 480x640 decoded,
   and a pure white (255,255,255) corner after decoding.
5. Console errors other than MediaPipe `INFO:` lines are failures.
6. Telemetry path: in the page, build `IdentityPhotoCapture` with synthetic engines, the real
   `Compositor`/encoder, `createCaptureRecorder` (`/web/recorder.js`) and `TelemetryClient`
   (token from `meta[name=telemetry-token]`). Run off, diagnostic and basic captures. Expect: off sends
   no `/telemetry` requests; diagnostic stores 6 artifacts + log.json; basic stores preview, output,
   log; `GET /telemetry/...` returns 403; logs contain no injected device ids.
7. Stop the server when done.
