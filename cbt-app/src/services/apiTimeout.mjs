export const API_TIMEOUT_MS = 15000;
export const PIN_ASSIGN_TIMEOUT_MS = 90000;
export const EXPIRED_FINALIZE_TIMEOUT_MS = 45000;
export const requestTimeoutMs = (action) =>
  action === "exams.assign" ? PIN_ASSIGN_TIMEOUT_MS
    : action === "sessions.autoFinalizeExpired" ? EXPIRED_FINALIZE_TIMEOUT_MS
      : API_TIMEOUT_MS;
