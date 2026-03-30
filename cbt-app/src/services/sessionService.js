import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "/firebase";

function requireUser() {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("Please sign in to continue.");
  }

  return currentUser;
}

function normalizeAnswers(answers) {
  if (!answers || typeof answers !== "object") {
    return {};
  }

  return Object.entries(answers).reduce((acc, [questionId, answer]) => {
    acc[questionId] = String(answer || "").trim().toUpperCase();
    return acc;
  }, {});
}

function shuffleArray(items) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

export async function startExamSession(examId) {
  const currentUser = requireUser();
  const examRef = doc(db, "exams", examId);
  const sessionRef = doc(db, "examSessions", `${examId}_${currentUser.uid}`);
  const userRef = doc(db, "users", currentUser.uid);

  const [examSnapshot, sessionSnapshot, userSnapshot, questionsSnapshot] = await Promise.all([
    getDoc(examRef),
    getDoc(sessionRef),
    getDoc(userRef),
    getDocs(query(collection(db, "questions"), where("examId", "==", examId))),
  ]);

  if (!examSnapshot.exists()) {
    throw new Error("Exam not found.");
  }

  const exam = examSnapshot.data();
  if (exam.status !== "published") {
    throw new Error("This exam is not available right now.");
  }

  if (sessionSnapshot.exists()) {
    const existing = sessionSnapshot.data();
    if (existing.status === "submitted") {
      throw new Error("This exam has already been submitted.");
    }

    return {
      id: sessionSnapshot.id,
      ...existing,
      startedAtMs:
        existing.startedAt && typeof existing.startedAt.toMillis === "function"
          ? existing.startedAt.toMillis()
          : Date.now(),
    };
  }

  if (questionsSnapshot.empty) {
    throw new Error("This exam has no questions yet.");
  }

  const questionOrder = shuffleArray(questionsSnapshot.docs.map((questionDoc) => questionDoc.id));
  const profile = userSnapshot.exists() ? userSnapshot.data() : {};
  const sessionData = {
    examId,
    examTitle: exam.title || "",
    studentUid: currentUser.uid,
    studentEmail: currentUser.email || profile.email || "",
    studentName: profile.displayName || currentUser.email || "Candidate",
    status: "started",
    answers: {},
    questionOrder,
    totalAutoScore: 0,
    finalScore: 0,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(sessionRef, sessionData);
  const createdSnapshot = await getDoc(sessionRef);
  const result = {
    id: createdSnapshot.id,
    ...createdSnapshot.data(),
  };

  if (result.startedAt && typeof result.startedAt.toMillis === "function") {
    return {
      ...result,
      startedAtMs: result.startedAt.toMillis(),
    };
  }

  return result;
}

export async function submitExamSession(examId, answers) {
  const currentUser = requireUser();
  const normalizedAnswers = normalizeAnswers(answers);
  const examRef = doc(db, "exams", examId);
  const sessionRef = doc(db, "examSessions", `${examId}_${currentUser.uid}`);
  const userRef = doc(db, "users", currentUser.uid);

  const [examSnapshot, questionsSnapshot, userSnapshot] = await Promise.all([
    getDoc(examRef),
    getDocs(query(collection(db, "questions"), where("examId", "==", examId))),
    getDoc(userRef),
  ]);

  if (!examSnapshot.exists()) {
    throw new Error("Exam not found.");
  }

  const exam = examSnapshot.data();
  if (exam.status !== "published") {
    throw new Error("This exam is not available right now.");
  }

  const existingSessionSnapshot = await getDoc(sessionRef);
  if (existingSessionSnapshot.exists() && existingSessionSnapshot.data().status === "submitted") {
    throw new Error("This exam has already been submitted.");
  }

  if (questionsSnapshot.empty) {
    throw new Error("This exam has no questions yet.");
  }

  const total = questionsSnapshot.docs.reduce((sum, questionDoc) => {
    const question = questionDoc.data();
    const studentAnswer = normalizedAnswers[questionDoc.id] || "";
    const correctAnswer = String(question.correctAnswer || "").trim().toUpperCase();
    const marks = Number(question.marks || 1);
    return sum + (studentAnswer === correctAnswer ? marks : 0);
  }, 0);

  const profile = userSnapshot.exists() ? userSnapshot.data() : {};
  const sessionData = {
    examId,
    examTitle: exam.title || "",
    studentUid: currentUser.uid,
    studentEmail: currentUser.email || profile.email || "",
    studentName: profile.displayName || currentUser.email || "Candidate",
    answers: normalizedAnswers,
    totalAutoScore: total,
    finalScore: total,
    status: "submitted",
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(sessionRef, sessionData, { merge: true });
  const sessionSnapshot = await getDoc(sessionRef);

  return {
    id: sessionSnapshot.id,
    ...sessionSnapshot.data(),
  };
}

export async function setUserRole(email, role) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedRole = String(role || "").trim().toLowerCase();

  if (!normalizedEmail || !normalizedRole) {
    throw new Error("Email and role are required.");
  }

  const snapshot = await getDocs(
    query(collection(db, "users"), where("email", "==", normalizedEmail), limit(1))
  );

  if (snapshot.empty) {
    throw new Error("User profile not found. Ask the user to sign in first.");
  }

  await updateDoc(snapshot.docs[0].ref, {
    role: normalizedRole,
    updatedAt: serverTimestamp(),
  });

  return {
    ok: true,
    uid: snapshot.docs[0].id,
    email: normalizedEmail,
    role: normalizedRole,
  };
}
