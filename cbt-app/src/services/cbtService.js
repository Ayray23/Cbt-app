import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "/firebase";
import { callApi } from "./api";

export async function createExam(input) {
  return (await callApi("exams.create", input)).id;
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
  return callApi("exams.archive", { examId });
}

export async function addQuestion({
  examId,
  question,
  options,
  correctAnswer,
  marks = 1,
  image = "",
  imageAlt = "",
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
    image, imageAlt, createdBy: auth.currentUser.uid,
    type: "mcq",
    createdAt: serverTimestamp(),
  });

}
