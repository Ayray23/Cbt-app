import { assert, documentId } from "./domain.mjs";

const RELATED_COLLECTIONS = [
  "examAssignments",
  "examPins",
  "examSessions",
  "examSessionProofs",
  "examResults",
];

// This action is never exposed as a client-side Firestore write.
// The authenticated API must verify superadmin identity before calling it.
export async function deleteSelectedStudents({ db, auth, fields, now = Date.now }, user, input = {}) {
  assert(user?.role === "superadmin", 403,
    "Only the superadmin may permanently delete student accounts.");
  assert(Array.isArray(input.studentIds) && input.studentIds.length > 0 &&
    input.studentIds.length <= 20, 400, "Select between 1 and 20 students at a time.");
  const ids = [...new Set(input.studentIds.map(documentId))];
  assert(ids.length === input.studentIds.length && !ids.includes(user.uid), 400,
    "Choose unique student accounts; your own account cannot be deleted.");
  assert(input.confirmation === "DELETE SELECTED STUDENTS", 400,
    "Type DELETE SELECTED STUDENTS to confirm.");

  const profiles = await db.getAll(...ids.map((uid) => db.doc(`users/${uid}`)));
  assert(profiles.every((profile) => profile.exists && profile.data().role === "student"),
    409, "Some selected accounts no longer exist or are not students. Refresh the list.");

  // An offline LAN export can contain completed but unsynced attempts.
  const grants = await db.collection("lanGrants").where("revoked", "==", false).limit(1).get();
  assert(grants.empty, 409,
    "An active LAN grant exists. Reconcile or revoke LAN exams before removing students.");

  // Preflight *every* student before any deletion occurs.
  for (const uid of ids) {
    const sessions = await db.collection("examSessions")
      .where("studentUid", "==", uid)
      .where("status", "in", ["started", "lan-reserved"]).limit(1).get();
    assert(sessions.empty, 409,
      "A selected student has an active exam or pending LAN reservation. Resolve it first.");
  }

  await db.collection("auditLogs").doc().create({
    actorUid: user.uid,
    workspaceUid: user.uid,
    action: "students.deleteSelected.started",
    target: "students",
    details: { studentIds: ids },
    createdAt: fields.serverTimestamp(),
    createdAtMs: now(),
  });

  const completed = [];
  for (const uid of ids) {
    // Remove Firebase Authentication identity before Firestore user profile, so
    // any failure leaves an identifiable profile for a repeatable cleanup.
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }

    // Delete ALL matching linked records, not just current UI page.
    // Reading the first page repeatedly prevents skipped documents.
    const removed = {};
    for (const name of RELATED_COLLECTIONS) {
      let count = 0;
      while (true) {
        const page = await db.collection(name).where("studentUid", "==", uid).limit(150).get();
        if (page.empty) break;
        const batch = db.batch();
        for (const doc of page.docs) batch.delete(doc.ref);
        await batch.commit();
        count += page.docs.length;
      }
      removed[name] = count;
    }
    const batch = db.batch();
    batch.delete(db.doc(`users/${uid}`));
    await batch.commit();
    completed.push(uid);

    await db.collection("auditLogs").doc().create({
      actorUid: user.uid,
      workspaceUid: user.uid,
      action: "students.deleteSelected",
      target: uid,
      details: { removed },
      createdAt: fields.serverTimestamp(),
      createdAtMs: now(),
    });
  }
  return { ok: true, deletedStudents: completed.length };
}
