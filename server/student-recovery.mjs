import {
  assert, admissionAuthUsername, schoolAdmissionNumber, documentId, usernameEmail,
} from "./domain.mjs";

// Exam-day recovery for a student whose Firebase Authentication account exists,
// but whose Firestore profile was lost. Never create new Auth users, upgrade
// roles, overwrite an existing profile, or infer access from an email alone.
export async function repairMissingStudentProfile({ db, auth, fields }, actor, input) {
  assert(actor?.role === "superadmin", 403, "Only superadmin may recover a missing student profile.");
  const uid = documentId(input.studentUid);
  const admissionNumber = schoolAdmissionNumber(input.admissionNumber);
  const displayName = String(input.displayName || "").trim();
  const className = String(input.className || "").trim();
  const academicSession = String(input.academicSession || "").trim();
  const subjects = Array.isArray(input.subjects) ? [...new Set(input.subjects.map(String))] : [];
  const email = String(input.email || "").trim().toLowerCase();
  assert(displayName.length >= 2 && displayName.length <= 120, 400, "Enter the student's full name.");
  assert(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, "Enter a valid optional contact email.");
  const school = await db.doc("school/settings").get();
  assert(school.exists, 409, "Configure the school before repairing student access.");
  const settings = school.data();
  assert(settings.academicSession === academicSession &&
    settings.classes.includes(className) &&
    subjects.length > 0 && subjects.every((subject) => settings.subjects.includes(subject)),
    400, "Choose the configured academic session, class and enrolled subjects.");

  let account;
  try { account = await auth.getUser(uid); }
  catch (error) {
    assert(error.code !== "auth/user-not-found", 404, "No Firebase Authentication account exists for that UID.");
    throw error;
  }
  const expectedEmail = usernameEmail(admissionAuthUsername(admissionNumber));
  assert(account.email?.toLowerCase() === expectedEmail, 409,
    "That UID does not match the supplied admission number. No profile was created.");

  const existingAdmission = await db.collection("users")
    .where("admissionNumber", "==", admissionNumber).limit(1).get();
  assert(existingAdmission.empty, 409, "That admission number already belongs to another profile.");

  const ref = db.doc(`users/${uid}`);
  const existing = await ref.get();
  assert(!existing.exists, 409, "An account profile already exists. Recovery will not overwrite it.");

  await ref.create({
    role: "student",
    displayName,
    admissionNumber,
    username: admissionNumber,
    email,
    className,
    academicSession,
    subjects,
    loginIdType: "admission",
    loginDisabled: false,
    createdBy: actor.uid,
    recoveredBy: actor.uid,
    recoveredAt: fields.serverTimestamp(),
    schemaVersion: 2,
  });
  await db.collection("auditLogs").doc().create({
    action: "students.repairProfile",
    actorUid: actor.uid,
    workspaceUid: actor.uid,
    target: uid,
    details: { admissionNumber },
    createdAt: fields.serverTimestamp(),
  });
  return { ok: true, uid };
}
