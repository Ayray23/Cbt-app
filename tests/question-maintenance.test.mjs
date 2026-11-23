import test from "node:test";
import assert from "node:assert/strict";
import { fakeBackend } from "./support.mjs";
import { createService } from "../server/service.mjs";

const owner = { uid: "owner", role: "superadmin" };
const fixture = () => {
  const backend = fakeBackend({
    "users/owner": owner,
    "users/student": { role: "student" },
    "exams/math": { title: "Math", status: "published", questionCount: 2, paperVersion: "version-1", maxMarks: 2 },
    "questions/first": { examId: "math", text: "First" },
    "questions/second": { examId: "math", text: "Second" },
    "examPapers/version-1": { examId: "math", questions: [{ text: "First", correctAnswer: "A" }] },
    "examResults/past": { finalScore: 2 },
  });
  return { ...backend, service: createService(backend) };
};

test("bulk deletion is refused to students, admins and teachers", async () => {
  const { service, records } = fixture();
  for (const role of ["student", "admin", "teacher", "invigilator"]) {
    await assert.rejects(service.execute({ uid: role, role }, "questions.deleteAll", {
      confirmation: "DELETE ALL QUESTIONS",
    }), { status: 403 });
  }
  assert(records.has("questions/first"));
  assert(records.has("examPapers/version-1"));
});

test("bulk deletion requires exact typed confirmation", async () => {
  const { service, records } = fixture();
  await assert.rejects(service.execute(owner, "questions.deleteAll", {
    confirmation: "delete all questions",
  }), { status: 400 });
  assert(records.has("questions/first"));
});

test("active exam sessions and LAN grants prevent bulk deletion", async () => {
  const { service, records } = fixture();
  records.set("examSessions/math_student", { status: "started" });
  await assert.rejects(service.execute(owner, "questions.deleteAll", { confirmation: "DELETE ALL QUESTIONS" }), { status: 409 });
  records.delete("examSessions/math_student");
  records.set("lanGrants/grant-one", { examId: "math", revoked: false });
  await assert.rejects(service.execute(owner, "questions.deleteAll", { confirmation: "DELETE ALL QUESTIONS" }), { status: 409 });
  assert(records.has("questions/second"));
});

test("bulk deletion removes bank and published snapshots but keeps users and results", async () => {
  const { service, records } = fixture();
  const response = await service.execute(owner, "questions.deleteAll", { confirmation: "DELETE ALL QUESTIONS" });
  assert.deepEqual({ deletedQuestions: response.deletedQuestions, deletedPaperVersions: response.deletedPaperVersions }, {
    deletedQuestions: 2, deletedPaperVersions: 1,
  });
  assert(!records.has("questions/first"));
  assert(!records.has("questions/second"));
  assert(!records.has("examPapers/version-1"));
  assert(records.has("users/owner"));
  assert(records.has("users/student"));
  assert(records.has("examResults/past"));
  assert.equal(records.get("exams/math").status, "draft");
  assert.equal(records.get("exams/math").questionCount, 0);
  assert([...records.values()].some(record => record.action === "questions.deleteAll"));
  const again = await service.execute(owner, "questions.deleteAll", { confirmation: "DELETE ALL QUESTIONS" });
  assert.equal(again.deletedQuestions, 0);
});
