import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "/firebase";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "../utils/toast";

export default function StudentResults() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);

  useEffect(() => onSnapshot(
    query(
      collection(db, "examResults"),
      where("studentUid", "==", user.uid),
      where("released", "==", true),
    ),
    (snapshot) => setRows(snapshot.docs.map((record) => ({ id: record.id, ...record.data() }))),
    (error) => toast.error(error.message),
  ), [user.uid]);

  return (
    <div className="ui-page">
      <section className="ui-card border-t-4 border-t-yellow-300">
        <p className="ui-eyebrow">Student portal / Results</p>
        <h2 className="ui-page-heading mt-2">Your released results</h2>
        <p className="ui-subtitle">
          View your marks after the school releases each result. Unreleased or
          pending-review examinations are not shown here.
        </p>
        <span className="ui-pill mt-4">{rows.length} released {rows.length === 1 ? "result" : "results"}</span>
      </section>
      {rows.length === 0 ? (
        <div className="ui-empty">
          <p className="text-lg font-bold text-slate-800">No released results yet</p>
          <p className="mt-2">Once the school publishes your marks, they will appear here.</p>
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Released results">
          {rows.map((result) => {
            const validTotal = Number(result.maxMarks) > 0;
            const percentage = validTotal
              ? (Number(result.finalScore) / Number(result.maxMarks)) * 100
              : null;
            return (
              <article className="ui-card flex flex-col" key={result.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="ui-eyebrow">{result.subject || "Exam"}</p>
                  <span className="ui-pill border-emerald-200 bg-emerald-50 text-emerald-800">Released</span>
                </div>
                <h3 className="ui-section-heading mt-3">{result.examTitle}</h3>
                <p className="mt-2 text-sm text-slate-500">{result.academicSession} · {result.term} term</p>
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Your score</p>
                      <p className="mt-1 text-3xl font-extrabold tracking-tight text-blue-950">
                        {result.finalScore} <span className="text-lg font-medium text-slate-500">/ {result.maxMarks}</span>
                      </p>
                    </div>
                    <span className="text-lg font-bold text-blue-900">
                      {percentage === null ? "Pending valid total" : `${percentage.toFixed(1)}%`}
                    </span>
                  </div>
                  {percentage !== null && (
                    <div
                      aria-label={`${percentage.toFixed(1)} percent`}
                      className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
                    >
                      <div
                        className="h-full rounded-full bg-blue-800"
                        style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }}
                      />
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
