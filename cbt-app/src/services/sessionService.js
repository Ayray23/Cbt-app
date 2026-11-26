import { offlineStore, examRecordKey } from "./offlineStore";
import { auth } from "/firebase";
import { callApi } from "./api";
import { deviceExamStore } from "./examStore";

const syncing = new Map();
const progressInFlight = new Set();
const progressRetryAfter = new Map();
const pendingRetryAfter = new Map();
// Only background traffic backs off. A final exam submission always attempts
// the server immediately, and all local answers are retained on failure.
const PROGRESS_ERROR_BACKOFF_MS = 120000;
const PENDING_ERROR_BACKOFF_MS = 120000;
export function deviceId() {
  let value = window.localStorage.getItem("cbt_device_id");
  if (!value) {
    value = window.crypto.randomUUID();
    window.localStorage.setItem("cbt_device_id", value);
  }
  return value;
}

function currentUid() {
  if (!auth.currentUser) throw new Error("Please sign in to continue.");
  return auth.currentUser.uid;
}

export function getPendingSubmissionMap(uid) {
  importLegacyQueue(uid);
  return Object.fromEntries(
    deviceExamStore()
      .list(uid)
      .filter((packet) => packet.pending)
      .map((packet) => [
        packet.session.examId,
        { ...packet.pending, syncError: packet.syncError },
      ]),
  );
}

export function getDeviceExamMap(uid) {
  importLegacyQueue(uid);
  return Object.fromEntries(
    deviceExamStore()
      .list(uid)
      .map((packet) => [packet.session.examId, packet]),
  );
}

export function saveLocalExamDraft(examId, answers, metadata = {}) {
  return deviceExamStore().save(currentUid(), examId, answers, metadata);
}

export async function recoverDevicePackets(uid) {
  for (const key of await offlineStore.keys()) {
    if (typeof key !== "string" || !key.startsWith(`exam:${uid}:`)) continue;
    const value = await offlineStore.get(key);
    if (!value?.session?.examId || value.session.studentUid !== uid) continue;
    const store = deviceExamStore();
    let current;
    try {
      current = store.read(uid, value.session.examId);
    } catch {
      current = null;
    }
    if (
      !current ||
      (value.closed && !current.closed) ||
      (!current.closed && (value.revision || 0) > (current.revision || 0))
    )
      store.restore(uid, value.session.examId, value);
  }
}
export async function startExamSession(examId, pin = "") {
  const uid = currentUid();
  await recoverDevicePackets(uid);
  importLegacyQueue(uid);
  const store = deviceExamStore();
  const cached = store.read(uid, examId);
  if (cached?.closed) throw new Error("This exam has already been submitted.");
  if (!window.navigator.onLine) {
    if (!cached?.questions?.length)
      throw new Error(
        "Connect to the internet to start this exam for the first time.",
      );
    return {
      ...cached,
      session: { ...cached.session, answers: cached.answers || {} },
    };
  }
  try {
    const packet = await callApi("exam.start", {
      examId,
      pin,
      deviceId: deviceId(),
    });
    const saved = store.putPacket(uid, examId, {
      ...packet,
      offsetMs: packet.serverNowMs - Date.now(),
    });
    if (saved.closed) throw new Error("This exam has already been submitted.");
    return { ...saved, session: { ...saved.session, answers: saved.answers } };
  } catch (error) {
    if (cached?.questions?.length && (!error.status || error.status >= 500))
      return {
        ...cached,
        session: { ...cached.session, answers: cached.answers },
      };
    throw error;
  }
}

export async function saveExamProgress(examId, answers, metadata = {}) {
  const packet = saveLocalExamDraft(examId, answers, metadata);
  if (packet?.closed) return { closed: true };
  if (!window.navigator.onLine) return { localOnly: true };
  const key = `${currentUid()}:${examId}`;
  if (progressInFlight.has(key) || Date.now() < (progressRetryAfter.get(key) || 0))
    return { localOnly: true };
  progressInFlight.add(key);
  try {
    const result = await callApi("exam.progress", {
      examId,
      answers,
      deviceId: deviceId(),
      revision: packet.revision,
      deviceEpoch: packet.session.deviceEpoch || 0,
      tabSwitchCount: metadata.tabSwitchCount || 0,
      integrityLog: metadata.integrityLog || [],
    });
    progressRetryAfter.delete(key);
    if (result.expiresAtMs)
      deviceExamStore().deadline(currentUid(), examId, result.expiresAtMs);
    return result;
  } catch (error) {
    if (!error.status || error.status >= 500 || error.status === 429) {
      progressRetryAfter.set(key, Date.now() + PROGRESS_ERROR_BACKOFF_MS);
      // Background autosave failure must never close the exam or discard
      // device-saved answers. Final submit is a separate, prioritized request.
      return { localOnly: true };
    }
    throw error;
  } finally {
    progressInFlight.delete(key);
  }
}

function importLegacyQueue(uid) {
  const raw = window.localStorage.getItem("cbt_pending_submissions_v1");
  if (!raw) return;
  const old = JSON.parse(raw);
  for (const item of old.filter((entry) => entry.uid === uid)) {
    const store = deviceExamStore();
    if (store.read(uid, item.examId)) continue;
    store.putPacket(uid, item.examId, {
      session: { examId: item.examId, studentUid: uid, status: "started" },
      questions: [],
    });
    store.close(uid, item.examId, {
      examId: item.examId,
      answers: item.payload?.answers || {},
      submissionReason: item.payload?.submissionReason || "manual",
      closedAtMs: item.payload?.submittedAtMs || item.queuedAtMs,
      submissionId: `legacy-${item.examId}-${uid}`,
    });
  }
}

export function flushPendingSubmissions() {
  const uid = auth.currentUser?.uid;
  if (!uid || !window.navigator.onLine) return Promise.resolve({ synced: 0 });
  if (syncing.has(uid)) return syncing.get(uid);
  if (Date.now() < (pendingRetryAfter.get(uid) || 0))
    return Promise.resolve({ synced: 0, delayed: true });
  const task = (async () => {
    await recoverDevicePackets(uid);
    importLegacyQueue(uid);
    // A student may close the tab before the countdown callback runs.
    // On reconnect/login, close and queue any locally saved overdue attempt.
    for (const packet of deviceExamStore().list(uid)) {
      const examId = packet.session?.examId;
      if (!examId || packet.closed || !packet.questions?.length ||
          !Number.isFinite(packet.session?.expiresAtMs) ||
          Date.now() + (packet.offsetMs || 0) < packet.session.expiresAtMs) continue;
      try {
        const payload = {
          examId,
          answers: packet.answers || {},
          deviceEpoch: packet.session.deviceEpoch || 0,
          deviceId: deviceId(),
          submissionReason: "timeout",
          tabSwitchCount: Number(packet.metadata?.tabSwitchCount || 0),
          integrityLog: packet.metadata?.integrityLog || [],
          closedAtMs: Date.now(),
          submissionId: window.crypto.randomUUID(),
        };
        const closed = deviceExamStore().close(uid, examId, payload);
        await offlineStore.put(examRecordKey(uid, examId), closed);
      } catch (error) {
        console.error("Could not safely queue an expired local attempt", error);
      }
    }
    let synced = 0;
    for (const packet of deviceExamStore()
      .list(uid)
      .filter((entry) => entry.pending)) {
      if (auth.currentUser?.uid !== uid) break;
      const payload = packet.pending;
      try {
        await callApi("exam.submit", payload);
        deviceExamStore().acknowledge(
          uid,
          payload.examId,
          payload.submissionId,
        );
        const legacyRaw = window.localStorage.getItem(
          "cbt_pending_submissions_v1",
        );
        if (legacyRaw)
          window.localStorage.setItem(
            "cbt_pending_submissions_v1",
            JSON.stringify(
              JSON.parse(legacyRaw).filter(
                (item) => item.uid !== uid || item.examId !== payload.examId,
              ),
            ),
          );
        synced++;
        pendingRetryAfter.delete(uid);
      } catch (error) {
        deviceExamStore().syncError(
          uid,
          payload.examId,
          error.message || "Waiting to reconnect.",
        );
        if (!error.status || error.status >= 500 || error.status === 429) {
          // A quota outage must not make 500 clients retry every 30 seconds.
          pendingRetryAfter.set(uid, Date.now() + PENDING_ERROR_BACKOFF_MS);
          break;
        }
      }
    }
    return { synced };
  })().finally(() => syncing.delete(uid));
  syncing.set(uid, task);
  return task;
}

export async function submitExamSession(examId, answers, metadata = {}) {
  const payload = {
    examId,
    answers,
    deviceEpoch:
      deviceExamStore().read(currentUid(), examId)?.session?.deviceEpoch || 0,
    deviceId: deviceId(),
    submissionReason: metadata.submissionReason || "manual",
    tabSwitchCount: Number(metadata.tabSwitchCount || 0),
    integrityLog: metadata.integrityLog || [],
    closedAtMs: Date.now(),
    submissionId: window.crypto.randomUUID(),
  };
  const uid = currentUid();
  const closed = deviceExamStore().close(uid, examId, payload);
  await offlineStore.put(examRecordKey(uid, examId), closed);
  // Upload THIS attempt immediately, without waiting for the general queue
  // or its IndexedDB recovery. The local copy remains durable until the server
  // confirms grading. Other queued exams can sync independently later.
  let receipt = null;
  if (window.navigator.onLine) {
    try {
      receipt = await callApi("exam.submit", payload);
      deviceExamStore().acknowledge(uid, examId, payload.submissionId);
    } catch (error) {
      deviceExamStore().syncError(
        uid,
        examId,
        error.message || "Submission queued. Keep this device until it syncs.",
      );
    }
  }
  const pendingSync = Boolean(deviceExamStore().read(uid, examId)?.pending);
  return { pendingSync, submitted: !pendingSync, receipt };
}

export const setUserRole = (email, role) =>
  callApi("users.role", { email, role });
export const setStudentLoginAccess = (studentId, loginDisabled) =>
  callApi("students.access", { studentId, loginDisabled });
