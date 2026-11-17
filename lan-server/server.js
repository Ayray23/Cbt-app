import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { openStore } from "./store.js";
import { syncPending, validateCloudUrl } from "./sync.js";
const host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 8788);
const tls = process.env.CBT_LAN_TLS_KEY && process.env.CBT_LAN_TLS_CERT;
// The TLS-terminating Caddy proxy must be on the same host. Do not trust
// forwarded client identity from non-loopback connections.
const publicOrigin = process.env.CBT_LAN_PUBLIC_ORIGIN || "";
if (publicOrigin) {
  const url = new URL(publicOrigin);
  if (url.protocol !== "https:" || url.origin !== publicOrigin || url.username || url.password) {
    throw new Error("CBT_LAN_PUBLIC_ORIGIN must be an HTTPS origin without a path.");
  }
}
if (!tls && !["127.0.0.1", "::1", "localhost"].includes(host))
  throw new Error(
    "LAN access requires trusted HTTPS. Configure CBT_LAN_TLS_KEY and CBT_LAN_TLS_CERT.",
  );
const store = openStore(
  resolve(process.env.CBT_LAN_DB || "./data/exams.sqlite"),
);
const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/sw.js", ["sw.js", "text/javascript"]],
]);
const attempts = new Map();
// Always retain submissions on disk while internet is unavailable. Enabling
// this requires an explicit staging/production cloud API destination.
const cloudSyncUrl = process.env.CBT_LAN_SYNC_URL || "";
if (cloudSyncUrl) validateCloudUrl(cloudSyncUrl);
const syncIntervalMs = Math.max(10000, Math.min(3600000,
  Number(process.env.CBT_LAN_SYNC_INTERVAL_MS) || 30000));
let syncRunning = null;
let shuttingDown = false;
function requestSync() {
  if (!cloudSyncUrl || shuttingDown || syncRunning) return;
  syncRunning = (async () => {
    try {
      if (!store.summary().pending) return;
      const accepted = await syncPending(store, cloudSyncUrl);
      if (accepted) console.log(`Cloud accepted ${accepted} LAN submission(s).`);
    } catch (error) {
      // Never stop exam access or remove pending answers because the WAN fails.
      console.warn(`LAN results remain queued; cloud sync deferred: ${error.message}`);
    }
  })().finally(() => { syncRunning = null; });
}
const syncTimer = cloudSyncUrl ? setInterval(requestSync, syncIntervalMs) : null;
syncTimer?.unref();
const send = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
};
const handler = async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health")
      return send(res, 200, { ok: true });
    if (req.method === "GET" && files.has(req.url)) {
      const [file, type] = files.get(req.url);
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-cache",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      });
      let content = readFileSync(new URL(`./public/${file}`, import.meta.url));
      if (file === "sw.js")
        content = content.toString().replace(
          "school-lan-shell-v1",
          "school-lan-shell-" +
            createHash("sha256")
              .update(readFileSync(new URL("./public/app.js", import.meta.url)))
              .digest("hex")
              .slice(0, 12),
        );
      return res.end(content);
    }
    if (req.method !== "POST" || !["/api/login", "/api/save"].includes(req.url))
      return send(res, 404, { error: "Not found" });
    const origin = req.headers.origin;
    if (origin && origin !== (publicOrigin || `${tls ? "https" : "http"}://${req.headers.host}`))
      return send(res, 403, { error: "Wrong origin" });
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 200000)
        return send(res, 413, { error: "Request too large" });
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
    }
    if (req.url === "/api/login") {
      const socketIp = req.socket.remoteAddress;
      const proxyIp = req.headers["x-cbt-client-ip"];
      const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socketIp);
      // Caddy overwrites this header with the real TCP peer IP. Honour it
      // only when the proxy is configured and the socket peer is loopback;
      // otherwise a remote student could forge identities to evade limits.
      const ip =
        publicOrigin && loopback && typeof proxyIp === "string" && isIP(proxyIp)
          ? proxyIp
          : socketIp;
      const rate = attempts.get(ip) || { count: 0, until: Date.now() + 60000 };
      if (Date.now() > rate.until) {
        rate.count = 0;
        rate.until = Date.now() + 60000;
      }
      rate.count++;
      attempts.set(ip, rate);
      if (rate.count > 30)
        return send(res, 429, { error: "Too many attempts. Wait one minute." });
      return send(res, 200, store.login(body.ticket, body.deviceId));
    }
    const ticket = req.headers.authorization?.replace(/^Bearer /, "");
    const result = store.update(ticket, body.deviceId, body);
    send(res, 200, result);
    if (result.closed) setImmediate(requestSync);
    return;
  } catch (e) {
    send(res, e.status || 500, {
      error: e.status
        ? e.message
        : "LAN service error. Keep this computer open and contact the supervisor.",
    });
  }
};
const server = tls
  ? httpsServer(
      {
        key: readFileSync(process.env.CBT_LAN_TLS_KEY),
        cert: readFileSync(process.env.CBT_LAN_TLS_CERT),
      },
      handler,
    )
  : httpServer(handler);
server.listen(port, host, () => {
  console.log(`CBT LAN ready at ${tls ? "https" : "http"}://${host}:${port}`);
  if (cloudSyncUrl) {
    console.log("Automatic cloud reconciliation enabled; pending results stay in SQLite until acknowledged.");
    requestSync();
  }
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    shuttingDown = true;
    if (syncTimer) clearInterval(syncTimer);
    server.close(async () => {
      // Wait for an already-running cloud request before closing the DB.
      if (syncRunning) await syncRunning;
      store.close();
      process.exit(0);
    });
  });
