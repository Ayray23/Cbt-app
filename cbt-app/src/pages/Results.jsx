import { useState } from "react";
import { useRecords } from "../hooks/useRecords";
import RecordPager from "../components/RecordPager";
import { useSchool } from "../hooks/useSchool";
import { callApi } from "../services/api";
import { downloadCsv } from "../utils/csv";
import { percentage, subjectTotals } from "../utils/results";
import StatusBanner from "../components/StatusBanner";
import ModalShell from "../components/ModalShell";
export default function Results() {
  const { school } = useSchool();
  const [filters, setFilters] = useState({
    academicSession: "",
    term: "",
    className: "",
    subject: "",
  });
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState("");
  const [correctedScore, setCorrectedScore] = useState("");
  const records = useRecords(
    "examResults",
    Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => [k, "==", v]),
    100,
  );
  const results = records.rows;

  const filtered = results.filter((r) =>
    Object.entries(filters).every(([k, v]) => !v || r[k] === v),
  );
  const totals = records.more || records.page ? [] : subjectTotals(filtered);
  function manage(result, operation) {
    setDecision({ result, operation });
    setCorrectedScore(String(result.finalScore ?? ""));
    setReason("");
  }

  async function confirmDecision(event) {
    event.preventDefault();
    if (!decision || busy || !reason.trim()) return;
    const { result, operation } = decision;
    const input = { resultId: result.id, operation, reason: reason.trim() };
    if (operation === "correct") {
      const score = Number(correctedScore);
      if (!correctedScore.trim() || !Number.isFinite(score) ||
          score < 0 || score > Number(result.maxMarks)) {
        setBanner({ tone: "error", message: "Enter a valid corrected score within this paper's total marks." });
        return;
      }
      input.score = score;
    }
    setBusy(true);
    try {
      await callApi(operation === "review" ? "results.review" : "results.manage", input);
      setBanner({ tone: "success", message: "Result updated. Corrections require release again." });
      setDecision(null);
    } catch (error) {
      setBanner({ tone: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-page">
      <StatusBanner {...banner} />
      <section className="ui-card">
        <h2 className="ui-page-heading">
          {school?.name || "School"} — Results
        </h2>
        <p>{school?.address}</p>
        <p>
          Results remain private until released. Late submissions require
          review. Subject totals use the configured paper weights; missing or
          excess weight is not reported as a final mark.
        </p>
        <div className="grid md:grid-cols-4 gap-3 my-4 print:hidden">
          {Object.keys(filters).map((key) => (
            <label key={key}>
              {
                {
                  academicSession: "Academic session",
                  term: "Term",
                  className: "Class",
                  subject: "Subject",
                }[key]
              }
              <select
                className="ui-field"
                value={filters[key]}
                onChange={(e) =>
                  setFilters({ ...filters, [key]: e.target.value })
                }
              >
                <option value="">All</option>
                {[
                  ...new Set(
                    [
                      filters[key],
                      ...(key === "academicSession"
                        ? [school?.academicSession]
                        : key === "term"
                          ? ["First", "Second", "Third"]
                          : key === "className"
                            ? school?.classes || []
                            : school?.subjects || []),
                      ...results.map((r) => r[key]),
                    ].filter(Boolean),
                  ),
                ]
                  .sort()
                  .map((v) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 print:hidden">
          <button
            onClick={() =>
              downloadCsv("school-results.csv", [
                [
                  "Student",
                  "Username",
                  "Session",
                  "Term",
                  "Class",
                  "Subject",
                  "Paper",
                  "Score",
                  "Maximum",
                  "Percentage",
                  "Weight",
                  "Review required",
                  "Released",
                ],
                ...filtered.map((r) => [
                  r.studentName,
                  r.studentUsername,
                  r.academicSession,
                  r.term,
                  r.className,
                  r.subject,
                  r.examTitle,
                  r.finalScore,
                  r.maxMarks,
                  percentage(r)?.toFixed(2) ?? "",
                  r.weight,
                  Boolean(r.requiresReview),
                  Boolean(r.released),
                ]),
              ])
            }
            className="ui-btn-primary"
          >
            Download CSV for Excel
          </button>
          <button
            onClick={() => window.print()}
            className="ui-btn-secondary"
          >
            Print / Save PDF
          </button>
        </div>
      </section>
      <RecordPager records={records} />
      <p>
        Export and paper scores cover this page. Filter by session, term, class
        and subject to view a complete assessment group.
      </p>
      <section className="ui-card overflow-x-auto">
        <h3 className="ui-section-heading mb-3">
          Paper scores ({filtered.length})
        </h3>
        <table className="ui-table">
          <thead>
            <tr>
              {[
                "Student",
                "Paper / subject",
                "Session / term / class",
                "Score",
                "Percentage",
                "State",
                "Actions",
              ].map((t) => (
                <th className="p-3" key={t}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">
                  {r.studentName}
                  <br />
                  {r.studentUsername}
                </td>
                <td className="p-3">
                  {r.examTitle}
                  <br />
                  {r.subject}
                </td>
                <td className="p-3">
                  {r.academicSession || "Legacy"} · {r.term} · {r.className}
                </td>
                <td className="p-3">
                  {r.finalScore} / {r.maxMarks || "?"}
                </td>
                <td className="p-3">
                  {percentage(r)?.toFixed(1) ?? "Awaiting review"}
                  {percentage(r) !== null ? "%" : ""}
                </td>
                <td className="p-3">
                  {r.requiresReview
                    ? "Needs review"
                    : r.released
                      ? "Released"
                      : "Withheld"}
                </td>
                <td className="p-3 print:hidden">
                  <div className="flex flex-wrap gap-3">
                    {r.requiresReview && (
                      <button
                        type="button"
                        className="ui-btn-secondary"
                        disabled={busy}
                        onClick={() => manage(r, "review")}
                      >
                        Approve review
                      </button>
                    )}
                    <button
                      type="button"
                      className="ui-btn-secondary"
                      disabled={busy || r.requiresReview}
                      onClick={() =>
                        manage(r, r.released ? "withhold" : "release")
                      }
                    >
                      {r.released ? "Withhold" : "Release"}
                    </button>
                    <button
                      type="button"
                      className="ui-btn-secondary"
                      disabled={busy}
                      onClick={() => manage(r, "correct")}
                    >
                      Correct score
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="ui-card">
        <h3 className="ui-section-heading">Weighted subject totals</h3>
        <p className="text-sm my-3">
          Totals are shown only when the entire filtered group fits on the first
          page. Narrow the filters if totals are unavailable. CA and exam papers
          only. Each subject's assessment weights must add to 100%. Practice and
          mock scores are excluded. An incomplete total is not a zero.
        </p>
        {totals.map((t) => (
          <div key={t.key} className="border-t py-3">
            <strong>
              {t.studentName} · {t.subject}
            </strong>
            <p>
              {t.academicSession} · {t.term} · {t.className}
            </p>
            <p>
              {t.complete
                ? `${t.total.toFixed(1)} / 100 (${t.released ? "all components released" : "not fully released"})`
                : `Incomplete / needs review — recorded weight ${t.weight}%`}
            </p>
            {t.complete && (
              <p>
                {(school?.grades || []).find((g) => t.total >= g.min)?.label ||
                  "No grade scale configured"}{" "}
                ·{" "}
                {(school?.grades || []).find((g) => t.total >= g.min)?.remark ||
                  ""}
              </p>
            )}
          </div>
        ))}
      </section>
      <ModalShell
        open={Boolean(decision)}
        title={decision?.operation === "correct" ? "Correct examination score"
          : decision?.operation === "review" ? "Approve result review"
          : decision?.operation === "release" ? "Release student result" : "Withhold student result"}
        description={decision ? `${decision.result.studentName || "Student"} · ${decision.result.examTitle || "Exam"}. This change is recorded in the audit trail.` : ""}
        onClose={() => { if (!busy) setDecision(null); }}
      >
        {decision && (
          <form onSubmit={confirmDecision} className="space-y-4">
            {decision.operation === "correct" && (
              <label className="block text-sm font-semibold text-slate-700">
                Corrected score (0–{decision.result.maxMarks})
                <input
                  aria-label="Corrected score"
                  type="number" required min="0" max={decision.result.maxMarks}
                  step="any" value={correctedScore}
                  onChange={(event) => setCorrectedScore(event.target.value)}
                  className="ui-field"
                />
              </label>
            )}
            <label className="block text-sm font-semibold text-slate-700">
              Reason for this decision
              <textarea
                aria-label="Reason for decision"
                required maxLength={1000} rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Record a clear reason for the school audit trail"
                className="ui-field resize-y"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
              <button type="button" disabled={busy} className="ui-btn-secondary" onClick={() => setDecision(null)}>Cancel</button>
              <button type="submit" disabled={busy || !reason.trim()} className="ui-btn-primary">
                {busy ? "Saving…" : "Confirm decision"}
              </button>
            </div>
          </form>
        )}
      </ModalShell>
    </div>
  );
}
