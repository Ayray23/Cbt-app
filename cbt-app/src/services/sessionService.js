import { auth } from "/firebase";
import { callApi } from "./api";
import { deviceExamStore } from "./examStore";

const syncing = new Map();
function deviceId() {
  let value = window.localStorage.getItem("cbt_device_id");
  if (!value) { value = window.crypto.randomUUID(); window.localStorage.setItem("cbt_device_id", value); }
  return value;
}

function currentUid() {
  if (!auth.currentUser) throw new Error("Please sign in to continue.");
  return auth.currentUser.uid;
}

export function getPendingSubmissionMap(uid) {
  importLegacyQueue(uid);
  return Object.fromEntries(deviceExamStore().list(uid).filter((packet) => packet.pending)
    .map((packet) => [packet.session.examId, { ...packet.pending, syncError: packet.syncError }]));
}

export function getDeviceExamMap(uid) {
  importLegacyQueue(uid);
  return Object.fromEntries(deviceExamStore().list(uid).map((packet) => [packet.session.examId, packet]));
}

export function saveLocalExamDraft(examId, answers, metadata = {}) {
  return deviceExamStore().save(currentUid(), examId, answers, metadata);
}

export async function startExamSession(examId, pin = "") {
  const uid = currentUid();
  importLegacyQueue(uid);
  const store = deviceExamStore();
  const cached = store.read(uid, examId);
  if (cached?.closed) throw new Error("This exam has already been submitted.");
  if (!window.navigator.onLine) {
    if (!cached?.questions?.length) throw new Error("Connect to the internet to start this exam for the first time.");
    return { ...cached, session: { ...cached.session, answers: cached.answers || {} } };
  }
  try {
    const packet = await callApi("exam.start", { examId, pin, deviceId: deviceId() });
    const saved = store.putPacket(uid, examId, { ...packet, offsetMs: packet.serverNowMs - Date.now() });
    if (saved.closed) throw new Error("This exam has already been submitted.");
    return { ...saved, session: { ...saved.session, answers: saved.answers } };
  } catch (error) {
    if (cached?.questions?.length && (!error.status || error.status >= 500)) return { ...cached, session: { ...cached.session, answers: cached.answers } };
    throw error;
  }
}

export async function saveExamProgress(examId, answers, metadata = {}) {
  const packet = saveLocalExamDraft(examId, answers, metadata);
  if (packet?.closed) return { closed: true };
  if (!window.navigator.onLine) return { localOnly: true };
  return callApi("exam.progress", { examId, answers, deviceId: deviceId(), revision: packet.revision, tabSwitchCount: metadata.tabSwitchCount || 0 });
}

function importLegacyQueue(uid) {
  const raw = window.localStorage.getItem("cbt_pending_submissions_v1");
  if (!raw) return;
  const old = JSON.parse(raw);
  for (const item of old.filter((entry) => entry.uid === uid)) {
    const store = deviceExamStore();
    if (store.read(uid, item.examId)) continue;
    store.putPacket(uid, item.examId, { session: { examId: item.examId, studentUid: uid, status: "started" }, questions: [] });
    store.close(uid, item.examId, { examId: item.examId, answers: item.payload?.answers || {},
      submissionReason: item.payload?.submissionReason || "manual", closedAtMs: item.payload?.submittedAtMs || item.queuedAtMs,
      submissionId: `legacy-${item.examId}-${uid}` });
  }
}

export function flushPendingSubmissions() {
  const uid = auth.currentUser?.uid;
  if (!uid || !window.navigator.onLine) return Promise.resolve({ synced: 0 });
  if (syncing.has(uid)) return syncing.get(uid);
  const task = (async () => {
    importLegacyQueue(uid);
    let synced = 0;
    for (const packet of deviceExamStore().list(uid).filter((entry) => entry.pending)) {
      if (auth.currentUser?.uid !== uid) break;
      const payload = packet.pending;
      try {
        await callApi("exam.submit", payload);
        deviceExamStore().acknowledge(uid, payload.examId, payload.submissionId);
        const legacyRaw = window.localStorage.getItem("cbt_pending_submissions_v1");
        if (legacyRaw) window.localStorage.setItem("cbt_pending_submissions_v1", JSON.stringify(JSON.parse(legacyRaw)
          .filter((item) => item.uid !== uid || item.examId !== payload.examId)));
        synced++;
      } catch (error) {
        deviceExamStore().syncError(uid, payload.examId, error.message || "Waiting to reconnect.");
      }
    }
    return { synced };
  })().finally(() => syncing.delete(uid));
  syncing.set(uid, task);
  return task;
}

export function submitExamSession(examId, answers, metadata = {}) {
  const payload = { examId, answers, deviceId: deviceId(), submissionReason: metadata.submissionReason || "manual",
    tabSwitchCount: Number(metadata.tabSwitchCount || 0), closedAtMs: Date.now(), submissionId: window.crypto.randomUUID() };
  deviceExamStore().close(currentUid(), examId, payload);
  // Persist the final answers before authentication refresh, network reads or writes.
  void flushPendingSubmissions().catch((error) => console.error("Submission retry deferred", error));
  return { pendingSync: true };
}

export const setUserRole = (email, role) => callApi("users.role", { email, role });
export const setStudentLoginAccess = (studentId, loginDisabled) => callApi("students.access", { studentId, loginDisabled });
