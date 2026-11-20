import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../server/service.mjs";
import { cleanIntegrityLog, newerIntegrityLog } from "../server/domain.mjs";
import { fakeBackend } from "./support.mjs";
import {
  appendViolation,
  isBlockedKey,
  longerLog,
  summarizeViolations,
  MAX_LOGGED_VIOLATIONS,
} from "../cbt-app/src/utils/lockdown.js";

const owner = { uid: "owner", role: "superadmin" };
const alice = { uid: "alice", role: "student", displayName: "Alice", username: "alice", email: "" };
const question = { id: "q1", text: "2 + 2?", options: { A: "3", B: "4", C: "5", D: "6" }, correctAnswer: "B", marks: 2 };

async function startAttempt() {
  const backend = fakeBackend({
    "users/alice": alice,
    "users/owner": owner,
    "exams/math": { title: "Math", duration: 30, status: "draft" },
    "questions/q1": { ...question, examId: "math" },
  });
  const service = createService({ ...backend, now: () => 100000 });
  await service.execute(owner, "exams.publish", { deviceId: "d", revision: 1, examId: "math" });
  const issued = await service.execute(owner, "exams.assign", { deviceId: "d", revision: 1, examId: "math", studentIds: ["alice"] });
  await service.execute(alice, "exam.start", { deviceId: "d", revision: 1, examId: "math", pin: issued.pins[0].pin });
  return { ...backend, service };
}

test("developer-tool, view-source, save, print and copy shortcuts are blocked", () => {
  const key = (init) => isBlockedKey({ key: "", ...init });
  assert(key({ key: "F12" }));
  assert(key({ key: "u", ctrlKey: true }));
  assert(key({ key: "I", ctrlKey: true, shiftKey: true }));
  assert(key({ key: "j", metaKey: true, altKey: true }));
  for (const letter of ["c", "v", "x", "a", "s", "p"]) assert(key({ key: letter, ctrlKey: true }));
  assert(!key({ key: "c" }));
  assert(!key({ key: "ArrowRight" }));
  assert(!key({ key: "b", ctrlKey: true }));
});

test("the violation log is capped, summarised by type and only ever grows", () => {
  let log = [];
  for (let i = 0; i < MAX_LOGGED_VIOLATIONS + 5; i++) log = appendViolation(log, "tab-hidden", i);
  assert.equal(log.length, MAX_LOGGED_VIOLATIONS);
  assert.equal(log.at(-1).atMs, MAX_LOGGED_VIOLATIONS + 4);
  const mixed = [
    { type: "tab-hidden", atMs: 1 }, { type: "tab-hidden", atMs: 2 },
    { type: "fullscreen-exit", atMs: 3 }, { type: "window-blur", atMs: 4 },
  ];
  assert.equal(summarizeViolations(mixed), "2 tab, 1 fullscreen, 1 window");
  assert.equal(summarizeViolations(undefined), "");
  assert.equal(longerLog(mixed, mixed.slice(0, 1)), mixed);
  assert.equal(longerLog(undefined, mixed), mixed);
});

test("the server keeps only known event types and a bounded, newer log", () => {
  const dirty = [
    { type: "tab-hidden", atMs: 10 },
    { type: "<script>", atMs: 11 },
    { type: "window-blur", atMs: "not a number" },
    null,
    { type: "fullscreen-exit", atMs: 12.9, extra: "ignored" },
  ];
  assert.deepEqual(cleanIntegrityLog(dirty), [
    { type: "tab-hidden", atMs: 10 },
    { type: "fullscreen-exit", atMs: 12 },
  ]);
  assert.deepEqual(cleanIntegrityLog("nope"), []);
  assert.equal(cleanIntegrityLog(Array.from({ length: 100 }, (_, i) => ({ type: "tab-hidden", atMs: i }))).length, 25);
  const stored = [{ type: "tab-hidden", atMs: 1 }, { type: "window-blur", atMs: 2 }];
  assert.deepEqual(newerIntegrityLog(stored, [{ type: "tab-hidden", atMs: 1 }]), stored);
});

test("progress saves and the final submission keep the rule-break log for invigilators", async () => {
  const { service, records } = await startAttempt();
  const log = [{ type: "tab-hidden", atMs: 111 }, { type: "fullscreen-exit", atMs: 222 }, { type: "bogus", atMs: 333 }];
  await service.execute(alice, "exam.progress", {
    deviceId: "d", revision: 2, examId: "math", answers: { q1: "B" }, tabSwitchCount: 2, integrityLog: log,
  });
  assert.deepEqual(records.get("examSessions/math_alice").integrityLog, [
    { type: "tab-hidden", atMs: 111 },
    { type: "fullscreen-exit", atMs: 222 },
  ]);
  // A stale or tampered shorter log cannot erase the record.
  await service.execute(alice, "exam.progress", {
    deviceId: "d", revision: 3, examId: "math", answers: { q1: "B" }, tabSwitchCount: 0, integrityLog: [],
  });
  assert.equal(records.get("examSessions/math_alice").integrityLog.length, 2);
  assert.equal(records.get("examSessions/math_alice").tabSwitchCount, 2);
  await service.execute(alice, "exam.submit", {
    deviceId: "d", examId: "math", answers: { q1: "B" }, submissionReason: "manual", closedAtMs: 100000,
    tabSwitchCount: 3, integrityLog: [...log.slice(0, 2), { type: "window-blur", atMs: 444 }],
  });
  const result = records.get("examResults/math_alice");
  assert.equal(result.tabSwitchCount, 3);
  assert.deepEqual(result.integrityLog.map((entry) => entry.type), ["tab-hidden", "fullscreen-exit", "window-blur"]);
});
