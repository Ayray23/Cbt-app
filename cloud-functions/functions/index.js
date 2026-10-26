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

async function assertStudentAssignedToExam(uid, exam) {
  const profile = (await getUserProfile(uid)) || {};
  const role = profile.role || "student";
  if (role === "admin" || role === "superadmin") return profile;

  if (exam.assignmentMode === "individual") {
    const assignedStudentUids = Array.isArray(exam.assignedStudentUids) ? exam.assignedStudentUids : [];
    if (!assignedStudentUids.includes(uid)) {
      throw new HttpsError("permission-denied", "This exam is not assigned to your student account.");
    }
  } else if (exam.className) {
    const studentClass = String(profile.className || "").trim();
    const examClass = String(exam.className || "").trim();
    if (!studentClass || studentClass !== examClass) {
      throw new HttpsError("permission-denied", "This exam is not assigned to your class.");
    }
  }

  return profile;
}

const examSecurity = require("./examSecurity");
exports.startExamSession = examSecurity.startExamSession;
exports.submitExamSession = examSecurity.submitExamSession;

// Students receive only the fields required to render an exam. The answer key
// remains server-side and is never sent to the candidate browser.
exports.getMyExamCodeStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const examId = String(request.data && request.data.examId || "").trim();
  if (!examId) throw new HttpsError("invalid-argument", "examId is required.");

  const examSnapshot = await db.collection("exams").doc(examId).get();
  if (!examSnapshot.exists) throw new HttpsError("not-found", "Exam not found.");
  const exam = examSnapshot.data();
  if (!exam.individualCodesEnabled) return { hasAssignedCode: false };

  const codeSnapshot = await db.collection("studentExamCodeHashes").doc(`${examId}_${request.auth.uid}`).get();
  if (!codeSnapshot.exists) return { hasAssignedCode: false };
  const record = codeSnapshot.data();
  const hasAssignedCode = record.studentUid === request.auth.uid &&
    record.examId === examId &&
    record.status === "active" &&
    Boolean(record.codeHash);
  return { hasAssignedCode };
});

exports.getExamQuestions = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const examId = String(request.data && request.data.examId || "").trim();
  if (!examId) throw new HttpsError("invalid-argument", "examId is required.");

  const examSnapshot = await db.collection("exams").doc(examId).get();
  if (!examSnapshot.exists) throw new HttpsError("not-found", "Exam not found.");
  const exam = examSnapshot.data();
  if (exam.status !== "published") throw new HttpsError("failed-precondition", "Exam is not published.");

  const profile = await assertStudentAssignedToExam(request.auth.uid, exam);
  const role = profile && profile.role || "student";
  if (role !== "admin" && role !== "superadmin") {
    const sessionRef = db.collection("examSessions").doc(`${examId}_${request.auth.uid}`);
    const sessionSnapshot = await sessionRef.get();
    if (!sessionSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Start your assigned exam before loading its questions.");
    }
    const session = sessionSnapshot.data();
    if (session.studentUid !== request.auth.uid || session.examId !== examId || session.status !== "started") {
      throw new HttpsError("permission-denied", "There is no active exam session for this account.");
    }
    const expiresAtMs = Number(session.expiresAtMs || 0);
    if (!expiresAtMs) {
      throw new HttpsError("failed-precondition", "This session has no valid expiry time. Contact the administrator.");
    }
    if (Date.now() > expiresAtMs) {
      throw new HttpsError("deadline-exceeded", "The exam time has expired.");
    }
  }

  const snapshot = await db.collection("questions").where("examId", "==", examId).get();
  if (snapshot.empty) throw new HttpsError("failed-precondition", "Exam has no questions.");

  return {
    questions: snapshot.docs.map((questionDoc) => {
      const safeQuestion = { ...questionDoc.data() };
      delete safeQuestion.correctAnswer;
      delete safeQuestion.answer;
      delete safeQuestion.answerKey;
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
