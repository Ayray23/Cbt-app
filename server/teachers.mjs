import { randomUUID } from "node:crypto";
import { assert, documentId, examPaper } from "./domain.mjs";
export const teacherRole = (role) =>
  ["teacher", "teacher_admin"].includes(role);
export function teacherService({ db, auth, fields, now = Date.now }) {
  const stamp = () => fields.serverTimestamp();
  const audit = (tx, user, action, target, workspaceUid, details = {}) =>
    tx.create(db.collection("auditLogs").doc(), {
      actorUid: user.uid,
      workspaceUid,
      action,
      target,
      details,
      createdAt: stamp(),
      createdAtMs: now(),
    });
  async function register(token, input) {
    let claims;
    try {
      claims = await auth.verifyIdToken(token, true);
    } catch {
      assert(false, 401, "Please sign in again.");
    }
    const account = await auth.getUser(claims.uid);
    assert(
      account.email && !account.email.endsWith("@students.cbt.invalid"),
      400,
      "Register using your personal email address.",
    );
    const displayName = String(input.displayName || "").trim();
    assert(
      displayName.length >= 2 && displayName.length <= 120,
      400,
      "Enter your full name.",
    );
    return db.runTransaction(async (tx) => {
      const ref = db.doc(`users/${claims.uid}`);
      const existing = await tx.get(ref);
      if (existing.exists) {
        assert(
          existing.data().registrationSource === "teacher-self-registration",
          409,
          "This account already has a school role.",
        );
        return { approvalStatus: existing.data().approvalStatus };
      }
      tx.create(ref, {
        displayName,
        email: account.email.toLowerCase(),
        role: "teacher_admin",
        approvalStatus: "pending",
        registrationSource: "teacher-self-registration",
        assignedClasses: [],
        assignedSubjects: [],
        loginDisabled: false,
        createdAt: stamp(),
        createdAtMs: now(),
      });
      audit(
        tx,
        { uid: claims.uid },
        "teachers.register",
        claims.uid,
        claims.uid,
      );
      return { approvalStatus: "pending" };
    });
  }
  const owner = (user) =>
    assert(
      user.role === "superadmin",
      403,
      "Only the superadmin can manage teacher access.",
    );
  const canAuthor = (user) =>
    assert(
      [
        "superadmin",
        "admin",
        "examofficer",
        "teacher",
        "teacher_admin",
      ].includes(user.role),
      403,
      "Teacher administrator access required.",
    );
  function editable(user, exam) {
    canAuthor(user);
    assert(
      exam.status === "draft",
      409,
      "Move the paper to draft before changing questions.",
    );
    if (user.role !== "superadmin")
      assert(
        exam.createdBy === user.uid,
        403,
        "This paper belongs to another teacher.",
      );
    if (teacherRole(user.role))
      assert(
        (user.assignedClasses || []).includes(exam.className) &&
          (user.assignedSubjects || []).includes(exam.subject),
        403,
        "This class and subject are not assigned to you.",
      );
  }
  const actions = {
    "teachers.review": async (user, input) => {
      owner(user);
      const uid = documentId(input.uid);
      assert(
        ["approve", "reject", "suspend"].includes(input.decision),
        400,
        "Select an access decision.",
      );
      const reason = String(input.reason || "").trim();
      assert(
        reason.length >= 5 && reason.length <= 500,
        400,
        "Give a reason of 5-500 characters.",
      );
      if (input.decision === "approve")
        assert(
          (await auth.getUser(uid)).emailVerified,
          409,
          "The teacher must verify their email before approval.",
        );
      return db.runTransaction(async (tx) => {
        const ref = db.doc(`users/${uid}`);
        const profile = await tx.get(ref);
        const school = await tx.get(db.doc("school/settings"));
        assert(
          profile.exists && teacherRole(profile.data().role),
          400,
          "Select a teacher administrator.",
        );
        const changes = {
          approvalStatus:
            input.decision === "approve"
              ? "approved"
              : input.decision === "reject"
                ? "rejected"
                : "suspended",
          reviewedBy: user.uid,
          reviewedAt: stamp(),
          approvalReason: reason,
        };
        if (input.decision === "approve") {
          assert(
            school.exists &&
              Array.isArray(input.classes) &&
              input.classes.length > 0 &&
              Array.isArray(input.subjects) &&
              input.subjects.length > 0 &&
              input.classes.every((c) => school.data().classes.includes(c)) &&
              input.subjects.every((s) => school.data().subjects.includes(s)),
            400,
            "Assign configured classes and subjects before approval.",
          );
          changes.assignedClasses = [...new Set(input.classes)];
          changes.assignedSubjects = [...new Set(input.subjects)];
        }
        tx.update(ref, changes);
        audit(tx, user, `teachers.${input.decision}`, uid, uid, { reason });
        return { ok: true };
      });
    },
    "questions.create": async (user, input) => {
      canAuthor(user);
      const examId = documentId(input.examId);
      const candidate = {
        text: String(input.question || "").trim(),
        options: input.options,
        correctAnswer: input.correctAnswer,
        marks: Number(input.marks ?? 1),
        image: input.image || "",
        imageAlt: input.imageAlt || "",
      };
      examPaper([{ id: "validate", data: () => candidate }]);
      return db.runTransaction(async (tx) => {
        const exam = await tx.get(db.doc(`exams/${examId}`));
        assert(exam.exists, 404, "Exam not found.");
        editable(user, exam.data());
        const ref = db
          .collection("questions")
          .doc(input.requestId ? documentId(input.requestId) : randomUUID());
        const existing = await tx.get(ref);
        if (existing.exists) {
          assert(
            existing.data().createdBy === (exam.data().createdBy || user.uid) &&
              existing.data().examId === examId,
            409,
            "Request ID already used.",
          );
          return { id: ref.id };
        }
        const workspaceUid = exam.data().createdBy || user.uid;
        tx.create(ref, {
          ...candidate,
          examId,
          createdBy: workspaceUid,
          editedBy: user.uid,
          type: "mcq",
          createdAt: stamp(),
        });
        tx.update(db.doc(`exams/${examId}`), {
          questionCount: (exam.data().questionCount || 0) + 1,
        });
        audit(tx, user, "questions.create", ref.id, workspaceUid, { examId });
        return { id: ref.id };
      });
    },
    "questions.update": async (user, input) => {
      canAuthor(user);
      const id = documentId(input.questionId);
      const candidate = {
        text: String(input.question || "").trim(),
        options: input.options,
        correctAnswer: input.correctAnswer,
        marks: Number(input.marks ?? 1),
        image: input.image || "",
        imageAlt: input.imageAlt || "",
      };
      examPaper([{ id, data: () => candidate }]);
      return db.runTransaction(async (tx) => {
        const ref = db.doc(`questions/${id}`);
        const question = await tx.get(ref);
        assert(question.exists, 404, "Question not found.");
        const exam = await tx.get(db.doc(`exams/${question.data().examId}`));
        assert(exam.exists, 404, "Paper not found.");
        editable(user, exam.data());
        tx.update(ref, {
          ...candidate,
          editedBy: user.uid,
          updatedAt: stamp(),
        });
        audit(
          tx,
          user,
          "questions.update",
          id,
          exam.data().createdBy || user.uid,
          { examId: question.data().examId },
        );
        return { ok: true };
      });
    },
    "questions.delete": async (user, input) => {
      canAuthor(user);
      const id = documentId(input.questionId);
      return db.runTransaction(async (tx) => {
        const ref = db.doc(`questions/${id}`);
        const question = await tx.get(ref);
        assert(question.exists, 404, "Question not found.");
        const exam = await tx.get(db.doc(`exams/${question.data().examId}`));
        assert(exam.exists, 404, "Exam not found.");
        editable(user, exam.data());
        tx.delete(ref);
        tx.update(db.doc(`exams/${question.data().examId}`), {
          questionCount: Math.max(0, (exam.data().questionCount || 0) - 1),
        });
        audit(
          tx,
          user,
          "questions.delete",
          id,
          question.data().createdBy || exam.data().createdBy || user.uid,
          { examId: question.data().examId },
        );
        return { ok: true };
      });
    },
  };
  return { register, actions };
}
