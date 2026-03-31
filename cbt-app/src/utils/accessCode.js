export function normalizeAccessCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function generateAccessCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chars = [];

  for (let index = 0; index < length; index += 1) {
    const nextIndex = Math.floor(Math.random() * alphabet.length);
    chars.push(alphabet[nextIndex]);
  }

  return chars.join("");
}

export async function hashAccessCode(value) {
  const normalized = normalizeAccessCode(value);
  const encoder = new TextEncoder();
  const input = encoder.encode(normalized);
  const digest = await window.crypto.subtle.digest("SHA-256", input);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
