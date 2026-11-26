import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/staged/001_cbt_shadow_schema.sql", import.meta.url), "utf8");
const tables = ["users", "exams", "questions", "exam_papers", "exam_assignments", "exam_sessions", "exam_results"];

test("Supabase shadow schema maps all seven core collections and keeps Firebase identifiers", () => {
  for (const name of tables) {
    assert.match(sql, new RegExp(`create table if not exists cbt_shadow\\.${name} `, "i"));
    assert.match(sql, new RegExp(`alter table cbt_shadow\\.${name} enable row level security;`, "i"));
  }
  assert.match(sql, /firebase_uid text primary key/i);
  assert.match(sql, /firebase_id text primary key/i);
  assert.match(sql, /firebase_version text primary key/i);
});

test("shadow schema has no browser access, authentication migration or live cutover", () => {
  assert.match(sql, /revoke all on schema cbt_shadow from public, anon, authenticated/i);
  assert.match(sql, /revoke all on all tables in schema cbt_shadow from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /create policy|grant\s+(select|insert|update|delete|all)\s+on/i);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from/i);
});
