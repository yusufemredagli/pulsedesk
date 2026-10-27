import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canManageOperations,
  canManageWorkspace,
  durationLabel,
  durationMinutes,
  listQuery,
} from '../src/features/management/model';
import { mutationMessage } from '../src/features/management/mutation';
import { ApiError } from '../src/lib/api/client';
test('customer/team and workspace/SLA capabilities reflect distinct allowed role sets', () => {
  for (const role of ['OWNER', 'ADMIN', 'MANAGER'])
    assert.equal(canManageOperations(role), true);
  for (const role of ['AGENT', 'VIEWER', undefined])
    assert.equal(canManageOperations(role), false);
  for (const role of ['OWNER', 'ADMIN'])
    assert.equal(canManageWorkspace(role), true);
  for (const role of ['MANAGER', 'AGENT', 'VIEWER', undefined])
    assert.equal(canManageWorkspace(role), false);
});
test('readable SLA durations normalize exact whole minutes and enforce existing backend bounds', () => {
  assert.equal(durationMinutes('15', 'minutes'), 15);
  assert.equal(durationMinutes('2', 'hours'), 120);
  assert.equal(durationMinutes('0,25', 'hours'), 15);
  assert.equal(durationMinutes('24', 'hours'), 1440);
  assert.equal(durationMinutes('8760', 'hours'), 525600);
  for (const [value, unit] of [
    ['0', 'minutes'],
    ['-1', 'hours'],
    ['1.5', 'minutes'],
    ['8761', 'hours'],
    ['NaN', 'minutes'],
    ['Infinity', 'hours'],
    ['1', 'seconds'],
  ])
    assert.throws(() => durationMinutes(value!, unit!));
  assert.equal(durationLabel(120), '2 saat');
  assert.equal(durationLabel(15), '15 dakika');
});
test('directory searches and pages remain server queries without changing resource identifiers', () => {
  const query = new URL(
    listQuery('/customers', ' Acme & Atlas ', 3, 'name:asc'),
    'http://local',
  );
  assert.equal(query.searchParams.get('search'), 'Acme & Atlas');
  assert.equal(query.searchParams.get('page'), '3');
  assert.equal(query.searchParams.get('limit'), '20');
  assert.equal(query.searchParams.get('sort'), 'name:asc');
  assert.equal(
    new URL(listQuery('/teams', ' ', 1), 'http://local').searchParams.has(
      'search',
    ),
    false,
  );
});
test('conflicts and safe server failures have actionable Turkish messages', () => {
  assert.match(mutationMessage(new ApiError(409)), /başka bir kullanıcı/);
  assert.match(mutationMessage(new ApiError(409)), /yeniden açın/);
  assert.match(mutationMessage(new ApiError(403)), /yetkiniz yok/);
  assert.match(mutationMessage(new ApiError(500)), /geçici/);
  assert.match(mutationMessage(null), /İşlem tamamlanamadı/);
});
