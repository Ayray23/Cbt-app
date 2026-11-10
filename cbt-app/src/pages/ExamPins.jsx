import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "/firebase";
import { callApi } from "../services/api";
import StatusBanner from "../components/StatusBanner";

export default function ExamPins() {
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);
  const [examId, setExamId] = useState("");
  const [selected, setSelected] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    const failed = () => setBanner({ tone: "error", message: "Could not load exams or students. Check your administrator access." });
    const stops = [
      onSnapshot(collection(db, "exams"), (snapshot) => setExams(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), failed),
      onSnapshot(query(collection(db, "users"), where("role", "==", "student")),
        (snapshot) => setStudents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), failed),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);

  async function generate(event) {
    event.preventDefault();
    setBusy(true);
    setBanner(null);
    setResult(null);
    try {
      setResult(await callApi("exams.assign", { examId, studentIds: selected }));
      setBanner({ tone: "success", message: "Personal PINs created. Copy the PIN list now and give each student only their own PIN." });
    } catch (error) { setBanner({ tone: "error", message: error.message }); }
    finally { setBusy(false); }
  }

  async function copyPins() {
    try {
      await navigator.clipboard.writeText([result.examTitle, ...result.pins.map((entry) =>
        `${entry.name} | ${entry.username || entry.email} | ${entry.pin}`)].join("\n"));
      setBanner({ tone: "success", message: "PIN list copied. Keep it with your invigilators." });
    } catch { setBanner({ tone: "error", message: "Copy is unavailable. Select and copy the PINs from the table." }); }
  }

  return <div className="space-y-6">
    <StatusBanner {...banner} onClose={() => setBanner(null)} />
    <section className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-slate-900">Personal exam PINs</h2>
      <p className="mt-3 text-sm text-slate-600">Assign an exam to students and issue a separate PIN to each account. A student's PIN works only for that student and that exam.</p>
      <p className="mt-2 text-sm text-slate-500">PINs are shown once. You can regenerate a lost PIN before the student starts; PINs never reset a started or submitted attempt.</p>
      <form onSubmit={generate} className="mt-6 space-y-5">
        <label className="block text-sm font-medium text-slate-700">Exam
          <select required disabled={busy} value={examId} onChange={(event) => { setExamId(event.target.value); setResult(null); }}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3">
            <option value="">Select exam</option>
            {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title} ({exam.status})</option>)}
          </select>
        </label>
        <fieldset disabled={busy} className="space-y-3"><legend className="mb-3 text-sm font-medium text-slate-700">Students ({selected.length} selected, maximum 100)</legend>
          {students.map((student) => <label key={student.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm">
            <input type="checkbox" checked={selected.includes(student.id)} onChange={(event) => setSelected((current) =>
              event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id))} />
            <span>{student.displayName} <span className="text-slate-500">({student.username || student.email})</span></span>
          </label>)}
        </fieldset>
        <button disabled={busy || !examId || !selected.length || selected.length > 100}
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm text-white disabled:opacity-50">
          {busy ? "Generating PINs..." : "Assign exam and generate PINs"}
        </button>
      </form>
    </section>
    {result && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-semibold">{result.examTitle}</h3>
        <button onClick={copyPins} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm">Copy PIN list</button></div>
      <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>
        <th className="py-3 pr-4">Student</th><th className="pr-4">Username / email</th><th>Personal PIN</th>
      </tr></thead><tbody>{result.pins.map((entry) => <tr key={entry.studentUid} className="border-t border-amber-200">
        <td className="py-3 pr-4">{entry.name}</td><td className="pr-4">{entry.username || entry.email}</td>
        <td className="font-mono font-semibold tracking-widest">{entry.pin}</td>
      </tr>)}</tbody></table></div>
    </section>}
  </div>;
}
