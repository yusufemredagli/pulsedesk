import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commands,
  slaState,
  timeline,
  ticketQuery,
  type Ticket,
  type Sla,
} from '../src/features/operations/model';
import { Reconciliation } from '../src/lib/realtime/reconciliation';
const now = Date.parse('2026-10-25T12:00:00Z');
const sla: Sla = {
  id: 'sla',
  type: 'RESOLUTION',
  dueAt: new Date(now + 1800000).toISOString(),
  completedAt: null,
  breachedAt: null,
};
for (const role of ['OWNER', 'ADMIN', 'MANAGER'])
  test(`${role} sees explicit management commands`, () => {
    assert.deepEqual(commands('OPEN', role), ['triage', 'cancel']);
    assert.deepEqual(commands('TRIAGED', role), ['assign', 'cancel']);
    assert.deepEqual(commands('ASSIGNED', role), ['start', 'assign', 'cancel']);
    assert.deepEqual(commands('RESOLVED', role), ['close']);
  });
test('viewer is read only across every state and agent has only operational commands', () => {
  for (const status of [
    'OPEN',
    'TRIAGED',
    'ASSIGNED',
    'IN_PROGRESS',
    'WAITING_CUSTOMER',
    'RESOLVED',
    'CLOSED',
    'CANCELLED',
  ])
    assert.deepEqual(commands(status, 'VIEWER'), []);
  assert.deepEqual(commands('OPEN', 'AGENT'), []);
  assert.deepEqual(commands('ASSIGNED', 'AGENT'), ['start']);
  assert.deepEqual(commands('IN_PROGRESS', 'AGENT'), [
    'wait-for-customer',
    'resolve',
  ]);
  assert.deepEqual(commands('WAITING_CUSTOMER', 'AGENT'), ['resume']);
  assert.deepEqual(commands('RESOLVED', 'AGENT'), []);
});
test('terminal states have no commands for any role', () => {
  for (const status of ['CLOSED', 'CANCELLED'])
    for (const role of ['OWNER', 'AGENT', 'VIEWER'])
      assert.deepEqual(commands(status, role), []);
});
test('SLA threshold, overdue, completion, breach precedence and cancellation are derived without writes', () => {
  assert.equal(slaState(sla, 'OPEN', now).tone, 'warning');
  assert.equal(
    slaState(
      { ...sla, dueAt: new Date(now + 1800001).toISOString() },
      'OPEN',
      now,
    ).tone,
    'signal',
  );
  assert.equal(slaState(sla, 'OPEN', now + 1800000).label, 'Aşıldı');
  assert.equal(
    slaState(
      { ...sla, completedAt: new Date(now).toISOString() },
      'RESOLVED',
      now,
    ).label,
    'Tamamlandı',
  );
  assert.equal(
    slaState(
      {
        ...sla,
        completedAt: new Date(now).toISOString(),
        breachedAt: new Date(now).toISOString(),
      },
      'RESOLVED',
      now,
    ).label,
    'Aşıldı',
  );
  assert.equal(slaState(sla, 'CANCELLED', now).label, 'İptal Edildi');
  assert.equal(sla.completedAt, null);
});
test('server query preserves search, filters, page and sorting with URL encoding', () => {
  const url = new URL(
    ticketQuery(
      {
        search: ' acme & sons ',
        status: 'OPEN',
        priority: 'HIGH',
        assignedTeamId: 'team',
        assignedMemberId: 'member',
        sort: 'createdAt:asc',
      },
      3,
    ),
    'http://local',
  );
  assert.equal(url.searchParams.get('search'), 'acme & sons');
  assert.equal(url.searchParams.get('page'), '3');
  assert.equal(url.searchParams.get('limit'), '20');
  for (const key of [
    'status',
    'priority',
    'assignedTeamId',
    'assignedMemberId',
    'sort',
  ])
    assert.ok(url.searchParams.get(key));
});
test('empty list query does not send blank filter values', () => {
  const query = ticketQuery({ search: '   ', status: '' }, 1);
  assert.equal(query.includes('search='), false);
  assert.equal(query.includes('status='), false);
});
test('timeline combines comments, assignment and status with stable equal-time ordering', () => {
  const at = '2026-10-25T12:00:00Z';
  const ticket = {
    statusHistory: [
      {
        id: 'z',
        createdAt: at,
        toStatus: 'OPEN',
        changedBy: null,
        reason: null,
      },
    ],
    assignmentHistory: [
      {
        id: 'b',
        createdAt: at,
        assignedBy: { name: 'Alex' },
        assignedMember: { name: 'Zeynep' },
        assignedTeam: null,
      },
    ],
    comments: [
      {
        id: 'a',
        createdAt: at,
        visibility: 'INTERNAL',
        author: { name: 'Alex' },
        body: 'Staff context',
      },
      {
        id: 'b',
        createdAt: '2026-10-25T11:00:00Z',
        visibility: 'PUBLIC',
        author: null,
        body: 'Reply',
      },
    ],
  } as Ticket;
  const result = timeline(ticket);
  assert.deepEqual(
    result.map((row) => row.id),
    ['comment:b', 'assignment:b', 'comment:a', 'status:z'],
  );
  assert.equal(result[2]?.kind, 'INTERNAL');
  assert.match(result[1]!.title, /Zeynep/);
  assert.equal(ticket.comments[0]?.id, 'a');
});
test('HTTP observed versions suppress stale socket hints, equal-version comments remain valid', () => {
  const id = 'd47eb508-f6e7-46c8-a9c4-92ca95314221',
    org = 'd47eb508-f6e7-46c8-a9c4-92ca95314222';
  const r = new Reconciliation();
  r.observe(id, 4);
  const event = {
    schemaVersion: 1,
    eventId: 'd47eb508-f6e7-46c8-a9c4-92ca95314223',
    organizationId: org,
    ticketId: id,
    ticketNumber: 1,
    version: 3,
    occurredAt: new Date(now).toISOString(),
  };
  assert.equal(r.accept('ticket:assigned', event, org), null);
  assert.ok(r.accept('ticket:comment-added', { ...event, version: 4 }, org));
  r.reset();
  assert.ok(r.accept('ticket:created', { ...event, eventId: org }, org));
});
