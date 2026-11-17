# CBT branch ownership, release gates, and safe rollback

Updated 17 November 2026. This file describes the **review/deployment plan**, not
a claim that unmerged code is running in production. The `main` branch stays
untouched until approved releases. This file itself is documentation-only.

## Golden rule

**Deleting a branch is not a rollback after its commits have been merged.**
A release must be reversible by reverting a feature-specific PR (when schema
compatible), turning off a feature-specific configuration flag, or restoring
the last verified **compatible** frontend/API/rules/indexes/database release.
Never weaken Firebase rules or restore client-side grading to fix an outage.

Protect `main`: require successful CI and human review, block direct pushes,
avoid merging during exams, and take verified backups before migrations.
If branch protection is available, enable it in GitHub repository settings.

## Release graph (bases are for review, NOT instructions to merge into parent)

```text
main (existing deployed baseline; do not overwrite)
  |
  +-- #14 [01 CORE]       codex/school-readiness
        |
        +-- #15 [02 TEACHERS] codex/private-teacher-accounts
              |
              +-- #17 [03 OFFLINE+AUDIT, HIGH RISK]
                    codex/audit-fixes-offline-completion
                    |               \
                    |                +-- #22 [05 IMPORTS]
                    |                     feature/native-excel-imports
                    |
                    +-- #20 [04 LAN HTTPS, HIGH RISK]
                          codex/pr17-school-lan-staging
                          |
                          +-- #23 [06 AUTO-SYNC, HIGH RISK]
                                feature/lan-auto-cloud-sync
```

### Active independently reviewable PRs

| PR | Group | Base for review | Source branch | Risk / rollback |
|---|---|---|---|---|
| #14 | School core, secure exams/marking/roles | `main` | `codex/school-readiness` | **High migration risk**: coordinated cloud app/API/rules/indexes and secure data migration; rollback only as compatible set |
| #15 | Private teacher workspaces | `codex/school-readiness` | `codex/private-teacher-accounts` | Medium; requires #14, check real email and workspace privacy |
| #17 | Offline core + integrated audit/recovery fixes | `codex/private-teacher-accounts` | `codex/audit-fixes-offline-completion` | **High**; 60 changed files; still contains a mixed audit/offline change set and is **not fully feature isolated**. Do not assume its audit changes can be removed independently of its LAN changes |
| #20 | School-hosted LAN HTTPS, scripts and pilot | `codex/audit-fixes-offline-completion` | `codex/pr17-school-lan-staging` | **High**; can be omitted from cloud release; school deployment needs local DNS, CA trust and physical testing |
| #22 | Native Excel .xlsx students and questions | `codex/audit-fixes-offline-completion` | `feature/native-excel-imports` | Medium; frontend/import parser changes only; revert this PR separately if needed |
| #23 | Automatic LAN->cloud sync | `codex/pr17-school-lan-staging` | `feature/lan-auto-cloud-sync` | **High**; can omit/defer separately. Fast operational stop: unset `CBT_LAN_SYNC_URL` and restart the LAN server; unacknowledged results remain in SQLite for manual recovery |

**Merge strategy:** Retarget each child PR to `main` **after** its prerequisite
is merged and rerun checks; merge each feature as its own reviewable PR. Do
**not** merge children into unmerged parent feature branches, as that would
bundle them back together. Example order: #14, #15, #17, then #22 and
#20 (each separately), and #23 only after #20. For a school without LAN,
stop after core/teacher and approved optional imports; **do not** pull in #17
merely to get Excel imports if the offline core is not approved — port the
Excel change onto the approved core first.

## Superseded and quarantined PRs

| PR | Status | Why |
|---|---|---|
| #16 | Closed unmerged; source branch retained | Early partial offline prototype; superseded by #17 |
| #19 | Closed unmerged; source branch retained | Earlier Firebase-dependent LAN static staging; superseded by real #20 reverse proxy |
| #21 | Closed unmerged; source branch retained | Excel and auto-sync were mixed; replaced by separate #22 and #23 |
| #18 | **Draft: quarantine** | Legacy Firebase callable/security implementation. Do not merge into the new Vercel API architecture; review unique security findings, port selectively if needed |

Do not delete source branches in these rows until their historical unique
changes have been compared and release recovery has been documented.

## Older branches without an active release PR

- **Already behind `main`, zero commits ahead:** `feature/cbt-1.0-hardening`,
  `feature/exam-calculator-blue-green`, `feature/student-id-login-reset`,
  `final-ui-calculator-hardening`, `fix/jamb-calculator-layout`,
  `fix-secure-exam-question-access`, `lint-cleanup-final`,
  `lint-final-fix`. These are historical references, not upcoming changes.
- **Diverged legacy feature branches needing a separate selective review
  before reuse:** `feature/admin-student-management-exam-codes`,
  `feature/class-based-exams`, `feature/student-exam-ui-revamp`,
  `fix/individual-exam-code-print-sync`, `refactor/simple-school-cbt`,
  `codex/secure-mvp-release`. Do **not** bulk-merge; they are behind the
  present `main` and may reintroduce outdated exam-password/security code.
- **Archived-by-policy source branches:** `feature/offline-lan-batch-sync`
  (#16), `feature/school-lan-staging-guide` (#19), and
  `codex/excel-import-auto-lan-sync` (#21). These remain on GitHub but
  should not target a release again without a fresh audit.
- `fix/security-hardening` is associated with draft #18 and is quarantined.

Creating new branches for historical feature names is **not** necessary.
Revisit, selectively port, and test only if a specific missing requirement
is confirmed. Keeping them available is safer than deleting them prematurely.

## Pre-merge checks

1. Confirm PR base/ref, intended changed-file scope and zero accidental
   unrelated files. Core PRs may have large diffs from deleting mistakenly
   committed `node_modules`—review the real source delta.
2. CI: Node version and lockfile clean install; unit tests; Firebase Auth +
   Firestore Rules emulator; authenticated API; Chromium browser tests;
   lint/build; production and development dependency audits.
3. Staging: real test-project credentials, matching app/API/rules/indexes,
   secure teacher login, correct student-specific PINs, exact marking,
   rejected unauthorized access, offline recovery and duplicate replay.
4. LAN PRs additionally require trusted TLS on real computers, encrypted
   SQLite snapshots with a successful restore, UPS tests, WAN loss and
   recovery, independent examiners' reconciliation and **500 concurrent
   candidates** tested on the target school network.
5. Deploy only during an approved maintenance window with no exams active.
   Preserve pending browser offline queues; record deployed commit SHA,
   Firebase project and database/schema versions.
6. Obtain teacher/admin + developer + school IT sign-off. If a gate fails,
   leave that PR unmerged and keep `main` in its last approved state.

## Failure and rollback playbook

| Failing area | First safe action | Longer-term fix |
|---|---|---|
| Excel import | Stop XLSX imports; use CSV/DOCX fallback | Fix/revert #22 only; preserve created student/question records; rollback won't undo already imported records |
| LAN TLS/setup | Keep LAN server offline and do not distribute tickets | Fix/defer #20, verify DNS and local CA; normal cloud CBT remains a separate service |
| LAN auto cloud upload | Unset `CBT_LAN_SYNC_URL`, restart Node; keep SQLite DB and bundles | Fix/revert #23; use audited `manage.js sync` only when authorized |
| Offline core and security | Halt new attempts and retain student/local queues | Review #17 and restore a compatible approved stack; **do not** partially roll back backend security contracts |
| Core backend or schema migration | Enter maintenance, snapshot data and stop new exams | Restore compatible API + strict Firestore rules/indexes + data; never restore permissive rules or old client marking |
| Old diverged branch change | Do not merge it into main | Make a fresh branch from current approved main and selectively port only the tested change |

Avoid cleaning a student's browser cache until every pending answer is
acknowledged. Never delete a production SQLite database/bundle solely to
resolve a failing PR; restoration and cloud reconciliation must be verified.

## Distinction between feature isolation and deployment enablement

An unmerged feature branch is isolated **in source history**, not necessarily
at runtime once merged. PR #17 is a prerequisite that itself bundles
audit/security work with the offline engine. If the school needs independent
runtime on/off controls for that engine, add and test explicit backend/UI
feature gates **before merging #17**. The existing independent LAN host can
be left uninstalled and its cloud synchronization worker left disabled, but
this does not remove all cloud LAN code already present in #17.

Do not market the release as production-approved merely because CI passed;
the school-host, power, certificate, 500-seat and backup/restore gates remain.
