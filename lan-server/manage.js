import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openStore } from "./store.js";
const store = openStore(
  resolve(process.env.CBT_LAN_DB || "./data/exams.sqlite"),
);
const [command, ...args] = process.argv.slice(2);
try {
  if (command === "import") {
    store.importBundle(JSON.parse(readFileSync(args[0], "utf8")));
    console.log("Bundle imported. Keep candidate tickets private.");
  } else if (command === "list")
    console.log(JSON.stringify(store.list(), null, 2));
  else if (["extend", "transfer", "finalize"].includes(command)) {
    store.intervene(args[0], command, args[1], args.slice(2).join(" "));
    console.log("Intervention saved and audited.");
  } else if (command === "export") {
    writeFileSync(args[0], JSON.stringify(store.list()), { mode: 0o600 });
    console.log("Recovery copy exported; this does not mark records synced.");
  } else if (command === "sync") {
    const url = new URL(args[0]);
    if (
      url.protocol !== "https:" &&
      !["127.0.0.1", "localhost"].includes(url.hostname)
    )
      throw new Error("Cloud synchronization requires HTTPS");
    for (const bundle of store.batches())
      for (let i = 0; i < bundle.records.length; i += 10) {
        const records = bundle.records.slice(i, i + 10);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bundle.secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "lan.sync",
            grantId: bundle.grantId,
            records,
          }),
          signal: AbortSignal.timeout(30000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Cloud sync failed");
        const expected = new Set(
          records.map((r) => `${bundle.examId}_${r.uid}`),
        );
        if (
          !Array.isArray(result.accepted) ||
          result.accepted.some((id) => !expected.has(id))
        )
          throw new Error("Unexpected cloud acknowledgement");
        store.acknowledge(result.accepted);
        console.log(
          `Cloud acknowledged ${result.accepted.length} submission(s).`,
        );
      }
  } else
    throw new Error(
      "Usage: node manage.js import <bundle.json> | list | sync <https://school/api/cbt> | export <recovery.json> | extend <attempt> <minutes> <reason> | transfer <attempt> <new-device-id> <reason> | finalize <attempt> unused <reason>",
    );
} finally {
  store.close();
}
