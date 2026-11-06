# Quick start

Get a working harness on your machine in a few minutes.

## Requirements

- Node.js 20+
- A Chromium-based browser with a camera
- `localhost` or HTTPS (camera permission)

## Install and test

```bash
npm test
```

All unit tests must pass before you trust a local change.

## Run the harness

```bash
npm run serve
```

Open [http://localhost:5173/web/](http://localhost:5173/web/).

One terminal is enough: `serve` replaces a stale copy of **this** harness on the port (never another
program), prints the telemetry store summary, and logs one line per saved bundle.

> For agent smoke tests, use the `harness-verify` launch config on port **5181** with
> `--telemetry-dir=%LOCALAPPDATA%/camera-telemetry-verify`. Do not take over 5173 while someone is
> already testing.

## Optional review telemetry

On the page, choose **Save captures**: Off / Basic / Diagnostic.

Bundles go to `%LOCALAPPDATA%\camera-telemetry` (outside the repo), expire after 7 days, and can be
listed or deleted:

```bash
npm run telemetry:report
npm run telemetry:purge
```

Telemetry is off by default and is for developer review only.

## Pin MediaPipe assets (optional)

`assets/manifest.json` ships with `sha256: null`. When you are ready to pin versions:

```bash
npm run pin-assets
```

Review the recorded hashes before committing. Production mode refuses null hashes or an unpinned
server runtime.

## Next

1. [How capture works](how-it-works.md)
2. [Architecture](../architecture.md)
3. [Harness check](../skills/harness-check.md) — smoke-test engines and encoder
