import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a client-supplied submission reason cannot bypass the exam deadline", async () => {
  const source = await read("../../cloud-functions/functions/examSecurity.js");
  assert.doesNotMatch(source, /submissionReason\s*!==\s*"timeout"/);
  assert.match(source, /isLateSubmission \? normalizeAnswers\(session\.answers\) : answers/);
});

test("students cannot write to an exam session after it expires", async () => {
  const rules = await read("../../cloud-functions/firestore.rules");
  assert.match(rules, /request\.time\.toMillis\(\) <= resource\.data\.get\('expiresAtMs', 0\) \+ 30000/);
});

test("self-created user profiles are pinned to the signed-in email and a fixed field set", async () => {
  const rules = await read("../../cloud-functions/firestore.rules");
  assert.match(rules, /request\.resource\.data\.keys\(\)\.hasOnly\(\['email', 'displayName', 'role', 'loginDisabled', 'createdAt', 'lastLoginAt'\]\)/);
  assert.match(rules, /request\.resource\.data\.get\('email', ''\) == request\.auth\.token\.get\('email', ''\)/);
});

test("role changes resolve the account through Firebase Auth", async () => {
  const functions = await read("../../cloud-functions/functions/index.js");
  const script = await read("../setAdmin.cjs");
  const client = await read("../src/services/sessionService.js");
  assert.match(functions, /admin\.auth\(\)\.getUserByEmail\(email\)/);
  assert.match(script, /getUserByEmail\(email\)/);
  assert.match(client, /httpsCallable\(getFunctions\(\), "setUserRole"\)/);
  assert.doesNotMatch(client, /where\("email", "==", normalizedEmail\)/);
});
