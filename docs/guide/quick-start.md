# Quick start

Run the reference harness on your machine in a few minutes.

<div class="callout callout-ok">
  <strong>Done when</strong>
  <code>npm test</code> passes, the harness opens at
  <a href="http://localhost:5173/web/">http://localhost:5173/web/</a>,
  and you can capture a JPEG with the mock provider
  (<span class="badge badge-client">ClientValidated</span>).
</div>

## Requirements

- Node.js 20+
- A Chromium-based browser with a camera
- `localhost` or HTTPS (camera permission)

## 1. Install and test

```bash
npm test
```

All unit tests must pass before you trust a local change.

## 2. Run the harness

```bash
npm run serve
```

Open [http://localhost:5173/web/](http://localhost:5173/web/).

One terminal is enough: `serve` replaces a stale copy of **this** harness on the port (never another
program), prints the telemetry store summary, and logs one line per saved bundle.

> For agent smoke tests, use the `harness-verify` launch config on port **5181** with
> `--telemetry-dir=%LOCALAPPDATA%/camera-telemetry-verify`. Do not take over 5173 while someone is
> already testing.

## Optional: review telemetry

On the page, choose **Save captures**: Off / Basic / Diagnostic.

Bundles go to `%LOCALAPPDATA%\camera-telemetry` (outside the repo), expire after 7 days, and can be
listed or deleted:

```bash
npm run telemetry:report
npm run telemetry:purge
```

Telemetry is off by default and is for developer review only.

<details>
<summary>Optional: pin MediaPipe assets</summary>

`assets/manifest.json` ships with `sha256: null`. When you are ready to pin versions:

```bash
npm run pin-assets
```

Review the recorded hashes before committing. Production mode refuses null hashes or an unpinned
server runtime.

</details>

## Next

| Goal | Page |
| :--- | :--- |
| Pick client vs server | [Choose path](/guide/choose-path) |
| Wire the browser SDK | [Client-only](/guide/client-only) |
| Build a real provider | [Server / provider](/guide/server-provider) |
| Pipeline narrative | [How capture works](/guide/how-it-works) |
| Smoke-test engines | [Harness check](/skills/harness-check) |
