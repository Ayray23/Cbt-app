import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, updateDoc, where, serverTimestamp } from "firebase/firestore";
import { db } from "/firebase";
import StatusBanner from "../components/StatusBanner";
import { generateStudentExamCodes } from "../services/cbtService";

export default function ExamCodes() {
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [printRecords, setPrintRecords] = useState([]);
  const [codeHashes, setCodeHashes] = useState([]);
  const [examId, setExamId] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, "users"), where("role", "==", "student")), (snapshot) => setStudents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (error) => setBanner({ tone: "error", message: error.message || "Could not load students." })),
      onSnapshot(query(collection(db, "exams"), orderBy("createdAt", "desc")), (snapshot) => {
        const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        setExams(next);
        setExamId((current) => current || next.find((exam) => exam.status === "published")?.id || next[0]?.id || "");
      }, (error) => setBanner({ tone: "error", message: error.message || "Could not load exams." })),
      onSnapshot(collection(db, "studentExamCodePrintRecords"), (snapshot) => setPrintRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (error) => setBanner({ tone: "error", message: error.message || "Could not load printable exam codes." })),
      onSnapshot(collection(db, "studentExamCodeHashes"), (snapshot) => setCodeHashes(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (error) => setBanner({ tone: "error", message: error.message || "Could not load exam-code statuses." })),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, []);

  const selectedExam = exams.find((exam) => exam.id === examId) || null;
  const hashById = useMemo(() => codeHashes.reduce((acc, item) => { acc[item.id] = item; return acc; }, {}), [codeHashes]);
  const examCodes = useMemo(() => printRecords.filter((code) => code.examId === examId).map((code) => ({ ...code, status: hashById[code.id]?.status || "revoked" })).sort((a, b) => String(a.studentName || "").localeCompare(String(b.studentName || ""))), [printRecords, hashById, examId]);
  const codeByStudent = useMemo(() => examCodes.reduce((acc, code) => { acc[code.studentUid] = code; return acc; }, {}), [examCodes]);
  const filteredStudents = useMemo(() => {
    const term = studentSearch.trim().toLowerCase();
    return students.filter((student) => {
      const searchText = [student.displayName, student.email, student.studentId, student.className].join(" ").toLowerCase();
      const matchesSearch = !term || searchText.includes(term);
      const code = codeByStudent[student.id];
      const matchesStatus = statusFilter === "all" || (statusFilter === "without" ? !code : code?.status === statusFilter);
      return matchesSearch && matchesStatus;
    }).sort((a, b) => String(a.displayName || a.email || "").localeCompare(String(b.displayName || b.email || "")));
  }, [students, studentSearch, statusFilter, codeByStudent]);

  const printableCodes = useMemo(() => examCodes.filter((code) => selectedIds.length === 0 || selectedIds.includes(code.studentUid)), [examCodes, selectedIds]);
  const visibleSelected = filteredStudents.length > 0 && filteredStudents.every((student) => selectedIds.includes(student.id));

  function toggleStudent(id, checked) {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }

  async function handleGenerate() {
    if (!selectedExam) {
      setBanner({ tone: "error", message: "Select an exam first." });
      return;
    }
    const targets = students.filter((student) => selectedIds.includes(student.id));
    if (!targets.length) {
      setBanner({ tone: "error", message: "Select one or more students before generating codes." });
      return;
    }
    setBusy(true);
    try {
      const generatedCodes = await generateStudentExamCodes(selectedExam, targets);

      // Update the visible admin table immediately instead of waiting for the
      // Firestore listeners. Otherwise, after reissuing codes, the print view
      // can briefly contain the previous plaintext code while Firestore already
      // stores the new hash, causing the printed code to be rejected.
      const generatedIds = new Set(generatedCodes.map((code) => code.id));
      setPrintRecords((current) => [
        ...current.filter((code) => !generatedIds.has(code.id)),
        ...generatedCodes,
      ]);
      setCodeHashes((current) => [
        ...current.filter((code) => !generatedIds.has(code.id)),
        ...generatedCodes.map(({ id, examId: generatedExamId, studentUid, status }) => ({
          id,
          examId: generatedExamId,
          studentUid,
          status,
        })),
      ]);
      setBanner({ tone: "success", message: `Generated individual ${selectedExam.title} codes for ${targets.length} student(s). The latest codes are ready to print. Previously issued codes for these students were replaced.` });
      setStatusFilter("all");
    } catch (error) {
      setBanner({ tone: "error", message: error.message || "Could not generate exam codes." });
    } finally {
      setBusy(false);
    }
  }

  async function revokeCode(code) {
    try {
      await updateDoc(doc(db, "studentExamCodeHashes", code.id), { status: "revoked", updatedAt: serverTimestamp() });
      setBanner({ tone: "success", message: `The code for ${code.studentName || "this student"} has been revoked.` });
    } catch (error) {
      setBanner({ tone: "error", message: error.message || "Could not revoke the code." });
    }
  }

  function printSlips() {
    if (!printableCodes.length) {
      setBanner({ tone: "error", message: "There are no generated codes to print for this selection." });
      return;
    }
    window.print();
  }

  return (
    <div className="space-y-6">
      <style>{`
        @media screen { .print-area { display: none; } }
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { display: block !important; position: absolute !important; left: 0; top: 0; width: 100%; padding: 0; background: #fff; color: #111827; }
          .print-grid { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8mm; }
          .print-slip { break-inside: avoid; page-break-inside: avoid; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8mm; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print">
        <StatusBanner tone={banner?.tone} message={banner?.message} onClose={() => setBanner(null)} />
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-950 p-6 text-white shadow-sm md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-300">Administration / Access control</p>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div><h2 className="text-3xl font-semibold tracking-tight">Exam codes & print slips</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-indigo-100/80">Issue a unique code to each student for a specific paper, track its status and print clean admission slips for distribution.</p></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><p className="text-xs text-indigo-100/70">Students</p><p className="mt-1 text-2xl font-semibold">{students.length}</p></div><div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><p className="text-xs text-indigo-100/70">Codes issued</p><p className="mt-1 text-2xl font-semibold">{examCodes.length}</p></div><div className="col-span-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:col-span-1"><p className="text-xs text-indigo-100/70">Unused codes</p><p className="mt-1 text-2xl font-semibold">{examCodes.filter((code) => code.status === "active").length}</p></div></div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(240px,1.5fr)]">
            <label className="text-sm font-semibold text-slate-700">Choose exam / subject<select value={examId} onChange={(event) => { setExamId(event.target.value); setSelectedIds([]); }} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"><option value="">Select exam</option>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title} {exam.status === "published" ? "· Published" : "· Draft"}</option>)}</select></label>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3"><p className="text-sm font-semibold text-indigo-950">{selectedExam?.title || "Select an exam"}</p><p className="mt-1 text-xs leading-5 text-indigo-800/80">{selectedExam ? `${selectedExam.duration || "—"} minutes · ${selectedExam.status || "draft"} · Codes are individual to each student` : "Choose an exam to prepare student-specific codes."}</p></div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative min-w-0 flex-1"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search student name, email, ID or class…" className="w-full rounded-xl border border-slate-200 py-3 pl-9 pr-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50" /></div>
            <div className="flex flex-wrap gap-2"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="all">All code statuses</option><option value="without">No code yet</option><option value="active">Unused</option><option value="used">Used</option><option value="revoked">Revoked</option></select><button type="button" onClick={handleGenerate} disabled={busy || !selectedExam} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Generating…" : "Generate / reissue codes"}</button><button type="button" onClick={printSlips} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><span aria-hidden="true">▤</span>Print slips{selectedIds.length ? ` (${printableCodes.length})` : ""}</button></div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">Select students below and generate codes. Reissuing a code replaces the previous code. Printing with students selected prints only their generated slips; with no students selected, it prints every generated slip for this exam.</p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h3 className="font-semibold text-slate-900">Student code assignments</h3><p className="mt-1 text-xs text-slate-500">{filteredStudents.length} students match your filters</p></div><button type="button" onClick={() => setSelectedIds(visibleSelected ? [] : filteredStudents.map((student) => student.id))} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">{visibleSelected ? "Clear visible selection" : "Select visible students"}</button></div>
          <div className="overflow-x-auto"><table className="min-w-[900px] w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="w-12 px-4 py-3"><input type="checkbox" aria-label="Select all filtered students" checked={visibleSelected} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, ...filteredStudents.map((student) => student.id)])] : current.filter((id) => !filteredStudents.some((student) => student.id === id)))} /></th><th className="px-4 py-3">Student</th><th className="px-4 py-3">Class / ID</th><th className="px-4 py-3">Individual code</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredStudents.map((student) => { const code = codeByStudent[student.id]; return <tr key={student.id} className="hover:bg-slate-50/70"><td className="px-4 py-4"><input type="checkbox" aria-label={`Select ${student.displayName || student.email}`} checked={selectedIds.includes(student.id)} onChange={(event) => toggleStudent(student.id, event.target.checked)} /></td><td className="px-4 py-4"><p className="font-semibold text-slate-900">{student.displayName || "Unnamed student"}</p><p className="mt-1 text-xs text-slate-500">{student.email || "No email"}</p></td><td className="px-4 py-4 text-slate-600">{student.className || "—"}<p className="mt-1 text-xs text-slate-400">{student.studentId || "No student ID"}</p></td><td className="px-4 py-4 font-mono font-semibold tracking-[0.14em] text-slate-800">{code?.code || <span className="font-sans font-normal tracking-normal text-slate-400">Not generated</span>}</td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${!code ? "bg-slate-100 text-slate-500" : code.status === "active" ? "bg-emerald-50 text-emerald-700" : code.status === "used" ? "bg-indigo-50 text-indigo-700" : "bg-rose-50 text-rose-700"}`}>{!code ? "No code" : code.status === "active" ? "Unused" : code.status === "used" ? "Used" : "Revoked"}</span></td><td className="px-4 py-4">{code && code.status !== "revoked" && code.status !== "used" ? <button type="button" onClick={() => revokeCode(code)} className="rounded-lg border border-rose-100 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Revoke</button> : code?.status === "used" ? <span className="text-xs text-slate-400">Attempt started</span> : <span className="text-xs text-slate-400">—</span>}</td></tr>; })}</tbody></table></div>
          {filteredStudents.length === 0 && <div className="p-10 text-center text-sm text-slate-500">No students match these filters.</div>}
        </section>
      </div>

      <section className="print-area" aria-label="Printable exam slips">
        <div className="mb-6"><h1 className="text-2xl font-bold">{selectedExam?.title || "Examination"}</h1><p className="mt-1 text-sm">Student examination access slips · {new Date().toLocaleDateString()}</p></div>
        <div className="print-grid">{printableCodes.map((code) => <article key={code.id} className="print-slip"><div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">Candidate examination slip</p><h2 className="mt-1 text-lg font-bold">{code.examTitle || selectedExam?.title}</h2></div><div className="rounded border border-slate-300 px-2 py-1 text-[10px] font-semibold">CBT</div></div><div className="mt-4 space-y-2 text-sm"><p><span className="text-slate-500">Student name</span><br /><strong>{code.studentName || "Student"}</strong></p><p><span className="text-slate-500">Student ID</span><br /><strong>{code.studentId || "—"}</strong></p><p><span className="text-slate-500">Class / Level</span><br /><strong>{code.className || "—"}</strong></p><p><span className="text-slate-500">Subject / Exam</span><br /><strong>{code.examTitle || selectedExam?.title}</strong></p></div><div className="mt-5 rounded-lg border-2 border-slate-800 bg-slate-50 px-3 py-4 text-center"><p className="text-[9px] font-bold uppercase tracking-[0.25em] text-slate-500">Personal exam code</p><p className="mt-2 break-all font-mono text-2xl font-bold tracking-[0.16em]">{code.code}</p></div><p className="mt-4 text-[10px] leading-4 text-slate-500">Keep this code private. It is assigned to the named student and the exam shown above. Contact the administrator if the code is lost or does not work.</p></article>)}</div>
      </section>
    </div>
  );
}
