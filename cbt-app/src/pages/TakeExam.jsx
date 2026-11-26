import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  getDeviceExamMap,
  saveExamProgress,
  saveLocalExamDraft,
  startExamSession,
  submitExamSession,
} from "../services/sessionService";
import StatusBanner from "../components/StatusBanner";

import ExamCalculator from "../components/ExamCalculator";
import {
  VIOLATION_LABELS,
  VIOLATION_LIMIT,
  appendViolation,
  integrityMeta,
  isBlockedKey,
  longerLog,
} from "../utils/lockdown";

const LABELS = ["A", "B", "C", "D"];

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function TakeExam() {
  const { examId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ownsTab, setOwnsTab] = useState(false);
  const [packet, setPacket] = useState(null);
  const [answers, setAnswers] = useState({});
  const [index, setIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("Answers save on this device.");
  const [needsFullscreen, setNeedsFullscreen] = useState(false);
  const [warning, setWarning] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const answersRef = useRef({});
  const answerSaveTimerRef = useRef(null);
  const packetRef = useRef(null);
  const closedRef = useRef(false);
  const warningsRef = useRef(0);
  const logRef = useRef([]);
  const enteredFullscreenRef = useRef(Boolean(document.fullscreenElement));
  const examLoaded = Boolean(packet);

  useEffect(() => {
    let cancelled = false;
    let release;
    if (!navigator.locks) {
      setError(
        "This browser cannot safely reserve an exam tab. Use a current Chrome, Edge or Firefox browser over HTTPS.",
      );
      return undefined;
    }
    // React StrictMode replays effects; cancelled mounts must never compete for this lock.
    queueMicrotask(() => {
      if (cancelled) return;
      void navigator.locks
        .request(
          `cbt-attempt-${user.uid}-${examId}`,
          { ifAvailable: true },
          async (lock) => {
            if (cancelled) return;
            if (!lock) {
              setError(
                "This exam is already open in another tab. Close that tab, then reload this page.",
              );
              return;
            }
            setOwnsTab(true);
            await new Promise((resolve) => {
              release = resolve;
            });
          },
        )
        .catch(() => {
          if (!cancelled)
            setError(
              "Could not reserve this exam tab. Reload or contact your supervisor.",
            );
        });
    });
    return () => {
      cancelled = true;
      release?.();
    };
  }, [examId, user.uid]);

  const finish = useCallback(
    async (reason = "manual") => {
      if (closedRef.current || !packetRef.current) return;
      closedRef.current = true;
      window.clearTimeout(answerSaveTimerRef.current);
      setConfirmation(null);
      setSubmitting(true);
      try {
        const receipt = await submitExamSession(examId, answersRef.current, {
          submissionReason: reason,
          ...integrityMeta(warningsRef, logRef),
        });
        navigate("/portal", {
          replace: true,
          state: {
            message: receipt.pendingSync
              ? "Exam closed at the deadline. Answers are saved on this device and will upload when connected."
              : "Exam submitted successfully. Your answers have reached the server.",
          },
        });
        if (document.fullscreenElement)
          void document.exitFullscreen().catch(() => {});
      } catch (saveError) {
        closedRef.current = false;
        setSubmitting(false);
        setError(
          `Could not save your submission on this device. Keep this page open and contact your supervisor. ${saveError.message}`,
        );
      }
    },
    [examId, navigate],
  );

  useEffect(() => {
    if (!ownsTab) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const loaded = await startExamSession(examId);
        if (cancelled) return;
        packetRef.current = loaded;
        answersRef.current = loaded.session.answers || {};
        warningsRef.current = Math.max(
          loaded.session.tabSwitchCount || 0,
          loaded.metadata?.tabSwitchCount || 0,
        );
        logRef.current = longerLog(
          loaded.session.integrityLog,
          loaded.metadata?.integrityLog,
        );
        setPacket(loaded);
        setAnswers(answersRef.current);
        setNeedsFullscreen(
          Boolean(document.fullscreenEnabled && !document.fullscreenElement),
        );
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [examId, finish, ownsTab]);

  useEffect(() => {
    if (!packet) return undefined;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil(
          (packet.session.expiresAtMs - (Date.now() + (packet.offsetMs || 0))) /
            1000,
        ),
      );
      setTimeLeft(remaining);
      if (remaining === 0) finish("timeout");
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [packet, finish]);

  const persistProgress = useCallback(async () => {
    if (!packetRef.current || closedRef.current) return;
    try {
      const result = await saveExamProgress(examId, answersRef.current, {
        ...integrityMeta(warningsRef, logRef),
      });
      if (closedRef.current) return;
      if (result.closed) {
        finish("manual");
        return;
      }
      if (result.expired) {
        finish("timeout");
        return;
      }
      if (
        result.expiresAtMs &&
        packetRef.current.session.expiresAtMs !== result.expiresAtMs
      ) {
        const updated = {
          ...packetRef.current,
          session: {
            ...packetRef.current.session,
            expiresAtMs: result.expiresAtMs,
          },
        };
        packetRef.current = updated;
        setPacket(updated);
      }
      setSaveStatus(
        result.localOnly
          ? "Saved on this device. Upload waits for a connection."
          : "Saved to server.",
      );
    } catch {
      if (!closedRef.current)
        setSaveStatus("Saved on this device. Waiting to upload.");
    }
  }, [examId, finish]);

  useEffect(() => {
    if (!packet) return undefined;
    // Exam-day load-shedding: local answers still save immediately, but the
    // server gets fewer background progress requests. Final submission is not throttled.
    const heartbeat = window.setInterval(() => void persistProgress(), 30000);
    const reconnect = () => void persistProgress();
    window.addEventListener("online", reconnect);
    return () => {
      window.clearInterval(heartbeat);
      window.clearTimeout(answerSaveTimerRef.current);
      window.removeEventListener("online", reconnect);
    };
  }, [packet, persistProgress]);

  useEffect(() => {
    let blurTimer;
    // Every rule break is counted, logged with its type and time, saved on the
    // device and sent to the server so invigilators can see what happened.
    function recordViolation(type) {
      if (closedRef.current || !packetRef.current) return;
      warningsRef.current++;
      logRef.current = appendViolation(logRef.current, type, Date.now());
      setWarning({ type, count: warningsRef.current });
      saveLocalExamDraft(
        examId,
        answersRef.current,
        integrityMeta(warningsRef, logRef),
      );
      void persistProgress();
    }
    function fullscreenChanged() {
      if (document.fullscreenElement) {
        enteredFullscreenRef.current = true;
        setNeedsFullscreen(false);
      } else if (enteredFullscreenRef.current && !closedRef.current) {
        setNeedsFullscreen(true);
        recordViolation("fullscreen-exit");
      }
    }
    function visibilityChanged() {
      if (!document.hidden || closedRef.current || !packetRef.current) return;
      recordViolation("tab-hidden");
    }
    // Catches switching to another window or app while the tab stays visible
    // (split screen, a second window on top). A short delay lets a normal tab
    // switch be counted once, as "tab-hidden", instead of twice.
    function windowBlurred() {
      if (closedRef.current || !packetRef.current) return;
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        if (!document.hidden && !document.hasFocus())
          recordViolation("window-blur");
      }, 400);
    }
    function windowFocused() {
      window.clearTimeout(blurTimer);
    }
    function pageHidden() {
      if (packetRef.current && !closedRef.current) {
        try {
          saveLocalExamDraft(examId, answersRef.current, {
            ...integrityMeta(warningsRef, logRef),
          });
        } catch {
          /* Already saved on each answer input. */
        }
      }
    }
    function routeChanged() {
      if (window.location.pathname !== `/exam/${examId}`) pageHidden();
    }
    function storageChanged() {
      if (getDeviceExamMap(user.uid)[examId]?.closed && !closedRef.current) {
        closedRef.current = true;
        navigate("/portal", { replace: true });
      }
    }
    function preventClipboard(event) {
      event.preventDefault();
    }
    function preventShortcut(event) {
      if (isBlockedKey(event)) event.preventDefault();
    }
    document.addEventListener("fullscreenchange", fullscreenChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("popstate", routeChanged);
    window.addEventListener("storage", storageChanged);
    for (const event of ["copy", "paste", "cut", "contextmenu", "dragstart"])
      window.addEventListener(event, preventClipboard);
    window.addEventListener("keydown", preventShortcut);
    window.addEventListener("blur", windowBlurred);
    window.addEventListener("focus", windowFocused);
    return () => {
      window.clearTimeout(blurTimer);
      window.removeEventListener("blur", windowBlurred);
      window.removeEventListener("focus", windowFocused);
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageHidden);
      window.removeEventListener("popstate", routeChanged);
      window.removeEventListener("storage", storageChanged);
      for (const event of ["copy", "paste", "cut", "contextmenu", "dragstart"])
        window.removeEventListener(event, preventClipboard);
      window.removeEventListener("keydown", preventShortcut);
    };
  }, [examId, user.uid, navigate, finish, persistProgress]);

  // Browser reloads/closing the tab must use the browser's native warning.
  // Browsers do not allow customized beforeunload text.
  useEffect(() => {
    if (!examLoaded) return undefined;
    function beforeUnload(event) {
      if (closedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [examLoaded]);

  // Back navigation inside the SPA does not trigger beforeunload. Add a same-URL
  // history checkpoint, then show the exam-specific warning when Back is pressed.
  useEffect(() => {
    if (!examLoaded) return undefined;
    const currentUrl = window.location.href;
    const attemptKey = `cbt:${user.uid}:${examId}`;
    window.history.pushState({ cbtExamGuard: attemptKey }, "", currentUrl);
    function backPressed() {
      if (closedRef.current) return;
      window.history.pushState({ cbtExamGuard: attemptKey }, "", currentUrl);
      setAcknowledged(false);
      setConfirmation("exit");
    }
    window.addEventListener("popstate", backPressed);
    return () => window.removeEventListener("popstate", backPressed);
  }, [examLoaded, examId, user.uid]);

  function askConfirmation(action) {
    if (closedRef.current || submitting) return;
    setAcknowledged(false);
    setConfirmation(action);
  }

  function keepWriting() {
    setConfirmation(null);
    setAcknowledged(false);
  }

  function leaveExam() {
    if (!acknowledged || closedRef.current) return;
    try {
      saveLocalExamDraft(examId, answersRef.current, {
        ...integrityMeta(warningsRef, logRef),
      });
      setConfirmation(null);
      navigate("/portal", { replace: true });
    } catch (saveError) {
      setConfirmation(null);
      setError(
        `Could not safely save answers before leaving. Stay on the exam and contact your supervisor. ${saveError.message}`,
      );
    }
  }

  function choose(questionId, value) {
    if (closedRef.current) return;
    const next = { ...answersRef.current, [questionId]: value };
    try {
      // Save on the input event itself, before the network debounce or next render.
      saveLocalExamDraft(examId, next, { ...integrityMeta(warningsRef, logRef) });
      answersRef.current = next;
      setAnswers(next);
      setError("");
      // The local save happens synchronously above. Send the latest full
      // answer snapshot soon after each click, so the server has a near-final
      // copy even if the browser closes at the deadline.
      window.clearTimeout(answerSaveTimerRef.current);
      answerSaveTimerRef.current = window.setTimeout(() => {
        if (!closedRef.current) void persistProgress();
      }, 5000);
    } catch {
      setError(
        "Your device could not save this answer. Contact your supervisor before continuing.",
      );
    }
  }

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setError(
        "Fullscreen could not start. Ask your supervisor to check this browser.",
      );
    }
  }

  if (!packet)
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        {error ? (
          <>
            <StatusBanner tone="error" message={error} />
            <button
              onClick={() => navigate("/portal", { replace: true })}
              className="mt-4 underline"
            >
              Back to exams
            </button>
          </>
        ) : (
          "Opening your saved exam..."
        )}
      </div>
    );

  const byId = Object.fromEntries(
    packet.questions.map((question) => [question.id, question]),
  );
  const questions = packet.session.questionOrder
    .map((id) => byId[id])
    .filter(Boolean);
  const current = questions[index];
  if (!current)
    return (
      <StatusBanner
        tone="error"
        message="The saved paper is incomplete. Contact your supervisor."
      />
    );
  const order = packet.session.optionOrderByQuestion?.[current.id] || LABELS;
  const answeredCount = questions.filter(
    (question) => answers[question.id],
  ).length;

  return (
    <div className="exam-locked space-y-6">
      <StatusBanner tone="error" message={error} />
      {warning && !needsFullscreen && (
        <div
          role="alertdialog"
          aria-labelledby="exam-warning-title"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4"
        >
          <section className="max-w-md rounded-3xl bg-white p-8">
            <h2 id="exam-warning-title" className="text-2xl font-semibold">
              Exam rule warning {warning.count}
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              You {VIOLATION_LABELS[warning.type] || "broke an exam rule"}. Stay
              in full screen on this tab until you submit. Your timer is still
              running.
            </p>
            {warning.count >= VIOLATION_LIMIT && (
              <p className="mt-3 text-sm font-medium text-red-700">
                This is warning {warning.count}. Your invigilator can see it and
                will review your attempt.
              </p>
            )}
            <button
              onClick={() => setWarning(null)}
              className="mt-5 rounded-xl bg-slate-900 px-5 py-3 text-white"
            >
              I understand
            </button>
          </section>
        </div>
      )}
      {needsFullscreen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4">
          <section className="max-w-md rounded-3xl bg-white p-8">
            <h2 className="text-2xl font-semibold">Enter exam mode</h2>
            <p className="mt-3 text-sm text-slate-600">
              Your original timer is running. Open your paper to continue.
            </p>
            <button
              onClick={enterFullscreen}
              className="mt-5 rounded-xl bg-slate-900 px-5 py-3 text-white"
            >
              Open exam
            </button>
          </section>
        </div>
      )}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
            Live exam
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-900">
            {packet.session.examTitle}
          </h2>
          <p className="whitespace-pre-wrap mt-2">
            {packet.session.instructions}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {answeredCount} of {questions.length} answered
          </p>
          <p className="mt-1 text-xs text-slate-500" role="status">
            {saveStatus}
          </p>
          <button
            type="button"
            onClick={() => askConfirmation("exit")}
            disabled={submitting}
            className="mt-4 rounded-xl border-2 border-rose-500 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50"
          >
            Leave exam / Back to exams
          </button>
        </div>
        <div className="rounded-2xl bg-slate-100 p-4">
          <p className="text-sm">Time left</p>
          <p className="mt-1 text-3xl tabular-nums">{formatTime(timeLeft)}</p>
        </div>
      </section>
      <section className="grid gap-6 xl:grid-cols-[260px_1fr]">
        <aside className="rounded-3xl bg-white p-6 shadow-sm">
          <h3 className="font-semibold">Question palette</h3>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {questions.map((question, position) => (
              <button
                key={question.id}
                onClick={() => setIndex(position)}
                aria-label={`Question ${position + 1}`}
                aria-current={position === index ? "step" : undefined}
                className={`rounded-xl border py-3 text-sm ${index === position ? "border-slate-900 bg-slate-900 text-white" : answers[question.id] ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200"}`}
              >
                {position + 1}
              </button>
            ))}
          </div>
          {packet.session.allowCalculator && (
            <div className="mt-6">
              <ExamCalculator />
            </div>
          )}
        </aside>
        <section className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
          <p className="text-sm text-slate-500">
            Question {index + 1} | {current.marks} mark(s)
          </p>
          <h3 className="whitespace-pre-wrap mt-4 text-2xl font-medium text-slate-900">
            {current.text}
          </h3>
          {current.image && (
            <img
              src={current.image}
              alt={current.imageAlt || "Question diagram"}
              className="mt-4 max-h-80 max-w-full object-contain"
            />
          )}
          <div className="mt-6 space-y-4">
            {order.map((key, position) => (
              <label
                key={key}
                className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 ${answers[current.id] === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50"}`}
              >
                <input
                  type="radio"
                  className="mt-1"
                  name={current.id}
                  checked={answers[current.id] === key}
                  onChange={() => choose(current.id, key)}
                  value={key}
                />
                <span>
                  <strong>{LABELS[position]}.</strong> {current.options[key]}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-between gap-3">
            <div className="flex gap-3">
              <button
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
                className="rounded-xl border border-slate-300 px-5 py-3 text-sm disabled:opacity-40"
              >
                Previous
              </button>
              {index < questions.length - 1 && (
                <button
                  onClick={() => setIndex(index + 1)}
                  className="rounded-xl bg-slate-900 px-5 py-3 text-sm text-white"
                >
                  Next
                </button>
              )}
            </div>
            <button
              type="button"
              disabled={submitting}
              onClick={() => askConfirmation("submit")}
              className="rounded-xl bg-rose-700 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
            >
              {submitting ? "Saving submission..." : "Submit exam"}
            </button>
          </div>
        </section>
      </section>

      {confirmation && !submitting && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/85 p-4"
          role="presentation"
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="exam-warning-title"
            aria-describedby="exam-warning-description"
            className="w-full max-w-lg rounded-3xl border-4 border-red-600 bg-white p-6 shadow-2xl sm:p-8"
          >
            <p className="text-sm font-black uppercase tracking-widest text-red-700">
              Important examination warning
            </p>
            <h2 id="exam-warning-title" className="mt-2 text-2xl font-extrabold text-slate-950">
              {confirmation === "submit"
                ? answeredCount < questions.length
                  ? "You have not finished your examination!"
                  : "Final submission — cannot be undone"
                : "Leaving will NOT stop your exam timer!"}
            </h2>
            <p id="exam-warning-description" className="mt-4 text-base leading-7 text-slate-800">
              {confirmation === "submit"
                ? answeredCount < questions.length
                  ? `You answered only ${answeredCount} of ${questions.length} questions. ${questions.length - answeredCount} question(s) will be submitted unanswered and receive no marks. Once you confirm, the examination closes permanently. You cannot return to answer them.`
                  : `You answered all ${questions.length} questions. Submitting permanently closes this examination. You cannot change any answer afterward.`
                : `You answered ${answeredCount} of ${questions.length} questions. Your saved answers stay on this device, but your exam continues counting down even after you leave. If time expires, you may lose the chance to finish. Return before the deadline or ask an invigilator for help.`}
            </p>
            {confirmation === "submit" && answeredCount < questions.length && (
              <p className="mt-3 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-900">
                Unanswered questions: {questions.map((question, position) =>
                  !answers[question.id] ? position + 1 : null).filter(Boolean).join(", ")}
              </p>
            )}
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-slate-950">
              <input
                autoFocus
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1 h-5 w-5 accent-red-700"
              />
              <span>
                I understand {confirmation === "submit"
                  ? "this submission is final and unanswered questions will receive no marks."
                  : "the timer will continue and leaving does not submit my examination."}
              </span>
            </label>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={keepWriting}
                className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
              >
                Stay and continue exam
              </button>
              {confirmation === "submit" && answeredCount < questions.length && (
                <button
                  type="button"
                  onClick={() => {
                    const firstUnanswered = questions.findIndex((question) => !answers[question.id]);
                    if (firstUnanswered >= 0) setIndex(firstUnanswered);
                    keepWriting();
                  }}
                  className="rounded-xl border-2 border-emerald-700 px-5 py-3 text-sm font-bold text-emerald-800"
                >
                  Review unanswered
                </button>
              )}
              <button
                type="button"
                disabled={!acknowledged}
                onClick={() => confirmation === "submit" ? void finish("manual") : leaveExam()}
                className="rounded-xl border border-red-700 bg-red-700 px-5 py-3 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {confirmation === "submit" ? "Submit exam permanently" : "Leave exam anyway"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
