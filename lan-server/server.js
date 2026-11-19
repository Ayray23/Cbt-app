import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { openStore } from "./store.js";
const host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 8788);
const tls = process.env.CBT_LAN_TLS_KEY && process.env.CBT_LAN_TLS_CERT;
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
    if (origin && origin !== `${tls ? "https" : "http"}://${req.headers.host}`)
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
      const ip = req.socket.remoteAddress;
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
    return send(res, 200, store.update(ticket, body.deviceId, body));
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
server.listen(port, host, () =>
  console.log(`CBT LAN ready at ${tls ? "https" : "http"}://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
