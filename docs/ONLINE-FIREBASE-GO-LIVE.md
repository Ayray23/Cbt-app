# Online CBT Firebase rollout — production safety checklist

**Scope:** Online exams only. Standalone school LAN/SQLite sync stays **OFF**:
`CBT_ENABLE_LAN=false`, `VITE_ENABLE_LAN=false`.

**Status (20 November 2026):** Vercel `cbt-app` has six production Firebase
web variables and a **Sensitive** production-only
`FIREBASE_SERVICE_ACCOUNT_JSON`. The live Firebase project associated with
the previous frontend is `cbt-app-63991`. Presence in Vercel does **not**
prove the JSON matches that project, has the right permissions, or that live
Firestore data is ready for migration.

## Read-only credential preflight

Before editing Firestore, the following command verifies that the credential
and web config reference the **same project**, then checks authenticated
Firebase Admin Auth user-list access and Firestore reads from `users`,
`exams`, `examSessions`, and `examResults` without modifying data:

```sh
# Run in a trusted, authorized environment with the intended project's
# configuration already supplied securely through environment variables.
npm ci --prefix cbt-app
npm run verify:firebase
```

Use your secure runtime/secret manager to supply the variables. Do **not**
paste, upload, or commit the service-account JSON into GitHub, a CI log,
a support ticket, or any frontend file. Do not make the production credential
available to public PR workflows. Do not set emulator host variables for this
live credential test.

An expected `PASS` proves basic server identity + read permissions **only**.
The Admin SDK bypasses Firestore Security Rules, so it **cannot** validate
the rules deployed in Firebase or prove a client can log in. The preflight
script does not run `migrate:secure` or any database writes.

## Mandatory database gates before production changes

1. Confirm the Firebase Console project identifier is `cbt-app-63991`,
   check Auth users and owner/superadmin access. If your intended school
   project differs, stop and correct both frontend and backend credentials.
2. Set a maintenance window with no active exam sessions. Account for devices
   with queued submissions; never clear their local storage as a workaround.
3. Create a Firestore export to secure Cloud Storage **and** an independent
   Firebase Auth user backup. Record project, export identifiers, permissions
   and retention. Verify a complete restore into an isolated project. Firestore
   CSV exports are not sufficient backups. Confirm relevant Firebase/GCP
   billing and backup capability before proceeding.
4. Run `npm run migrate:secure` in a trusted, authenticated environment.
   This is **dry-run only** by default. Record invalid/missing exam papers and
   the number of historical sessions. Check staff roles/ownership manually.
5. Review and deploy `cloud-functions/firestore.rules` and
   `cloud-functions/firestore.indexes.json` together under maintenance, in
   the compatible migration order in `docs/SECURE-ROLLOUT.md`. Audit the
   presence of **already-deployed** legacy grading/callable endpoints; code
   removal alone does not retire deployed Functions.
6. Only after a verified backup, dry-run review, approved maintenance window
   and validated rules, run `npm run migrate:secure -- --apply`. Do not run
   the `--apply` form as an automated build step or on every deployment.
7. Run staging end-to-end checks with the current frontend, secure API and
   deployed Firestore rules for admin, student, teacher, individual PIN,
   questions, score, result-release, offline queue/reconnect and abuse denial.
   Do not use real student accounts/data in automated staging tests.
8. Build and test the production-target artifact without assigning the public
   domain. Release only when backend auth and frontend use identical project
   credentials, live data is migrated, all critical checks pass, and rollback
   uses a **compatible** API/rules/data snapshot.

## Repository and deployment safety

- `main` contains the merged secure online CBT frontend, server API,
  private teachers and native Excel import.
- The dedicated LAN API requires `CBT_ENABLE_LAN=true` and is disabled by
  default, even if LAN code exists in the repository.
- Vercel production automatic builds were deliberately held to avoid
  deploying a migration-dependent API against the old database. **Do not
  remove the Ignored Build Step hold as a shortcut**.
- Never restore permissive legacy rules or client-side grading when
  troubleshooting production login/submit errors.
- The application must be able to preserve locally queued submissions during
  transient internet failures, but the first login/exam start is online.

## What can be checked here vs what needs Firebase access

GitHub Actions can run unit tests, lint/build, the Firebase emulators and
browser workflows using synthetic demo data. They cannot validate a live
service-account credential unless deliberately granted that secret; do **not**
place production keys in a general CI environment.

The Firebase project and its production backups, deployed rules and current
legacy data must be inspected via authenticated Firebase administration. When
no Firebase management tools or trusted runtime are connected to the assistant,
**this is a release blocker**, not permission to guess or silently apply the
migration.

Track completion and evidence in GitHub Issue #33.
