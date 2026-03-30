import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "/firebase";
import { useAuth } from "../contexts/AuthContext";

const INSTRUCTIONS = [
  "Read each question carefully before you choose an answer.",
  "You only have one submission for each exam.",
  "Do not refresh or close the browser tab while the exam is running.",
  "Make sure your internet connection is stable before you start.",
];

export default function StudentDashboard() {
  const { user } = useAuth();
  const [exams, setExams] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");

  useEffect(() => {
    const examsQuery = query(
      collection(db, "exams"),
      where("status", "==", "published"),
      orderBy("createdAt", "desc")
    );

    const unsubscribeExams = onSnapshot(examsQuery, (snapshot) => {
      const nextExams = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      setExams(nextExams);

      if (!selectedExamId && nextExams.length > 0) {
        setSelectedExamId(nextExams[0].id);
      }
    });

    const sessionsQuery = query(collection(db, "examSessions"), where("studentUid", "==", user.uid));

    const unsubscribeSessions = onSnapshot(sessionsQuery, (snapshot) => {
      setSessions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });

    return () => {
      unsubscribeExams();
      unsubscribeSessions();
    };
  }, [selectedExamId, user.uid]);

  const sessionsByExam = useMemo(
    () =>
      sessions.reduce((acc, session) => {
        acc[session.examId] = session;
        return acc;
      }, {}),
    [sessions]
  );

  const selectedExam = exams.find((exam) => exam.id === selectedExamId) ?? null;
  const selectedSession = selectedExam ? sessionsByExam[selectedExam.id] : null;
  const isSubmitted = selectedSession?.status === "submitted";

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">
          Available Exam
        </p>
        <h2 className="mt-3 text-3xl font-semibold text-slate-900">Select your paper</h2>
        <p className="mt-3 max-w-2xl text-sm text-slate-500">
          Choose the exam you are scheduled to take, read the instructions, and start only when you
          are ready.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">Exam</label>
          <select
            value={selectedExamId}
            onChange={(event) => setSelectedExamId(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3"
          >
            <option value="">Select exam</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </select>

          <div className="mt-6 space-y-3">
            {exams.map((exam) => {
              const session = sessionsByExam[exam.id];
              return (
                <button
                  key={exam.id}
                  onClick={() => setSelectedExamId(exam.id)}
                  className={[
                    "w-full rounded-2xl border px-4 py-4 text-left transition",
                    selectedExamId === exam.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700",
                  ].join(" ")}
                >
                  <p className="font-medium">{exam.title}</p>
                  <p className="mt-1 text-sm opacity-80">{exam.duration} minutes</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.25em] opacity-70">
                    {session?.status === "submitted"
                      ? "Submitted"
                      : session?.status === "started"
                        ? "In progress"
                        : "Ready"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
          {!selectedExam && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-sm text-slate-500">
              No published exam is available yet.
            </div>
          )}

          {selectedExam && (
            <>
              <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-2xl font-semibold text-slate-900">{selectedExam.title}</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Duration: {selectedExam.duration} minutes
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Questions: {selectedExam.questionCount ?? "Not counted yet"}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
                  {isSubmitted ? (
                    <>
                      <p className="font-semibold text-slate-900">Submitted</p>
                      <p className="mt-1">
                        Score: {selectedSession.finalScore ?? selectedSession.totalAutoScore ?? 0}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-slate-900">Attempt policy</p>
                      <p className="mt-1">One attempt per student</p>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <h4 className="text-lg font-semibold text-slate-900">Instructions</h4>
                <div className="mt-4 space-y-3">
                  {INSTRUCTIONS.map((instruction) => (
                    <div
                      key={instruction}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                    >
                      {instruction}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8">
                <Link
                  to={`/exam/${selectedExam.id}`}
                  className="inline-flex rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white"
                >
                  {isSubmitted ? "Review exam" : "Start exam"}
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
