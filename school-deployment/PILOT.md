# School LAN staging and supervised pilot

## Status and limits
This is a **staging-only** HTTPS static frontend configuration. As of this branch, exam start, question delivery and server-side finalisation still depend on Firebase. The `lan-server` shared-token collector is experimental and not integrated. Its token MUST NOT be embedded in any browser app. Keep that collector bound to loopback and do not reverse-proxy it for students. Do not claim an offline exam is ready until a separately authenticated LAN exam backend, secure question packaging and server-authoritative submissions are implemented and tested.

## Equipment
- Dedicated Windows or Linux computer with sufficient RAM/storage, reliable SSD, and UPS (size according to tested student concurrency)
- Gigabit switch(es), wired connections where possible, suitable Wi-Fi AP capacity, spare cables, dedicated school LAN
- Node.js 22+, Caddy, local DNS or router DNS control, admin rights on student PCs
- Managed browsers/devices; a backup server and encrypted backup destination
- Internet only for preparing authorised accounts/exams and later cloud reconciliation, once implemented

## Network setup
1. Give the server a DHCP reservation/static IP, for example `192.168.10.10` on a subnet assigned by the school's network administrator. Ensure other devices can ping that address.
2. Add a LAN-only DNS record `cbt.school.test -> 192.168.10.10` on the router or local DNS server. This is an example hostname; choose a name allowed by the school's DNS policy.
3. From the repository root run `powershell -ExecutionPolicy Bypass -File school-deployment/setup-staging.ps1`.
4. Restrict Windows Firewall inbound TCP 443 to the dedicated exam VLAN/subnet; do not forward the port on the internet router. Protect Windows administrative logins.
5. Start Caddy from the repository root: `caddy run --config school-deployment/Caddyfile`. Run it as a managed service for a sustained pilot. Caddy's `tls internal` generates a local CA; securely export its root certificate from Caddy's data directory (or use a managed enterprise CA). Install it into Trusted Root Certification Authorities on **each** managed student computer and trust store of relevant mobile devices, following OS policy. Do not click through TLS warnings.
6. Open `https://cbt.school.test` on one student machine, verify the certificate and loaded assets, then repeat on all device types. Note that the current Firebase flows need internet to work.

## Controlled pilot (only non-sensitive dummy data)
- First run the frontend build and repository tests; record commit SHA and configuration.
- Confirm DNS and HTTPS from each student-device type. Confirm `/records` and `/api/lan` return 403 externally.
- Verify one device, then 5, 20 and the actual planned exam concurrency. Measure server CPU/RAM, Wi-Fi client load, page load and request failures.
- Deliberately disconnect **internet only** while keeping the LAN connected. Record which existing Firebase flows fail; treat any failed exam start/finalisation as a release blocker.
- Disconnect one student device from LAN temporarily, then reconnect. Do not promise answer recovery unless this has been verified.
- Restart the staging server and one device; verify reloading and HTTPS remain functional.
- Run the collectors' Node test suite with `cd lan-server; npm test`. Do not use collector data as official marks.
- Obtain exam supervisor sign-off, restore test accounts and remove dummy data after the pilot.

## Mandatory before production
- Offline LAN server auth per student/role, signed sessions, exam access validation, expiry on trusted server time
- LAN-only exam/question delivery without correct-answer keys, per-student code verification, rate limits
- Transactional storage (e.g. SQLite), audit logs, immutable submissions, idempotency and recovery
- Signed or otherwise verifiable cloud reconciliation with Firebase, conflict resolution and administrative oversight
- Reliable encrypted backups/restores and power-failure tests
- Browser/device kiosk controls, clock-tamper checks, 500-concurrent-device load tests
- End-to-end tests of exam preparation, start, answers, finish, scoring and results while the WAN is disconnected
- Keep exam paper content and student identifiers protected at rest and in transit
