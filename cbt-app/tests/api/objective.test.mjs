import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

assert(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Both emulators are required');
const projectId = 'demo-cbt-school';
const app = initializeApp({ projectId }, 'api-tests');
const auth = getAuth(app); const db = getFirestore(app);
const password = 'Emulator-only-password-123';
let server, ownerToken;
async function login(email) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result.idToken;
}
async function api(token, action, input = {}, expected = 200) {
  const response = await fetch('http://127.0.0.1:8787/api/cbt', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ ...input, action }) });
  const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
}
before(async () => {
  const owner = await auth.createUser({ email: 'api-owner@example.test', password });
  await db.doc(`users/${owner.uid}`).set({ role: 'superadmin', displayName: 'Owner' });
  ownerToken = await login('api-owner@example.test');
  server = spawn(process.execPath, ['../server/dev.mjs'], { env: { ...process.env, GCLOUD_PROJECT: projectId }, stdio: 'inherit' });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { await fetch('http://127.0.0.1:8787'); ready = true; break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert(ready, 'API server did not start');
});
after(async () => { if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; } await deleteApp(app); });
test('real HTTP API rejects missing and invalid authentication', async () => {
  await api(null, 'school.save', {}, 401);
  await api('invalid-token', 'school.save', {}, 401);
});
test('objective paper completes through authenticated HTTP with private marking and controlled release', async () => {
  const school = { name: 'Objective Pilot School', academicSession: '2026/2027', term: 'First', classes: ['JSS1 A'], subjects: ['Mathematics'] };
  await api(ownerToken, 'school.save', school);
  const student = await api(ownerToken, 'students.create', { username: 'http-student', displayName: 'HTTP Student', password, className: 'JSS1 A', academicSession: school.academicSession, subjects: ['Mathematics'] });
  const studentToken = await login('http-student@students.cbt.invalid');
  await api(studentToken, 'school.save', school, 403);
  const exam = await api(ownerToken, 'exams.create', { ...school, className: 'JSS1 A', subject: 'Mathematics', title: 'Objective HTTP paper', duration: 10, category: 'exam', weight: 100 });
  const examId = exam.id || exam.examId;
  assert(examId, JSON.stringify(exam));
  await db.doc('questions/http-question').set({ examId, createdBy: 'fixture', text: '2 + 2?', options: { A: '3', B: '4', C: '5', D: '6' }, correctAnswer: 'B', marks: 2 });
  await api(ownerToken, 'exams.publish', { examId });
  const { pins } = await api(ownerToken, 'exams.assign', { examId, studentIds: [student.uid] });
  const input = { examId, deviceId: 'http-device' };
  const packet = await api(studentToken, 'exam.start', { ...input, pin: pins[0].pin });
  assert(!JSON.stringify(packet).includes('correctAnswer'));
  assert(!JSON.stringify(packet).includes('pinHash'));
  await api(studentToken, 'exam.start', { examId, deviceId: 'second-device' }, 409);
  const answers = { [packet.questions[0].id]: 'B' };
  await api(studentToken, 'exam.progress', { ...input, revision: 2, answers });
  await api(studentToken, 'exam.progress', { ...input, revision: 1, answers: {} });
  const resumed = await api(studentToken, 'exam.start', input);
  assert.deepEqual(resumed.session.answers, answers);
  const submission = { ...input, answers, submissionId: 'http-final', submissionReason: 'manual', finalScore: 999 };
  await api(studentToken, 'exam.submit', submission);
  await api(studentToken, 'exam.submit', submission);
  const resultId = `${examId}_${student.uid}`;
  let result = (await db.doc(`examResults/${resultId}`).get()).data();
  assert.equal(result.finalScore, 2); assert.equal(result.released, false);
  assert.equal((await db.collection('examResults').where('studentUid', '==', student.uid).get()).size, 1);
  await api(studentToken, 'results.manage', { resultId, operation: 'release', reason: 'Forged release' }, 403);
  await api(ownerToken, 'results.manage', { resultId, operation: 'release', reason: 'School approved marks' });
  result = (await db.doc(`examResults/${resultId}`).get()).data(); assert.equal(result.released, true);
  await api(ownerToken, 'students.access', { studentId: student.uid, loginDisabled: true });
  await api(studentToken, 'exam.start', input, 403);
});

test('self-registered identity cannot author until a verified superadmin approval', async () => {
  const account = await auth.createUser({ email: 'http-teacher@example.test', password });
  const token = await login('http-teacher@example.test');
  await api(token, 'teachers.register', { displayName: 'HTTP Teacher', role: 'superadmin', approvalStatus: 'approved' });
  await api(token, 'account.verify');
  await api(token, 'exams.create', {}, 403);
  await api(token, 'teachers.review', { uid: account.uid, decision: 'approve' }, 403);
  const decision = { uid: account.uid, decision: 'approve', reason: 'Approved employee', classes: ['JSS1 A'], subjects: ['Mathematics'] };
  await api(ownerToken, 'teachers.review', decision, 409);
  await auth.updateUser(account.uid, { emailVerified: true });
  await api(ownerToken, 'teachers.review', decision);
  const result = await api(token, 'exams.create', { title: 'Private HTTP paper', duration: 10, academicSession: '2026/2027', term: 'First', className: 'JSS1 A', subject: 'Mathematics', weight: 100 });
  assert.equal((await db.doc(`exams/${result.id}`).get()).data().createdBy, account.uid);
  await api(ownerToken, 'teachers.review', { ...decision, decision: 'suspend' });
  await api(token, 'exams.create', {}, 403);
});
test('LAN grant HTTP synchronization authenticates its own credential, isolates candidates and grades once', async()=>{
 const student=await api(ownerToken,'students.create',{username:'lan-http-student',displayName:'LAN HTTP Student',password,className:'JSS1 A',academicSession:'2026/2027',subjects:['Mathematics']});
 const exam=await api(ownerToken,'exams.create',{title:'LAN HTTP',duration:20,className:'JSS1 A',subject:'Mathematics',academicSession:'2026/2027',term:'First'});
 await db.doc('questions/lan-http-q').set({examId:exam.id,text:'2+2',options:{A:'4',B:'3',C:'2',D:'1'},correctAnswer:'A',marks:2});await api(ownerToken,'exams.publish',{examId:exam.id});
 const bundle=await api(ownerToken,'lan.export',{examId:exam.id,studentIds:[student.uid],requestId:'http-lan-export'});
 assert.equal(bundle.questions[0].correctAnswer,undefined);assert.deepEqual(await api(ownerToken,'lan.export',{examId:exam.id,studentIds:[student.uid],requestId:'http-lan-export'}),bundle);
 const studentToken=await login('lan-http-student@students.cbt.invalid');await api(studentToken,'exam.start',{examId:exam.id,deviceId:'one'},409);await api(studentToken,'lan.download',{grantId:bundle.grantId},403);
 const record={uid:student.uid,answers:{'lan-http-q':'A'},startedAtMs:Date.now(),submittedAtMs:Date.now()+1000};
 await api('x'.repeat(64),'lan.sync',{grantId:bundle.grantId,records:[record]},401);const payload={grantId:bundle.grantId,records:[record]};await api(bundle.secret,'lan.sync',payload);await api(bundle.secret,'lan.sync',payload);
 const result=(await db.doc(`examResults/${exam.id}_${student.uid}`).get()).data();assert.equal(result.finalScore,2);assert.equal(result.requiresReview,true);assert.equal(result.released,false);
});
test('staff provisioning retries return one account and final staff role',async()=>{
 const input={requestId:'staff-http-id',username:'staff-http',displayName:'Staff HTTP',email:'staff-contact@example.test',password,role:'teacher_admin'};
 const first=await api(ownerToken,'staff.create',input);const second=await api(ownerToken,'staff.create',input);assert.equal(first.uid,second.uid);assert.equal((await db.doc(`users/${first.uid}`).get()).data().role,'teacher_admin');assert.equal((await auth.getUser(first.uid)).email,'staff-http@students.cbt.invalid');
});
