# School CBT

A simple Firebase-backed computer-based testing system for schools.

## Simple model

The system is intentionally built around six things:

**School → Class → Student → Exam → Questions → Results**

Admins should not need to understand Firebase IDs, hashes, sessions, or backend records to operate the system.

## Student workflow

1. The school administrator creates the student.
2. The system generates a permanent Student ID.
3. The administrator gives the student the initial password.
4. The student signs in with **Student ID + password**. A personal email is not required for newly created student accounts.
5. The student sees only published exams for their class.
6. The student enters the exam code supplied by the administrator and starts the exam.
7. The student submits once and the result is recorded.

Existing legacy student accounts that were created with an email can continue using their existing email login while the school transitions to Student IDs.

## Administrator workflow

1. **Students** — create students, view their permanent IDs, choose their class, and block or restore access.
2. **Exams** — create an exam, choose the class, set the duration, add an optional schedule, and publish when ready.
3. **Questions** — add the questions belonging to that exam.
4. **Results** — review submitted examinations.
5. **Administrators** — available only to superadmins for role management.

The app keeps security and session controls underneath this simple workflow.

## Firebase setup

1. Install dependencies:
   `npm install`
2. Create or update `.env.local` with the Firebase web configuration.
3. Start the app:
   `npm run dev`
4. Build for production:
   `npm run build`

## Roles

- `student` — can see and take exams assigned to the student's class.
- `admin` — manages students, exams, questions and results.
- `superadmin` — has administrator management access as well.

## Deployment

The frontend uses Firebase Authentication and Firestore. The existing secure exam/session backend must remain deployed for protected exam sessions and individual exam-code validation.

The refactor deliberately keeps backend/security details out of the normal school workflow. Firebase Spark compatibility remains a design goal; features that require trusted server-side administration, such as arbitrarily resetting another user's Firebase password without that user's credentials, cannot be safely faked by the browser alone.
