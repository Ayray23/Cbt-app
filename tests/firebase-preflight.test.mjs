import test from "node:test";
import assert from "node:assert/strict";
import { inspectFirebaseConfig } from "../scripts/firebase-preflight.mjs";

function fixture(overrides = {}) {
  const account = {
    type: "service_account",
    project_id: "cbt-app-63991",
    client_email: "cbt-readonly@cbt-app-63991.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nunit-test-placeholder\n-----END PRIVATE KEY-----\n",
  };
  return {
    VITE_FIREBASE_PROJECT_ID: "cbt-app-63991",
    VITE_FIREBASE_API_KEY: "fake-web-key",
    VITE_FIREBASE_AUTH_DOMAIN: "cbt-app-63991.firebaseapp.com",
    VITE_FIREBASE_APP_ID: "1:example:web:fake",
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account),
    ...overrides,
  };
}

test("validates matching public Firebase project and private service account without contacting production", () => {
  assert.deepEqual(inspectFirebaseConfig(fixture()), {
    projectId: "cbt-app-63991",
  });
});

test("refuses missing or invalid service-account JSON", () => {
  assert.throws(
    () => inspectFirebaseConfig(fixture({ FIREBASE_SERVICE_ACCOUNT_JSON: "" })),
    /Missing server-only/,
  );
  assert.throws(
    () => inspectFirebaseConfig(fixture({ FIREBASE_SERVICE_ACCOUNT_JSON: "not-json" })),
    /not valid JSON/,
  );
  assert.throws(
    () => inspectFirebaseConfig(fixture({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type:"service_account" }) })),
    /expected service-account fields/,
  );
});

test("refuses a credential for another Firebase project", () => {
  assert.throws(
    () => inspectFirebaseConfig(fixture({ VITE_FIREBASE_PROJECT_ID: "another-school-project" })),
    /differs from VITE_FIREBASE_PROJECT_ID/,
  );
});

test("refuses emulator URLs and missing frontend configuration", () => {
  assert.throws(
    () => inspectFirebaseConfig(fixture({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" })),
    /emulator variables are set/,
  );
  assert.throws(
    () => inspectFirebaseConfig(fixture({ FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" })),
    /emulator variables are set/,
  );
  assert.throws(
    () => inspectFirebaseConfig(fixture({ VITE_FIREBASE_APP_ID: "" })),
    /Missing required Firebase web setting/,
  );
});
