---
title: Identity photo capture
---

# Identity photo capture

Browser capture SDK and harness for **480×640** identity photos: live white-background preview,
PAD-bound capture, decoded-JPEG audit.

**Not affiliated with, endorsed by, or connected to any government identity authority.** Do not
present outputs as officially compliant.

Source: [github.com/alijamal14/camera](https://github.com/alijamal14/camera)

## Quick start

```bash
npm test
npm run serve
```

Open http://localhost:5173/web/ (camera needs localhost or HTTPS).

Optional review telemetry is off by default. Bundles stay on the local machine under
`%LOCALAPPDATA%\camera-telemetry` (never commit them).

## Docs

- [Architecture](architecture.md) — flow, modules, production gates
- [Premium quality plan review](premium-quality-plan-review.md) — telemetry / quality notes

## Agent skills (for implementers)

Copy these into your agent skills folder (or point your agent at them) when working on this repo:

- [Harness check](skills/harness-check.md) — smoke-test engines, compositor, encoder, telemetry
- [Capture review](skills/capture-review.md) — review 480×640 JPEGs against framing and quality targets

In-repo agent copies live at `.claude/skills/*/SKILL.md` and stay the source of truth.

## Privacy

Do not persist biometric images in localStorage, IndexedDB, or logs. The only exception is opt-in
harness telemetry written outside the served root with retention limits.
