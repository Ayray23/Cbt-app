import { useAuth } from "../contexts/AuthContext";
import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "/firebase";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusBanner from "../components/StatusBanner";
import {
  createExam,
  deleteExam,
  updateExamStatus,
} from "../services/cbtService";

import { useSchool } from "../hooks/useSchool";

export default function CreateExam() {
  const requestId = useRef(null);
  const { role, user, profile } = useAuth();
  const { school } = useSchool();
  const [academic, setAcademic] = useState({
    className: "",
    subject: "",
    category: "exam",
    weight: 100,
    allowCalculator: false,
    instructions: "",
    start: "",
    end: "",
  });
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [exams, setExams] = useState([]);
  const [banner, setBanner] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [examToDelete, setExamToDelete] = useState(null);

  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, "exams"),
          ...(role !== "superadmin"
            ? [where("createdBy", "==", user.uid)]
            : []),
          orderBy("createdAt", "desc"),
        ),
        (snapshot) =>
          setExams(
            snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
          ),
        () =>
          setBanner({
            tone: "error",
            message: "Could not load exams. Check your administrator access.",
          }),
      ),
    [role, user.uid],
  );

  async function create(event) {
    event.preventDefault();
    if (!title.trim() || Number(duration) < 1 || Number(duration) > 480) return;
    setCreating(true);
    try {
      requestId.current ||= crypto.randomUUID();
      await createExam({
        requestId: requestId.current,
        title,
        duration,
        ...academic,
        academicSession: school.academicSession,
        term: school.term,
        scheduleStartAtMs: academic.start
          ? new Date(`${academic.start}+01:00`).getTime()
          : 0,
        scheduleEndAtMs: academic.end
          ? new Date(`${academic.end}+01:00`).getTime()
          : 0,
      });
      requestId.current = null;
      setTitle("");
      setDuration("");
      setBanner({
        tone: "success",
        message:
          "Exam created. Add questions. The superadmin publishes teacher papers and assigns personal exam PINs.",
      });
    } catch (error) {
      setBanner({ tone: "error", message: error.message });
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(exam, status) {
    if (busyId) return;
    setBusyId(exam.id);
    try {
      await updateExamStatus(exam.id, status);
      setBanner({
        tone: "success",
        message:
          status === "published"
            ? "Exam published. Issue each student their own PIN from Exam PINs."
            : "Exam moved to draft. Existing attempts keep their original paper.",
      });
    } catch (error) {
      setBanner({ tone: "error", message: error.message });
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!examToDelete) return;
    setBusyId(examToDelete.id);
    try {
      await deleteExam(examToDelete.id);
      setBanner({
        tone: "success",
        message: "Exam archived. Papers, attempts and results are retained.",
      });
    } catch (error) {
      setBanner({ tone: "error", message: error.message });
    } finally {
      setExamToDelete(null);
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <StatusBanner {...banner} onClose={() => setBanner(null)} />
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">
          Exam workspace
        </h2>
        <p className="mt-3 text-sm text-slate-600">
          Publishing fixes the paper and answer key for new attempts. Use Exam
          PINs to assign each student their own access code.
        </p>
        <Link
          hidden={["teacher", "teacher_admin"].includes(role)}
          to="/exam-pins"
          className="mt-4 inline-block font-medium text-emerald-700 underline"
        >
          Manage personal exam PINs
        </Link>
      </section>
      {!school && (
        <Link to="/school" className="block bg-amber-50 p-4 rounded-xl">
          Complete School setup before creating an exam.
        </Link>
      )}
      <form
        onSubmit={create}
        className="grid gap-4 rounded-2xl bg-white p-6 shadow-sm md:grid-cols-2"
      >
        <input
          aria-label="Exam title"
          placeholder="Exam title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="rounded-xl border border-slate-300 px-4 py-3"
        />
        <input
          aria-label="Duration in minutes"
          type="number"
          min="1"
          max="480"
          required
          placeholder="Minutes"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          className="rounded-xl border border-slate-300 px-4 py-3"
        />
        <p className="md:col-span-2">
          {school?.academicSession} · {school?.term} term. Schedule times are
          Nigerian time (WAT).
        </p>
        {["className", "subject"].map((key) => (
          <label key={key}>
            {key === "className" ? "Class" : "Subject"}
            <select
              required
              value={academic[key]}
              onChange={(e) =>
                setAcademic({ ...academic, [key]: e.target.value })
              }
              className="w-full border rounded-xl p-3"
            >
              <option value="">Select</option>
              {(school?.[key === "className" ? "classes" : "subjects"] || [])
                .filter(
                  (v) =>
                    !["teacher", "teacher_admin"].includes(role) ||
                    (
                      profile?.[
                        key === "className"
                          ? "assignedClasses"
                          : "assignedSubjects"
                      ] || []
                    ).includes(v),
                )
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
          </label>
        ))}
        <label>
          Assessment
          <select
            value={academic.category}
            onChange={(e) =>
              setAcademic({ ...academic, category: e.target.value })
            }
            className="w-full border rounded-xl p-3"
          >
            {["ca", "exam", "practice", "mock"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Weight towards subject total (%)
          <input
            type="number"
            required
            min="1"
            max="100"
            value={academic.weight}
            onChange={(e) =>
              setAcademic({ ...academic, weight: Number(e.target.value) })
            }
            className="w-full border rounded-xl p-3"
          />
        </label>
        {["start", "end"].map((key) => (
          <label key={key}>
            Entry window {key} (optional, WAT)
            <input
              type="datetime-local"
              value={academic[key]}
              onChange={(e) =>
                setAcademic({ ...academic, [key]: e.target.value })
              }
              className="w-full border rounded-xl p-3"
            />
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={academic.allowCalculator}
            onChange={(e) =>
              setAcademic({ ...academic, allowCalculator: e.target.checked })
            }
          />{" "}
          Allow built-in calculator
        </label>
        <label className="md:col-span-2">
          Student instructions
          <textarea
            value={academic.instructions}
            onChange={(e) =>
              setAcademic({ ...academic, instructions: e.target.value })
            }
            className="w-full border rounded-xl p-3"
          />
        </label>
        <button
          disabled={creating || !school}
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm text-white disabled:opacity-60"
        >
          {creating ? "Creating..." : "Create exam"}
        </button>
      </form>
      {exams.map((exam) => (
        <article
          key={exam.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-6 shadow-sm"
        >
          <div>
            <h3 className="text-xl font-semibold">{exam.title}</h3>
            <p className="mt-2 text-sm text-slate-500">
              {exam.academicSession} · {exam.term} · {exam.className} ·{" "}
              {exam.subject} · {exam.duration} minutes |{" "}
              {exam.questionCount || 0} questions | {exam.status || "draft"}
            </p>
            {exam.status === "published" && !exam.paperVersion && (
              <p className="mt-2 text-sm text-amber-700">
                Republish this legacy exam to enable personal PINs and secure
                marking.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {!["teacher", "teacher_admin"].includes(role) &&
              exam.status === "published" && (
                <button
                  disabled={Boolean(busyId)}
                  onClick={() => changeStatus(exam, "draft")}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
                >
                  Move to draft
                </button>
              )}
            {!["teacher", "teacher_admin"].includes(role) &&
              (exam.status !== "published" || !exam.paperVersion) && (
                <button
                  disabled={Boolean(busyId)}
                  onClick={() => changeStatus(exam, "published")}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  {busyId === exam.id
                    ? "Publishing..."
                    : exam.status === "published"
                      ? "Republish securely"
                      : "Publish"}
                </button>
              )}
            <button
              hidden={["teacher", "teacher_admin"].includes(role)}
              disabled={Boolean(busyId)}
              onClick={() => setExamToDelete(exam)}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Archive
            </button>
          </div>
        </article>
      ))}
      {!exams.length && (
        <p className="rounded-2xl bg-white p-6 text-sm text-slate-500">
          No exams yet.
        </p>
      )}
      <ConfirmDialog
        open={Boolean(examToDelete)}
        title="Archive exam?"
        message="This closes the paper to new starts and preserves its questions, attempts and results. Resolve all active attempts first."
        confirmLabel="Archive exam"
        onConfirm={remove}
        onCancel={() => setExamToDelete(null)}
      />
    </div>
  );
}
