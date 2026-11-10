import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getCountFromServer,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "/firebase";
import { callApi } from "./api";

export async function createExam({ title, duration }) {
  const ref = await addDoc(collection(db, "exams"), {
    title: title.trim(),
    duration: Number(duration) || 0,
    status: "draft",
    questionCount: 0,
    schemaVersion: 2,
    createdAt: serverTimestamp(),
    publishedAt: null,
  });

  return ref.id;
}

export async function updateExamStatus(examId, status) {
  if (status === "published") return callApi("exams.publish", { examId });
  const updates = {
    status,
    updatedAt: serverTimestamp(),
  };

  await updateDoc(doc(db, "exams", examId), updates);
}

export async function deleteExam(examId) {
  const questionsSnapshot = await getDocs(
    query(collection(db, "questions"), where("examId", "==", examId))
  );

  await Promise.all(questionsSnapshot.docs.map((item) => deleteDoc(item.ref)));
  await deleteDoc(doc(db, "examAccess", examId)).catch(() => null);
  await deleteDoc(doc(db, "exams", examId));
}

export async function addQuestion({
  examId,
  question,
  options,
  correctAnswer,
  marks = 1,
}) {
  const exam = await getDoc(doc(db, "exams", String(examId).trim()));
  if (!exam.exists() || exam.data().status !== "draft") {
    throw new Error("Move this exam to draft before changing its questions, then publish the updated paper.");
  }
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
