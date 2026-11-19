# School LAN exam service

This completes the collector prototype from PR #16 as a separate school-hosted student exam portal. It uses Node 24 SQLite (WAL, synchronous FULL), individual candidate tickets, server-controlled device ownership and deadlines, durable IndexedDB browser packets, and a privileged local CLI for cloud synchronization. No shared collector token is embedded in student browsers. No answer key is exported to the LAN/browser; cloud grading uses the original immutable paper.

## Prepare while online

1. Deploy the integrated cloud app/API and Firestore rules/indexes to staging first. Configure explicit `VITE_FIREBASE_*` values and server-only Firebase Admin credentials as described in `docs/SECURE-ROLLOUT.md`.
2. As superadmin, publish a paper, open **Offline LAN exams**, and select up to 100 eligible students. For 500 students, prepare five groups. Download each private bundle and print/cut tickets so each student receives only their own ticket.
3. These attempts are reserved in the cloud, preventing a second online attempt. A bundle cannot be treated as cancelled merely because it was downloaded accidentally: it may already exist on an offline host. Recover the original bundle through the same screen if needed. After all LAN results synchronize, normal result review/release applies.
4. Copy the bundle securely onto the school host. It contains a cloud synchronization secret and candidate tickets. Never place it in a web-served folder or commit it to git.

## Run the school host

Use Node **24 or later**. No additional LAN npm dependencies are required.

```sh
cd lan-server
node manage.js import /secure/path/lan-bundle.json
node server.js
```

By default the service binds to `127.0.0.1:8788` for local testing. To serve students over the school network, set these environment variables before running it:

```sh
HOST=0.0.0.0
PORT=8788
CBT_LAN_DB=/secure/path/exams.sqlite
CBT_LAN_TLS_KEY=/secure/path/school-lan.key
CBT_LAN_TLS_CERT=/secure/path/school-lan.crt
```

The certificate must match the hostname students use and be trusted on every exam computer. Arrange local DNS (or the corresponding managed hosts entry) so that address resolves without internet. Remote HTTP is refused because service workers, Web Locks and offline recovery require a secure browser context. Do not ask students to bypass certificate warnings. Open only the exam port on the school firewall; keep the host and its OS account under staff control.

Students open `https://<school-lan-host>:8788`, enter their own ticket, and start/continue their exam. First login needs the LAN server, but no internet. The browser installs the shell and saves each answer in IndexedDB. Progress reaches the LAN host every 30 seconds; final submissions are persisted locally before upload. If the LAN itself disconnects, a previously opened paper can continue and close locally, then upload when LAN connectivity returns. The deadline continues while the page is closed. The local host must keep accurate time.

## Staff operations on the host

```sh
node manage.js list
node manage.js extend <examId_studentUid> 5 "Power interruption"
node manage.js transfer <examId_studentUid> <replacement-computer-id> "Computer failure"
node manage.js finalize <examId_studentUid> unused "Candidate left; use last saved answers"
node manage.js export /secure/path/recovery-records.json
node manage.js sync https://your-school-domain/api/cbt
```

The computer ID is displayed on the LAN login page. A transfer selects that exact replacement; the old device cannot reclaim the attempt. Stop the old computer and upload its pending work before transferring. If a device has unuploaded answers, keep its browser data and reconnect it before transfer whenever possible. Finalizing explicitly uses the last LAN-server answers and cannot recover data from a destroyed device. Do not finalize while an unsynced candidate still needs to upload.

`sync` sends final records in batches of 10, marks each as synced only after the cloud acknowledges it, and can be rerun after interruption. Conflicting replays are rejected; existing cloud results are preserved. Run this command when internet returns; automate this command using the school's service scheduler if desired. No persistent Firebase service-account key is required on the LAN host. The imported grant secret is scoped to that prepared candidate group. Offline timing/device evidence is not independently trusted by the cloud, so every LAN result requires examiner review before release.

## Backups and rollout

Keep the host disk encrypted and restrict its folder/OS account. Stop the service before a simple filesystem backup of the database and its `-wal`/`-shm` files; alternatively use a SQLite-consistent backup process. Encrypt backups, store a separate copy, and perform a restore drill. A records JSON export is a recovery aid, not a complete database backup (it does not contain bundles/ticket mappings). Retain bundles and the database until the cloud confirms every result and the school's retention policy permits deletion.

Run `npm test` here. CI also runs `npm run test:lan-browser --prefix cbt-app` from the repository root: two isolated browsers, offline reload/submission/reload, reconnect, SQLite restart and repeated cloud synchronization. This is not a certification for 500 physical school computers. Before real use test the actual router, trusted certificates, host hardware, backups, simultaneous candidates and power/UPS recovery. Public cloud changes cannot provision the school's local network or certificate trust.
