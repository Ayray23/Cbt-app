import { backend } from "../cbt-app/server/firebase-admin.mjs";

// Firestore-only fresh start. NEVER modifies users/user collections or Firebase Authentication.
// Dry-run by default. Requires verified backup and explicit confirmation to apply.
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  if (!match) throw new Error("Invalid argument");
  return [match[1], match[2] ?? true];
}));
const project = options.project;
if (typeof project !== "string" || !project.trim())
  throw new Error("Required: --project=PROJECT_ID");
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error("Emulator environment detected; refusing live reset.");
const apply = options.apply === true;
if (apply && (options["confirm-project"] !== project ||
    typeof options["backup-confirmed"] !== "string" ||
    !options["backup-confirmed"].trim() ||
    options["school-offline-confirmed"] !== true))
  throw new Error("Apply requires --confirm-project=PROJECT_ID, --backup-confirmed=BACKUP_REFERENCE and --school-offline-confirmed. Verify the backup can be restored and that no exams or pending offline submissions remain.");

const { db } = backend();
if (db.app.options.projectId !== project)
  throw new Error("Configured service account project does not match --project.");

const excludedCollections = new Set(["users", "user"]);
const collections = await db.listCollections();
const targets = collections.filter((c) => !excludedCollections.has(c.id));
const summary = [];
for (const collection of collections) {
  const { count } = (await collection.count().get()).data();
  summary.push({
    collection: collection.id,
    rootDocuments: count,
    action: excludedCollections.has(collection.id) ? "PRESERVE" : "DELETE",
  });
}
console.log(JSON.stringify({
  mode: apply ? "APPLY" : "DRY RUN",
  project,
  authAccounts: "UNTOUCHED",
  collectionPlan: summary,
}, null, 2));

if (!apply) {
  console.log("Dry run only. Root document counts exclude documents under subcollections.");
  process.exit(0);
}

// Refuse to start when other collections are discovered after the preview.
// This forces the operator to inspect the exact target list and plan first.
if (options["confirm-collections"] !== targets.map((c) => c.id).sort().join(","))
  throw new Error("Apply requires --confirm-collections=COMMA_SEPARATED_NAMES from the dry-run target list, sorted alphabetically.");

let deletedRootDocuments = 0;
for (const collection of targets) {
  // Always fetch the first page again after deleting to avoid skipping records.
  while (true) {
    const page = await collection.limit(100).get();
    if (page.empty) break;
    for (const doc of page.docs) {
      await db.recursiveDelete(doc.ref);
      deletedRootDocuments++;
    }
  }
}

const remaining = [];
for (const collection of targets) {
  const { count } = (await collection.count().get()).data();
  if (count) remaining.push({ collection: collection.id, count });
}
console.log(JSON.stringify({
  deletedRootDocuments,
  preservedCollections: [...excludedCollections],
  authAccounts: "UNTOUCHED",
  remaining,
}, null, 2));
if (remaining.length) process.exitCode = 1;
