import { assert } from "./domain.mjs";

// Removes the question bank AND the published answer-key snapshots.
// Server-side authorization is mandatory; hiding the button is not enough.
export async function clearQuestionBank({ db, fields, now = Date.now }, user, input = {}) {
  assert(user?.role === "superadmin", 403, "Only the superadmin can delete all questions.");
  assert(input.confirmation === "DELETE ALL QUESTIONS", 400,
    "Type DELETE ALL QUESTIONS to confirm this permanent action.");

  const active = await db.collection("examSessions").where("status", "in",
    ["started", "lan-reserved"]).limit(1).get();
  assert(active.empty, 409,
    "An exam attempt is active or reserved. Resolve it before deleting questions.");
  // Offline LAN grants can submit later even when no online session has started.
  const grants = await db.collection("lanGrants").where("revoked", "==", false).limit(1).get();
  assert(grants.empty, 409,
    "LAN exam grants exist. Revoke or resolve them before clearing question papers.");

  // Published papers are immutable snapshots; drop them too so no answer keys remain.
  // The operation intentionally retains results, users and audit history.
  const exams = await db.collection("exams").get();
  const existingQuestions = await db.collection("questions").limit(1).get();
  const existingPapers = await db.collection("examPapers").limit(1).get();
  if (existingQuestions.empty && existingPapers.empty) return { ok: true, deletedQuestions: 0, deletedPaperVersions: 0 };

  const audit = db.collection("auditLogs").doc();
  await audit.create({
    actorUid: user.uid,
    workspaceUid: user.uid,
    action: "questions.deleteAll.started",
    target: "questions",
    details: { examCount: exams.docs.length },
    createdAt: fields.serverTimestamp(),
    createdAtMs: now(),
  });

  let deletedQuestions = 0;
  let deletedPaperVersions = 0;
  for (const [collectionName, countKey] of [["questions", "questions"], ["examPapers", "papers"]]) {
    const collection = db.collection(collectionName);
    while (true) {
      const page = await collection.limit(200).get();
      if (page.empty) break;
      const batch = db.batch();
      for (const item of page.docs) batch.delete(item.ref);
      await batch.commit();
      if (countKey === "questions") deletedQuestions += page.docs.length;
      else deletedPaperVersions += page.docs.length;
    }
  }

  // Keep exam records but ensure no empty paper can remain published.
  for (let i = 0; i < exams.docs.length; i += 200) {
    const batch = db.batch();
    for (const exam of exams.docs.slice(i, i + 200)) {
      batch.update(exam.ref, {
        status: "draft",
        questionCount: 0,
        maxMarks: 0,
        paperVersion: fields.delete(),
        publishedAt: fields.delete(),
        updatedAt: fields.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  await db.collection("auditLogs").doc().create({
    actorUid: user.uid,
    workspaceUid: user.uid,
    action: "questions.deleteAll",
    target: "questions",
    details: { deletedQuestions, deletedPaperVersions },
    createdAt: fields.serverTimestamp(),
    createdAtMs: now(),
  });
  return { ok: true, deletedQuestions, deletedPaperVersions };
}
