import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "/firebase";

function formatDate(value) {
  if (!value) return "—";
  if (typeof value.toDate === "function") return value.toDate().toLocaleString();
  return new Date(value).toLocaleString();
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadLogs() {
      try {
        const snapshot = await getDocs(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(100)));
        setLogs(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      } catch (loadError) {
        console.error(loadError);
        setError("Audit logs could not be loaded. Make sure the auditLogs index is available and your admin account has access.");
      } finally {
        setLoading(false);
      }
    }
    loadLogs();
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-indigo-600">Security & accountability</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Audit trail</h1>
        <p className="mt-2 text-sm text-slate-500">A record of important examination lifecycle actions.</p>
      </div>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr><th className="px-5 py-4">Time</th><th className="px-5 py-4">Action</th><th className="px-5 py-4">Actor</th><th className="px-5 py-4">Exam</th><th className="px-5 py-4">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan="5" className="px-5 py-10 text-center text-slate-500">Loading audit history…</td></tr>}
              {!loading && logs.length === 0 && <tr><td colSpan="5" className="px-5 py-10 text-center text-slate-500">No audit events have been recorded yet.</td></tr>}
              {logs.map((log) => (
                <tr key={log.id} className="align-top hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-5 py-4 text-slate-500">{formatDate(log.createdAt)}</td>
                  <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">{log.action || "—"}</td>
                  <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-slate-500">{log.actorUid || "—"}</td>
                  <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-slate-500">{log.examId || "—"}</td>
                  <td className="max-w-md px-5 py-4 text-xs text-slate-600">{log.metadata ? JSON.stringify(log.metadata) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
