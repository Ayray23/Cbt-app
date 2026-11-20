// Browser-side exam lockdown helpers. A web page cannot truly lock a computer:
// these rules deter casual cheating and leave a record for invigilators, but they
// are not a substitute for supervision. Nothing here auto-submits an exam.

export const VIOLATION_LIMIT = 3;
export const MAX_LOGGED_VIOLATIONS = 25;

export const VIOLATION_LABELS = {
  "tab-hidden": "left the exam tab",
  "window-blur": "switched to another window",
  "fullscreen-exit": "left full screen",
};

export const VIOLATION_SHORT = {
  "tab-hidden": "tab",
  "window-blur": "window",
  "fullscreen-exit": "fullscreen",
};

// Keys that open developer tools, view source, save, print or copy the paper.
export function isBlockedKey(event) {
  const key = String(event.key || "").toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  if (key === "f12") return true;
  if (command && ["c", "v", "x", "a", "s", "p", "u"].includes(key)) return true;
  if (command && event.shiftKey && ["i", "j", "c", "k"].includes(key))
    return true;
  if (event.metaKey && event.altKey && ["i", "j", "c", "u"].includes(key))
    return true;
  return false;
}

export function appendViolation(log, type, atMs) {
  const entry = { type, atMs };
  return [...(Array.isArray(log) ? log : []), entry].slice(
    -MAX_LOGGED_VIOLATIONS,
  );
}

// The longer log is the newer one: a log only ever grows during an attempt.
export function longerLog(a, b) {
  const first = Array.isArray(a) ? a : [];
  const second = Array.isArray(b) ? b : [];
  return second.length > first.length ? second : first;
}

export function integrityMeta(warnings, log) {
  return { tabSwitchCount: warnings.current, integrityLog: log.current };
}

// "2 tab, 1 fullscreen" for the invigilator's table.
export function summarizeViolations(log) {
  const counts = {};
  for (const entry of Array.isArray(log) ? log : []) {
    const label = VIOLATION_SHORT[entry?.type];
    if (label) counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
}
