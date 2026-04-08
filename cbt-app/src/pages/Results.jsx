import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "/firebase";
import StatusBanner from "../components/StatusBanner";

function formatSubmittedAt(timestamp) {
  if (!timestamp?.seconds) {
    return "-";
  }

  return new Date(timestamp.seconds * 1000).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function openPrintWindow(title, bodyMarkup) {
  const printWindow = window.open("", "_blank", "width=960,height=720");

  if (!printWindow) {
    throw new Error("Allow popups to print reports from the browser.");
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }
          h1, h2, h3 { margin: 0 0 12px; }
          p { margin: 0 0 8px; }
          .meta { color: #475569; margin-bottom: 20px; }
          .card { border: 1px solid #cbd5e1; border-radius: 16px; padding: 16px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
          th { background: #f8fafc; }
          .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
          .summary div { border: 1px solid #cbd5e1; border-radius: 14px; padding: 12px; }
          @media print {
            body { margin: 12px; }
          }
        </style>
      </head>
      <body>
        ${bodyMarkup}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function buildExcelTable(sessions) {
  const rows = sessions
    .map(
      (session) => `
        <tr>
          <td>${escapeHtml(session.studentName ?? session.studentEmail ?? session.studentUid)}</td>
          <td>${escapeHtml(session.studentEmail ?? "-")}</td>
          <td>${escapeHtml(session.examTitle ?? session.examId)}</td>
          <td>${escapeHtml(session.status ?? "-")}</td>
          <td>${escapeHtml(session.finalScore ?? session.totalAutoScore ?? 0)}</td>
          <td>${escapeHtml(session.submissionReason ?? "manual")}</td>
          <td>${escapeHtml(session.tabSwitchCount ?? 0)}</td>
          <td>${escapeHtml(formatSubmittedAt(session.submittedAt))}</td>
        </tr>
      `
    )
    .join("");

  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
      </head>
      <body>
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Email</th>
              <th>Exam</th>
              <th>Status</th>
              <th>Score</th>
              <th>Submission Reason</th>
              <th>Tab Warnings</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;
}

function buildStudentReportMarkup(session) {
  const studentName = session.studentName ?? session.studentEmail ?? session.studentUid;

  return `
    <h1>Student Exam Report</h1>
    <p class="meta">Prepared on ${escapeHtml(new Date().toLocaleString())}</p>
    <div class="summary">
      <div>
        <strong>Student</strong>
        <p>${escapeHtml(studentName)}</p>
      </div>
      <div>
        <strong>Exam</strong>
        <p>${escapeHtml(session.examTitle ?? session.examId)}</p>
      </div>
      <div>
        <strong>Score</strong>
        <p>${escapeHtml(session.finalScore ?? session.totalAutoScore ?? 0)}</p>
      </div>
    </div>

    <div class="card">
      <p><strong>Status:</strong> ${escapeHtml(session.status ?? "-")}</p>
      <p><strong>Email:</strong> ${escapeHtml(session.studentEmail ?? "-")}</p>
      <p><strong>Submitted:</strong> ${escapeHtml(formatSubmittedAt(session.submittedAt))}</p>
      <p><strong>Submission reason:</strong> ${escapeHtml(session.submissionReason ?? "manual")}</p>
      <p><strong>Tab warnings:</strong> ${escapeHtml(session.tabSwitchCount ?? 0)}</p>
    </div>
  `;
}

function buildResultsPdfMarkup(sessions) {
  const rows = sessions
    .map(
      (session) => `
        <tr>
          <td>${escapeHtml(session.studentName ?? session.studentEmail ?? session.studentUid)}</td>
          <td>${escapeHtml(session.studentEmail ?? "-")}</td>
          <td>${escapeHtml(session.examTitle ?? session.examId)}</td>
          <td>${escapeHtml(session.finalScore ?? session.totalAutoScore ?? 0)}</td>
          <td>${escapeHtml(session.submissionReason ?? "manual")}</td>
          <td>${escapeHtml(session.tabSwitchCount ?? 0)}</td>
          <td>${escapeHtml(formatSubmittedAt(session.submittedAt))}</td>
        </tr>
      `
    )
    .join("");

  return `
    <h1>Results Summary</h1>
    <p class="meta">Prepared on ${escapeHtml(new Date().toLocaleString())}</p>
    <div class="card">
      <p><strong>Total submitted sessions:</strong> ${escapeHtml(sessions.length)}</p>
      <p><strong>Export type:</strong> Printable PDF summary</p>
    </div>
    <table>
      <thead>
        <tr>
          <th>Student</th>
          <th>Email</th>
          <th>Exam</th>
          <th>Score</th>
          <th>Submission Reason</th>
          <th>Tab Warnings</th>
          <th>Submitted</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildReportCardMarkup(studentName, studentEmail, sessions) {
  const scores = sessions.map((session) => Number(session.finalScore ?? session.totalAutoScore ?? 0));
  const averageScore = scores.length
    ? (scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1)
    : "0.0";
  const bestSession = [...sessions].sort(
    (first, second) =>
      Number(second.finalScore ?? second.totalAutoScore ?? 0) -
      Number(first.finalScore ?? first.totalAutoScore ?? 0)
  )[0];

  const rows = sessions
    .map(
      (session) => `
        <tr>
          <td>${escapeHtml(session.examTitle ?? session.examId)}</td>
          <td>${escapeHtml(session.finalScore ?? session.totalAutoScore ?? 0)}</td>
          <td>${escapeHtml(session.status ?? "-")}</td>
          <td>${escapeHtml(formatSubmittedAt(session.submittedAt))}</td>
        </tr>
      `
    )
    .join("");

  return `
    <h1>Student Report Card</h1>
    <p class="meta">Prepared on ${escapeHtml(new Date().toLocaleString())}</p>
    <div class="summary">
      <div>
        <strong>Student</strong>
        <p>${escapeHtml(studentName)}</p>
      </div>
      <div>
        <strong>Email</strong>
        <p>${escapeHtml(studentEmail)}</p>
      </div>
      <div>
        <strong>Average Score</strong>
        <p>${escapeHtml(averageScore)}</p>
      </div>
    </div>

    <div class="card">
      <p><strong>Total papers taken:</strong> ${escapeHtml(sessions.length)}</p>
      <p><strong>Best subject:</strong> ${escapeHtml(bestSession?.examTitle ?? "-")}</p>
      <p><strong>Best score:</strong> ${escapeHtml(bestSession?.finalScore ?? bestSession?.totalAutoScore ?? 0)}</p>
    </div>

    <table>
      <thead>
        <tr>
          <th>Exam</th>
          <th>Score</th>
          <th>Status</th>
          <th>Submitted</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export default function Results() {
  const [sessions, setSessions] = useState([]);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    const sessionsQuery = query(collection(db, "examSessions"), orderBy("submittedAt", "desc"));

    return onSnapshot(sessionsQuery, (snapshot) => {
      setSessions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });
  }, []);

  const submittedSessions = useMemo(
    () => sessions.filter((session) => session.status === "submitted"),
    [sessions]
  );

  const groupedByStudent = useMemo(
    () =>
      submittedSessions.reduce((acc, session) => {
        const studentKey = session.studentUid || session.studentEmail || session.id;
        if (!acc[studentKey]) {
          acc[studentKey] = {
            studentName: session.studentName ?? session.studentEmail ?? session.studentUid,
            studentEmail: session.studentEmail ?? "-",
            sessions: [],
          };
        }
        acc[studentKey].sessions.push(session);
        return acc;
      }, {}),
    [submittedSessions]
  );

  const studentCards = Object.entries(groupedByStudent);

  function handleDownloadExcel() {
    if (submittedSessions.length === 0) {
      setBanner({ tone: "error", message: "There are no submitted results to download yet." });
      return;
    }

    downloadBlob(
      `cbt-results-${new Date().toISOString().slice(0, 10)}.xls`,
      buildExcelTable(submittedSessions),
      "application/vnd.ms-excel;charset=utf-8"
    );
    setBanner({ tone: "success", message: "Results download has started." });
  }

  function handlePrintStudentReport(session) {
    try {
      openPrintWindow(
        `Student Report - ${session.studentName ?? session.studentEmail ?? session.studentUid}`,
        buildStudentReportMarkup(session)
      );
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: error.message ?? "Could not open the print window." });
    }
  }

  function handlePrintReportCard(studentName, studentEmail, studentSessions) {
    try {
      openPrintWindow(
        `Report Card - ${studentName}`,
        buildReportCardMarkup(studentName, studentEmail, studentSessions)
      );
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: error.message ?? "Could not open the print window." });
    }
  }

  function handleDownloadPdf() {
    if (submittedSessions.length === 0) {
      setBanner({ tone: "error", message: "There are no submitted results to export yet." });
      return;
    }

    try {
      openPrintWindow(
        `Results PDF - ${new Date().toISOString().slice(0, 10)}`,
        buildResultsPdfMarkup(submittedSessions)
      );
      setBanner({
        tone: "success",
        message: "Print dialog opened. Choose 'Save as PDF' in your browser to download it.",
      });
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: error.message ?? "Could not open the PDF export view." });
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Live submissions</h2>
            <p className="mt-2 text-sm text-slate-500">
              Every submitted exam session is stored here with export and print tools for admin use.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleDownloadExcel}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white"
            >
              Download results as Excel
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white"
            >
              Download results as PDF
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Exam</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Report</th>
              </tr>
            </thead>
            <tbody>
              {submittedSessions.map((session) => (
                <tr key={session.id} className="border-t border-slate-200">
                  <td className="px-4 py-4 text-slate-700">
                    {session.studentName ?? session.studentEmail ?? session.studentUid}
                  </td>
                  <td className="px-4 py-4 text-slate-500">{session.examTitle ?? session.examId}</td>
                  <td className="px-4 py-4 text-slate-500">{session.status ?? "-"}</td>
                  <td className="px-4 py-4 text-slate-500">
                    {session.finalScore ?? session.totalAutoScore ?? 0}
                  </td>
                  <td className="px-4 py-4 text-slate-500">{formatSubmittedAt(session.submittedAt)}</td>
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      onClick={() => handlePrintStudentReport(session)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      Print report
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {submittedSessions.length === 0 && (
          <div className="p-8 text-sm text-slate-500">No submitted sessions yet.</div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h3 className="text-xl font-semibold text-slate-900">Report cards</h3>
        <p className="mt-2 text-sm text-slate-500">
          Print a combined report card for each student across all submitted exams.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {studentCards.map(([studentKey, student]) => {
            const averageScore = (
              student.sessions.reduce(
                (sum, session) => sum + Number(session.finalScore ?? session.totalAutoScore ?? 0),
                0
              ) / student.sessions.length
            ).toFixed(1);

            return (
              <article key={studentKey} className="rounded-2xl border border-slate-200 p-5">
                <h4 className="text-lg font-semibold text-slate-900">{student.studentName}</h4>
                <p className="mt-1 text-sm text-slate-500">{student.studentEmail}</p>
                <p className="mt-3 text-sm text-slate-600">
                  Papers taken: {student.sessions.length} | Average score: {averageScore}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    handlePrintReportCard(student.studentName, student.studentEmail, student.sessions)
                  }
                  className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
                >
                  Generate report card
                </button>
              </article>
            );
          })}
        </div>

        {studentCards.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            Report cards will appear here after students submit exams.
          </div>
        )}
      </section>
    </div>
  );
}
