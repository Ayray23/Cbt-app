import { useEffect, useState } from "react";
import { collection, getCountFromServer, query, where } from "firebase/firestore";
import { db } from "/firebase";

function MetricCard({ label, value, helper }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-400">
        {label}
      </p>
      <p className="mt-4 text-4xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState({
    students: "-",
    exams: "-",
    published: "-",
    submissions: "-",
  });

  useEffect(() => {
    async function fetchMetrics() {
      const [studentsCount, examsCount, publishedCount, sessionsCount] = await Promise.all([
        getCountFromServer(query(collection(db, "users"), where("role", "==", "student"))),
        getCountFromServer(collection(db, "exams")),
        getCountFromServer(query(collection(db, "exams"), where("status", "==", "published"))),
        getCountFromServer(collection(db, "examSessions")),
      ]);

      setMetrics({
        students: studentsCount.data().count,
        exams: examsCount.data().count,
        published: publishedCount.data().count,
        submissions: sessionsCount.data().count,
      });
    }

    fetchMetrics().catch((error) => console.error("Failed to load metrics", error));
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">MVP operations hub</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          This launch setup is optimized for one clear workflow: create an exam, add questions,
          publish it, let candidates submit once, and review the scored sessions.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Students" value={metrics.students} helper="Candidates with a student role" />
        <MetricCard label="Exams" value={metrics.exams} helper="Draft and published papers" />
        <MetricCard label="Published" value={metrics.published} helper="Ready for live candidates" />
        <MetricCard label="Submissions" value={metrics.submissions} helper="Stored exam sessions" />
      </section>
    </div>
  );
}
