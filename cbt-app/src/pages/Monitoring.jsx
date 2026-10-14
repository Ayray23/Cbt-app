import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "/firebase";

function MetricCard({ label, value, helper, tone = "slate" }) {
  const toneClassName = tone === "emerald" ? "border-emerald-200 bg-emerald-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : tone === "red" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white";
  return <div className={`rounded-2xl border p-6 shadow-sm ${toneClassName}`}><p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-400">{label}</p><p className="mt-4 text-4xl font-semibold text-slate-900">{value}</p><p className="mt-2 text-sm text-slate-500">{helper}</p></div>;
}

function formatDate(value) {
  if (value?.seconds) return new Date(value.seconds * 1000).toLocaleString();
  if (value) return new Date(value).toLocaleString();
  return "-";
}

function isHeartbeatStale(session) {
  if (session.status !== "started") return false;
  const heartbeat = Number(session.lastHeartbeatAtMs || 0);
  return !heartbeat || Date.now() - heartbeat > 45000;
}

function statusBadgeClass(status, risk) {
  if (status === "submitted") return "bg-emerald-100 text-emerald-700";
  if (risk) return "bg-amber-100 text-amber-800";
  if (status === "started") return "bg-sky-100 text-sky-700";
  return "bg-slate-100 text-slate-700";
}

export default function Monitoring() {
  const [sessions, setSessions] = useState([]);
  const [usersById, setUsersById] = useState({});
  useEffect(() => {
    const unsubscribeSessions = onSnapshot(collection(db, "examSessions"), (snapshot) => setSessions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }))));
    const unsubscribeUsers = onSnapshot(collection(db, "users"), (snapshot) => setUsersById(snapshot.docs.reduce((acc, docItem) => { acc[docItem.id] = docItem.data(); return acc; }, {})));
    return () => { unsubscribeSessions(); unsubscribeUsers(); };
  }, []);

  const orderedSessions = useMemo(() => [...sessions].sort((a, b) => (Number(b.lastHeartbeatAtMs || b.updatedAt?.seconds || b.submittedAt?.seconds || 0) - Number(a.lastHeartbeatAtMs || a.updatedAt?.seconds || a.submittedAt?.seconds || 0))), [sessions]);
  const analytics = useMemo(() => {
    const started = orderedSessions.filter((session) => session.status === "started").length;
    const submitted = orderedSessions.filter((session) => session.status === "submitted").length;
    const violations = orderedSessions.filter((session) => Number(session.tabSwitchCount || 0) > 0).length;
    const forcedClosures = orderedSessions.filter((session) => ["tab-switch-limit", "fullscreen-exit"].includes(session.submissionReason)).length;
    const offline = orderedSessions.filter((session) => session.status === "started" && session.networkOnline === false).length;
    const stale = orderedSessions.filter(isHeartbeatStale).length;
    return { activeSessions: started, submittedSessions: submitted, flaggedSessions: violations, forcedClosures, offline, stale };
  }, [orderedSessions]);

  return <div className="space-y-6">
    <section className="rounded-2xl bg-white p-6 shadow-sm"><h2 className="text-2xl font-semibold text-slate-900">Live invigilation</h2><p className="mt-2 text-sm text-slate-500">Monitor active exams, suspicious activity, connectivity, and the last heartbeat from each candidate.</p></section>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><MetricCard label="Active Exams" value={analytics.activeSessions} helper="Students currently inside a live paper" tone="emerald" /><MetricCard label="Submitted" value={analytics.submittedSessions} helper="Sessions already closed and submitted" /><MetricCard label="Flagged" value={analytics.flaggedSessions} helper="Sessions with tab-switch warnings" tone="amber" /><MetricCard label="Offline / stale" value={`${analytics.offline} / ${analytics.stale}`} helper="Offline candidates / heartbeat gaps" tone="red" /></section>
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">Exam</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Network</th><th className="px-4 py-3">Warnings</th><th className="px-4 py-3">Last heartbeat</th><th className="px-4 py-3">Submission</th></tr></thead><tbody>{orderedSessions.map((session) => {
      const studentProfile = usersById[session.studentUid] || {};
      const studentName = session.studentName ?? studentProfile.displayName ?? session.studentEmail ?? session.studentUid;
      const stale = isHeartbeatStale(session);
      const offline = session.networkOnline === false;
      const risk = stale || offline || Number(session.tabSwitchCount || 0) > 0;
      return <tr key={session.id} className="border-t border-slate-200"><td className="px-4 py-4"><p className="font-medium text-slate-700">{studentName}</p><p className="mt-1 text-xs text-slate-500">{session.studentEmail ?? "-"}</p></td><td className="px-4 py-4 text-slate-500">{session.examTitle ?? session.examId}</td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(session.status, risk)}`}>{stale ? "Heartbeat stale" : session.status ?? "-"}</span></td><td className="px-4 py-4"><span className={offline ? "font-semibold text-amber-700" : "text-emerald-700"}>{offline ? "Offline" : "Online"}</span></td><td className="px-4 py-4 text-slate-500">{Number(session.tabSwitchCount || 0)}</td><td className="px-4 py-4 text-slate-500">{formatDate(session.lastHeartbeatAtMs)}</td><td className="px-4 py-4 text-slate-500">{session.submissionReason ?? "-"}</td></tr>;
    })}</tbody></table></div>{orderedSessions.length === 0 && <div className="p-8 text-sm text-slate-500">No exam sessions yet.</div>}</section>
  </div>;
}
