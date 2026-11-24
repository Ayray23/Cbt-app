export const STAFF_IDLE_MS = 8 * 30 * 1000;
export const STAFF_WARNING_MS = 60 * 1000;

export function secondsLeft(deadlineMs, nowMs) {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function idlePhase(lastActivityMs, nowMs, idleMs = STAFF_IDLE_MS, warningMs = STAFF_WARNING_MS) {
  const elapsed = Math.max(0, nowMs - lastActivityMs);
  if (elapsed >= idleMs + warningMs) return "expired";
  if (elapsed >= idleMs) return "warning";
  return "active";
}
