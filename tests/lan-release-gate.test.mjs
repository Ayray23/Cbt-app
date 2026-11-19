import test from "node:test";
import assert from "node:assert/strict";
import { assertLanAllowed, lanEnabled } from "../server/feature-gates.mjs";
import { POST } from "../api/cbt.mjs";

test("LAN endpoints are disabled by default and only exact true enables them", () => {
  for (const value of [undefined, "false", "TRUE", "1", "", "yes"]) {
    const env = { CBT_ENABLE_LAN: value };
    assert.equal(lanEnabled(env), false);
    for (const action of ["lan.list", "lan.export", "lan.download", "lan.sync"]) {
      assert.throws(() => assertLanAllowed(action, env), {
        status: 503,
        message: /LAN exam mode is disabled/,
      });
    }
    assert.doesNotThrow(() => assertLanAllowed("exam.start", env));
    assert.doesNotThrow(() => assertLanAllowed("questions.create", env));
  }
  assert.equal(lanEnabled({ CBT_ENABLE_LAN:"true" }), true);
  assert.doesNotThrow(() => assertLanAllowed("lan.sync", { CBT_ENABLE_LAN:"true" }));
});

test("real API refuses grant-sync while LAN is disabled without even initializing Firebase Admin", async () => {
  const old = process.env.CBT_ENABLE_LAN;
  delete process.env.CBT_ENABLE_LAN;
  try {
    const response = await POST(new Request("https://school.example/api/cbt", {
      method: "POST",
      headers: { Authorization:"Bearer " + "x".repeat(64), "Content-Type":"application/json" },
      body: JSON.stringify({action:"lan.sync",grantId:"attempt",records:[]}),
    }));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /LAN exam mode is disabled/);
  } finally {
    if (old === undefined) delete process.env.CBT_ENABLE_LAN;
    else process.env.CBT_ENABLE_LAN = old;
  }
});
