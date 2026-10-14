import test from "node:test";
import assert from "node:assert/strict";
import { calculateAutoScore, getExamScheduleState, getHeartbeatHealth } from "../src/utils/examRules.js";

test("exam schedule opens only inside the configured window", () => {
  const exam = { scheduleStartAtMs: 1000, scheduleEndAtMs: 5000 };
  assert.equal(getExamScheduleState(exam, 999).state, "upcoming");
  assert.equal(getExamScheduleState(exam, 1000).state, "open");
  assert.equal(getExamScheduleState(exam, 4999).state, "open");
  assert.equal(getExamScheduleState(exam, 5000).state, "closed");
});

test("auto scoring awards only the configured question marks", () => {
  const questions = [
    { id: "q1", correctAnswer: "B", marks: 2 },
    { id: "q2", correctAnswer: "A", marks: 1 },
    { id: "q3", correctAnswer: "D", marks: 3 },
  ];
  assert.equal(calculateAutoScore(questions, { q1: "b", q2: "C", q3: "D" }), 5);
});

test("monitoring distinguishes online, offline and stale candidates", () => {
  assert.equal(getHeartbeatHealth({ status: "started", networkOnline: true, lastHeartbeatAtMs: 9000 }, 10000), "online");
  assert.equal(getHeartbeatHealth({ status: "started", networkOnline: false, lastHeartbeatAtMs: 9000 }, 10000), "offline");
  assert.equal(getHeartbeatHealth({ status: "started", networkOnline: true, lastHeartbeatAtMs: 0 }, 10000), "stale");
});
