import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";

const TOKEN = "test-token-0123456789-abcdefghijklmnopqrstuvwxyz";
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}
async function waitUntilReady(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("LAN server exited before becoming ready");
    try {
      const response = await fetch(url + "/health");
      if (response.ok) return;
    } catch { /* Startup is still in progress. */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("LAN server did not start");
}
async function startServer(port, dataFile) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1",
      CBT_LAN_DATA_FILE: dataFile, CBT_LAN_TOKEN: TOKEN },
    stdio: "ignore",
  });
  await waitUntilReady(`http://127.0.0.1:${port}`, child);
  return child;
}
async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await once(child, "exit");
}
async function request(url, method, payload, token = TOKEN) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: response.status, body: await response.json() };
}
const record = (revision, answers, status = "active") => ({
  id: "exam1_student1", examId: "exam1", uid: "student1",
  revision, answers, status,
});

test("LAN collector authenticates, batches, persists, rejects stale writes and freezes submissions", async () => {
  const folder = await mkdtemp(join(tmpdir(), "cbt-lan-test-"));
  const dataFile = join(folder, "records.json");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let child;
  try {
    child = await startServer(port, dataFile);
    assert.equal((await request(url + "/records", "GET", undefined, "wrong")).status, 401);
    assert.equal((await request(url + "/records/batch", "POST", { records: [record(1, { q1: "A" })] })).status, 200);
    assert.equal((await request(url + "/records/batch", "POST", { records: [record(0, { q1: "B" })] })).status, 200);
    let result = await request(url + "/records", "GET");
    assert.deepEqual(result.body.records[0].answers, { q1: "A" });
    assert.equal((await request(url + "/records/batch", "POST", { records: [record(2, { q1: "C" }, "submitted")] })).status, 200);
    assert.equal((await request(url + "/records/batch", "POST", { records: [record(3, { q1: "D" })] })).status, 200);
    result = await request(url + "/records", "GET");
    assert.equal(result.body.records[0].status, "submitted");
    assert.deepEqual(result.body.records[0].answers, { q1: "C" });
    assert.equal((await request(url + "/records/batch", "POST", { records: [record(-1, {})] })).status, 400);
    assert.equal((await request(url + "/records/batch", "POST", { records: Array(101).fill(record(1, {})) })).status, 400);
    await stopServer(child);
    child = await startServer(port, dataFile);
    result = await request(url + "/records", "GET");
    assert.equal(result.body.records.length, 1);
    assert.deepEqual(result.body.records[0].answers, { q1: "C" });
  } finally {
    if (child) await stopServer(child);
    await rm(folder, { recursive: true, force: true });
  }
});
