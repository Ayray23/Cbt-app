import { createServer } from "node:http";
import { POST } from "../api/cbt.mjs";

createServer(async (req, res) => {
  if (req.url !== "/api/cbt" || req.method !== "POST") { res.writeHead(404).end(); return; }
  try {
    const response = await POST(new Request("http://127.0.0.1:8787/api/cbt", {
      method: "POST", headers: req.headers, body: req, duplex: "half",
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); res.writeHead(500).end(); }
}).listen(8787, "127.0.0.1", () => console.log("CBT API: http://127.0.0.1:8787"));
