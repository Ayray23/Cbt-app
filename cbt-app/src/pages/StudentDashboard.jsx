import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "/firebase";
import StatusBanner from "../components/StatusBanner";
import { useAuth } from "../contexts/AuthContext";
import { flushPendingSubmissions, getDeviceExamMap, startExamSession } from "../services/sessionService";

export default function StudentDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [exams, setExams] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [pin, setPin] = useState("");
  const [starting, setStarting] = useState(false);
  const [initialStorage] = useState(() => {
    try { return { exams: getDeviceExamMap(user.uid), error: null }; }
    catch { return { exams: {}, error: { tone: "error", message: "Saved exam data could not be read. Contact your supervisor before clearing any browser data." } }; }
  });
  const [deviceExams, setDeviceExams] = useState(initialStorage.exams);
  const [banner, setBanner] = useState(initialStorage.error);

  useEffect(() => {
    const fail = () => setBanner({ tone: "error", message: "Could not load your exam assignments. Check your connection or contact your supervisor." });
    const stops = [
      onSnapshot(query(collection(db, "exams"), where("status", "==", "published")),
        (snapshot) => setExams(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), fail),
      onSnapshot(query(collection(db, "examAssignments"), where("studentUid", "==", user.uid)),
        (snapshot) => setAssignments(snapshot.docs.map((item) => item.data())), fail),
      onSnapshot(query(collection(db, "examSessions"), where("studentUid", "==", user.uid), where("schemaVersion", "==", 2)),
        (snapshot) => setSessions(snapshot.docs.map((item) => item.data())), fail),
    ];
    const refresh = () => {
      try { setDeviceExams(getDeviceExamMap(user.uid)); }
      catch { setBanner({ tone: "error", message: "Saved exam data could not be read. Contact your supervisor before clearing any browser data." }); }
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("cbt:exam-storage", refresh);
    return () => { stops.forEach((stop) => stop()); window.removeEventListener("storage", refresh); window.removeEventListener("cbt:exam-storage", refresh); };
  }, [user.uid]);

  const assignedIds = new Set(assignments.map((item) => item.examId));
  const available = exams.filter((exam) => assignedIds.has(exam.id));
  // Keep locally saved active papers accessible if the device disconnects or the list has not loaded.
  for (const packet of Object.values(deviceExams)) {
    if (!packet.closed && packet.questions?.length && !available.some((exam) => exam.id === packet.session.examId)) {
      available.push({ id: packet.session.examId, title: packet.session.examTitle,
        duration: (packet.session.expiresAtMs - packet.session.startedAtMs) / 60000, questionCount: packet.questions.length });
    }
  }
  const selected = available.find((exam) => exam.id === selectedId) || available[0];
  const saved = selected ? deviceExams[selected.id] : null;
  const session = selected ? sessions.find((item) => item.examId === selected.id) : null;
  const closed = Boolean(saved?.closed || session?.status === "submitted");
  const started = Boolean(!closed && (saved?.questions?.length || session?.status === "started"));
  const pending = Object.values(deviceExams).filter((packet) => packet.pending);

  function selectExam(id) { setSelectedId(id); setPin(""); setBanner(null); }

  async function begin() {
    if (!selected || starting || closed || initialStorage.error) return;
    setStarting(true);
    setBanner(null);
    try {
      // Fullscreen must be requested inside this click, before any network await.
      if (document.fullscreenEnabled && !document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => {});
      await startExamSession(selected.id, pin);
      navigate(`/exam/${selected.id}`);
    } catch (error) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      setBanner({ tone: "error", message: error.message || "Could not start the exam." });
    } finally { setStarting(false); }
  }

  return <div className="space-y-6">
    <StatusBanner {...banner} onClose={() => setBanner(null)} />
    <StatusBanner tone="success" message={location.state?.message} />
    {pending.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <h3 className="font-semibold text-slate-900">Saved submissions waiting to upload: {pending.length}</h3>
      <p className="mt-2 text-sm text-slate-600">These exams are closed. Keep this device's app data until your supervisor confirms the upload.</p>
      {pending.map((packet) => <p key={packet.session.examId} className="mt-2 text-sm text-slate-600">
        {packet.session.examTitle || packet.session.examId}{packet.syncError ? `: ${packet.syncError}` : ""}
      </p>)}
      <button onClick={() => void flushPendingSubmissions().catch((error) => setBanner({ tone: "error", message: error.message }))}
        className="mt-3 rounded-xl border border-amber-300 px-4 py-2 text-sm">Retry upload</button>
    </section>}
    <section className="rounded-3xl bg-white p-6 shadow-sm">
      <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Student portal</p>
      <h2 className="mt-2 text-3xl font-semibold text-slate-900">Your assigned exams</h2>
      <p className="mt-3 text-sm text-slate-500">Use the exam PIN issued specifically to you by your supervisor.</p>
    </section>
    <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
        {available.map((exam) => <button key={exam.id} disabled={starting} onClick={() => selectExam(exam.id)}
          className={`w-full rounded-2xl border p-4 text-left ${selected?.id === exam.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700"}`}>
          <p className="font-medium">{exam.title}</p><p className="mt-1 text-sm">{exam.duration} minutes</p>
        </button>)}
        {!available.length && <p className="text-sm text-slate-500">Your administrator has not assigned a published exam yet.</p>}
      </div>
      {selected && <div className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
        <h3 className="text-2xl font-semibold text-slate-900">{selected.title}</h3>
        <p className="mt-2 text-sm text-slate-500">{selected.duration} minutes | {selected.questionCount || 0} questions</p>
        <div className="mt-6 space-y-3 text-sm text-slate-600">
          <p>One attempt per student. The timer continues if the device disconnects or the app closes.</p>
          <p>Questions and options are shuffled. Your answers save on this device as you work.</p>
          <p>Fullscreen exits and tab changes are recorded for your invigilator. Report interruptions; the timer keeps running.</p>
          <p>Submitting closes the paper immediately. Results become available after your examination officer releases them.</p>
        </div>
        {!closed && !started && <label className="mt-6 block text-sm font-medium text-slate-700">Your exam PIN
          <input type="password" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)}
            disabled={starting} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" placeholder="Enter your personal PIN" />
        </label>}
        {started && <p className="mt-5 text-sm text-slate-600">Your existing attempt will continue with its original deadline.</p>}
        <button onClick={begin} disabled={Boolean(initialStorage.error) || closed || starting || (!started && !pin.trim())}
          className="mt-6 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
          {closed ? "Attempted" : starting ? "Verifying..." : started ? "Continue exam" : "Start exam"}
        </button>
      </div>}
    </section>
  </div>;
}
