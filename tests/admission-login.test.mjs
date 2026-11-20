import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { schoolAdmissionNumber, admissionAuthUsername, usernameEmail } from "../server/domain.mjs";
import {
  studentAdmissionAuthEmail,
  normalizeAdmissionNumber,
  isLegacyUsername,
} from "../cbt-app/src/utils/studentLogin.js";
import { createService } from "../server/service.mjs";
import { fakeBackend } from "./support.mjs";

const owner = { uid: "owner", role: "superadmin" };

test("admission numbers keep leading zeros, slash separators and canonical case", async () => {
  const number = schoolAdmissionNumber(" rgis/2026/0007 ");
  assert.equal(number, "RGIS/2026/0007");
  assert.equal(normalizeAdmissionNumber(" rgis/2026/0007 "), number);
  assert.equal(
    await studentAdmissionAuthEmail(number, webcrypto.subtle),
    usernameEmail(admissionAuthUsername(number)),
    "Browser and server must derive the same Firebase Auth identity",
  );
  assert.equal(
    await studentAdmissionAuthEmail("RGIS/2026/0007", webcrypto.subtle),
    await studentAdmissionAuthEmail(" rgis/2026/0007 ", webcrypto.subtle),
  );
});

test("admission numbers are distinct credentials; names may repeat", async () => {
  const b = fakeBackend();
  const svc = createService(b);
  const one = await svc.execute(owner, "students.create", {
    admissionNumber: "RGIS/2026/001", displayName: "Tolu Ade", password: "Strong-Password-123",
  });
  const two = await svc.execute(owner, "students.create", {
    admissionNumber: "RGIS/2026/002", displayName: "Tolu Ade", password: "Strong-Password-456",
  });
  assert.notEqual(one.uid, two.uid);
  assert.equal(one.admissionNumber, "RGIS/2026/001");
  assert.equal(b.records.get(`users/${one.uid}`).loginIdType, "admission");
  assert.equal(b.records.get(`users/${two.uid}`).username, "rgis/2026/002".toUpperCase());
  await assert.rejects(
    svc.execute(owner, "students.create", {
      admissionNumber: "rgis/2026/001", displayName: "Another Tolu", password: "Strong-Password-123",
    }),
    { status: 409 },
  );
});

test("incorrect or missing admission numbers are rejected safely", () => {
  for (const value of ["", "RG", "RG 2026", "child@example.com", "../student", "X".repeat(61)]) {
    assert.throws(() => schoolAdmissionNumber(value), { status: 400 });
  }
  assert.equal(isLegacyUsername("alice-school"), true);
  assert.equal(isLegacyUsername("RGIS/2026/001"), false);
});

test("editing a student cannot silently invalidate an admission-based Firebase login", async () => {
  const b = fakeBackend({
    "users/student": { role: "student", displayName: "Tolu Ade", username: "RGIS/2026/001", admissionNumber: "RGIS/2026/001", loginIdType: "admission", subjects: ["Mathematics"] },
    "school/settings": { academicSession: "2026/2027", classes: ["JSS1 A"], subjects: ["Mathematics"] },
  });
  const svc = createService(b);
  await assert.rejects(
    svc.execute(owner, "students.update", {
      studentId: "student", displayName: "Tolu Ade", admissionNumber: "RGIS/2026/999",
      className: "JSS1 A", subjects: ["Mathematics"],
    }),
    { status: 409 },
  );
  assert.equal(b.records.get("users/student").admissionNumber, "RGIS/2026/001");
  await svc.execute(owner, "students.update", {
    studentId: "student", displayName: "Tolu Ade", admissionNumber: "RGIS/2026/001",
    className: "JSS1 A", subjects: ["Mathematics"],
  });
  assert.equal(b.records.get("users/student").admissionNumber, "RGIS/2026/001");
});
