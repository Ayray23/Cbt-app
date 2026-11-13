import { teacherRole } from './teachers.mjs';
import { assert, documentId } from './domain.mjs';

export const LEVELS = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];
export function schoolFields(input) {
  const academicSession = String(input.academicSession || '').trim();
  const term = String(input.term || '').trim();
  const className = String(input.className || '').trim();
  const subject = String(input.subject || '').trim();
  assert(/^20\d{2}\/20\d{2}$/.test(academicSession) && Number(academicSession.slice(5)) === Number(academicSession.slice(0, 4)) + 1, 400, 'Use an academic session such as 2026/2027.');
  assert(['First', 'Second', 'Third'].includes(term), 400, 'Select a school term.');
  assert(className.length > 0 && className.length <= 60 && subject.length > 0 && subject.length <= 100, 400, 'Select a class and subject.');
  const category = input.category || 'exam';
  assert(['ca', 'exam', 'practice', 'mock'].includes(category), 400, 'Invalid assessment category.');
  const weight = Number(input.weight ?? 100);
  assert(Number.isFinite(weight) && weight > 0 && weight <= 100, 400, 'Assessment weight must be greater than 0 and at most 100.');
  return { academicSession, term, className, subject, category, weight };
}

export function eligible(profile, exam) {
  return !profile.loginDisabled && (!exam.className || profile.className === exam.className) &&
    (!exam.academicSession || profile.academicSession === exam.academicSession) &&
    (!exam.subject || (Array.isArray(profile.subjects) && profile.subjects.includes(exam.subject)));
}

export function schoolActions({ db, auth, fields, now, admin, examiner, author, invigilate }) {
  const stamp = () => fields.serverTimestamp();
  const audit = (tx, user, action, target, details) => tx.create(db.collection('auditLogs').doc(), {
    actorUid: user.uid, workspaceUid: action === 'staff.assign' ? target : user.uid, action, target, details, createdAt: stamp(), createdAtMs: now(),
  });
  const reason = (input) => {
    const value = String(input.reason || '').trim();
    assert(value.length >= 5 && value.length <= 500, 400, 'Give a reason of 5-500 characters.');
    return value;
  };
  return {
    'questions.copy': async (user, input) => {
      author(user); const id = documentId(input.questionId); const examId = documentId(input.examId);
      return db.runTransaction(async tx => {
        const source = await tx.get(db.doc(`questions/${id}`)); const target = await tx.get(db.doc(`exams/${examId}`));
        assert(source.exists && target.exists && target.data().status === 'draft', 400, 'Select a question and a draft target paper.');
        if (user.role !== 'superadmin') assert(source.data().createdBy === user.uid && target.data().createdBy === user.uid && (!teacherRole(user.role) || ((user.assignedClasses || []).includes(target.data().className) && (user.assignedSubjects || []).includes(target.data().subject))), 403, 'Only your assigned draft papers are editable.');
        const ref = db.collection('questions').doc();
        tx.create(ref, { ...source.data(), examId, createdBy: target.data().createdBy || user.uid, editedBy: user.uid, createdAt: stamp(), copiedFrom: id });
        tx.create(db.collection('auditLogs').doc(), { actorUid: user.uid, workspaceUid: target.data().createdBy || user.uid, action: 'questions.copy', target: ref.id, details: { sourceId: id, examId }, createdAt: stamp(), createdAtMs: now() });
        return { ok: true };
      });
    },
    'attendance.set': async (user, input) => {
      invigilate(user); const id = documentId(input.assignmentId); const note = reason(input);
      assert(['present', 'absent'].includes(input.attendance), 400, 'Select present or absent.');
      return db.runTransaction(async tx => {
        const ref = db.doc(`examAssignments/${id}`); const row = await tx.get(ref); const session = await tx.get(db.doc(`examSessions/${id}`));
        assert(row.exists, 404, 'Assignment not found.');
        assert(!(input.attendance === 'absent' && session.exists), 409, 'A student with an attempt cannot be marked absent.');
        tx.update(ref, { attendance: input.attendance, markedBy: user.uid, markedAt: stamp() });
        audit(tx, user, 'attendance.set', id, { attendance: input.attendance, reason: note }); return { ok: true };
      });
    },
    'staff.assign': async (user, input) => {
      assert(user.role === 'superadmin', 403, 'Only the superadmin can assign teaching access.'); const uid = documentId(input.uid);
      assert(Array.isArray(input.classes) && Array.isArray(input.subjects), 400, 'Select classes and subjects.');
      return db.runTransaction(async tx => {
        const ref = db.doc(`users/${uid}`); const profile = await tx.get(ref); const settings = await tx.get(db.doc('school/settings'));
        assert(profile.exists && teacherRole(profile.data().role) && settings.exists, 400, 'Select a teacher and configure the school first.');
        assert(input.classes.every(c => settings.data().classes.includes(c)) && input.subjects.every(s => settings.data().subjects.includes(s)), 400, 'Choose configured classes and subjects.');
        tx.update(ref, { assignedClasses: [...new Set(input.classes)], assignedSubjects: [...new Set(input.subjects)], updatedAt: stamp() });
        audit(tx, user, 'staff.assign', uid, { classes: input.classes, subjects: input.subjects }); return { ok: true };
      });
    },
    'exams.create': async (user, input) => {
      author(user); const academic = schoolFields(input);
      const settings = await db.doc('school/settings').get();
      assert(settings.exists && settings.data().classes.includes(academic.className) && settings.data().subjects.includes(academic.subject), 400, 'Configure the class and subject in School setup first.');
      if (teacherRole(user.role)) assert((user.assignedClasses || []).includes(academic.className) && (user.assignedSubjects || []).includes(academic.subject), 403, 'This class and subject are not assigned to you.');
      const duration = Number(input.duration); const title = String(input.title || '').trim();
      assert(title.length > 0 && title.length <= 160 && Number.isInteger(duration) && duration >= 1 && duration <= 480, 400, 'Enter a title and duration of 1-480 minutes.');
      const scheduleStartAtMs = Number(input.scheduleStartAtMs || 0); const scheduleEndAtMs = Number(input.scheduleEndAtMs || 0);
      assert(Number.isFinite(scheduleStartAtMs) && Number.isFinite(scheduleEndAtMs) && scheduleStartAtMs >= 0 && scheduleEndAtMs >= 0 && (!scheduleEndAtMs || scheduleEndAtMs > scheduleStartAtMs), 400, 'Invalid exam entry window.');
      const ref = db.collection('exams').doc();
      await ref.create({ ...academic, title, duration, allowCalculator: input.allowCalculator === true, instructions: String(input.instructions || '').slice(0, 4000), scheduleStartAtMs, scheduleEndAtMs, status: 'draft', schemaVersion: 2, questionCount: 0, createdAt: stamp(), createdBy: user.uid });
      await db.collection('auditLogs').doc().create({ actorUid: user.uid, workspaceUid: user.uid, action: 'exams.create', target: ref.id, details: { title, className: academic.className, subject: academic.subject }, createdAt: stamp(), createdAtMs: now() });
      return { id: ref.id };
    },
    'exams.archive': async (user, input) => {
      examiner(user); const id = documentId(input.examId);
      return db.runTransaction(async tx => {
        const ref = db.doc(`exams/${id}`); const exam = await tx.get(ref);
        assert(exam.exists, 404, 'Exam not found.');
        const sessions = await tx.get(db.collection('examSessions').where('examId', '==', id));
        assert(!sessions.docs.some(s => s.data().status === 'started'), 409, 'Resolve active attempts before archiving this exam.');
        tx.update(ref, { status: 'archived', updatedAt: stamp() }); audit(tx, user, 'exams.archive', id, {}); return { ok: true };
      });
    },
    'school.save': async (user, input) => {
      admin(user);
      const name = String(input.name || '').trim();
      assert(name.length >= 2 && name.length <= 120, 400, 'Enter the school name.');
      const classes = [...new Set((input.classes || []).map(x => String(x).trim()).filter(Boolean))];
      const subjects = [...new Set((input.subjects || []).map(x => String(x).trim()).filter(Boolean))];
      assert(classes.length > 0 && classes.length <= 100 && classes.every(x => x.length <= 60), 400, 'Enter 1-100 class arms.');
      assert(subjects.length > 0 && subjects.length <= 100 && subjects.every(x => x.length <= 100), 400, 'Enter 1-100 subjects.');
      const grades = input.grades || [];
      assert(Array.isArray(grades) && grades.length <= 20 && grades.every(g => Number.isFinite(g.min) && g.min >= 0 && g.min <= 100 && typeof g.label === 'string' && g.label.length > 0 && g.label.length <= 30 && typeof g.remark === 'string' && g.remark.length <= 120), 400, 'Invalid grade thresholds.');
      assert(!grades.length || (grades.some(g => g.min === 0) && new Set(grades.map(g => g.min)).size === grades.length), 400, 'Grades need a unique minimum for each band, including zero.');
      const value = { grades: [...grades].sort((a, b) => b.min - a.min), name, address: String(input.address || '').slice(0, 300), contact: String(input.contact || '').slice(0, 120), classes, subjects,
        academicSession: schoolFields({ ...input, className: classes[0], subject: subjects[0] }).academicSession,
        term: input.term, updatedAt: stamp() };
      return db.runTransaction(async tx => { tx.set(db.doc('school/settings'), value); audit(tx, user, 'school.settings', 'settings', { name }); return { ok: true }; });
    },
    'students.update': async (user, input) => {
      admin(user);
      const uid = documentId(input.studentId);
      const displayName = String(input.displayName || '').trim();
      assert(displayName.length >= 2 && displayName.length <= 120, 400, 'Enter a student name.');
      const email = String(input.email || '').trim().toLowerCase();
      assert(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, 'Enter a valid contact email.');
      const subjects = [...new Set((input.subjects || []).map(x => String(x).trim()).filter(Boolean))];
      assert(subjects.length > 0 && subjects.length <= 100, 400, 'Too many subjects.');
      return db.runTransaction(async tx => {
        const ref = db.doc(`users/${uid}`); const existing = await tx.get(ref);
        const settings = await tx.get(db.doc('school/settings'));
        assert(existing.exists && existing.data().role === 'student', 404, 'Student not found.');
        assert(settings.exists && settings.data().classes.includes(input.className) && subjects.every(s => settings.data().subjects.includes(s)), 400, 'Select a configured class and subjects.');
        const value = { displayName, email, className: input.className, academicSession: settings.data().academicSession,
          admissionNumber: String(input.admissionNumber || '').trim().slice(0, 60), subjects, updatedAt: stamp() };
        tx.update(ref, value); audit(tx, user, 'students.update', uid, { before: existing.data().className || '', after: value.className, academicSession: value.academicSession });
        return { ok: true };
      });
    },
    'students.password': async (user, input) => {
      admin(user); const uid = documentId(input.studentId); const note = reason(input);
      assert(typeof input.password === 'string' && input.password.length >= 8 && input.password.length <= 128, 400, 'Use a password of 8-128 characters.');
      const profile = await db.doc(`users/${uid}`).get();
      assert(profile.exists && profile.data().role === 'student', 404, 'Student not found.');
      await auth.updateUser(uid, { password: input.password }); await auth.revokeRefreshTokens(uid);
      await db.runTransaction(async tx => { audit(tx, user, 'students.password-reset', uid, { reason: note }); });
      return { ok: true };
    },
    'sessions.intervene': async (user, input) => {
      invigilate(user); const id = documentId(input.sessionId); const note = reason(input);
      assert(['extend', 'transfer', 'incident'].includes(input.operation), 400, 'Invalid intervention.');
      return db.runTransaction(async tx => {
        const ref = db.doc(`examSessions/${id}`); const snapshot = await tx.get(ref);
        assert(snapshot.exists, 404, 'Session not found.'); const session = snapshot.data();
        const changes = { updatedAt: stamp() };
        if (input.operation !== 'incident') assert(session.status === 'started', 409, 'A submitted attempt cannot be reopened.');
        if (input.operation === 'extend') {
          const minutes = Number(input.minutes);
          assert(Number.isInteger(minutes) && minutes > 0 && minutes <= 120, 400, 'Add 1-120 minutes.');
          changes.expiresAtMs = Math.max(session.expiresAtMs, now()) + minutes * 60000;
        }
        if (input.operation === 'transfer') { changes.deviceId = "TRANSFER_REQUIRED"; changes.progressRevision = 0; }
        tx.update(ref, changes);
        audit(tx, user, `sessions.${input.operation}`, id, { reason: note, previousDeadline: session.expiresAtMs, newDeadline: changes.expiresAtMs || session.expiresAtMs });
        return { ok: true };
      });
    },
    'results.manage': async (user, input) => {
      examiner(user); const id = documentId(input.resultId); const note = reason(input);
      assert(['release', 'withhold', 'correct'].includes(input.operation), 400, 'Invalid result action.');
      return db.runTransaction(async tx => {
        const ref = db.doc(`examResults/${id}`); const snapshot = await tx.get(ref);
        assert(snapshot.exists, 404, 'Result not found.'); const result = snapshot.data();
        const changes = { updatedAt: stamp() };
        if (input.operation === 'release') { assert(!result.requiresReview && Number.isFinite(result.finalScore) && Number.isFinite(result.maxMarks) && result.maxMarks > 0 && result.finalScore >= 0 && result.finalScore <= result.maxMarks, 409, 'Review this result and its score total before release.'); changes.released = true; }
        if (input.operation === 'withhold') changes.released = false;
        if (input.operation === 'correct') {
          const score = Number(input.score);
          assert(Number.isFinite(score) && score >= 0 && score <= result.maxMarks, 400, 'Score must be between zero and the paper maximum.');
          changes.finalScore = score; changes.released = false;
        }
        tx.update(ref, changes); audit(tx, user, `results.${input.operation}`, id, { reason: note, oldScore: result.finalScore, newScore: changes.finalScore ?? result.finalScore });
        return { ok: true };
      });
    },
  };
}
