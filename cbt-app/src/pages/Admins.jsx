import { useEffect, useState, useRef } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
  startAfter,
  documentId,
} from "firebase/firestore";
import { db } from "/firebase";
import { callApi } from "../services/api";
import { useSchool } from "../hooks/useSchool";
import StatusBanner from "../components/StatusBanner";
import { ASSIGNABLE_ROLES, canonicalRole, roleLabel } from "../utils/roles";
const initial = {
  displayName: "",
  username: "",
  email: "",
  password: "",
  role: "teacher",
};
export default function Admins() {
  const staffRequest = useRef(null);
  const { school } = useSchool();
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState(initial);
  const [selected, setSelected] = useState(null);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [workPage, setWorkPage] = useState(0);
  const cursorRef = useRef({});
  const [more, setMore] = useState({});
  const [inspect, setInspect] = useState(null);
  const [work, setWork] = useState({ exams: [], questions: [], events: [] });
  useEffect(() => {
    if (!inspect) return undefined;
    const fail = (e) => setBanner({ tone: "error", message: e.message });
    const stops = [
      ["exams", "exams", "createdBy"],
      ["questions", "questions", "createdBy"],
      ["events", "auditLogs", "workspaceUid"],
    ].map(([key, name, field]) => {
      if (workPage > 0 && !cursorRef.current[key]?.[workPage]) {
        setWork((w) => ({ ...w, [key]: [] }));
        setMore((m) => ({ ...m, [key]: false }));
        return () => {};
      }
      return onSnapshot(
        query(
          collection(db, name),
          where(field, "==", inspect.id),
          ...(key === "events"
            ? [orderBy("createdAtMs", "desc")]
            : [orderBy(documentId())]),
          ...(cursorRef.current[key]?.[workPage]
            ? [startAfter(cursorRef.current[key][workPage])]
            : []),
          limit(201),
        ),
        (rows) => {
          setMore((m) => ({ ...m, [key]: rows.docs.length > 200 }));
          const list = [...(cursorRef.current[key] || [])];
          list[workPage + 1] = rows.docs[199] || null;
          cursorRef.current[key] = list;
          setWork((current) => ({
            ...current,
            [key]: rows.docs
              .slice(0, 200)
              .map((d) => ({ id: d.id, ...d.data() })),
          }));
        },
        fail,
      );
    });
    return () => stops.forEach((stop) => stop());
  }, [inspect, workPage]);
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, "users"),
          // Retired role names are included so older accounts still appear.
          where("role", "in", [
            "admin",
            "superadmin",
            "teacher",
            "teacher_admin",
            "examofficer",
            "invigilator",
          ]),
        ),
        (s) => setStaff(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => setBanner({ tone: "error", message: e.message }),
      ),
    [],
  );
  async function run(action, input) {
    setBusy(true);
    try {
      await callApi(action, input);
      setBanner({ tone: "success", message: "Staff record saved." });
      return true;
    } catch (e) {
      setBanner({ tone: "error", message: e.message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ui-page">
      <StatusBanner {...banner} />
      <form
        className="ui-card space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          staffRequest.current ||= crypto.randomUUID();
          if (
            await run("staff.create", {
              ...form,
              requestId: staffRequest.current,
            })
          ) {
            staffRequest.current = null;
            setForm(initial);
          }
        }}
      >
        <h2 className="ui-page-heading">Staff access</h2>
        <p>
          Teacher admins register independently, verify their email and request
          approval. Their workspaces are private; only the superadmin has
          unrestricted question access. Teachers author their assigned papers.
          The superadmin reviews and publishes teacher papers. Examination
          officers publish their own papers, assign PINs and review results.
          Invigilators monitor and record interventions. Administrators manage
          school accounts and settings.
        </p>
        {["displayName", "username", "email", "password"].map((key) => (
          <label className="block" key={key}>
            {
              {
                displayName: "Full name",
                username: "Login username",
                email: "Contact email",
                password: "Temporary password",
              }[key]
            }
            <input
              required
              type={
                key === "password"
                  ? "password"
                  : key === "email"
                    ? "email"
                    : "text"
              }
              minLength={key === "password" ? 8 : undefined}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className="ui-field"
            />
          </label>
        ))}
        <label>
          Role
          <select
            className="ui-field"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy}
          className="ui-btn-primary"
        >
          Create staff account
        </button>
      </form>
      <section className="ui-card space-y-4">
        <h3 className="ui-section-heading">Staff register</h3>
        {staff.map((s) => (
          <article className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition hover:border-blue-200" key={s.id}>
            <strong>{s.displayName || s.email}</strong>
            <p>
              {s.username || s.email} ·{" "}
              {roleLabel(s.role)} ·{" "}
              {s.approvalStatus || "approved"}
            </p>
            <button
              disabled={s.role === "superadmin"}
              className="underline mr-4"
              onClick={async () => {
                const password = window.prompt(
                  "New temporary password (8+ characters)",
                );
                if (!password) return;
                const reason = window.prompt("Reason for staff password reset");
                if (reason)
                  await run("staff.password", { uid: s.id, password, reason });
              }}
            >
              Reset staff password
            </button>
            <button
              className="underline mr-4"
              onClick={() => {
                setWorkPage(0);
                cursorRef.current = {};
                setInspect(s);
                setWork({ exams: [], questions: [], events: [] });
              }}
            >
              Inspect work
            </button>
            {canonicalRole(s.role) === "teacher" && (
              <button
                className="underline"
                onClick={() =>
                  setSelected({
                    ...s,
                    classes: s.assignedClasses || [],
                    subjects: s.assignedSubjects || [],
                  })
                }
              >
                Review access / teaching assignments
              </button>
            )}
          </article>
        ))}
      </section>
      {selected && (
        <form
          className="bg-white p-6 rounded-2xl space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(
                selected.approvalStatus ? "teachers.review" : "staff.assign",
                {
                  uid: selected.id,
                  classes: selected.classes,
                  subjects: selected.subjects,
                  decision: selected.decision || "approve",
                  reason: selected.reason || "",
                },
              )
            )
              setSelected(null);
          }}
        >
          <h3>Teacher access — {selected.displayName}</h3>
          {selected.approvalStatus && (
            <>
              <label className="block">
                Decision
                <select
                  aria-label="Teacher access decision"
                  className="block border p-3"
                  value={selected.decision || "approve"}
                  onChange={(e) =>
                    setSelected({ ...selected, decision: e.target.value })
                  }
                >
                  <option value="approve">Approve / restore access</option>
                  <option value="reject">Reject application</option>
                  <option value="suspend">Suspend access</option>
                </select>
              </label>
              <label className="block">
                Reason
                <input
                  required
                  minLength={5}
                  maxLength={500}
                  className="block border p-3 w-full"
                  value={selected.reason || ""}
                  onChange={(e) =>
                    setSelected({ ...selected, reason: e.target.value })
                  }
                />
              </label>
              <p>
                Email verification and at least one class and subject are
                required for approval.
              </p>
            </>
          )}
          {["classes", "subjects"].map((key) => (
            <fieldset key={key}>
              <legend className="capitalize">{key}</legend>
              <div className="flex flex-wrap gap-4">
                {school?.[key].map((v) => (
                  <label key={v}>
                    <input
                      type="checkbox"
                      checked={selected[key].includes(v)}
                      onChange={(e) =>
                        setSelected({
                          ...selected,
                          [key]: e.target.checked
                            ? [...selected[key], v]
                            : selected[key].filter((x) => x !== v),
                        })
                      }
                    />{" "}
                    {v}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <button
            disabled={busy}
            className="ui-btn-primary"
          >
            Save teacher access
          </button>
          <button
            type="button"
            className="ml-4"
            onClick={() => setSelected(null)}
          >
            Cancel
          </button>
        </form>
      )}
      {inspect && (
        <section className="ui-card space-y-4">
          <h3 className="ui-page-heading">
            Work by {inspect.displayName || inspect.email}
          </h3>
          <p>
            {inspect.email} · Last sign-in:{" "}
            {inspect.lastLoginAt?.seconds
              ? new Date(inspect.lastLoginAt.seconds * 1000).toLocaleString()
              : "Not recorded"}
          </p>
          <p>
            Page {workPage + 1}, up to 200 records per list. Exams:{" "}
            {work.exams.length}; questions: {work.questions.length}.
          </p>
          <div className="flex gap-4">
            <button
              disabled={!workPage}
              onClick={() => setWorkPage((p) => p - 1)}
            >
              Previous work page
            </button>
            <button
              disabled={!Object.values(more).some(Boolean)}
              onClick={() => setWorkPage((p) => p + 1)}
            >
              Next work page
            </button>
          </div>
          <h4 className="font-semibold">Exams</h4>
          {work.exams.map((e) => (
            <p key={e.id}>
              {e.title} · {e.className} · {e.subject} · {e.status}
            </p>
          ))}
          <h4 className="font-semibold">Questions and answers</h4>
          {work.questions.map((q) => (
            <details key={q.id} className="border p-3 rounded-xl">
              <summary>{q.text}</summary>
              {q.image && (
                <img
                  src={q.image}
                  alt={q.imageAlt || "Question diagram"}
                  className="max-h-48"
                />
              )}
              {Object.entries(q.options || {}).map(([k, v]) => (
                <p key={k}>
                  {k}. {v}
                </p>
              ))}
              <p>
                Correct answer: {q.correctAnswer} · {q.marks} mark(s) · Paper:{" "}
                {q.examId}
              </p>
            </details>
          ))}
          <h4 className="font-semibold">Recent work and access history</h4>
          {work.events.map((e) => (
            <p key={e.id}>
              {new Date(e.createdAtMs).toLocaleString()} · {e.action} ·{" "}
              {e.target} · Actor: {e.actorUid}
            </p>
          ))}
          <button className="underline" onClick={() => setInspect(null)}>
            Close work view
          </button>
        </section>
      )}
    </div>
  );
}
