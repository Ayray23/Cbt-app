import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getDeviceExamMap, saveExamProgress, saveLocalExamDraft, startExamSession, submitExamSession } from "../services/sessionService";
import StatusBanner from "../components/StatusBanner";

import ExamCalculator from "../components/ExamCalculator";

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
  const answersRef = useRef({});
  const packetRef = useRef(null);
  const closedRef = useRef(false);
  const warningsRef = useRef(0);
  const enteredFullscreenRef = useRef(Boolean(document.fullscreenElement));


  useEffect(() => {
    let cancelled = false;
    let release;
    if (!navigator.locks) {
      setError("This browser cannot safely reserve an exam tab. Use a current Chrome, Edge or Firefox browser over HTTPS.");
      return undefined;
    }
    void navigator.locks.request(`cbt-attempt-${user.uid}-${examId}`, { ifAvailable: true }, async lock => {
      if (cancelled) return;
      if (!lock) { setError("This exam is already open in another tab. Close that tab, then reload this page."); return; }
      setOwnsTab(true);
      await new Promise(resolve => { release = resolve; });
    }).catch(() => { if (!cancelled) setError("Could not reserve this exam tab. Reload or contact your supervisor."); });
    return () => { cancelled = true; release?.(); };
  }, [examId, user.uid]);

  const finish = useCallback((reason = "manual") => {
    if (closedRef.current || !packetRef.current) return;
    closedRef.current = true;
    try {
      submitExamSession(examId, answersRef.current, { submissionReason: reason, tabSwitchCount: warningsRef.current });
      navigate("/portal", { replace: true, state: { message: "Exam closed. Your answers are saved and will upload when connected." } });
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    } catch (saveError) {
      closedRef.current = false;
      setError(`Could not save your submission on this device. Keep this page open and contact your supervisor. ${saveError.message}`);
    }
  }, [examId, navigate]);

  useEffect(() => {
    if (!ownsTab) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const loaded = await startExamSession(examId);
        if (cancelled) return;
        packetRef.current = loaded;
        answersRef.current = loaded.session.answers || {};
        warningsRef.current = Math.max(loaded.session.tabSwitchCount || 0, loaded.metadata?.tabSwitchCount || 0);
        setPacket(loaded);
        setAnswers(answersRef.current);
        setNeedsFullscreen(Boolean(document.fullscreenEnabled && !document.fullscreenElement));

      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [examId, finish, ownsTab]);

  useEffect(() => {
    if (!packet) return undefined;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((packet.session.expiresAtMs - (Date.now() + (packet.offsetMs || 0))) / 1000));
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
      const result = await saveExamProgress(examId, answersRef.current, { tabSwitchCount: warningsRef.current });
      if (closedRef.current) return;
      if (result.closed) { finish("manual"); return; }
      if (result.expired) { finish("timeout"); return; }
      if (result.expiresAtMs && packetRef.current.session.expiresAtMs !== result.expiresAtMs) {
        const updated = { ...packetRef.current, session: { ...packetRef.current.session, expiresAtMs: result.expiresAtMs } };
        packetRef.current = updated; setPacket(updated);
      }
      setSaveStatus(result.localOnly ? "Saved on this device. Upload waits for a connection." : "Saved to server.");
    } catch {
      if (!closedRef.current) setSaveStatus("Saved on this device. Waiting to upload.");
    }
  }, [examId, finish]);

  useEffect(() => {
    if (!packet) return undefined;
    const timeout = window.setTimeout(() => void persistProgress(), 800);
    return () => window.clearTimeout(timeout);
  }, [answers, packet, persistProgress]);

  useEffect(() => {
    if (!packet) return undefined;
    const heartbeat = window.setInterval(() => void persistProgress(), 30000);
    const reconnect = () => void persistProgress();
    window.addEventListener("online", reconnect);
    return () => { window.clearInterval(heartbeat); window.removeEventListener("online", reconnect); };
  }, [packet, persistProgress]);

  useEffect(() => {
    function fullscreenChanged() {
      if (document.fullscreenElement) {
        enteredFullscreenRef.current = true;
        setNeedsFullscreen(false);
      } else if (enteredFullscreenRef.current && !closedRef.current) {
        warningsRef.current++;
        setNeedsFullscreen(true);
        void persistProgress();
      }
    }
    function visibilityChanged() {
      if (!document.hidden || closedRef.current || !packetRef.current) return;
      warningsRef.current++;
      saveLocalExamDraft(examId, answersRef.current, { tabSwitchCount: warningsRef.current });
      void persistProgress();
    }
    function pageHidden() { if (packetRef.current && !closedRef.current) { try { saveLocalExamDraft(examId, answersRef.current, { tabSwitchCount: warningsRef.current }); } catch { /* Already saved on each answer input. */ } } }
    function routeChanged() {
      if (window.location.pathname !== `/exam/${examId}`) pageHidden();
    }
    function storageChanged() {
      if (getDeviceExamMap(user.uid)[examId]?.closed && !closedRef.current) {
        closedRef.current = true;
        navigate("/portal", { replace: true });
      }
    }
    function preventClipboard(event) { event.preventDefault(); }
    function preventShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && ["c", "v", "x", "a", "s", "p"].includes(event.key.toLowerCase())) event.preventDefault();
    }
    document.addEventListener("fullscreenchange", fullscreenChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("popstate", routeChanged);
    window.addEventListener("storage", storageChanged);
    for (const event of ["copy", "paste", "cut", "contextmenu"]) window.addEventListener(event, preventClipboard);
    window.addEventListener("keydown", preventShortcut);
    return () => {
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageHidden);
      window.removeEventListener("popstate", routeChanged);
      window.removeEventListener("storage", storageChanged);
      for (const event of ["copy", "paste", "cut", "contextmenu"]) window.removeEventListener(event, preventClipboard);
      window.removeEventListener("keydown", preventShortcut);
    };
  }, [examId, user.uid, navigate, finish, persistProgress]);

  function choose(questionId, value) {
    if (closedRef.current) return;
    const next = { ...answersRef.current, [questionId]: value };
    try {
      // Save on the input event itself, before the network debounce or next render.
      saveLocalExamDraft(examId, next, { tabSwitchCount: warningsRef.current });
      answersRef.current = next;
      setAnswers(next);
      setError("");
    } catch { setError("Your device could not save this answer. Contact your supervisor before continuing."); }
  }

  async function enterFullscreen() {
    try { await document.documentElement.requestFullscreen(); }
    catch { setError("Fullscreen could not start. Ask your supervisor to check this browser."); }
  }

  if (!packet) return <div className="rounded-2xl bg-white p-6 shadow-sm">
    {error ? <><StatusBanner tone="error" message={error} /><button onClick={() => navigate("/portal", { replace: true })} className="mt-4 underline">Back to exams</button></> : "Opening your saved exam..."}
  </div>;

  const byId = Object.fromEntries(packet.questions.map((question) => [question.id, question]));
  const questions = packet.session.questionOrder.map((id) => byId[id]).filter(Boolean);
  const current = questions[index];
  if (!current) return <StatusBanner tone="error" message="The saved paper is incomplete. Contact your supervisor." />;
  const order = packet.session.optionOrderByQuestion?.[current.id] || LABELS;
  const answeredCount = questions.filter((question) => answers[question.id]).length;

  return <div className="space-y-6">
    <StatusBanner tone="error" message={error} />
    {needsFullscreen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4">
      <section className="max-w-md rounded-3xl bg-white p-8">
        <h2 className="text-2xl font-semibold">Enter exam mode</h2>
        <p className="mt-3 text-sm text-slate-600">Your original timer is running. Open your paper to continue.</p>
        <button onClick={enterFullscreen} className="mt-5 rounded-xl bg-slate-900 px-5 py-3 text-white">Open exam</button>
      </section>
    </div>}
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-white p-6 shadow-sm">
      <div><p className="text-sm uppercase tracking-[0.2em] text-slate-400">Live exam</p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-900">{packet.session.examTitle}</h2>
        <p className="whitespace-pre-wrap mt-2">{packet.session.instructions}</p>
        <p className="mt-2 text-sm text-slate-500">{answeredCount} of {questions.length} answered</p>
        <p className="mt-1 text-xs text-slate-500" role="status">{saveStatus}</p>
      </div>
      <div className="rounded-2xl bg-slate-100 p-4"><p className="text-sm">Time left</p><p className="mt-1 text-3xl tabular-nums">{formatTime(timeLeft)}</p></div>
    </section>
    <section className="grid gap-6 xl:grid-cols-[260px_1fr]">
      <aside className="rounded-3xl bg-white p-6 shadow-sm">
        <h3 className="font-semibold">Question palette</h3>
        <div className="mt-4 grid grid-cols-5 gap-2">{questions.map((question, position) =>
          <button key={question.id} onClick={() => setIndex(position)} aria-label={`Question ${position + 1}`}
            aria-current={position === index ? "step" : undefined}
            className={`rounded-xl border py-3 text-sm ${index === position ? "border-slate-900 bg-slate-900 text-white" : answers[question.id] ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200"}`}>{position + 1}</button>)}</div>
        {packet.session.allowCalculator && <div className="mt-6"><ExamCalculator /></div>}
      </aside>
      <section className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
        <p className="text-sm text-slate-500">Question {index + 1} | {current.marks} mark(s)</p>
        <h3 className="whitespace-pre-wrap mt-4 text-2xl font-medium text-slate-900">{current.text}</h3>
        {current.image && <img src={current.image} alt={current.imageAlt || "Question diagram"} className="mt-4 max-h-80 max-w-full object-contain" />}
        <div className="mt-6 space-y-4">{order.map((key, position) =>
          <label key={key} className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 ${answers[current.id] === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50"}`}>
            <input type="radio" className="mt-1" name={current.id} checked={answers[current.id] === key}
              onChange={() => choose(current.id, key)} value={key} />
            <span><strong>{LABELS[position]}.</strong> {current.options[key]}</span>
          </label>)}</div>
        <div className="mt-8 flex flex-wrap justify-between gap-3">
          <div className="flex gap-3">
            <button disabled={index === 0} onClick={() => setIndex(index - 1)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm disabled:opacity-40">Previous</button>
            {index < questions.length - 1 && <button onClick={() => setIndex(index + 1)} className="rounded-xl bg-slate-900 px-5 py-3 text-sm text-white">Next</button>}
          </div>
          {index === questions.length - 1 && <button onClick={() => { if (window.confirm(`Submit now? ${answeredCount} of ${questions.length} questions answered. This cannot be undone.`)) finish("manual"); }} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm text-white">Submit exam</button>}
        </div>
      </section>
    </section>
  </div>;
}
