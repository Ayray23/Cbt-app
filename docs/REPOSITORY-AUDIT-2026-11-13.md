# CBT repository audit — 13 November 2026

## Verdict and scope

The objective CBT foundation is substantially improved, but this revision should not yet be accepted for an unsupervised production school examination. Fix the operational regressions below and complete staging acceptance first. Passing tests do not prove every role's screen or recovery path works.

Audited working revision: `dee6836b6c9b8966b0ac190a4f9c613b961b9fc6`, branch `codex/private-teacher-accounts`, incorporating the school-readiness changes. GitHub main was independently checked and remains `a0097f1075a3d19dad1838b57b773bed169a8957`. PR #15 is based on PR #14. This report describes the proposed code, not a verified live deployment.

Reviewed application routes, role guards, authoring/imports, student management, exam/session services, server marking, results, teacher oversight, Firebase rules/indexes, migration, PWA/cache handling, configuration, manifests/lockfiles, tests and CI. No production credentials, billing console, live Firestore data, deployed rules or physical school lab were inspected. No production writes, merges or deployments were made. Static findings below are distinguished from reproduced findings.

## High priority findings

### H1 — Admin and invigilator profile queries fail under the new privacy rules

**Files:** `cbt-app/src/pages/Dashboard.jsx:36`, `cbt-app/src/pages/Monitoring.jsx:90`, `cloud-functions/firestore.rules:15`.

Both pages subscribe to the entire `users` collection. Only superadmins can read all staff profiles; ordinary admins, examination officers and invigilators can read student profiles. Firestore rejects the broad query rather than filtering it. The admin dashboard loses student counts; monitoring loses profile-based names for unstarted candidates and can incorrectly display an unknown access state as “Allowed”. Other subscriptions may continue, so this is a partial screen failure, not a total outage.

**Reproduced:** In the Rules Emulator, the unfiltered query failed for admin, examofficer and invigilator, while `query(collection(db, 'users'), where('role', '==', 'student'))` succeeded for all three.

**Fix:** Query only student profiles on these pages; keep the staff directory superadmin-only. Add browser coverage for ordinary admin and invigilator accounts. Do not broaden privacy rules to make the old query work.

### H2 — An abandoned attempt has no server-side finalization path

**Files:** `server/service.mjs:253`, `server/school.mjs:86`, `server/school.mjs:137`, `cbt-app/src/pages/Monitoring.jsx:12`.

Only a student submission creates the result. Expiry alone does not close an attempt. If a computer fails permanently or a student never reopens the app, the session stays `started`, no result is created from already-saved answers, and archiving rejects the paper because it still has a started session. Staff can extend, transfer or record an incident, but cannot finalize an abandoned attempt.

**Evidence:** Static control-flow review; no finalization action or scheduled expiry worker is present.

**Fix:** Add an audited, idempotent staff finalization action using the last server-saved answers, with an explicit policy for offline queues and mandatory review. Test lost-device recovery, duplicate finalization and a late client upload after finalization. Do not silently discard unsynced answers.

## Medium priority findings

### M1 — Teacher-admin publishing controls contradict server permissions

**Files:** `cbt-app/src/pages/CreateExam.jsx:88`, `server/service.mjs:101`.

The Publish and Move to draft buttons exclude only `teacher`, not the new `teacher_admin`. Newly registered teachers therefore see controls that fail with permission errors. The server correctly prevents publication; this is a workflow/UI defect, not an authorization bypass.

**Fix:** Use one shared role/capability definition for the UI and server policy; show a clear “awaiting publication” state. Test both teacher roles.

### M2 — Examination officers have no UI queue for teachers' papers

**Files:** `cbt-app/src/pages/CreateExam.jsx:24`, `cbt-app/src/pages/Questions.jsx:25`, `cloud-functions/firestore.rules:25`.

Every non-superadmin author list is filtered to the current owner. An examination officer cannot find a teacher's paper in the publishing page or inspect that teacher's answer bank, although the staff UI says officers publish papers and the API permits publication by exam ID. Currently the superadmin is the usable route for publishing a teacher's work.

**Fix:** Decide explicitly whether only superadmin publishes teacher work, or introduce a teacher submission/review queue with narrowly scoped reviewer access. Preserve peer-teacher privacy. Test teacher creation through reviewer publication end-to-end.

### M3 — Extra time is not persisted into the offline exam packet

**Files:** `cbt-app/src/pages/TakeExam.jsx:108`, `cbt-app/src/services/examStore.js:27`, `cbt-app/src/services/sessionService.js:39`.

A heartbeat can receive an extended deadline and update React state, but it does not persist the new session deadline to local storage. If the browser subsequently goes offline and reloads, it resumes the old cached deadline and can close the exam prematurely. A heartbeat arriving too near the original expiry can also lose the race with local timeout.

**Fix:** Persist authoritative deadline updates atomically alongside the packet. Add an extension → heartbeat → offline reload test, plus an extension-near-expiry test. Show acknowledgement to the invigilator.

### M4 — Device transfer is an open claim, not a designated replacement

**Files:** `server/school.mjs:153`, `server/service.mjs:173`, `cbt-app/src/services/sessionService.js:83`.

Transfer sets `deviceId` to `TRANSFER_REQUIRED`; whichever authenticated device starts next claims it. The old computer can reclaim it. A queued submission from the old device carries its old device ID and is rejected after the new device claims the session. The UI warns staff to recover unsynced answers first, but offers no supported recovery/export/import workflow.

**Fix:** Use a short-lived transfer ticket or designated new device, and an audited recovery process for old-device answers. Test old/new device races and already-queued submissions. Browser-generated device IDs are not hardware attestation.

### M5 — Creation can succeed while the UI reports failure; retries can duplicate data

**Files:** `server/school.mjs:81`, `server/teachers.mjs:54`, `server/service.mjs:60`, `cbt-app/src/pages/AddQuestion.jsx:235`.

Exam creation and its audit log are separate writes. A failed audit write produces an API failure after the exam already exists. Questions use generated IDs without request idempotency; a lost response followed by retry can duplicate a question, including during Word import. Manual staff provisioning also spans separate identity/profile/role/audit operations.

**Reproduced:** Injecting an audit-write failure left the new exam in the store while `exams.create` threw an error. The reproduction used the repository's isolated fake backend, not production.

**Fix:** Atomically create the exam and audit record; use request IDs for authoring/import commands; add recovery for multi-service account provisioning. Test a lost response after successful commit.

### M6 — Superadmin oversight is incomplete

**Files:** `cbt-app/src/services/cbtService.js:13`, `cloud-functions/firestore.rules:22`, `server/school.mjs:28`, `cbt-app/src/pages/Admins.jsx:14`, `server/service.mjs:123`.

Moving a paper to draft writes directly to Firestore with no audit entry. Archive events use the actor's workspace UID, so a superadmin archiving a teacher paper does not place that event in the teacher's work history. PIN assignment/regeneration has no audit event. Each oversight list is capped at 200 without pagination; a teacher can create a valid 300-question paper but the oversight panel cannot show all 300 questions.

**Fix:** Route lifecycle mutations through audited server actions; consistently record both actor and resource owner; audit PIN issuance without storing plaintext PINs in logs; paginate/filter oversight lists. Add tests for actions performed by the superadmin on another teacher's paper.

### M7 — Word import drops multiline question content

**File:** `cbt-app/src/pages/AddQuestion.jsx:196`.

The parser selects one `firstNonMetaLine` for the question and one line per option. Continuation lines, passages and multiline options are discarded. The preview permits detection, but has no row editor; teachers must alter and re-upload the file. This matters for comprehension and science questions. Diagrams are explicitly unsupported by the text import and require manual addition.

**Fix:** Preserve all question/option continuation lines, support a documented format and editable preview, and test real school documents including passages, accents and numbered content.

### M8 — Self-registered teachers cannot recover a forgotten password in the app

**Files:** `cbt-app/src/pages/auth/Login.jsx`, `cbt-app/src/pages/StudentAccount.jsx`, `server/school.mjs:128`.

The app provides a password change requiring the current password. There is no `sendPasswordResetEmail` flow, and the administrator reset action accepts students only. A teacher who forgets the password requires out-of-band Firebase administration. Manually provisioned staff use internal username emails and need a different recovery policy.

**Fix:** Add personal-email password recovery for self-registered teachers and a controlled, audited recovery procedure for internal-address staff accounts. Test expired/reset links and avoid account-enumeration responses.

### M9 — Data subscriptions and save frequency are not bounded for a busy school

**Files:** `cbt-app/src/pages/Monitoring.jsx:84`, `cbt-app/src/pages/Results.jsx:13`, `cbt-app/src/pages/Dashboard.jsx:36`, `cbt-app/src/pages/Students.jsx:16`, `cbt-app/src/pages/TakeExam.jsx:120`, `server/service.mjs:220`.

Several screens load entire historical collections. Student list pagination is only after downloading all students. Monitoring subscribes to every session and assignment and matches them client-side. Each answer change can trigger a server transaction after 800 ms, plus a 30-second heartbeat. Thus 500 concurrent students is not a capacity claim supported by these tests.

**Fix:** Query by active exam/session/term, use server-side pagination and summaries, separate heartbeat metadata from frequent answer changes where practical, then load-test the real architecture. Measure latency, errors, reads/writes and cost; include simultaneous starts/submissions and network loss.

### M10 — Development dependency advisories remain outside CI's audit gate

**Files:** `cbt-app/package-lock.json`, `cloud-functions/functions/package-lock.json`, `.github/workflows/school-ci.yml`.

Current full audits: app 14 moderate findings, retired Functions tooling one high finding (`brace-expansion`); root and retired wrapper zero. Current production-only audits for app and Functions report zero vulnerabilities. CI checks only `--omit=dev --audit-level=high`, so it cannot certify the entire dependency tree is clean.

**Fix:** Review the advisory dependency paths, update compatible development tooling and record justified exceptions. Do not blindly apply the suggested Firebase CLI downgrade. Add a development-audit review/gate. These findings are not evidence of an exploitable deployed exam backend.

## Lower priority findings and maintenance

- **Stale draft counts:** `server/teachers.mjs:55` and `server/school.mjs:44` create/copy/delete questions without maintaining `exams.questionCount`; `CreateExam.jsx:84` displays that value. Reproduced: adding the first question leaves the count at zero. Publishing refreshes it. Maintain counts transactionally or label/display a live derived count.
- **No question edit workflow:** `Questions.jsx` provides copy/delete, not updating text/options/keys. Teachers must delete and recreate draft questions to correct mistakes. Add audited edits restricted to draft papers, preserving published snapshots.
- **Misleading labels/docs:** `App.jsx` labels teacher/examofficer workspaces “Student Portal”; README and the opening rollout notes still say public signup is disabled, contradicting the teacher-signup section. Update documentation and role labels together.
- **Large frontend bundles:** current production build has ~503 KB and ~619 KB minified chunks. The service worker precaches all chunks, including authoring/import code. Measure first-load/offline installation on school devices and consider narrower caching and chunking.
- **Shared-device storage/recovery:** localStorage keeps exam packets and pending submissions; UID keys prevent accidental application-level mixing, not access by someone with the same browser profile/devtools. There is no managed cleanup/export/recovery UI and one malformed stored JSON packet can disrupt listing/sync for that user. Add safe per-packet handling and supervised cleanup only after upload confirmation.
- **Hardcoded Firebase fallback:** `cbt-app/firebase.js` falls back to the existing project when environment configuration is missing. These public Firebase identifiers are not server secrets, but a staging build can accidentally target the real project. Fail clearly on missing required deployment config or use explicit environment profiles.
- **No general signup/API abuse throttle in code:** PIN attempts are throttled, but public teacher registration and authoring commands lack a repository-level request quota/App Check gate. Approval protects school data; it does not prevent account/audit spam. Verify provider-level protections and set an appropriate application policy.

## Exam-security boundaries

Server marking, immutable answer keys, personal PIN checks, result-release rules and teacher-question ownership are positive controls. No critical authorization bypass was established by this audit.

Fullscreen, clipboard restrictions, visibility events and local device IDs are browser controls, not a secure exam kiosk. They cannot prevent a second device or deliberate browser tampering. Late answers are accepted for review, and submissions within the 30-second grace window are not flagged solely for lateness (`server/service.mjs:277`). A reviewer can clear the late-review flag without independently proving when the answers were selected. Agree the school's supervised offline/late-submission policy and test that policy; do not market the system as cheat-proof.

The data model has one `school/settings` document and no school/tenant boundary. Private teacher workspaces are not multi-school isolation. Deploy separate instances/projects for separate schools or design and test tenant isolation before shared multi-school operation.

## Verification performed

| Check | Evidence/result |
|---|---|
| `npm test` | Fresh run: 29 passed |
| `npm run lint --prefix cbt-app` | Fresh run: passed |
| `npm run build --prefix cbt-app` | Fresh run: passed; two chunk warnings |
| Firebase Rules Emulator | Fresh run: existing 7 cases plus one temporary regression reproduction, all 8 passed; the reproduction asserts the defective broad query is denied |
| HTTP API emulator suite | Same revision's successful CI: 3 passed |
| Browser flows | Same revision's successful CI: objective exam flow and teacher registration/approval/authoring/oversight passed |
| Full dependency audits | Root 0; app 14 moderate; Functions 1 high; wrapper 0 |
| Production dependency audits | App 0; Functions 0 |
| Failure injection | Confirmed non-atomic paper/audit creation |
| Draft count reproduction | Confirmed count stays at 0 after question creation |
| Tracked private-key signature scan | No PEM/private-key signature matches; not a complete secret-history audit |

CI evidence: https://github.com/Ayray23/Cbt-app/actions/runs/43362461555 and https://github.com/Ayray23/Cbt-app/actions/runs/43362483561 . Browser verification was not rerun locally; the reviewed successful CI used the exact audited commit. The browser suite uses a development server/emulators and does not prove the production service-worker or Vercel deployment works.

Repeatable baseline commands from the repository root:

```sh
npm ci --prefix cbt-app
npm test
npm run lint --prefix cbt-app
npm run build --prefix cbt-app
npm run test:rules --prefix cbt-app
npm run test:api --prefix cbt-app
npx --prefix cbt-app playwright install --with-deps chromium
npm run test:browser --prefix cbt-app
npm audit --json --prefix cbt-app
npm audit --omit=dev --prefix cbt-app
npm ci --prefix cloud-functions/functions
npm audit --json --prefix cloud-functions/functions
npm audit --omit=dev --prefix cloud-functions/functions
```

The temporary reproduction file was removed after execution. No application source was changed for this audit.

## Deployment and acceptance gates still unresolved

1. Fix H1/H2 and the exam recovery/privacy workflow defects above. Expand coverage beyond superadmin/student and one happy-path teacher.
2. Review and merge the dependent changes in order: #14, then #15 (retarget #15 when appropriate). Main currently does not contain this audited revision.
3. Confirm Vercel repository-root configuration, Node runtime, server-only `FIREBASE_SERVICE_ACCOUNT_JSON`, matching Firebase projects and staging email delivery. Verify the actual API bundle through a deployed staging URL.
4. Confirm hosting/Firebase billing, quotas and budget alerts in the actual account. This branch uses a Vercel API, not Firebase callables; PR #12's original callable-plan question must be reassessed against the new architecture. Repository source cannot prove the account plan.
5. Back up and prove restoration before migration. Audit legacy privileged users and question ownership; the migration does not assign ownership to old questions. Fresh papers are needed where old clients previously exposed answer keys.
6. Retire any still-deployed legacy privileged endpoints. Fail-closed source files do not disable live old functions automatically.
7. During a maintenance window with no active exams, coordinate rules/indexes, migration and frontend/API rollout using `docs/SECURE-ROLLOUT.md`. Rules command, after project verification: `firebase deploy --config cloud-functions/firebase.json --project <verified-project-id> --only firestore:rules,firestore:indexes`. Wait for indexes to finish building. Migration dry run: `npm run migrate:secure`; applying `npm run migrate:secure -- --apply` is a separate production mutation requiring the maintenance/backup checks.
8. Validate a production-build PWA offline/reload/update flow, teacher verification/reset emails, all staff roles, simultaneous exam sessions, power loss, lost devices and pending-upload handling. Perform a measured pilot at the intended school load; retain results and rollback instructions.
9. Establish school-owned support, data retention/deletion, staff access review, incident handling, backups and lab power/connectivity procedures. These are acceptance requirements, not claims that a legal compliance review has been completed.

Recommended order: repair staff queries → secure abandoned-attempt recovery and offline extra-time/transfer handling → fix teacher publication/oversight → transactional/idempotent writes → import/account recovery → dependency and scaling work → staging and supervised school pilot.
