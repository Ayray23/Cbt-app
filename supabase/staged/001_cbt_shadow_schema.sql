-- CBT migration stage 1: private shadow store only.
-- NO live Firebase reads/writes or student authentication are changed.
-- Apply only to a new, dedicated CBT Supabase project after review.
-- All Firebase document IDs remain TEXT; never assume they are UUIDs.
begin;

create schema if not exists cbt_shadow;
revoke all on schema cbt_shadow from public, anon, authenticated;

create table if not exists cbt_shadow.users (
  firebase_uid text primary key,
  role text not null check (role in ('superadmin','admin','teacher','invigilator','student','examofficer','teacher_admin')),
  display_name text,
  active boolean not null default true,
  source_document jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  imported_at timestamptz not null default now()
);

create table if not exists cbt_shadow.exams (
  firebase_id text primary key,
  title text not null,
  status text not null check (status in ('draft','published','archived')),
  created_by text,
  academic_session text,
  term text,
  class_name text,
  subject text,
  duration_minutes integer check (duration_minutes between 1 and 480),
  paper_version text,
  source_document jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);

create table if not exists cbt_shadow.questions (
  firebase_id text primary key,
  exam_id text not null references cbt_shadow.exams(firebase_id),
  created_by text,
  source_document jsonb not null,
  imported_at timestamptz not null default now()
);

-- Published papers have the original, confidential marking key. Never expose.
create table if not exists cbt_shadow.exam_papers (
  firebase_version text primary key,
  exam_id text not null references cbt_shadow.exams(firebase_id),
  paper_document jsonb not null,
  imported_at timestamptz not null default now()
);

create table if not exists cbt_shadow.exam_assignments (
  firebase_id text primary key,
  exam_id text not null references cbt_shadow.exams(firebase_id),
  student_uid text not null,
  source_document jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique(exam_id,student_uid)
);

create table if not exists cbt_shadow.exam_sessions (
  firebase_id text primary key,
  exam_id text not null references cbt_shadow.exams(firebase_id),
  student_uid text not null,
  status text not null check (status in ('started','submitted','lan-reserved')),
  started_at_ms bigint,
  expires_at_ms bigint,
  device_epoch integer not null default 0,
  progress_revision integer not null default 0,
  source_document jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique(exam_id,student_uid)
);

create table if not exists cbt_shadow.exam_results (
  firebase_id text primary key,
  exam_id text not null references cbt_shadow.exams(firebase_id),
  student_uid text not null,
  final_score numeric,
  max_marks numeric,
  released boolean not null default false,
  requires_review boolean not null default false,
  source_document jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique(exam_id,student_uid)
);

create index if not exists cbt_shadow_exam_status_idx on cbt_shadow.exams(status);
create index if not exists cbt_shadow_question_exam_idx on cbt_shadow.questions(exam_id);
create index if not exists cbt_shadow_papers_exam_idx on cbt_shadow.exam_papers(exam_id);
create index if not exists cbt_shadow_assignment_student_idx on cbt_shadow.exam_assignments(student_uid,exam_id);
create index if not exists cbt_shadow_session_student_idx on cbt_shadow.exam_sessions(student_uid,status);
create index if not exists cbt_shadow_session_expiry_idx on cbt_shadow.exam_sessions(expires_at_ms) where status='started';
create index if not exists cbt_shadow_result_student_idx on cbt_shadow.exam_results(student_uid,exam_id);

-- Defence in depth, even though the cbt_shadow schema is not exposed.
alter table cbt_shadow.users enable row level security;
alter table cbt_shadow.exams enable row level security;
alter table cbt_shadow.questions enable row level security;
alter table cbt_shadow.exam_papers enable row level security;
alter table cbt_shadow.exam_assignments enable row level security;
alter table cbt_shadow.exam_sessions enable row level security;
alter table cbt_shadow.exam_results enable row level security;

revoke all on all tables in schema cbt_shadow from public, anon, authenticated;
-- No browser policies or grants in stage 1: backend-only credentials in a later stage.
commit;
