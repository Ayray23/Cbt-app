import { randomUUID } from "node:crypto";
import { assert, cleanAnswers, documentId, examPaper, grade, newPin, pinDigest, pinMatches,
  publicQuestions, safeSession, shuffled, studentUsername, usernameEmail } from "./domain.mjs";

export function createService({ db, auth, fields, now = Date.now }) {
  const stamp = () => fields.serverTimestamp();

  async function identity(token) {
    let claims;
    try { claims = await auth.verifyIdToken(token, true); }
    catch { assert(false, 401, "Please sign in again."); }
    const profile = await db.doc(`users/${claims.uid}`).get();
    assert(profile.exists, 403, "Your account has not been created by an administrator.");
    const user = { ...profile.data(), uid: claims.uid };
    assert(["student", "admin", "superadmin"].includes(user.role), 403, "Your account role is invalid.");
    assert(!user.loginDisabled, 403, "Your account access has been blocked. Contact your administrator.");
    return user;
  }

  function admin(user) { assert(["admin", "superadmin"].includes(user.role), 403, "Administrator access required."); }
  function student(user) { assert(user.role === "student", 403, "A student account is required to take an exam."); }

  async function createStudent(user, input) {
    admin(user);
    const username = studentUsername(input.username);
    const displayName = String(input.displayName || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    assert(displayName.length >= 2 && displayName.length <= 120, 400, "Enter the student's full name.");
    assert(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, "Enter a valid contact email or leave it empty.");
    assert(typeof input.password === "string" && input.password.length >= 8 && input.password.length <= 128,
      400, "Use a student password of 8-128 characters.");
    let account;
    try {
      account = await auth.createUser({ email: usernameEmail(username), password: input.password, displayName });
    } catch (error) {
      assert(error.code !== "auth/email-already-exists", 409, "That username is already in use.");
      throw error;
    }
    try {
      await db.doc(`users/${account.uid}`).create({ username, email, displayName, role: "student",
        loginDisabled: false, createdBy: user.uid, createdAt: stamp(), schemaVersion: 2 });
    } catch (error) {
      await auth.deleteUser(account.uid);
      throw error;
    }
    return { uid: account.uid, username, displayName, email };
  }

  async function setAccess(user, input) {
    admin(user);
    const uid = documentId(input.studentId);
    assert(typeof input.loginDisabled === "boolean", 400, "Invalid access setting.");
    const ref = db.doc(`users/${uid}`);
    const snapshot = await ref.get();
    assert(snapshot.exists && snapshot.data().role === "student", 400, "Select a student account.");
    // The profile guard also blocks existing tokens immediately on every API request.
    await ref.update({ loginDisabled: input.loginDisabled, updatedAt: stamp() });
    return { ok: true };
  }

  async function setRole(user, input) {
    assert(user.role === "superadmin", 403, "Superadmin access required.");
    assert(["student", "admin"].includes(input.role), 400, "Invalid role.");
    const email = String(input.email || "").trim().toLowerCase();
    assert(email.length > 0, 400, "Enter a contact email.");
    const matches = await db.collection("users").where("email", "==", email).limit(2).get();
    assert(!matches.empty, 404, "No provisioned account has that contact email.");
    assert(matches.docs.length === 1, 409, "That contact email belongs to more than one account. Use a unique contact email before granting admin access.");
    const target = matches.docs[0];
    assert(target.id !== user.uid && target.data().role !== "superadmin", 403, "Superadmin roles must be managed with the owner setup script.");
    await target.ref.update({ role: input.role, updatedAt: stamp() });
    return { ok: true };
  }

  async function publish(user, input) {
    admin(user);
    const examId = documentId(input.examId);
    const examRef = db.doc(`exams/${examId}`);
    const result = await db.runTransaction(async (tx) => {
      const exam = await tx.get(examRef);
      const questions = await tx.get(db.collection("questions").where("examId", "==", examId));
      assert(exam.exists, 404, "Exam not found.");
      const duration = Number(exam.data().duration);
      assert(Number.isFinite(duration) && duration > 0 && duration <= 480, 400, "Duration must be 1-480 minutes.");
      const paper = examPaper(questions.docs);
      const version = randomUUID();
      tx.set(db.doc(`examPapers/${version}`), { examId, questions: paper, createdAt: stamp() });
      tx.update(examRef, { status: "published", paperVersion: version, schemaVersion: 2,
        maxMarks: grade(paper, {}).maxMarks, questionCount: paper.length, publishedAt: stamp(), updatedAt: stamp(),
        accessCodeHash: fields.delete(), accessCodeUpdatedAt: fields.delete() });
      tx.delete(db.doc(`examAccess/${examId}`));
      return { ok: true };
    });
    return result;
  }

  async function assignPins(user, input) {
    admin(user);
    const examId = documentId(input.examId);
    assert(Array.isArray(input.studentIds) && input.studentIds.length <= 100, 400, "Select 1-100 students.");
    const studentIds = [...new Set(input.studentIds)].map(documentId);
    assert(studentIds.length > 0 && studentIds.length <= 100, 400, "Select 1-100 students.");
    const refs = studentIds.map((uid) => db.doc(`users/${uid}`));
    const profiles = await db.getAll(...refs);
    assert(profiles.every((profile) => profile.exists && profile.data().role === "student"), 400, "Every selection must be a student account.");
    return db.runTransaction(async (tx) => {
      const exam = await tx.get(db.doc(`exams/${examId}`));
      assert(exam.exists, 404, "Exam not found.");
      const existingPins = await tx.get(db.collection("examPins").where("examId", "==", examId));
      const reservedTags = new Set(existingPins.docs.map((record) => record.data().pinTag));
      const sessions = [];
      for (const uid of studentIds) sessions.push(await tx.get(db.doc(`examSessions/${examId}_${uid}`)));
      assert(sessions.every((session) => !session.exists), 409, "A selected student has already started this exam. PINs cannot reset attempts.");
      const pins = profiles.map((profile) => {
        let pin;
        let pinTag;
        do { pin = newPin(); pinTag = pinDigest(examId, "", pin); } while (reservedTags.has(pinTag));
        reservedTags.add(pinTag);
        const uid = profile.id;
        const refId = `${examId}_${uid}`;
        tx.set(db.doc(`examPins/${refId}`), { examId, studentUid: uid, digest: pinDigest(examId, uid, pin), pinTag,
          attempts: 0, lockedUntilMs: 0, createdBy: user.uid, createdAt: stamp() });
        tx.set(db.doc(`examAssignments/${refId}`), { examId, studentUid: uid, examTitle: exam.data().title,
          assignedAt: stamp(), assignedBy: user.uid });
        return { studentUid: uid, username: profile.data().username || "", name: profile.data().displayName,
          email: profile.data().email || "", pin };
      });
      return { examTitle: exam.data().title, pins };
    });
  }

  async function start(user, input) {
    student(user);
    const examId = documentId(input.examId);
    const id = `${examId}_${user.uid}`;
    const ref = db.doc(`examSessions/${id}`);
    const result = await db.runTransaction(async (tx) => {
      const session = await tx.get(ref);
      const proofRef = db.doc(`examSessionProofs/${id}`);
      const proof = await tx.get(proofRef);
      if (session.exists) {
        const saved = session.data();
        assert(saved.studentUid === user.uid && (!proof.exists || proof.data().studentUid === user.uid),
          403, "This attempt has an account mismatch. Contact your administrator.");
        assert(proof.exists && proof.data().paperVersion === saved.paperVersion, 409,
          "This old session needs administrator migration before continuing.");
        assert(saved.status !== "submitted", 409, "This exam has already been submitted.");
        assert(saved.schemaVersion === 2 && saved.paperVersion, 409, "This old session needs administrator review before continuing.");
        const savedPaper = await tx.get(db.doc(`examPapers/${saved.paperVersion}`));
        assert(savedPaper.exists, 409, "The exam paper is unavailable. Contact your administrator.");
        return { session: safeSession(saved, id), questions: publicQuestions(savedPaper.data().questions), serverNowMs: now() };
      }
      assert(!proof.exists, 409, "An attempt already exists for this account. Contact your administrator.");
      const exam = await tx.get(db.doc(`exams/${examId}`));
      const pinRef = db.doc(`examPins/${id}`);
      const pin = await tx.get(pinRef);
      assert(exam.exists && exam.data().status === "published" && exam.data().paperVersion,
        409, "This exam must be published using the new exam setup before students can start.");
      assert(pin.exists, 403, "Your administrator has not assigned you a PIN for this exam.");
      const access = pin.data();
      assert((access.lockedUntilMs || 0) <= now(), 429, "Too many incorrect PINs. Wait 15 minutes or ask your administrator to reset your PIN.");
      if (!pinMatches(examId, user.uid, input.pin, access.digest)) {
        const attempts = Number(access.attempts || 0) + 1;
        tx.update(pinRef, { attempts: attempts >= 5 ? 0 : attempts, lockedUntilMs: attempts >= 5 ? now() + 900000 : 0 });
        return { invalidPin: true };
      }
      const paper = await tx.get(db.doc(`examPapers/${exam.data().paperVersion}`));
      assert(paper.exists, 409, "The published paper is unavailable.");
      const questions = paper.data().questions;
      const sessionData = { schemaVersion: 2, examId, examTitle: exam.data().title, paperVersion: paper.id,
        studentUid: user.uid, studentName: user.displayName, studentUsername: user.username || "",
        studentEmail: user.email || "", status: "started", answers: {},
        questionOrder: shuffled(questions.map((question) => question.id)),
        optionOrderByQuestion: Object.fromEntries(questions.map((question) => [question.id, shuffled(["A", "B", "C", "D"])])),
        startedAtMs: now(), expiresAtMs: now() + Number(exam.data().duration) * 60000,
        tabSwitchCount: 0, integrityWarnings: 0, lastActivityAtMs: now(), lastSeenAt: stamp(), startedAt: stamp(), updatedAt: stamp() };
      tx.create(ref, sessionData);
      tx.create(proofRef, { paperVersion: paper.id, studentUid: user.uid, createdAt: stamp() });
      tx.update(pinRef, { usedAt: stamp(), attempts: 0 });
      return { session: safeSession(sessionData, id), questions: publicQuestions(questions), serverNowMs: now() };
    });
    assert(!result.invalidPin, 403, "Incorrect exam PIN. Enter the PIN assigned to your account for this exam.");
    return result;
  }

  async function progress(user, input) {
    student(user);
    const id = `${documentId(input.examId)}_${user.uid}`;
    return db.runTransaction(async (tx) => {
      const ref = db.doc(`examSessions/${id}`);
      const snapshot = await tx.get(ref);
      assert(snapshot.exists, 404, "Exam session not found.");
      const session = snapshot.data();
      const proof = await tx.get(db.doc(`examSessionProofs/${id}`));
      assert(session.studentUid === user.uid && (!proof.exists || proof.data().studentUid === user.uid),
        403, "This attempt has an account mismatch. Contact your administrator.");
      assert(proof.exists && proof.data().paperVersion === session.paperVersion, 409, "This session needs administrator migration.");
      if (session.status === "submitted") return { closed: true };
      assert(session.schemaVersion === 2, 409, "This session needs administrator review.");
      if (now() >= session.expiresAtMs) return { expired: true };
      const paper = await tx.get(db.doc(`examPapers/${session.paperVersion}`));
      const answers = cleanAnswers(input.answers, paper.data().questions);
      const count = Math.max(Number(session.tabSwitchCount || 0), Math.min(1000, Number(input.tabSwitchCount) || 0));
      tx.update(ref, { answers, tabSwitchCount: count, integrityWarnings: count,
        lastActivityAtMs: now(), lastSeenAt: stamp(), updatedAt: stamp() });
      return { ok: true };
    });
  }

  async function submit(user, input) {
    student(user);
    const id = `${documentId(input.examId)}_${user.uid}`;
    return db.runTransaction(async (tx) => {
      const ref = db.doc(`examSessions/${id}`);
      const snapshot = await tx.get(ref);
      assert(snapshot.exists, 404, "Exam session not found. Submission was kept on this device.");
      const session = snapshot.data();
      const proof = await tx.get(db.doc(`examSessionProofs/${id}`));
      assert(session.studentUid === user.uid && (!proof.exists || proof.data().studentUid === user.uid),
        403, "This attempt has an account mismatch. Contact your administrator.");
      assert(proof.exists && (session.status === "submitted" || proof.data().paperVersion === session.paperVersion),
        409, "This old attempt needs administrator migration. Your submission stays saved on this device.");
      if (session.status === "submitted") return { ok: true, alreadySubmitted: true };
      assert(session.schemaVersion === 2 && session.paperVersion, 409, "This old attempt needs administrator review; your saved submission is retained.");
      const paper = await tx.get(db.doc(`examPapers/${session.paperVersion}`));
      assert(paper.exists, 409, "Exam answer key unavailable. Contact your administrator.");
      const answers = cleanAnswers(input.answers, paper.data().questions);
      const marks = grade(paper.data().questions, answers);
      const submissionReason = ["manual", "timeout", "fullscreen-exit", "tab-switch-limit"].includes(input.submissionReason)
        ? input.submissionReason : "manual";
      const tabSwitchCount = Math.max(Number(session.tabSwitchCount || 0), Math.min(1000, Number(input.tabSwitchCount) || 0));
      // Offline client timestamps are evidence for staff, never a trusted server deadline.
      const lateSync = now() > session.expiresAtMs + 30000;
      const closed = { answers, status: "submitted", submissionReason, tabSwitchCount, integrityWarnings: tabSwitchCount,
        submittedAtMs: now(), clientReportedSubmittedAtMs: Number(input.closedAtMs) || null,
        lateSync, requiresReview: lateSync || Boolean(session.legacySession), lastActivityAtMs: now(), submittedAt: stamp(), updatedAt: stamp() };
      tx.update(ref, closed);
      tx.create(db.doc(`examResults/${id}`), { ...safeSession(session, id), ...closed, ...marks,
        totalAutoScore: marks.finalScore, schemaVersion: 2 });
      return { ok: true };
    });
  }

  async function reviewResult(user, input) {
    admin(user);
    const id = documentId(input.resultId);
    return db.runTransaction(async (tx) => {
      const ref = db.doc(`examResults/${id}`);
      const result = await tx.get(ref);
      assert(result.exists, 404, "Result not found.");
      const score = Number(result.data().finalScore ?? result.data().totalAutoScore);
      const maxMarks = Number(result.data().maxMarks);
      assert(Number.isFinite(score) && maxMarks > 0 && score >= 0 && score <= maxMarks, 409,
        "This historical result has no valid score total. Review it outside the automatic rankings.");
      tx.update(ref, { requiresReview: false, reviewedBy: user.uid, reviewedAt: stamp() });
      tx.update(db.doc(`examSessions/${id}`), { requiresReview: false });
      return { ok: true };
    });
  }

  async function execute(user, action, input) {
    const actions = { "account.verify": async (account) => {
      await db.doc(`users/${account.uid}`).update({ lastLoginAt: stamp() });
      return { role: account.role };
    }, "students.create": createStudent, "students.access": setAccess, "users.role": setRole,
      "exams.publish": publish, "exams.assign": assignPins, "exam.start": start, "exam.progress": progress,
      "exam.submit": submit, "results.review": reviewResult };
    assert(Object.hasOwn(actions, action), 404, "Unknown action.");
    return actions[action](user, input);
  }
  return { identity, execute };
}
