import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db } from "/firebase";

const EXAM_DRAFT_PREFIX = "cbt_exam_draft_v2";
const PENDING_SUBMISSIONS_KEY = "cbt_pending_submissions_v2";

function requireUser() {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Please sign in to continue.");
  return currentUser;
}

function normalizeAnswers(answers) {
  if (!answers || typeof answers !== "object") return {};
  return Object.entries(answers).reduce((acc, [questionId, answer]) => {
    acc[questionId] = String(answer || "").trim().toUpperCase();
    return acc;
  }, {});
}

function draftStorageKey(uid, examId) {
  return `${EXAM_DRAFT_PREFIX}:${uid}:${examId}`;
}

function readPendingSubmissions() {
  try {
    return JSON.parse(window.localStorage.getItem(PENDING_SUBMISSIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

function writePendingSubmissions(items) {
  window.localStorage.setItem(PENDING_SUBMISSIONS_KEY, JSON.stringify(items));
}

function friendlyCallableError(error, fallback) {
  const code = String(error?.code || "");
  if (code.includes("functions/permission-denied")) return error?.details || error?.message || "You are not allowed to perform this exam action.";
  if (code.includes("functions/failed-precondition")) return error?.details || error?.message || fallback;
  if (code.includes("functions/deadline-exceeded")) return error?.details || "The exam time has expired.";
  if (code.includes("functions/not-found")) return "The secure exam service is not deployed yet. Please contact the administrator.";
  if (code.includes("functions/internal")) return "The exam server could not complete this request. Please try again or contact the administrator.";
  return error?.details || error?.message || fallback;
}

export function getPendingSubmissionMap(uid) {
  return readPendingSubmissions()
    .filter((item) => item.uid === uid)
    .reduce((acc, item) => {
      acc[item.examId] = item;
      return acc;
    }, {});
}

export function getLocalExamDraft(uid, examId) {
  try {
    return JSON.parse(window.localStorage.getItem(draftStorageKey(uid, examId)) || "null");
  } catch {
    return null;
  }
}

export function saveLocalExamDraft(examId, answers, metadata = {}) {
  const currentUser = requireUser();
  const draft = {
    uid: currentUser.uid,
    examId,
    answers: normalizeAnswers(answers),
    updatedAtMs: Date.now(),
    ...metadata,
  };
  window.localStorage.setItem(draftStorageKey(currentUser.uid, examId), JSON.stringify(draft));
  return draft;
}

export function clearLocalExamDraft(examId, uid = auth.currentUser?.uid) {
  if (uid) window.localStorage.removeItem(draftStorageKey(uid, examId));
}

async function queuePendingSubmission(uid, examId, payload) {
  const currentQueue = readPendingSubmissions().filter((item) => !(item.uid === uid && item.examId === examId));
  currentQueue.push({ uid, examId, payload, queuedAtMs: Date.now() });
  writePendingSubmissions(currentQueue);
}

export async function flushPendingSubmissions() {
  const currentUser = auth.currentUser;
  if (!currentUser || !window.navigator.onLine) return { synced: 0, remaining: readPendingSubmissions().length };

  const queue = readPendingSubmissions();
  const remaining = [];
  let synced = 0;
  const submitExam = httpsCallable(getFunctions(), "submitExamSession");

  for (const item of queue) {
    if (item.uid !== currentUser.uid) {
      remaining.push(item);
      continue;
    }
    try {
      await submitExam({
        examId: item.examId,
        answers: item.payload.answers,
        submissionReason: item.payload.submissionReason || "offline-sync",
        tabSwitchCount: Number(item.payload.tabSwitchCount || 0),
        integrityWarnings: Number(item.payload.integrityWarnings || 0),
      });
      clearLocalExamDraft(item.examId, item.uid);
      synced += 1;
    } catch (error) {
      console.error("Failed to sync queued submission", error);
      remaining.push(item);
    }
  }

  writePendingSubmissions(remaining);
  return { synced, remaining: remaining.length };
}

export async function startExamSession(examId, accessCode = "") {
  requireUser();
  const startExam = httpsCallable(getFunctions(), "startExamSession");
  try {
    const result = await startExam({ examId, accessCode: String(accessCode || "").trim().toUpperCase() });
    const session = result.data || {};
    const localDraft = getLocalExamDraft(auth.currentUser.uid, examId);
    return {
      ...session,
      answers: { ...(session.answers || {}), ...(localDraft?.answers || {}) },
      startedAtMs: session.startedAtMs || Date.now(),
      expiresAtMs: session.expiresAtMs || Date.now(),
      optionOrderByQuestion: session.optionOrderByQuestion || {},
      tabSwitchCount: Number(session.tabSwitchCount || 0),
      integrityWarnings: Number(session.integrityWarnings || 0),
    };
  } catch (error) {
    throw new Error(friendlyCallableError(error, "Could not start the exam."));
  }
}

export async function saveExamProgress(examId, answers, metadata = {}) {
  const currentUser = requireUser();
  const normalizedAnswers = normalizeAnswers(answers);
  const draft = saveLocalExamDraft(examId, normalizedAnswers, metadata);

  if (!window.navigator.onLine) {
    return { id: `${examId}_${currentUser.uid}`, answers: normalizedAnswers, ...metadata, offline: true, draft };
  }

  const sessionRef = doc(db, "examSessions", `${examId}_${currentUser.uid}`);
  try {
    const sessionSnapshot = await getDoc(sessionRef);
    if (!sessionSnapshot.exists()) throw new Error("Exam session not found.");
    if (sessionSnapshot.data().status === "submitted") return { id: sessionSnapshot.id, ...sessionSnapshot.data() };

    await updateDoc(sessionRef, {
      answers: normalizedAnswers,
      ...metadata,
      lastSavedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { id: sessionSnapshot.id, ...sessionSnapshot.data(), answers: normalizedAnswers, ...metadata, offline: false };
  } catch (error) {
    console.error("Cloud answer save failed; keeping local draft", error);
    return { id: sessionRef.id, answers: normalizedAnswers, ...metadata, offline: true, draft };
  }
}

export async function submitExamSession(examId, answers, metadata = {}) {
  const currentUser = requireUser();
  const normalizedAnswers = normalizeAnswers(answers);
  const payload = {
    answers: normalizedAnswers,
    submissionReason: metadata.submissionReason || "manual",
    tabSwitchCount: Number(metadata.tabSwitchCount || 0),
    integrityWarnings: Number(metadata.integrityWarnings || 0),
  };

  saveLocalExamDraft(examId, normalizedAnswers, payload);

  if (!window.navigator.onLine) {
    await queuePendingSubmission(currentUser.uid, examId, payload);
    return { id: `${examId}_${currentUser.uid}`, status: "pending-sync", pendingSync: true, answers: normalizedAnswers, ...payload };
  }

  try {
    const submitExam = httpsCallable(getFunctions(), "submitExamSession");
    const result = await submitExam({ examId, ...payload });
    clearLocalExamDraft(examId, currentUser.uid);
    return { ...(result.data || {}), pendingSync: false };
  } catch (error) {
    if (!window.navigator.onLine) {
      await queuePendingSubmission(currentUser.uid, examId, payload);
      return { id: `${examId}_${currentUser.uid}`, status: "pending-sync", pendingSync: true, answers: normalizedAnswers, ...payload };
    }
    throw new Error(friendlyCallableError(error, "Submission failed."));
  }
}

export async function setUserRole(email, role) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedRole) throw new Error("Email and role are required.");
  const snapshot = await getDocs(query(collection(db, "users"), where("email", "==", normalizedEmail), limit(1)));
  if (snapshot.empty) throw new Error("User profile not found. Ask the user to sign in first.");
  await updateDoc(snapshot.docs[0].ref, { role: normalizedRole, updatedAt: serverTimestamp() });
  return { ok: true, uid: snapshot.docs[0].id, email: normalizedEmail, role: normalizedRole };
}

export async function setStudentLoginAccess(studentId, loginDisabled) {
  const studentRef = doc(db, "users", studentId);
  const studentSnapshot = await getDoc(studentRef);
  if (!studentSnapshot.exists()) throw new Error("Student profile not found.");
  const student = studentSnapshot.data();
  if (student.role !== "student") throw new Error("Only student accounts can be blocked from this page.");
  await updateDoc(studentRef, {
    loginDisabled,
    updatedAt: serverTimestamp(),
    disabledAt: loginDisabled ? serverTimestamp() : null,
  });
  return { ok: true, id: studentId, loginDisabled };
}
