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

admin.initializeApp();
const db = admin.firestore();
const storage = new Storage();

// Storage-trigger: parse student spreadsheet uploads
exports.onStudentFileUpload = functions.storage.object().onFinalize(async (object) => {
  try {
    const filePath = object.name; // e.g. "uploads/students/..."
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
    } else {
      console.log("Unsupported ext for students:", ext);
    }

    if (rows.length) {
      const batch = db.batch();
      rows.forEach((r) => {
        const doc = db.collection("students").doc();
        batch.set(doc, {
          name: r.Name || r.name || `${r.FirstName || ""} ${r.LastName || ""}`.trim(),
          studentNumber: r.StudentNumber || r.RegNo || r.ID || "",
          email: r.Email || "",
          class: r.Class || r.Level || "",
          meta: r,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      console.log("Imported students:", rows.length);
    }

    // move to archive (optional)
    const archivePath = filePath.replace("uploads/", "archives/");
    await bucket.file(filePath).move(archivePath);
    fs.unlinkSync(tmpFile);
    return null;
  } catch (e) {
    console.error("parse students error:", e);
    return null;
  }
});

// Storage-trigger: parse question spreadsheets (best-effort) and create question docs
exports.onQuestionFileUpload = functions.storage.object().onFinalize(async (object) => {
  try {
    const filePath = object.name; // e.g. "uploads/questions/..."
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
          // recommended fields: questionText, type, options(JSON), correctAnswer, marks
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
        console.log("Imported questions:", items.length);
      }
    } else if (ext === ".pdf" || ext === ".docx") {
      // best-effort text extraction: for docx use mammoth, for pdf use pdf-parse
      let text = "";
      if (ext === ".docx") {
        const result = await mammoth.extractRawText({ path: tmpFile });
        text = result.value;
      } else {
        const data = fs.readFileSync(tmpFile);
        const res = await pdf(data);
        text = res.text || "";
      }

      // naive splitter: look for lines starting with number + dot
      const qblocks = text.split(/\n(?=\d+\.)/).map(s => s.trim()).filter(Boolean);
      const batch = db.batch();
      qblocks.forEach((block) => {
        // further naive parse: first line is question, following lines that start with A) or A. are options
        const lines = block.split(/\n/).map(l => l.trim()).filter(Boolean);
        const first = lines.shift();
        const optLines = lines.filter(l => /^[A-D]\s*[\)\.]|^[A-D]\s+/.test(l) || /^[A-D]\./.test(l) || /^[A-D]\)/.test(l));
        const options = optLines.map((o, idx) => ({ id: String(idx), text: o.replace(/^[A-D]\s*[\)\.]?\s*/, "") }));
        const qDoc = db.collection("questions").doc();
        batch.set(qDoc, {
          text: first,
          type: options.length ? "mcq" : "short",
          options,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          source: "auto-parsed",
        });
      });
      await batch.commit();
      console.log("Parsed PDF/DOCX questions (approx):", qblocks.length);
    } else {
      console.log("Unsupported question file ext:", ext);
    }

    // archive file
    const archivePath = filePath.replace("uploads/", "archives/");
    await bucket.file(filePath).move(archivePath);
    fs.unlinkSync(tmpFile);
    return null;
  } catch (e) {
    console.error("parse questions error:", e);
    return null;
  }
});

// HTTP API for grading a session (simplified)
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
      if (!qsnap.exists) {
        updatedAnswers.push({ ...a, autoMark: 0 });
        continue;
      }
      const q = qsnap.data();
      if (q.type === "mcq") {
        const correct = String(q.correctAnswer || "").trim().toUpperCase();
        const studentAns = String(a.answer || "").trim().toUpperCase();
        const mark = studentAns === correct ? (q.marks || 1) : 0;
        total += mark;
        updatedAnswers.push({ ...a, autoMark: mark });
      } else {
        // essay/short -> manual
        updatedAnswers.push({ ...a, autoMark: 0, manualRequired: true });
      }
    }

    await sessRef.update({
      answers: updatedAnswers,
      totalAutoScore: total,
      finalScore: total,
      status: "graded",
      gradedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true, total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

exports.api = functions.https.onRequest(app);


// List all users
exports.listUsers = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required");
  const requester = await admin.auth().getUser(context.auth.uid);
  if (!requester.customClaims?.admin) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }
  const list = await admin.auth().listUsers(1000);
  return { users: list.users.map(u => ({ uid: u.uid, email: u.email, customClaims: u.customClaims })) };
});

// Promote user to admin
exports.makeAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required");
  const requester = await admin.auth().getUser(context.auth.uid);
  if (!requester.customClaims?.admin) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }
  if (!data.uid) throw new functions.https.HttpsError("invalid-argument", "UID required");
  await admin.auth().setCustomUserClaims(data.uid, { admin: true });
  return { ok: true };
});
