import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "/firebase";

export async function createExam({ title, duration }) {
  const ref = await addDoc(collection(db, "exams"), {
    title: title.trim(),
    duration: Number(duration) || 0,
    status: "draft",
    questionCount: 0,
    createdAt: serverTimestamp(),
    publishedAt: null,
  });

  return ref.id;
}

export async function updateExamStatus(examId, status) {
  const updates = {
    status,
    updatedAt: serverTimestamp(),
  };

  if (status === "published") {
    const questionCountSnapshot = await getCountFromServer(
      query(collection(db, "questions"), where("examId", "==", examId))
    );

    updates.publishedAt = serverTimestamp();
    updates.questionCount = questionCountSnapshot.data().count;
  }

  await updateDoc(doc(db, "exams", examId), updates);
}

export async function deleteExam(examId) {
  const questionsSnapshot = await getDocs(
    query(collection(db, "questions"), where("examId", "==", examId))
  );

  await Promise.all(questionsSnapshot.docs.map((item) => deleteDoc(item.ref)));
  await deleteDoc(doc(db, "exams", examId));
}

export async function addQuestion({
  examId,
  question,
  options,
  correctAnswer,
  marks = 1,
}) {
  const cleanOptions = {
    A: options?.A ?? "",
    B: options?.B ?? "",
    C: options?.C ?? "",
    D: options?.D ?? "",
  };

  await addDoc(collection(db, "questions"), {
    examId: String(examId).trim(),
    text: String(question).trim(),
    options: cleanOptions,
    correctAnswer: String(correctAnswer).trim().toUpperCase(),
    marks: Number(marks) || 1,
    type: "mcq",
    createdAt: serverTimestamp(),
  });

  const questionCountSnapshot = await getCountFromServer(
    query(collection(db, "questions"), where("examId", "==", examId))
  );

  await updateDoc(doc(db, "exams", examId), {
    questionCount: questionCountSnapshot.data().count,
    updatedAt: serverTimestamp(),
  });
}
