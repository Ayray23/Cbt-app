import test from "node:test";
import assert from "node:assert/strict";
import { fakeBackend } from "./support.mjs";
import { createService } from "../server/service.mjs";

const owner = { uid: "owner", role: "superadmin" };
const fixture = () => {
  const backend = fakeBackend({
    "users/owner": owner,
    "users/student": { role: "student" },
    "exams/math": { status: "published", title: "Math", paperVersion: "paper" },
    "examPapers/paper": { questions: [{ correctAnswer: "A" }] },
    "examResults/math_student": { finalScore: 12, studentUid: "student", released: true },
    "examResults/english_student": { finalScore: 7, studentUid: "student", released: false },
    "examSessions/math_student": { status: "submitted" },
  });
  return { ...backend, service: createService(backend) };
};

test("only a superadmin can delete all results", async () => {
  const { service, records } = fixture();
  for (const role of ["student", "admin", "teacher", "invigilator"]) {
    await assert.rejects(
      service.execute({ uid: role, role }, "results.deleteAll", {
        confirmation: "DELETE ALL RESULTS",
      }),
      { status: 403 },
    );
  }
  assert(records.has("examResults/math_student"));
});

test("result deletion requires exact typed confirmation", async () => {
  const { service, records } = fixture();
  await assert.rejects(
    service.execute(owner, "results.deleteAll", { confirmation: "DELETE ALL" }),
    { status: 400 },
  );
  assert(records.has("examResults/math_student"));
});

test("active attempts and unrevoked LAN grants block result deletion", async () => {
  const { service, records } = fixture();
  records.set("examSessions/active_student", { status: "started" });
  await assert.rejects(
    service.execute(owner, "results.deleteAll", { confirmation: "DELETE ALL RESULTS" }),
    { status: 409 },
  );
  records.delete("examSessions/active_student");
  records.set("lanGrants/pending", { revoked: false, examId: "math" });
  await assert.rejects(
    service.execute(owner, "results.deleteAll", { confirmation: "DELETE ALL RESULTS" }),
    { status: 409 },
  );
  assert(records.has("examResults/english_student"));
});

test("deletes all stored results without altering users, sessions, exam papers or audit history", async () => {
  const { service, records } = fixture();
  const result = await service.execute(owner, "results.deleteAll", {
    confirmation: "DELETE ALL RESULTS",
  });
  assert.equal(result.deletedResults, 2);
  assert(!records.has("examResults/math_student"));
  assert(!records.has("examResults/english_student"));
  assert(records.has("users/owner"));
  assert(records.has("users/student"));
  assert.equal(records.get("examSessions/math_student").status, "submitted");
  assert(records.has("exams/math"));
  assert(records.has("examPapers/paper"));
  assert([...records.values()].some((entry) => entry.action === "results.deleteAll"));
  const again = await service.execute(owner, "results.deleteAll", {
    confirmation: "DELETE ALL RESULTS",
  });
  assert.equal(again.deletedResults, 0);
});
