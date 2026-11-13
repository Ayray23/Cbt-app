import { backend } from "../cbt-app/server/firebase-admin.mjs";
import { examPaper, grade, safeSession } from "../server/domain.mjs";

const { db, fields } = backend();
const apply = process.argv.includes("--apply");
const [exams, sessions] = await Promise.all([db.collection("exams").get(), db.collection("examSessions").get()]);
let converted = 0;
for (const exam of exams.docs) {
  const examData = exam.data();
  if (examData.paperVersion) continue;
  const questions = await db.collection("questions").where("examId", "==", exam.id).get();
  let paper;
  try { paper = examPaper(questions.docs); }
  catch { console.log(`Exam ${exam.id}: invalid or empty question bank; republish after fixing questions.`); continue; }
  if (apply && examData.status === "published") {
    const ref = db.collection("examPapers").doc();
    const batch = db.batch();
    batch.create(ref, { examId: exam.id, questions: paper, createdAt: fields.serverTimestamp() });
    batch.update(exam.ref, { paperVersion: ref.id, schemaVersion: 2, maxMarks: grade(paper, {}).maxMarks,
      questionCount: paper.length, accessCodeHash: fields.delete(), accessCodeUpdatedAt: fields.delete() });
    batch.delete(db.doc(`examAccess/${exam.id}`));
    await batch.commit();
  }
}

for (const snapshot of sessions.docs) {
  const data = snapshot.data();
  const proofRef = db.doc(`examSessionProofs/${snapshot.id}`);
  if ((await proofRef.get()).exists) continue;
  converted++;
  const questions = await db.collection("questions").where("examId", "==", data.examId).get();
  let paper = null;
  try {
    const allowed = data.questionOrder?.length ? new Set(data.questionOrder) : null;
    paper = examPaper(questions.docs.filter((item) => !allowed || allowed.has(item.id)));
  } catch { /* Deleted historical papers cannot be reconstructed; retain the attempt for review. */ }
  if (!apply) continue;
  const resultRef = db.doc(`examResults/${snapshot.id}`);
  const existingResult = await resultRef.get();
  const batch = db.batch();
  const session = { ...safeSession(data, snapshot.id), schemaVersion: 2, legacySession: true };
  for (const field of ["startedAt", "submittedAt", "updatedAt"]) if (data[field]) session[field] = data[field];
  if (data.status === "submitted") {
    if (!existingResult.exists) batch.create(resultRef, { ...data, maxMarks: paper ? grade(paper, {}).maxMarks : null,
      requiresReview: true, legacyResult: true, submittedAt: data.submittedAt || fields.serverTimestamp() });
    session.requiresReview = true;
  } else if (paper) {
    const paperRef = db.collection("examPapers").doc();
    batch.create(paperRef, { examId: data.examId, questions: paper, createdAt: fields.serverTimestamp() });
    session.paperVersion = paperRef.id;
    session.questionOrder = data.questionOrder?.length ? data.questionOrder : paper.map((item) => item.id);
    session.startedAtMs = data.startedAtMs || data.startedAt?.toMillis() || Date.now();
    const exam = exams.docs.find((item) => item.id === data.examId)?.data();
    session.expiresAtMs = data.expiresAtMs || session.startedAtMs + Number(exam?.duration || 0) * 60000;
  }
  batch.set(snapshot.ref, session);
  batch.create(proofRef, { studentUid: session.studentUid, paperVersion: session.paperVersion || null,
    legacySession: true, createdAt: fields.serverTimestamp() });
  await batch.commit();
}
console.log(`${apply ? "Migrated" : "Would migrate"} ${converted} legacy session(s). Existing accounts and completed attempts are retained.`);
if (!apply) console.log("Dry run only. After backing up Firestore, run npm run migrate:secure -- --apply during a maintenance window.");
