import { auth } from "/firebase";

import { requestTimeoutMs } from "./apiTimeout.mjs";

export async function callApi(action, input = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in to continue.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs(action));
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/cbt", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...input, action }), signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      const error = new Error(body?.error || "The exam service is unavailable. Contact your administrator.");
      error.status = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        action === "exams.assign"
          ? "PIN generation is taking too long. The server may already have assigned PINs. Do not immediately retry; first check existing assignments with the administrator."
          : "This request took too long. Check your internet connection and try again.",
      );
      timeoutError.code = "request/timeout";
      timeoutError.uncertainOutcome = action === "exams.assign";
      throw timeoutError;
    }
    throw error;
  } finally { window.clearTimeout(timeout); }
}
