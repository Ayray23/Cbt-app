# Integrated CBT release verification — 19 November 2026

**Status: SOURCE CONSOLIDATED, PRODUCTION NOT AUTHORIZED.**

This verification branch was cut from merged `main` after PR #34, to run
the **entire** School CBT GitHub Actions suite against the combined source,
rather than relying only on old individual-feature checks.

## Release evidence

| Check | Current result |
| --- | --- |
| Secure school core, teacher, offline, LAN staging, Excel and LAN auto-sync branches | Merged to `main` through PRs #14, #15, #17, #20, #22, #23 |
| Privileged LAN API disabled by default | PR #34 merged; server flag `CBT_ENABLE_LAN=false` |
| LAN UI disabled by default | Frontend `VITE_ENABLE_LAN=false` |
| Legacy branch conflicts | Closed as superseded without deleting source; see issue #33 |
| Vercel deployment protection | Build-skipping hold active, leaving earlier READY deployment |
| Vercel Firebase environment | **BLOCKED**: missing `FIREBASE_SERVICE_ACCOUNT_JSON` and `VITE_FIREBASE_*` |
| Production migration and backup restore | **BLOCKED**: no connected Firebase project access or verified restore |
| School LAN trusted DNS/HTTPS/UPS/500-seat pilot | **BLOCKED**: no access to actual school lab hardware |
| Test suite against merged main | Run `School CBT checks` on this exact branch's PR and record conclusion in issue #33 |

## Required private configuration for staging and production

- `VITE_FIREBASE_API_KEY` — matching Firebase web app public config
- `VITE_FIREBASE_AUTH_DOMAIN` — web Auth domain
- `VITE_FIREBASE_PROJECT_ID` — chosen school project
- `VITE_FIREBASE_APP_ID` — web app identifier
- `VITE_FIREBASE_STORAGE_BUCKET` — if Storage is used
- `VITE_FIREBASE_MESSAGING_SENDER_ID` — if messaging config is used
- `FIREBASE_SERVICE_ACCOUNT_JSON` — **sensitive server-only JSON**, never
  include `VITE_` prefix or commit it, share it by email, or paste into GitHub
- `CBT_ENABLE_LAN=false` and `VITE_ENABLE_LAN=false` until school LAN approval.

Frontend and server config **must refer to the same Firebase project**.
Set values privately via Vercel Project Settings -> Environment Variables.
Do not invent credentials or use a development/emulator key in production.

## Production maintenance / migration sequence

1. Confirm the right Vercel project and Firebase project, current Auth users,
   trusted owner role, and a verified Firestore+Auth backup **restore**.
2. Confirm no exam is running and every student/host has exported or
   acknowledged pending offline answers. Schedule downtime.
3. Use the exact migration in `scripts/migrate-secure.mjs` with an
   authenticated staging environment. First dry-run and review; do not apply
   against production while candidate exams are active.
4. Deploy strict Firestore rules/indexes and migration in the documented
   maintenance order. Retire old deployed grading/start/submit callables.
5. Build using the configured non-emulator frontend Firebase variables and
   server credential. Stage a production build **without production alias**,
   run full Auth, personal exam PIN, score, teacher approval, Excel import,
   offline answer and result-release tests, and verify no answer-key leaks.
6. Only promote the verified build and remove the ignored-build hold after
   operator review. Record deployed commit SHA and rollback release pairing.

## Failed-gate rule

Do not bypass a failed CI check, re-enable anonymous/class-wide legacy
Firestore rules, publish a client-graded fallback, delete pending SQLite
results, or claim certification for 500 concurrent candidates without an
actual hardware/load test.

Source of truth: Issues #25 and #33 and `docs/SECURE-ROLLOUT.md`.
