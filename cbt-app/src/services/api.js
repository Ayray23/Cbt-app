import { auth } from "/firebase";

export async function callApi(action, input = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in to continue.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
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
  } finally { window.clearTimeout(timeout); }
}
