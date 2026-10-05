# Photo capture prototype

Browser SDK + harness for NADRA-style 480x640 identity photos with live background removal.
Read `docs/architecture.md` first. The authoritative plan lives outside the repo (path in that doc).

## Commands

- `npm test`: unit tests (node:test, no dependencies). Must pass before committing.
- `npm run serve`: harness at http://localhost:5173/web/ (`PORT` overrides).
- `npm run pin-assets`: record SHA-256 hashes in `assets/manifest.json`. A trust decision; ask first.

## Rules

- Never mirror anything except the DOM preview. Export, PAD evidence and coordinates stay unmirrored.
- Every bitmap, mask and segmentation result has one owner and is released in `finally`.
- VIDEO-mode engines are called only through the scheduler; audits use the IMAGE-mode instance.
- Do not close engines while operations are in flight; teardown goes through `LifecycleController`.
- The mock provider must never return `accepted: true`.
- Uncalibrated thresholds stay ADVISORY or PENDING; do not promote them to HARD without data.
- Do not persist biometric data (no localStorage, IndexedDB or logging of images).

## Skills

- `.claude/skills/harness-check`: smoke-test engines, compositor and encoder in the browser.
- `.claude/skills/capture-review`: review captured JPEGs against the framing and quality targets.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` (or `npm run graphify:update`) to keep the graph current (AST-only, no API cost).
