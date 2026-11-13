import { useState } from "react";
import { useRecords } from "../hooks/useRecords";
import RecordPager from "../components/RecordPager";
import { useSchool } from "../hooks/useSchool";
import { callApi } from "../services/api";
import { downloadCsv } from "../utils/csv";
import { percentage, subjectTotals } from "../utils/results";
import StatusBanner from "../components/StatusBanner";
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
  async function manage(r, operation) {
    const reason = window.prompt("Reason for this result decision (required)");
    if (!reason) return;
    const input = { resultId: r.id, operation, reason };
    if (operation === "correct") {
      const value = window.prompt(
        `Corrected score, between 0 and ${r.maxMarks}`,
        r.finalScore,
      );
      if (value === null || value.trim() === "") return;
      input.score = Number(value);
    }
    setBusy(true);
    try {
      await callApi(
        operation === "review" ? "results.review" : "results.manage",
        input,
      );
      setBanner({
        tone: "success",
        message: "Result updated. Corrections require release again.",
      });
    } catch (e) {
      setBanner({ tone: "error", message: e.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <StatusBanner {...banner} />
      <section className="bg-white rounded-2xl p-6">
        <h2 className="text-2xl font-semibold">
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
                className="block border p-3 rounded-xl w-full"
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
        <div className="flex gap-4 print:hidden">
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
            className="bg-slate-900 text-white p-3 rounded-xl"
          >
            Download CSV for Excel
          </button>
          <button
            onClick={() => window.print()}
            className="border p-3 rounded-xl"
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
      <section className="bg-white rounded-2xl p-6 overflow-x-auto">
        <h3 className="text-xl font-semibold mb-3">
          Paper scores ({filtered.length})
        </h3>
        <table className="min-w-full text-sm text-left">
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
                        disabled={busy}
                        onClick={() => manage(r, "review")}
                      >
                        Approve review
                      </button>
                    )}
                    <button
                      disabled={busy || r.requiresReview}
                      onClick={() =>
                        manage(r, r.released ? "withhold" : "release")
                      }
                    >
                      {r.released ? "Withhold" : "Release"}
                    </button>
                    <button
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
      <section className="bg-white rounded-2xl p-6">
        <h3 className="text-xl font-semibold">Weighted subject totals</h3>
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
    </div>
  );
}
