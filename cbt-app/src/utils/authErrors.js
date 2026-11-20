// Do not expose raw Firebase SDK errors to teachers or students.
export function friendlyAuthError(error, fallback = "Something went wrong. Please try again.") {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code === "auth/network-request-failed" || /network request failed|failed to fetch|networkerror/i.test(message)) {
    return "Could not connect to Firebase Authentication. Check your internet connection and retry. If other websites work, disable VPN/ad blockers or ask your school administrator to check access to Firebase services.";
  }
  if (code === "auth/email-already-in-use") return "This email already has an account. Sign in instead, or finish an incomplete teacher registration.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/weak-password") return "Choose a stronger password with at least 8 characters.";
  if (code === "auth/operation-not-allowed") return "Teacher registration is unavailable because email/password sign-in is not enabled in Firebase Authentication. Contact the administrator.";
  if (code === "auth/too-many-requests") return "Too many attempts. Try again later or contact the administrator.";
  if (["auth/invalid-api-key", "auth/configuration-not-found", "auth/unauthorized-domain"].includes(code)) return "Firebase Authentication is not configured correctly for this website. Contact the administrator.";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(code)) return "Invalid username, email or password.";
  if (error?.name === "AbortError") return "The request took too long. Check your connection and try again.";
  return message && !code.startsWith("auth/") ? message : fallback;
}
