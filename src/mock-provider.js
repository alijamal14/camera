// MOCK provider adapter for the prototype. It performs no PAD and never returns provider
// acceptance. It simulates the server-side contract: session expiry, single use, selected
// frame binding, and a full-frame face count on the selected evidence frame.

export const MOCK_LABEL = 'MOCK PROVIDER: no PAD evaluation, never provider-accepted';

export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export class MockProvider {
  label = MOCK_LABEL;
  #sessions = new Map();
  #countFaces;
  #ttlMs;
  #now;
  #nextId = 1;

  // countFaces(frame) stands in for the backend's independent full-frame detector.
  constructor({ countFaces = null, ttlMs = 5 * 60_000, now = Date.now } = {}) {
    this.#countFaces = countFaces;
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  async initSession() {
    const id = `mock-session-${this.#nextId++}`;
    const session = Object.freeze({
      id,
      nonce: crypto.randomUUID(),
      expiresAt: this.#now() + this.#ttlMs,
      mock: true,
    });
    this.#sessions.set(id, { session, state: 'initialized', frames: new Map(), frameCount: 0 });
    return session;
  }

  async startChallenge(session) {
    this.#record(session, 'initialized').state = 'challenge';
  }

  // Reads the frame synchronously and keeps only metadata, so the caller keeps ownership.
  async recordChallengeFrame(session, frame, { selected = false } = {}) {
    const record = this.#record(session, 'challenge');
    const frameId = `${session.id}:frame-${++record.frameCount}`;
    const faceCount = this.#countFaces ? this.#countFaces(frame) : null;
    record.frames.set(frameId, { width: frame.width, height: frame.height, faceCount, selected });
    return frameId;
  }

  async finishChallenge(session, selectedFrameId) {
    const record = this.#record(session, 'challenge');
    const frame = record.frames.get(selectedFrameId);
    record.state = 'evaluated';
    record.selectedFrameId = selectedFrameId;
    if (!frame?.selected) return { passed: false, mock: true, reason: 'selected frame was not part of the evidence' };
    if (frame.faceCount !== null && frame.faceCount !== 1) {
      return { passed: false, mock: true, reason: `server full-frame face count is ${frame.faceCount}` };
    }
    return { passed: true, mock: true, evaluation: 'MOCK_NOT_EVALUATED' };
  }

  async generateOrVerifyPhoto(session, { frameId }) {
    const record = this.#record(session, 'evaluated');
    if (frameId !== record.selectedFrameId) {
      throw new ProviderError('FRAME_MISMATCH', 'Candidate does not reference the PAD-selected frame.');
    }
    record.state = 'consumed'; // Single use.
    return {
      accepted: false,
      mock: true,
      status: 'PENDING_SERVER_VERIFICATION',
      reason: 'Mock provider cannot verify PAD provenance, source correspondence or authority acceptance.',
    };
  }

  async cancelSession(session) {
    this.#sessions.delete(session.id);
  }

  #record(session, expectedState) {
    const record = this.#sessions.get(session?.id);
    if (!record || record.session.nonce !== session.nonce) throw new ProviderError('UNKNOWN_SESSION', 'Unknown session.');
    if (this.#now() > record.session.expiresAt) throw new ProviderError('EXPIRED', 'Session expired.');
    if (record.state !== expectedState) {
      throw new ProviderError('BAD_STATE', `Session is "${record.state}", expected "${expectedState}".`);
    }
    return record;
  }
}
