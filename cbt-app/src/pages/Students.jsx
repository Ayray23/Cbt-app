import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "/firebase";
import StatusBanner from "../components/StatusBanner";
import { setStudentLoginAccess } from "../services/sessionService";
import { callApi } from "../services/api";

const EMPTY_FORM = { displayName: "", username: "", email: "", password: "", confirmPassword: "" };

export default function Students() {
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updatingStudentId, setUpdatingStudentId] = useState(null);
  const [banner, setBanner] = useState(null);

  useEffect(() => onSnapshot(query(collection(db, "users"), where("role", "==", "student")),
    (snapshot) => setStudents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    () => setBanner({ tone: "error", message: "Could not load student accounts. Check your administrator access." })), []);

  async function createStudent(event) {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      setBanner({ tone: "error", message: "Passwords do not match." }); return;
    }
    setCreating(true);
    try {
      const student = await callApi("students.create", form);
      setForm(EMPTY_FORM);
      setBanner({ tone: "success", message: `Account created for ${student.displayName}. Login username: ${student.username}. Give the student their username and the password you entered.` });
    } catch (error) { setBanner({ tone: "error", message: error.message }); }
    finally { setCreating(false); }
  }

  async function toggleAccess(student) {
    setUpdatingStudentId(student.id);
    try {
      await setStudentLoginAccess(student.id, !student.loginDisabled);
      setBanner({ tone: "success", message: `${student.displayName || student.username || student.email}: access ${student.loginDisabled ? "restored" : "blocked"}.` });
    } catch (error) { setBanner({ tone: "error", message: error.message }); }
    finally { setUpdatingStudentId(null); }
  }

  return <div className="space-y-6">
    <StatusBanner {...banner} onClose={() => setBanner(null)} />
    <section className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-slate-900">Student accounts</h2>
      <p className="mt-2 text-sm text-slate-500">Only administrators create student accounts. Students sign in with a username and password; a contact email is optional.</p>
      <form onSubmit={createStudent} className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="text-sm text-slate-700">Full name<input required maxLength={120} value={form.displayName}
          onChange={(event) => setForm({ ...form, displayName: event.target.value })}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm text-slate-700">Username / student ID<input required minLength={3} maxLength={40}
          pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" autoCapitalize="none" value={form.username}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm text-slate-700">Contact email (optional)<input type="email" value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="flex items-center gap-2 self-end py-3 text-sm text-slate-600">
          <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />Show passwords
        </label>
        <label className="text-sm text-slate-700">Login password<input type={showPassword ? "text" : "password"} required
          minLength={8} maxLength={128} autoComplete="new-password" value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm text-slate-700">Confirm password<input type={showPassword ? "text" : "password"} required
          minLength={8} maxLength={128} autoComplete="new-password" value={form.confirmPassword}
          onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <button disabled={creating} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60 md:col-span-2">
          {creating ? "Creating student..." : "Create student account"}
        </button>
      </form>
    </section>
    <section className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-500"><tr>
          {["Student", "Username", "Contact email", "Access", "Action"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}
        </tr></thead>
        <tbody>{students.map((student) => <tr key={student.id} className="border-t border-slate-200">
          <td className="px-4 py-4">{student.displayName || "-"}</td>
          <td className="px-4 py-4">{student.username || "Uses existing email login"}</td>
          <td className="px-4 py-4">{student.email || "-"}</td>
          <td className="px-4 py-4">{student.loginDisabled ? "Blocked" : "Allowed"}</td>
          <td className="px-4 py-4"><button onClick={() => toggleAccess(student)}
            disabled={updatingStudentId === student.id} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-60">
            {updatingStudentId === student.id ? "Saving..." : student.loginDisabled ? "Allow login" : "Block login"}
          </button></td>
        </tr>)}</tbody>
      </table>
      {!students.length && <p className="p-6 text-sm text-slate-500">No student accounts yet.</p>}
    </section>
  </div>;
}
