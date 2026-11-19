import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../store.js";
const fixture = () => ({
  version: 1,
  grantId: "grant",
  secret: "a".repeat(64),
  examId: "math",
  title: "Math",
  opensAtMs: 100,
  closesAtMs: 100000,
  questions: [
    {
      id: "q",
      text: "2+2",
      options: { A: "4", B: "3", C: "2", D: "1" },
      marks: 1,
    },
  ],
  candidates: ["a", "b"].map((uid) => ({
    uid,
    name: uid,
    ticket: uid.repeat(24),
    duration: 10,
    session: {
      studentUid: uid,
      examId: "math",
      examTitle: "Math",
      questionOrder: ["q"],
      optionOrderByQuestion: { q: ["A", "B", "C", "D"] },
    },
  })),
});
test("individual tickets, device ownership, stale saves, durable submission and cloud acknowledgements", () => {
  const folder = mkdtempSync(join(tmpdir(), "cbt-lan-"));
  const path = join(folder, "db.sqlite");
  let store = openStore(path, () => 1000);
  try {
    store.importBundle(fixture());
    store.importBundle(fixture());
    assert.throws(() => store.login("wrong".repeat(5), "one"));
    const a = store.login("a".repeat(24), "one");
    assert.equal(a.session.studentUid, "a");
    assert.equal(a.questions[0].correctAnswer, undefined);
    assert.equal(a.secret, undefined);
    assert.throws(() => store.login("a".repeat(24), "two"));
    store.login("b".repeat(24), "two");
    store.update("a".repeat(24), "one", { revision: 2, answers: { q: "A" } });
    store.update("a".repeat(24), "one", { revision: 1, answers: { q: "B" } });
    assert.equal(store.list()[0].answers.q, "A");
    assert.throws(() =>
      store.update("b".repeat(24), "one", { revision: 3, answers: { q: "B" } }),
    );
    store.update("a".repeat(24), "one", {
      revision: 3,
      answers: { q: "C" },
      final: true,
    });
    store.update("a".repeat(24), "one", {
      revision: 4,
      answers: { q: "D" },
      final: true,
    });
    assert.equal(store.list()[0].answers.q, "C");
    store.close();
    store = openStore(path, () => 1000);
    assert.equal(store.batches()[0].records[0].answers.q, "C");
    store.acknowledge(["math_a"]);
    assert.equal(store.batches().length, 0);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
test("LAN interventions target a replacement and preserve original answers; empty attempts cannot be finalized", () => {
  const folder = mkdtempSync(join(tmpdir(), "cbt-lan-"));
  const store = openStore(join(folder, "db.sqlite"), () => 1000);
  try {
    store.importBundle(fixture());
    store.login("a".repeat(24), "one");
    store.update("a".repeat(24), "one", { revision: 1, answers: { q: "A" } });
    store.intervene("math_a", "transfer", "two", "Computer failed");
    assert.throws(() => store.login("a".repeat(24), "one"));
    const a = store.login("a".repeat(24), "two");
    assert.equal(a.session.answers.q, "A");
    store.intervene("math_a", "extend", "5", "Power interruption");
    assert.equal(store.list()[0].expiresAtMs, a.session.expiresAtMs + 300000);
    store.intervene("math_a", "finalize", null, "Student has left");
    assert.equal(store.batches()[0].records[0].answers.q, "A");
    assert.throws(() =>
      store.intervene("math_b", "finalize", null, "Not started"),
    );
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
