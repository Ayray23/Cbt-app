import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import { auth, db } from "/firebase";
import { flushPendingSubmissions } from "../services/sessionService";

function scheduleMessage(exam) {
  const now = Date.now();
  if (exam.scheduleStartAtMs && now < exam.scheduleStartAtMs) {
    return `This examination opens on ${new Date(exam.scheduleStartAtMs).toLocaleString()}.`;
  }
  if (exam.scheduleEndAtMs && now >= exam.scheduleEndAtMs) {
    return `This examination closed on ${new Date(exam.scheduleEndAtMs).toLocaleString()}.`;
  }
  return "";
}

export default function ExamSessionGuard({ children }) {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, blocked: false, message: "", exam: null });

  useEffect(() => {
    let active = true;
    async function checkExam() {
      try {
        const [examSnapshot, sessionSnapshot] = await Promise.all([
          getDoc(doc(db, "exams", examId)),
          auth.currentUser ? getDoc(doc(db, "examSessions", `${examId}_${auth.currentUser.uid}`)) : Promise.resolve(null),
        ]);
        if (!active) return;
        if (!examSnapshot.exists()) throw new Error("Exam not found.");
        const exam = examSnapshot.data();
        const existingSession = sessionSnapshot?.exists() ? sessionSnapshot.data() : null;
        const hasActiveSession = existingSession?.status === "started";
        const message = hasActiveSession ? "" : scheduleMessage(exam);
        setState({ loading: false, blocked: Boolean(message), message, exam });
      } catch (error) {
        if (active) setState({ loading: false, blocked: true, message: error.message ?? "Could not verify the examination window.", exam: null });
      }
    }
    checkExam();
    return () => { active = false; };
  }, [examId]);

  useEffect(() => {
    if (state.blocked || state.loading || !auth.currentUser) return undefined;
    let cancelled = false;
    const uid = auth.currentUser.uid;
    const sessionRef = doc(db, "examSessions", `${examId}_${uid}`);
    const writeHeartbeat = async () => {
      if (cancelled) return;
      try {
        await setDoc(sessionRef, {
          lastHeartbeatAtMs: Date.now(),
          networkOnline: window.navigator.onLine,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (error) {
        console.error("Exam heartbeat failed", error);
      }
    };
    const handleOnline = () => { void flushPendingSubmissions(); void writeHeartbeat(); };
    const handleOffline = () => { void writeHeartbeat(); };
    void flushPendingSubmissions();
    void writeHeartbeat();
    const interval = window.setInterval(writeHeartbeat, 15000);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [examId, state.blocked, state.loading]);

  const title = useMemo(() => state.exam?.title || "Examination", [state.exam]);

  if (state.loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50"><div className="rounded-2xl bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">Checking examination access…</div></div>;
  }

  if (state.blocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-2xl text-amber-700">!</div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Exam access</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{state.message}</p>
          <button type="button" onClick={() => navigate("/portal", { replace: true })} className="mt-6 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Return to portal</button>
        </div>
      </div>
    );
  }

  return children;
}
