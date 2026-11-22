import { backend } from "../cbt-app/server/firebase-admin.mjs";

// Server-only maintenance tool. Dry run unless explicitly applied.
// Back up and restore-test BOTH Firestore and Firebase Authentication first.
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  if (!match) throw new Error("Invalid argument");
  return [match[1], match[2] ?? true];
}));
const project = options.project;
const keepUid = options["keep-uid"];
if (!project || !keepUid || typeof project !== "string" || typeof keepUid !== "string")
  throw new Error("Required: --project=PROJECT_ID --keep-uid=SUPERADMIN_UID");
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error("Emulator environment detected; refusing live reset.");
const apply = options.apply === true;
if (apply && (options["confirm-project"] !== project ||
    typeof options["backup-confirmed"] !== "string" ||
    !options["backup-confirmed"].trim() ||
    options["school-offline-confirmed"] !== true))
  throw new Error("To apply, require matching --confirm-project, --backup-confirmed=BACKUP_REFERENCE, and --school-offline-confirmed. Verify backup restoration and that no exams or unsynced attempts remain.");

const { db, auth } = backend();
if (db.app.options.projectId !== project) throw new Error("Firebase project ID mismatch");
const protectedAuth = await auth.getUser(keepUid);
const profile = await db.doc(`users/${keepUid}`).get();
if (!profile.exists || profile.data().role !== "superadmin" || protectedAuth.disabled)
  throw new Error("Protected UID must be an enabled superadmin with a Firestore profile.");

const otherAuthUids = [];
let token;
do {
  const batch = await auth.listUsers(1000, token);
  otherAuthUids.push(...batch.users.filter(user => user.uid !== keepUid).map(user => user.uid));
  token = batch.pageToken;
} while (token);
const collections = await db.listCollections();
const counts = [];
for (const collection of collections) {
  const count = (await collection.count().get()).data().count;
  counts.push({ collection: collection.id, rootDocuments: count,
    preserved: collection.id === "users" ? 1 : 0 });
}
console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY RUN", project,
  preservedUid: keepUid, otherAuthUsers: otherAuthUids.length, counts }, null, 2));
if (!apply) {
  console.log("Read-only preview. Nested subcollections are not included in root counts.");
  process.exit(0);
}

// Each document is recursively deleted including subcollections.
// The chosen superadmin document and its subcollections remain untouched.
let removedDocs = 0;
for (const collection of collections) {
  let cursor;
  while (true) {
    let query = collection.orderBy("__name__").limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      if (collection.id === "users" && doc.id === keepUid) continue;
      await db.recursiveDelete(doc.ref);
      removedDocs++;
    }
    cursor = page.docs[page.docs.length - 1];
  }
}
let removedAccounts = 0;
const failures = [];
for (const uid of otherAuthUids) {
  try { await auth.deleteUser(uid); removedAccounts++; }
  catch (error) { failures.push({ uid, code: error.code || "unknown" }); }
}
const accountStillExists = await auth.getUser(keepUid);
const profileStillExists = await db.doc(`users/${keepUid}`).get();
if (accountStillExists.uid !== keepUid || !profileStillExists.exists ||
    profileStillExists.data().role !== "superadmin")
  throw new Error("CRITICAL: protected superadmin verification failed");
console.log(JSON.stringify({ removedRootDocs: removedDocs, removedAuthUsers: removedAccounts,
  failures, superadminPreserved: true }, null, 2));
if (failures.length) process.exitCode = 1;
