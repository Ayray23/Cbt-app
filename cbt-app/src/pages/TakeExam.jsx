import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "/firebase";
import {
  saveExamProgress,
  startExamSession,
  submitExamSession,
} from "../services/sessionService";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusBanner from "../components/StatusBanner";

const DISPLAY_OPTION_LABELS = ["A", "B", "C", "D"];
const MAX_TAB_SWITCH_WARNINGS = 3;

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function paletteClassName({ isActive, isAnswered }) {
  if (isActive) {
    return "border-slate-900 bg-slate-900 text-white";
  }

  if (isAnswered) {
    return "border-emerald-300 bg-emerald-50 text-emerald-700";
  }

  return "border-slate-200 bg-white text-slate-600";
}

export default function TakeExam() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [timeLeft, setTimeLeft] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const hydratedAnswersRef = useRef(false);
  const autosaveTimeoutRef = useRef(null);
  const lastSavedAnswersRef = useRef("");
  const answersRef = useRef({});
  const warningCountRef = useRef(0);
  const sessionStatus = session?.status ?? null;

  const handleSubmit = useEffectEvent(async (submissionReason = "manual") => {
    if (submitting || session?.status === "submitted") {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await submitExamSession(examId, answersRef.current, {
        submissionReason,
        tabSwitchCount: warningCountRef.current,
        integrityWarnings: warningCountRef.current,
      });
    } catch (submitError) {
      console.error(submitError);
      if (window.navigator.onLine) {
        setError(submitError.message ?? "Submission failed.");
        return;
      }
    } finally {
      setSubmitting(false);
    }

    navigate("/portal", {
      replace: true,
      state: {
        message: "Exam submitted successfully. You cannot reopen this exam.",
      },
    });
  });

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    warningCountRef.current = warningCount;
  }, [warningCount]);

  const requestFullscreenMode = useEffectEvent(async () => {
    if (!document.fullscreenEnabled || document.fullscreenElement) {
      return;
    }

    try {
      await document.documentElement.requestFullscreen();
    } catch (fullscreenError) {
      console.error(fullscreenError);
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

        const startedSession = await startExamSession(examId);
        const order = startedSession.questionOrder ?? [];
        const sortedQuestions =
          order.length > 0
            ? [...loadedQuestions].sort((first, second) => order.indexOf(first.id) - order.indexOf(second.id))
            : loadedQuestions;

        setQuestions(sortedQuestions);
        setSession(startedSession);
        setAnswers(startedSession.answers ?? {});
        answersRef.current = startedSession.answers ?? {};
        hydratedAnswersRef.current = true;
        lastSavedAnswersRef.current = JSON.stringify(startedSession.answers ?? {});
        setWarningCount(Number(startedSession.tabSwitchCount || 0));

        const firstUnansweredIndex = sortedQuestions.findIndex(
          (question) => !(startedSession.answers ?? {})[question.id]
        );
        setCurrentQuestionIndex(firstUnansweredIndex >= 0 ? firstUnansweredIndex : 0);

        if (startedSession.status !== "submitted") {
          const expiresAt =
            startedSession.expiresAtMs ??
            (startedSession.startedAtMs ?? Date.now()) + (examData.duration ?? 0) * 60 * 1000;
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
    if (!loading && sessionStatus !== "submitted") {
      void requestFullscreenMode();
    }
  }, [loading, requestFullscreenMode, sessionStatus]);

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

  useEffect(() => {
    if (!hydratedAnswersRef.current || !sessionStatus || sessionStatus === "submitted" || submitting) {
      return undefined;
    }

    const serializedAnswers = JSON.stringify(answers);
    if (serializedAnswers === lastSavedAnswersRef.current) {
      return undefined;
    }

    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = window.setTimeout(async () => {
      try {
        setSaving(true);
        const updatedSession = await saveExamProgress(examId, answers, {
          tabSwitchCount: warningCountRef.current,
          integrityWarnings: warningCountRef.current,
        });
        lastSavedAnswersRef.current = serializedAnswers;
        setSession((current) => ({
          ...current,
          ...updatedSession,
        }));
      } catch (saveError) {
        console.error(saveError);
      } finally {
        setSaving(false);
      }
    }, 800);

    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [answers, examId, sessionStatus, submitting]);

  useEffect(() => {
    if (!sessionStatus || sessionStatus === "submitted") {
      return undefined;
    }

    function preventClipboard(event) {
      event.preventDefault();
    }

    function preventShortcutKeys(event) {
      const pressedKey = String(event.key || "").toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ["c", "v", "x", "a", "s", "p"].includes(pressedKey)) {
        event.preventDefault();
      }
    }

    window.addEventListener("copy", preventClipboard);
    window.addEventListener("cut", preventClipboard);
    window.addEventListener("paste", preventClipboard);
    window.addEventListener("contextmenu", preventClipboard);
    window.addEventListener("keydown", preventShortcutKeys);

    return () => {
      window.removeEventListener("copy", preventClipboard);
      window.removeEventListener("cut", preventClipboard);
      window.removeEventListener("paste", preventClipboard);
      window.removeEventListener("contextmenu", preventClipboard);
      window.removeEventListener("keydown", preventShortcutKeys);
    };
  }, [sessionStatus]);

  useEffect(() => {
    if (!sessionStatus || sessionStatus === "submitted") {
      return undefined;
    }

    function handleFullscreenChange() {
      const isActive = Boolean(document.fullscreenElement);
      if (!isActive && sessionStatus !== "submitted" && !submitting) {
        void handleSubmit("fullscreen-exit");
      }
    }

    async function handleVisibilityChange() {
      if (!document.hidden || sessionStatus === "submitted" || submitting) {
        return;
      }

      const nextWarningCount = warningCountRef.current + 1;
      setWarningCount(nextWarningCount);

      try {
        await saveExamProgress(examId, answersRef.current, {
          tabSwitchCount: nextWarningCount,
          integrityWarnings: nextWarningCount,
          lastVisibilityChangeAtMs: Date.now(),
        });
      } catch (visibilityError) {
        console.error(visibilityError);
      }

      if (nextWarningCount >= MAX_TAB_SWITCH_WARNINGS) {
        await handleSubmit("tab-switch-limit");
      }
    }

    function handleBeforeUnload(event) {
      if (sessionStatus === "submitted") {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [examId, handleSubmit, sessionStatus, submitting]);

  const totalMarks = useMemo(
    () => questions.reduce((sum, question) => sum + Number(question.marks ?? 1), 0),
    [questions]
  );

  const answeredCount = useMemo(
    () => questions.filter((question) => Boolean(answers[question.id])).length,
    [answers, questions]
  );

  if (loading) {
    return <div className="rounded-2xl bg-white p-6 shadow-sm">Loading exam...</div>;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <StatusBanner tone="error" message={error} />
      </div>
    );
  }

  if (!exam || questions.length === 0) {
    return <div className="rounded-2xl bg-white p-6 shadow-sm">Exam unavailable.</div>;
  }

  const currentQuestion = questions[currentQuestionIndex];
  const prompt = currentQuestion.text ?? currentQuestion.question ?? "";
  const options = currentQuestion.options ?? {};
  const optionOrder = session?.optionOrderByQuestion?.[currentQuestion.id] ?? DISPLAY_OPTION_LABELS;
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  async function confirmAndSubmit() {
    setShowSubmitConfirm(true);
  }

  function moveToNextQuestion() {
    setCurrentQuestionIndex((current) => Math.min(current + 1, questions.length - 1));
  }

  function moveToPreviousQuestion() {
    setCurrentQuestionIndex((current) => Math.max(current - 1, 0));
  }

  return (
    <div className="space-y-6">
      <StatusBanner
        tone={saving ? "info" : null}
        message={saving ? "Saving your answers..." : ""}
      />

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">
              Live Exam
            </p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900">{exam.title}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {questions.length} questions • {totalMarks} total marks
            </p>
          </div>

          <div className="rounded-2xl bg-slate-100 px-4 py-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Time left</p>
            <p className="mt-1 text-2xl">{formatTime(timeLeft ?? exam.duration * 60)}</p>
            <p className="mt-2 text-xs text-slate-500">Answered {answeredCount} of {questions.length}</p>
            <p className="mt-1 text-xs text-slate-500">
              {saving ? "Saving your answers..." : "Answers autosave while you work."}
            </p>
            <p className="mt-1 text-xs text-slate-500">Tab warnings: {warningCount}/{MAX_TAB_SWITCH_WARNINGS}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <aside className="rounded-3xl bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Question palette</h3>
          <p className="mt-2 text-sm text-slate-500">
            Tap any number to jump directly to that question.
          </p>

          <div className="mt-5 grid grid-cols-5 gap-3">
            {questions.map((question, index) => (
              <button
                key={question.id}
                type="button"
                onClick={() => setCurrentQuestionIndex(index)}
                className={[
                  "rounded-xl border px-0 py-3 text-sm font-semibold transition",
                  paletteClassName({
                    isActive: index === currentQuestionIndex,
                    isAnswered: Boolean(answers[question.id]),
                  }),
                ].join(" ")}
              >
                {index + 1}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-2 text-xs text-slate-500">
            <p>Dark tile: current question</p>
            <p>Green tile: answered question</p>
            <p>White tile: unanswered question</p>
          </div>
        </aside>

        <section className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-400">
              Question {currentQuestionIndex + 1}
            </p>
            <p className="text-sm text-slate-500">
              Marks: {currentQuestion.marks ?? 1}
            </p>
          </div>

          <h3 className="mt-4 text-2xl font-medium text-slate-900">{prompt}</h3>

          <div className="mt-6 grid gap-4">
            {optionOrder.map((originalOptionKey, optionIndex) => (
              <label
                key={`${currentQuestion.id}-${originalOptionKey}`}
                className={[
                  "flex cursor-pointer items-start gap-4 rounded-2xl border px-4 py-4 transition",
                  answers[currentQuestion.id] === originalOptionKey
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name={currentQuestion.id}
                  value={originalOptionKey}
                  checked={answers[currentQuestion.id] === originalOptionKey}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [currentQuestion.id]: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-semibold">{DISPLAY_OPTION_LABELS[optionIndex]}.</span>{" "}
                  {options[originalOptionKey] ?? ""}
                </span>
              </label>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={moveToPreviousQuestion}
                disabled={currentQuestionIndex === 0}
                className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>

              <button
                type="button"
                onClick={moveToNextQuestion}
                disabled={currentQuestionIndex === questions.length - 1}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>

            {isLastQuestion && (
              <button
                type="button"
                onClick={confirmAndSubmit}
                disabled={submitting}
                className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
              >
                {submitting ? "Submitting..." : "Submit exam"}
              </button>
            )}
          </div>
        </section>
      </section>

      <ConfirmDialog
        open={showSubmitConfirm}
        title="Submit exam?"
        message="After you submit, you cannot return to this exam again."
        confirmLabel="Yes, submit"
        cancelLabel="No, go back"
        tone="success"
        onConfirm={async () => {
          setShowSubmitConfirm(false);
          await handleSubmit();
        }}
        onCancel={() => setShowSubmitConfirm(false)}
      />
    </div>
  );
}
