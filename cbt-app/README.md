# CBT Frontend

React/Vite frontend for the CBT app. Students log in using an admin-issued username and password, or an existing email login. There is no public signup. Admins create student accounts on **Students**, then issue personal exam PINs on **Exam PINs**.

The trusted API lives at the repository-root `api/cbt.mjs`. Publishing snapshots the paper privately, PIN validation happens on the server, and only the server can grade and finalize a result. Student packets never contain answer keys.

## Run locally

```powershell
npm install
npm run dev
```

Also run `npm run dev:api` from the repository root. Vite proxies `/api` to that server. Keep frontend Firebase config in this folder's gitignored `.env.local` and server credentials only in the repository-root environment.

## Check

```powershell
npm run lint
npm run build
```

Run `npm test` from the repository root for service and offline-store regression tests.

## Deployment and migration

Read [Secure Rollout](../docs/SECURE-ROLLOUT.md). Vercel must use the repository root, not this folder, as Root Directory. Deploy API, frontend, strict Firestore rules and existing-data migration together during maintenance.

Bootstrap an existing Firebase Auth owner using:

```powershell
node --env-file-if-exists=../.env.local setAdmin.js owner@example.com superadmin
```

Offline starts require an existing saved attempt on the same device; first login and first start need a connection. Keep pending submissions on the device until the server confirms them. Late uploads require staff review.
