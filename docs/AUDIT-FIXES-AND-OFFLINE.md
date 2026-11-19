# Audit fixes and offline integration

This branch integrates the secure school/teacher baseline (#14/#15) with PR #16's offline initiative. It preserves the trusted Vercel API instead of restoring retired Firebase callables. The LAN prototype is replaced with a complete individual-ticket exam service; usage is in `lan-server/README.md`.

## Finding disposition

| Audit finding | Change / remaining acceptance |
|---|---|
| H1 staff queries | Student-only queries; monitoring subscribes to a selected, paginated roster. Rules regression test included. |
| H2 abandoned attempts | Audited, idempotent staff finalization of server-saved answers; result review mandatory. LAN host has equivalent audited finalization. |
| M1 teacher publishing buttons | Both teacher roles hide publishing/draft controls. |
| M2 examiner publishing ambiguity | Explicit policy: only superadmin reviews/publishes another teacher's work; examination officers author/publish their own papers. |
| M3 extra time | Updated authoritative deadlines persist in the browser packet. Reload regression test added. |
| M4 device transfers | Staff supplies the exact replacement computer ID. Device epochs reject stale saves; supervised answer export/recovery added for cloud attempts. LAN transfer is controlled by host CLI. |
| M5 partial/duplicate writes | Atomic exam+audit creation; request IDs for exam/question/import creation and staff provisioning; question copying accepts an idempotency ID. Password reset remains an Auth/Firestore cross-service operation and operational errors must be reconciled from logs. |
| M6 oversight | Draft/archive/PIN events audited to paper owner; oversight can page beyond 200 records. |
| M7 Word import | Multiline prompts/options retained; editable preview; per-row retry IDs. |
| M8 account recovery | Personal-email teacher reset flow and superadmin staff password reset. |
| M9 scale | Management subscriptions bounded/paginated; roster-specific monitoring; cloud progress every 30 seconds instead of per click. Dashboard clearly labels its capped sample; filtered result totals suppressed when a query spans pages. Physical load/cost acceptance remains required. |
| M10 dependencies | CLI updated; vulnerable transitive CLI packages overridden to patched versions. Retired Functions development dependency patched. Full audit gates added after verification. CLI emulator compatibility is tested; any future CLI upgrade must retest overrides. |
| Counts/editing | Transactional draft question counts and audited draft question editing. |
| Labels/docs | Teacher/staff workspace labels and teacher-signup documentation corrected. |
| Bundles | Firebase/React/document-import chunks separated. |
| Shared device recovery | IndexedDB backup/queue; damaged packets do not block healthy queues; supervised export and server-confirmed cleanup page. Browser storage is not a security boundary against someone controlling the OS account. |
| Project fallback | Missing explicit deployment config fails visibly; no automatic production-project fallback. |
| Abuse | Shared server-side management-operation quota and LAN login throttling. Underlying Firebase Auth registration quotas/provider protections remain an account-level setup task. |

## Offline behavior

Cloud exams require internet for first authorization and paper download. Afterwards the browser retains the paper and answers, closes durably, and retries final upload. IndexedDB transactions resolve on commit rather than request success. The last server deadline is preserved when extra time is acknowledged. LocalStorage remains a fast synchronous answer journal alongside the IndexedDB backup.

LAN exams are prepared online by the superadmin, imported into the school host and served over trusted local HTTPS. Each candidate gets a separate ticket and one reserved attempt. The host saves records in SQLite and enforces device ownership. The local CLI uploads final records to the cloud in batches; marking remains on the cloud. Every imported LAN result is withheld for review. Local-network loss is recoverable for a previously opened paper, but the first LAN login needs the host.

## Production work that source changes cannot complete

No deployment, billing change, live migration, domain/certificate provisioning, physical load certification or backup restore drill has been performed by this implementation. Review the integrated PR, coordinate app/API/rules/indexes, deploy to staging, retire old privileged endpoints, verify real email links and all staff roles, and run the school's hardware/network/UPS pilot. This remains a single-school data model; use isolated school deployments rather than claiming multi-school tenancy.
