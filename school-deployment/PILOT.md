# School LAN deployment and supervised pilot (PR #17 integration)

**Status:** Stage 5 staging guidance; not a production/high-stakes certification.
PR #17 is the offline implementation. The three-file PR #19 example served a
Firebase-dependent React build and **must not** be deployed as an offline exam
host. This configuration serves the separate PR #17 `lan-server` portal.

## Architecture and trust boundaries

```text
Student PCs -- https://cbt.school.test:443 -- Caddy (trusted local CA)
                                                  |
                                              loopback HTTP
                                                  |
                                         Node 24 (127.0.0.1:8788)
                                                  |
                                  private SQLite WAL DB + candidate bundles
                                                  
Superadmin cloud app (online) -> download private ticket bundles -> import by staff
LAN server (after exam + internet returns) -> HTTPS cloud /api/cbt LAN sync
```

The hostname is **illustrative**. Replace it with the school's managed name
and map it to the private LAN IP in its router/local DNS. A private DNS record
must still resolve when the WAN is unplugged. Caddy only handles TLS; the
student UI, login, offline caching, secure ticket checks, saved answers and
SQLite persistence all come from `lan-server`. Do **not** put answer keys,
Firebase Admin credentials, bundle secrets or candidate JSON in Caddy's
document root. No root website directory is needed.

## Prerequisites

- Dedicated Windows host with Node.js **24+**, Caddy v2, protected disk and
  UPS; host clock synchronized and verified before disconnection
- Managed school lab devices, modern Chromium-based browsers with Web Locks
  and IndexedDB, reliable router/switches/AP capacity, spare cables
- Local DNS for `cbt.school.test` -> the assigned private server IP; dedicated
  school exam subnet (example `192.168.10.0/24`, **not** a fixed requirement)
- Caddy internal CA trusted on all exam PCs, using school IT management
- Staging cloud app/API plus matching Firestore rules/indexes and verified
  staff roles; superadmin online to prepare papers and candidate bundles

## Host setup (Windows PowerShell)

From the repository root on the school server:

```powershell
# Replace hostname/path/subnet with actual school values.
powershell -ExecutionPolicy Bypass -File school-deployment/setup-staging.ps1 `
  -Hostname cbt.school.test -DatabasePath C:\SchoolCBT\private\exams.sqlite

# While internet is still available, export 5 private batches of <=100
# students per bundle using "Offline LAN exams" in the staging cloud app.
# Transfer bundles over a secure staff-only medium; no public web folder.
$env:CBT_LAN_DB = 'C:\SchoolCBT\private\exams.sqlite'
cd lan-server
node manage.js import C:\SchoolCBT\private\bundle-1.json
# Import bundle-2 through bundle-5; do not reissue tickets casually.
node manage.js list
cd ..

# Run in TWO separate terminals (or managed services after validation):
powershell -File school-deployment/start-lan.ps1 -Hostname cbt.school.test
powershell -File school-deployment/start-proxy.ps1 -Hostname cbt.school.test
```

Set TCP **443** inbound for exam-subnet source addresses only. Do not publish
port 8788 (loopback only), Caddy port 2019, SMB, RDP or database files to
students; do not configure router port forwarding. Install the local Caddy CA
root on every managed exam PC with school IT approval. Persist/protect Caddy's
private CA directory across restarts. Never click through an HTTPS warning.

On a student computer, browse to `https://cbt.school.test` (no port suffix).
Check the valid trusted certificate, page title **School LAN examination**,
and each student's own ticket. Verify that `/health` responds, while
`/records` and `/api/lan` are blocked. After the paper is prepared and
imported, an initial login requires only LAN, **not internet**. Once logged
in, a candidate may continue through a temporary local LAN outage using the
previously cached paper; recovery still requires preserved browser data.

## Controlled pilot with dummy candidates (supervised)

1. Record exact commit SHA, Node/Caddy versions, staging project, hostname,
   device/browser types, router/AP model, and initial DB backup.
2. Check 1, then 5, then 20 real exam devices. Start, answer, navigate, submit,
   and confirm the school server receipt; verify every submission in SQLite.
3. Disable **internet only**, retain LAN: fresh ticket login, saved answers,
   exam completion and LAN receipts must all work.
4. Disconnect a device from **LAN after initial login**, select an answer,
   close/reopen the cached page, submit, restore LAN, upload and confirm
   exactly one final submission with the saved answer.
5. Unplug server network temporarily, then restore it. Repeat with a controlled
   **service restart**; confirm SQLite sessions survive and Caddy's CA remains
   trusted. Use UPS and a safe controlled power-recovery drill; do not pull
   power from the live database without an approved recovery procedure.
6. Validate one failed/reused/wrong-device ticket, a supervised exact-device
   transfer, expired timing, staff intervention audit and late-final review.
7. Restore internet and run cloud sync from the host with
   `node manage.js sync https://YOUR-CLOUD-HOST/api/cbt`. Re-run the command
   to prove idempotency; compare result counts and review flags in the
   staging examiner dashboard. Review all imported marks before release.
8. Load test 50, 100, 250 and **500 simultaneous candidates**, with realistic
   answer-save and submit bursts. Use real devices where possible plus a
   representative client generator routed through Caddy, not directly to
   port 8788. The login throttle is per actual proxied device IP.
9. Collect CPU, RAM, disk write and WAL growth, network throughput, login
   success/error rates, p95 answer-save latency, duplicate/missing records,
   simultaneous submission outcomes and service restarts. Test backups,
   restores and network-failure recovery under the selected load.
10. Document sign-offs by developer, examiner and school IT lead. Remove
    staging private candidate data according to the agreed retention policy.

**Minimum acceptance gates:** all 500 attempts uniquely authorized; 500
submitted records with no lost answers, unauthorized starts, duplicate marks
or unreviewed releases; no unreconciled submission errors; service and CA
recover without manual bypasses; an independently restored encrypted backup
contains the correct attempts. Choose performance budgets with the school
before the test; **do not claim 500-seat capacity from source tests alone**.

## Backup, restore and operational safeguards

Keep SQLite, WAL/SHM files, saved private bundles and the Caddy CA in protected,
access-controlled locations. Make encrypted offline/off-host backups. For a
simple **cold backup**, stop the Node process gracefully, copy the database
and any WAL/SHM files together, then start it again. Do not copy only the main
SQLite file while the service is running. Alternatively use a verified
SQLite-consistent online-backup tool. Restore into an isolated host, import no
new tickets, verify `node manage.js list`, expected answer counts and cloud
sync status, then discard the isolated test. The `manage.js export` JSON is
**not** a complete backup.

Operate Node and Caddy as managed auto-restart services with restricted
service accounts after the pilot; the supplied scripts are foreground pilot
launchers, not service installation. Keep UPS, accurate server time,
encrypted storage, restricted firewall and supervisor escalation procedures.
Because offline device timestamps are not independently trusted, results
still require examiner review before official release.

**No direct production deploy/merge** until this pilot, staging Firebase/Vercel
rollout and rules/index checks are signed off. See `lan-server/README.md`
and `docs/SECURE-ROLLOUT.md`.
