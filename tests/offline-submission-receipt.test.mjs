import test from "node:test";
import assert from "node:assert/strict";
import { makeOfflineSubmissionReceipt, offlineReceiptFilename } from "../cbt-app/src/utils/offlineSubmissionReceipt.mjs";

const uid = "student-one";
const packet = {
  session: {
    examId: "math-101", studentUid: uid, examTitle: "Mathematics",
    paperVersion: "v123", expiresAtMs: 2000,
  },
  closed: true, closedAtMs: 2100,
  pending: {
    examId: "math-101", submissionId: "submit-abc", closedAtMs: 2100,
    submissionReason: "timeout", answers: { q1: "B", q3: "D" },
  },
  questions: [{ id: "q1", correctAnswer: "B", options: { A: "a", B: "b" } }],
  pin: "secret-pin",
};

test("offline receipt stores only the student completed answers and submission metadata", () => {
  const receipt = makeOfflineSubmissionReceipt(packet, uid);
  assert.equal(receipt.format, "cbt-offline-submission-v1");
  assert.equal(receipt.answerCount, 2);
  assert.equal(receipt.packets[0].pending.submissionId, "submit-abc");
  assert.deepEqual(receipt.packets[0].pending.answers, { q1: "B", q3: "D" });
  const json = JSON.stringify(receipt);
  assert(!json.includes("correctAnswer"));
  assert(!json.includes("secret-pin"));
  assert(!json.includes("options"));
  assert.match(offlineReceiptFilename(receipt), /^cbt-offline-/);
});

test("only closed and pending submissions belonging to the current student can be exported", () => {
  assert.throws(() => makeOfflineSubmissionReceipt({ ...packet, closed: false }, uid));
  assert.throws(() => makeOfflineSubmissionReceipt({ ...packet, pending: null }, uid));
  assert.throws(() => makeOfflineSubmissionReceipt(packet, "other-student"));
});
