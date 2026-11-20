import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeBackend } from './support.mjs';
import { createService } from '../server/service.mjs';
import { canonicalRole, validRole, ASSIGNABLE_ROLES } from '../server/domain.mjs';

test('retired role names map onto the four staff roles', () => {
  assert.equal(canonicalRole('examofficer'), 'admin');
  assert.equal(canonicalRole('teacher_admin'), 'teacher');
  for (const role of ['superadmin', 'admin', 'teacher', 'invigilator', 'student']) assert.equal(canonicalRole(role), role);
  assert(validRole('examofficer') && validRole('teacher_admin'));
  assert(!validRole('principal'));
  assert.deepEqual(ASSIGNABLE_ROLES, ['admin', 'teacher', 'invigilator']);
});

test('accounts saved with a retired role keep working under the new role', async () => {
  const b = fakeBackend({
    'users/officer': { role: 'examofficer', displayName: 'Officer' },
    'users/tea': { role: 'teacher_admin', displayName: 'Tea', approvalStatus: 'approved' },
    'users/odd': { role: 'principal' },
  });
  const service = createService(b);
  assert.equal((await service.identity('officer')).role, 'admin');
  assert.equal((await service.identity('tea')).role, 'teacher');
  await assert.rejects(service.identity('odd'), { status: 403 });
});

test('new staff and role changes only accept the four current roles', async () => {
  const b = fakeBackend();
  const service = createService(b);
  const owner = { uid: 'owner', role: 'superadmin' };
  for (const role of ['examofficer', 'teacher_admin', 'superadmin', 'principal']) {
    await assert.rejects(
      service.execute(owner, 'staff.create', { requestId: `r-${role}`, username: 'staff-one', displayName: 'Staff One', email: 'staff@example.test', password: 'a-long-password', role }),
      { status: 400 },
    );
  }
});
