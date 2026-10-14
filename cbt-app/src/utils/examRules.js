export function getExamScheduleState(exam, nowMs = Date.now()) {
  const start = Number(exam?.scheduleStartAtMs || 0);
  const end = Number(exam?.scheduleEndAtMs || 0);
  if (start && nowMs < start) return { state: "upcoming", startAtMs: start, endAtMs: end || null };
  if (end && nowMs >= end) return { state: "closed", startAtMs: start || null, endAtMs: end };
  return { state: "open", startAtMs: start || null, endAtMs: end || null };
}

export function calculateAutoScore(questions, answers) {
  return (questions || []).reduce((total, question) => {
    const answer = String(answers?.[question.id] || "").trim().toUpperCase();
    const correct = String(question.correctAnswer || "").trim().toUpperCase();
    return total + (answer && answer === correct ? Number(question.marks || 1) : 0);
  }, 0);
}

export function getHeartbeatHealth(session, nowMs = Date.now(), staleAfterMs = 45000) {
  if (session?.status !== "started") return "inactive";
  if (session.networkOnline === false) return "offline";
  const heartbeat = Number(session.lastHeartbeatAtMs || 0);
  return heartbeat && nowMs - heartbeat <= staleAfterMs ? "online" : "stale";
}
