import { useAuth } from "../contexts/AuthContext";
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "/firebase";
import { callApi } from "../services/api";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusBanner from "../components/StatusBanner";

export default function Questions() {
  const { role, user } = useAuth();
  const [targetExam, setTargetExam] = useState("");
  const [search, setSearch] = useState("");
  const [questions, setQuestions] = useState([]);
  const [examsById, setExamsById] = useState({});
  const [banner, setBanner] = useState(null);
  const [questionToDelete, setQuestionToDelete] = useState(null);

  useEffect(() => {
    const unsubscribeQuestions = onSnapshot(
      query(collection(db, "questions"), ...(role !== "superadmin" ? [where("createdBy", "==", user.uid)] : []), orderBy("createdAt", "desc")),
      (snapshot) => {
        setQuestions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
      }
    );

    const unsubscribeExams = onSnapshot(query(collection(db, "exams"), ...(role !== "superadmin" ? [where("createdBy", "==", user.uid)] : [])), (snapshot) => {
      const nextExams = {};
      snapshot.docs.forEach((docItem) => {
        nextExams[docItem.id] = docItem.data();
      });
      setExamsById(nextExams);
    });

    return () => {
      unsubscribeQuestions();
      unsubscribeExams();
    };
  }, [role, user.uid]);

  async function handleDelete() {
    if (!questionToDelete) {
      return;
    }
    try {
      const exam = await getDoc(doc(db, "exams", questionToDelete.examId));
      if (!exam.exists() || exam.data().status !== "draft") {
        throw new Error("Move the exam to draft before deleting a question, then publish the updated paper.");
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

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Question bank</h2>
        <p className="mt-2 text-sm text-slate-500">
          Review questions before publishing any exam. Every question is tied to a single exam.
        </p>
      </section>

      <section className="bg-white p-6 rounded-2xl space-y-3"><input placeholder="Search question bank" value={search} onChange={e => setSearch(e.target.value)} className="border p-3 rounded-xl w-full" /><label>Copy target (draft paper)<select value={targetExam} onChange={e => setTargetExam(e.target.value)} className="block border p-3 rounded-xl"><option value="">Select draft</option>{Object.entries(examsById).filter(([, e]) => e.status === 'draft').map(([id, e]) => <option value={id} key={id}>{e.title}</option>)}</select></label></section>
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
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
              {questions.filter(q => `${q.text} ${examsById[q.examId]?.title}`.toLowerCase().includes(search.toLowerCase())).map((question) => (
                <tr key={question.id} className="border-t border-slate-200">
                  <td className="px-4 py-4 text-slate-700">
                    <p className="whitespace-pre-wrap">{question.text ?? question.question ?? "-"}</p>{question.image && <img src={question.image} alt={question.imageAlt || 'Question diagram'} className="max-h-40" />}<details><summary>Preview options</summary>{Object.entries(question.options || {}).map(([k,v]) => <p key={k}>{k}. {v}</p>)}</details>
                  </td>
                  <td className="px-4 py-4 text-slate-500">
                    {examsById[question.examId]?.title ?? question.examId ?? "-"}
                  </td>
                  <td className="px-4 py-4 text-slate-500">{question.correctAnswer ?? "-"}</td>
                  <td className="px-4 py-4 text-slate-500">{question.marks ?? 1}</td>
                  <td className="px-4 py-4"><button disabled={!targetExam} className="mr-3 underline disabled:opacity-40" onClick={async () => { try { await callApi('questions.copy', { questionId: question.id, examId: targetExam }); setBanner({ tone: 'success', message: 'Question copied to draft paper.' }); } catch (e) { setBanner({ tone: 'error', message: e.message }); } }}>Copy to draft</button>
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
          <div className="p-8 text-sm text-slate-500">No questions added yet.</div>
        )}
      </section>

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
