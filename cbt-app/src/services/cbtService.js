import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getCountFromServer,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "/firebase";
import { hashAccessCode, normalizeAccessCode } from "../utils/accessCode";

export async function createExam({ title, duration }) {
  const ref = await addDoc(collection(db, "exams"), {
    title: title.trim(),
    duration: Number(duration) || 0,
    status: "draft",
    questionCount: 0,
    accessCodeHash: null,
    accessCodeUpdatedAt: null,
    createdAt: serverTimestamp(),
    publishedAt: null,
  });

  return ref.id;
}

export async function updateExamStatus(examId, status) {
  const updates = {
    status,
    updatedAt: serverTimestamp(),
  };

  if (status === "published") {
    const questionCountSnapshot = await getCountFromServer(
      query(collection(db, "questions"), where("examId", "==", examId))
    );

    updates.publishedAt = serverTimestamp();
    updates.questionCount = questionCountSnapshot.data().count;
  }

  await updateDoc(doc(db, "exams", examId), updates);
}

export async function deleteExam(examId) {
  const questionsSnapshot = await getDocs(
    query(collection(db, "questions"), where("examId", "==", examId))
  );

  await Promise.all(questionsSnapshot.docs.map((item) => deleteDoc(item.ref)));
  await deleteDoc(doc(db, "examAccess", examId)).catch(() => null);
  await deleteDoc(doc(db, "exams", examId));
}

export async function addQuestion({
  examId,
  question,
  options,
  correctAnswer,
  marks = 1,
}) {
  const cleanOptions = {
    A: options?.A ?? "",
    B: options?.B ?? "",
    C: options?.C ?? "",
    D: options?.D ?? "",
  };

  await addDoc(collection(db, "questions"), {
    examId: String(examId).trim(),
    text: String(question).trim(),
    options: cleanOptions,
    correctAnswer: String(correctAnswer).trim().toUpperCase(),
    marks: Number(marks) || 1,
    type: "mcq",
    createdAt: serverTimestamp(),
  });

  const questionCountSnapshot = await getCountFromServer(
    query(collection(db, "questions"), where("examId", "==", examId))
  );

  await updateDoc(doc(db, "exams", examId), {
    questionCount: questionCountSnapshot.data().count,
    updatedAt: serverTimestamp(),
  });
}

export async function setExamAccessCode(examId, accessCode) {
  const examRef = doc(db, "exams", examId);
  const examSnapshot = await getDoc(examRef);

  if (!examSnapshot.exists()) {
    throw new Error("Exam not found.");
  }

  const normalizedAccessCode = normalizeAccessCode(accessCode);

  if (!normalizedAccessCode) {
    throw new Error("Enter an exam password before publishing.");
  }

  if (normalizedAccessCode.length < 4) {
    throw new Error("Use at least 4 characters for the exam password.");
  }

  const accessCodeHash = await hashAccessCode(normalizedAccessCode);

  await Promise.all([
    setDoc(doc(db, "examAccess", examId), {
      examId,
      code: normalizedAccessCode,
      updatedAt: serverTimestamp(),
    }),
    updateDoc(examRef, {
      accessCodeHash,
      accessCodeUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  ]);

  return normalizedAccessCode;
}
