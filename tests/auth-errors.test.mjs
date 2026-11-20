import test from "node:test";
import assert from "node:assert/strict";
import { friendlyAuthError } from "../cbt-app/src/utils/authErrors.js";

test("Firebase network failures explain connectivity without falsely blaming credentials", () => {
  const result = friendlyAuthError({
    code: "auth/network-request-failed",
    message: "Firebase: Error (auth/network-request-failed).",
  });
  assert.match(result, /Firebase Authentication/);
  assert.match(result, /connection/);
  assert.doesNotMatch(result, /invalid password/i);
  assert.match(friendlyAuthError({ message: "Failed to fetch" }), /connect to Firebase Authentication/);
});

test("teacher duplicate accounts and disabled sign-up get specific recovery instructions", () => {
  assert.match(friendlyAuthError({ code: "auth/email-already-in-use" }), /Sign in instead/);
  assert.match(friendlyAuthError({ code: "auth/operation-not-allowed" }), /not enabled/);
  assert.match(friendlyAuthError({ code: "auth/too-many-requests" }), /Too many attempts/);
  assert.match(friendlyAuthError({ code: "auth/invalid-api-key" }), /not configured/);
  assert.match(friendlyAuthError({ code: "auth/invalid-credential" }), /Invalid username/);
});

test("unexpected errors have a safe fallback; no raw SDK traces are shown", () => {
  assert.equal(friendlyAuthError({ code: "auth/internal-error", message: "Firebase internal exception" }, "Please contact support."), "Please contact support.");
  assert.match(friendlyAuthError({ name: "AbortError" }), /too long/);
  assert.equal(friendlyAuthError({ message: "Server returned 503" }), "Server returned 503");
});
