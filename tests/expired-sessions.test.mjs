import test from "node:test";
import assert from "node:assert/strict";
import { fakeBackend } from "./support.mjs";
import { createService } from "../server/service.mjs";

const owner = { uid: "owner", role: "superadmin" };
const invigilator = { uid: "staff", role: "invigilator" };
const student = { uid: "alice", role: "student" };
const question = { id: "q1", text: "Question", options: { A: "A", B: "B", C: "C", D: "D" }, correctAnswer: "B", marks: 2 };

function setup(deadline = 1000, sessionChanges = {}) {
  const backend = fakeBackend({
    "users/owner": owner,
    "users/alice": student,
    "examSessions/math_alice": {
      examId: "math", studentUid: "alice", paperVersion: "paper-v1", status: "started",
      deviceId: "test-device", schemaVersion: 2, answers: { q1: "B" },
      expiresAtMs: deadline, startedAtMs: 0, ...sessionChanges,
    },
    "examSessionProofs/math_alice": { studentUid: "alice", paperVersion: "paper-v1" },
    "examPapers/paper-v1": { questions: [question] },
  });
  const service = createService({ ...backend, now: () => 2000 });
  return { ...backend, service };
}

test("monitoring automatically finalizes expired online attempts and grades server-saved answers", async () => {
  const { service, records } = setup();
  const response = await service.execute(invigilator, "sessions.autoFinalizeExpired", { sessionIds: ["math_alice"] });
  assert.equal(response.results[0].status, "submitted");
  assert.equal(records.get("examSessions/math_alice").status, "submitted");
  assert.equal(records.get("examSessions/math_alice").submissionReason, "timeout");
  assert.equal(records.get("examResults/math_alice").finalScore, 2);
  assert.equal(records.get("examResults/math_alice").released, false);
  assert.equal(records.get("examResults/math_alice").requiresReview, true);
  const second = await service.execute(owner, "sessions.autoFinalizeExpired", { sessionIds: ["math_alice"] });
  assert.equal(second.results[0].status, "already-submitted");
  assert.equal([...records.keys()].filter((p) => p === "examResults/math_alice").length, 1);
});

test("no auto-finalize before deadline, on LAN, or for an unsupported session", async () => {
  const future = setup(3000);
  const notYet = await future.service.execute(owner, "sessions.autoFinalizeExpired", { sessionIds: ["math_alice"] });
  assert.equal(notYet.results[0].status, "not-expired");
  assert(!future.records.has("examResults/math_alice"));
  const lan = setup(1000, { lanGrantId: "grant-one" });
  const reserved = await lan.service.execute(owner, "sessions.autoFinalizeExpired", { sessionIds: ["math_alice"] });
  assert.equal(reserved.results[0].status, "unsupported");
  assert(!lan.records.has("examResults/math_alice"));
});

test("unauthorized roles cannot auto-finalize and missing proof fails safely", async () => {
  const { service, records } = setup();
  for (const role of ["student", "teacher"]) {
    await assert.rejects(service.execute({ uid: role, role }, "sessions.autoFinalizeExpired",
      { sessionIds: ["math_alice"] }), { status: 403 });
  }
  records.delete("examSessionProofs/math_alice");
  await assert.rejects(service.execute(owner, "sessions.autoFinalizeExpired",
    { sessionIds: ["math_alice"] }), { status: 409 });
  assert.equal(records.get("examSessions/math_alice").status, "started");
  assert(!records.has("examResults/math_alice"));
});

test("late device upload after auto-finalization is retained for review without changing the awarded score", async () => {
  const { service, records } = setup();
  await service.execute(owner, "sessions.autoFinalizeExpired", { sessionIds: ["math_alice"] });
  const receipt = await service.execute(student, "exam.submit", {
    examId: "math", deviceId: "test-device", deviceEpoch: 0,
    submissionReason: "timeout", answers: { q1: "A" },
    closedAtMs: 1050, submissionId: "submission-one",
  });
  assert.equal(receipt.alreadySubmitted, true);
  assert.equal(records.get("examResults/math_alice").finalScore, 2);
  assert.deepEqual(records.get("examResults/math_alice").lateReportedAnswers, { q1: "A" });
  assert.equal(records.get("examResults/math_alice").requiresReview, true);
});
