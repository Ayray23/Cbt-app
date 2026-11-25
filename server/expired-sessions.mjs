import { assert, cleanAnswers, documentId, grade, safeSession } from "./domain.mjs";

// Finalize an expired online attempt using only the last server-persisted answers.
// Never trust a student-supplied clock or accept newly supplied answers here.
export async function finalizeExpiredSession({ db, fields, now = Date.now }, id) {
  documentId(id);
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`examSessions/${id}`);
    const row = await tx.get(ref);
    if (!row.exists) return { status: "missing" };
    const session = row.data();
    if (session.status === "submitted") return { status: "already-submitted" };
    if (session.status !== "started" || session.lanGrantId || session.schemaVersion !== 2) {
      return { status: "unsupported" };
    }
    if (!Number.isFinite(session.expiresAtMs) || now() < session.expiresAtMs) {
      return { status: "not-expired" };
    }
    const proof = await tx.get(db.doc(`examSessionProofs/${id}`));
    assert(proof.exists && proof.data().studentUid === session.studentUid &&
      proof.data().paperVersion === session.paperVersion,
    409, "Expired attempt requires administrator review: session proof mismatch.");
    const paper = await tx.get(db.doc(`examPapers/${session.paperVersion}`));
    assert(paper.exists, 409, "Expired attempt requires administrator review: paper unavailable.");
    const resultRef = db.doc(`examResults/${id}`);
    const prior = await tx.get(resultRef);
    assert(!prior.exists, 409, "A result already exists for this attempt; administrator review required.");
    const answers = cleanAnswers(session.answers || {}, paper.data().questions);
    const marks = grade(paper.data().questions, answers);
    const closed = {
      answers,
      status: "submitted",
      submissionReason: "timeout",
      submittedAtMs: now(),
      submittedAt: fields.serverTimestamp(),
      updatedAt: fields.serverTimestamp(),
      // An offline device could hold newer answers; keep the result
      // unreleased so staff can review any later recovery evidence.
      requiresReview: true,
      automaticFinalizationSource: "last-server-saved-answers",
      lastActivityAtMs: now(),
    };
    tx.update(ref, closed);
    tx.create(resultRef, {
      ...safeSession(session, id),
      ...closed,
      ...marks,
      totalAutoScore: marks.finalScore,
      released: false,
      schemaVersion: 2,
    });
    return { status: "submitted", finalScore: marks.finalScore };
  });
}

export async function finalizeExpiredForMonitoring(deps, user, input = {}) {
  assert(["superadmin", "admin", "invigilator"].includes(user?.role), 403,
    "Monitoring staff access required.");
  assert(Array.isArray(input.sessionIds) && input.sessionIds.length >= 1 &&
    input.sessionIds.length <= 5, 400, "Provide 1-5 expired session IDs.");
  const ids = [...new Set(input.sessionIds.map(documentId))];
  const results = [];
  for (const id of ids) {
    try {
      const result = await finalizeExpiredSession(deps, id);
      results.push({ id, ...result });
    } catch (error) {
      // One corrupt or legacy record cannot prevent other students from
      // receiving their automatically finalized results.
      results.push({
        id,
        status: "needs-review",
        message: error.status ? error.message : "Server could not finalize this attempt.",
      });
    }
  }
  return { ok: true, results };
}
