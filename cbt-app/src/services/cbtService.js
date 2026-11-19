import {
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "/firebase";
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

export async function addQuestion(input) {
  return callApi("questions.create", input);
}
