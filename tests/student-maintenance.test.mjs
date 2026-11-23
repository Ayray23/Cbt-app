import test from "node:test";
import assert from "node:assert/strict";
import { fakeBackend } from "./support.mjs";
import { createService } from "../server/service.mjs";

const owner = { uid: "owner", role: "superadmin" };
function fixture() {
  const backend = fakeBackend({
    "users/owner": owner,
    "users/student-one": { role: "student", displayName: "First" },
    "users/student-two": { role: "student", displayName: "Second" },
    "users/admin": { role: "admin" },
    "examAssignments/math_one": { studentUid: "student-one" },
    "examPins/math_one": { studentUid: "student-one" },
    "examSessions/math_one": { studentUid: "student-one", status: "submitted" },
    "examSessionProofs/math_one": { studentUid: "student-one" },
    "examResults/math_one": { studentUid: "student-one", finalScore: 10 },
    "examResults/math_two": { studentUid: "student-two", finalScore: 18 },
    "exams/math": { status: "published" },
  });
  const removedAuth = [];
  backend.auth.deleteUser = async (uid) => { removedAuth.push(uid); };
  return { ...backend, removedAuth, service: createService(backend) };
}
const request = { studentIds: ["student-one"], confirmation: "DELETE SELECTED STUDENTS" };

test("selected student deletion is strictly superadmin-only", async () => {
  const { service, records } = fixture();
  for (const role of ["student", "admin", "teacher", "invigilator"]) {
    await assert.rejects(service.execute({ role, uid: role }, "students.deleteSelected", request), { status: 403 });
  }
  assert(records.has("users/student-one"));
});

test("refuses empty, duplicate, forged non-student and unconfirmed requests", async () => {
  const { service, records } = fixture();
  for (const input of [
    { ...request, studentIds: [] },
    { ...request, studentIds: ["student-one", "student-one"] },
    { ...request, studentIds: ["admin"] },
    { ...request, studentIds: ["owner"] },
    { ...request, confirmation: "DELETE ALL STUDENTS" },
  ]) {
    await assert.rejects(service.execute(owner, "students.deleteSelected", input));
  }
  assert(records.has("users/student-one"));
});

test("does not delete a student with an active attempt or unrevoked LAN grant", async () => {
  const { service, records, removedAuth } = fixture();
  records.set("examSessions/active", { studentUid: "student-one", status: "started" });
  await assert.rejects(service.execute(owner, "students.deleteSelected", request), { status: 409 });
  records.delete("examSessions/active");
  records.set("lanGrants/pending", { revoked: false });
  await assert.rejects(service.execute(owner, "students.deleteSelected", request), { status: 409 });
  assert.deepEqual(removedAuth, []);
});

test("deletes ONLY selected student authentication and associated Firestore records", async () => {
  const { service, records, removedAuth } = fixture();
  const result = await service.execute(owner, "students.deleteSelected", request);
  assert.equal(result.deletedStudents, 1);
  assert.deepEqual(removedAuth, ["student-one"]);
  assert(!records.has("users/student-one"));
  for (const path of [
    "examAssignments/math_one", "examPins/math_one", "examSessions/math_one",
    "examSessionProofs/math_one", "examResults/math_one",
  ]) assert(!records.has(path), path);
  assert(records.has("users/student-two"));
  assert(records.has("users/owner"));
  assert(records.has("users/admin"));
  assert(records.has("examResults/math_two"));
  assert(records.has("exams/math"));
  assert([...records.values()].some((entry) => entry.action === "students.deleteSelected" && entry.target === "student-one"));
});
