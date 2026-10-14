import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db } from "/firebase";
import { startExamSession } from "./sessionService";

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in to continue.");
  return user;
}

function shuffle(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function buildOptionOrder(questionDocs) {
  return questionDocs.reduce((result, question) => {
    result[question.id] = shuffle(["A", "B", "C", "D"]);
    return result;
  }, {});
}

function toMillis(timestamp) {
  return timestamp && typeof timestamp.toMillis === "function" ? timestamp.toMillis() : Date.now();
}

function errorMessage(error) {
  return error?.details || error?.message || "Could not verify the exam code.";
}

export async function startSecureExamSession(examId, accessCode = "") {
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

  if (!examSnapshot.exists()) throw new Error("Exam not found.");
  const exam = examSnapshot.data();
  if (exam.status !== "published") throw new Error("This exam is not available right now.");

  // Keep the existing shared-code flow intact. The secure backend validator is
  // specifically used for exams that have individual student codes enabled.
  if (!exam.individualCodesEnabled) {
    return startExamSession(examId, accessCode);
  }

  if (sessionSnapshot.exists()) {
    const existing = sessionSnapshot.data();
    if (existing.status === "submitted") throw new Error("This exam has already been submitted.");
    return {
      id: sessionSnapshot.id,
      ...existing,
      startedAtMs: existing.startedAtMs || toMillis(existing.startedAt),
      optionOrderByQuestion: existing.optionOrderByQuestion || {},
      tabSwitchCount: Number(existing.tabSwitchCount || 0),
      integrityWarnings: Number(existing.integrityWarnings || 0),
      expiresAtMs:
        existing.expiresAtMs ||
        (existing.startedAtMs
          ? existing.startedAtMs + Number(exam.duration || 0) * 60 * 1000
          : toMillis(existing.startedAt) + Number(exam.duration || 0) * 60 * 1000),
    };
  }

  if (questionsSnapshot.empty) throw new Error("This exam has no questions yet.");

  const validateCode = httpsCallable(getFunctions(), "validateStudentExamCode");
  try {
    await validateCode({ examId, accessCode });
  } catch (error) {
    throw new Error(errorMessage(error));
  }

  const questionOrder = shuffle(questionsSnapshot.docs.map((question) => question.id));
  const optionOrderByQuestion = buildOptionOrder(questionsSnapshot.docs);
  const profile = userSnapshot.exists() ? userSnapshot.data() : {};
  const startedAtMs = Date.now();
  const expiresAtMs = startedAtMs + Number(exam.duration || 0) * 60 * 1000;
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

  const codeRef = doc(db, "studentExamCodeHashes", `${examId}_${currentUser.uid}`);
  const codeSnapshot = await getDoc(codeRef);
  if (!codeSnapshot.exists() || codeSnapshot.data().status !== "active") {
    throw new Error("The individual exam code is no longer available. Contact your administrator.");
  }
  await updateDoc(codeRef, { status: "used", usedAt: serverTimestamp(), updatedAt: serverTimestamp() });

  return { id: sessionRef.id, ...sessionData };
}
