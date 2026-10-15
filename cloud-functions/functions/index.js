/* eslint-disable comma-dangle, indent, max-len, object-curly-spacing, require-jsdoc */
const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ maxInstances: 10 });

async function getUserProfile(uid) {
  const snapshot = await db.collection("users").doc(uid).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function requireRole(uid, allowedRoles) {
  const profile = await getUserProfile(uid);
  const role = profile && profile.role || "student";
  if (!allowedRoles.includes(role)) {
    throw new HttpsError("permission-denied", "You do not have access to this action.");
  }
  return profile;
}

const examSecurity = require("./examSecurity");
exports.startExamSession = examSecurity.startExamSession;
exports.submitExamSession = examSecurity.submitExamSession;

// Students receive only the fields required to render an exam. The answer key
// remains server-side and is never sent to the candidate browser.
exports.getExamQuestions = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const examId = String(request.data && request.data.examId || "").trim();
  if (!examId) throw new HttpsError("invalid-argument", "examId is required.");

  const examSnapshot = await db.collection("exams").doc(examId).get();
  if (!examSnapshot.exists) throw new HttpsError("not-found", "Exam not found.");
  const exam = examSnapshot.data();
  if (exam.status !== "published") throw new HttpsError("failed-precondition", "Exam is not published.");

  const snapshot = await db.collection("questions").where("examId", "==", examId).get();
  if (snapshot.empty) throw new HttpsError("failed-precondition", "Exam has no questions.");

  return {
    questions: snapshot.docs.map((questionDoc) => {
      const question = questionDoc.data();
      const { correctAnswer, answer, answerKey, ...safeQuestion } = question;
      return { id: questionDoc.id, ...safeQuestion };
    }),
  };
});

exports.setUserRole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  await requireRole(request.auth.uid, ["superadmin"]);

  const email = String(request.data && request.data.email || "").trim().toLowerCase();
  const role = String(request.data && request.data.role || "").trim().toLowerCase();
  const allowedRoles = ["student", "admin", "superadmin"];

  if (!email || !allowedRoles.includes(role)) {
    throw new HttpsError("invalid-argument", "Provide a valid email and role.");
  }

  const usersSnapshot = await db.collection("users").where("email", "==", email).limit(1).get();
  if (usersSnapshot.empty) {
    throw new HttpsError("not-found", "User profile not found. The user must sign in at least once before role changes.");
  }

  const targetUser = usersSnapshot.docs[0];
  await targetUser.ref.set({
    role,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, uid: targetUser.id, role, email };
});
