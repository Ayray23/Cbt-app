import { assert } from "./domain.mjs";

// Deletes scored results only. Exam attempts, student accounts, and papers remain intact.
export async function clearAllResults({ db, fields, now = Date.now }, user, input = {}) {
  assert(user?.role === "superadmin", 403, "Only the superadmin can delete all results.");
  assert(input.confirmation === "DELETE ALL RESULTS", 400,
    "Type DELETE ALL RESULTS to confirm permanent deletion.");

  const active = await db.collection("examSessions")
    .where("status", "in", ["started", "lan-reserved"]).limit(1).get();
  assert(active.empty, 409,
    "Finish active or LAN-reserved exam attempts before deleting results.");

  const pendingLan = await db.collection("lanGrants")
    .where("revoked", "==", false).limit(1).get();
  assert(pendingLan.empty, 409,
    "Resolve or revoke LAN grants before deleting results.");

  const results = db.collection("examResults");
  const firstPage = await results.limit(1).get();
  if (firstPage.empty) return { ok: true, deletedResults: 0 };

  await db.collection("auditLogs").doc().create({
    actorUid: user.uid,
    workspaceUid: user.uid,
    action: "results.deleteAll.started",
    target: "examResults",
    createdAt: fields.serverTimestamp(),
    createdAtMs: now(),
  });

  let deletedResults = 0;
  while (true) {
    // Always read from the beginning: deleted docs must not shift a cursor.
    const page = await results.limit(200).get();
    if (page.empty) break;
    const batch = db.batch();
    for (const result of page.docs) batch.delete(result.ref);
    await batch.commit();
    deletedResults += page.docs.length;
  }

  await db.collection("auditLogs").doc().create({
    actorUid: user.uid,
    workspaceUid: user.uid,
    action: "results.deleteAll",
    target: "examResults",
    details: { deletedResults },
    createdAt: fields.serverTimestamp(),
    createdAtMs: now(),
  });

  return { ok: true, deletedResults };
}
