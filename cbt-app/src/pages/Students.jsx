import { useState } from "react";
import { useRecords } from "../hooks/useRecords";
import RecordPager from "../components/RecordPager";
import { callApi } from "../services/api";
import { useSchool } from "../hooks/useSchool";
import { parseCsv, downloadCsv } from "../utils/csv";
import StatusBanner from "../components/StatusBanner";
const empty = {
  displayName: "",
  username: "",
  email: "",
  password: "",
  className: "",
  admissionNumber: "",
  subjects: [],
};
const field = "block w-full mt-1 rounded-xl border p-3";
export default function Students() {
  const { school } = useSchool();
  const records = useRecords("users", [["role", "==", "student"]]);
  const students = records.rows;
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [imports, setImports] = useState([]);

  async function act(action, data, message) {
    setBusy(true);
    try {
      const result = await callApi(action, data);
      setBanner({ tone: "success", message });
      return result;
    } catch (e) {
      setBanner({ tone: "error", message: e.message });
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    if (!school) return;
    const ok = await act(
      editing ? "students.update" : "students.create",
      { ...form, studentId: editing, academicSession: school.academicSession },
      editing
        ? "Student updated. Historical exam records are unchanged."
        : "Student created. Give the student their username and temporary password securely.",
    );
    if (ok) {
      setForm(empty);
      setEditing(null);
    }
  }
  async function readImport(e) {
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 500000)
        throw new Error("Use a CSV file smaller than 500 KB.");
      const rows = parseCsv(await file.text());
      if (rows.length > 200)
        throw new Error("Import at most 200 students per file.");
      const seen = new Set(students.map((s) => s.username));
      setImports(
        rows.map((r, i) => {
          const username = (r.username || "").toLowerCase();
          const subjects = (r.subjects || "")
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean);
          const errors = [];
          if (!r.displayName || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))
            errors.push("Name/username invalid");
          if (seen.has(username)) errors.push("Duplicate username");
          seen.add(username);
          if ((r.password || "").length < 8)
            errors.push("Password needs 8 characters");
          if (!school?.classes.includes(r.className))
            errors.push("Unknown class");
          if (
            !subjects.length ||
            subjects.some((s) => !school?.subjects.includes(s))
          )
            errors.push("Unknown/missing subject");
          return {
            ...r,
            username,
            subjects,
            row: i + 2,
            error: errors.join("; "),
            state: "ready",
          };
        }),
      );
    } catch (e) {
      setBanner({ tone: "error", message: e.message });
    }
  }
  async function importStudents() {
    setBusy(true);
    const updated = [...imports];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].error || updated[i].state === "created") continue;
      try {
        await callApi("students.create", {
          ...updated[i],
          academicSession: school.academicSession,
        });
        updated[i] = { ...updated[i], password: "", state: "created" };
      } catch (e) {
        updated[i] = { ...updated[i], error: e.message, state: "failed" };
      }
      setImports([...updated]);
    }
    setBusy(false);
    setBanner({
      tone: "success",
      message:
        "Import finished. Check every row status; failed rows were not reported as successful. Clear the preview after reviewing.",
    });
  }
  const filtered = students.filter((s) =>
    `${s.displayName} ${s.username} ${s.className} ${s.admissionNumber}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-6">
      <StatusBanner {...banner} />
      {!school && (
        <p className="bg-amber-50 p-4">Complete School setup first.</p>
      )}
      <form onSubmit={save} className="bg-white rounded-2xl p-6 space-y-4">
        <h2 className="text-2xl font-semibold">
          {editing ? "Edit student / promote class" : "Create student"}
        </h2>
        <p>
          Enrolment session: {school?.academicSession}. Username remains
          permanent when the class changes.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {["displayName", "username", "admissionNumber", "email"].map(
            (key) => (
              <label key={key}>
                {
                  {
                    displayName: "Full name",
                    username: "Permanent username",
                    admissionNumber: "Admission number",
                    email: "Contact email (optional)",
                  }[key]
                }
                <input
                  className={field}
                  required={["displayName", "username"].includes(key)}
                  disabled={editing && key === "username"}
                  type={key === "email" ? "email" : "text"}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ),
          )}
          {!editing && (
            <label>
              Temporary password
              <input
                className={field}
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
          )}
          <label>
            Class
            <select
              required
              className={field}
              value={form.className}
              onChange={(e) => setForm({ ...form, className: e.target.value })}
            >
              <option value="">Select class</option>
              {school?.classes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Enrolled subjects</legend>
          <div className="flex flex-wrap gap-4 mt-2">
            {school?.subjects.map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  checked={form.subjects.includes(s)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      subjects: e.target.checked
                        ? [...form.subjects, s]
                        : form.subjects.filter((v) => v !== s),
                    })
                  }
                />{" "}
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          disabled={busy || !school || !form.subjects.length}
          className="bg-slate-900 rounded-xl text-white p-3 disabled:opacity-50"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Create student"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setForm(empty);
            }}
            className="ml-3"
          >
            Cancel edit
          </button>
        )}
      </form>
      <section className="bg-white rounded-2xl p-6 space-y-4">
        <h3 className="text-xl font-semibold">Bulk enrolment</h3>
        <p>
          Save your Excel sheet as CSV. Subjects are separated with |. Passwords
          stay in memory during preview and are not saved in Firestore.
        </p>
        <button
          className="underline"
          onClick={() =>
            downloadCsv("student-template.csv", [
              [
                "displayName",
                "username",
                "admissionNumber",
                "className",
                "subjects",
                "password",
                "email",
              ],
              [
                "Example Student",
                "student001",
                "SCH001",
                school?.classes[0] || "JSS1 A",
                school?.subjects.join("|") || "Mathematics",
                "ReplaceThisPassword",
                "",
              ],
            ])
          }
        >
          Download template
        </button>
        <input
          aria-label="Import students CSV"
          type="file"
          accept=".csv"
          disabled={busy || !school}
          onChange={readImport}
        />
        {!!imports.length && (
          <>
            <div className="max-h-64 overflow-auto">
              {imports.map((r) => (
                <p key={r.row}>
                  Row {r.row}: {r.displayName} — {r.error || r.state}
                </p>
              ))}
            </div>
            <button
              disabled={busy || imports.some((r) => r.error)}
              onClick={importStudents}
              className="bg-slate-900 text-white rounded-xl p-3"
            >
              {busy ? "Importing…" : "Import valid preview"}
            </button>
            <button
              disabled={busy}
              onClick={() => setImports([])}
              className="ml-4"
            >
              Clear preview
            </button>
          </>
        )}
      </section>
      <section className="bg-white rounded-2xl p-6 space-y-4">
        <h3 className="text-xl font-semibold">
          Student register ({filtered.length})
        </h3>
        <input
          className={field}
          placeholder="Search name, username, admission number or class"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        {filtered.map((s) => (
          <article
            key={s.id}
            className="border-b py-4 flex flex-wrap justify-between gap-3"
          >
            <div>
              <strong>{s.displayName}</strong>
              <p>
                {s.username || s.email} · {s.className || "Class not assigned"}{" "}
                · {s.academicSession} · {s.loginDisabled ? "Blocked" : "Active"}
              </p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(s.id);
                  setForm({
                    ...empty,
                    ...s,
                    username: s.username || s.studentId || "",
                    subjects: s.subjects || [],
                  });
                  window.scrollTo(0, 0);
                }}
              >
                Edit / promote
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  act(
                    "students.access",
                    { studentId: s.id, loginDisabled: !s.loginDisabled },
                    "Access updated.",
                  )
                }
              >
                {s.loginDisabled ? "Restore" : "Block"}
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  const password = window.prompt(
                    "New temporary password (8+ characters)",
                  );
                  if (!password) return;
                  const reason = window.prompt("Reason for password reset");
                  if (reason)
                    await act(
                      "students.password",
                      { studentId: s.id, password, reason },
                      "Password reset and existing refresh tokens revoked.",
                    );
                }}
              >
                Reset password
              </button>
            </div>
          </article>
        ))}
        <p>
          Search covers this page. Duplicate usernames are also rejected by the
          server.
        </p>
        <RecordPager records={records} />
      </section>
    </div>
  );
}
