import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "/firebase";
import { useAuth } from "../contexts/AuthContext";
import { getMyExamCodeStatus, startSecureExamSession } from "../services/secureExamService";
import { getPendingSubmissionMap } from "../services/sessionService";

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [code, setCode] = useState("");
  const [hasCode, setHasCode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profile?.className) return undefined;
    let classExams = [], individualExams = [];
    const publish = () => setExams([...classExams, ...individualExams].filter((exam, index, all) => all.findIndex((item) => item.id === exam.id) === index).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    const a = onSnapshot(query(collection(db, "exams"), where("status", "==", "published"), where("className", "==", profile.className), where("assignmentMode", "==", "class"), orderBy("createdAt", "desc")), (s) => { classExams = s.docs.map((d) => ({ id: d.id, ...d.data() })); publish(); });
    const b = onSnapshot(query(collection(db, "exams"), where("status", "==", "published"), where("className", "==", profile.className), where("assignmentMode", "==", "individual"), where("assignedStudentUids", "array-contains", user.uid), orderBy("createdAt", "desc")), (s) => { individualExams = s.docs.map((d) => ({ id: d.id, ...d.data() })); publish(); });
    const c = onSnapshot(query(collection(db, "examSessions"), where("studentUid", "==", user.uid)), (s) => setSessions(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => { a(); b(); c(); };
  }, [profile?.className, user.uid]);

  useEffect(() => { if (!selectedId && exams[0]) setSelectedId(exams[0].id); }, [exams, selectedId]);
  useEffect(() => {
    let active = true;
    setCode(""); setError("");
    if (!selectedId) { setHasCode(false); return undefined; }
    getMyExamCodeStatus(selectedId).then((value) => active && setHasCode(value)).catch(() => active && setHasCode(false));
    return () => { active = false; };
  }, [selectedId]);

  const selected = exams.find((exam) => exam.id === selectedId);
  const sessionMap = useMemo(() => sessions.reduce((map, item) => ({ ...map, [item.examId]: item }), {}), [sessions]);
  const pending = selected ? Boolean(getPendingSubmissionMap(user.uid)[selected.id]) : false;
  const submitted = selected ? sessionMap[selected.id]?.status === "submitted" || pending : false;
  const codeRequired = Boolean(selected?.individualCodesEnabled || selected?.assignmentMode === "class");

  async function startExam() {
    if (!selected) return;
    setStarting(true); setError("");
    try { await startSecureExamSession(selected.id, code); navigate(`/exam/${selected.id}`); }
    catch (examError) { setError(examError?.message || "Could not start this exam. Check the code and try again."); }
    finally { setStarting(false); }
  }

  return <div className="space-y-6">
    <section className="rounded-3xl bg-slate-950 p-6 text-white md:p-8"><p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Student Portal</p><h2 className="mt-2 text-3xl font-bold">Hello, {profile?.displayName || "Student"}</h2><p className="mt-2 text-sm text-slate-300">Class: <strong className="text-white">{profile?.className || "Not assigned"}</strong> · Student ID: <strong className="text-white">{profile?.studentId || "Not assigned"}</strong></p></section>
    <section className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 px-2"><p className="font-bold text-slate-950">Your exams</p><p className="text-xs text-slate-500">Only exams for your class appear here.</p></div>{exams.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No exam is available yet.</p> : <div className="space-y-2">{exams.map((exam) => <button key={exam.id} onClick={() => setSelectedId(exam.id)} className={`w-full rounded-xl px-4 py-3 text-left ${selectedId === exam.id ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-800 hover:bg-slate-100"}`}><p className="font-semibold">{exam.title}</p><p className="mt-1 text-xs opacity-70">{exam.duration} minutes · {exam.questionCount || 0} questions</p></button>)}</div>}</div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">{!selected ? <div className="py-10 text-center text-sm text-slate-500">Select an exam to continue.</div> : <><div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-2xl font-bold text-slate-950">{selected.title}</h3><p className="mt-2 text-sm text-slate-500">{selected.className} · {selected.duration} minutes · {selected.questionCount || 0} questions</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${submitted ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{submitted ? "Completed" : "Ready"}</span></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Class</p><p className="mt-1 font-bold">{selected.className}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Duration</p><p className="mt-1 font-bold">{selected.duration} min</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Attempts</p><p className="mt-1 font-bold">1</p></div></div><div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><h4 className="font-bold text-indigo-950">Before you start</h4><ul className="mt-3 space-y-2 text-sm text-indigo-900"><li>• Make sure you have enough time to finish.</li><li>• Do not close or refresh the exam page.</li><li>• Your answers are saved while you work.</li><li>• Submit only when you are finished.</li></ul></div>{error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}{!submitted && <div className="mt-6"><label className="block text-sm font-semibold text-slate-700">Exam code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder={hasCode ? "Enter your exam code" : "No code has been issued yet"} disabled={!hasCode || starting} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 uppercase tracking-[0.18em] outline-none focus:border-indigo-500" /></label><p className="mt-2 text-xs text-slate-500">Your administrator gives you the code for this exam.</p><button onClick={startExam} disabled={starting || !hasCode || !codeRequired} className="mt-5 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{starting ? "Checking…" : "Start exam"}</button></div>}</>}</div>
    </section>
  </div>;
}
