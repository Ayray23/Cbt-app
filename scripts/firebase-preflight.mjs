/**
 * Read-only production/staging credential preflight.
 *
 * This is intentionally NOT a database migration or backup.
 * Run only from an authorized environment with service credentials already
 * configured. Never print the credential, Auth users or Firestore documents.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function inspectFirebaseConfig(env = process.env) {
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Live Firebase preflight refused: emulator variables are set.",
    );
  }
  const expectedProjectId = env.VITE_FIREBASE_PROJECT_ID;
  if (!expectedProjectId || !/^[a-z][a-z0-9-]{4,29}$/.test(expectedProjectId)) {
    throw new Error("VITE_FIREBASE_PROJECT_ID must identify the intended live Firebase project.");
  }
  for (const key of [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_APP_ID",
  ]) {
    if (typeof env[key] !== "string" || !env[key].trim()) {
      throw new Error(`Missing required Firebase web setting: ${key}`);
    }
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Missing server-only FIREBASE_SERVICE_ACCOUNT_JSON.");
  }
  let account;
  try {
    account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (
    !account ||
    typeof account !== "object" ||
    Array.isArray(account) ||
    account.type !== "service_account" ||
    typeof account.client_email !== "string" ||
    !account.client_email.endsWith(".gserviceaccount.com") ||
    typeof account.private_key !== "string" ||
    !account.private_key.includes("-----BEGIN PRIVATE KEY-----") ||
    !account.private_key.includes("-----END PRIVATE KEY-----")
  ) {
    throw new Error("Firebase Admin credential does not have the expected service-account fields.");
  }
  if (account.project_id !== expectedProjectId) {
    throw new Error(
      "Firebase service-account project differs from VITE_FIREBASE_PROJECT_ID; refusing cross-project access.",
    );
  }
  return { projectId: expectedProjectId };
}

export async function verifyFirebaseReadOnly(env = process.env) {
  const { projectId } = inspectFirebaseConfig(env);
  // Import after validation to ensure no accidental initialization in a
  // different Firebase project or emulator.
  const { backend } = await import("../cbt-app/server/firebase-admin.mjs");
  const { auth, db } = backend();

  // Firebase Admin SDK bypasses security rules. These checks prove service
  // account credentials and basic read permissions, NOT deployed rules.
  await auth.listUsers(1);
  for (const collection of ["users", "exams", "examSessions", "examResults"]) {
    await db.collection(collection).limit(1).get();
  }
  return { projectId, authRead: true, firestoreRead: true, wroteData: false };
}

async function main() {
  try {
    const result = await verifyFirebaseReadOnly();
    console.log(
      `PASS: read-only Firebase Auth and Firestore access for ${result.projectId}; no records were changed.`,
    );
  } catch (error) {
    // Never print raw credential or response bodies on CI, terminals or logs.
    const safeCode =
      typeof error?.code === "string" &&
      /^[a-zA-Z0-9_/-]{1,80}$/.test(error.code)
        ? error.code
        : "configuration-or-permission-error";
    console.error(
      `Firebase preflight failed (${safeCode}). Check project match, service-account JSON, Auth API and Firestore permissions without sharing your secret.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
