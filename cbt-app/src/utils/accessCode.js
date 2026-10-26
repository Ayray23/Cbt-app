export function normalizeAccessCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function generateAccessCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chars = [];

  if (!Number.isInteger(length) || length < 8 || length > 64) {
    throw new Error("Access-code length must be between 8 and 64 characters.");
  }

  const randomValues = new Uint32Array(length);
  window.crypto.getRandomValues(randomValues);
  for (let index = 0; index < length; index += 1) {
    // Rejection sampling avoids modulo bias while keeping codes cryptographically random.
    const limit = Math.floor(0x100000000 / alphabet.length) * alphabet.length;
    let value = randomValues[index];
    while (value >= limit) {
      const replacement = new Uint32Array(1);
      window.crypto.getRandomValues(replacement);
      value = replacement[0];
    }
    chars.push(alphabet[value % alphabet.length]);
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
