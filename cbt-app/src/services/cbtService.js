import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "/firebase";
import { generateAccessCode, hashAccessCode, normalizeAccessCode } from "../utils/accessCode";

export async function createExam({ title, duration, startAt = "", endAt = "" }) {
  const startAtMs = startAt ? new Date(startAt).getTime() : null;
  const endAtMs = endAt ? new Date(endAt).getTime() : null;
  if (startAtMs && Number.isNaN(startAtMs)) throw new Error("Enter a valid exam start time.");
  if (endAtMs && Number.isNaN(endAtMs)) throw new Error("Enter a valid exam end time.");
  if (startAtMs && endAtMs && endAtMs <= startAtMs) throw new Error("Exam end time must be after the start time.");
  const ref = await addDoc(collection(db, "exams"), {
    title: title.trim(), duration: Number(duration) || 0, status: "draft", questionCount: 0,
    scheduleStartAtMs: startAtMs, scheduleEndAtMs: endAtMs,
    createdAt: serverTimestamp(), publishedAt: null,
  });
  return ref.id;
}

export async function updateExamStatus(examId, status) {
  const updates = { status, updatedAt: serverTimestamp() };
  if (status === "published") {
    const questionCountSnapshot = await getCountFromServer(query(collection(db, "questions"), where("examId", "==", examId)));
    const questionCount = questionCountSnapshot.data().count;
    if (questionCount <= 0) throw new Error("Add at least one question before publishing this exam.");
    updates.publishedAt = serverTimestamp();
    updates.questionCount = questionCount;
  }
  await updateDoc(doc(db, "exams", examId), updates);
}

export async function deleteExam(examId) {
  const questionsSnapshot = await getDocs(query(collection(db, "questions"), where("examId", "==", examId)));
  await Promise.all(questionsSnapshot.docs.map((item) => deleteDoc(item.ref)));
  await deleteDoc(doc(db, "examAccess", examId)).catch(() => null);
  await deleteDoc(doc(db, "exams", examId));
}

export async function addQuestion({ examId, question, options, correctAnswer, marks = 1 }) {
  const cleanOptions = { A: options?.A ?? "", B: options?.B ?? "", C: options?.C ?? "", D: options?.D ?? "" };
  await addDoc(collection(db, "questions"), {
    examId: String(examId).trim(), text: String(question).trim(), options: cleanOptions,
    correctAnswer: String(correctAnswer).trim().toUpperCase(), marks: Number(marks) || 1,
    type: "mcq", createdAt: serverTimestamp(),
  });
  const questionCountSnapshot = await getCountFromServer(query(collection(db, "questions"), where("examId", "==", examId)));
  await updateDoc(doc(db, "exams", examId), { questionCount: questionCountSnapshot.data().count, updatedAt: serverTimestamp() });
}

export async function setExamAccessCode(examId, accessCode) {
  const normalizedAccessCode = normalizeAccessCode(accessCode);
  if (!normalizedAccessCode) throw new Error("Enter an exam password before publishing.");
  if (normalizedAccessCode.length < 4) throw new Error("Use at least 4 characters for the exam password.");
  const codeHash = await hashAccessCode(normalizedAccessCode);
  // The password hash lives only in the admin-only examAccess collection.
  // Never place hashes or plaintext passwords on publicly readable exam docs.
  await setDoc(doc(db, "examAccess", examId), {
    examId,
    codeHash,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return true;
}

export async function generateStudentExamCodes(exam, students) {
  if (!exam?.id || !students?.length) throw new Error("Select an exam and at least one student.");
  const generated = [];
  const eligibleStudents = students.filter((student) => student?.id);
  for (let offset = 0; offset < eligibleStudents.length; offset += 200) {
    const batch = writeBatch(db);
    const chunk = eligibleStudents.slice(offset, offset + 200);
    for (const student of chunk) {
      const code = generateAccessCode(10);
      const codeHash = await hashAccessCode(code);
      const codeId = `${exam.id}_${student.id}`;
      const printRef = doc(db, "studentExamCodePrintRecords", codeId);
      const hashRef = doc(db, "studentExamCodeHashes", codeId);
      const studentName = student.displayName || student.fullName || student.email || "Student";
      const record = { examId: exam.id, examTitle: exam.title || "Exam", studentUid: student.id, studentName, studentEmail: student.email || "", studentId: student.studentId || "", className: student.className || "", code, updatedAt: serverTimestamp() };
      batch.set(printRef, { ...record, createdAt: serverTimestamp() });
      batch.set(hashRef, { examId: exam.id, studentUid: student.id, codeHash, status: "active", usedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      generated.push({ id: codeId, ...record, status: "active" });
    }
    await batch.commit();
  }
  await updateDoc(doc(db, "exams", exam.id), { individualCodesEnabled: true, individualCodesUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return generated;
}

export async function updateStudentProfile(studentUid, profile) {
  if (!studentUid) throw new Error("Student account is missing.");
  const allowedFields = ["displayName", "studentId", "className", "department", "phone"];
  const updates = {};
  for (const field of allowedFields) if (profile[field] !== undefined) updates[field] = String(profile[field] || "").trim();
  updates.updatedAt = serverTimestamp();
  await updateDoc(doc(db, "users", studentUid), updates);
  return updates;
}
