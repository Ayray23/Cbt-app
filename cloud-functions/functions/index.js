/* eslint-disable comma-dangle, indent, max-len, object-curly-spacing, require-jsdoc */
const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ maxInstances: 10 });

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
  return snapshot.exists ? snapshot.data() : null;
}

async function requireRole(uid, allowedRoles) {
  const profile = await getUserProfile(uid);
  const role = profile && profile.role ? profile.role : "student";
  if (!allowedRoles.includes(role)) throw new HttpsError("permission-denied", "You do not have access to this action.");
  return profile;
}

exports.startExamSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const examId = String(request.data?.examId || "").trim();
  if (!examId) throw new HttpsError("invalid-argument", "examId is required.");
  const examSnapshot = await db.collection("exams").doc(examId).get();
  if (!examSnapshot.exists) throw new HttpsError("not-found", "Exam not found.");
  const exam = examSnapshot.data();
  if (exam.status !== "published") throw new HttpsError("failed-precondition", "Exam is not published.");
  const userProfile = await getUserProfile(request.auth.uid);
  const sessionRef = db.collection("examSessions").doc(`${examId}_${request.auth.uid}`);
  const existingSession = await sessionRef.get();
  if (existingSession.exists) {
    const current = existingSession.data();
    return { id: existingSession.id, ...current, startedAtMs: toMillis(current.startedAt) };
  }
  const sessionData = {
    examId,
    examTitle: exam.title || "",
    studentUid: request.auth.uid,
    studentEmail: (request.auth.token && request.auth.token.email) || (userProfile && userProfile.email) || "",
    studentName: (userProfile && userProfile.displayName) || (request.auth.token && request.auth.token.name) || (request.auth.token && request.auth.token.email) || "Candidate",
    status: "started",
    answers: {},
    totalAutoScore: 0,
    finalScore: 0,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await sessionRef.set(sessionData);
  const storedSnapshot = await sessionRef.get();
  const stored = storedSnapshot.data();
  return { id: storedSnapshot.id, ...stored, startedAtMs: toMillis(stored.startedAt) };
});

exports.submitExamSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const examId = String(request.data?.examId || "").trim();
  if (!examId) throw new HttpsError("invalid-argument", "examId is required.");
  const answers = normalizeAnswers(request.data?.answers);
  const examSnapshot = await db.collection("exams").doc(examId).get();
  if (!examSnapshot.exists) throw new HttpsError("not-found", "Exam not found.");
  const exam = examSnapshot.data();
  if (exam.status !== "published") throw new HttpsError("failed-precondition", "Exam is not published.");
  const questionsSnapshot = await db.collection("questions").where("examId", "==", examId).get();
  if (questionsSnapshot.empty) throw new HttpsError("failed-precondition", "Exam has no questions.");
  let total = 0;
  const gradedAnswers = {};
  questionsSnapshot.docs.forEach((questionDoc) => {
    const question = questionDoc.data();
    const studentAnswer = answers[questionDoc.id] || "";
    const correctAnswer = String(question.correctAnswer || "").trim().toUpperCase();
    const marks = Number(question.marks || 1);
    total += studentAnswer === correctAnswer ? marks : 0;
    gradedAnswers[questionDoc.id] = studentAnswer;
  });
  const userProfile = await getUserProfile(request.auth.uid);
  const sessionRef = db.collection("examSessions").doc(`${examId}_${request.auth.uid}`);
  const sessionSnapshot = await sessionRef.get();
  if (sessionSnapshot.exists && sessionSnapshot.data().status === "submitted") throw new HttpsError("failed-precondition", "This exam has already been submitted.");
  const sessionData = {
    examId,
    examTitle: exam.title || "",
    studentUid: request.auth.uid,
    studentEmail: (request.auth.token && request.auth.token.email) || (userProfile && userProfile.email) || "",
    studentName: (userProfile && userProfile.displayName) || (request.auth.token && request.auth.token.name) || (request.auth.token && request.auth.token.email) || "Candidate",
    answers: gradedAnswers,
    totalAutoScore: total,
    finalScore: total,
    status: "submitted",
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await sessionRef.set(sessionData, { merge: true });
  return { id: sessionRef.id, score: total, maxScore: questionsSnapshot.docs.reduce((sum, item) => sum + Number(item.data().marks || 1), 0), status: "submitted" };
});

exports.setUserRole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  await requireRole(request.auth.uid, ["superadmin"]);
  const email = String(request.data?.email || "").trim().toLowerCase();
  const role = String(request.data?.role || "").trim().toLowerCase();
  const allowedRoles = ["student", "admin", "superadmin"];
  if (!email || !allowedRoles.includes(role)) throw new HttpsError("invalid-argument", "Provide a valid email and role.");
  const usersSnapshot = await db.collection("users").where("email", "==", email).limit(1).get();
  if (usersSnapshot.empty) throw new HttpsError("not-found", "User profile not found. The user must sign in at least once before role changes.");
  const targetUser = usersSnapshot.docs[0];
  await targetUser.ref.set({ role, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, uid: targetUser.id, role, email };
});

// The production Firebase codebase uses the dedicated security module below.
// It replaces these legacy callable implementations at export time.
const examSecurity = require("./examSecurity");
exports.startExamSession = examSecurity.startExamSession;
exports.submitExamSession = examSecurity.submitExamSession;
