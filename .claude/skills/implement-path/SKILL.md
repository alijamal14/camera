---
name: implement-path
description: Route client-only vs server/provider implementation work to the correct docs and ceilings (ClientValidated vs ProviderAccepted). Use when the user asks how to integrate, implement, or wire the capture SDK or backend.
---

# Implement path

1. Open [Choose path](https://ali.mk313.com/camera/#/guide/choose-path) (in-repo: `docs/guide/choose-path.md`).
2. **Client-only** → follow `docs/guide/client-only.md` (public: `#/guide/client-only`).
   - Also read `docs/guide/background-removal.md` (`#/guide/background-removal`): matting is client-owned (VIDEO segmenter + `Compositor`); preview mirror only; export unmirrored.
   - Wire like `web/app.js`: manifest → engines → compositor/encoder → `MockProvider` → `IdentityPhotoCapture`.
   - Ceiling: `ClientValidated`. Mock must never return `accepted: true`.
   - Hard rules: unmirrored grabFrame/export; VIDEO engines only via scheduler; one capture at a time; release bitmaps in `finally`.
3. **Server / provider** → follow `docs/guide/server-provider.md` and `docs/guide/provider-api.md`.
   - Behaviour spec: `src/mock-provider.js` (not a production backend).
   - Enforce session state, PAD on selected frame, independent face count, `FRAME_MISMATCH`, single-use.
   - Only a real provider may set `accepted: true` → `ProviderAccepted`.
   - Matte stays client-side unless you replace `compose` / add server re-matte; production gate for synthetic BG is approval, not a server matte how-to.
4. Do not mix lanes: never treat client audit as authority acceptance.
5. After client harness changes, run `.claude/skills/harness-check`. After JPEG quality / matte work, run `.claude/skills/capture-review`.
6. Keep public skill mirrors in `docs/skills/` in sync when you edit `.claude/skills/*/SKILL.md`.
