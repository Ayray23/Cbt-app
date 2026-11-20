// New student accounts authenticate with a stable, case-insensitive school ID.
// Firebase only supports an email/password credential, so derive the *same*
// opaque alias as server/domain.mjs without exposing students' admission IDs
// in authentication email addresses.
export function normalizeAdmissionNumber(input) {
  const value = String(input || "").trim().toUpperCase();
  if (!new RegExp("^[A-Z0-9][A-Z0-9._/-]{2,59}$").test(value)) {
    throw new Error("Enter a valid Admission Number / Student ID (3–60 letters, numbers, dots, slashes, underscores or hyphens).");
  }
  return value;
}

export async function studentAdmissionAuthEmail(input, subtle = globalThis.crypto?.subtle) {
  const number = normalizeAdmissionNumber(input);
  if (!subtle?.digest) throw new Error("Secure student sign-in requires HTTPS. Open the school's official CBT website.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(number));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `adm-${hash.slice(0, 32)}@students.cbt.invalid`;
}

export function isLegacyUsername(identifier) {
  return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(String(identifier || "").trim().toLowerCase());
}
