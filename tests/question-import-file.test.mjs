import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QUESTION_IMPORT_BYTES,
  validateQuestionImportFile,
} from "../cbt-app/src/utils/questionImport.js";

test("accepts a small JSS1 Mathematics DOCX without false size errors", () => {
  assert.equal(
    validateQuestionImportFile({
      name: "JSS1_Mathematics_CBT_10_Questions.docx",
      size: 38 * 1024,
    }),
    null,
  );
  assert.equal(
    validateQuestionImportFile({ name: "maths.XLSX", size: 100_000 }),
    null,
  );
  assert.equal(
    validateQuestionImportFile({
      name: "maths.docx",
      size: MAX_QUESTION_IMPORT_BYTES,
    }),
    null,
  );
});

test("separates unsupported document types, empty files, and oversized imports", () => {
  assert.match(
    validateQuestionImportFile({ name: "maths.pdf", size: 22_000 }),
    /Unsupported file type/,
  );
  assert.match(
    validateQuestionImportFile({ name: "maths.docx", size: 0 }),
    /empty/,
  );
  assert.match(
    validateQuestionImportFile({
      name: "maths.docx",
      size: MAX_QUESTION_IMPORT_BYTES + 1,
    }),
    /larger than 2 MB/,
  );
  assert.match(validateQuestionImportFile(null), /Choose a Word/);
});
