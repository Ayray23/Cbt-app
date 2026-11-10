import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../server/service.mjs";
import { fakeBackend, memoryStorage } from "./support.mjs";
import { createExamStore } from "../cbt-app/src/services/examStore.js";
import { grade, publicQuestions, usernameEmail } from "../server/domain.mjs";

const owner = { uid: "owner", role: "superadmin" };
const alice = { uid: "alice", role: "student", displayName: "Alice", username: "alice", email: "" };
const bob = { uid: "bob", role: "student", displayName: "Bob", username: "bob", email: "" };
const question = { id: "q1", text: "2 + 2?", options: { A: "3", B: "4", C: "5", D: "6" }, correctAnswer: "B", marks: 2 };

async function setup() {
  const backend = fakeBackend({ "users/alice": alice, "users/bob": bob,
    "users/owner": owner, "exams/math": { title: "Math", duration: 30, status: "draft" },
    "questions/q1": { ...question, examId: "math" } });
  let time = 100000;
  const service = createService({ ...backend, now: () => time });
  await service.execute(owner, "exams.publish", { examId: "math" });
  const issued = await service.execute(owner, "exams.assign", { examId: "math", studentIds: ["alice", "bob"] });
  return { ...backend, service, pins: issued.pins, setTime: (value) => { time = value; } };
}

test("only an administrator can create students; an email is optional", async () => {
  const { service, records } = await setup();
  await assert.rejects(service.execute(alice, "students.create", {}), { status: 403 });
  const created = await service.execute(owner, "students.create", { username: "ST-100", displayName: "Student One", password: "StrongPass123" });
  assert.equal(created.email, "");
  assert.equal(records.get(`users/${created.uid}`).role, "student");
  assert.equal(usernameEmail("ST-100"), "st-100@students.cbt.invalid");
});

test("unknown, disabled and unauthenticated identities cannot access the API", async () => {
  const { service, records } = await setup();
  await assert.rejects(service.identity("invalid"), { status: 401 });
  await assert.rejects(service.identity("unprovisioned"), { status: 403 });
  records.set("users/alice", { ...alice, loginDisabled: true });
  await assert.rejects(service.identity("alice"), { status: 403 });
});

test("PINs are tied to both the student and the exam and failed checks are rate limited", async () => {
  const { service, pins } = await setup();
  await assert.rejects(service.execute(bob, "exam.start", { examId: "math", pin: pins[0].pin }), { status: 403 });
  for (let index = 0; index < 4; index++) await assert.rejects(service.execute(bob, "exam.start", { examId: "math", pin: "WRONG" }), { status: 403 });
  await assert.rejects(service.execute(bob, "exam.start", { examId: "math", pin: pins[1].pin }), { status: 429 });
});

test("student paper contains no answer keys, scores or private PIN hashes", async () => {
  const { service, pins } = await setup();
  const packet = await service.execute(alice, "exam.start", { examId: "math", pin: pins[0].pin });
  assert.equal(packet.questions[0].correctAnswer, undefined);
  assert.equal(packet.session.finalScore, undefined);
  assert.equal(JSON.stringify(packet).includes("digest"), false);
  assert.deepEqual(publicQuestions([question]), [{ id: "q1", text: question.text, options: question.options, marks: 2 }]);
});

test("shuffled display labels do not change the stored option identity or marking", async () => {
  const order = ["C", "A", "B", "D"];
  const displayedThirdChoice = order[2];
  assert.equal(grade([question], { q1: displayedThirdChoice }).finalScore, 2);
  assert.equal(grade([question], { q1: "C" }).finalScore, 0);
});

test("submitting ignores forged scores and grades against the immutable published key", async () => {
  const { service, pins, records } = await setup();
  await service.execute(alice, "exam.start", { examId: "math", pin: pins[0].pin });
  records.set("questions/q1", { ...question, examId: "math", correctAnswer: "A", marks: 100 });
  const receipt = await service.execute(alice, "exam.submit", { examId: "math", answers: { q1: "B" }, finalScore: 99999 });
  assert.equal(receipt.finalScore, undefined);
  assert.equal(records.get("examResults/math_alice").finalScore, 2);
  assert.equal(records.get("examSessions/math_alice").finalScore, undefined);
  await service.execute(alice, "exam.submit", { examId: "math", answers: { q1: "A" } });
  assert.equal(records.get("examResults/math_alice").finalScore, 2);
  await assert.rejects(service.execute(alice, "exam.start", { examId: "math", pin: pins[0].pin }), { status: 409 });
  await assert.rejects(service.execute(owner, "exams.assign", { examId: "math", studentIds: ["alice"] }), { status: 409 });
});

test("concurrent starts preserve one deadline and one question/option order", async () => {
  const { service, pins } = await setup();
  const [first, second] = await Promise.all([0, 1].map(() => service.execute(alice, "exam.start", { examId: "math", pin: pins[0].pin })));
  assert.equal(first.session.expiresAtMs, second.session.expiresAtMs);
  assert.deepEqual(first.session.optionOrderByQuestion, second.session.optionOrderByQuestion);
});

test("late offline submissions are retained for review; an expired timer cannot be reset", async () => {
  const { service, pins, setTime, records } = await setup();
  const packet = await service.execute(alice, "exam.start", { examId: "math", pin: pins[0].pin });
  setTime(packet.session.expiresAtMs + 60000);
  assert.deepEqual(await service.execute(alice, "exam.progress", { examId: "math", answers: { q1: "B" } }), { expired: true });
  await service.execute(alice, "exam.submit", { examId: "math", answers: { q1: "B" }, closedAtMs: 1 });
  assert.equal(records.get("examResults/math_alice").requiresReview, true);
});

test("offline close is durable before sync and remains closed through reload and stale saves", () => {
  const storage = memoryStorage();
  const store = createExamStore(storage);
  store.putPacket("alice", "math", { session: { examId: "math", status: "started", answers: {} }, questions: publicQuestions([question]) });
  store.save("alice", "math", { q1: "B" });
  store.close("alice", "math", { examId: "math", submissionId: "one", answers: { q1: "B" }, closedAtMs: 123 });
  const reloaded = createExamStore(storage);
  reloaded.save("alice", "math", { q1: "A" });
  assert.equal(reloaded.read("alice", "math").closed, true);
  assert.equal(reloaded.read("alice", "math").pending.answers.q1, "B");
  reloaded.acknowledge("alice", "math", "one");
  assert.equal(reloaded.read("alice", "math").closed, true);
  assert.equal(reloaded.read("alice", "math").pending, null);
});

test("acknowledging one upload preserves other papers and other students", () => {
  const store = createExamStore(memoryStorage());
  for (const [uid, examId] of [["alice", "math"], ["alice", "english"], ["bob", "math"]]) {
    store.putPacket(uid, examId, { session: { examId, status: "started" }, questions: [] });
    store.close(uid, examId, { examId, submissionId: examId, answers: {} });
  }
  store.acknowledge("alice", "math", "math");
  assert.ok(store.read("alice", "english").pending);
  assert.ok(store.read("bob", "math").pending);
});

test("a storage failure must not report a successful close", () => {
  const storage = memoryStorage();
  const store = createExamStore(storage);
  store.putPacket("alice", "math", { session: { examId: "math" } });
  storage.setItem = () => { throw new Error("Storage full"); };
  assert.throws(() => store.close("alice", "math", { answers: {} }), /Storage full/);
  assert.equal(store.read("alice", "math").closed, undefined);
});

test("two different students can complete the same exam independently", async () => {
  const { service, pins, records } = await setup();
  assert.notEqual(pins[0].pin, pins[1].pin);
  for (const [student, pin] of [[alice, pins[0]], [bob, pins[1]]]) {
    await service.execute(student, "exam.start", { examId: "math", pin: pin.pin });
    await service.execute(student, "exam.submit", { examId: "math", answers: { q1: "B" } });
  }
  assert.equal(records.get("examResults/math_alice").finalScore, 2);
  assert.equal(records.get("examResults/math_bob").finalScore, 2);
});

test("a PIN for one subject cannot unlock another subject for the same student", async () => {
  const { service, pins, records } = await setup();
  records.set("exams/english", { title: "English", status: "draft", duration: 10 });
  records.set("questions/q2", { ...question, examId: "english" });
  await service.execute(owner, "exams.publish", { examId: "english" });
  await service.execute(owner, "exams.assign", { examId: "english", studentIds: ["alice"] });
  await assert.rejects(service.execute(alice, "exam.start", { examId: "english", pin: pins[0].pin }), { status: 403 });
});

test("late-result approval is an explicit administrator action", async () => {
  const { service, pins, records, setTime } = await setup();
  const packet = await service.execute(alice, "exam.start", { examId: "math", pin: pins[0].pin });
  setTime(packet.session.expiresAtMs + 100000);
  await service.execute(alice, "exam.submit", { examId: "math", answers: { q1: "B" } });
  await assert.rejects(service.execute(alice, "results.review", { resultId: "math_alice" }), { status: 403 });
  await service.execute(owner, "results.review", { resultId: "math_alice" });
  assert.equal(records.get("examResults/math_alice").requiresReview, false);
  assert.equal(records.get("examResults/math_alice").reviewedBy, "owner");
});

test("an autosave arriving after submission cannot overwrite final answers", async () => {
  const { service, pins, records } = await setup();
  await service.execute(alice, "exam.start", { examId: "math", pin: pins[0].pin });
  await service.execute(alice, "exam.submit", { examId: "math", answers: { q1: "B" } });
  assert.deepEqual(await service.execute(alice, "exam.progress", { examId: "math", answers: { q1: "A" } }), { closed: true });
  assert.equal(records.get("examSessions/math_alice").answers.q1, "B");
  assert.equal(records.get("examResults/math_alice").finalScore, 2);
});

test("a student cannot change roles or issue their own exam PINs", async () => {
  const { service } = await setup();
  await assert.rejects(service.execute(alice, "users.role", { email: "owner@example.com", role: "admin" }), { status: 403 });
  await assert.rejects(service.execute(alice, "exams.assign", { examId: "math", studentIds: ["alice"] }), { status: 403 });
});

test("a legacy or forged session cannot bypass personal PIN verification", async () => {
  const { service, records } = await setup();
  const exam = records.get("exams/math");
  records.set("examSessions/math_alice", { schemaVersion: 2, status: "started", examId: "math",
    studentUid: "alice", paperVersion: exam.paperVersion, expiresAtMs: 9999999999999 });
  await assert.rejects(service.execute(alice, "exam.start", { examId: "math" }), { status: 409 });
  await assert.rejects(service.execute(alice, "exam.submit", { examId: "math", answers: { q1: "B" } }), { status: 409 });
  assert.equal(records.has("examResults/math_alice"), false);
});

test("a mismatched historical session cannot expose another student's attempt", async () => {
  const { service, records } = await setup();
  const paperVersion = records.get("exams/math").paperVersion;
  records.set("examSessions/math_alice", { schemaVersion: 2, status: "started", examId: "math", studentUid: "bob", paperVersion });
  records.set("examSessionProofs/math_alice", { studentUid: "bob", paperVersion });
  for (const action of ["exam.start", "exam.progress", "exam.submit"]) {
    await assert.rejects(service.execute(alice, action, { examId: "math", answers: {} }), { status: 403 });
  }
});
