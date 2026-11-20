import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import { downloadCsv } from "../utils/csv";
import {
  latestPinRosterExamId,
  mergePinRoster,
  readPinRosters,
  writePinRosters,
} from "../services/pinRosterStore";
import { db } from "/firebase";
import { callApi } from "../services/api";
import StatusBanner from "../components/StatusBanner";

export default function ExamPins() {
  const { user } = useAuth();
  const [rosters, setRosters] = useState(() => readPinRosters(user?.uid));
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);
  const [examId, setExamId] = useState(() => latestPinRosterExamId(readPinRosters(user?.uid)));
  const [selected, setSelected] = useState([]);
  const result = rosters[examId] || null;
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
    try {
      const created = await callApi("exams.assign", { examId, studentIds: selected });
      const merged = mergePinRoster(rosters, examId, created);
      setRosters(merged);
      setSelected([]);
      const retained = writePinRosters(user?.uid, merged);
      setBanner({
        tone: retained ? "success" : "info",
        message: retained
          ? "PINs generated and saved temporarily in this browser tab. You can change pages and return. Download or print a private copy for longer-term use."
          : "PINs generated, but this browser blocked temporary storage. Download or print the list now.",
      });
    } catch (error) { setBanner({ tone: "error", message: error.message }); }
    finally { setBusy(false); }
  }

  function downloadPins() {
    if (!result) return;
    const safeExam = result.examTitle.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").slice(0, 45) || "exam";
    downloadCsv(`exam-pins-${safeExam}.csv`, [
      ["Exam", "Student", "Username / email", "Personal PIN"],
      ...result.pins.map((entry) => [result.examTitle, entry.name, entry.username || entry.email, entry.pin]),
    ]);
    setBanner({ tone: "success", message: "Private PIN list downloaded. Store it securely and share individual PINs only with their assigned students." });
  }

  function forgetPins() {
    if (!result) return;
    const remaining = { ...rosters };
    delete remaining[examId];
    setRosters(remaining);
    writePinRosters(user?.uid, remaining);
    setBanner({
      tone: "info",
      message: "This PIN list was cleared from the browser. Students' assigned PINs remain valid; this does not cancel or regenerate them.",
    });
  }

  async function copyPins() {
    try {
      await navigator.clipboard.writeText([result.examTitle, ...result.pins.map((entry) =>
        `${entry.name} | ${entry.username || entry.email} | ${entry.pin}`)].join("\n"));
      setBanner({ tone: "success", message: "PIN list copied. Keep it with your invigilators." });
    } catch { setBanner({ tone: "error", message: "Copy is unavailable. Select and copy the PINs from the table." }); }
  }

  return <div className="ui-page">
    <StatusBanner {...banner} onClose={() => setBanner(null)} />
    <style>{`
      @media screen { .pin-print-sheet { display: none; } }
      @media print {
        @page { size: A4; margin: 12mm; }
        body:has(.pin-print-sheet) #root * { visibility: hidden !important; }
        body:has(.pin-print-sheet) #root .pin-print-sheet,
        body:has(.pin-print-sheet) #root .pin-print-sheet * { visibility: visible !important; }
        body:has(.pin-print-sheet) #root .pin-print-sheet {
          display: block !important; position: absolute !important; top: 0; left: 0;
          width: 100%; color: #111827; background: white;
        }
        .pin-print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; }
        .pin-print-slip { break-inside: avoid; page-break-inside: avoid; border: 1px solid #94a3b8; padding: 7mm; border-radius: 7px; }
      }
    `}</style>
    <section className="ui-card">
      <h2 className="ui-page-heading">Personal exam PINs</h2>
      <p className="mt-3 text-sm text-slate-600">Assign an exam to students and issue a separate PIN to each account. A student's PIN works only for that student and that exam.</p>
      <p className="mt-2 text-sm text-slate-500">
        PINs are stored as hashes on the server. A temporary readable copy is kept only
        in this browser tab for up to 8 hours, and is cleared when you sign out.
        Download or print a private copy to keep them longer. Regenerating a PIN replaces
        the old one for that student and exam and is allowed only before an attempt starts.
      </p>
      {Object.keys(rosters).length > 0 && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Saved in this browser tab: {Object.values(rosters).map((entry) => entry.examTitle).join(", ")}.
          Choose an exam below to reopen its latest PIN list.
        </p>
      )}
      <form onSubmit={generate} className="mt-6 space-y-5">
        <label className="block text-sm font-medium text-slate-700">Exam
          <select required disabled={busy} value={examId} onChange={(event) => { setExamId(event.target.value); setSelected([]); }}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3">
            <option value="">Select exam</option>
            {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title} ({exam.status})</option>)}
          </select>
        </label>
        <fieldset disabled={busy} className="space-y-3"><legend className="mb-3 text-sm font-medium text-slate-700">Students ({selected.length} selected, maximum 100)</legend>
          {students.filter(student => { const exam = exams.find(e => e.id === examId); return exam && !student.loginDisabled && (!exam.className || student.className === exam.className) && (!exam.academicSession || student.academicSession === exam.academicSession) && (!exam.subject || student.subjects?.includes(exam.subject)); }).map((student) => <label key={student.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm">
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
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyPins} className="ui-btn-secondary">Copy PIN list</button>
          <button type="button" onClick={downloadPins} className="ui-btn-secondary">Download PIN CSV</button>
          <button type="button" onClick={() => window.print()} className="ui-btn-secondary">Print individual PIN slips</button>
          <button type="button" onClick={forgetPins} className="ui-btn-secondary">Forget local PIN list</button>
        </div></div>
      <p className="mt-3 text-sm text-amber-900">
        {result.pins.length} student PIN(s) available in this browser session. Keep this list private;
        downloaded files are not encrypted. A PIN regenerated elsewhere may invalidate a previously saved copy.
      </p>
      <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>
        <th className="py-3 pr-4">Student</th><th className="pr-4">Username / email</th><th>Personal PIN</th>
      </tr></thead><tbody>{result.pins.map((entry) => <tr key={entry.studentUid} className="border-t border-amber-200">
        <td className="py-3 pr-4">{entry.name}</td><td className="pr-4">{entry.username || entry.email}</td>
        <td className="font-mono font-semibold tracking-widest">{entry.pin}</td>
      </tr>)}</tbody></table></div>
    </section>}
    {result && <section className="pin-print-sheet" aria-label="Printable individual exam PIN slips">
      <h1 className="mb-4 text-xl font-bold">{result.examTitle} — Candidate PIN slips</h1>
      <p className="mb-6 text-sm">Private access credentials · Distribute each slip only to its named candidate.</p>
      <div className="pin-print-grid">{result.pins.map((entry) => (
        <article key={entry.studentUid} className="pin-print-slip">
          <p className="text-xs font-bold uppercase tracking-widest">School CBT · Individual exam access</p>
          <h2 className="mt-3 text-lg font-bold">{result.examTitle}</h2>
          <p className="mt-4 text-sm">Student: <strong>{entry.name}</strong></p>
          <p className="mt-1 text-sm">Username: <strong>{entry.username || entry.email}</strong></p>
          <div className="mt-4 rounded border-2 border-slate-800 p-4 text-center">
            <p className="text-xs uppercase">Personal exam PIN</p>
            <p className="mt-2 break-all font-mono text-2xl font-bold tracking-widest">{entry.pin}</p>
          </div>
          <p className="mt-3 text-xs">One student. One examination. Keep this PIN private.</p>
        </article>
      ))}</div>
    </section>}
  </div>;
}
