import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextUpdatedAt } from '../src/common/resource-edit';
test('resource timestamp tokens reject stale edits and advance monotonically in the same millisecond', () => {
  const current = new Date(Date.now() + 60000);
  assert.equal(
    nextUpdatedAt(current, current.toISOString()).getTime(),
    current.getTime() + 1,
  );
  assert.throws(
    () => nextUpdatedAt(current, new Date(current.getTime() - 1).toISOString()),
    { status: 409 },
  );
  assert.ok(nextUpdatedAt(current) > current);
});
