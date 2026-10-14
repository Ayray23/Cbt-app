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
  const role = profile?.role || "student";
  if (!allowedRoles.includes(role)) {
    throw new HttpsError("permission-denied", "You do not have access to this action.");
  }
  return profile;
}

// Exam start/submission live in one dedicated security module so there is only
// one authoritative implementation for code validation, session creation and grading.
const examSecurity = require("./examSecurity");
exports.startExamSession = examSecurity.startExamSession;
exports.submitExamSession = examSecurity.submitExamSession;

exports.setUserRole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  await requireRole(request.auth.uid, ["superadmin"]);

  const email = String(request.data?.email || "").trim().toLowerCase();
  const role = String(request.data?.role || "").trim().toLowerCase();
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
