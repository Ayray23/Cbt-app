import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openStore } from "./store.js";
import { syncPending } from "./sync.js";
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
  } else if (command === "status") {
    console.log(JSON.stringify(store.summary(), null, 2));
  } else if (command === "sync") {
    const count = await syncPending(store, args[0]);
    console.log(`Cloud acknowledged ${count} submission(s); remaining: ${store.summary().pending}.`);
  } else
    throw new Error(
      "Usage: node manage.js import <bundle.json> | list | status | sync <https://school/api/cbt> | export <recovery.json> | extend <attempt> <minutes> <reason> | transfer <attempt> <new-device-id> <reason> | finalize <attempt> unused <reason>",
    );
} finally {
  store.close();
}
