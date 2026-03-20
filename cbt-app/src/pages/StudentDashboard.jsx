import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "/firebase";
import { useAuth } from "../contexts/AuthContext";

export default function StudentDashboard() {
  const { user } = useAuth();
  const [exams, setExams] = useState([]);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    const examsQuery = query(
      collection(db, "exams"),
      where("status", "==", "published"),
      orderBy("createdAt", "desc")
    );

    const unsubscribeExams = onSnapshot(examsQuery, (snapshot) => {
      setExams(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });

    const sessionsQuery = query(
      collection(db, "examSessions"),
      where("studentUid", "==", user.uid)
    );

    const unsubscribeSessions = onSnapshot(sessionsQuery, (snapshot) => {
      setSessions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });

    return () => {
      unsubscribeExams();
      unsubscribeSessions();
    };
  }, [user.uid]);

  const sessionsByExam = useMemo(
    () =>
      sessions.reduce((acc, session) => {
        acc[session.examId] = session;
        return acc;
      }, {}),
    [sessions]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Published Exams</h2>
        <p className="mt-2 text-sm text-slate-500">
          Start an exam only when you are ready. Each exam is saved as a single submission.
        </p>
      </section>

      <section className="grid gap-4">
        {exams.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
            No exam has been published yet.
          </div>
        )}

        {exams.map((exam) => {
          const session = sessionsByExam[exam.id];
          const submitted = session?.status === "submitted";

          return (
            <article
              key={exam.id}
              className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">{exam.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Duration: {exam.duration} minutes
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Questions: {exam.questionCount ?? "Not counted yet"}
                  </p>
                </div>

                <div className="text-left md:text-right">
                  <p className="text-sm font-medium text-slate-700">
                    {submitted ? "Submitted" : session?.status === "started" ? "In progress" : "Not started"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {submitted
                      ? `Score: ${session.finalScore ?? session.totalAutoScore ?? 0}`
                      : "One attempt per student"}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <Link
                  to={`/exam/${exam.id}`}
                  className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                >
                  {submitted ? "Review submission" : "Open exam"}
                </Link>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
