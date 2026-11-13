import { DatabaseSync } from "node:sqlite";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const fail = (ok, message, status = 400) => {
  if (!ok) {
    const e = new Error(message);
    e.status = status;
    throw e;
  }
};
export function openStore(path, now = Date.now) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS bundles(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, uid TEXT NOT NULL, ticket_hash TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, data TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL);`);
  const log = (action, target, detail = {}) =>
    db
      .prepare("INSERT INTO audit(at,action,target,detail) VALUES(?,?,?,?)")
      .run(now(), action, target, JSON.stringify(detail));
  const transaction = (action) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const attempt = (id) => {
    const row = db.prepare("SELECT data FROM attempts WHERE id=?").get(id);
    return row ? JSON.parse(row.data) : null;
  };
  const save = (id, value) =>
    db
      .prepare(
        "INSERT INTO attempts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,synced=0",
      )
      .run(id, JSON.stringify(value));
  const bundle = (id) =>
    JSON.parse(db.prepare("SELECT data FROM bundles WHERE id=?").get(id).data);
  function candidate(ticket) {
    fail(
      typeof ticket === "string" && ticket.length >= 20 && ticket.length <= 100,
      "Invalid candidate ticket",
      401,
    );
    const row = db
      .prepare("SELECT * FROM candidates WHERE ticket_hash=?")
      .get(hash(ticket));
    fail(row, "Invalid candidate ticket", 401);
    return { ...row, profile: JSON.parse(row.data) };
  }
  function packet(c, a) {
    const b = bundle(c.grant_id);
    return {
      session: { ...c.profile.session, ...a },
      questions: b.questions,
      serverNowMs: now(),
    };
  }
  function clean(answers, b) {
    fail(
      answers && typeof answers === "object" && !Array.isArray(answers),
      "Invalid answers",
    );
    return Object.fromEntries(
      b.questions
        .filter((q) => ["A", "B", "C", "D"].includes(answers[q.id]))
        .map((q) => [q.id, answers[q.id]]),
    );
  }
  return {
    close: () => db.close(),
    importBundle(b) {
      fail(
        b?.version === 1 &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(b.grantId) &&
          typeof b.secret === "string" &&
          b.secret.length === 64 &&
          Array.isArray(b.candidates) &&
          b.candidates.length > 0 &&
          b.candidates.length <= 100 &&
          Array.isArray(b.questions) &&
          b.questions.length > 0 &&
          b.questions.length <= 300,
        "Invalid LAN bundle",
      );
      fail(
        b.questions.every((q) => !Object.hasOwn(q, "correctAnswer")),
        "Bundle must not contain answer keys",
      );
      return transaction(() => {
        const previous = db
          .prepare("SELECT data FROM bundles WHERE id=?")
          .get(b.grantId);
        if (previous) {
          fail(
            JSON.parse(previous.data).secret === b.secret,
            "Conflicting bundle",
          );
          return;
        }
        const publicBundle = { ...b, candidates: undefined };
        db.prepare("INSERT INTO bundles VALUES(?,?)").run(
          b.grantId,
          JSON.stringify(publicBundle),
        );
        for (const c of b.candidates) {
          fail(
            c.session?.studentUid === c.uid &&
              c.session?.examId === b.examId &&
              Number.isFinite(c.duration) &&
              c.duration >= 1 &&
              c.duration <= 480 &&
              typeof c.ticket === "string",
            "Invalid candidate",
          );
          const id = `${b.examId}_${c.uid}`;
          db.prepare("INSERT INTO candidates VALUES(?,?,?,?,?)").run(
            id,
            b.grantId,
            c.uid,
            hash(c.ticket),
            JSON.stringify({ ...c, ticket: undefined }),
          );
        }
        log("bundle.import", b.grantId, { count: b.candidates.length });
      });
    },
    login(ticket, deviceId) {
      fail(/^[a-zA-Z0-9_-]{1,128}$/.test(deviceId), "Invalid device ID");
      return transaction(() => {
        const c = candidate(ticket),
          b = bundle(c.grant_id);
        let a = attempt(c.id);
        if (a) {
          fail(
            a.deviceId === deviceId,
            "Attempt belongs to another computer. Ask the supervisor to transfer it.",
            409,
          );
          return packet(c, a);
        }
        fail(
          now() >= b.opensAtMs && now() < b.closesAtMs,
          "Exam entry window is closed",
          409,
        );
        a = {
          examId: b.examId,
          uid: c.uid,
          studentUid: c.uid,
          deviceId,
          startedAtMs: now(),
          expiresAtMs: now() + c.profile.duration * 60000,
          status: "started",
          answers: {},
          revision: 0,
        };
        save(c.id, a);
        log("attempt.start", c.id);
        return packet(c, a);
      });
    },
    update(ticket, deviceId, input) {
      return transaction(() => {
        const c = candidate(ticket),
          b = bundle(c.grant_id),
          a = attempt(c.id);
        fail(
          a && a.deviceId === deviceId,
          "Wrong computer or missing attempt",
          409,
        );
        fail(
          (input.deviceEpoch || 0) === (a.deviceEpoch || 0),
          "Attempt transferred; reload the replacement computer",
          409,
        );
        if (a.status === "submitted")
          return {
            closed: true,
            receipt: c.id,
            submittedAtMs: a.submittedAtMs,
          };
        fail(
          Number.isSafeInteger(input.revision) && input.revision >= 0,
          "Invalid revision",
        );
        if (input.final === true) {
          const final = {
            ...a,
            answers: clean(input.answers, b),
            status: "submitted",
            submittedAtMs: now(),
            clientClosedAtMs: input.closedAtMs || null,
            late: now() > a.expiresAtMs + 30000,
          };
          save(c.id, final);
          log("attempt.submit", c.id, { late: final.late });
          return { closed: true, receipt: c.id };
        }
        if (now() >= a.expiresAtMs)
          return { expired: true, expiresAtMs: a.expiresAtMs };
        if (input.revision > a.revision)
          save(c.id, {
            ...a,
            answers: clean(input.answers, b),
            revision: input.revision,
          });
        return { ok: true, expiresAtMs: a.expiresAtMs };
      });
    },
    intervene(id, operation, value, reason) {
      fail(
        typeof reason === "string" && reason.length >= 5,
        "Provide an intervention reason",
      );
      return transaction(() => {
        const a = attempt(id);
        fail(a && a.status === "started", "Select an active attempt");
        if (operation === "transfer") {
          fail(
            /^[a-zA-Z0-9_-]{1,128}$/.test(value) && value !== a.deviceId,
            "Enter the new computer ID",
          );
          a.deviceId = value;
          a.revision = 0;
          a.deviceEpoch = (a.deviceEpoch || 0) + 1;
        } else if (operation === "extend") {
          const minutes = Number(value);
          fail(
            Number.isInteger(minutes) && minutes >= 1 && minutes <= 120,
            "Use 1–120 minutes",
          );
          a.expiresAtMs = Math.max(now(), a.expiresAtMs) + minutes * 60000;
        } else if (operation === "finalize") {
          a.status = "submitted";
          a.submittedAtMs = now();
          a.finalized = true;
        } else fail(false, "Unknown operation");
        save(id, a);
        log(operation, id, { value, reason });
        return a;
      });
    },
    list: () =>
      db
        .prepare("SELECT id,data,synced FROM attempts")
        .all()
        .map((r) => ({
          id: r.id,
          ...JSON.parse(r.data),
          synced: Boolean(r.synced),
        })),
    batches() {
      const groups = new Map();
      for (const row of db
        .prepare(
          "SELECT a.id,a.data,c.grant_id FROM attempts a JOIN candidates c ON a.id=c.id WHERE a.synced=0",
        )
        .all()) {
        const a = JSON.parse(row.data);
        if (a.status !== "submitted") continue;
        const g = groups.get(row.grant_id) || {
          ...bundle(row.grant_id),
          records: [],
        };
        g.records.push({
          uid: a.uid,
          answers: a.answers,
          startedAtMs: a.startedAtMs,
          submittedAtMs: a.submittedAtMs,
        });
        groups.set(row.grant_id, g);
      }
      return [...groups.values()];
    },
    acknowledge(ids) {
      transaction(() => {
        for (const id of ids)
          db.prepare("UPDATE attempts SET synced=1 WHERE id=?").run(id);
        log("cloud.ack", "batch", { ids });
      });
    },
    verifySecret(a, b) {
      const x = Buffer.from(a),
        y = Buffer.from(b);
      return x.length === y.length && timingSafeEqual(x, y);
    },
  };
}
