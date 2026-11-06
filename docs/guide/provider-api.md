# Provider API

Contract the client (`IdentityPhotoCapture`) expects. Behaviour reference:
[`src/mock-provider.js`](https://github.com/alijamal14/camera/blob/main/src/mock-provider.js).

Error type used by the mock: `ProviderError` with a `code` string.

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

## Related

- [Server / provider guide](server-provider.md)  
- [Client-only guide](client-only.md)  
