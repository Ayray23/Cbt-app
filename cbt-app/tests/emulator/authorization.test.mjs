import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createService } from '../../../server/service.mjs';
let env; let app; let db;
const projectId = 'demo-cbt-school';
before(async () => {
  assert(process.env.FIRESTORE_EMULATOR_HOST, 'Never run this suite against production');
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync(new URL('../../../cloud-functions/firestore.rules', import.meta.url), 'utf8') } });
  app = initializeApp({ projectId }, 'school-tests'); db = getFirestore(app);
  await db.doc('users/admin').set({ role: 'admin' });
  await db.doc('users/alice').set({ role: 'student', className: 'JSS1 A', subjects: ['Mathematics'], academicSession: '2026/2027' });
  await db.doc('users/bob').set({ role: 'student', loginDisabled: true });
  await db.doc('questions/private').set({ examId: 'math', correctAnswer: 'B' });
  await db.doc('examSessions/math_alice').set({ studentUid: 'alice', schemaVersion: 2, status: 'started' });
  await db.doc('examResults/math_alice').set({ studentUid: 'alice', released: false });
});
after(async () => { await env?.cleanup(); if (app) await deleteApp(app); });
test('real rules deny anonymous, unprovisioned and blocked students', async () => {
  for (const client of [env.unauthenticatedContext(), env.authenticatedContext('unknown'), env.authenticatedContext('bob')]) await assertFails(getDoc(doc(client.firestore(), 'exams', 'math')));
});
test('students cannot provision themselves, read keys or change sessions', async () => {
  const client = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(client, 'users', 'alice'), { role: 'admin' }));
  for (const path of ['questions/private', 'examPins/math_alice', 'examPapers/version', 'examSessionProofs/math_alice']) await assertFails(getDoc(doc(client, path)));
  await assertFails(updateDoc(doc(client, 'examSessions', 'math_alice'), { answers: { q: 'B' } }));
  await assertSucceeds(getDoc(doc(client, 'examSessions', 'math_alice')));
});
test('results remain private until release and only the owner can read them', async () => {
  const client = env.authenticatedContext('alice').firestore();
  await assertFails(getDoc(doc(client, 'examResults/math_alice')));
  await db.doc('examResults/math_alice').update({ released: true });
  await assertSucceeds(getDoc(doc(client, 'examResults/math_alice')));
  await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(), 'examResults/math_alice')));
});
test('admins can read answer keys but cannot forge direct result writes', async () => {
  const client = env.authenticatedContext('admin').firestore();
  await assertSucceeds(getDoc(doc(client, 'questions/private')));
  await assertFails(updateDoc(doc(client, 'examResults/math_alice'), { finalScore: 100 }));
});
test('real Firestore transactions publish, assign, start and submit idempotently', async () => {
  const service = createService({ db, auth: {}, fields: FieldValue, now: () => 100000 });
  const admin = { uid: 'admin', role: 'admin' };
  const alice = { uid: 'alice', ...(await db.doc('users/alice').get()).data() };
  await db.doc('exams/integration').set({ title: 'Integration', duration: 10, status: 'draft' });
  await db.doc('questions/integration').set({ examId: 'integration', text: '2 + 2', options: { A: '3', B: '4', C: '5', D: '6' }, marks: 2, correctAnswer: 'B' });
  await service.execute(admin, 'exams.publish', { examId: 'integration' });
  const { pins } = await service.execute(admin, 'exams.assign', { examId: 'integration', studentIds: ['alice'] });
  const packet = await service.execute(alice, 'exam.start', { examId: 'integration', deviceId: 'device-one', pin: pins[0].pin });
  assert.equal(packet.questions[0].correctAnswer, undefined);
  await assert.rejects(service.execute(alice, 'exam.start', { examId: 'integration', deviceId: 'device-two' }), { status: 409 });
  const payload = { examId: 'integration', deviceId: 'device-one', answers: { integration: 'B' } };
  await Promise.all([service.execute(alice, 'exam.submit', payload), service.execute(alice, 'exam.submit', payload)]);
  assert.equal((await db.doc('examResults/integration_alice').get()).data().finalScore, 2);
});
test('staff role boundaries and teacher question ownership are enforced by real rules', async () => {
  await db.doc('users/teacher').set({ role: 'teacher', assignedClasses: ['JSS1 A'], assignedSubjects: ['Mathematics'] });
  await db.doc('users/invigilator').set({ role: 'invigilator' });
  await db.doc('exams/teacher-paper').set({ status: 'draft', createdBy: 'teacher', className: 'JSS1 A', subject: 'Mathematics' });
  const teacher = env.authenticatedContext('teacher').firestore(); const invigilator = env.authenticatedContext('invigilator').firestore();
  await assertSucceeds(setDoc(doc(teacher, 'questions/teacher-q'), { examId: 'teacher-paper', createdBy: 'teacher', text: 'Example' }));
  await assertFails(setDoc(doc(teacher, 'questions/other-q'), { examId: 'math', createdBy: 'teacher', text: 'Unauthorized' }));
  await assertFails(updateDoc(doc(teacher, 'exams/teacher-paper'), { status: 'published' }));
  await assertFails(getDoc(doc(invigilator, 'questions/teacher-q')));
  await assertSucceeds(getDoc(doc(invigilator, 'examSessions/math_alice')));
  await assertFails(getDoc(doc(invigilator, 'examResults/math_alice')));
  await db.doc('exams/teacher-paper').update({ status: 'published' });
  await assertFails(updateDoc(doc(teacher, 'questions/teacher-q'), { text: 'Tampered' }));
});
