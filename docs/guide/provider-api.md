# Provider API

Methods the client (`IdentityPhotoCapture`) expects. Behaviour reference:
[`src/mock-provider.js`](https://github.com/alijamal14/camera/blob/main/src/mock-provider.js).

Errors use `ProviderError` with a `code` string.

<div class="callout callout-ok">
  <strong>Done when</strong>
  You can implement each method below with the listed inputs, outputs, and error codes —
  and the mock’s state machine still holds on your server.
</div>

## Method map

| Method | Expected state | Success outcome |
| :--- | :--- | :--- |
| `initSession()` | — | Session `{ id, nonce, expiresAt }` |
| `startChallenge(session)` | `initialized` | Session → `challenge` |
| `recordChallengeFrame(session, frame, opts)` | `challenge` | `frameId` string |
| `finishChallenge(session, selectedFrameId)` | `challenge` | `{ passed }` → `evaluated` |
| `generateOrVerifyPhoto(session, payload)` | `evaluated` | `{ accepted }` → `consumed` |
| `cancelSession(session)` | any | Drop state |

## Methods

### `initSession()`

| | |
| :--- | :--- |
| **In** | — |
| **Out** | Session object: at least `{ id, nonce, expiresAt }` (mock also sets `mock: true`) |
| **Errors** | Implementation-defined |

Creates server-side state. Client echoes the same object on later calls.

---

### `startChallenge(session)`

| | |
| :--- | :--- |
| **In** | `session` from `initSession` |
| **Out** | void (async) |
| **Errors** | `UNKNOWN_SESSION`, `EXPIRED`, `BAD_STATE` (expected `initialized`) |

Moves session to `challenge`.

---

### `recordChallengeFrame(session, frame, { selected = false })`

| | |
| :--- | :--- |
| **In** | `session`; evidence `frame` (bitmap-like: `width` / `height`); `selected` when this is the capture frame |
| **Out** | `frameId` string |
| **Errors** | `UNKNOWN_SESSION`, `EXPIRED`, `BAD_STATE` (expected `challenge`) |

Reads frame metadata synchronously in the mock and does **not** take ownership of the bitmap.
Production servers typically upload or hash the bytes here.

---

### `finishChallenge(session, selectedFrameId)`

| | |
| :--- | :--- |
| **In** | `session`; `selectedFrameId` from `recordChallengeFrame` |
| **Out** | `{ passed: boolean, mock?, reason?, evaluation? }` |
| **Errors** | `UNKNOWN_SESSION`, `EXPIRED`, `BAD_STATE` (expected `challenge`) |

PAD + policy evaluation on the selected evidence. Mock returns `passed: true` with
`evaluation: 'MOCK_NOT_EVALUATED'` when the selected flag and optional face count look OK; it does
**not** run real PAD.

If `passed` is false, the client throws `PadRejectedError` and does not compose.

---

### `generateOrVerifyPhoto(session, { frameId, candidateJpeg, crop })`

| | |
| :--- | :--- |
| **In** | `session`; `frameId` must be the PAD-selected frame; `candidateJpeg` Blob; `crop` metadata |
| **Out** | `{ accepted: boolean, mock?, status?, reason?, … }` |
| **Errors** | `UNKNOWN_SESSION`, `EXPIRED`, `BAD_STATE` (expected `evaluated`), `FRAME_MISMATCH` |

Single-use: mock moves session to `consumed`.  
**Mock always sets `accepted: false`.**  
Client maps `accepted === true` → status `ProviderAccepted`, else `ClientValidated`.

---

### `cancelSession(session)`

| | |
| :--- | :--- |
| **In** | `session` |
| **Out** | void (async) |
| **Errors** | none required (mock deletes if present) |

## Error codes (mock)

| Code | When |
| :--- | :--- |
| `UNKNOWN_SESSION` | Missing session or nonce mismatch |
| `EXPIRED` | Past `expiresAt` |
| `BAD_STATE` | Method called in the wrong lifecycle state |
| `FRAME_MISMATCH` | `frameId` ≠ PAD-selected frame at generate/verify |

## Client call order

```text
initSession
  → startChallenge
  → recordChallengeFrame(..., { selected: true })   // inside capture()
  → finishChallenge
  → … client crop / compose / audit …
  → generateOrVerifyPhoto
```

Preview ticks do not call the provider. Only `capture(session)` during an active challenge does.

## Next

1. [Server / provider guide](/guide/server-provider) — implement the contract  
2. [Client-only guide](/guide/client-only) — how the browser calls you  
