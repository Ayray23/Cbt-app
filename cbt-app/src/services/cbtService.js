import { callApi } from "./api";

export async function createExam(input) {
  return (await callApi("exams.create", input)).id;
}

export async function updateExamStatus(examId, status) {
  if (status === "published") return callApi("exams.publish", { examId });
  return callApi("exams.draft", { examId });
}

export async function deleteExam(examId) {
  return callApi("exams.archive", { examId });
}

export async function addQuestion(input) {
  return callApi("questions.create", input);
}
