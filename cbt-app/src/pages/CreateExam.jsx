import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "/firebase";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusBanner from "../components/StatusBanner";
import { createExam, deleteExam, setExamAccessCode, updateExamStatus } from "../services/cbtService";
import { migrateLegacyExamAccess } from "../services/secureExamService";

export default function CreateExam() {
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [exams, setExams] = useState([]);
  const [banner, setBanner] = useState(null);
  const [examToDelete, setExamToDelete] = useState(null);
  const [publishingExamId, setPublishingExamId] = useState(null);
  const [accessCodesByExam, setAccessCodesByExam] = useState({});
  const [publishExam, setPublishExam] = useState(null);
  const [publishPassword, setPublishPassword] = useState("");
  const [publishPasswordConfirm, setPublishPasswordConfirm] = useState("");

  useEffect(() => {
    const examsQuery = query(collection(db, "exams"), orderBy("createdAt", "desc"));
    const accessQuery = query(collection(db, "examAccess"));
    const unsubscribeExams = onSnapshot(examsQuery, (snapshot) => setExams(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }))));
    const unsubscribeAccess = onSnapshot(accessQuery, (snapshot) => setAccessCodesByExam(snapshot.docs.reduce((acc, docItem) => {
      const record = docItem.data();
      acc[docItem.id] = Boolean(record.codeHash || record.code);
      return acc;
    }, {})));

    // Migrate legacy password hashes/plaintext from records that were previously
    // readable by signed-in students. The callable only permits administrators.
    migrateLegacyExamAccess().then(({ migratedCount, removedLegacyFields }) => {
      if (removedLegacyFields > 0) {
        setBanner({ tone: "success", message: `Secured ${migratedCount} legacy exam password record(s) and removed ${removedLegacyFields} exposed legacy field(s).` });
      }
    }).catch((error) => {
      console.error("Legacy exam password migration failed", error);
      setBanner({ tone: "error", message: "Could not secure legacy exam passwords. Confirm the latest Firebase Functions are deployed, then reopen this page." });
    });

    return () => { unsubscribeExams(); unsubscribeAccess(); };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!title.trim() || !duration) { setBanner({ tone: "error", message: "Enter an exam title and duration." }); return; }
    setLoading(true);
    try {
      await createExam({ title, duration, startAt, endAt });
      setTitle(""); setDuration(""); setStartAt(""); setEndAt("");
      setBanner({ tone: "success", message: "Exam created successfully." });
    } catch (error) { setBanner({ tone: "error", message: error.message ?? "Could not create exam." }); }
    finally { setLoading(false); }
  }

  async function handleStatusChange(examId, status) {
    if (status === "published") setPublishingExamId(examId);
    try { await updateExamStatus(examId, status); setBanner({ tone: "success", message: status === "published" ? "Exam published." : "Exam moved back to draft." }); }
    catch (error) { setBanner({ tone: "error", message: error.message ?? "Could not update exam status." }); }
    finally { if (status === "published") setPublishingExamId(null); }
  }

  async function handleDelete() {
    if (!examToDelete) return;
    try { await deleteExam(examToDelete.id); setBanner({ tone: "success", message: "Exam deleted." }); }
    catch (error) { setBanner({ tone: "error", message: error.message ?? "Could not delete exam." }); }
    finally { setExamToDelete(null); }
  }

  async function handlePublishExam() {
    if (!publishExam) return;
    try {
      if (!publishPassword.trim() || !publishPasswordConfirm.trim()) throw new Error("Enter and confirm the exam password before publishing.");
      if (publishPassword.trim().toUpperCase() !== publishPasswordConfirm.trim().toUpperCase()) throw new Error("The exam passwords do not match.");
      setPublishingExamId(publishExam.id);
      await setExamAccessCode(publishExam.id, publishPassword);
      await updateExamStatus(publishExam.id, "published");
      setBanner({ tone: "success", message: "Exam published. Its password is stored securely and will not be displayed again." });
      setPublishExam(null); setPublishPassword(""); setPublishPasswordConfirm("");
    } catch (error) { setBanner({ tone: "error", message: error.message ?? "Could not publish exam." }); }
    finally { setPublishingExamId(null); }
  }

  function formatSchedule(exam) {
    if (!exam.scheduleStartAtMs && !exam.scheduleEndAtMs) return "Open schedule: no time window set";
    const start = exam.scheduleStartAtMs ? new Date(exam.scheduleStartAtMs).toLocaleString() : "Now";
    const end = exam.scheduleEndAtMs ? new Date(exam.scheduleEndAtMs).toLocaleString() : "No end time";
    return `${start} → ${end}`;
  }

  return (
    <div className="space-y-6">
      <StatusBanner tone={banner?.tone} message={banner?.message} onClose={() => setBanner(null)} />
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Create and publish exams</h2>
        <p className="mt-2 text-sm text-slate-500">Keep exams in draft until the question bank is complete. Add an optional time window so students can only enter during the scheduled examination period.</p>
      </section>
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <input type="text" placeholder="Midterm Mathematics" value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-xl border border-slate-300 px-4 py-3" />
          <input type="number" min="1" placeholder="Duration (minutes)" value={duration} onChange={(event) => setDuration(event.target.value)} className="rounded-xl border border-slate-300 px-4 py-3" />
          <label className="text-xs font-medium text-slate-500">Start<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900" /></label>
          <label className="text-xs font-medium text-slate-500">End<input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900" /></label>
          <button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">{loading ? "Creating..." : "Create exam"}</button>
        </form>
      </section>
      <section className="grid gap-4">
        {exams.map((exam) => (
          <article key={exam.id} className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{exam.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{exam.duration} minutes | {exam.questionCount ?? 0} question(s)</p>
                <p className="mt-1 text-sm text-slate-500">Status: {exam.status ?? "draft"}</p>
                <p className="mt-1 text-sm text-slate-500">Schedule: {formatSchedule(exam)}</p>
                <p className="mt-1 text-sm text-slate-500">Password: {accessCodesByExam[exam.id] ? "Configured" : "Not configured"}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => handleStatusChange(exam.id, "draft")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Move to draft</button>
                {exam.status !== "published" && <button onClick={() => { setPublishExam(exam); setPublishPassword(""); setPublishPasswordConfirm(""); }} disabled={publishingExamId === exam.id} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{publishingExamId === exam.id ? "Publishing..." : "Publish"}</button>}
                <button onClick={() => setExamToDelete(exam)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white">Delete</button>
              </div>
            </div>
          </article>
        ))}
        {exams.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">No exams created yet.</div>}
      </section>
      <ConfirmDialog open={Boolean(examToDelete)} title="Delete exam?" message="This will remove the exam and all its questions. This action cannot be undone." confirmLabel="Delete exam" onConfirm={handleDelete} onCancel={() => setExamToDelete(null)} />
      {publishExam && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><h3 className="text-xl font-semibold text-slate-900">Publish {publishExam.title}</h3><p className="mt-3 text-sm text-slate-600">Enter the exam password for this subject. Students will need this exact password before they can start the exam. The password will not be stored in readable form.</p><div className="mt-5 space-y-4"><div><label className="block text-sm font-medium text-slate-700">Exam password</label><input type="password" value={publishPassword} onChange={(event) => setPublishPassword(event.target.value)} placeholder="Enter exam password" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 uppercase tracking-[0.2em]" /></div><div><label className="block text-sm font-medium text-slate-700">Confirm exam password</label><input type="password" value={publishPasswordConfirm} onChange={(event) => setPublishPasswordConfirm(event.target.value)} placeholder="Re-enter the same password" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 uppercase tracking-[0.2em]" /></div></div><div className="mt-6 flex justify-end gap-3"><button onClick={() => { setPublishExam(null); setPublishPassword(""); setPublishPasswordConfirm(""); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button><button onClick={handlePublishExam} disabled={publishingExamId === publishExam.id} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{publishingExamId === publishExam.id ? "Publishing..." : "Save password and publish"}</button></div></div></div>}
    </div>
  );
}
