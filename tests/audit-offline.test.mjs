import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../server/service.mjs";
import { fakeBackend, memoryStorage } from "./support.mjs";
import { createExamStore } from "../cbt-app/src/services/examStore.js";
import { parseQuestionText } from "../cbt-app/src/utils/questionImport.js";
const owner = { uid: "owner", role: "superadmin" };
const teacher = {
  uid: "t",
  role: "teacher_admin",
  assignedClasses: ["JSS1"],
  assignedSubjects: ["Math"],
};
const question = {
  question: "2+2",
  options: { A: "4", B: "3", C: "2", D: "1" },
  correctAnswer: "A",
  marks: 2,
};
function setup() {
  const backend = fakeBackend({
    "school/settings": { classes: ["JSS1"], subjects: ["Math"] },
    "exams/math": {
      createdBy: "t",
      status: "draft",
      title: "Math",
      duration: 10,
      className: "JSS1",
      subject: "Math",
      academicSession: "2026/2027",
      term: "First",
      questionCount: 0,
    },
    "users/a": {
      role: "student",
      displayName: "A",
      username: "a",
      className: "JSS1",
      subject: "Math",
      subjects: ["Math"],
      academicSession: "2026/2027",
    },
  });
  return {
    ...backend,
    service: createService({ ...backend, now: () => 1000 }),
  };
}
test("question creation retries preserve one record and accurate counts; edits and draft changes are audited", async () => {
  const b = setup();
  const input = { ...question, examId: "math", requestId: "q" };
  await b.service.execute(teacher, "questions.create", input);
  await b.service.execute(teacher, "questions.create", input);
  assert.equal(b.records.get("exams/math").questionCount, 1);
  await b.service.execute(teacher, "questions.update", {
    ...question,
    question: "Changed",
    questionId: "q",
  });
  assert.equal(b.records.get("questions/q").text, "Changed");
  await b.service.execute(owner, "exams.publish", { examId: "math" });
  await assert.rejects(
    b.service.execute(teacher, "questions.update", {
      ...question,
      questionId: "q",
    }),
    { status: 409 },
  );
  await b.service.execute(owner, "exams.draft", { examId: "math" });
  await b.service.execute(teacher, "questions.delete", { questionId: "q" });
  assert.equal(b.records.get("exams/math").questionCount, 0);
  assert(
    [...b.records.values()].some(
      (v) => v.action === "exams.draft" && v.workspaceUid === "t",
    ),
  );
});
test("abandoned attempt finalization uses saved answers, holds review and survives a late client submission", async () => {
  const b = setup();
  await b.service.execute(teacher, "questions.create", {
    ...question,
    examId: "math",
    requestId: "q",
  });
  await b.service.execute(owner, "exams.publish", { examId: "math" });
  const student = { uid: "a", ...b.records.get("users/a") };
  const { pins } = await b.service.execute(owner, "exams.assign", {
    examId: "math",
    studentIds: ["a"],
  });
  await b.service.execute(student, "exam.start", {
    examId: "math",
    pin: pins[0].pin,
    deviceId: "one",
  });
  await b.service.execute(student, "exam.progress", {
    examId: "math",
    deviceId: "one",
    revision: 1,
    answers: { q: "A" },
  });
  await b.service.execute(owner, "sessions.finalize", {
    sessionId: "math_a",
    reason: "Computer destroyed",
  });
  await b.service.execute(student, "exam.submit", {
    examId: "math",
    deviceId: "one",
    answers: { q: "B" },
  });
  assert.equal(b.records.get("examResults/math_a").finalScore, 2);
  assert.equal(b.records.get("examResults/math_a").requiresReview, true);
  await assert.rejects(
    b.service.execute(owner, "results.manage", {
      resultId: "math_a",
      operation: "release",
      reason: "Publish results",
    }),
    { status: 409 },
  );
});
test("LAN reservations exclude cloud attempts and grant-bound synchronization marks on the server exactly once", async () => {
  const b = setup();
  await b.service.execute(teacher, "questions.create", {
    ...question,
    examId: "math",
    requestId: "q",
  });
  await b.service.execute(owner, "exams.publish", { examId: "math" });
  await assert.rejects(
    b.service.execute(teacher, "lan.export", {
      examId: "math",
      studentIds: ["a"],
    }),
    { status: 403 },
  );
  const bundle = await b.service.execute(owner, "lan.export", {
    examId: "math",
    studentIds: ["a"],
    requestId: "grant",
  });
  assert.equal(bundle.questions[0].correctAnswer, undefined);
  assert.deepEqual(
    await b.service.execute(owner, "lan.export", {
      examId: "math",
      studentIds: ["a"],
      requestId: "grant",
    }),
    bundle,
  );
  const student = { uid: "a", ...b.records.get("users/a") };
  await assert.rejects(
    b.service.execute(student, "exam.start", {
      examId: "math",
      deviceId: "one",
    }),
    { status: 409 },
  );
  const input = {
    grantId: bundle.grantId,
    records: [
      {
        uid: "a",
        answers: { q: "A" },
        startedAtMs: 1000,
        submittedAtMs: 2000,
        finalScore: 999,
      },
    ],
  };
  await assert.rejects(b.service.syncLan("x".repeat(64), input), {
    status: 401,
  });
  await assert.rejects(
    b.service.syncLan(bundle.secret, {
      ...input,
      records: [{ ...input.records[0], uid: "other" }],
    }),
    { status: 403 },
  );
  await b.service.syncLan(bundle.secret, input);
  await b.service.syncLan(bundle.secret, input);
  assert.equal(b.records.get("examResults/math_a").finalScore, 2);
  assert.equal(b.records.get("examResults/math_a").requiresReview, true);
  await assert.rejects(
    b.service.syncLan(bundle.secret, {
      ...input,
      records: [{ ...input.records[0], answers: { q: "B" } }],
    }),
    { status: 409 },
  );
});
test("extra time survives offline packet reload and one damaged packet does not block healthy queues", () => {
  const storage = memoryStorage();
  const store = createExamStore(storage);
  store.putPacket("a", "math", {
    session: { examId: "math", studentUid: "a", expiresAtMs: 10 },
    questions: [],
  });
  store.deadline("a", "math", 30);
  assert.equal(
    createExamStore(storage).read("a", "math").session.expiresAtMs,
    30,
  );
  storage.setItem("cbt_exam_v2:a:broken", "{");
  assert.equal(store.list("a").length, 1);
});
test("DOCX text parser retains passages and option continuation lines", () => {
  const [q] = parseQuestionText(
    "1. Read the passage\nThe river flows south.\nWhich direction?\nA. South\nTowards the sea\nB. North\nC. East\nD. West\nAnswer: A\nMarks: 2",
    "exam",
  );
  assert.match(q.question, /river flows south/);
  assert.equal(q.options.A, "South\nTowards the sea");
  assert.equal(q.marks, 2);
});
