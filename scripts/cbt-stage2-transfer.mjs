import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { COLLECTIONS, stage2Sql, validateShadowSnapshot } from "./cbt-stage2-mapping.mjs";

const DESTINATION_REF = "eduqfhveigbazizeapkp";
const PRIVATE_DIR = join(homedir(), ".school-cbt-private");
const usage = [
  "Stage 2 CBT historical snapshot migration",
  "  node scripts/cbt-stage2-transfer.mjs --plan",
  "  node scripts/cbt-stage2-transfer.mjs --export",
  "  node scripts/cbt-stage2-transfer.mjs --verify /absolute/path/snapshot.json",
  "  node scripts/cbt-stage2-transfer.mjs --apply /absolute/path/snapshot.json --confirm-project eduqfhveigbazizeapkp",
  "Export needs FIREBASE_SERVICE_ACCOUNT_JSON and VITE_FIREBASE_PROJECT_ID.",
  "Apply needs psql and PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE=require",
  "and CBT_SUPABASE_PROJECT_REF=eduqfhveigbazizeapkp.",
].join("\n");

function sha(data) {
  return createHash("sha256").update(data).digest("hex");
}
function counts(snapshot) {
  return Object.fromEntries(COLLECTIONS.map(([name]) => [name, snapshot[name].length]));
}
function checkSnapshot(snapshot) {
  validateShadowSnapshot(snapshot);
  return { counts: counts(snapshot), fingerprint: sha(JSON.stringify(snapshot)) };
}
async function loadSnapshot(file) {
  const snapshot = JSON.parse(await readFile(resolve(file), "utf8"));
  const report = checkSnapshot(snapshot);
  console.log("Snapshot fingerprint (SHA-256):", report.fingerprint);
  console.log("Source document counts:", JSON.stringify(report.counts));
  return snapshot;
}
async function exportFirebase() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.VITE_FIREBASE_PROJECT_ID)
    throw new Error("Firebase Admin server credentials and expected Firebase project ID are required. Do not put them in a browser or GitHub.");
  const { backend } = await import("../cbt-app/server/firebase-admin.mjs");
  const { db } = backend();
  const { FieldPath } = await import("firebase-admin/firestore");
  const snap = {};
  // This is deliberately an operator-triggered export, not a scheduled
  // process. It reads Firestore and may consume quota: run only after the
  // current examination and once Firestore is healthy.
  for (const [name] of COLLECTIONS) {
    const docs = [];
    let last;
    for (;;) {
      let query = db.collection(name).orderBy(FieldPath.documentId()).limit(200);
      if (last) query = query.startAfter(last);
      const page = await query.get();
      docs.push(...page.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
      if (page.size < 200) break;
      last = page.docs.at(-1);
    }
    snap[name] = docs;
    console.log(`Read ${name}: ${docs.length} document(s)`);
  }
  const report = checkSnapshot(snap);
  await mkdir(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  const file = join(PRIVATE_DIR, `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  // Owner-only local snapshot. Never publish it to GitHub or the live site.
  await writeFile(file, JSON.stringify(snap), { mode: 0o600, flag: "wx" });
  console.log("PRIVATE snapshot saved:", file);
  console.log("Fingerprint SHA-256:", report.fingerprint);
  console.log("Counts:", JSON.stringify(report.counts));
}
function checkDatabaseTarget() {
  if (process.env.CBT_SUPABASE_PROJECT_REF !== DESTINATION_REF)
    throw new Error(`Explicit CBT_SUPABASE_PROJECT_REF=${DESTINATION_REF} required; other projects are forbidden.`);
  if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGPASSWORD || !process.env.PGDATABASE)
    throw new Error("PGHOST, PGUSER, PGPASSWORD and PGDATABASE must be configured privately.");
  // Direct project database endpoint contains project ref; on shared poolers
  // the PGUSER contains the project ref (e.g. postgres.<ref>).
  if (!process.env.PGHOST.includes(DESTINATION_REF) && !process.env.PGUSER.includes(DESTINATION_REF))
    throw new Error("Database host or pooler username does not identify the dedicated School-CBT project.");
}
async function applySnapshot(file, flags) {
  if (!flags.includes("--confirm-project") ||
      flags[flags.indexOf("--confirm-project") + 1] !== DESTINATION_REF)
    throw new Error(`Explicit --confirm-project ${DESTINATION_REF} required.`);
  checkDatabaseTarget();
  const snapshot = await loadSnapshot(file);
  const sql = stage2Sql(snapshot);
  console.log("Applying only to private cbt_shadow schema. Source Firebase is read-only.");
  const command = spawnSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet"], {
    input: sql, encoding: "utf8", env: { ...process.env, PGSSLMODE: "require" },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (command.error) throw command.error;
  if (command.status !== 0) throw new Error(`PostgreSQL import failed; transaction rolled back: ${command.stderr?.slice(0, 2500)}`);
  console.log("Stage 2 import committed. Confirm database row counts and referential checks before any cutover.");
}
const [mode, path, ...flags] = process.argv.slice(2);
try {
  if (mode === "--plan") console.log(usage);
  else if (mode === "--export") await exportFirebase();
  else if (mode === "--verify" && path) await loadSnapshot(path);
  else if (mode === "--apply" && path) await applySnapshot(path, flags);
  else throw new Error(usage);
} catch (error) {
  console.error("Stage 2 stopped safely:", error.message);
  process.exitCode = 1;
}
