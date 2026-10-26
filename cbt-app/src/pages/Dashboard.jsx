import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "/firebase";
import { useAuth } from "../contexts/AuthContext";

function Card({ label, value, note }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-400">{note}</p></div>; }

export default function Dashboard() {
  const { profile } = useAuth();
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [results, setResults] = useState([]);

  useEffect(() => {
    const unsubStudents = onSnapshot(query(collection(db, "users"), where("role", "==", "student")), (snapshot) => setStudents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))));
    const unsubExams = onSnapshot(collection(db, "exams"), (snapshot) => setExams(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))));
    const unsubResults = onSnapshot(collection(db, "results"), (snapshot) => setResults(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))));
    return () => { unsubStudents(); unsubExams(); unsubResults(); };
  }, []);

  const classes = useMemo(() => new Set(students.map((student) => student.className).filter(Boolean)).size, [students]);
  const published = exams.filter((exam) => exam.status === "published").length;
  const recent = [...exams].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 5);

  return <div className="space-y-6">
    <section className="rounded-3xl bg-slate-950 p-6 text-white md:p-8"><p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Dashboard</p><h2 className="mt-2 text-3xl font-bold">Good day, {profile?.displayName || "Administrator"}</h2><p className="mt-2 max-w-2xl text-sm text-slate-300">Everything you need to run a school exam is here: students, exams, questions and results.</p></section>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Card label="Students" value={students.length} note="Student accounts" /><Card label="Classes" value={classes} note="Classes in your roster" /><Card label="Published exams" value={published} note="Ready for students" /><Card label="Results" value={results.length} note="Recorded submissions" /></div>
    <section className="grid gap-4 md:grid-cols-3"><Link to="/students" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:ring-indigo-300"><p className="font-bold text-slate-950">Add students</p><p className="mt-1 text-sm text-slate-500">Create Student IDs and passwords.</p></Link><Link to="/exams/create" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:ring-indigo-300"><p className="font-bold text-slate-950">Create an exam</p><p className="mt-1 text-sm text-slate-500">Choose a class and set the duration.</p></Link><Link to="/questions" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:ring-indigo-300"><p className="font-bold text-slate-950">Manage questions</p><p className="mt-1 text-sm text-slate-500">Add or review exam questions.</p></Link></section>
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h3 className="font-bold text-slate-950">Recent exams</h3><p className="text-xs text-slate-500">The latest exams created in the system.</p></div><Link to="/exams/create" className="text-sm font-semibold text-indigo-600">Open Exams</Link></div>{recent.length === 0 ? <p className="p-8 text-sm text-slate-500">No exams yet. Create the first one.</p> : <div className="divide-y divide-slate-100">{recent.map((exam) => <div key={exam.id} className="flex items-center justify-between gap-4 px-5 py-4"><div><p className="font-semibold text-slate-900">{exam.title}</p><p className="text-sm text-slate-500">{exam.className || "No class"} · {exam.duration || 0} minutes · {exam.questionCount || 0} questions</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${exam.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{exam.status === "published" ? "Published" : "Draft"}</span></div>)}</div>}</section>
  </div>;
}
