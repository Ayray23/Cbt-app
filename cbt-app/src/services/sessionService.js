import { httpsCallable } from "firebase/functions";
import { functions } from "/firebase";

const startExamSessionCallable = httpsCallable(functions, "startExamSession");
const submitExamSessionCallable = httpsCallable(functions, "submitExamSession");
const setUserRoleCallable = httpsCallable(functions, "setUserRole");

export async function startExamSession(examId) {
  const response = await startExamSessionCallable({ examId });
  return response.data;
}

export async function submitExamSession(examId, answers) {
  const response = await submitExamSessionCallable({ examId, answers });
  return response.data;
}

export async function setUserRole(email, role) {
  const response = await setUserRoleCallable({ email, role });
  return response.data;
}
