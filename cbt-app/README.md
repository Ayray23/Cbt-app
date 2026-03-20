# CBT App

Production-ready MVP for a Firebase-backed computer-based testing platform.

## What this app does

- Students can sign up, sign in, see published exams, start one exam session, answer MCQs, and submit.
- Admins can create exams, add questions, publish exams, and review submissions.
- Superadmins can promote existing users to `admin` or `superadmin`.

## Frontend setup

1. Install dependencies:
   `npm install`
2. Create or update `.env.local` with:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

3. Start the app:
   `npm run dev`
4. Build for production:
   `npm run build`

## Auth and roles

- Every new account is created as `student`.
- The first real `superadmin` must be bootstrapped manually after that user signs in once.
- To bootstrap a superadmin, place a Firebase Admin SDK key at [serviceAccountKey.json](/Users/Owner/Desktop/Web projects/Cbt app/cbt-app/serviceAccountKey.json) and run:
  `node setAdmin.js you@example.com superadmin`

## Live MVP workflow

1. Sign up a student or admin candidate account.
2. Bootstrap one `superadmin`.
3. Sign in as the superadmin and promote any needed admins.
4. Create an exam.
5. Add questions to that exam.
6. Publish the exam.
7. Sign in as a student and take the exam.
8. Review the submission from the results screen.

## Important deployment notes

- This frontend calls Firebase callable functions, so the backend in `cloud-functions/functions` must be deployed.
- Firestore rules, indexes, and Storage rules are defined in the `cloud-functions` folder.
- `setAdmin.js` is only for initial bootstrap or emergency recovery. Day-to-day role changes should happen from the app.
