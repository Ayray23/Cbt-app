import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, doc, setDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { deleteApp, getApp, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, deleteUser, getAuth } from "firebase/auth";
import { auth, db } from "/firebase";
import StatusBanner from "../components/StatusBanner";
import { setStudentLoginAccess } from "../services/sessionService";
import { updateStudentProfile } from "../services/cbtService";

const emptyProfile = { displayName: "", studentId: "", className: "", department: "", phone: "" };
const fieldClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50";

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.toLowerCase().replace(/[ _-]/g, ""));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export default function Students() {
  const [students, setStudents] = useState([]);
  const [updatingStudentId, setUpdatingStudentId] = useState(null);
  const [banner, setBanner] = useState(null);
  const [search, setSearch] = useState("");
  const [accessFilter, setAccessFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingStudent, setEditingStudent] = useState(null);
  const [profileForm, setProfileForm] = useState(emptyProfile);
  const [savingProfile, setSavingProfile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [newStudentForm, setNewStudentForm] = useState({ ...emptyProfile, email: "", password: "" });

  useEffect(() => {
    const studentsQuery = query(collection(db, "users"), where("role", "==", "student"));
    return onSnapshot(studentsQuery, (snapshot) => {
      setStudents(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    }, (error) => setBanner({ tone: "error", message: error.message || "Could not load students." }));
  }, []);

  const classes = useMemo(() => [...new Set(students.map((student) => student.className).filter(Boolean))].sort(), [students]);
  const filteredStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students.filter((student) => {
      const searchable = [student.displayName, student.email, student.studentId, student.className, student.department, student.phone].join(" ").toLowerCase();
      const matchesSearch = !term || searchable.includes(term);
      const matchesAccess = accessFilter === "all" || (accessFilter === "blocked" ? student.loginDisabled : !student.loginDisabled);
      const matchesClass = classFilter === "all" || student.className === classFilter;
      return matchesSearch && matchesAccess && matchesClass;
    }).sort((a, b) => String(a.displayName || a.email || "").localeCompare(String(b.displayName || b.email || "")));
  }, [students, search, accessFilter, classFilter]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => students.some((student) => student.id === id)));
  }, [students]);

  function beginEdit(student) {
    setEditingStudent(student);
    setProfileForm({
      displayName: student.displayName || "",
      studentId: student.studentId || "",
      className: student.className || "",
      department: student.department || "",
      phone: student.phone || "",
    });
  }

  async function createStudentAccount(event) {
    event.preventDefault();
    const email = newStudentForm.email.trim().toLowerCase();
    if (!email || !newStudentForm.password || newStudentForm.password.length < 6 || !newStudentForm.displayName.trim()) {
      setBanner({ tone: "error", message: "Enter the student's full name, email and a temporary password of at least 6 characters." });
      return;
    }

    setCreatingStudent(true);
    let secondaryApp;
    let createdUser;
    try {
      secondaryApp = initializeApp(getApp().options, `cbt-student-provision-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, newStudentForm.password);
      createdUser = credential.user;
      await setDoc(doc(db, "users", createdUser.uid), {
        email,
        displayName: newStudentForm.displayName.trim(),
        studentId: newStudentForm.studentId.trim(),
        className: newStudentForm.className.trim(),
        department: newStudentForm.department.trim(),
        phone: newStudentForm.phone.trim(),
        role: "student",
        loginDisabled: false,
        createdBy: auth.currentUser?.uid || "",
        createdAt: serverTimestamp(),
        lastLoginAt: null,
      });
      setBanner({ tone: "success", message: `Student account created for ${newStudentForm.displayName.trim()}. Share the temporary password with the student securely.` });
      setNewStudentForm({ ...emptyProfile, email: "", password: "" });
      setShowCreateModal(false);
    } catch (error) {
      if (createdUser) {
        try { await deleteUser(createdUser); } catch (cleanupError) { console.error("Could not roll back student auth account", cleanupError); }
      }
      setBanner({ tone: "error", message: error.code === "auth/email-already-in-use" ? "That email already has a Firebase login account." : error.message || "Could not create the student account." });
    } finally {
      if (secondaryApp) {
        try { await deleteApp(secondaryApp); } catch (cleanupError) { console.error("Could not close temporary auth app", cleanupError); }
      }
      setCreatingStudent(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!editingStudent) return;
    setSavingProfile(true);
    try {
      await updateStudentProfile(editingStudent.id, profileForm);
      setBanner({ tone: "success", message: "Student profile updated." });
      setEditingStudent(null);
    } catch (error) {
      setBanner({ tone: "error", message: error.message || "Could not update student profile." });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleToggleLogin(student) {
    setUpdatingStudentId(student.id);
    try {
      const nextValue = !student.loginDisabled;
      await setStudentLoginAccess(student.id, nextValue);
      setBanner({ tone: "success", message: nextValue ? `${student.displayName || student.email || "Student"} has been blocked from login.` : `${student.displayName || student.email || "Student"} can log in again.` });
    } catch (error) {
      setBanner({ tone: "error", message: error.message || "Could not update student access." });
    } finally {
      setUpdatingStudentId(null);
    }
  }

  async function bulkToggleLogin(disabled) {
    const targets = students.filter((student) => selectedIds.includes(student.id) && Boolean(student.loginDisabled) !== disabled);
    if (!targets.length) {
      setBanner({ tone: "info", message: "The selected students already have that access status." });
      return;
    }
    setUpdatingStudentId("bulk");
    try {
      for (let offset = 0; offset < targets.length; offset += 400) {
        const batch = writeBatch(db);
        targets.slice(offset, offset + 400).forEach((student) => batch.update(doc(db, "users", student.id), { loginDisabled: disabled, updatedAt: serverTimestamp() }));
        await batch.commit();
      }
      setBanner({ tone: "success", message: `${targets.length} student account(s) ${disabled ? "blocked" : "restored"}.` });
      setSelectedIds([]);
    } catch (error) {
      setBanner({ tone: "error", message: error.message || "Bulk access update failed." });
    } finally {
      setUpdatingStudentId(null);
    }
  }

  function exportStudents() {
    const headers = ["displayName", "email", "studentId", "className", "department", "phone", "loginDisabled", "lastLoginAt"];
    const lines = [headers.join(","), ...filteredStudents.map((student) => headers.map((key) => csvCell(key === "lastLoginAt" ? (student.lastLoginAt?.seconds ? new Date(student.lastLoginAt.seconds * 1000).toISOString() : "") : key === "loginDisabled" ? (student.loginDisabled ? "blocked" : "allowed") : student[key])).join(","))];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "cbt-students.csv"; link.click();
    URL.revokeObjectURL(url);
  }

  async function importRoster(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error("The CSV is empty or has no header row.");
      const byEmail = new Map(students.map((student) => [String(student.email || "").toLowerCase(), student]));
      let updated = 0, skipped = 0;
      for (let offset = 0; offset < rows.length; offset += 400) {
        const batch = writeBatch(db);
        let batchCount = 0;
        for (const row of rows.slice(offset, offset + 400)) {
          const email = String(row.email || row.emailaddress || "").trim().toLowerCase();
          const student = byEmail.get(email);
          if (!student) { skipped += 1; continue; }
          const profile = {
            displayName: row.displayname || row.fullname || row.name || student.displayName || "",
            studentId: row.studentid || row.matricno || row.registrationnumber || student.studentId || "",
            className: row.classname || row.class || row.level || student.className || "",
            department: row.department || student.department || "",
            phone: row.phone || row.phonenumber || student.phone || "",
            updatedAt: serverTimestamp(),
          };
          batch.update(doc(db, "users", student.id), profile);
          batchCount += 1; updated += 1;
        }
        if (batchCount) await batch.commit();
      }
      setBanner({ tone: "success", message: `Roster import complete: ${updated} existing account(s) updated, ${skipped} row(s) skipped because no matching student email was found.` });
    } catch (error) {
      setBanner({ tone: "error", message: error.message || "Could not import roster." });
    } finally {
      setImporting(false);
    }
  }

  const allVisibleSelected = filteredStudents.length > 0 && filteredStudents.every((student) => selectedIds.includes(student.id));

  return (
    <div className="space-y-6">
      <StatusBanner tone={banner?.tone} message={banner?.message} onClose={() => setBanner(null)} />

      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-300">Administration / Candidates</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Student management</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Manage student profiles, access, class details and roster records from one place.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><p className="text-xs text-slate-300">Total students</p><p className="mt-1 text-2xl font-semibold">{students.length}</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><p className="text-xs text-slate-300">Active access</p><p className="mt-1 text-2xl font-semibold">{students.filter((student) => !student.loginDisabled).length}</p></div>
            <div className="col-span-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:col-span-1"><p className="text-xs text-slate-300">Blocked</p><p className="mt-1 text-2xl font-semibold">{students.filter((student) => student.loginDisabled).length}</p></div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, student ID, class…" className="w-full rounded-xl border border-slate-200 py-3 pl-9 pr-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50" />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className={fieldClass + " min-w-36"}><option value="all">All classes</option>{classes.map((className) => <option key={className} value={className}>{className}</option>)}</select>
            <select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)} className={fieldClass + " min-w-36"}><option value="all">All access</option><option value="active">Active</option><option value="blocked">Blocked</option></select>
            <button type="button" onClick={() => setShowCreateModal(true)} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">+ Add student</button><button type="button" onClick={exportStudents} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export CSV</button>
            <label className={`cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 ${importing ? "pointer-events-none opacity-60" : ""}`}>{importing ? "Importing…" : "Import roster"}<input type="file" accept=".csv,text/csv" className="hidden" onChange={importRoster} disabled={importing} /></label>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">CSV import updates existing accounts by email; it does not create Firebase login accounts. Expected columns include email, name/displayName, studentId, className, department and phone.</p>
      </section>

      {selectedIds.length > 0 && <section className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-semibold text-indigo-950">{selectedIds.length} student(s) selected</p><div className="flex flex-wrap gap-2"><button type="button" disabled={updatingStudentId === "bulk"} onClick={() => bulkToggleLogin(true)} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Block selected</button><button type="button" disabled={updatingStudentId === "bulk"} onClick={() => bulkToggleLogin(false)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Restore selected</button><button type="button" onClick={() => setSelectedIds([])} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-800">Clear selection</button></div></section>}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h3 className="font-semibold text-slate-900">Student directory</h3><p className="mt-1 text-xs text-slate-500">Showing {filteredStudents.length} of {students.length} accounts</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Live data</span></div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="w-12 px-4 py-3"><input aria-label="Select all visible students" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, ...filteredStudents.map((student) => student.id)])] : current.filter((id) => !filteredStudents.some((student) => student.id === id)))} /></th><th className="px-4 py-3">Student</th><th className="px-4 py-3">Student ID</th><th className="px-4 py-3">Class / Department</th><th className="px-4 py-3">Last login</th><th className="px-4 py-3">Access</th><th className="px-4 py-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.map((student) => <tr key={student.id} className="transition hover:bg-slate-50/70">
                <td className="px-4 py-4"><input aria-label={`Select ${student.displayName || student.email}`} type="checkbox" checked={selectedIds.includes(student.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id))} /></td>
                <td className="px-4 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-sm font-bold text-indigo-700">{String(student.displayName || student.email || "S").trim().charAt(0).toUpperCase()}</div><div><p className="font-semibold text-slate-900">{student.displayName || "Unnamed student"}</p><p className="mt-0.5 text-xs text-slate-500">{student.email || "No email"}</p></div></div></td>
                <td className="px-4 py-4 text-slate-600">{student.studentId || "—"}</td>
                <td className="px-4 py-4"><p className="text-slate-700">{student.className || "Class not set"}</p><p className="mt-1 text-xs text-slate-500">{student.department || "Department not set"}</p></td>
                <td className="px-4 py-4 text-xs text-slate-500">{student.lastLoginAt?.seconds ? new Date(student.lastLoginAt.seconds * 1000).toLocaleString() : "Never recorded"}</td>
                <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${student.loginDisabled ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}><span className="mr-1.5">●</span>{student.loginDisabled ? "Blocked" : "Active"}</span></td>
                <td className="px-4 py-4"><div className="flex items-center gap-2"><button type="button" onClick={() => beginEdit(student)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white">Edit</button><button type="button" disabled={updatingStudentId === student.id || updatingStudentId === "bulk"} onClick={() => handleToggleLogin(student)} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${student.loginDisabled ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-rose-50 text-rose-700 hover:bg-rose-100"}`}>{updatingStudentId === student.id ? "Saving…" : student.loginDisabled ? "Restore" : "Block"}</button></div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {filteredStudents.length === 0 && <div className="p-12 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl text-slate-500">⌕</div><p className="mt-4 font-semibold text-slate-900">No matching students</p><p className="mt-1 text-sm text-slate-500">Try another search or change the filters.</p></div>}
      </section>

      {showCreateModal && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" aria-labelledby="create-student-title" className="my-auto w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl md:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">New candidate</p><h3 id="create-student-title" className="mt-2 text-2xl font-semibold text-slate-900">Create student account</h3><p className="mt-1 text-sm text-slate-500">Creates a Firebase login and student profile without signing you out.</p></div><button type="button" onClick={() => setShowCreateModal(false)} className="rounded-xl px-3 py-2 text-xl text-slate-500 hover:bg-slate-100" aria-label="Close create form">×</button></div><form onSubmit={createStudentAccount} className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700 sm:col-span-2">Full name<input required value={newStudentForm.displayName} onChange={(event) => setNewStudentForm((current) => ({ ...current, displayName: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">Email address<input type="email" required value={newStudentForm.email} onChange={(event) => setNewStudentForm((current) => ({ ...current, email: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">Temporary password<input type="text" autoComplete="off" minLength={6} required value={newStudentForm.password} onChange={(event) => setNewStudentForm((current) => ({ ...current, password: event.target.value }))} className={fieldClass + " mt-1.5"} /><span className="mt-1 block text-xs font-normal text-slate-500">Use at least 6 characters and share it with the student privately.</span></label><label className="text-sm font-medium text-slate-700">Student ID / Matric no.<input value={newStudentForm.studentId} onChange={(event) => setNewStudentForm((current) => ({ ...current, studentId: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><label className="text-sm font-medium text-slate-700">Class / Level<input value={newStudentForm.className} onChange={(event) => setNewStudentForm((current) => ({ ...current, className: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><label className="text-sm font-medium text-slate-700">Department<input value={newStudentForm.department} onChange={(event) => setNewStudentForm((current) => ({ ...current, department: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><label className="text-sm font-medium text-slate-700">Phone number<input value={newStudentForm.phone} onChange={(event) => setNewStudentForm((current) => ({ ...current, phone: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><div className="mt-2 flex justify-end gap-3 sm:col-span-2"><button type="button" onClick={() => setShowCreateModal(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={creatingStudent} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{creatingStudent ? "Creating account…" : "Create student"}</button></div></form></div></div>}
      {editingStudent && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" aria-labelledby="edit-student-title" className="my-auto w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl md:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Student record</p><h3 id="edit-student-title" className="mt-2 text-2xl font-semibold text-slate-900">Edit student</h3><p className="mt-1 text-sm text-slate-500">{editingStudent.email}</p></div><button type="button" onClick={() => setEditingStudent(null)} className="rounded-xl px-3 py-2 text-xl text-slate-500 hover:bg-slate-100" aria-label="Close edit form">×</button></div><form onSubmit={saveProfile} className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700 sm:col-span-2">Full name<input required value={profileForm.displayName} onChange={(event) => setProfileForm((current) => ({ ...current, displayName: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><label className="text-sm font-medium text-slate-700">Student ID / Matric no.<input value={profileForm.studentId} onChange={(event) => setProfileForm((current) => ({ ...current, studentId: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><label className="text-sm font-medium text-slate-700">Class / Level<input value={profileForm.className} onChange={(event) => setProfileForm((current) => ({ ...current, className: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><label className="text-sm font-medium text-slate-700">Department<input value={profileForm.department} onChange={(event) => setProfileForm((current) => ({ ...current, department: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><label className="text-sm font-medium text-slate-700">Phone number<input value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} className={fieldClass + " mt-1.5"} /></label><div className="mt-2 flex justify-end gap-3 sm:col-span-2"><button type="button" onClick={() => setEditingStudent(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={savingProfile} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{savingProfile ? "Saving…" : "Save changes"}</button></div></form></div></div>}
    </div>
  );
}
