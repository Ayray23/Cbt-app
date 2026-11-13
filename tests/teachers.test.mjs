import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeBackend } from './support.mjs';
import { createService } from '../server/service.mjs';
const owner = { uid: 'owner', role: 'superadmin' };
function setup() {
  const b = fakeBackend({ 'school/settings': { classes: ['JSS1'], subjects: ['Maths'] } });
  const accounts = { alice: { email: 'alice@example.test', emailVerified: false }, bob: { email: 'bob@example.test', emailVerified: true } };
  b.auth.getUser = async uid => accounts[uid];
  const service = createService(b); return { ...b, service, accounts };
}
test('self-registration is idempotent, pending and cannot grant a chosen role or overwrite an existing account', async () => {
  const { service, records } = setup();
  await service.registerTeacher('alice', { displayName: 'Alice Teacher', role: 'superadmin', approvalStatus: 'approved' });
  assert.equal(records.get('users/alice').role, 'teacher_admin'); assert.equal(records.get('users/alice').approvalStatus, 'pending');
  await assert.rejects(service.identity('alice'), { status: 403 });
  assert.equal((await service.identity('alice', { allowPending: true })).role, 'teacher_admin');
  await service.registerTeacher('alice', { displayName: 'Second name' });
  assert.equal(records.get('users/alice').displayName, 'Alice Teacher');
  records.set('users/bob', { role: 'student' });
  await assert.rejects(service.registerTeacher('bob', { displayName: 'Bob Teacher' }), { status: 409 });
});
test('only superadmin can approve verified teachers with teaching assignments; suspension blocks existing tokens', async () => {
  const { service, records, accounts } = setup();
  await service.registerTeacher('alice', { displayName: 'Alice Teacher' });
  const input = { uid: 'alice', decision: 'approve', reason: 'School confirmed teacher', classes: ['JSS1'], subjects: ['Maths'] };
  await assert.rejects(service.execute({ uid: 'other', role: 'admin' }, 'teachers.review', input), { status: 403 });
  await assert.rejects(service.execute(owner, 'teachers.review', input), { status: 409 });
  accounts.alice.emailVerified = true;
  await service.execute(owner, 'teachers.review', input);
  assert.equal((await service.identity('alice')).approvalStatus, 'approved');
  await service.execute(owner, 'teachers.review', { ...input, decision: 'suspend' });
  await assert.rejects(service.identity('alice'), { status: 403 });
  assert([...records.values()].some(r => r.action === 'teachers.suspend'));
});
test('teacher admins can author their own papers but cannot create, copy or delete another teacher question', async () => {
  const { service, records } = setup();
  const alice = { uid: 'alice', role: 'teacher_admin', assignedClasses: ['JSS1'], assignedSubjects: ['Maths'] };
  records.set('exams/a', { createdBy: 'alice', status: 'draft', className: 'JSS1', subject: 'Maths' });
  records.set('exams/b', { createdBy: 'bob', status: 'draft', className: 'JSS1', subject: 'Maths' });
  const question = { question: '2+2?', options: { A: '1', B: '2', C: '3', D: '4' }, correctAnswer: 'D', marks: 1 };
  const own = await service.execute(alice, 'questions.create', { ...question, examId: 'a', createdBy: 'bob' });
  assert.equal(records.get(`questions/${own.id}`).createdBy, 'alice');
  const other = await service.execute(owner, 'questions.create', { ...question, examId: 'b' });
  await assert.rejects(service.execute(alice, 'questions.create', { ...question, examId: 'b' }), { status: 403 });
  await assert.rejects(service.execute(alice, 'questions.copy', { questionId: other.id, examId: 'a' }), { status: 403 });
  await assert.rejects(service.execute(alice, 'questions.delete', { questionId: other.id }), { status: 403 });
  await service.execute(alice, 'questions.delete', { questionId: own.id });
  assert(!records.has(`questions/${own.id}`));
  assert([...records.values()].some(r => r.action === 'questions.delete' && r.workspaceUid === 'alice'));
});
