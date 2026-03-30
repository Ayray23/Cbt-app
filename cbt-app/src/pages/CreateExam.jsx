import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "/firebase";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusBanner from "../components/StatusBanner";
import { createExam, deleteExam, updateExamStatus } from "../services/cbtService";

export default function CreateExam() {
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [loading, setLoading] = useState(false);
  const [exams, setExams] = useState([]);
  const [banner, setBanner] = useState(null);
  const [examToDelete, setExamToDelete] = useState(null);

  useEffect(() => {
    const examsQuery = query(collection(db, "exams"), orderBy("createdAt", "desc"));

    return onSnapshot(examsQuery, (snapshot) => {
      setExams(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!title.trim() || !duration) {
      setBanner({ tone: "error", message: "Enter an exam title and duration." });
      return;
    }

    setLoading(true);

    try {
      await createExam({ title, duration });
      setTitle("");
      setDuration("");
      setBanner({ tone: "success", message: "Exam created successfully." });
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: "Could not create exam." });
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(examId, status) {
    try {
      await updateExamStatus(examId, status);
      setBanner({
        tone: "success",
        message: status === "published" ? "Exam published." : "Exam moved back to draft.",
      });
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: error.message ?? "Could not update exam status." });
    }
  }

  async function handleDelete() {
    if (!examToDelete) {
      return;
    }
    try {
      await deleteExam(examToDelete.id);
      setBanner({ tone: "success", message: "Exam deleted." });
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: "Could not delete exam." });
    } finally {
      setExamToDelete(null);
    }
  }

  return (
    <div className="space-y-6">
      <StatusBanner
        tone={banner?.tone}
        message={banner?.message}
        onClose={() => setBanner(null)}
      />

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Create and publish exams</h2>
        <p className="mt-2 text-sm text-slate-500">
          Keep exams in draft until the question bank is complete. Publishing makes them visible
          in the student portal immediately.
        </p>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-[2fr_1fr_auto]">
          <input
            type="text"
            placeholder="Midterm Mathematics"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-3"
          />

          <input
            type="number"
            min="1"
            placeholder="Duration (minutes)"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-3"
          />

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create exam"}
          </button>
        </form>
      </section>

      <section className="grid gap-4">
        {exams.map((exam) => (
          <article key={exam.id} className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{exam.title}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {exam.duration} minutes • {exam.questionCount ?? 0} question(s)
                </p>
                <p className="mt-1 text-sm text-slate-500">Status: {exam.status ?? "draft"}</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => handleStatusChange(exam.id, "draft")}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Move to draft
                </button>

                <button
                  onClick={() => handleStatusChange(exam.id, "published")}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
                >
                  Publish
                </button>

                <button
                  onClick={() => setExamToDelete(exam)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          </article>
        ))}

        {exams.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
            No exams created yet.
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(examToDelete)}
        title="Delete exam?"
        message="This will remove the exam and all its questions. This action cannot be undone."
        confirmLabel="Delete exam"
        onConfirm={handleDelete}
        onCancel={() => setExamToDelete(null)}
      />
    </div>
  );
}
