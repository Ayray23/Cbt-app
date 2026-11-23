import { useAuth } from "../contexts/AuthContext";
import { useEffect, useState, useRef } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { useRecords } from "../hooks/useRecords";
import RecordPager from "../components/RecordPager";
import { db } from "/firebase";
import { callApi } from "../services/api";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusBanner from "../components/StatusBanner";
import ModalShell from "../components/ModalShell";

export default function Questions() {
  const copies = useRef(new Map());
  const { role, user } = useAuth();
  const [targetExam, setTargetExam] = useState("");
  const [search, setSearch] = useState("");
  const records = useRecords(
    "questions",
    role === "superadmin" ? [] : [["createdBy", "==", user.uid]],
  );
  const questions = records.rows;
  const [editing, setEditing] = useState(null);
  const [examsById, setExamsById] = useState({});
  const [banner, setBanner] = useState(null);
  const [questionToDelete, setQuestionToDelete] = useState(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState("");
  const [clearingQuestions, setClearingQuestions] = useState(false);

  useEffect(() => {
    const unsubscribeExams = onSnapshot(
      query(
        collection(db, "exams"),
        ...(role !== "superadmin" ? [where("createdBy", "==", user.uid)] : []),
      ),
      (snapshot) => {
        const nextExams = {};
        snapshot.docs.forEach((docItem) => {
          nextExams[docItem.id] = docItem.data();
        });
        setExamsById(nextExams);
      },
    );

    return () => {
      unsubscribeExams();
    };
  }, [role, user.uid]);

  async function handleClearQuestions() {
    if (role !== "superadmin" || clearConfirmation !== "DELETE ALL QUESTIONS" || clearingQuestions) return;
    setClearingQuestions(true);
    try {
      const result = await callApi("questions.deleteAll", { confirmation: clearConfirmation });
      setShowClearDialog(false);
      setClearConfirmation("");
      setBanner({
        tone: "success",
        message: `Deleted ${result.deletedQuestions} questions and ${result.deletedPaperVersions} published paper snapshots. All exams were returned to draft.`,
      });
    } catch (error) {
      setBanner({ tone: "error", message: error.message || "Could not clear the question bank." });
      setShowClearDialog(false);
      setClearConfirmation("");
    } finally {
      setClearingQuestions(false);
    }
  }

  async function handleDelete() {
    if (!questionToDelete) {
      return;
    }
    try {
      const exam = await getDoc(doc(db, "exams", questionToDelete.examId));
      if (!exam.exists() || exam.data().status !== "draft") {
        throw new Error(
          "Move the exam to draft before deleting a question, then publish the updated paper.",
        );
      }
      await callApi("questions.delete", { questionId: questionToDelete.id });
      setBanner({ tone: "success", message: "Question deleted." });
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: error.message || "Delete failed." });
    } finally {
      setQuestionToDelete(null);
    }
  }

  return (
    <div className="space-y-6">
      <StatusBanner
        tone={banner?.tone}
        message={banner?.message}
        onClose={() => setBanner(null)}
      />

      <section className="ui-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h2 className="ui-page-heading">Question bank</h2>
          {role === "superadmin" && (
            <button
              type="button"
              onClick={() => { setClearConfirmation(""); setShowClearDialog(true); }}
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            >
              Delete all questions
            </button>
          )}
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Review questions before publishing any exam. Every question is tied to
          a single exam.
        </p>
      </section>

      <section className="ui-card space-y-3">
        <input
          placeholder="Search question bank"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ui-field"
        />
        <label>
          Copy target (draft paper)
          <select
            value={targetExam}
            onChange={(e) => setTargetExam(e.target.value)}
            className="ui-field"
          >
            <option value="">Select draft</option>
            {Object.entries(examsById)
              .filter(([, e]) => e.status === "draft")
              .map(([id, e]) => (
                <option value={id} key={id}>
                  {e.title}
                </option>
              ))}
          </select>
        </label>
      </section>
      <RecordPager records={records} />
      <p>Search applies to the current page.</p>
      {editing && (
        <ModalShell open title="Edit draft question" description="Update the question and answer options before publishing this exam." onClose={() => setEditing(null)} size="lg">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await callApi("questions.update", {
                ...editing,
                questionId: editing.id,
                question: editing.text,
              });
              setEditing(null);
            } catch (error) {
              setBanner({ tone: "error", message: error.message });
            }
          }}
        >
          <p className="ui-eyebrow">Question editor</p>
          <textarea
            aria-label="Question text"
            className="ui-field"
            required
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
          {["A", "B", "C", "D"].map((k) => (
            <label className="block" key={k}>
              Option {k}
              <textarea
                required
                value={editing.options[k]}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    options: { ...editing.options, [k]: e.target.value },
                  })
                }
              />
            </label>
          ))}
          <label>
            Correct answer
            <select
              value={editing.correctAnswer}
              onChange={(e) =>
                setEditing({ ...editing, correctAnswer: e.target.value })
              }
            >
              {["A", "B", "C", "D"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Marks
            <input
              required
              type="number"
              min="1"
              value={editing.marks}
              onChange={(e) =>
                setEditing({ ...editing, marks: Number(e.target.value) })
              }
            />
          </label>
          <button type="submit" className="ui-btn-primary">Save question changes</button>
          <button className="ui-btn-secondary ml-2" type="button" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
        </ModalShell>
      )}
      <section className="ui-card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Question</th>
                <th className="px-4 py-3">Exam</th>
                <th className="px-4 py-3">Answer</th>
                <th className="px-4 py-3">Marks</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {questions
                .filter((q) =>
                  `${q.text} ${examsById[q.examId]?.title}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((question) => (
                  <tr key={question.id} className="border-t border-slate-200">
                    <td className="px-4 py-4 text-slate-700">
                      <p className="whitespace-pre-wrap">
                        {question.text ?? question.question ?? "-"}
                      </p>
                      {question.image && (
                        <img
                          src={question.image}
                          alt={question.imageAlt || "Question diagram"}
                          className="max-h-40"
                        />
                      )}
                      <details>
                        <summary>Preview options</summary>
                        {Object.entries(question.options || {}).map(
                          ([k, v]) => (
                            <p key={k}>
                              {k}. {v}
                            </p>
                          ),
                        )}
                      </details>
                    </td>
                    <td className="px-4 py-4 text-slate-500">
                      {examsById[question.examId]?.title ??
                        question.examId ??
                        "-"}
                    </td>
                    <td className="px-4 py-4 text-slate-500">
                      {question.correctAnswer ?? "-"}
                    </td>
                    <td className="px-4 py-4 text-slate-500">
                      {question.marks ?? 1}
                    </td>
                    <td className="px-4 py-4">
                      <button
                        disabled={
                          examsById[question.examId]?.status !== "draft"
                        }
                        onClick={() =>
                          setEditing({
                            ...question,
                            text: question.text || question.question,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        disabled={!targetExam}
                        className="mr-3 underline disabled:opacity-40"
                        onClick={async () => {
                          try {
                            const key = `${question.id}:${targetExam}`;
                            if (!copies.current.has(key))
                              copies.current.set(key, crypto.randomUUID());
                            await callApi("questions.copy", {
                              questionId: question.id,
                              examId: targetExam,
                              requestId: copies.current.get(key),
                            });
                            copies.current.delete(key);
                            setBanner({
                              tone: "success",
                              message: "Question copied to draft paper.",
                            });
                          } catch (e) {
                            setBanner({ tone: "error", message: e.message });
                          }
                        }}
                      >
                        Copy to draft
                      </button>
                      <button
                        onClick={() => setQuestionToDelete(question)}
                        className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {questions.length === 0 && (
          <div className="p-8 text-sm text-slate-500">
            No questions added yet.
          </div>
        )}
      </section>

      {role === "superadmin" && (
        <ModalShell
          open={showClearDialog}
          title="Delete the entire question bank?"
          description="This action permanently removes all questions and published question snapshots from the database. Every exam will return to draft with zero questions. Existing results and user accounts are retained."
          onClose={() => { if (!clearingQuestions) { setShowClearDialog(false); setClearConfirmation(""); } }}
        >
          <div className="space-y-4">
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Do not continue while students are taking exams or have offline submissions to upload. This operation cannot be undone without a database backup.
            </p>
            <label className="block text-sm font-medium text-slate-700">
              Type <strong>DELETE ALL QUESTIONS</strong> to confirm
              <input
                className="ui-field mt-2"
                autoComplete="off"
                value={clearConfirmation}
                disabled={clearingQuestions}
                onChange={(event) => setClearConfirmation(event.target.value)}
                placeholder="DELETE ALL QUESTIONS"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="ui-btn-secondary"
                disabled={clearingQuestions}
                onClick={() => { setShowClearDialog(false); setClearConfirmation(""); }}
              >Cancel</button>
              <button
                type="button"
                onClick={handleClearQuestions}
                disabled={clearingQuestions || clearConfirmation !== "DELETE ALL QUESTIONS"}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >{clearingQuestions ? "Deleting..." : "Permanently delete all questions"}</button>
            </div>
          </div>
        </ModalShell>
      )}
      <ConfirmDialog
        open={Boolean(questionToDelete)}
        title="Delete question?"
        message="This question will be removed from the bank immediately."
        confirmLabel="Delete question"
        onConfirm={handleDelete}
        onCancel={() => setQuestionToDelete(null)}
      />
    </div>
  );
}
