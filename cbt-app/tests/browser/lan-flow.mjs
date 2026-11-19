import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createService } from "../../../server/service.mjs";
import { openStore } from "../../../lan-server/store.js";
assert(process.env.FIRESTORE_EMULATOR_HOST, "Emulator required");
const app = initializeApp({ projectId: "demo-cbt-school" }, "lan-browser");
const db = getFirestore(app);
const service = createService({ db, auth: {}, fields: FieldValue });
const owner = { uid: "lan-owner", role: "superadmin" };
const examId = "lan-browser-paper";
await db
  .doc(`exams/${examId}`)
  .set({
    createdBy: owner.uid,
    status: "draft",
    title: "LAN Mathematics",
    duration: 30,
    className: "JSS1",
    subject: "Math",
    academicSession: "2026/2027",
    term: "First",
  });
await db
  .doc("questions/lan-q")
  .set({
    examId,
    text: "Two plus two?",
    options: { A: "4", B: "3", C: "2", D: "1" },
    marks: 2,
    correctAnswer: "A",
    createdBy: owner.uid,
  });
for (const uid of ["lan-a", "lan-b"])
  await db
    .doc(`users/${uid}`)
    .set({
      role: "student",
      displayName: uid,
      username: uid,
      className: "JSS1",
      subjects: ["Math"],
      academicSession: "2026/2027",
    });
await service.execute(owner, "exams.publish", { examId });
const bundle = await service.execute(owner, "lan.export", {
  examId,
  studentIds: ["lan-a", "lan-b"],
});
const folder = mkdtempSync(join(tmpdir(), "cbt-lan-browser-")),
  path = join(folder, "db.sqlite");
let store = openStore(path);
store.importBundle(bundle);
store.close();
let child, browser;
async function boot() {
  child = spawn(process.execPath, ["../lan-server/server.js"], {
    env: { ...process.env, PORT: "8788", HOST: "127.0.0.1", CBT_LAN_DB: path },
    stdio: "inherit",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8788/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("LAN failed to start");
}
async function stop() {
  if (child && child.exitCode === null) {
    await new Promise((r) => {
      child.once("exit", r);
      child.kill();
    });
  }
}
try {
  await boot();
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const first = await browser.newContext(),
    second = await browser.newContext();
  const a = await first.newPage(),
    b = await second.newPage();
  for (const [page, candidate] of [
    [a, bundle.candidates[0]],
    [b, bundle.candidates[1]],
  ]) {
    await page.goto("http://127.0.0.1:8788");
    await page.locator("#ticket").fill(candidate.ticket);
    await page.locator("#start").click();
    await page.locator("input[value=A]").waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready);
  }
  await a.locator("input[value=A]").check();
  await a.getByText("Saved on this computer.", { exact: true }).waitFor();
  await first.setOffline(true);
  await a.reload();
  await a.locator("input[value=A]").waitFor();
  assert(
    await a.locator("input[value=A]").isChecked(),
    "IndexedDB preserves selected answer after offline reload",
  );
  a.on("dialog", (d) => d.accept());
  await a.locator("#submit").click();
  await a
    .getByText("Exam closed and saved on this computer.", { exact: false })
    .waitFor();
  await a.reload();
  await a.locator("#submit:disabled").waitFor();
  await b.locator("input[value=B]").check();
  b.on("dialog", (d) => d.accept());
  await b.locator("#submit").click();
  await b
    .getByText("Submission received by the school LAN server.", { exact: true })
    .waitFor();
  await first.setOffline(false);
  await a.locator("#retry").click();
  await a
    .getByText("Submission received by the school LAN server.", { exact: true })
    .waitFor();
  await stop();
  await boot();
  store = openStore(path);
  assert.equal(store.list().filter((r) => r.status === "submitted").length, 2);
  const batch = store.batches()[0];
  const payload = { grantId: batch.grantId, records: batch.records };
  const ack = await service.syncLan(batch.secret, payload);
  await service.syncLan(batch.secret, payload);
  store.acknowledge(ack.accepted);
  assert.equal(store.batches().length, 0);
  store.close();
  assert.equal(
    (await db.doc(`examResults/${examId}_lan-a`).get()).data().finalScore,
    2,
  );
  assert.equal(
    (await db.doc(`examResults/${examId}_lan-b`).get()).data().finalScore,
    0,
  );
  assert.equal(
    (await db.doc(`examResults/${examId}_lan-a`).get()).data().requiresReview,
    true,
  );
  console.log(
    "PASS: two independent LAN browsers → offline answer/reload/submit/reload → reconnect → SQLite restart → duplicate-safe cloud grading",
  );
} finally {
  await browser?.close();
  await stop();
  await deleteApp(app);
  rmSync(folder, { recursive: true, force: true });
}
