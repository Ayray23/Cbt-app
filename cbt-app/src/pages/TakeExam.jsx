import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, getDocs, collection, query, where } from "firebase/firestore";
import { db } from "/firebase";
import { startExamSession, submitExamSession } from "../services/sessionService";

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function TakeExam() {
  const { examId } = useParams();
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [timeLeft, setTimeLeft] = useState(null);

  const handleSubmit = useEffectEvent(async () => {
    if (submitting || session?.status === "submitted") {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const submittedSession = await submitExamSession(examId, answers);
      setSession(submittedSession);
      setAnswers(submittedSession.answers ?? {});
      setTimeLeft(0);
    } catch (submitError) {
      console.error(submitError);
      setError(submitError.message ?? "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  });

  useEffect(() => {
    async function loadExam() {
      setLoading(true);
      setError("");

      try {
        const examSnapshot = await getDoc(doc(db, "exams", examId));
        if (!examSnapshot.exists()) {
          throw new Error("Exam not found.");
        }

        const examData = { id: examSnapshot.id, ...examSnapshot.data() };
        setExam(examData);

        const questionsSnapshot = await getDocs(
          query(collection(db, "questions"), where("examId", "==", examId))
        );
        const loadedQuestions = questionsSnapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }));

        loadedQuestions.sort((a, b) => {
          const first = a.createdAt?.seconds ?? 0;
          const second = b.createdAt?.seconds ?? 0;
          return first - second;
        });

        setQuestions(loadedQuestions);

        const startedSession = await startExamSession(examId);
        setSession(startedSession);
        setAnswers(startedSession.answers ?? {});

        if (startedSession.status !== "submitted") {
          const startedAt = startedSession.startedAtMs ?? Date.now();
          const durationSeconds = (examData.duration ?? 0) * 60;
          const expiresAt = startedAt + durationSeconds * 1000;
          setTimeLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
        }
      } catch (loadError) {
        console.error(loadError);
        setError(loadError.message ?? "Failed to load exam.");
      } finally {
        setLoading(false);
      }
    }

    loadExam();
  }, [examId]);

  useEffect(() => {
    if (timeLeft === null || session?.status === "submitted") {
      return undefined;
    }

    if (timeLeft <= 0) {
      void handleSubmit();
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setTimeLeft((current) => {
        if (current === null) {
          return current;
        }

        return Math.max(0, current - 1);
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [handleSubmit, timeLeft, session?.status]);

  const totalMarks = useMemo(
    () => questions.reduce((sum, question) => sum + Number(question.marks ?? 1), 0),
    [questions]
  );

  if (loading) {
    return <div className="rounded-2xl bg-white p-6 shadow-sm">Loading exam...</div>;
  }

  if (error) {
    return <div className="rounded-2xl bg-red-50 p-6 text-sm text-red-700">{error}</div>;
  }

  if (!exam) {
    return <div className="rounded-2xl bg-white p-6 shadow-sm">Exam unavailable.</div>;
  }

  const submitted = session?.status === "submitted";

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">{exam.title}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {questions.length} questions, {totalMarks} total marks
            </p>
          </div>

          <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
            {submitted ? (
              <div>
                <p className="font-semibold text-slate-900">Submission complete</p>
                <p className="mt-1">
                  Score: {session.finalScore ?? session.totalAutoScore ?? 0} / {totalMarks}
                </p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-slate-900">Time left</p>
                <p className="mt-1 text-lg">{formatTime(timeLeft ?? exam.duration * 60)}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        {questions.map((question, index) => {
          const prompt = question.text ?? question.question ?? "";
          const options = question.options ?? {};

          return (
            <article key={question.id} className="rounded-2xl bg-white p-6 shadow-sm">
              <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-400">
                Question {index + 1}
              </p>
              <h3 className="mt-2 text-lg font-medium text-slate-900">{prompt}</h3>

              <div className="mt-4 grid gap-3">
                {["A", "B", "C", "D"].map((optionKey) => (
                  <label
                    key={optionKey}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3"
                  >
                    <input
                      type="radio"
                      name={question.id}
                      value={optionKey}
                      checked={answers[question.id] === optionKey}
                      disabled={submitted}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: event.target.value,
                        }))
                      }
                    />
                    <span className="text-sm text-slate-700">
                      <span className="font-semibold">{optionKey}.</span>{" "}
                      {options[optionKey] ?? ""}
                    </span>
                  </label>
                ))}
              </div>

              {submitted && (
                <p className="mt-4 text-sm text-slate-500">
                  Correct answer: {question.correctAnswer ?? "Not provided"}
                </p>
              )}
            </article>
          );
        })}
      </section>

      {!submitted && (
        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit exam"}
          </button>
        </div>
      )}
    </div>
  );
}
