# Secure student accounts, personal exam PINs and grading

## What changed

- Only an admin or superadmin can provision a school account. Public signup is removed; signing in never creates a Firestore profile.
- New students use a username and password. Contact email is optional. Firebase uses an internal address ending in `@students.cbt.invalid`; students never need that address or a mailbox. Existing email accounts keep working.
- Admins select an exam and students on **Exam PINs**. Each PIN is bound to one account and one exam. PINs are shown once and stored only as hashes in server-only records. Five failed attempts lock that account/exam PIN for 15 minutes. Regeneration is allowed only before the attempt starts.
- Publishing creates an immutable server-only question/answer snapshot. Students receive only question text, options and marks. All grading happens on the server; browser-supplied scores are ignored. Results are stored separately and readable only by admins.
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
6. Enter fullscreen from the start button, then exit it. The attempt must close without a browser confirmation created by the app. Browsers can still show their own native fullscreen notices; unsupported devices cannot be locked by this web app.
7. Freeze/background a test browser longer than the remaining time. The absolute deadline must not move. Late uploads must be marked for review.
8. Monitor a connected device, then disconnect it for more than 90 seconds. The monitor must show no recent contact. Its offline submission will only appear after upload.
9. Install on phone and desktop, verify PNG launcher icons, and reload a prepared exam offline. Close all exam tabs before activating a new service-worker version.

Automated service tests use an isolated transaction store, not production Firebase. Emulator/live-rule checks and physical-device fullscreen/install tests remain part of staging acceptance. A browser app cannot prevent OS app switching or prove offline timing; managed kiosk devices are required for device lockdown.
