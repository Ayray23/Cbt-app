// PINs remain hashes on the server. This short-lived, staff-browser copy exists
// only so staff can revisit a generated roster and print it during an exam session.
export const PIN_ROSTER_TTL_MS = 8 * 60 * 60 * 1000;
const PREFIX = "cbt_exam_pin_rosters_v1:";

function browserSessionStorage(storage) {
  if (storage) return storage;
  try { return typeof window === "undefined" ? null : window.sessionStorage; }
  catch { return null; }
}

function storageKey(uid) { return PREFIX + uid; }

export function readPinRosters(uid, storage, now = Date.now()) {
  const store = browserSessionStorage(storage);
  if (!store || !uid) return {};
  try {
    const value = JSON.parse(store.getItem(storageKey(uid)) || "null");
    if (!value || value.uid !== uid || !value.rosters || typeof value.rosters !== "object") return {};
    const rosters = {};
    for (const [examId, roster] of Object.entries(value.rosters)) {
      if (
        roster?.examId !== examId ||
        typeof roster.examTitle !== "string" ||
        !Array.isArray(roster.pins) ||
        !Number.isFinite(roster.updatedAt) ||
        roster.updatedAt > now ||
        now - roster.updatedAt >= PIN_ROSTER_TTL_MS
      ) continue;
      rosters[examId] = roster;
    }
    if (Object.keys(rosters).length !== Object.keys(value.rosters).length) {
      if (Object.keys(rosters).length) store.setItem(storageKey(uid), JSON.stringify({ uid, rosters }));
      else store.removeItem(storageKey(uid));
    }
    return rosters;
  } catch { return {}; }
}

export function latestPinRosterExamId(rosters) {
  return Object.values(rosters).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.examId || "";
}

export function mergePinRoster(rosters, examId, incoming, now = Date.now()) {
  if (!examId || !incoming || !Array.isArray(incoming.pins) || !incoming.pins.length)
    throw new Error("The server did not return a PIN list.");
  // Multiple batches for one exam must retain earlier students, but any newly
  // generated PIN supersedes the previous PIN for that particular student.
  const pinsByStudent = new Map((rosters[examId]?.pins || []).map((row) => [row.studentUid, row]));
  for (const entry of incoming.pins) {
    if (!entry.studentUid || typeof entry.pin !== "string") throw new Error("Invalid PIN list from server.");
    pinsByStudent.set(entry.studentUid, entry);
  }
  return {
    ...rosters,
    [examId]: {
      examId,
      examTitle: String(incoming.examTitle || rosters[examId]?.examTitle || ""),
      updatedAt: now,
      pins: [...pinsByStudent.values()],
    },
  };
}

export function writePinRosters(uid, rosters, storage) {
  const store = browserSessionStorage(storage);
  if (!store || !uid) return false;
  try {
    if (!Object.keys(rosters).length) store.removeItem(storageKey(uid));
    else store.setItem(storageKey(uid), JSON.stringify({ uid, rosters }));
    return true;
  } catch { return false; }
}

export function clearPinRosterCaches(storage) {
  const store = browserSessionStorage(storage);
  if (!store) return;
  try {
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX)) store.removeItem(key);
    }
  } catch { /* Restricted browser storage: PIN rosters are not persisted. */ }
}
