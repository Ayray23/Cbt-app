import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "/firebase";

function MetricCard({ label, value, helper, tone = "slate" }) {
  const toneClassName =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50"
        : tone === "red"
          ? "border-red-200 bg-red-50"
          : "border-slate-200 bg-white";

  return (
    <div className={`rounded-2xl border p-6 shadow-sm ${toneClassName}`}>
      <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-400">{label}</p>
      <p className="mt-4 text-4xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

function formatDate(value) {
  if (value?.seconds) {
    return new Date(value.seconds * 1000).toLocaleString();
  }

  if (value) {
    return new Date(value).toLocaleString();
  }

  return "-";
}

function statusBadgeClass(status, isOfflineRisk) {
  if (status === "submitted") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (isOfflineRisk) {
    return "bg-amber-100 text-amber-800";
  }

  if (status === "started") {
    return "bg-sky-100 text-sky-700";
  }

  return "bg-slate-100 text-slate-700";
}

export default function Monitoring() {
  const [sessions, setSessions] = useState([]);
  const [usersById, setUsersById] = useState({});

  useEffect(() => {
    const unsubscribeSessions = onSnapshot(collection(db, "examSessions"), (snapshot) => {
      setSessions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });

    const unsubscribeUsers = onSnapshot(collection(db, "users"), (snapshot) => {
      setUsersById(
        snapshot.docs.reduce((acc, docItem) => {
          acc[docItem.id] = docItem.data();
          return acc;
        }, {})
      );
    });

    return () => {
      unsubscribeSessions();
      unsubscribeUsers();
    };
  }, []);

  const orderedSessions = useMemo(
    () =>
      [...sessions].sort((first, second) => {
        const secondTime = second.updatedAt?.seconds || second.submittedAt?.seconds || second.startedAt?.seconds || 0;
        const firstTime = first.updatedAt?.seconds || first.submittedAt?.seconds || first.startedAt?.seconds || 0;
        return secondTime - firstTime;
      }),
    [sessions]
  );

  const analytics = useMemo(() => {
    const started = orderedSessions.filter((session) => session.status === "started").length;
    const submitted = orderedSessions.filter((session) => session.status === "submitted").length;
    const violations = orderedSessions.filter((session) => Number(session.tabSwitchCount || 0) > 0).length;
    const forcedClosures = orderedSessions.filter((session) =>
      ["tab-switch-limit", "fullscreen-exit"].includes(session.submissionReason)
    ).length;

    return {
      activeSessions: started,
      submittedSessions: submitted,
      flaggedSessions: violations,
      forcedClosures,
    };
  }, [orderedSessions]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Live invigilation</h2>
        <p className="mt-2 text-sm text-slate-500">
          Monitor active exams, suspicious activity, fullscreen exits, and submitted papers in real time.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active Exams"
          value={analytics.activeSessions}
          helper="Students currently inside a live paper"
          tone="emerald"
        />
        <MetricCard
          label="Submitted"
          value={analytics.submittedSessions}
          helper="Sessions already closed and submitted"
        />
        <MetricCard
          label="Flagged"
          value={analytics.flaggedSessions}
          helper="Sessions with tab-switch warnings"
          tone="amber"
        />
        <MetricCard
          label="Forced Closures"
          value={analytics.forcedClosures}
          helper="Closed by fullscreen exit or violation limit"
          tone="red"
        />
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Exam</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tab warnings</th>
                <th className="px-4 py-3">Submission</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3">Access</th>
              </tr>
            </thead>
            <tbody>
              {orderedSessions.map((session) => {
                const studentProfile = usersById[session.studentUid] || {};
                const studentName =
                  session.studentName ?? studentProfile.displayName ?? session.studentEmail ?? session.studentUid;
                const accessState =
                  studentProfile.role === "student" && studentProfile.loginDisabled ? "Blocked" : "Allowed";
                const isOfflineRisk =
                  session.status === "submitted" && !session.submittedAt?.seconds && Boolean(session.submittedAtMs);

                return (
                  <tr key={session.id} className="border-t border-slate-200">
                    <td className="px-4 py-4 text-slate-700">
                      <p className="font-medium">{studentName}</p>
                      <p className="mt-1 text-xs text-slate-500">{session.studentEmail ?? "-"}</p>
                    </td>
                    <td className="px-4 py-4 text-slate-500">{session.examTitle ?? session.examId}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(session.status, isOfflineRisk)}`}
                      >
                        {isOfflineRisk ? "Waiting to sync" : session.status ?? "-"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-500">{Number(session.tabSwitchCount || 0)}</td>
                    <td className="px-4 py-4 text-slate-500">{session.submissionReason ?? "-"}</td>
                    <td className="px-4 py-4 text-slate-500">
                      {formatDate(session.updatedAt || session.submittedAt || session.startedAtMs)}
                    </td>
                    <td className="px-4 py-4 text-slate-500">{accessState}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {orderedSessions.length === 0 && (
          <div className="p-8 text-sm text-slate-500">No exam sessions yet.</div>
        )}
      </section>
    </div>
  );
}
