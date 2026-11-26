import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { SCHOOL_RECOVERY_PUBLIC_KEY } from "../cbt-app/src/utils/encryptedOfflinePdf.mjs";
import { makeOfflineSubmissionReceipt } from "../cbt-app/src/utils/offlineSubmissionReceipt.mjs";

test("student app contains a strong public key but never the administrator's private key", () => {
  const key = createPublicKey(SCHOOL_RECOVERY_PUBLIC_KEY);
  assert.equal(key.asymmetricKeyType, "rsa");
  assert.equal(key.asymmetricKeyDetails.modulusLength, 3072);
  const source = readFileSync(new URL("../cbt-app/src/utils/encryptedOfflinePdf.mjs", import.meta.url), "utf8");
  assert(!source.includes("-----BEGIN PRIVATE KEY-----"));
  assert(source.includes("userPassword: password"));
  assert(source.includes("AES-GCM"));
});

test("backup contains selected answers and no correct answers or question paper", () => {
  const packet = {
    session: { examId: "english", examTitle: "English", studentUid: "student-1" },
    closed: true,
    pending: {
      examId: "english", submissionId: "sub-1",
      answers: { a: "A", b: "C" },
      submissionReason: "timeout", closedAtMs: 10000,
    },
    questions: [{ id: "a", correctAnswer: "A", text: "Private paper question" }],
  };
  const receipt = makeOfflineSubmissionReceipt(packet, "student-1");
  assert.equal(receipt.answerCount, 2);
  assert.deepEqual(receipt.packets[0].pending.answers, { a: "A", b: "C" });
  assert(!JSON.stringify(receipt).includes("Private paper question"));
  assert(!JSON.stringify(receipt).includes("correctAnswer"));
});
