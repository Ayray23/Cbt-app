import test from "node:test";
import assert from "node:assert/strict";
import { fakeBackend } from "./support.mjs";
import { createService } from "../server/service.mjs";
import { admissionAuthUsername, usernameEmail } from "../server/domain.mjs";
import { requestTimeoutMs } from "../cbt-app/src/services/apiTimeout.mjs";

const owner = { uid: "owner", role: "superadmin" };
function fixture() {
  const backend = fakeBackend({
    "school/settings": { academicSession: "2026/2027", classes: ["SS1"], subjects: ["English Language"] },
    "users/owner": owner,
  });
  backend.auth.getUser = async (uid) => {
    if (uid !== "student-uid") { const err = new Error("missing"); err.code = "auth/user-not-found"; throw err; }
    return { uid, email: usernameEmail(admissionAuthUsername("0010/S1")) };
  };
  return { ...backend, service: createService(backend) };
}
const input = {
  studentUid: "student-uid", admissionNumber: "0010/S1",
  displayName: "Example Student", className: "SS1",
  subjects: ["English Language"], academicSession: "2026/2027",
};

test("exam PIN assignment has longer timeout than ordinary API calls", () => {
  assert.equal(requestTimeoutMs("exams.assign"), 90000);
  assert.equal(requestTimeoutMs("account.verify"), 15000);
});

test("only super-admin can recover a missing student profile", async () => {
  const { service, records } = fixture();
  for (const role of ["student", "teacher", "admin", "invigilator"]) {
    await assert.rejects(service.execute({ uid: role, role }, "students.repairProfile", input), { status: 403 });
  }
  assert(!records.has("users/student-uid"));
});

test("recovery refuses mismatched login identity or any existing profile", async () => {
  const { service, records } = fixture();
  await assert.rejects(service.execute(owner, "students.repairProfile", { ...input, admissionNumber: "0001/S1" }), { status: 409 });
  records.set("users/student-uid", { role: "admin" });
  await assert.rejects(service.execute(owner, "students.repairProfile", input), { status: 409 });
  assert.equal(records.get("users/student-uid").role, "admin");
});

test("superadmin can restore verified admission-based student profile without creating Auth user", async () => {
  const { service, records } = fixture();
  const result = await service.execute(owner, "students.repairProfile", input);
  assert.equal(result.uid, "student-uid");
  assert.equal(records.get("users/student-uid").role, "student");
  assert.equal(records.get("users/student-uid").admissionNumber, "0010/S1");
  assert.deepEqual(records.get("users/student-uid").subjects, ["English Language"]);
  assert([...records.values()].some((r) => r.action === "students.repairProfile"));
});
