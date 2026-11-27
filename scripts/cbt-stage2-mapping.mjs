// Pure Firebase -> private PostgreSQL row mapping for migration stage 2.
// No network access or privileged credentials in this module.
export const COLLECTIONS = Object.freeze([
  ["users", "users", "firebase_uid"],
  ["exams", "exams", "firebase_id"],
  ["questions", "questions", "firebase_id"],
  ["examPapers", "exam_papers", "firebase_version"],
  ["examAssignments", "exam_assignments", "firebase_id"],
  ["examSessions", "exam_sessions", "firebase_id"],
  ["examResults", "exam_results", "firebase_id"],
  ["examPins", "exam_pins", "firebase_id"],
  ["examSessionProofs", "exam_session_proofs", "firebase_id"],
  ["auditLogs", "audit_logs", "firebase_id"],
  ["school", "school_settings", "firebase_id"],
]);

const finiteNumber = (value) =>
  value === undefined || value === null || value === ""
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
const stringOrNull = (value) => value === undefined || value === null ? null : String(value);
const ensureId = (value, label) => {
  if (typeof value !== "string" || !value || value.length > 1000)
    throw new Error(`Invalid ${label}`);
  return value;
};

export function toShadowRow(collection, record) {
  const id = ensureId(record?.id, "Firestore document ID");
  const d = record?.data;
  if (!d || typeof d !== "object" || Array.isArray(d))
    throw new Error(`Invalid document data in ${collection}/${id}`);
  const source_document = d;
  switch (collection) {
    case "users":
      return {
        firebase_uid: id,
        role: String(d.role || ""),
        display_name: stringOrNull(d.displayName),
        active: !d.loginDisabled,
        source_document,
      };
    case "exams":
      return {
        firebase_id: id,
        title: String(d.title || id),
        status: String(d.status || "draft"),
        created_by: stringOrNull(d.createdBy),
        academic_session: stringOrNull(d.academicSession),
        term: stringOrNull(d.term),
        class_name: stringOrNull(d.className),
        subject: stringOrNull(d.subject),
        duration_minutes: finiteNumber(d.duration),
        paper_version: stringOrNull(d.paperVersion),
        source_document,
      };
    case "questions":
      return {
        firebase_id: id,
        exam_id: ensureId(d.examId, `${collection}/${id}.examId`),
        created_by: stringOrNull(d.createdBy),
        source_document,
      };
    case "examPapers":
      return {
        firebase_version: id,
        exam_id: ensureId(d.examId, `${collection}/${id}.examId`),
        paper_document: d,
      };
    case "examAssignments":
      return {
        firebase_id: id,
        exam_id: ensureId(d.examId, `${collection}/${id}.examId`),
        student_uid: ensureId(d.studentUid, `${collection}/${id}.studentUid`),
        source_document,
      };
    case "examSessions":
      return {
        firebase_id: id,
        exam_id: ensureId(d.examId, `${collection}/${id}.examId`),
        student_uid: ensureId(d.studentUid, `${collection}/${id}.studentUid`),
        status: String(d.status || "started"),
        started_at_ms: finiteNumber(d.startedAtMs),
        expires_at_ms: finiteNumber(d.expiresAtMs),
        device_epoch: finiteNumber(d.deviceEpoch) || 0,
        progress_revision: finiteNumber(d.progressRevision) || 0,
        source_document,
      };
    case "examResults":
      return {
        firebase_id: id,
        exam_id: ensureId(d.examId, `${collection}/${id}.examId`),
        student_uid: ensureId(d.studentUid, `${collection}/${id}.studentUid`),
        final_score: finiteNumber(d.finalScore),
        max_marks: finiteNumber(d.maxMarks),
        released: d.released === true,
        requires_review: d.requiresReview === true,
        source_document,
      };
    case "examPins":
      return {
        firebase_id: id,
        exam_id: ensureId(d.examId, `${collection}/${id}.examId`),
        student_uid: ensureId(d.studentUid, `${collection}/${id}.studentUid`),
        pin_digest: stringOrNull(d.digest),
        pin_tag: stringOrNull(d.pinTag),
        attempts: finiteNumber(d.attempts) || 0,
        locked_until_ms: finiteNumber(d.lockedUntilMs) || 0,
        source_document,
      };
    case "examSessionProofs": {
      // Firestore's proof records contain studentUid and paperVersion but
      // no examId. The document ID was generated as `${examId}_${studentUid}`.
      const student_uid = ensureId(d.studentUid, `${collection}/${id}.studentUid`);
      const suffix = `_${student_uid}`;
      if (!id.endsWith(suffix)) throw new Error(`Invalid session proof ID ${id}`);
      return {
        firebase_id: id,
        exam_id: ensureId(id.slice(0, -suffix.length), `${collection}/${id}.examId`),
        student_uid,
        paper_version: stringOrNull(d.paperVersion),
        source_document,
      };
    }
    case "auditLogs":
      return {
        firebase_id: id,
        actor_uid: stringOrNull(d.actorUid),
        action: stringOrNull(d.action),
        target: stringOrNull(d.target),
        created_at_ms: finiteNumber(d.createdAtMs),
        source_document,
      };
    case "school":
      return { firebase_id: id, source_document };
    default:
      throw new Error(`Unsupported collection: ${collection}`);
  }
}

export function validateShadowSnapshot(snapshot) {
  const rows = new Map();
  for (const [collection] of COLLECTIONS) {
    const docs = snapshot[collection];
    if (!Array.isArray(docs)) throw new Error(`Missing snapshot collection: ${collection}`);
    const seen = new Set();
    rows.set(collection, docs.map((record) => {
      const row = toShadowRow(collection, record);
      if (seen.has(record.id)) throw new Error(`Duplicate ${collection}/${record.id}`);
      seen.add(record.id);
      return row;
    }));
  }
  const examIds = new Set(rows.get("exams").map((row) => row.firebase_id));
  for (const collection of ["questions", "examPapers", "examAssignments", "examSessions", "examResults", "examPins", "examSessionProofs"])
    for (const row of rows.get(collection))
      if (!examIds.has(row.exam_id))
        throw new Error(`Missing parent exam ${row.exam_id} for ${collection}`);
  for (const collection of ["examAssignments", "examSessions", "examResults", "examPins", "examSessionProofs"]) {
    const seen = new Set();
    for (const row of rows.get(collection)) {
      const key = `${row.exam_id}::${row.student_uid}`;
      if (seen.has(key)) throw new Error(`Duplicate exam/student pair in ${collection}: ${key}`);
      seen.add(key);
    }
  }
  const sessionsById = new Map(rows.get("examSessions").map((row) => [row.firebase_id, row]));
  const paperVersions = new Set(rows.get("examPapers").map((row) => row.firebase_version));
  for (const proof of rows.get("examSessionProofs")) {
    const session = sessionsById.get(proof.firebase_id);
    if (!session || proof.exam_id !== session.exam_id || proof.student_uid !== session.student_uid)
      throw new Error(`Session proof mismatch for ${proof.firebase_id}`);
    if (!proof.paper_version || !paperVersions.has(proof.paper_version))
      throw new Error(`Session proof references unknown paper version ${proof.paper_version}`);
  }
  const assignmentsById = new Set(rows.get("examAssignments").map((row) => row.firebase_id));
  for (const pin of rows.get("examPins")) {
    if (!assignmentsById.has(pin.firebase_id))
      throw new Error(`PIN has no assignment: ${pin.firebase_id}`);
  }
  const active = rows.get("examSessions").filter((row) => row.status === "started");
  if (active.length)
    throw new Error(`${active.length} started exam session(s) still exist. Do not export/import live exam sessions; complete and reconcile them first.`);
  const unsubmitted = new Set(rows.get("examSessions").filter((row) => row.status !== "submitted").map((row) => row.firebase_id));
  if (unsubmitted.size)
    throw new Error(`${unsubmitted.size} non-submitted session(s) require review before the historical snapshot is imported.`);
  return rows;
}

// Only static table/column names from the mapping above; data values are
// escaped as SQL literals. Never use identifiers taken from a Firestore record.
export function stage2Sql(snapshot) {
  const rows = validateShadowSnapshot(snapshot);
  const esc = (value) => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Non-finite numeric value");
      return String(value);
    }
    if (typeof value === "object")
      return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    return `'${String(value).replace(/'/g, "''")}'`;
  };
  const statements = [
    "-- PRIVATE, SENSITIVE: generated locally from real school exam data.",
    "-- Only run against the dedicated School-CBT Supabase database.",
    "begin;",
    "set local statement_timeout = '120s';",
    "set local standard_conforming_strings = on;",
  ];
  for (const [collection, table, primaryKey] of COLLECTIONS) {
    for (const row of rows.get(collection)) {
      const columns = Object.keys(row);
      const updates = columns.filter((col) => col !== primaryKey).map((col) => `${col}=excluded.${col}`).join(", ");
      statements.push(`insert into cbt_shadow.${table} (${columns.join(", ")}) values (${columns.map((col) => esc(row[col])).join(", ")}) on conflict (${primaryKey}) do update set ${updates};`);
    }
  }
  statements.push("commit;");
  return statements.join("\n") + "\n";
}
