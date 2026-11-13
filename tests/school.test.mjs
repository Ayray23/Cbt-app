import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../server/service.mjs";
import { fakeBackend } from "./support.mjs";
import { schoolFields, eligible } from "../server/school.mjs";
import { parseCsv, csvText } from "../cbt-app/src/utils/csv.js";
import { subjectTotals } from "../cbt-app/src/utils/results.js";
const owner = { uid: "owner", role: "admin" };
const fields = {
  academicSession: "2026/2027",
  term: "First",
  className: "JSS1 A",
  subject: "Mathematics",
  category: "exam",
  weight: 60,
};
const student = {
  uid: "alice",
  role: "student",
  displayName: "Alice",
  className: "JSS1 A",
  academicSession: "2026/2027",
  subjects: ["Mathematics"],
};
async function setup() {
  const backend = fakeBackend({
    "users/alice": student,
    "school/settings": {
      name: "School",
      classes: ["JSS1 A", "JSS2 A"],
      subjects: ["Mathematics"],
      academicSession: "2026/2027",
      term: "First",
    },
    "exams/math": { ...fields, title: "Math", duration: 10, status: "draft" },
    "questions/q": {
      examId: "math",
      text: "2+2",
      options: { A: "1", B: "4", C: "3", D: "5" },
      correctAnswer: "B",
      marks: 2,
    },
  });
  const service = createService({ ...backend, now: () => 100000 });
  await service.execute(owner, "exams.publish", { examId: "math" });
  const { pins } = await service.execute(owner, "exams.assign", {
    examId: "math",
    studentIds: ["alice"],
  });
  return { ...backend, service, pin: pins[0].pin };
}
test("school sessions, enrolments and weights are validated", () => {
  assert.equal(schoolFields(fields).weight, 60);
  assert.throws(() =>
    schoolFields({ ...fields, academicSession: "2026/2029" }),
  );
  assert.throws(() => schoolFields({ ...fields, weight: -5 }));
  assert(eligible(student, fields));
  assert(!eligible({ ...student, subjects: [] }, fields));
  assert(!eligible({ ...student, loginDisabled: true }, fields));
});
test("school student creation validates enrolment before provisioning", async () => {
  const { service } = await setup();
  await assert.rejects(
    service.execute(owner, "students.create", {
      username: "new-student",
      displayName: "New Student",
      password: "password123",
      className: "unknown",
    }),
    { status: 400 },
  );
});
test("schedule and device controls cannot be bypassed by omitting device ID", async () => {
  const { service, records, pin } = await setup();
  await assert.rejects(
    service.execute(student, "exam.start", { examId: "math", pin }),
    { status: 400 },
  );
  records.set("exams/math", {
    ...records.get("exams/math"),
    scheduleStartAtMs: 200000,
  });
  await assert.rejects(
    service.execute(student, "exam.start", {
      examId: "math",
      pin,
      deviceId: "one",
    }),
    { status: 409 },
  );
});
test("stale saves, transfer and extra time preserve authoritative attempt state", async () => {
  const { service, pin, records } = await setup();
  await service.execute(student, "exam.start", {
    examId: "math",
    pin,
    deviceId: "one",
  });
  await service.execute(student, "exam.progress", {
    examId: "math",
    deviceId: "one",
    revision: 2,
    answers: { q: "B" },
  });
  await service.execute(student, "exam.progress", {
    examId: "math",
    deviceId: "one",
    revision: 1,
    answers: { q: "A" },
  });
  assert.equal(records.get("examSessions/math_alice").answers.q, "B");
  await service.execute(owner, "sessions.intervene", {
    sessionId: "math_alice",
    operation: "transfer",
    targetDeviceId: "two",
    reason: "Computer failed",
  });
  await assert.rejects(
    service.execute(student, "exam.submit", {
      examId: "math",
      deviceId: "one",
      answers: {},
    }),
    { status: 409 },
  );
  const packet = await service.execute(student, "exam.start", {
    examId: "math",
    deviceId: "two",
  });
  assert.equal(packet.session.answers.q, "B");
  await service.execute(owner, "sessions.intervene", {
    sessionId: "math_alice",
    operation: "extend",
    minutes: 5,
    reason: "Power interruption",
  });
  assert.equal(
    records.get("examSessions/math_alice").expiresAtMs,
    packet.session.expiresAtMs + 300000,
  );
  assert([...records.keys()].some((k) => k.startsWith("auditLogs/")));
});
test("corrections retract released results and require an audit reason", async () => {
  const { service, pin, records } = await setup();
  await service.execute(student, "exam.start", {
    examId: "math",
    pin,
    deviceId: "one",
  });
  await service.execute(student, "exam.submit", {
    examId: "math",
    deviceId: "one",
    answers: { q: "B" },
  });
  await assert.rejects(
    service.execute(student, "results.manage", {
      resultId: "math_alice",
      operation: "release",
      reason: "Approved score",
    }),
    { status: 403 },
  );
  await service.execute(owner, "results.manage", {
    resultId: "math_alice",
    operation: "release",
    reason: "Approved score",
  });
  await service.execute(owner, "results.manage", {
    resultId: "math_alice",
    operation: "correct",
    score: 1,
    reason: "Moderated scoring",
  });
  assert.equal(records.get("examResults/math_alice").released, false);
  assert.equal(records.get("examResults/math_alice").finalScore, 1);
});
test("weighted subject totals normalize marks and never merge terms", () => {
  const base = {
    ...fields,
    studentUid: "alice",
    studentName: "Alice",
    released: true,
  };
  const rows = [
    { ...base, finalScore: 18, maxMarks: 20, category: "ca", weight: 40 },
    { ...base, finalScore: 45, maxMarks: 100, weight: 60 },
  ];
  assert.equal(subjectTotals(rows)[0].total, 63);
  assert.equal(subjectTotals(rows)[0].complete, true);
  assert.equal(subjectTotals(rows.slice(0, 1))[0].complete, false);
  assert.equal(
    subjectTotals([...rows, { ...rows[0], term: "Second" }]).length,
    2,
  );
});
test("CSV handles quoted names/newlines and exports formula-safe cells", () => {
  assert.deepEqual(parseCsv('name,subject\r\n"Ade, Bola",Math'), [
    { name: "Ade, Bola", subject: "Math" },
  ]);
  assert.throws(() => parseCsv("name,name\na,b"));
  assert.throws(() => parseCsv('name\n"unterminated'));
  assert(csvText([['=HYPERLINK("bad")']]).startsWith("\"'="));
});
test("teachers cannot publish or access results and invigilators cannot create accounts", async () => {
  const { service } = await setup();
  const teacher = {
    uid: "teacher",
    role: "teacher",
    assignedClasses: ["JSS1 A"],
    assignedSubjects: ["Mathematics"],
  };
  await assert.rejects(
    service.execute(teacher, "exams.publish", { examId: "math" }),
    { status: 403 },
  );
  await assert.rejects(
    service.execute(teacher, "results.manage", {
      resultId: "x",
      operation: "release",
    }),
    { status: 403 },
  );
  await assert.rejects(
    service.execute({ uid: "inv", role: "invigilator" }, "students.create", {}),
    { status: 403 },
  );
  const created = await service.execute(teacher, "exams.create", {
    ...fields,
    title: "Teacher paper",
    duration: 15,
  });
  assert(created.id);
  await assert.rejects(
    service.execute(teacher, "exams.create", {
      ...fields,
      className: "JSS2 A",
      title: "Wrong class",
      duration: 15,
    }),
    { status: 403 },
  );
});
