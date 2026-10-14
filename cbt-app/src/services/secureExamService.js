import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "/firebase";

function requireUser() {
  if (!auth.currentUser) throw new Error("Please sign in to continue.");
  return auth.currentUser;
}

function callableError(error, fallback) {
  const code = String(error?.code || "");
  if (code.includes("functions/not-found")) {
    return "The secure exam service is not deployed yet. Please ask the administrator to deploy the latest Firebase Functions before starting an exam.";
  }
  if (code.includes("functions/internal")) {
    return "The exam server returned an internal error while checking this code. Please try again. If it continues, deploy the latest Firebase Functions and check the Firebase function logs.";
  }
  if (code.includes("functions/unauthenticated")) return "Your login session has expired. Sign in again and retry.";
  if (code.includes("functions/permission-denied")) return error?.details || "This exam code is not valid for your student account.";
  if (code.includes("functions/failed-precondition")) return error?.details || error?.message || fallback;
  return error?.details || error?.message || fallback;
}

export async function startSecureExamSession(examId, accessCode = "") {
  requireUser();
  try {
    const startExam = httpsCallable(getFunctions(), "startExamSession");
    const result = await startExam({ examId, accessCode: String(accessCode || "").trim().toUpperCase() });
    return result.data;
  } catch (error) {
    console.error("Secure exam start failed", error);
    throw new Error(callableError(error, "Could not start the exam."));
  }
}

export async function submitSecureExamSession(examId, answers, metadata = {}) {
  requireUser();
  try {
    const submitExam = httpsCallable(getFunctions(), "submitExamSession");
    const result = await submitExam({
      examId,
      answers,
      submissionReason: metadata.submissionReason || "manual",
      tabSwitchCount: Number(metadata.tabSwitchCount || 0),
      integrityWarnings: Number(metadata.integrityWarnings || 0),
    });
    return result.data;
  } catch (error) {
    console.error("Secure exam submission failed", error);
    throw new Error(callableError(error, "Submission failed."));
  }
}
