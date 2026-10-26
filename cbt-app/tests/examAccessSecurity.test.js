import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("student exam reads are blocked until legacy exposed hashes are removed", async () => {
  const rules = await read("../../cloud-functions/firestore.rules");
  assert.match(
    rules,
    /allow read:\s*if isSignedIn\(\) && \(isAdmin\(\) \|\| \(resource\.data\.status == 'published' && !\('accessCodeHash' in resource\.data\)\)\);/
  );
  assert.match(rules, /match \/examAccess\/\{examId\} \{\s*allow read, write: if isAdmin\(\);/);
});

test("exam password hashes are stored and checked only in the protected collection", async () => {
  const service = await read("../src/services/cbtService.js");
  const dashboard = await read("../src/pages/StudentDashboard.jsx");
  const examSecurity = await read("../../cloud-functions/functions/examSecurity.js");
  const functions = await read("../../cloud-functions/functions/index.js");

  assert.doesNotMatch(service, /accessCodeHash/);
  assert.doesNotMatch(service, /code:\s*normalizedAccessCode/);
  assert.doesNotMatch(dashboard, /accessCodeHash/);
  assert.match(service, /collection\(db, "examAccess"\)/);
  assert.match(examSecurity, /db\.collection\("examAccess"\)\.doc\(examId\)\.get\(\)/);
  assert.doesNotMatch(examSecurity, /exam\.accessCodeHash/);
  assert.match(functions, /exports\.migrateLegacyExamAccess = onCall/);
  assert.match(functions, /accessCodeHash:\s*admin\.firestore\.FieldValue\.delete\(\)/);
  assert.match(functions, /code:\s*admin\.firestore\.FieldValue\.delete\(\)/);
});

test("raw question documents remain administrator-only", async () => {
  const rules = await read("../../cloud-functions/firestore.rules");
  assert.match(
    rules,
    /match \/questions\/\{questionId\} \{[\s\S]*?allow read, create, update, delete: if isAdmin\(\);/
  );
});
