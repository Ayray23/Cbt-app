import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "/firebase";
import { hashAccessCode } from "../utils/accessCode";

const EXAM_DRAFT_PREFIX = "cbt_exam_draft_v1";
const PENDING_SUBMISSIONS_KEY = "cbt_pending_submissions_v1";

function requireUser() {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("Please sign in to continue.");
  }

  return currentUser;
}

function normalizeAnswers(answers) {
  if (!answers || typeof answers !== "object") {
    return {};
  }

  return Object.entries(answers).reduce((acc, [questionId, answer]) => {
    acc[questionId] = String(answer || "").trim().toUpperCase();
    return acc;
  }, {});
}

function shuffleArray(items) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function buildOptionOrderByQuestion(questionDocs) {
  return questionDocs.reduce((acc, questionDoc) => {
    acc[questionDoc.id] = shuffleArray(["A", "B", "C", "D"]);
    return acc;
  }, {});
}

function toMillis(timestamp, fallback = Date.now()) {
  return timestamp && typeof timestamp.toMillis === "function" ? timestamp.toMillis() : fallback;
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
  if (!uid) {
    return;
  }

  window.localStorage.removeItem(draftStorageKey(uid, examId));
}

async function queuePendingSubmission(uid, examId, payload) {
  const currentQueue = readPendingSubmissions().filter(
    (item) => !(item.uid === uid && item.examId === examId)
  );

  currentQueue.push({
    uid,
    examId,
    payload,
    queuedAtMs: Date.now(),
  });

  writePendingSubmissions(currentQueue);
}

async function writeSubmittedSession(sessionRef, payload) {
  await setDoc(
    sessionRef,
    {
      ...payload,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function flushPendingSubmissions() {
  const currentUser = auth.currentUser;
  if (!currentUser || !window.navigator.onLine) {
    return { synced: 0, remaining: readPendingSubmissions().length };
  }

  const queue = readPendingSubmissions();
  const remaining = [];
  let synced = 0;

  for (const item of queue) {
    if (item.uid !== currentUser.uid) {
      remaining.push(item);
      continue;
    }

    try {
      await writeSubmittedSession(doc(db, "examSessions", `${item.examId}_${item.uid}`), item.payload);
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
  const currentUser = requireUser();
  const examRef = doc(db, "exams", examId);
  const sessionRef = doc(db, "examSessions", `${examId}_${currentUser.uid}`);
  const userRef = doc(db, "users", currentUser.uid);

  const [examSnapshot, sessionSnapshot, userSnapshot, questionsSnapshot] = await Promise.all([
    getDoc(examRef),
    getDoc(sessionRef),
    getDoc(userRef),
    getDocs(query(collection(db, "questions"), where("examId", "==", examId))),
  ]);

  if (!examSnapshot.exists()) {
    throw new Error("Exam not found.");
  }

  const exam = examSnapshot.data();
  if (exam.status !== "published") {
    throw new Error("This exam is not available right now.");
  }

  if (getPendingSubmissionMap(currentUser.uid)[examId]) {
    throw new Error("This exam has already been submitted and is waiting to sync.");
  }

  if (sessionSnapshot.exists()) {
    const existing = sessionSnapshot.data();
    if (existing.status === "submitted") {
      throw new Error("This exam has already been submitted.");
    }

    const localDraft = getLocalExamDraft(currentUser.uid, examId);
    return {
      id: sessionSnapshot.id,
      ...existing,
      answers: {
        ...(existing.answers || {}),
        ...(localDraft?.answers || {}),
      },
      startedAtMs: existing.startedAtMs || toMillis(existing.startedAt),
      optionOrderByQuestion: existing.optionOrderByQuestion || {},
      tabSwitchCount: Number(existing.tabSwitchCount || 0),
      integrityWarnings: Number(existing.integrityWarnings || 0),
      expiresAtMs:
        existing.expiresAtMs ||
        (existing.startedAtMs
          ? existing.startedAtMs + (Number(exam.duration || 0) * 60 * 1000)
          : toMillis(existing.startedAt) + (Number(exam.duration || 0) * 60 * 1000)),
    };
  }

  if (!exam.accessCodeHash) {
    throw new Error("This exam is not open yet. Ask your supervisor for the exam password.");
  }

  const providedAccessCodeHash = await hashAccessCode(accessCode);
  if (providedAccessCodeHash !== exam.accessCodeHash) {
    throw new Error("Incorrect exam password.");
  }

  if (questionsSnapshot.empty) {
    throw new Error("This exam has no questions yet.");
  }

  const questionOrder = shuffleArray(questionsSnapshot.docs.map((questionDoc) => questionDoc.id));
  const optionOrderByQuestion = buildOptionOrderByQuestion(questionsSnapshot.docs);
  const profile = userSnapshot.exists() ? userSnapshot.data() : {};
  const startedAtMs = Date.now();
  const expiresAtMs = startedAtMs + (Number(exam.duration || 0) * 60 * 1000);
  const sessionData = {
    examId,
    examTitle: exam.title || "",
    studentUid: currentUser.uid,
    studentEmail: currentUser.email || profile.email || "",
    studentName: profile.displayName || currentUser.email || "Candidate",
    status: "started",
    answers: {},
    questionOrder,
    optionOrderByQuestion,
    startedAtMs,
    expiresAtMs,
    totalAutoScore: 0,
    finalScore: 0,
    tabSwitchCount: 0,
    integrityWarnings: 0,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(sessionRef, sessionData);
  const createdSnapshot = await getDoc(sessionRef);
  const result = {
    id: createdSnapshot.id,
    ...createdSnapshot.data(),
  };

  if (result.startedAt && typeof result.startedAt.toMillis === "function") {
    return {
      ...result,
      startedAtMs: result.startedAtMs || result.startedAt.toMillis(),
    };
  }

  return result;
}

export async function saveExamProgress(examId, answers, metadata = {}) {
  const currentUser = requireUser();
  const sessionRef = doc(db, "examSessions", `${examId}_${currentUser.uid}`);
  const sessionSnapshot = await getDoc(sessionRef);

  if (!sessionSnapshot.exists()) {
    throw new Error("Exam session not found.");
  }

  const session = sessionSnapshot.data();
  if (session.status === "submitted") {
    return {
      id: sessionSnapshot.id,
      ...session,
    };
  }

  saveLocalExamDraft(examId, answers, metadata);

  await updateDoc(sessionRef, {
    answers: normalizeAnswers(answers),
    ...metadata,
    lastSavedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const updatedSnapshot = await getDoc(sessionRef);
  return {
    id: updatedSnapshot.id,
    ...updatedSnapshot.data(),
  };
}

export async function submitExamSession(examId, answers, metadata = {}) {
  const currentUser = requireUser();
  const normalizedAnswers = normalizeAnswers(answers);
  const examRef = doc(db, "exams", examId);
  const sessionRef = doc(db, "examSessions", `${examId}_${currentUser.uid}`);
  const userRef = doc(db, "users", currentUser.uid);

  const [examSnapshot, questionsSnapshot, userSnapshot] = await Promise.all([
    getDoc(examRef),
    getDocs(query(collection(db, "questions"), where("examId", "==", examId))),
    getDoc(userRef),
  ]);

  if (!examSnapshot.exists()) {
    throw new Error("Exam not found.");
  }

  const exam = examSnapshot.data();
  if (exam.status !== "published") {
    throw new Error("This exam is not available right now.");
  }

  const existingSessionSnapshot = await getDoc(sessionRef);
  if (existingSessionSnapshot.exists() && existingSessionSnapshot.data().status === "submitted") {
    throw new Error("This exam has already been submitted.");
  }

  if (questionsSnapshot.empty) {
    throw new Error("This exam has no questions yet.");
  }

  const total = questionsSnapshot.docs.reduce((sum, questionDoc) => {
    const question = questionDoc.data();
    const studentAnswer = normalizedAnswers[questionDoc.id] || "";
    const correctAnswer = String(question.correctAnswer || "").trim().toUpperCase();
    const marks = Number(question.marks || 1);
    return sum + (studentAnswer === correctAnswer ? marks : 0);
  }, 0);

  const profile = userSnapshot.exists() ? userSnapshot.data() : {};
  const existingSession = existingSessionSnapshot.exists() ? existingSessionSnapshot.data() : {};
  const sessionData = {
    examId,
    examTitle: exam.title || "",
    studentUid: currentUser.uid,
    studentEmail: currentUser.email || profile.email || "",
    studentName: profile.displayName || currentUser.email || "Candidate",
    answers: normalizedAnswers,
    questionOrder: existingSession.questionOrder || [],
    optionOrderByQuestion: existingSession.optionOrderByQuestion || {},
    startedAtMs: existingSession.startedAtMs || Date.now(),
    expiresAtMs: existingSession.expiresAtMs || Date.now(),
    totalAutoScore: total,
    finalScore: total,
    status: "submitted",
    submissionReason: metadata.submissionReason || "manual",
    tabSwitchCount: Number(metadata.tabSwitchCount ?? existingSession.tabSwitchCount ?? 0),
    integrityWarnings: Number(metadata.integrityWarnings ?? existingSession.integrityWarnings ?? 0),
    submittedAtMs: Date.now(),
  };

  if (!window.navigator.onLine) {
    await queuePendingSubmission(currentUser.uid, examId, sessionData);
    clearLocalExamDraft(examId, currentUser.uid);
    return {
      id: sessionRef.id,
      ...existingSession,
      ...sessionData,
      pendingSync: true,
    };
  }

  await writeSubmittedSession(sessionRef, sessionData);
  clearLocalExamDraft(examId, currentUser.uid);

  return {
    id: sessionRef.id,
    ...existingSession,
    ...sessionData,
  };
}

export async function setUserRole(email, role) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedRole = String(role || "").trim().toLowerCase();

  if (!normalizedEmail || !normalizedRole) {
    throw new Error("Email and role are required.");
  }

  const snapshot = await getDocs(
    query(collection(db, "users"), where("email", "==", normalizedEmail), limit(1))
  );

  if (snapshot.empty) {
    throw new Error("User profile not found. Ask the user to sign in first.");
  }

  await updateDoc(snapshot.docs[0].ref, {
    role: normalizedRole,
    updatedAt: serverTimestamp(),
  });

  return {
    ok: true,
    uid: snapshot.docs[0].id,
    email: normalizedEmail,
    role: normalizedRole,
  };
}

export async function setStudentLoginAccess(studentId, loginDisabled) {
  const studentRef = doc(db, "users", studentId);
  const studentSnapshot = await getDoc(studentRef);

  if (!studentSnapshot.exists()) {
    throw new Error("Student profile not found.");
  }

  const student = studentSnapshot.data();
  if (student.role !== "student") {
    throw new Error("Only student accounts can be blocked from this page.");
  }

  await updateDoc(studentRef, {
    loginDisabled,
    updatedAt: serverTimestamp(),
    disabledAt: loginDisabled ? serverTimestamp() : null,
  });

  return {
    ok: true,
    id: studentId,
    loginDisabled,
  };
}
