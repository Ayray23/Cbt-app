import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

test("trusted HTTPS proxy origin and individual LAN IPs do not share a 30-login quota", async () => {
  const folder = mkdtempSync(join(tmpdir(), "cbt-lan-http-"));
  const port = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.js", import.meta.url))], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      CBT_LAN_DB: join(folder, "attempts.sqlite"),
      CBT_LAN_PUBLIC_ORIGIN: "https://cbt.school.test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error("LAN process failed: " + log);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) { ready = true; break; }
      } catch {}
      await pause(100);
    }
    assert(ready, "LAN server did not start: " + log);
    const login = (ip, origin = "https://cbt.school.test") =>
      fetch(`http://127.0.0.1:${port}/api/login`, {
        method: "POST",
        headers: {
          Origin: origin,
          "X-CBT-Client-IP": ip,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ticket: "invalid-candidate-ticket-1234", deviceId: "test-browser" }),
      });
    assert.equal((await login("192.168.10.10", "https://evil.example")).status, 403);
    for (let i = 0; i < 30; i++) {
      const result = await login("192.168.10.10");
      assert.equal(result.status, 401, "individual invalid ticket should fail without global throttling");
    }
    assert.equal((await login("192.168.10.10")).status, 429);
    assert.equal((await login("192.168.10.11")).status, 401,
      "second student's LAN IP must have its own independent rate limit");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), pause(3000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
