import test from "node:test";
import assert from "node:assert/strict";
import { examOwnerFilter } from "../cbt-app/src/utils/examVisibility.mjs";

test("admins and superadmins see school-wide exam papers regardless of creator", () => {
  assert.deepEqual(examOwnerFilter("admin", "admin-uid"), []);
  assert.deepEqual(examOwnerFilter("superadmin", "owner-uid"), []);
});

test("teacher exam visibility is restricted to that teacher's papers", () => {
  assert.deepEqual(examOwnerFilter("teacher", "teacher-one"), [["createdBy", "==", "teacher-one"]]);
  assert.deepEqual(examOwnerFilter("teacher", "teacher-two"), [["createdBy", "==", "teacher-two"]]);
});
