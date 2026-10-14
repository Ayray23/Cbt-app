import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "/firebase";

function requireUser() {
  if (!auth.currentUser) throw new Error("Please sign in to continue.");
  return auth.currentUser;
}

function callableError(error, fallback) {
  return error?.details || error?.message || fallback;
}

/**
 * Starts or resumes an exam through the deployed Firebase callable backend.
 * The backend validates individual/shared codes and creates the session.
 */
export async function startSecureExamSession(examId, accessCode = "") {
  requireUser();
  try {
    const startExam = httpsCallable(getFunctions(), "startExamSession");
    const result = await startExam({ examId, accessCode });
    return result.data;
  } catch (error) {
    throw new Error(callableError(error, "Could not start the exam."));
  }
}

/**
 * Submits answers to the backend for authoritative grading.
 * The browser never calculates or writes the final score.
 */
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
    throw new Error(callableError(error, "Submission failed."));
  }
}
