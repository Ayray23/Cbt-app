# CBT LAN collector (experimental)

Run on a trusted school computer using Node.js 22+:

```sh
cd lan-server
CBT_LAN_TOKEN="replace-with-a-random-secret-at-least-32-chars" HOST=127.0.0.1 npm start
```

The collector persists batches to `data/exam-records.json` with atomic file replacement, revision checks and immutable submitted records. It is **not yet connected** to the React exam app or Firebase. No automatic cloud upload is implemented.

**Security:** This is a prototype, not production LAN authentication. Do not expose this endpoint to students or the internet. The shared bearer token is not suitable for embedding in browser code. Before school deployment, use authenticated per-student sessions, HTTPS, device access controls, audit logs, encrypted backups, durable SQLite transactions, and a privileged cloud-sync worker that verifies Firebase authorization and server exam deadlines. Cloud Functions must remain authoritative for scoring and final submission. Never store correct-answer keys in browser caches.
