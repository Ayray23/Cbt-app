# CBT App

A React/Vite CBT application with Firebase Authentication, Firestore, and a trusted Node API deployed alongside the frontend on Vercel.

Students use admin-issued usernames and passwords; a personal email is optional. Admins assign each student a separate PIN per exam. Answer keys, grading, provisioning and role changes are handled by the server. Teachers can register with personal email, verify it and await superadmin approval. Students cannot self-provision or write scores.

See [Secure Rollout](docs/SECURE-ROLLOUT.md) for required server credentials, existing-data migration, rules, staging checks and deployment order. This update requires coordinating the frontend/API deployment and Firestore rules.

## Roles

There are four staff roles plus students: **superadmin** (owner, teacher oversight, LAN), **admin** (school setup, students, exams, PINs, results, audit), **teacher** (their own papers and questions; publishing is done by an admin) and **invigilator** (live monitoring). Accounts created earlier with the retired names `examofficer` and `teacher_admin` keep working and are treated as admin and teacher; no data migration is required. New staff can only be created with the four current roles.

Staff find everything about an exam under one **Exams** area: Papers, Add Questions, Question Bank and (admins) Exam PINs. Old addresses such as `/exam-pins` redirect there.

## Exam lockdown

While a student sits an exam the page requires full screen, blocks copy, paste, right-click, drag, text selection, printing and developer-tool shortcuts, and keeps the attempt to one tab. Leaving full screen, switching tabs or switching windows shows the student a warning and is logged by type and time; invigilators see the count and a short summary in Monitoring. Nothing is auto-submitted: this deters casual cheating but is not a substitute for supervision, and it does not include webcam proctoring. It applies to the cloud exam page; the offline LAN student page has its own, separate checks.

## Local development

Install dependencies in `cbt-app` with `npm install`. Put `FIREBASE_SERVICE_ACCOUNT_JSON` in a gitignored repository-root `.env.local`; use the existing `VITE_FIREBASE_*` configuration in `cbt-app/.env.local`.

Run `npm run dev:api` from the repository root and `npm run dev` from `cbt-app` in a second terminal. The frontend proxies API requests locally.

## Checks

- Repository root: `npm test`
- Frontend: `npm run lint` and `npm run build`

Tests cover isolated service logic, real Firebase emulators and browser workflows. See docs/AUDIT-FIXES-AND-OFFLINE.md for the integrated audit fixes and lan-server/README.md for the school LAN service. Staging and a physical school pilot remain required.

## Deployment

Vercel's Root Directory must be the repository root so it discovers `api/cbt.mjs`. The frontend build/output remain configured in `vercel.json`. Firebase Cloud Functions are no longer the backend; the old entry points fail closed.

See [Secure Rollout](docs/SECURE-ROLLOUT.md) before changing any live rules or migrating existing data.

## Offline school LAN

See [LAN setup](lan-server/README.md). Prepare a bundle as superadmin while online, import it on the Node 24 school host, and serve students over trusted local HTTPS. Individual tickets reserve one attempt; final cloud synchronization grades against the immutable key and holds results for review.
