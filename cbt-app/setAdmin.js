import { backend } from "./server/firebase-admin.mjs";

const [, , emailArg, role = "superadmin"] = process.argv;
if (!emailArg || !["student", "admin", "superadmin"].includes(role)) {
  console.error("Usage: node --env-file-if-exists=../.env.local setAdmin.js <auth-email> [student|admin|superadmin]");
  process.exit(1);
}
try {
  const { auth, db, fields } = backend();
  const account = await auth.getUserByEmail(emailArg.trim().toLowerCase());
  const ref = db.doc(`users/${account.uid}`);
  const existing = await ref.get();
  await ref.set({
    ...(existing.exists ? {} : { email: account.email || "", displayName: account.displayName || account.email,
      loginDisabled: false, createdAt: fields.serverTimestamp() }),
    role, schemaVersion: 2, updatedAt: fields.serverTimestamp(),
  }, { merge: true });
  console.log(`Provisioned ${account.uid} with role ${role}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
