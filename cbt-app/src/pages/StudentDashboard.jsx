import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "/firebase";
import { useAuth } from "../contexts/AuthContext";
import { flushPendingSubmissions, getPendingSubmissionMap } from "../services/sessionService";
import { getMyExamCodeStatus, startSecureExamSession } from "../services/secureExamService";
import { useToast } from "../components/useToast.js";

const INSTRUCTIONS = [
  "Read each question carefully before you choose an answer.",
  "You only have one submission for each exam.",
  "Do not refresh or close the browser tab while the exam is running.",
  "Make sure your internet connection is stable before you start.",
];

function friendlyExamError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code.includes("functions/not-found") || message.toLowerCase().includes("not found") && message.toLowerCase().includes("function")) {
    return "The secure exam service is not deployed yet. Please ask the administrator to deploy the latest Firebase Functions before starting this exam.";
  }
  if (code.includes("functions/internal")) {
    return "The exam server could not verify this code. Please try again. If the problem continues, ask the administrator to check the Firebase Functions deployment.";
  }
  return message || "Could not start exam. Please check your exam code and try again.";
}

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, error: toastError } = useToast();
  const [exams, setExams] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [examCode, setExamCode] = useState("");
  const [hasAssignedCode, setHasAssignedCode] = useState(false);
  const [startingExam, setStartingExam] = useState(false);
  const [pendingSubmissionMap, setPendingSubmissionMap] = useState({});

  useEffect(() => {
    if (!profile?.className) { setExams([]); setSelectedExamId(""); return undefined; }
    const classExamsQuery = query(collection(db, "exams"), where("status", "==", "published"), where("className", "==", profile.className), where("assignmentMode", "==", "class"), orderBy("createdAt", "desc"));
    const individualExamsQuery = query(collection(db, "exams"), where("status", "==", "published"), where("className", "==", profile.className), where("assignmentMode", "==", "individual"), where("assignedStudentUids", "array-contains", user.uid), orderBy("createdAt", "desc"));
    let classExams = [];
    let individualExams = [];
    const publish = () => {
      const nextExams = [...classExams, ...individualExams].filter((exam, index, all) => all.findIndex((candidate) => candidate.id === exam.id) === index).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setExams(nextExams);
      setSelectedExamId((current) => nextExams.some((exam) => exam.id === current) ? current : nextExams[0]?.id || "");
    };
    const unsubscribeClassExams = onSnapshot(classExamsQuery, (snapshot) => { classExams = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); publish(); });
    const unsubscribeIndividualExams = onSnapshot(individualExamsQuery, (snapshot) => { individualExams = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); publish(); });
    const sessionsQuery = query(collection(db, "examSessions"), where("studentUid", "==", user.uid));
    const unsubscribeSessions = onSnapshot(sessionsQuery, (snapshot) => {
      setSessions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    });
    return () => { unsubscribeClassExams(); unsubscribeIndividualExams(); unsubscribeSessions(); };
  }, [profile?.className, user.uid]);

  useEffect(() => {
    let active = true;
    if (!selectedExamId || !user.uid) {
      setHasAssignedCode(false);
      return () => { active = false; };
    }

    setHasAssignedCode(false);
    getMyExamCodeStatus(selectedExamId).then((hasCode) => {
      if (active) setHasAssignedCode(hasCode);
    });

    return () => { active = false; };
  }, [selectedExamId, user.uid]);

  useEffect(() => {
    function refreshPendingState() { setPendingSubmissionMap(getPendingSubmissionMap(user.uid)); }
    refreshPendingState();
    async function handleOnline() { await flushPendingSubmissions(); refreshPendingState(); }
    window.addEventListener("online", handleOnline);
    window.addEventListener("storage", refreshPendingState);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("storage", refreshPendingState); };
  }, [user.uid]);

  useEffect(() => {
    setExamCode("");
    if (location.state?.message) {
      toast(location.state.message, { type: "success", duration: 7000 });
      window.history.replaceState({}, document.title);
    }
  }, [location.state?.message, selectedExamId, toast]);

  const sessionsByExam = useMemo(() => sessions.reduce((acc, session) => { acc[session.examId] = session; return acc; }, {}), [sessions]);
  const selectedExam = exams.find((exam) => exam.id === selectedExamId) ?? null;
  const selectedSession = selectedExam ? sessionsByExam[selectedExam.id] : null;
  const hasPendingSubmission = Boolean(selectedExam && pendingSubmissionMap[selectedExam.id]);
  const isSubmitted = selectedSession?.status === "submitted" || hasPendingSubmission;
  const isStarted = selectedSession?.status === "started";
  const hasAccessCode = hasAssignedCode;

  async function handleStartExam() {
    if (!selectedExam) return;
    setStartingExam(true);
    try {
      await startSecureExamSession(selectedExam.id, examCode);
      toast("Exam code verified. Opening your examination…", { type: "success", duration: 4500 });
      navigate(`/exam/${selectedExam.id}`);
    } catch (error) {
      console.error(error);
      toastError(friendlyExamError(error), { duration: 9000 });
    } finally {
      setStartingExam(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Available Exams · {profile?.className || "Class not assigned"}</p>
        <h2 className="mt-3 text-3xl font-semibold text-slate-900">Select your paper</h2>
        <p className="mt-3 max-w-2xl text-sm text-slate-500">Choose the exam you are scheduled to take, read the instructions, and start only when you are ready.</p>
      </section>
      <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">Exam</label>
          <select value={selectedExamId} onChange={(event) => setSelectedExamId(event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3">
            <option value="">Select exam</option>
            {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
          </select>
          <div className="mt-6 space-y-3">
            {exams.map((exam) => {
              const session = sessionsByExam[exam.id];
              const queued = Boolean(pendingSubmissionMap[exam.id]);
              return <button key={exam.id} onClick={() => setSelectedExamId(exam.id)} className={["w-full rounded-2xl border px-4 py-4 text-left transition", selectedExamId === exam.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-700"].join(" ")}>
                <p className="font-medium">{exam.title}</p><p className="mt-1 text-sm opacity-80">{exam.duration} minutes</p>
                <p className="mt-1 text-xs uppercase tracking-[0.25em] opacity-70">{queued ? "Syncing submission" : session?.status === "submitted" ? "Submitted" : session?.status === "started" ? "In progress" : "Ready"}</p>
              </button>;
            })}
          </div>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
          {!selectedExam && <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-sm text-slate-500">No published exam is available yet.</div>}
          {selectedExam && <>
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-start md:justify-between">
              <div><h3 className="text-2xl font-semibold text-slate-900">{selectedExam.title}</h3><p className="mt-2 text-sm text-slate-500">Duration: {selectedExam.duration} minutes</p><p className="mt-1 text-sm text-slate-500">Questions: {selectedExam.questionCount ?? "Not counted yet"}</p></div>
              <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700"><p className="font-semibold text-slate-900">{isSubmitted ? (hasPendingSubmission ? "Submission syncing" : "Submitted") : "Attempt policy"}</p><p className="mt-1">{isSubmitted ? (hasPendingSubmission ? "This exam was closed offline and will sync automatically when internet returns." : "This exam has already been attempted.") : "One attempt only. Timer starts immediately."}</p></div>
            </div>
            <div className="mt-6"><h4 className="text-lg font-semibold text-slate-900">Instructions</h4><div className="mt-4 space-y-3">{INSTRUCTIONS.map((instruction) => <div key={instruction} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{instruction}</div>)}</div></div>
            <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <label className="block text-sm font-medium text-slate-700">{selectedExam.individualCodesEnabled ? "Individual exam code" : "Exam password"}</label>
              <input type="text" value={examCode} onChange={(event) => setExamCode(event.target.value)} placeholder={hasAccessCode ? (selectedExam.individualCodesEnabled ? "Enter the code assigned to you" : "Enter the exam password") : (selectedExam.individualCodesEnabled ? "Your individual exam code has not been issued yet" : "Exam password is not configured yet")} disabled={isSubmitted || isStarted} className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:bg-slate-100" />
              <p className="mt-2 text-xs text-slate-500">{hasPendingSubmission ? "This exam is already closed and waiting for background sync." : isStarted ? "Your session is already live. Continue now and the timer will keep running." : hasAccessCode ? (selectedExam.individualCodesEnabled ? "Enter the code assigned to your student account before the exam can start." : "Enter the exam password provided by your administrator.") : selectedExam?.individualCodesEnabled ? "Your individual code has not been issued. Contact your administrator." : "The exam password is not configured yet. Contact your administrator."}</p>
            </div>
            <div className="mt-8">{!isSubmitted ? <button onClick={handleStartExam} disabled={startingExam || (!isStarted && !hasAccessCode)} className="inline-flex rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60">{startingExam ? "Verifying..." : isStarted ? "Continue exam" : "Start exam"}</button> : <button disabled className="inline-flex cursor-not-allowed rounded-xl bg-slate-300 px-5 py-3 text-sm font-medium text-white">Attempted</button>}</div>
          </>}
        </div>
      </section>
    </div>
  );
}
