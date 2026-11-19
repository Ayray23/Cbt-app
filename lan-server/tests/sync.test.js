import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../store.js";
import { syncPending, validateCloudUrl } from "../sync.js";

const paper = {
  version: 1, grantId: "batch1", secret: "a".repeat(64), examId: "math",
  opensAtMs: 100, closesAtMs: 100000,
  questions: [{ id: "q1", text: "2+2", options: { A:"4", B:"5", C:"6", D:"7" } }],
  candidates: ["alpha","beta"].map((uid) => ({
    uid, ticket: uid.repeat(8), duration: 10,
    session: { studentUid:uid, examId:"math", examTitle:"Mathematics",
      questionOrder:["q1"], optionOrderByQuestion:{ q1:["A","B","C","D"] } },
  })),
};
test("offline WAN failure preserves pending finals; reconnection uploads and acknowledges once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbt-sync-"));
  const path = join(dir, "db.sqlite");
  let store = openStore(path, () => 500);
  try {
    store.importBundle(paper);
    for (const uid of ["alpha", "beta"]) {
      store.login(uid.repeat(8), uid);
      store.update(uid.repeat(8), uid, { revision:1, answers:{q1:"A"}, final:true });
    }
    let attempts = 0;
    const offline = async () => { attempts++; throw new TypeError("Network unreachable"); };
    await assert.rejects(() => syncPending(store, "https://school.example/api/cbt", {request:offline}));
    assert.equal(attempts, 1);
    assert.deepEqual(store.summary(), { total:2, active:0, pending:2, synced:0 });
    store.close();
    store = openStore(path, () => 1000);
    const calls = [];
    const online = async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      assert.equal(init.headers.Authorization, `Bearer ${paper.secret}`);
      return { ok:true, json:async () => ({accepted:body.records.map((r) => `math_${r.uid}`)}) };
    };
    assert.equal(await syncPending(store, "https://school.example/api/cbt", {request:online}), 2);
    assert.deepEqual(store.summary(), { total:2, active:0, pending:0, synced:2 });
    assert.equal(await syncPending(store, "https://school.example/api/cbt", {request:online}), 0);
    assert.equal(calls.length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive:true, force:true });
  }
});
test("invalid/partial acknowledgements never lose unacknowledged records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbt-sync-"));
  const store = openStore(join(dir, "db.sqlite"), () => 500);
  try {
    store.importBundle(paper);
    store.login("alpha".repeat(8), "alpha");
    store.update("alpha".repeat(8), "alpha", {revision:1, answers:{q1:"B"}, final:true});
    await assert.rejects(() => syncPending(store, "https://school.example/api/cbt", {
      request:async () => ({ok:true,json:async () => ({accepted:["unexpected_attempt"]})})
    }), /Invalid cloud acknowledgement/);
    assert.equal(store.summary().pending, 1);
    await assert.rejects(() => syncPending(store, "https://school.example/api/cbt", {
      request:async () => ({ok:true,json:async () => ({accepted:[]})})
    }), /did not acknowledge/);
    assert.equal(store.summary().pending, 1);
    assert.throws(() => validateCloudUrl("http://public-school.example/api/cbt"), /HTTPS/);
    assert.throws(() => validateCloudUrl("https://user:pass@school.example/api/cbt"), /HTTPS/);
  } finally {
    store.close();
    rmSync(dir, { recursive:true, force:true });
  }
});
