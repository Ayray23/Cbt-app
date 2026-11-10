import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "/firebase";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusBanner from "../components/StatusBanner";
import { createExam, deleteExam, updateExamStatus } from "../services/cbtService";

export default function CreateExam() {
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [exams, setExams] = useState([]);
  const [banner, setBanner] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [examToDelete, setExamToDelete] = useState(null);

  useEffect(() => onSnapshot(query(collection(db, "exams"), orderBy("createdAt", "desc")),
    (snapshot) => setExams(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    () => setBanner({ tone: "error", message: "Could not load exams. Check your administrator access." })), []);

  async function create(event) {
    event.preventDefault();
    if (!title.trim() || Number(duration) < 1 || Number(duration) > 480) return;
    setCreating(true);
    try {
      await createExam({ title, duration });
      setTitle(""); setDuration("");
      setBanner({ tone: "success", message: "Exam created. Add questions, publish it, then assign personal exam PINs." });
    } catch (error) { setBanner({ tone: "error", message: error.message }); }
    finally { setCreating(false); }
  }

  async function changeStatus(exam, status) {
    if (busyId) return;
    setBusyId(exam.id);
    try {
      await updateExamStatus(exam.id, status);
      setBanner({ tone: "success", message: status === "published"
        ? "Exam published. Issue each student their own PIN from Exam PINs."
        : "Exam moved to draft. Existing attempts keep their original paper." });
    } catch (error) { setBanner({ tone: "error", message: error.message }); }
    finally { setBusyId(null); }
  }

  async function remove() {
    if (!examToDelete) return;
    setBusyId(examToDelete.id);
    try { await deleteExam(examToDelete.id); setBanner({ tone: "success", message: "Exam deleted. Existing attempt records are retained." }); }
    catch (error) { setBanner({ tone: "error", message: error.message }); }
    finally { setExamToDelete(null); setBusyId(null); }
  }

  return <div className="space-y-6">
    <StatusBanner {...banner} onClose={() => setBanner(null)} />
    <section className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-slate-900">Create and publish exams</h2>
      <p className="mt-3 text-sm text-slate-600">Publishing fixes the paper and answer key for new attempts. Use Exam PINs to assign each student their own access code.</p>
      <Link to="/exam-pins" className="mt-4 inline-block font-medium text-emerald-700 underline">Manage personal exam PINs</Link>
    </section>
    <form onSubmit={create} className="grid gap-4 rounded-2xl bg-white p-6 shadow-sm md:grid-cols-[2fr_1fr_auto]">
      <input aria-label="Exam title" placeholder="Exam title" required value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-xl border border-slate-300 px-4 py-3" />
      <input aria-label="Duration in minutes" type="number" min="1" max="480" required placeholder="Minutes" value={duration} onChange={(event) => setDuration(event.target.value)} className="rounded-xl border border-slate-300 px-4 py-3" />
      <button disabled={creating} className="rounded-xl bg-slate-900 px-5 py-3 text-sm text-white disabled:opacity-60">{creating ? "Creating..." : "Create exam"}</button>
    </form>
    {exams.map((exam) => <article key={exam.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-6 shadow-sm">
      <div><h3 className="text-xl font-semibold">{exam.title}</h3>
        <p className="mt-2 text-sm text-slate-500">{exam.duration} minutes | {exam.questionCount || 0} questions | {exam.status || "draft"}</p>
        {exam.status === "published" && !exam.paperVersion && <p className="mt-2 text-sm text-amber-700">Republish this legacy exam to enable personal PINs and secure marking.</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        {exam.status === "published" && <button disabled={Boolean(busyId)} onClick={() => changeStatus(exam, "draft")} className="rounded-xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Move to draft</button>}
        {(exam.status !== "published" || !exam.paperVersion) && <button disabled={Boolean(busyId)} onClick={() => changeStatus(exam, "published")} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50">
          {busyId === exam.id ? "Publishing..." : exam.status === "published" ? "Republish securely" : "Publish"}
        </button>}
        <button disabled={Boolean(busyId)} onClick={() => setExamToDelete(exam)} className="rounded-xl bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50">Delete</button>
      </div>
    </article>)}
    {!exams.length && <p className="rounded-2xl bg-white p-6 text-sm text-slate-500">No exams yet.</p>}
    <ConfirmDialog open={Boolean(examToDelete)} title="Delete exam?" message="This removes the exam and its question bank. Existing attempts and results are retained." confirmLabel="Delete exam" onConfirm={remove} onCancel={() => setExamToDelete(null)} />
  </div>;
}
