import { makeOfflineSubmissionReceipt, offlineReceiptFilename } from "./offlineSubmissionReceipt.mjs";

// This PUBLIC key is safe in the student app. The matching private key is
// delivered separately to the school administrator, never shipped or stored
// in this repository or the student browser.
export const SCHOOL_RECOVERY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAu3NSM4OkTuql5AF0NM7M
DgYIBJE2Sx2EoAOPZ6RVfoXi7KZolNSQAKrN+gJkJKyoYSstHd1b2fVD8Gh7i5ku
BwDJi7dD6xp+Jme6k9n0aWLdo6Iq3yEafgTGFkocT252WS/1Hr+xpUh95ZStL7+c
THPCsR8azYN9C3Ui+eJ+qbaP4lMl+wyUHEHKGVlzJndCH/8dxFv/bkR5tuhg9qY7
23StZmMXXbm0CtB5WPTzeAXqWI9pqymzeM7/LU05yD//qvCAr9pKZ8YD+hWRoVEO
9k8JWIgKUoNXKVf5AHTAb2HBHSI5BFbiDqqej/anA1d5XloUP4CcxG2WkdqiVlqu
Ad0DyoK0EZtbKMMHnbpDr7ON5sWCz6Xa6OQGLGs66cz4CG4ckze3zXq0AS1w+Ekr
TyU6NYCKKn8d9rY03I0bEHSNCMnAsn+BizpMsbhdgOJvhKp4NkBY8NrHj/wGRkJ1
FqeKjmiGEkAGvyjGKKm09HmIwQLSAbNqvN7oZaU2RXx1AgMBAAE=
-----END PUBLIC KEY-----`;

const PDFKIT_URL = "https://cdn.jsdelivr.net/npm/pdfkit@0.17.1/js/pdfkit.standalone.js";
let pdfLibraryPromise;

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function hexPassword(bytes) {
  return [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function pemBytes(pem) {
  const data = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
async function recoveryPublicKey() {
  return window.crypto.subtle.importKey(
    "spki", pemBytes(SCHOOL_RECOVERY_PUBLIC_KEY),
    { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"],
  );
}

function getPdfKit() {
  if (window.PDFDocument) return Promise.resolve(window.PDFDocument);
  if (!pdfLibraryPromise) pdfLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let finished = false;
    const done = (error, value) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    // A disconnected school computer must never hang indefinitely waiting
    // for the optional PDF renderer; its local answers remain protected.
    const timer = window.setTimeout(() => done(new Error(
      "PDF library is unavailable. Keep this device and retry the backup later.",
    )), 12000);
    script.src = PDFKIT_URL;
    script.async = true;
    script.onload = () => window.PDFDocument
      ? done(null, window.PDFDocument)
      : done(new Error("PDF renderer did not initialize."));
    script.onerror = () => done(new Error("PDF renderer could not load. Keep this device's saved answers."));
    document.head.appendChild(script);
  }).catch((error) => { pdfLibraryPromise = null; throw error; });
  return pdfLibraryPromise;
}

// Load the PDF renderer while an exam is running and the connection may
// still be available. It remains in memory if Firebase later goes offline.
export async function preloadEncryptedPdfRenderer() {
  try { await getPdfKit(); return true; } catch { return false; }
}

function pdfBlob(Doc, receipt, password) {
  return new Promise((resolve, reject) => {
    const doc = new Doc({
      size: "A4", margin: 48, pdfVersion: "1.7",
      userPassword: password, compress: true,
      info: { Title: "CBT Emergency Answer Backup", Author: "School CBT" },
    });
    const chunks = [];
    doc.on("data", (bytes) => chunks.push(Uint8Array.from(bytes)));
    doc.on("error", reject);
    doc.on("end", () => resolve(new Blob(chunks, { type: "application/pdf" })));
    doc.fontSize(18).text("CBT - Emergency Submission Backup", { underline: true });
    doc.moveDown().fontSize(11);
    doc.text("PRIVATE - RECOVERY RECORD. NOT A SERVER-CONFIRMED RESULT.");
    doc.moveDown();
    for (const [label, value] of [
      ["Student account", receipt.studentUid],
      ["Examination", receipt.examTitle],
      ["Exam ID", receipt.examId],
      ["Submission ID", receipt.submissionId],
      ["Submission reason", receipt.submissionReason],
      ["Answered questions", String(receipt.answerCount)],
      ["Closed (device time)", new Date(receipt.closedAtMs).toISOString()],
    ]) doc.text(`${label}: ${value || "-"}`);
    doc.moveDown();
    doc.fontSize(14).text("Student's selected answers");
    doc.moveDown(0.5).fontSize(11);
    const entries = Object.entries(receipt.packets[0].pending.answers || {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [questionId, answer] of entries)
      doc.text(`Question ${questionId}: ${answer}`, { lineGap: 3 });
    doc.moveDown();
    doc.fontSize(10).text("This document is password-protected. Only school staff with the separate recovery key can unlock it. Correct answers and the marking key are not included.");
    doc.end();
  });
}

export async function buildEncryptedOfflinePdf(packet, uid) {
  if (!window.crypto?.subtle) throw new Error("A secure browser (HTTPS) is required for encrypted answer backup.");
  const receipt = makeOfflineSubmissionReceipt(packet, uid);
  const Doc = await getPdfKit();
  const password = hexPassword(window.crypto.getRandomValues(new Uint8Array(24)));
  const [pdf, publicKey] = await Promise.all([pdfBlob(Doc, receipt, password), recoveryPublicKey()]);
  // The PDF uses password encryption; this attached envelope lets authorized
  // staff recover its random password and a recovery-compatible answer packet.
  const dataKey = window.crypto.getRandomValues(new Uint8Array(32));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const aes = await window.crypto.subtle.importKey("raw", dataKey, "AES-GCM", false, ["encrypt"]);
  const json = new TextEncoder().encode(JSON.stringify(receipt));
  const ciphertext = new Uint8Array(await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, json));
  const wrapped = new Uint8Array(await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" }, publicKey,
    new TextEncoder().encode(JSON.stringify({ password, dataKey: base64(dataKey) })),
  ));
  // A PDF comment AFTER %%EOF does not change its cross-reference offsets or
  // encrypted page content. It contains ciphertext only, not answers/password.
  const envelope = `\n%CBT-ENCRYPTED-RECOVERY-V1:${base64(wrapped)}:${base64(iv)}:${base64(ciphertext)}\n`;
  const output = new Blob([pdf, envelope], { type: "application/pdf" });
  return { blob: output, filename: offlineReceiptFilename(receipt).replace(/\.json$/, ".pdf") };
}

export function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const href = URL.createObjectURL(blob);
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30000);
}

export async function downloadEncryptedOfflinePdf(packet, uid) {
  const { blob, filename } = await buildEncryptedOfflinePdf(packet, uid);
  downloadBlob(blob, filename);
  return filename;
}
