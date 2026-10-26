import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { deleteApp, getApp, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { auth, db } from "/firebase";
import { setStudentLoginAccess } from "../services/sessionService";
import StatusBanner from "../components/StatusBanner";

const field = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50";

function makeStudentId(className) {
  const prefix = String(className || "STD").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "STD";
  return `${prefix}-${Math.floor(10000 + Math.random() * 90000)}`;
}

function internalStudentEmail(studentId) {
  return `${studentId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@student.cbt.local`;
}

export default function Students() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [form, setForm] = useState({ name: "", className: "", password: "" });

  useEffect(() => onSnapshot(query(collection(db, "users"), where("role", "==", "student")), (snapshot) => {
    setStudents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
  }, (error) => setBanner({ tone: "error", message: error.message || "Could not load students." })), []);

  const classes = useMemo(() => [...new Set(students.map((student) => String(student.className || "").trim()).filter(Boolean))].sort(), [students]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students.filter((student) => {
      const text = `${student.displayName || ""} ${student.studentId || ""} ${student.className || ""}`.toLowerCase();
      return (!term || text.includes(term)) && (classFilter === "all" || student.className === classFilter);
    }).sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || "")));
  }, [students, search, classFilter]);

  async function createStudent(event) {
    event.preventDefault();
    const name = form.name.trim();
    const className = form.className.trim();
    if (!name || !className || form.password.length < 6) {
      setBanner({ tone: "error", message: "Enter the student's name, class and a password of at least 6 characters." });
      return;
    }

    setSaving(true);
    let secondaryApp;
    try {
      let studentId = makeStudentId(className);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const existing = await import("firebase/firestore").then(({ getDocs }) => getDocs(query(collection(db, "users"), where("studentId", "==", studentId))));
        if (existing.empty) break;
        studentId = makeStudentId(className);
      }
      const email = internalStudentEmail(studentId);
      secondaryApp = initializeApp(getApp().options, `student-provision-${Date.now()}`);
      const credential = await createUserWithEmailAndPassword(getAuth(secondaryApp), email, form.password);
      await import("firebase/firestore").then(({ setDoc }) => setDoc(doc(db, "users", credential.user.uid), {
        email,
        displayName: name,
        studentId,
        className,
        role: "student",
        loginDisabled: false,
        createdBy: auth.currentUser?.uid || "",
        createdAt: serverTimestamp(),
        lastLoginAt: null,
      }));
      setBanner({ tone: "success", message: `${name} was created. Student ID: ${studentId}` });
      setForm({ name: "", className: "", password: "" });
      setShowAdd(false);
    } catch (error) {
      setBanner({ tone: "error", message: error.message || "Could not create the student." });
    } finally {
      if (secondaryApp) await deleteApp(secondaryApp).catch(() => null);
      setSaving(false);
    }
  }

  async function toggleStudent(student) {
    try {
      await setStudentLoginAccess(student.id, !student.loginDisabled);
      setBanner({ tone: "success", message: `${student.displayName} is now ${student.loginDisabled ? "active" : "blocked"}.` });
    } catch (error) {
      setBanner({ tone: "error", message: error.message || "Could not update student access." });
    }
  }

  return (
    <div className="space-y-6">
      <StatusBanner tone={banner?.tone} message={banner?.message} onClose={() => setBanner(null)} />
      <section className="rounded-3xl bg-slate-950 p-6 text-white md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Students</p><h2 className="mt-2 text-3xl font-bold">Your students</h2><p className="mt-2 max-w-xl text-sm text-slate-300">Create simple school accounts. Every student gets a permanent Student ID and never needs a personal email.</p></div>
          <button onClick={() => setShowAdd(true)} className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950">+ Add student</button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or Student ID" className="rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-500" />
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm"><option value="all">All classes</option>{classes.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><p className="font-semibold text-slate-900">{filtered.length} student{filtered.length === 1 ? "" : "s"}</p></div>
        {filtered.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No students found. Add your first student to get started.</div> : <div className="divide-y divide-slate-100">{filtered.map((student) => <div key={student.id} className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-4"><div className="grid h-11 w-11 place-items-center rounded-full bg-indigo-50 font-bold text-indigo-700">{String(student.displayName || "S").charAt(0).toUpperCase()}</div><div><p className="font-semibold text-slate-900">{student.displayName}</p><p className="text-sm text-slate-500">{student.studentId || "No Student ID"} · {student.className || "No class"}</p></div></div><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${student.loginDisabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{student.loginDisabled ? "Blocked" : "Active"}</span><button onClick={() => toggleStudent(student)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">{student.loginDisabled ? "Allow login" : "Block login"}</button></div></div>)}</div>}
      </section>

      {showAdd && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><form onSubmit={createStudent} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h3 className="text-2xl font-bold text-slate-950">Add student</h3><p className="mt-1 text-sm text-slate-500">The system creates the permanent Student ID automatically.</p></div><button type="button" onClick={() => setShowAdd(false)} className="text-slate-400">✕</button></div><div className="mt-6 space-y-4"><label className="block text-sm font-semibold text-slate-700">Full name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={field} placeholder="Student full name" required /></label><label className="block text-sm font-semibold text-slate-700">Class<input value={form.className} onChange={(event) => setForm({ ...form, className: event.target.value })} className={field} placeholder="e.g. JS1" required /></label><label className="block text-sm font-semibold text-slate-700">Initial password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={field} placeholder="At least 6 characters" minLength={6} required /></label></div><div className="mt-6 rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-900">The student will log in with their Student ID and this password. No personal email is required.</div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowAdd(false)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold">Cancel</button><button disabled={saving} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Creating…" : "Create student"}</button></div></form></div>}
    </div>
  );
}
