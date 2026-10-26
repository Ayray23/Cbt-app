/* eslint-disable comma-dangle, indent, max-len, object-curly-spacing, require-jsdoc */
const admin = require("firebase-admin");
const crypto = require("crypto");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ maxInstances: 10 });

function normalizeAccessCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function hashAccessCode(value) {
  return crypto.createHash("sha256").update(normalizeAccessCode(value)).digest("hex");
}

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

// One-time, admin-only migration. Legacy exam docs were readable by signed-in
// users and may contain accessCodeHash; legacy examAccess docs may contain the
// plaintext code. Move the hash to the protected collection and remove both.
exports.migrateLegacyExamAccess = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  await requireRole(request.auth.uid, ["admin", "superadmin"]);

  const examsSnapshot = await db.collection("exams").get();
  let migratedCount = 0;
  let removedLegacyFields = 0;

  for (const examDocument of examsSnapshot.docs) {
    const examRef = examDocument.ref;
    const accessRef = db.collection("examAccess").doc(examDocument.id);
    const result = await db.runTransaction(async (transaction) => {
      const [latestExamSnapshot, accessSnapshot] = await Promise.all([
        transaction.get(examRef),
        transaction.get(accessRef),
      ]);
      if (!latestExamSnapshot.exists) return { migrated: false, removed: 0 };
      const exam = latestExamSnapshot.data() || {};
      const access = accessSnapshot.exists ? accessSnapshot.data() || {} : {};
      const hasLegacyExamHashField = Object.prototype.hasOwnProperty.call(exam, "accessCodeHash");
      const hasLegacyExamHash = Boolean(exam.accessCodeHash);
      const hasLegacyPlaintext = typeof access.code === "string" && access.code.length > 0;
      if (!hasLegacyExamHashField && !hasLegacyPlaintext) return { migrated: false, removed: 0 };

      const codeHash = access.codeHash || exam.accessCodeHash || (hasLegacyPlaintext ? hashAccessCode(access.code) : null);
      if (codeHash) {
        const protectedRecord = {
          examId: examDocument.id,
          codeHash,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (accessSnapshot.exists) {
          const updates = { ...protectedRecord };
          if (Object.prototype.hasOwnProperty.call(access, "code")) {
            updates.code = admin.firestore.FieldValue.delete();
          }
          transaction.update(accessRef, updates);
        } else {
          transaction.set(accessRef, protectedRecord);
        }
      } else if (accessSnapshot.exists && Object.prototype.hasOwnProperty.call(access, "code")) {
        transaction.update(accessRef, { code: admin.firestore.FieldValue.delete() });
      }

      const examUpdates = {};
      if (hasLegacyExamHashField) {
        examUpdates.accessCodeHash = admin.firestore.FieldValue.delete();
        examUpdates.accessCodeUpdatedAt = admin.firestore.FieldValue.delete();
      }
      if (Object.keys(examUpdates).length > 0) {
        examUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(examRef, examUpdates);
      }
      return {
        migrated: Boolean(codeHash),
        removed: Number(hasLegacyExamHashField) + Number(hasLegacyPlaintext),
      };
    });
    if (result.migrated) migratedCount += 1;
    removedLegacyFields += result.removed;
  }

  return { migratedCount, removedLegacyFields };
});

// Return only whether the signed-in student has a usable code; never return
// hashes, plaintext codes, or protected examAccess records to the browser.
exports.getMyExamCodeStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const examId = String(request.data && request.data.examId || "").trim();
  if (!examId) throw new HttpsError("invalid-argument", "examId is required.");

  const examSnapshot = await db.collection("exams").doc(examId).get();
  if (!examSnapshot.exists) throw new HttpsError("not-found", "Exam not found.");
  const exam = examSnapshot.data();

  if (exam.individualCodesEnabled) {
    const codeSnapshot = await db.collection("studentExamCodeHashes").doc(`${examId}_${request.auth.uid}`).get();
    if (!codeSnapshot.exists) return { hasAssignedCode: false };
    const record = codeSnapshot.data();
    return {
      hasAssignedCode: record.studentUid === request.auth.uid &&
        record.examId === examId &&
        record.status === "active" &&
        Boolean(record.codeHash),
    };
  }

  const accessSnapshot = await db.collection("examAccess").doc(examId).get();
  const access = accessSnapshot.exists ? accessSnapshot.data() : {};
  return { hasAssignedCode: Boolean(access.codeHash) };
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
