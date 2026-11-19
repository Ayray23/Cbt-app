# Secure student accounts, personal exam PINs and grading

## What changed

- Only an admin or superadmin can provision a school account. Public signup is removed; signing in never creates a Firestore profile.
- New students use a username and password. Contact email is optional. Firebase uses an internal address ending in `@students.cbt.invalid`; students never need that address or a mailbox. Existing email accounts keep working.
- Admins select an exam and students on **Exam PINs**. Each PIN is bound to one account and one exam. PINs are shown once and stored only as hashes in server-only records. Five failed attempts lock that account/exam PIN for 15 minutes. Regeneration is allowed only before the attempt starts.
- Publishing creates an immutable server-only question/answer snapshot. Students receive only question text, options and marks. All grading happens on the server; browser-supplied scores are ignored. Results are stored separately. Examination officers can review them; students can read only their own released results.
- The first start needs internet and server PIN verification. After that, the question packet, answers, deadline and shuffled orders are saved on the student's device. Submission stores a durable local closure before any network work. The app retries pending uploads on login, reconnect, focus and every 30 seconds while open.
- Late uploads and old client-graded results are flagged for staff review. An offline device cannot provide trusted proof of when an answer was chosen. The original deadline is preserved; offline mode is suitable for supervised exams, not a guarantee against device-clock or storage tampering.
- Monitoring uses server timestamps from progress heartbeats. "No recent contact" does not prove a student is offline. A local queued submission is invisible to staff until uploaded.

## Server configuration

The API is the repository-root `api/cbt.mjs` Vercel Node function. Shared code lives in `server/`, with the Firebase Admin adapter in `cbt-app/server/` to reuse the existing dependency. There is no Firebase Cloud Functions deployment requirement.

1. In Firebase Console, open Project settings > Service accounts and generate a private key for this project's service account. Treat this key as a server secret. The service account needs Firebase Authentication management and Firestore data access.
2. Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete service-account JSON in Vercel's server environment variables. Never prefix it with `VITE_`, put it in public files, commit it, or paste it into chat. Keep the existing frontend Firebase configuration pointing at the same project.
3. Set Vercel's Root Directory to the repository root (leave it blank), not `cbt-app`. Keep `vercel.json` in control of the frontend build and output folder. The root API and frontend must deploy together. Vercel will serve `/api/cbt`; React routes still use `index.html`.
4. Deploy the updated frontend/API, rules and migration together in a maintenance window with no active exams. Credentials and live services have not been provisioned automatically by this code change.

For local development, put the server secret in a gitignored `.env.local` at the repository root. Install the existing frontend dependencies, then run these in two terminals:

```powershell
# Repository root
npm run dev:api

# cbt-app
npm run dev
```

Vite proxies `/api` to the local API at `127.0.0.1:8787`. The Node scripts require a current Node version supporting `--env-file-if-exists`. Production should use a supported Node LTS version.

## Existing-data migration

Do not deploy the strict rules alone while running the old frontend. It will no longer be allowed to create sessions or read question keys.

1. Stop new attempts and let connected submissions finish syncing. Check pending queues on any offline exam devices before clearing app data. Back up Firestore using your existing administrative backup process.
2. With the server secret available, run `npm run migrate:secure` from the repository root. This defaults to a read-only dry run. Verify existing staff roles in `users`; historical admin grants require staff verification because the old account-creation rules were insufficient.
3. Start maintenance and publish `cloud-functions/firestore.rules` and `cloud-functions/firestore.indexes.json` before applying the migration. From `cloud-functions`: `firebase deploy --only firestore:rules,firestore:indexes`. The old app will intentionally stop working during maintenance. Retire any deployed legacy API functions first, since their Admin SDK access bypasses rules.
4. Run `npm run migrate:secure -- --apply`, then deploy the new frontend/API before reopening access. The migration preserves accounts and results, moves results into the admin-only collection and strips scores from student sessions. It recognizes migrated attempts using a private server receipt, not a student-editable version field. Historical results and reconstructed papers require staff review. Do not redeploy the obsolete Cloud Functions as the exam backend.
5. Republish any exam reported as empty/invalid after fixing its questions. Issue personal PINs on **Exam PINs**. Old shared exam passwords do not grant access through the new API.

If you previously deployed any of the old Cloud Functions, retire those live endpoints as part of rollout. In particular the old grading HTTP API and start/submit callables must not remain usable alongside the new PIN API. Repository entry points now fail closed, but changing source files does not alter any already-deployed endpoint.

An old submitted attempt stays attempted. If a historical paper was deleted, the migration preserves its result for review instead of inventing an answer key. Legacy offline queues retain their final answers, ignore stored client scores and retry through the new API after migration.

Previously delivered answer keys cannot be made secret again. Use fresh questions for a real assessment if students have accessed those old papers. The updated app uses memory-only Firestore caching and clears the old persistent cache on startup; all older tabs must be closed to complete that cleanup. Student packets remain in localStorage and contain no answer key. Keep them until pending uploads are confirmed.

## Account setup

Keep the existing owner profile as `superadmin`. To bootstrap an owner that does not yet have a profile, use the local `cbt-app/setAdmin.js` script with the same server credential. It requires the account to exist in Firebase Authentication. It no longer depends on signing in to auto-create a profile.

In the app, open **Students**, enter the student's name, unique username and password (8+ characters), confirm it, and leave contact email blank if not needed. Give the student those credentials separately. On **Exam PINs**, select a paper and students, generate the PIN list and distribute only each student's own PIN. Losing a PIN does not permit resetting an existing attempt.

Removing signup and denying profile writes prevents public Firebase Auth registrations from obtaining school access. Firebase's underlying email/password provider may still accept raw identity registrations unless registration is disabled separately in its supported provider settings; these identities have no school profile and the API/rules reject them.

## Verification before an exam

Run `npm test` at the repository root and `npm run lint` / `npm run build` in `cbt-app`.

Then use a staging Firebase project to test the actual service credentials and deployed rules:

1. Student requests to create users, read `questions`, read `examPapers`/`examPins`/`examResults`, and write sessions or roles must fail.
2. Admin creation must keep the administrator signed in and produce a student who can log in with a username and no contact email. Unprovisioned Firebase identities must be rejected.
3. Alice's PIN must fail for Bob. A different exam's PIN must fail. Correct PINs must start independent single attempts for both students. Concurrent starts must retain one deadline and shuffle order.
4. Check the network response and browser storage: no `correctAnswer`, answer-key snapshot, PIN hash or final score may be returned to the student.
5. Change an option, immediately disconnect, submit, refresh and try reopening. The final answer must remain queued and the paper closed. Reconnect and verify one admin result, even if an upload is retried.
6. Enter fullscreen, exit it, switch tabs, and refresh. Interruptions must be recorded, answers retained, and the original timer preserved. A competing exam tab must be blocked. Unsupported Web Locks browsers cannot open the exam; use HTTPS and a supported lab browser. Fullscreen is an invigilation aid, not device lockdown.
7. Freeze/background a test browser longer than the remaining time. The absolute deadline must not move. Late uploads must be marked for review.
8. Monitor a connected device, then disconnect it for more than 90 seconds. The monitor must show no recent contact. Its offline submission will only appear after upload.
9. Install on phone and desktop, verify PNG launcher icons, and reload a prepared exam offline. Close all exam tabs before activating a new service-worker version.

Service tests use an isolated transaction store. The Rules Emulator and authenticated HTTP suites additionally exercise real Firestore transactions, Auth tokens and authorization. Physical-device fullscreen/install tests and staging acceptance remain required. A browser app cannot prevent OS app switching or prove offline timing; managed kiosk devices are required for device lockdown.


## Objective school release

This release consolidates `main` with the secure API branch. Personal PINs, server marking and role-scoped question authoring replace the old callable/client-scoring flow. The legacy callable helpers, guards and tests were replaced by the service, rule and HTTP suites. Previously committed root node_modules were removed from version control; lockfiles are the dependency source of truth. Duplicate CI workflows were consolidated into `.github/workflows/school-ci.yml`. The calculator from main is retained with an explicit per-paper permission (default off).

New configuration is single-school: school name, class arms (e.g. JSS1 A through SS3), subjects, academic session, term and optional grading bands. The school selects its assessment weights and grade scale; no universal Nigerian school grading policy is assumed. Complete setup and update existing students' class/session/subject enrolment before assigning new papers. Legacy users/papers without academic metadata need school review; the security migration does not invent their enrolment.

Teachers author their assigned classes and subjects. Examination officers publish, assign PINs and release results. Invigilators record attendance and interventions, extend an active attempt with a reason, or authorize a device transfer. Only already-synced answers can be recovered on a replacement computer; inspect the old computer's queue before transfer. A browser device ID is not hardware attestation.

Paper scores are normalized to percentages before weighting. CA/exam weights must total 100 for a complete subject total. Practice/mock papers do not contribute. Corrections require reasons and withhold previously released results until approved again. Results and interventions have audit entries. CSV export protects against spreadsheet formulas; Word question imports have previews and validation. Native Excel input is not implemented: save student sheets as CSV.

### Reproducible checks (repository root; Node 24 and Java 21)

```sh
npm ci --prefix cbt-app
npm test
npm run lint --prefix cbt-app
npm run build --prefix cbt-app
npm run test:rules --prefix cbt-app
npm run test:api --prefix cbt-app
# Browser walkthrough: run on a machine/CI runner that can launch Chromium.
cd cbt-app
npx playwright install --with-deps chromium
npm run test:browser
```

Run dependency checks in every package, not only the frontend:

```sh
npm audit --omit=dev
npm audit --omit=dev --prefix cbt-app
npm audit --omit=dev --prefix cloud-functions
npm audit --omit=dev --prefix cloud-functions/functions
```

The unused legacy import-server dependencies were removed from `cloud-functions/package.json`. The nested Functions package retains fail-closed retirement stubs only. Do not revive it as the exam backend.

### Evidence and outstanding launch gates

- Production dependency audits: zero findings in the active app, root tooling and retirement stub package after lockfile updates. Development-tool advisories are separate and remain subject to dependency maintenance.
- Local service suite: 26 passing tests; real Rules Emulator suite: 6 passing tests; Auth/Firestore HTTP suite: 2 passing tests. HTTP verification includes start/resume, stale save, device rejection, duplicate submission, server score, result release and blocked account access.
- Browser walkthrough is automated in CI but could not execute locally: the workspace cannot launch Chromium. Do not treat lint, build or API results as visual/browser acceptance.
- Production build succeeds; two chunks exceed Vite's 500 KB warning threshold (Firebase/application and on-demand Word import). Measure first load on the school network.
- No production deployment, credential changes, billing-plan confirmation, production restore drill or school-sized load test was performed.
- Before accepting real marks, run the browser walkthrough on the deployment and a supervised mock on the actual lab computers at the school's full simultaneous candidate count. Record start/submit errors, save delays, recovery outcomes and cost. No candidate-capacity claim is established by the emulator tests.
- Provision a separate staging project. Verify the Vercel API and Firestore/Auth quotas and billing against the school's expected usage. The active path uses a Vercel API, not Firebase callables; PR #12's Functions deployment requirement is superseded only when all clients migrate and legacy endpoints are retired.
- Establish scheduled backups, retention, restricted restore access and a successful restore into an isolated project. Preserve Auth identity records as well as Firestore data. CSV result export is not a database backup.
- Name a school exam administrator and support contact; agree result approval, incident handling, student-data access/retention, password distribution and a UPS/internet contingency. The application has reconnect recovery; it is not a standalone LAN server or a guarantee of offline timing integrity.
- Rollback requires a compatible API/rules/schema combination. Do not restore permissive legacy rules or client grading to resolve an outage. Keep maintenance active, retain pending device queues, and restore the verified secure release/data backup before reopening.

Theory, automated essay marking, multi-school tenancy and a standalone LAN deployment are outside this objective release.
