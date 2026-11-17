import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { openStore } from "../store.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const grant = {
  version:1,grantId:"auto-worker",secret:"b".repeat(64),examId:"math",
  opensAtMs:Date.now()-10000,closesAtMs:Date.now()+120000,
  questions:[{id:"q",text:"2+2",options:{A:"4",B:"5",C:"6",D:"7"}}],
  candidates:[{uid:"candidate",ticket:"candidate-ticket-1234567890",duration:30,
    session:{studentUid:"candidate",examId:"math",examTitle:"Math",
      questionOrder:["q"],optionOrderByQuestion:{q:["A","B","C","D"]}}}],
};
async function waitFor(check, timeout = 7500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(75);
  }
  throw new Error("Timed out awaiting automatic LAN synchronization.");
}
test("LAN server automatically uploads stored results after WAN returns without CLI", async () => {
  const folder = mkdtempSync(join(tmpdir(),"cbt-auto-sync-"));
  const dbPath = join(folder,"db.sqlite");
  let db = openStore(dbPath);
  db.importBundle(grant); db.close();
  let online = false, requests = 0;
  const cloud = httpServer(async (req,res) => {
    requests++;
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    if (!online) { res.writeHead(503,{"Content-Type":"application/json"});res.end('{"error":"WAN unavailable"}');return; }
    assert.equal(req.headers.authorization,`Bearer ${grant.secret}`);
    const body=JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.action,"lan.sync");
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({accepted:body.records.map(r=>`math_${r.uid}`)}));
  });
  cloud.listen(0,"127.0.0.1");
  await once(cloud,"listening");
  const cloudPort=cloud.address().port;
  const socket=httpServer();
  socket.listen(0,"127.0.0.1");
  await once(socket,"listening");
  const port=socket.address().port;
  await new Promise((r)=>socket.close(r));
  let child=null;
  const start = async () => {
    child=spawn(process.execPath,[fileURLToPath(new URL("../server.js",import.meta.url))], {
      env:{...process.env,HOST:"127.0.0.1",PORT:String(port),CBT_LAN_DB:dbPath,
        CBT_LAN_SYNC_URL:`http://127.0.0.1:${cloudPort}/api/cbt`},
      stdio:["ignore","pipe","pipe"]
    });
    await waitFor(async()=>{
      try{return (await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{return false;}
    });
  };
  const stop = async () => {
    if(child && child.exitCode===null) {
      const exit=once(child,"exit");child.kill("SIGTERM");await exit;
    }
  };
  const summary=()=>{
    const s=openStore(dbPath);
    try{return s.summary();} finally{s.close();}
  };
  try {
    await start();
    const base=`http://127.0.0.1:${port}`;
    const login=await fetch(base+"/api/login",{method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ticket:grant.candidates[0].ticket,deviceId:"computer1"})});
    assert.equal(login.status,200);
    const saved=await fetch(base+"/api/save",{method:"POST",headers:{
      "Content-Type":"application/json",Authorization:`Bearer ${grant.candidates[0].ticket}`},
      body:JSON.stringify({deviceId:"computer1",revision:1,answers:{q:"A"},final:true})});
    assert.equal(saved.status,200);
    await waitFor(()=>requests>=1);
    assert.equal(summary().pending,1,"failed WAN cannot clear queued submission");
    await stop();
    online=true;
    await start();
    await waitFor(()=>summary().synced===1);
    assert.equal(summary().pending,0);
    const before=requests;
    await stop();
    await start();
    await delay(200);
    assert.equal(requests,before,"acknowledged result must not upload again after restart");
  } finally {
    await stop();
    await new Promise((r)=>cloud.close(r));
    rmSync(folder,{recursive:true,force:true});
  }
});
