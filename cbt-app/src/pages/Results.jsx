import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "/firebase";

export default function Results() {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    const sessionsQuery = query(collection(db, "examSessions"), orderBy("submittedAt", "desc"));

    return onSnapshot(sessionsQuery, (snapshot) => {
      setSessions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Live submissions</h2>
        <p className="mt-2 text-sm text-slate-500">
          Every submitted exam session is stored here with the computed score.
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Exam</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-t border-slate-200">
                  <td className="px-4 py-4 text-slate-700">
                    {session.studentName ?? session.studentEmail ?? session.studentUid}
                  </td>
                  <td className="px-4 py-4 text-slate-500">{session.examTitle ?? session.examId}</td>
                  <td className="px-4 py-4 text-slate-500">{session.status ?? "-"}</td>
                  <td className="px-4 py-4 text-slate-500">
                    {session.finalScore ?? session.totalAutoScore ?? 0}
                  </td>
                  <td className="px-4 py-4 text-slate-500">
                    {session.submittedAt?.seconds
                      ? new Date(session.submittedAt.seconds * 1000).toLocaleString()
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sessions.length === 0 && (
          <div className="p-8 text-sm text-slate-500">No submitted sessions yet.</div>
        )}
      </section>
    </div>
  );
}
