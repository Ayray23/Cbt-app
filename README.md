# CBT App MVP

This repository contains:

- [cbt-app](/Users/Owner/Desktop/Web projects/Cbt app/cbt-app): React + Vite frontend
- [cloud-functions](/Users/Owner/Desktop/Web projects/Cbt app/cloud-functions): Firebase deployment config and Cloud Functions backend

## Deploy checklist

1. Install frontend dependencies in `cbt-app`.
2. Install backend dependencies in `cloud-functions/functions`.
3. Confirm the Firebase project in [cloud-functions/.firebaserc](/Users/Owner/Desktop/Web projects/Cbt app/cloud-functions/.firebaserc).
4. Deploy Firestore rules, indexes, Storage rules, and Functions from the `cloud-functions` directory.
5. Bootstrap the first `superadmin` with [cbt-app/setAdmin.js](/Users/Owner/Desktop/Web projects/Cbt app/cbt-app/setAdmin.js) after that user has signed in once.

## MVP status

The repo now supports the core production journey:

- Admin creates and publishes exams
- Student takes an exam and submits once
- Backend grades MCQs and stores the submission
- Admin reviews results

## Recommended next phase after launch

- Add password reset and email verification
- Add exam scheduling windows
- Add anti-cheat/session timeout safeguards
- Add richer analytics and result exports
