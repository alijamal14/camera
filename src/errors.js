export class CaptureRejectedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CaptureRejectedError';
    this.code = code;
    this.details = details;
  }
}

export class FaceCountError extends CaptureRejectedError {
  constructor(count, stage) {
    super('FACE_COUNT', `Expected exactly one face in the ${stage}, found ${count}.`, { count, stage });
    this.name = 'FaceCountError';
  }
}

export class BiometricAuditError extends CaptureRejectedError {
  constructor(report) {
    const failed = report.items.filter((item) => item.enforcement === 'HARD' && item.status === 'FAIL');
    super('AUDIT_HARD_FAILURE', `Decoded audit failed: ${failed.map((item) => item.id).join(', ')}.`, { report });
    this.name = 'BiometricAuditError';
    this.report = report;
  }
}

export class PadRejectedError extends CaptureRejectedError {
  constructor(result) {
    super('PAD_REJECTED', `PAD rejected the challenge: ${result.reason ?? 'no reason given'}.`, { result });
    this.name = 'PadRejectedError';
  }
}
