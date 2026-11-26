# CBT migration: Stage 1 (shadow schema only)

The live application **stays on Firebase**. This stage adds a candidate PostgreSQL schema for a new, dedicated CBT Supabase project. No writes to any Supabase project or existing production data were performed by this commit.

## Mapping from Firebase

| Firebase collection | Private PostgreSQL table | Primary key |
| --- | --- | --- |
| users | cbt_shadow.users | firebase_uid |
| exams | cbt_shadow.exams | firebase_id |
| questions | cbt_shadow.questions | firebase_id |
| examPapers | cbt_shadow.exam_papers | firebase_version |
| examAssignments | cbt_shadow.exam_assignments | firebase_id |
| examSessions | cbt_shadow.exam_sessions | firebase_id |
| examResults | cbt_shadow.exam_results | firebase_id |

The `source_document` and `paper_document` JSONB columns preserve old data losslessly while the new typed fields become usable. Keep Firestore's document IDs and Firebase Auth UIDs as **text**; do not regenerate IDs. Other security-critical collections—`examPins`, `examSessionProofs`, `auditLogs`—and dependent school/teacher data are **not yet migrated**. Live reads and grading must not switch until those are modeled and validated.

## Safety requirements before any database apply

- Use a **new CBT-only Supabase project**. Do not apply this SQL to an existing CVForge, FarmBridge, or unrelated project.
- Do not expose the `cbt_shadow` schema through Supabase Data API, and do not add browser RLS policies or public grants. Access is restricted to privileged server code in later stages.
- Do not put a Supabase service key, Postgres password, or Firebase Admin credentials into Vite/browser environment variables or a repository.
- Do not import or write student attempts until live exams and pending submissions have been reconciled. Take a verified Firebase export first.
- Run the schema in an isolated development/test PostgreSQL database, verify tables and indexes, then run `select count(*)` on each table. **A committed SQL file is not a deployed database.**

## Staged rollout

1. **This PR:** reviewable shadow schema; Firebase remains authoritative.
2. **Next:** choose or create a dedicated Supabase project; apply and verify schema, then implement a read-only, controlled historical export/import preserving IDs.
3. Reconcile sessions, question versions, results, PINs, proofs, and audit trail; compare row counts, hashes and scores.
4. Implement server-only, transactional submission and grading in Supabase; verify under concurrent load and network failure. Keep Firebase Auth initially.
5. Pilot **new exams only** with a feature flag, monitor and roll back safely. Never silently transfer an already-started exam.

There is no dual-writing in stage 1 and no production cutover.
