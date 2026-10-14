// cloud-functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Storage } = require("@google-cloud/storage");
const XLSX = require("xlsx");
const mammoth = require("mammoth");
const pdf = require("pdf-parse");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const storage = new Storage();

function normalizeAccessCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function hashAccessCode(value) {
  return crypto.createHash("sha256").update(normalizeAccessCode(value)).digest("hex");
}

// Secure server-side validation for a student's individual exam code.
// The plaintext code is never stored or returned by this function.
exports.validateStudentExamCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Please sign in before entering an exam code.");
  }

  const examId = String(data?.examId || "").trim();
  const accessCode = normalizeAccessCode(data?.accessCode);
  if (!examId || !accessCode) {
    throw new functions.https.HttpsError("invalid-argument", "Exam and exam code are required.");
  }

  const codeRef = db.collection("studentExamCodeHashes").doc(`${examId}_${context.auth.uid}`);
  const codeSnapshot = await codeRef.get();
  if (!codeSnapshot.exists) {
    throw new functions.https.HttpsError("permission-denied", "No individual exam code has been issued for this student.");
  }

  const record = codeSnapshot.data();
  if (record.studentUid !== context.auth.uid || record.examId !== examId) {
    throw new functions.https.HttpsError("permission-denied", "This exam code is not assigned to this student.");
  }
  if (record.status === "revoked") {
    throw new functions.https.HttpsError("permission-denied", "This exam code has been revoked.");
  }
  if (record.status === "used") {
    throw new functions.https.HttpsError("failed-precondition", "This exam code has already been used.");
  }

  const expectedHash = String(record.codeHash || "");
  const providedHash = hashAccessCode(accessCode);
  if (!expectedHash || providedHash !== expectedHash) {
    throw new functions.https.HttpsError("permission-denied", "Incorrect exam code for this student account.");
  }

  return { valid: true, examId, studentUid: context.auth.uid };
});

// Storage-trigger: parse student spreadsheet uploads
exports.onStudentFileUpload = functions.storage.object().onFinalize(async (object) => {
  try {
    const filePath = object.name;
    if (!filePath || !filePath.startsWith("uploads/students/")) return null;
    const bucket = storage.bucket(object.bucket);
    const tmpFile = path.join(os.tmpdir(), path.basename(filePath));
    await bucket.file(filePath).download({ destination: tmpFile });
    const ext = path.extname(filePath).toLowerCase();
    let rows = [];
    if (ext === ".csv") {
      const text = fs.readFileSync(tmpFile, "utf8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = lines[0].split(",").map(h => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(c => c.trim());
        const obj = {};
        headers.forEach((h, idx) => (obj[h] = cols[idx] || ""));
        rows.push(obj);
      }
    } else if (ext === ".xlsx" || ext === ".xls") {
      const wb = XLSX.readFile(tmpFile);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    }
    if (rows.length) {
      const batch = db.batch();
      rows.forEach((r) => {
        const ref = db.collection("students").doc();
        batch.set(ref, {
          name: r.Name || r.name || `${r.FirstName || ""} ${r.LastName || ""}`.trim(),
          studentNumber: r.StudentNumber || r.RegNo || r.ID || "",
          email: r.Email || "",
          class: r.Class || r.Level || "",
          meta: r,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }
    const archivePath = filePath.replace("uploads/", "archives/");
    await bucket.file(filePath).move(archivePath);
    fs.unlinkSync(tmpFile);
    return null;
  } catch (e) {
    console.error("parse students error:", e);
    return null;
  }
});

// Storage-trigger: parse question uploads
exports.onQuestionFileUpload = functions.storage.object().onFinalize(async (object) => {
  try {
    const filePath = object.name;
    if (!filePath || !filePath.startsWith("uploads/questions/")) return null;
    const bucket = storage.bucket(object.bucket);
    const tmpFile = path.join(os.tmpdir(), path.basename(filePath));
    await bucket.file(filePath).download({ destination: tmpFile });
    const ext = path.extname(filePath).toLowerCase();
    let items = [];
    if (ext === ".csv" || ext === ".xlsx" || ext === ".xls") {
      if (ext === ".csv") {
        const text = fs.readFileSync(tmpFile, "utf8");
        const lines = text.split(/\r?\n/).filter(Boolean);
        const headers = lines[0].split(",").map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map(c => c.trim());
          const obj = {};
          headers.forEach((h, idx) => (obj[h] = cols[idx] || ""));
          items.push(obj);
        }
      } else {
        const wb = XLSX.readFile(tmpFile);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        items = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      }
      if (items.length) {
        const batch = db.batch();
        items.forEach((r) => {
          const qDoc = db.collection("questions").doc();
          const options = (() => {
            try {
              if (r.options && typeof r.options === "string") return JSON.parse(r.options);
              return r.options || [];
            } catch (e) {
              return r.options ? String(r.options).split("|").map(s => s.trim()) : [];
            }
          })();
          batch.set(qDoc, {
            text: r.questionText || r.question || r.text || "",
            type: r.type || (options.length ? "mcq" : "short"),
            options: options.map((o, idx) => (typeof o === "object" ? o : { id: String(idx), text: o })),
            correctAnswer: r.correctAnswer || r.answer || "",
            marks: Number(r.marks || 1),
            meta: r,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
      }
    } else if (ext === ".pdf" || ext === ".docx") {
      let text = "";
      if (ext === ".docx") {
        const result = await mammoth.extractRawText({ path: tmpFile });
        text = result.value;
      } else {
        const data = fs.readFileSync(tmpFile);
        const res = await pdf(data);
        text = res.text || "";
      }
      const qblocks = text.split(/\n(?=\d+\.)/).map(s => s.trim()).filter(Boolean);
      const batch = db.batch();
      qblocks.forEach((block) => {
        const lines = block.split(/\n/).map(l => l.trim()).filter(Boolean);
        const first = lines.shift();
        const optLines = lines.filter(l => /^[A-D]\s*[\)\.]|^[A-D]\s+/.test(l) || /^[A-D]\./.test(l) || /^[A-D]\)/.test(l));
        const options = optLines.map((o, idx) => ({ id: String(idx), text: o.replace(/^[A-D]\s*[\)\.]?\s*/, "") }));
        const qDoc = db.collection("questions").doc();
        batch.set(qDoc, { text: first, type: options.length ? "mcq" : "short", options, createdAt: admin.firestore.FieldValue.serverTimestamp(), source: "auto-parsed" });
      });
      await batch.commit();
    }
    const archivePath = filePath.replace("uploads/", "archives/");
    await bucket.file(filePath).move(archivePath);
    fs.unlinkSync(tmpFile);
    return null;
  } catch (e) {
    console.error("parse questions error:", e);
    return null;
  }
});

// HTTP API for grading a session (legacy/admin use)
const app = express();
app.use(express.json());
app.post("/grade-session", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    const sessRef = db.collection("examSessions").doc(sessionId);
    const snap = await sessRef.get();
    if (!snap.exists) return res.status(404).json({ error: "session not found" });
    const session = snap.data();
    let total = 0;
    const updatedAnswers = [];
    for (const a of session.answers || []) {
      const qsnap = await db.collection("questions").doc(a.questionId).get();
      if (!qsnap.exists) { updatedAnswers.push({ ...a, autoMark: 0 }); continue; }
      const q = qsnap.data();
      if (q.type === "mcq") {
        const correct = String(q.correctAnswer || "").trim().toUpperCase();
        const studentAns = String(a.answer || "").trim().toUpperCase();
        const mark = studentAns === correct ? (q.marks || 1) : 0;
        total += mark;
        updatedAnswers.push({ ...a, autoMark: mark });
      } else updatedAnswers.push({ ...a, autoMark: 0, manualRequired: true });
    }
    await sessRef.update({ answers: updatedAnswers, totalAutoScore: total, finalScore: total, status: "graded", gradedAt: admin.firestore.FieldValue.serverTimestamp() });
    return res.json({ ok: true, total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});
exports.api = functions.https.onRequest(app);

exports.listUsers = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required");
  const requester = await admin.auth().getUser(context.auth.uid);
  if (!requester.customClaims?.admin) throw new functions.https.HttpsError("permission-denied", "Admin only");
  const list = await admin.auth().listUsers(1000);
  return { users: list.users.map(u => ({ uid: u.uid, email: u.email, customClaims: u.customClaims })) };
});

exports.makeAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required");
  const requester = await admin.auth().getUser(context.auth.uid);
  if (!requester.customClaims?.admin) throw new functions.https.HttpsError("permission-denied", "Admin only");
  if (!data.uid) throw new functions.https.HttpsError("invalid-argument", "UID required");
  await admin.auth().setCustomUserClaims(data.uid, { admin: true });
  return { ok: true };
});
