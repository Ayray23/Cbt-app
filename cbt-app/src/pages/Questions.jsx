import { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "/firebase";

export default function Questions() {
  const [questions, setQuestions] = useState([]);
  const [examsById, setExamsById] = useState({});

  useEffect(() => {
    const unsubscribeQuestions = onSnapshot(
      query(collection(db, "questions"), orderBy("createdAt", "desc")),
      (snapshot) => {
        setQuestions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
      }
    );

    const unsubscribeExams = onSnapshot(collection(db, "exams"), (snapshot) => {
      const nextExams = {};
      snapshot.docs.forEach((docItem) => {
        nextExams[docItem.id] = docItem.data().title;
      });
      setExamsById(nextExams);
    });

    return () => {
      unsubscribeQuestions();
      unsubscribeExams();
    };
  }, []);

  async function handleDelete(questionId) {
    if (!window.confirm("Delete this question?")) {
      return;
    }

    try {
      await deleteDoc(doc(db, "questions", questionId));
    } catch (error) {
      console.error(error);
      alert("Delete failed.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Question bank</h2>
        <p className="mt-2 text-sm text-slate-500">
          Review questions before publishing any exam. Every question is tied to a single exam.
        </p>
      </section>

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
              {questions.map((question) => (
                <tr key={question.id} className="border-t border-slate-200">
                  <td className="px-4 py-4 text-slate-700">
                    {question.text ?? question.question ?? "-"}
                  </td>
                  <td className="px-4 py-4 text-slate-500">
                    {examsById[question.examId] ?? question.examId ?? "-"}
                  </td>
                  <td className="px-4 py-4 text-slate-500">{question.correctAnswer ?? "-"}</td>
                  <td className="px-4 py-4 text-slate-500">{question.marks ?? 1}</td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => handleDelete(question.id)}
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
    </div>
  );
}
