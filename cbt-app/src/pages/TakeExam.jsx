import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "/firebase";
import {
  saveExamProgress,
  saveLocalExamDraft,
  startExamSession,
  submitExamSession,
} from "../services/sessionService";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusBanner from "../components/StatusBanner";
import ExamCalculator from "../components/ExamCalculator";

const DISPLAY_OPTION_LABELS = ["A", "B", "C", "D"];
const MAX_TAB_SWITCH_WARNINGS = 3;

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  const hasEnteredFullscreenRef = useRef(false);
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
      const result = await submitExamSession(examId, answersRef.current, {
        submissionReason,
        tabSwitchCount: warningCountRef.current,
        integrityWarnings: warningCountRef.current,
      });

      navigate("/portal", {
        replace: true,
        state: {
          message: result.pendingSync
            ? "Exam closed offline. Your submission is saved on this device and will sync automatically when internet returns."
            : "Exam submitted successfully. You cannot reopen this exam.",
        },
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
      hasEnteredFullscreenRef.current = Boolean(document.fullscreenElement);
    } catch (fullscreenError) {
      // Fullscreen can be denied unless the request follows a user gesture.
      // A denied request must not be treated as an exam violation.
      console.info("Fullscreen mode is unavailable; continuing the exam normally.", fullscreenError);
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

    // Persist the latest selection locally immediately. Firebase sync is debounced
    // so changing several answers quickly does not trigger a write for each click.
    try {
      saveLocalExamDraft(examId, answers, {
        tabSwitchCount: warningCountRef.current,
        integrityWarnings: warningCountRef.current,
      });
    } catch (draftError) {
      console.error("Could not save the local exam draft", draftError);
    }

    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = window.setTimeout(async () => {
      try {
        setSaving(true);
        await saveExamProgress(examId, answers, {
          tabSwitchCount: warningCountRef.current,
          integrityWarnings: warningCountRef.current,
        });
        lastSavedAnswersRef.current = serializedAnswers;
      } catch (saveError) {
        console.error(saveError);
      } finally {
        setSaving(false);
      }
    }, 1500);

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

      if (isActive) {
        hasEnteredFullscreenRef.current = true;
        return;
      }

      // Enforce fullscreen exit only after fullscreen was genuinely entered.
      // Browser-denied initial requests must never close or submit an exam.
      if (hasEnteredFullscreenRef.current && sessionStatus !== "submitted" && !submitting) {
        hasEnteredFullscreenRef.current = false;
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
    return (
      <div className="min-h-screen bg-[#f5f7fb] px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-7xl animate-pulse space-y-5">
          <div className="h-16 rounded-2xl bg-white" />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
            <div className="h-[560px] rounded-3xl bg-white" />
            <div className="h-[560px] rounded-3xl bg-white" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4">
        <div className="w-full max-w-xl rounded-3xl border border-rose-100 bg-white p-8 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-xl text-rose-600">!</div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">We couldn’t open this exam</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{error}</p>
          <button type="button" onClick={() => navigate("/portal")} className="mt-6 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700">Return to portal</button>
        </div>
      </div>
    );
  }

  if (!exam || questions.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Exam unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">There are no questions available for this exam.</p>
          <button type="button" onClick={() => navigate("/portal")} className="mt-5 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Return to portal</button>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const prompt = currentQuestion.text ?? currentQuestion.question ?? "";
  const options = currentQuestion.options ?? {};
  const optionOrder = session?.optionOrderByQuestion?.[currentQuestion.id] ?? DISPLAY_OPTION_LABELS;
  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  const progressPercent = Math.round((answeredCount / questions.length) * 100);

  function confirmAndSubmit() {
    setShowSubmitConfirm(true);
  }

  function moveToNextQuestion() {
    setCurrentQuestionIndex((current) => Math.min(current + 1, questions.length - 1));
  }

  function moveToPreviousQuestion() {
    setCurrentQuestionIndex((current) => Math.max(current - 1, 0));
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <div className="mx-auto max-w-[1500px] px-3 pb-6 pt-3 sm:px-6 sm:pt-5 lg:px-8">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-[0_2px_12px_rgba(15,23,42,0.025)] sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold tracking-tight text-white">CBT</div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-600">Examination in progress</p>
              <h1 className="mt-1 truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">{exam.title}</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            <div className="hidden items-center gap-2 text-xs font-medium text-slate-500 sm:flex">
              <span className={["h-2 w-2 rounded-full", saving ? "animate-pulse bg-amber-500" : "bg-emerald-500"].join(" ")} />
              {saving ? "Saving progress" : "Progress saved"}
            </div>
            <div className={["flex items-center gap-3 rounded-xl border px-4 py-2.5", (timeLeft ?? 0) <= 300 ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"].join(" ")}>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Time remaining</p>
                <p role="timer" aria-live="off" className={["mt-0.5 font-mono text-xl font-semibold tabular-nums", (timeLeft ?? 0) <= 300 ? "text-rose-700" : "text-slate-900"].join(" ")}>{formatTime(timeLeft ?? exam.duration * 60)}</p>
              </div>
              <div className={["flex h-9 w-9 items-center justify-center rounded-lg", (timeLeft ?? 0) <= 300 ? "bg-rose-100 text-rose-700" : "bg-white text-slate-600"].join(" ")} aria-hidden="true">◷</div>
            </div>
            <button type="button" onClick={confirmAndSubmit} disabled={submitting} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">
              {submitting ? "Submitting…" : "Finish exam"}
            </button>
          </div>
        </header>

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-slate-500">Questions answered</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">{answeredCount}<span className="font-medium text-slate-400"> / {questions.length}</span></p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600 transition-[width] duration-300" style={{ width: progressPercent + "%" }} /></div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5">
            <p className="text-xs font-medium text-slate-500">Current question</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{currentQuestionIndex + 1} <span className="font-medium text-slate-400">of {questions.length}</span></p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5">
            <p className="text-xs font-medium text-slate-500">Question value</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{currentQuestion.marks ?? 1} <span className="font-medium text-slate-400">{Number(currentQuestion.marks ?? 1) === 1 ? "mark" : "marks"}</span></p>
          </div>
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="min-w-0">
            <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.035)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-8">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-sm font-bold text-indigo-700">{String(currentQuestionIndex + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Question {currentQuestionIndex + 1}</p>
                    <p className="mt-0.5 text-xs text-slate-500">Choose one answer</p>
                  </div>
                </div>
                <span className={["rounded-full px-3 py-1.5 text-xs font-semibold", answers[currentQuestion.id] ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"].join(" ")}>{answers[currentQuestion.id] ? "Answer selected" : "Not answered"}</span>
              </div>

              <div className="px-5 py-7 sm:px-8 sm:py-9">
                <h2 className="max-w-4xl whitespace-pre-wrap text-lg font-medium leading-8 tracking-[-0.015em] text-slate-900 sm:text-[22px] sm:leading-9">{prompt}</h2>

                <fieldset className="mt-7 space-y-3">
                  <legend className="sr-only">Answer options</legend>
                  {optionOrder.map((originalOptionKey, optionIndex) => {
                    const selected = answers[currentQuestion.id] === originalOptionKey;
                    return (
                      <label key={`${currentQuestion.id}-${originalOptionKey}`} className={["group flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition-colors duration-150 sm:p-5", selected ? "border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500/20" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"].join(" ")}>
                        <input type="radio" name={currentQuestion.id} value={originalOptionKey} checked={selected} onChange={(event) => setAnswers((current) => ({ ...current, [currentQuestion.id]: event.target.value }))} className="sr-only" />
                        <span className={["flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-bold transition-colors", selected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 group-hover:border-slate-300"].join(" ")}>{DISPLAY_OPTION_LABELS[optionIndex]}<span className="sr-only"> option</span></span>
                        <span className={["min-w-0 flex-1 pt-1 text-sm leading-6 sm:text-base sm:leading-7", selected ? "font-medium text-indigo-950" : "text-slate-700"].join(" ")}>{options[originalOptionKey] ?? ""}</span>
                        <span className={["mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"].join(" ")} aria-hidden="true">{selected ? <span className="text-xs">✓</span> : null}</span>
                      </label>
                    );
                  })}
                </fieldset>

                <div className="mt-8 flex flex-col gap-4 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-500">Your selection is saved automatically.</p>
                  <div className="flex gap-3">
                    <button type="button" onClick={moveToPreviousQuestion} disabled={currentQuestionIndex === 0} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"><span aria-hidden="true">←</span> Previous</button>
                    <button type="button" onClick={moveToNextQuestion} disabled={isLastQuestion} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 sm:flex-none">Next <span aria-hidden="true">→</span></button>
                  </div>
                </div>
              </div>
            </section>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400">
              <span>Tab warnings: {warningCount}/{MAX_TAB_SWITCH_WARNINGS}</span>
              <span>{totalMarks} total marks · {questions.length} questions</span>
            </div>
          </main>

          <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
            <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.025)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Question navigator</h2>
                  <p className="mt-1 text-xs text-slate-500">Jump to any question</p>
                </div>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">{answeredCount}/{questions.length}</span>
              </div>
              <div className="mt-4 grid grid-cols-6 gap-2 sm:grid-cols-8 xl:grid-cols-6">
                {questions.map((question, index) => {
                  const active = index === currentQuestionIndex;
                  const answered = Boolean(answers[question.id]);
                  return (
                    <button key={question.id} type="button" onClick={() => setCurrentQuestionIndex(index)} aria-label={`Go to question ${index + 1}`} aria-current={active ? "step" : undefined} className={["flex aspect-square min-h-9 items-center justify-center rounded-lg border text-xs font-semibold transition", active ? "border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-600/20" : answered ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"].join(" ")}>{index + 1}</button>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-indigo-600" />Current</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-400" />Answered</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm border border-slate-300 bg-white" />Unanswered</span>
              </div>
            </section>

            <ExamCalculator />
          </aside>
        </div>
      </div>

      <ConfirmDialog
        open={showSubmitConfirm}
        title="Finish and submit exam?"
        message={`You have answered ${answeredCount} of ${questions.length} questions. Once submitted, you cannot return to this exam.`}
        confirmLabel="Submit exam"
        cancelLabel="Continue exam"
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
