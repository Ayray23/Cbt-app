import test from "node:test";
import assert from "node:assert/strict";
import { COLLECTIONS, toShadowRow, validateShadowSnapshot, stage2Sql } from "../scripts/cbt-stage2-mapping.mjs";

function snapshot() {
  return {
    users: [{ id: "user-1", data: { role: "student", displayName: "Test 'Student", email: "fake@example.invalid" } }],
    exams: [{ id: "exam-1", data: { title: "English", status: "published", duration: 60, paperVersion: "v1" } }],
    questions: [{ id: "q-1", data: { examId: "exam-1", correctAnswer: "B", options: ["A", "B"] } }],
    examPapers: [{ id: "v1", data: { examId: "exam-1", questions: [{ id: "q-1", correctAnswer: "B" }] } }],
    examAssignments: [{ id: "exam-1_user-1", data: { examId: "exam-1", studentUid: "user-1" } }],
    examSessions: [{ id: "exam-1_user-1", data: { examId: "exam-1", studentUid: "user-1", status: "submitted", startedAtMs: 20, expiresAtMs: 3600020 } }],
    examResults: [{ id: "exam-1_user-1", data: { examId: "exam-1", studentUid: "user-1", finalScore: 1, maxMarks: 1, released: false } }],
    examPins: [{ id: "exam-1_user-1", data: { examId: "exam-1", studentUid: "user-1", digest: "redacted-hash", pinTag: "masked-tag" } }],
    examSessionProofs: [{ id: "exam-1_user-1", data: { studentUid: "user-1", paperVersion: "v1" } }],
    auditLogs: [{ id: "event-1", data: { action: "exams.assign", actorUid: "admin-1", target: "exam-1", createdAtMs: 1000 } }],
    school: [{ id: "settings", data: { academicSession: "2026/2027", classes: ["SS1"] } }],
  };
}
test("stage2 maps all seven Firebase collections using original IDs and answers", () => {
  const data = snapshot();
  const rows = validateShadowSnapshot(data);
  assert.equal(rows.size, COLLECTIONS.length);
  assert.equal(rows.get("users")[0].firebase_uid, "user-1");
  assert.equal(rows.get("exam_papers"), undefined);
  assert.equal(rows.get("examPapers")[0].paper_document.questions[0].correctAnswer, "B");
  assert.equal(rows.get("examResults")[0].released, false);
  const sql = stage2Sql(data);
  for (const [, table] of COLLECTIONS) assert(sql.includes(`insert into cbt_shadow.${table}`));
  assert(sql.includes("Test ''Student"));
  assert(sql.includes("on conflict"));
  assert(sql.includes("commit;"));
});
test("stage2 aborts on started or otherwise incomplete exam sessions", () => {
  const data = snapshot();
  data.examSessions[0].data.status = "started";
  assert.throws(() => validateShadowSnapshot(data), /started exam session/);
  data.examSessions[0].data.status = "lan-reserved";
  assert.throws(() => validateShadowSnapshot(data), /non-submitted session/);
});
test("stage2 rejects missing exams and duplicate students before any SQL writes", () => {
  const data = snapshot();
  data.questions[0].data.examId = "nonexistent";
  assert.throws(() => stage2Sql(data), /Missing parent exam/);
  data.questions[0].data.examId = "exam-1";
  data.examResults.push({ id: "another-result", data: { examId: "exam-1", studentUid: "user-1" } });
  assert.throws(() => stage2Sql(data), /Duplicate exam\/student pair/);
});
test("stage2 snapshots may contain no records but cannot be missing a required collection", () => {
  const empty = Object.fromEntries(COLLECTIONS.map(([name]) => [name, []]));
  assert.equal(validateShadowSnapshot(empty).size, COLLECTIONS.length);
  delete empty.examPapers;
  assert.throws(() => validateShadowSnapshot(empty), /Missing snapshot collection/);
});
test("stage2 values cannot inject SQL statements and use a single transaction", () => {
  const data = snapshot();
  data.users[0].data.displayName = "Robert'); DROP TABLE users; --";
  const sql = stage2Sql(data);
  assert(sql.includes("Robert''); DROP TABLE users; --"));
  assert.match(sql, /\bbegin;/);
  assert.match(sql, /\bcommit;/);
  assert.match(sql, /standard_conforming_strings = on/);
});

test("stage2 preserves secret PIN digest, proof version and school settings without exposing public access", () => {
  const rows = validateShadowSnapshot(snapshot());
  assert.equal(rows.get("examPins")[0].pin_digest, "redacted-hash");
  assert.equal(rows.get("examSessionProofs")[0].exam_id, "exam-1");
  assert.equal(rows.get("school")[0].firebase_id, "settings");
  const invalid = snapshot();
  invalid.examSessionProofs[0].data.paperVersion = "unknown";
  assert.throws(() => stage2Sql(invalid), /unknown paper version/);
});
