import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "/firebase";
import StatusBanner from "../components/StatusBanner";
import { useAuth } from "../contexts/AuthContext";
import { startExamSession } from "../services/sessionService";

const INSTRUCTIONS = [
  "Read each question carefully before you choose an answer.",
  "You only have one submission for each exam.",
  "Do not refresh or close the browser tab while the exam is running.",
  "Make sure your internet connection is stable before you start.",
];

export default function StudentDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [exams, setExams] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [examPassword, setExamPassword] = useState("");
  const [startingExam, setStartingExam] = useState(false);
  const [banner, setBanner] = useState(
    location.state?.message ? { tone: "success", message: location.state.message } : null
  );

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

  useEffect(() => {
    setExamPassword("");
    setBanner(location.state?.message ? { tone: "success", message: location.state.message } : null);
  }, [location.state?.message, selectedExamId]);

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
  const isStarted = selectedSession?.status === "started";
  const hasPassword = Boolean(selectedExam?.accessCodeHash);

  async function handleStartExam() {
    if (!selectedExam) {
      return;
    }

    setStartingExam(true);
    setBanner(null);

    try {
      await startExamSession(selectedExam.id, examPassword);
      navigate(`/exam/${selectedExam.id}`);
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: error.message ?? "Could not start exam." });
    } finally {
      setStartingExam(false);
    }
  }

  return (
    <div className="space-y-6">
      <StatusBanner
        tone={banner?.tone}
        message={banner?.message}
        onClose={() => setBanner(null)}
      />

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
                      <p className="mt-1">This exam has already been attempted.</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-slate-900">Attempt policy</p>
                      <p className="mt-1">One attempt only. Timer starts immediately.</p>
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

              <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <label className="block text-sm font-medium text-slate-700">Exam password</label>
                <input
                  type="text"
                  value={examPassword}
                  onChange={(event) => setExamPassword(event.target.value)}
                  placeholder={
                    hasPassword
                      ? "Enter the password given by the invigilator"
                      : "Exam password has not been generated yet"
                  }
                  disabled={isSubmitted || isStarted}
                  className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:bg-slate-100"
                />
                <p className="mt-2 text-xs text-slate-500">
                  {isStarted
                    ? "Your session is already live. Continue now and the timer will keep running."
                    : hasPassword
                      ? "You must enter the correct password before the exam can start."
                      : "This exam is not open yet because no password has been generated."}
                </p>
              </div>

              <div className="mt-8">
                {!isSubmitted ? (
                  <button
                    onClick={handleStartExam}
                    disabled={startingExam || (!isStarted && !hasPassword)}
                    className="inline-flex rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {startingExam ? "Verifying..." : isStarted ? "Continue exam" : "Start exam"}
                  </button>
                ) : (
                  <button
                    disabled
                    className="inline-flex cursor-not-allowed rounded-xl bg-slate-300 px-5 py-3 text-sm font-medium text-white"
                  >
                    Attempted
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
