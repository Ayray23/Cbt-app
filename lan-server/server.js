import { createServer } from "node:http";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_FILE = resolve(process.env.CBT_LAN_DATA_FILE || "./data/exam-records.json");
const TOKEN = process.env.CBT_LAN_TOKEN;
if (!TOKEN || TOKEN.length < 32) {
  console.error("Set CBT_LAN_TOKEN to a secret of at least 32 characters.");
  process.exit(1);
}
let records = new Map();
try {
  const saved = JSON.parse(await readFile(DATA_FILE, "utf8"));
  records = new Map(saved.map((record) => [record.id, record]));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
let writeChain = Promise.resolve();
async function persist() {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify([...records.values()]), { mode: 0o600 });
  await rename(tmp, DATA_FILE);
}
function authorized(req) {
  const supplied = req.headers.authorization?.replace(/^Bearer /, "") || "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(TOKEN);
  return left.length === right.length && timingSafeEqual(left, right);
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
function validRecord(item) {
  return item && typeof item.id === "string" && /^[a-zA-Z0-9:_-]{1,180}$/.test(item.id)
    && typeof item.examId === "string" && item.examId.length <= 120
    && typeof item.uid === "string" && item.uid.length <= 120
    && item.answers && typeof item.answers === "object" && !Array.isArray(item.answers)
    && Object.keys(item.answers).length <= 500;
}
const server = createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") return send(res, 200, { ok: true });
  if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
  if (req.url === "/records" && req.method === "GET") return send(res, 200, { records: [...records.values()] });
  if (req.url !== "/records/batch" || req.method !== "POST") return send(res, 404, { error: "Not found" });
  let raw = "";
  try {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1_000_000) return send(res, 413, { error: "Batch too large" });
    }
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload.records) || payload.records.length > 100 || !payload.records.every(validRecord))
      return send(res, 400, { error: "Invalid batch" });
    const response = await (writeChain = writeChain.catch(() => {}).then(async () => {
      const next = new Map(records);
      const accepted = [];
      for (const item of payload.records) {
        const previous = next.get(item.id);
        // A submitted record is immutable; retries with the same ID are idempotent.
        if (previous?.status === "submitted") {
          accepted.push(item.id);
          continue;
        }
        const revision = Number(item.revision);
        if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid revision");
        if (!previous || revision >= previous.revision) {
          next.set(item.id, { id: item.id, examId: item.examId, uid: item.uid,
            answers: item.answers, status: item.status === "submitted" ? "submitted" : "active",
            revision, receivedAt: new Date().toISOString() });
        }
        accepted.push(item.id);
      }
      const before = records;
      records = next;
      try { await persist(); } catch (error) { records = before; throw error; }
      return accepted;
    }));
    return send(res, 200, { accepted: response });
  } catch (error) {
    return send(res, error.message === "Invalid revision" ? 400 : 500, { error: error.message === "Invalid revision" ? error.message : "Write failed" });
  }
});
server.listen(PORT, HOST, () => console.log(`CBT LAN collector listening at http://${HOST}:${PORT}`));
