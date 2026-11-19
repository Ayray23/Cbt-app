import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function assert(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}

export function documentId(value) {
  assert(typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value), 400, "Invalid record ID.");
  return value;
}

export function studentUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  assert(/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username), 400,
    "Use a username of 3-40 letters, numbers, dots, underscores or hyphens.");
  return username;
}

// Firebase uses an internal login address; students only enter their username.
export function usernameEmail(username) {
  return `${studentUsername(username)}@students.cbt.invalid`;
}

export function shuffled(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function pinDigest(examId, uid, pin) {
  return createHash("sha256").update(`${examId}:${uid}:${String(pin || "").trim().toUpperCase()}`).digest("hex");
}

export function pinMatches(examId, uid, pin, digest) {
  const provided = Buffer.from(pinDigest(examId, uid, pin), "hex");
  const expected = Buffer.from(String(digest || ""), "hex");
  return expected.length === provided.length && timingSafeEqual(provided, expected);
}

export function newPin() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export function examPaper(questionDocs) {
  assert(questionDocs.length > 0 && questionDocs.length <= 300, 400, "An exam must contain 1-300 questions.");
  const paper = questionDocs.map((item) => {
    const question = item.data();
    const marks = Number(question.marks ?? 1);
    const correctAnswer = String(question.correctAnswer || "").trim().toUpperCase();
    assert(["A", "B", "C", "D"].includes(correctAnswer) && Number.isFinite(marks) && marks > 0,
      400, "Fix the answer key and marks for every question before publishing.");
    const options = Object.fromEntries(["A", "B", "C", "D"].map((key) => [key, String(question.options?.[key] || "")]));
    const text = String(question.text ?? question.question ?? "");
    assert(text.trim() && Object.values(options).every((value) => value.trim()), 400, "Every question needs text and four options.");
    const image = String(question.image || ''); const imageAlt = String(question.imageAlt || '').slice(0, 500);
    assert(!image || (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) && image.length <= 140000), 400, 'Question images must be PNG, JPEG or WebP under 100 KB.');
    return { id: item.id, text, options, marks, correctAnswer, ...(image ? { image, imageAlt } : {}) };
  });
  assert(Buffer.byteLength(JSON.stringify(paper), "utf8") < 850000, 400, "This paper is too large. Split it into smaller exams.");
  return paper;
}

export function publicQuestions(paper) {
  return paper.map(({ id, text, options, marks, image, imageAlt }) => ({ id, text, options, marks, ...(image ? { image, imageAlt } : {}) }));
}

export function cleanAnswers(answers, paper) {
  assert(answers && typeof answers === "object" && !Array.isArray(answers), 400, "Invalid answers.");
  return Object.fromEntries(paper.flatMap(({ id }) => {
    const answer = String(answers[id] || "").trim().toUpperCase();
    return ["A", "B", "C", "D"].includes(answer) ? [[id, answer]] : [];
  }));
}

export function grade(paper, answers) {
  return {
    finalScore: paper.reduce((score, question) => score + (answers[question.id] === question.correctAnswer ? question.marks : 0), 0),
    maxMarks: paper.reduce((total, question) => total + question.marks, 0),
  };
}

export function safeSession(data, id) {
  const fields = ["academicSession", "term", "className", "subject", "category", "weight", "allowCalculator", "instructions", "progressRevision", "examId", "examTitle", "studentUid", "studentName", "studentEmail", "studentUsername", "status",
    "answers", "questionOrder", "optionOrderByQuestion", "startedAtMs", "expiresAtMs", "tabSwitchCount",
    "integrityWarnings", "lastActivityAtMs", "submittedAtMs", "submissionReason", "schemaVersion"];
  return { id, ...Object.fromEntries(fields.filter((key) => data[key] !== undefined).map((key) => [key, data[key]])) };
}
