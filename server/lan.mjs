import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import {
  assert,
  documentId,
  publicQuestions,
  cleanAnswers,
  grade,
  safeSession,
  shuffled,
} from "./domain.mjs";
import { eligible } from "./school.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function lanService({ db, fields, now = Date.now }) {
  const stamp = () => fields.serverTimestamp();
  return {
    list: async (user) => {
      assert(user.role === "superadmin", 403, "Superadmin access required.");
      const rows = await db.collection("lanGrants").limit(100).get();
      return {
        grants: rows.docs.map((d) => ({
          id: d.id,
          examId: d.data().examId,
          candidates: d.data().studentIds.length,
        })),
      };
    },
    download: async (user, input) => {
      assert(user.role === "superadmin", 403, "Superadmin access required.");
      const row = await db.doc(`lanExports/${documentId(input.grantId)}`).get();
      assert(row.exists, 404, "Bundle not found.");
      return row.data().bundle;
    },
    export: async (user, input) => {
      assert(
        user.role === "superadmin",
        403,
        "Only the superadmin can prepare LAN exams.",
      );
      const examId = documentId(input.examId);
      const grantId = input.requestId
        ? documentId(input.requestId)
        : randomUUID();
      const secret = randomBytes(32).toString("hex");
      assert(
        Array.isArray(input.studentIds) &&
          input.studentIds.length > 0 &&
          input.studentIds.length <= 100,
        400,
        "Select 1–100 students per bundle.",
      );
      const uids = [...new Set(input.studentIds.map(documentId))];
      return db.runTransaction(async (tx) => {
        const cached = await tx.get(db.doc(`lanExports/${grantId}`));
        if (cached.exists) {
          assert(
            cached.data().owner === user.uid,
            403,
            "Export belongs to another account.",
          );
          return cached.data().bundle;
        }
        const exam = await tx.get(db.doc(`exams/${examId}`));
        assert(
          exam.exists && exam.data().status === "published",
          409,
          "Publish the paper first.",
        );
        const e = exam.data();
        const paper = await tx.get(db.doc(`examPapers/${e.paperVersion}`));
        assert(paper.exists, 409, "Published paper missing.");
        const profiles = [];
        for (const uid of uids)
          profiles.push(await tx.get(db.doc(`users/${uid}`)));
        const sessions = [];
        for (const uid of uids)
          sessions.push(await tx.get(db.doc(`examSessions/${examId}_${uid}`)));
        assert(
          sessions.every((s) => !s.exists),
          409,
          "One candidate already has a cloud or LAN attempt reserved.",
        );
        assert(
          profiles.every(
            (p) =>
              p.exists && p.data().role === "student" && eligible(p.data(), e),
          ),
          400,
          "Every candidate must be active and enrolled.",
        );
        const candidates = profiles.map((p) => ({
          uid: p.id,
          name: p.data().displayName,
          username: p.data().username || p.id,
          ticket: randomBytes(18).toString("base64url"),
        }));
        const closesAtMs = e.scheduleEndAtMs || now() + 7 * 86400000;
        assert(closesAtMs > now(), 409, "Entry window has already closed.");
        tx.create(db.doc(`lanGrants/${grantId}`), {
          examId,
          paperVersion: e.paperVersion,
          secretHash: hash(secret),
          studentIds: uids,
          createdBy: user.uid,
          createdAt: stamp(),
          closesAtMs,
          revoked: false,
        });
        for (const candidate of candidates) {
          const id = `${examId}_${candidate.uid}`;
          const session = {
            ...Object.fromEntries(
              [
                "academicSession",
                "term",
                "className",
                "subject",
                "category",
                "weight",
                "allowCalculator",
                "instructions",
              ]
                .filter((k) => e[k] !== undefined)
                .map((k) => [k, e[k]]),
            ),
            schemaVersion: 2,
            examId,
            examTitle: e.title,
            studentUid: candidate.uid,
            studentName: candidate.name,
            studentUsername: candidate.username,
            paperVersion: e.paperVersion,
            lanGrantId: grantId,
            status: "lan-reserved",
            duration: e.duration,
            answers: {},
            questionOrder: shuffled(paper.data().questions.map((q) => q.id)),
            optionOrderByQuestion: Object.fromEntries(
              paper
                .data()
                .questions.map((q) => [q.id, shuffled(["A", "B", "C", "D"])]),
            ),
            scheduleStartAtMs: e.scheduleStartAtMs || 0,
            scheduleEndAtMs: closesAtMs,
          };
          tx.set(db.doc(`examAssignments/${id}`), {
            examId,
            studentUid: candidate.uid,
            examTitle: e.title,
            assignedBy: user.uid,
            assignedAt: stamp(),
            lanGrantId: grantId,
          });
          tx.create(db.doc(`examSessions/${id}`), session);
          tx.create(db.doc(`examSessionProofs/${id}`), {
            studentUid: candidate.uid,
            paperVersion: e.paperVersion,
            lanGrantId: grantId,
          });
          candidate.session = safeSession(session, id);
          candidate.duration = e.duration;
        }
        tx.create(db.collection("auditLogs").doc(), {
          actorUid: user.uid,
          workspaceUid: e.createdBy || user.uid,
          action: "lan.export",
          target: grantId,
          details: { examId, studentIds: uids },
          createdAt: stamp(),
          createdAtMs: now(),
        });
        const bundle = {
          version: 1,
          grantId,
          secret,
          examId,
          title: e.title,
          createdAtMs: now(),
          opensAtMs: e.scheduleStartAtMs || now(),
          closesAtMs,
          questions: publicQuestions(paper.data().questions),
          candidates,
        };
        assert(
          Buffer.byteLength(JSON.stringify(bundle)) < 950000,
          400,
          "Bundle is too large. Use fewer candidates or smaller diagrams.",
        );
        tx.create(db.doc(`lanExports/${grantId}`), { owner: user.uid, bundle });
        return bundle;
      });
    },
    sync: async (secret, input) => {
      const grantId = documentId(input.grantId);
      assert(
        typeof secret === "string" && secret.length === 64,
        401,
        "Invalid LAN credential.",
      );
      assert(
        Array.isArray(input.records) &&
          input.records.length > 0 &&
          input.records.length <= 10,
        400,
        "Send 1–10 final records per batch.",
      );
      const accepted = [];
      for (const record of input.records) {
        const uid = documentId(record.uid);
        const id = await db.runTransaction(async (tx) => {
          const grant = await tx.get(db.doc(`lanGrants/${grantId}`));
          assert(
            grant.exists && !grant.data().revoked,
            403,
            "LAN grant is unavailable.",
          );
          const g = grant.data();
          const actual = Buffer.from(hash(secret), "hex"),
            expected = Buffer.from(g.secretHash, "hex");
          assert(
            expected.length === actual.length &&
              timingSafeEqual(actual, expected),
            401,
            "Invalid LAN credential.",
          );
          assert(
            g.studentIds.includes(uid),
            403,
            "Candidate is outside this LAN grant.",
          );
          const id = `${g.examId}_${uid}`,
            ref = db.doc(`examSessions/${id}`);
          const sessionRow = await tx.get(ref);
          const resultRef = db.doc(`examResults/${id}`);
          const result = await tx.get(resultRef);
          assert(
            sessionRow.exists && sessionRow.data().lanGrantId === grantId,
            409,
            "LAN reservation mismatch.",
          );
          const session = sessionRow.data();
          const paper = await tx.get(db.doc(`examPapers/${g.paperVersion}`));
          assert(paper.exists, 409, "Answer key unavailable.");
          const answers = cleanAnswers(record.answers, paper.data().questions);
          const digest = hash(
            JSON.stringify({
              answers,
              startedAtMs: record.startedAtMs,
              submittedAtMs: record.submittedAtMs,
            }),
          );
          if (result.exists) {
            assert(
              result.data().lanDigest === digest,
              409,
              "Conflicting final submission. Existing result preserved.",
            );
            return id;
          }
          assert(
            Number.isSafeInteger(record.startedAtMs) &&
              Number.isSafeInteger(record.submittedAtMs) &&
              record.startedAtMs >= session.scheduleStartAtMs &&
              record.startedAtMs < g.closesAtMs &&
              record.submittedAtMs >= record.startedAtMs,
            400,
            "Invalid LAN timing.",
          );
          const closed = {
            status: "submitted",
            answers,
            startedAtMs: record.startedAtMs,
            expiresAtMs: record.startedAtMs + session.duration * 60000,
            submittedAtMs: record.submittedAtMs,
            submissionReason: "lan-sync",
            requiresReview: true,
            lanDigest: digest,
            syncedAt: stamp(),
            updatedAt: stamp(),
          };
          tx.update(ref, closed);
          tx.create(resultRef, {
            ...safeSession(session, id),
            ...closed,
            ...grade(paper.data().questions, answers),
            released: false,
            lanGrantId: grantId,
          });
          tx.create(db.collection("auditLogs").doc(), {
            actorUid: g.createdBy,
            action: "lan.sync",
            target: id,
            details: { grantId },
            createdAt: stamp(),
            createdAtMs: now(),
          });
          return id;
        });
        accepted.push(id);
      }
      return { accepted };
    },
  };
}
