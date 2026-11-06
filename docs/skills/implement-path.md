---
title: Skill — implement-path
description: Route client-only vs server/provider implementation work to the correct docs and ceilings (ClientValidated vs ProviderAccepted). Use when the user asks how to integrate, implement, or wire the capture SDK or backend.
---

# Implement path

1. Open [Choose path](/guide/choose-path).
2. **Client-only** → follow [Client-only](/guide/client-only).
   - Also read [Background removal](/guide/background-removal): matting is client-owned (VIDEO segmenter + `Compositor`); preview mirror only; export unmirrored.
   - Wire like `web/app.js`: manifest → engines → compositor/encoder → `MockProvider` → `IdentityPhotoCapture`.
   - Ceiling: `ClientValidated`. Mock must never return `accepted: true`.
   - Hard rules: unmirrored grabFrame/export; VIDEO engines only via scheduler; one capture at a time; release bitmaps in `finally`.
3. **Server / provider** → follow [Server / provider](/guide/server-provider) and [Provider API](/guide/provider-api).
   - Behaviour spec: `src/mock-provider.js` (not a production backend).
   - Enforce session state, PAD on selected frame, independent face count, `FRAME_MISMATCH`, single-use.
   - Only a real provider may set `accepted: true` → `ProviderAccepted`.
   - Matte stays client-side unless you replace `compose` / add server re-matte; production gate for synthetic BG is approval, not a server matte how-to.
4. Do not mix lanes: never treat client audit as authority acceptance.
5. After client harness changes, run the [harness-check](/skills/harness-check) skill. After JPEG quality / matte work, run [capture-review](/skills/capture-review).
6. Keep public skill mirrors in `docs/skills/` in sync when you edit `.claude/skills/*/SKILL.md`.
