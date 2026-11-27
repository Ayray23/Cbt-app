-- Stage 2 extension: confidential Firebase security, school and audit records.
-- Existing School-CBT shadow records and live Firebase remain untouched.
begin;
create table if not exists cbt_shadow.exam_pins (
 firebase_id text primary key,
 exam_id text not null references cbt_shadow.exams(firebase_id),
 student_uid text not null,
 pin_digest text,
 pin_tag text,
 attempts integer not null default 0,
 locked_until_ms bigint not null default 0,
 source_document jsonb not null default '{}'::jsonb,
 imported_at timestamptz not null default now(),
 unique(exam_id,student_uid)
);
create table if not exists cbt_shadow.exam_session_proofs (
 firebase_id text primary key,
 exam_id text not null references cbt_shadow.exams(firebase_id),
 student_uid text not null,
 paper_version text,
 source_document jsonb not null default '{}'::jsonb,
 imported_at timestamptz not null default now(),
 unique(exam_id,student_uid)
);
create table if not exists cbt_shadow.audit_logs (
 firebase_id text primary key,
 actor_uid text,
 action text,
 target text,
 created_at_ms bigint,
 source_document jsonb not null default '{}'::jsonb,
 imported_at timestamptz not null default now()
);
create table if not exists cbt_shadow.school_settings (
 firebase_id text primary key,
 source_document jsonb not null default '{}'::jsonb,
 imported_at timestamptz not null default now()
);
create index if not exists cbt_shadow_exam_pin_student_idx on cbt_shadow.exam_pins(student_uid,exam_id);
create index if not exists cbt_shadow_exam_proof_student_idx on cbt_shadow.exam_session_proofs(student_uid,exam_id);
create index if not exists cbt_shadow_audit_log_created_idx on cbt_shadow.audit_logs(created_at_ms);
alter table cbt_shadow.exam_pins enable row level security;
alter table cbt_shadow.exam_session_proofs enable row level security;
alter table cbt_shadow.audit_logs enable row level security;
alter table cbt_shadow.school_settings enable row level security;
revoke all on cbt_shadow.exam_pins, cbt_shadow.exam_session_proofs, cbt_shadow.audit_logs, cbt_shadow.school_settings from public, anon, authenticated;
commit;
