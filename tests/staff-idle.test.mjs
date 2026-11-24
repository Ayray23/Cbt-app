import test from "node:test";
import assert from "node:assert/strict";
import { idlePhase, secondsLeft, STAFF_IDLE_MS, STAFF_WARNING_MS } from "../cbt-app/src/utils/staffIdle.mjs";

test("staff session is active for the first eight minutes of inactivity", () => {
  const start = 100000;
  assert.equal(idlePhase(start, start), "active");
  assert.equal(idlePhase(start, start + STAFF_IDLE_MS - 1), "active");
});
test("staff warning starts at eight minutes and counts down thirty seconds", () => {
  const start = 100000;
  assert.equal(idlePhase(start, start + STAFF_IDLE_MS), "warning");
  assert.equal(secondsLeft(start + STAFF_IDLE_MS + STAFF_WARNING_MS, start + STAFF_IDLE_MS), 30);
  assert.equal(secondsLeft(start + STAFF_IDLE_MS + STAFF_WARNING_MS, start + STAFF_IDLE_MS + 11000), 19);
});
test("timeout expires after countdown even if an interval was throttled in a background tab", () => {
  const start = 100000;
  assert.equal(idlePhase(start, start + STAFF_IDLE_MS + STAFF_WARNING_MS - 1), "warning");
  assert.equal(idlePhase(start, start + STAFF_IDLE_MS + STAFF_WARNING_MS), "expired");
  assert.equal(idlePhase(start, start + 60 * 60 * 1000), "expired");
  assert.equal(secondsLeft(start + STAFF_IDLE_MS + STAFF_WARNING_MS, start + 60 * 60 * 1000), 0);
});
test("explicit continuation resets inactivity clock and starts a fresh session", () => {
  const start = 100000;
  const resumed = start + STAFF_IDLE_MS + 15000;
  assert.equal(idlePhase(start, resumed), "warning");
  assert.equal(idlePhase(resumed, resumed + 30000), "active");
});
