export function percentage(result) {
  const score = Number(result.finalScore); const max = Number(result.maxMarks);
  return !result.requiresReview && Number.isFinite(score) && Number.isFinite(max) && max > 0 && score >= 0 && score <= max ? score / max * 100 : null;
}
export function subjectTotals(results) {
  const groups = new Map();
  for (const r of results) {
    if (!r.academicSession || !r.term || !r.subject || !['ca', 'exam'].includes(r.category)) continue;
    const key = JSON.stringify([r.studentUid, r.academicSession, r.term, r.className, r.subject]);
    const entry = groups.get(key) || { key, studentName: r.studentName, academicSession: r.academicSession, term: r.term, className: r.className, subject: r.subject, weight: 0, total: 0, valid: true, released: true };
    const p = percentage(r); const weight = Number(r.weight);
    entry.valid &&= p !== null && Number.isFinite(weight) && weight > 0;
    entry.released &&= r.released === true;
    entry.weight += weight; entry.total += (p || 0) * weight / 100; groups.set(key, entry);
  }
  return [...groups.values()].map(g => ({ ...g, complete: g.valid && Math.abs(g.weight - 100) < 0.001 }));
}
