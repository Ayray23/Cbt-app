# Stage 2 — controlled Firebase → Supabase historical snapshot transfer

**Live service remains Firebase.** No student authentication, exam PIN, timer, submission, grading, result, or app routing changes are made in this stage.

The Stage 1 schema is already applied to the independent **School-CBT** Supabase project:
- Organization: Ayray23's Org
- Project ref: `eduqfhveigbazizeapkp`
- Private schema: `cbt_shadow`
- 11 tables after Stage 2 extension, RLS on, no browser grants
- All currently empty

## Why the live exam is not copied immediately

The existing Firestore backend experienced resource-exhausted errors and students may have unfinished attempts and queued offline submissions. Importing during an exam can create incomplete, non-authoritative copies and increase Firestore reads. **Do not export while exams are active or Firebase is quota-exhausted.** Complete all exams and reconcile local submissions first.

## Operator-only, one-way process

Prerequisites: trusted local admin computer, Node.js 24+, `psql` (PostgreSQL client) installed, and a securely-provided Firebase Admin service account plus the School-CBT PostgreSQL connection credentials. Keep all credentials outside GitHub. The export does not write to Firebase. The import writes only to `cbt_shadow`.

1. From the project root, after exams have finished:

   ```bash
   node scripts/cbt-stage2-transfer.mjs --plan
   ```

2. With `FIREBASE_SERVICE_ACCOUNT_JSON` and `VITE_FIREBASE_PROJECT_ID` provided **privately** in the process environment:

   ```bash
   node scripts/cbt-stage2-transfer.mjs --export
   ```

   It pages through eleven Firestore collections and writes an owner-only file to `~/.school-cbt-private/snapshot-*.json`. The output includes student personal data, exam answers, PIN digests, session proofs, audit history, and marking keys — do not share it, commit it, or upload it to a public site. The command aborts before saving if any active/non-submitted session is found or relationships cannot be mapped.

3. Validate the private snapshot without touching either database:

   ```bash
   node scripts/cbt-stage2-transfer.mjs --verify /absolute/path/to/snapshot.json
   ```

4. Obtain PostgreSQL connection details from **School-CBT → Connect**. Configure private `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE=require`; also set:

   ```text
   CBT_SUPABASE_PROJECT_REF=eduqfhveigbazizeapkp
   ```

   Never set these in the Vite frontend or put them in git. The script rejects a connection that cannot identify the dedicated project through host or pooler username.

5. Run the explicitly confirmed import:

   ```bash
   node scripts/cbt-stage2-transfer.mjs --apply /absolute/path/to/snapshot.json --confirm-project eduqfhveigbazizeapkp
   ```

   This generates a single transaction of idempotent `INSERT ... ON CONFLICT DO UPDATE` statements for the eleven private tables. In the event of SQL errors, PostgreSQL rolls back the transaction. The Firebase IDs and complete JSON fields are preserved.

6. Verify counts in the Supabase SQL editor:

   ```sql
   select
     (select count(*) from cbt_shadow.users) users,
     (select count(*) from cbt_shadow.exams) exams,
     (select count(*) from cbt_shadow.questions) questions,
     (select count(*) from cbt_shadow.exam_papers) papers,
     (select count(*) from cbt_shadow.exam_assignments) assignments,
     (select count(*) from cbt_shadow.exam_sessions) sessions,
     (select count(*) from cbt_shadow.exam_results) results,
     (select count(*) from cbt_shadow.exam_pins) pins,
     (select count(*) from cbt_shadow.exam_session_proofs) session_proofs,
     (select count(*) from cbt_shadow.audit_logs) audit_logs,
     (select count(*) from cbt_shadow.school_settings) school_settings;
   ```

Compare every count against the printed source counts and review sampled IDs, exam versions, and grades. Do not switch production traffic merely because the counts match.

## Important exclusions

- The snapshot includes eleven collections, including exam PIN digests, session proofs, audit history and school settings, but **does not** yet cover all possible ancillary/legacy data or establish staff authorization policies for a new Supabase-backed API. PIN plaintext is never exported; only existing Firebase PIN digests are preserved.
- The snapshot is a point-in-time copy, **not live sync**; subsequent Firebase records will not automatically appear in Supabase.
- Student Firebase Auth identities are preserved by UID, but Supabase login is **not enabled**.
- The private schema is intentionally inaccessible to student browsers; Stage 3 must implement a secure server-side API and reconciled migration for omitted collections.
- If any pending local-only student submission exists, this stage must not treat the Firestore snapshot as a complete copy.

## Status

- Stage 1 and Stage 2 private Supabase schemas: applied and verified (11 tables).
- Stage 2 transfer code and tests: reviewable in branch / PR.
- Actual Firebase export and data import: **not performed yet** because this environment has no authenticated access to the Firebase Admin data and active exam integrity must be protected.
- Production cutover: **not attempted**.
