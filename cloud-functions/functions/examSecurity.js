/* eslint-disable max-len, indent, object-curly-spacing, require-jsdoc */
const admin = require("firebase-admin");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const crypto = require("crypto");

const db = admin.firestore();

function normalizeAccessCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function hashAccessCode(value) {
  return crypto.createHash("sha256").update(normalizeAccessCode(value)).digest("hex");
}

function normalizeAnswers(answers) {
  if (!answers || typeof answers !== "object") return {};
  return Object.entries(answers).reduce((acc, [questionId, answer]) => {
    acc[questionId] = String(answer || "").trim().toUpperCase();
    return acc;
  }, {});
}

function toMillis(timestamp) {
  return timestamp && typeof timestamp.toMillis === "function" ? timestamp.toMillis() : Date.now();
}

async function getUserProfile(uid) {
  const snapshot = await db.collection("users").doc(uid).get();
  return snapshot.exists ? snapshot.data() : {};
}

async function validateExamCode(examId, uid, accessCode, exam) {
  const provided = normalizeAccessCode(accessCode);
  if (!provided) throw new HttpsError("invalid-argument", "Enter your exam code.");

  if (exam.individualCodesEnabled) {
    const ref = db.collection("studentExamCodeHashes").doc(`${examId}_${uid}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpsError("permission-denied", "No individual exam code has been issued for this student.");
    const record = snapshot.data();
    if (record.studentUid !== uid || record.examId !== examId) throw new HttpsError("permission-denied", "This exam code is not assigned to this student.");
    if (record.status === "revoked") throw new HttpsError("permission-denied", "This exam code has been revoked.");
    if (record.status === "used") throw new HttpsError("failed-precondition", "This exam code has already been used.");
    if (!record.codeHash || hashAccessCode(provided) !== record.codeHash) throw new HttpsError("permission-denied", "Incorrect exam code for this student account.");
    return ref;
  }

  if (!exam.accessCodeHash || hashAccessCode(provided) !== exam.accessCodeHash) {
    throw new HttpsError("permission-denied", "Incorrect exam code.");
  }
  return null;
}

exports.startExamSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const examId = String(request.data?.examId || "").trim();
  const accessCode = request.data?.accessCode || "";
  if (!examId) throw new HttpsError("invalid-argument", "examId is required.");

  const examRef = db.collection("exams").doc(examId);
  const sessionRef = db.collection("examSessions").doc(`${examId}_${request.auth.uid}`);
  const [examSnapshot, sessionSnapshot] = await Promise.all([examRef.get(), sessionRef.get()]);
  if (!examSnapshot.exists) throw new HttpsError("not-found", "Exam not found.");
  const exam = examSnapshot.data();
  if (exam.status !== "published") throw new HttpsError("failed-precondition", "Exam is not published.");

  const now = Date.now();
  const startAt = Number(exam.scheduleStartAtMs || 0);
  const endAt = Number(exam.scheduleEndAtMs || 0);
  if (startAt && now < startAt) throw new HttpsError("failed-precondition", "This exam has not started yet.");
  if (endAt && now > endAt) throw new HttpsError("failed-precondition", "This exam is no longer available.");

  if (sessionSnapshot.exists) {
    const current = sessionSnapshot.data();
    if (current.status === "submitted") throw new HttpsError("failed-precondition", "This exam has already been submitted.");
    return { id: sessionSnapshot.id, ...current, startedAtMs: current.startedAtMs || toMillis(current.startedAt) };
  }

  const questionsSnapshot = await db.collection("questions").where("examId", "==", examId).get();
  if (questionsSnapshot.empty) throw new HttpsError("failed-precondition", "Exam has no questions.");

  const codeRef = await validateExamCode(examId, request.auth.uid, accessCode, exam);
  const userProfile = await getUserProfile(request.auth.uid);
  const startedAtMs = now;
  const expiresAtMs = startedAtMs + Number(exam.duration || 0) * 60 * 1000;

  const sessionData = {
    examId,
    examTitle: exam.title || "",
    studentUid: request.auth.uid,
    studentEmail: request.auth.token.email || userProfile.email || "",
    studentName: userProfile.displayName || request.auth.token.name || request.auth.token.email || "Candidate",
    status: "started",
    answers: {},
    totalAutoScore: 0,
    finalScore: 0,
    startedAtMs,
    expiresAtMs,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const transactionResult = await db.runTransaction(async (transaction) => {
    const latestSession = await transaction.get(sessionRef);
    if (latestSession.exists) return { existing: latestSession.data() };
    if (codeRef) {
      const latestCode = await transaction.get(codeRef);
      if (!latestCode.exists || latestCode.data().status !== "active") throw new HttpsError("failed-precondition", "This exam code has already been used or revoked.");
      transaction.update(codeRef, { status: "used", usedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    transaction.set(sessionRef, sessionData);
    return { created: true };
  });

  if (transactionResult.existing) {
    return { id: sessionRef.id, ...transactionResult.existing, startedAtMs: transactionResult.existing.startedAtMs || toMillis(transactionResult.existing.startedAt) };
  }

  const storedSnapshot = await sessionRef.get();
  const stored = storedSnapshot.data() || {};
  return { id: storedSnapshot.id, ...stored, startedAtMs: stored.startedAtMs || toMillis(stored.startedAt) };
});

exports.submitExamSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const examId = String(request.data?.examId || "").trim();
  if (!examId) throw new HttpsError("invalid-argument", "examId is required.");
  const answers = normalizeAnswers(request.data?.answers);

  const examSnapshot = await db.collection("exams").doc(examId).get();
  const sessionRef = db.collection("examSessions").doc(`${examId}_${request.auth.uid}`);
  const sessionSnapshot = await sessionRef.get();
  if (!examSnapshot.exists) throw new HttpsError("not-found", "Exam not found.");
  if (!sessionSnapshot.exists) throw new HttpsError("failed-precondition", "Exam session not found.");

  const exam = examSnapshot.data();
  const session = sessionSnapshot.data();
  if (session.studentUid !== request.auth.uid) throw new HttpsError("permission-denied", "This session does not belong to you.");
  if (session.status === "submitted") throw new HttpsError("failed-precondition", "This exam has already been submitted.");
  if (exam.status !== "published") throw new HttpsError("failed-precondition", "Exam is not published.");

  const expiresAtMs = Number(session.expiresAtMs || 0);
  const submissionReason = String(request.data?.submissionReason || "manual");
  if (expiresAtMs && Date.now() > expiresAtMs + 30000 && submissionReason !== "timeout") {
    throw new HttpsError("deadline-exceeded", "The exam time has expired.");
  }

  const questionsSnapshot = await db.collection("questions").where("examId", "==", examId).get();
  if (questionsSnapshot.empty) throw new HttpsError("failed-precondition", "Exam has no questions.");

  let total = 0;
  const gradedAnswers = {};
  questionsSnapshot.docs.forEach((questionDoc) => {
    const question = questionDoc.data();
    const answer = answers[questionDoc.id] || "";
    const correct = String(question.correctAnswer || "").trim().toUpperCase();
    const marks = Number(question.marks || 1);
    total += answer === correct ? marks : 0;
    gradedAnswers[questionDoc.id] = answer;
  });

  await sessionRef.set({
    answers: gradedAnswers,
    totalAutoScore: total,
    finalScore: total,
    status: "submitted",
    submissionReason,
    tabSwitchCount: Number(request.data?.tabSwitchCount || session.tabSwitchCount || 0),
    integrityWarnings: Number(request.data?.integrityWarnings || session.integrityWarnings || 0),
    submittedAtMs: Date.now(),
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { id: sessionRef.id, score: total, maxScore: questionsSnapshot.docs.reduce((sum, item) => sum + Number(item.data().marks || 1), 0), status: "submitted" };
});
