import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ApiError, JsonTransport, apiBaseUrl } from '../src/lib/api/client';
import {
  SessionClient,
  SESSION_KEY,
  type SessionStorage,
} from '../src/lib/session/session-client';
import { routeDestination } from '../src/lib/session/routing';
import { Reconciliation } from '../src/lib/realtime/reconciliation';
import { RealtimeClient, type SocketLike } from '../src/lib/realtime/client';
import { ApplicationClient } from '../src/features/application/application-client';
import { validateAuth } from '../src/features/auth/validation';
import type { Membership, SessionResponse } from '../src/lib/api/contracts';
class MemoryStorage implements SessionStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const orgA = randomUUID(),
  orgB = randomUUID(),
  memberA = randomUUID(),
  memberB = randomUUID();
const memberships: Membership[] = [
  {
    organizationId: orgA,
    membershipId: memberA,
    organizationName: 'Signal Support',
    organizationSlug: 'signal',
    role: 'OWNER',
  },
  {
    organizationId: orgB,
    membershipId: memberB,
    organizationName: 'Other Support',
    organizationSlug: 'other',
    role: 'VIEWER',
  },
];
const accessA = 'signed-access-token-for-session-A-000',
  accessB = 'signed-access-token-for-session-B-111';
function session(
  accessToken = accessA,
  refreshToken = 'a'.repeat(64),
  members = memberships,
): SessionResponse {
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: 900,
    refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    user: {
      id: '0145b099-6371-40fe-bfc0-2fe3ac8602f0',
      name: 'Alex Morgan',
      email: 'alex@example.invalid',
      avatarUrl: null,
      isActive: true,
    },
    memberships: members,
  };
}
function json(value: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function baseFetch(
  extra?: (
    path: string,
    init?: RequestInit,
  ) => Promise<Response> | Response | undefined,
): typeof fetch {
  return async (input, init) => {
    const path = new URL(String(input)).pathname;
    const custom = await extra?.(path, init);
    if (custom) return custom;
    if (path === '/auth/login' || path === '/auth/register')
      return json(session());
    if (path === '/auth/refresh') return json(session(accessB, 'b'.repeat(64)));
    if (path === '/auth/me') return json({ user: session().user, memberships });
    if (path === '/auth/context') {
      const id = new Headers(init?.headers).get('x-organization-id');
      const m = memberships.find((row) => row.organizationId === id)!;
      return json({
        userId: session().user.id,
        organizationId: id,
        membershipId: m.membershipId,
        role: m.role,
      });
    }
    if (path === '/auth/logout') return json(null, 204);
    if (path === '/notifications')
      return json({
        data: [],
        pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
      });
    return json({ ok: true });
  };
}
async function loggedIn(fetcher = baseFetch(), storage = new MemoryStorage()) {
  const client = new SessionClient(
    new JsonTransport('http://localhost:4000', fetcher),
    () => storage,
  );
  await client.bootstrap();
  await client.authenticate('login', {
    email: 'alex@example.invalid',
    password: 'a sensible passphrase',
  });
  return { client, storage };
}
class FakeSocket implements SocketLike {
  connected = false;
  active = false;
  connections = 0;
  disconnections = 0;
  joins: unknown[] = [];
  listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  constructor(
    readonly memberId = memberA,
    readonly organizationId = orgA,
  ) {}
  on(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  removeAllListeners() {
    this.listeners.clear();
    return this;
  }
  connect() {
    this.connected = true;
    this.connections++;
    return this;
  }
  disconnect() {
    this.connected = false;
    this.disconnections++;
    return this;
  }
  timeout() {
    return {
      emit: (
        _event: string,
        payload: unknown,
        callback: (error: unknown, response?: unknown) => void,
      ) => {
        this.joins.push(payload);
        callback(null, {
          ok: true,
          organizationId: this.organizationId,
          membershipId: this.memberId,
          role: 'OWNER',
        });
      },
    };
  }
  server(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}
function event(version = 1, ticketId = randomUUID(), eventId = randomUUID()) {
  return {
    schemaVersion: 1,
    eventId,
    organizationId: orgA,
    ticketId,
    ticketNumber: 1,
    version,
    occurredAt: new Date().toISOString(),
  };
}

test('API base address is validated and cannot contain credentials, queries or a remote path', () => {
  assert.equal(apiBaseUrl(undefined), 'http://localhost:4000');
  assert.equal(
    apiBaseUrl('https://api.example.com/'),
    'https://api.example.com',
  );
  for (const value of [
    'file:///tmp/api',
    'https://name:secret@api.example.com',
    'https://api.example.com?token=secret',
    'https://api.example.com/v1',
    'garbage',
  ])
    assert.throws(() => apiBaseUrl(value));
});
test('auth validation preserves passphrases, validates lengths and rejects malformed email', () => {
  assert.deepEqual(
    validateAuth(
      {
        email: ' alex@example.com ',
        password: ' a good passphrase ',
        name: 'Alex',
        organizationName: 'Signal',
      },
      true,
    ),
    {},
  );
  assert.deepEqual(
    Object.keys(
      validateAuth(
        { email: 'bad', password: 'short', name: ' ', organizationName: '' },
        true,
      ),
    ).sort(),
    ['email', 'name', 'organizationName', 'password'],
  );
});
test('login/register commit a contained session with explicit organization selection', async () => {
  for (const kind of ['login', 'register'] as const) {
    const client = new SessionClient(
      new JsonTransport('http://localhost:4000', baseFetch()),
      () => new MemoryStorage(),
    );
    await client.bootstrap();
    await client.authenticate(kind, {
      email: 'alex@example.invalid',
      password: 'a sensible passphrase',
      ...(kind === 'register'
        ? { name: 'Alex', organizationName: 'Signal' }
        : {}),
    });
    assert.equal(client.getSnapshot().status, 'authenticated');
    assert.equal(client.getSnapshot().selected, null);
    assert.ok(!JSON.stringify(client.getSnapshot()).includes(accessA));
    assert.equal(
      routeDestination(client.getSnapshot(), 'public'),
      '/select-organization',
    );
  }
});
test('login failure never exposes raw backend messages and leaves the session anonymous', async () => {
  const { client } = await loggedIn(
    baseFetch((path) =>
      path === '/auth/login'
        ? json({ message: 'Prisma passwordHash secret database error' }, 401)
        : undefined,
    ),
  ).catch(async (error) => {
    assert.ok(error instanceof ApiError);
    assert.ok(!error.message.includes('Prisma'));
    return { client: null };
  });
  assert.equal(client, null);
});
test('single and multiple memberships require live context verification before selection', async () => {
  for (const count of [1, 2]) {
    let verified = false;
    const fetcher = baseFetch((path, init) => {
      if (path === '/auth/login')
        return json(
          session(accessA, 'a'.repeat(64), memberships.slice(0, count)),
        );
      if (path === '/auth/context') {
        verified = true;
        const id = new Headers(init?.headers).get('x-organization-id');
        assert.equal(id, orgA);
      }
    });
    const { client } = await loggedIn(fetcher);
    assert.equal(client.getSnapshot().selected, null);
    await client.selectOrganization(orgA);
    assert.equal(verified, true);
    assert.equal(client.getSnapshot().selected?.organizationId, orgA);
  }
});
test('organization headers are applied centrally and an old tenant response cannot be reused after a switch', async () => {
  const started = deferred<void>(),
    release = deferred<void>();
  const { client } = await loggedIn(
    baseFetch(async (path, init) => {
      if (path !== '/delayed') return undefined as unknown as Response;
      assert.equal(new Headers(init?.headers).get('x-organization-id'), orgA);
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        `Bearer ${accessA}`,
      );
      started.resolve();
      await release.promise;
      return json({ organizationId: orgA });
    }),
  );
  await client.selectOrganization(orgA);
  const pending = client.api.request('/delayed', { organization: true });
  await started.promise;
  await client.selectOrganization(orgB);
  release.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(client.getSnapshot().selected?.organizationId, orgB);
});
test('concurrent 401 responses share one refresh and retry using the replacement access token', async () => {
  const entered = deferred<void>(),
    release = deferred<void>();
  let refreshes = 0;
  let protectedCalls = 0;
  const { client, storage } = await loggedIn(
    baseFetch((path, init) => {
      if (path === '/auth/refresh')
        return (async () => {
          refreshes++;
          entered.resolve();
          await release.promise;
          return json(session(accessB, 'b'.repeat(64)));
        })();
      if (path === '/protected') {
        protectedCalls++;
        return new Headers(init?.headers).get('authorization') ===
          `Bearer ${accessB}`
          ? json({ ok: true })
          : json({}, 401);
      }
    }),
  );
  const first = client.api.request('/protected'),
    second = client.api.request('/protected');
  await entered.promise;
  release.resolve();
  assert.deepEqual(await Promise.all([first, second]), [
    { ok: true },
    { ok: true },
  ]);
  assert.equal(refreshes, 1);
  assert.equal(protectedCalls, 4);
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!);
  assert.equal(saved.accessToken, accessB);
  assert.equal(saved.refreshToken, 'b'.repeat(64));
});
test('a late 401 for the old access token does not rotate the already replaced session again', async () => {
  let refreshes = 0;
  const late = deferred<void>();
  const began = deferred<void>();
  let slow = true;
  const { client } = await loggedIn(
    baseFetch((path, init) => {
      if (path === '/auth/refresh') {
        refreshes++;
        return json(session(accessB, 'b'.repeat(64)));
      }
      if (path === '/slow' && slow) {
        slow = false;
        return (async () => {
          began.resolve();
          await late.promise;
          return json({}, 401);
        })();
      }
      if (
        path === '/fast' &&
        new Headers(init?.headers).get('authorization') !== `Bearer ${accessB}`
      )
        return json({}, 401);
    }),
  );
  const pending = client.api.request('/slow');
  await began.promise;
  await client.api.request('/fast');
  late.resolve();
  await pending;
  assert.equal(refreshes, 1);
});
test('refresh failure clears tokens, organization, and browser storage', async () => {
  const { client, storage } = await loggedIn(
    baseFetch((path) =>
      path === '/auth/refresh'
        ? json({}, 401)
        : path === '/protected'
          ? json({}, 401)
          : undefined,
    ),
  );
  await client.selectOrganization(orgA);
  await assert.rejects(client.api.request('/protected'));
  assert.equal(client.getSnapshot().status, 'anonymous');
  assert.equal(client.getSnapshot().selected, null);
  assert.equal(storage.getItem(SESSION_KEY), null);
});
test('a second 401 ends the session after one retry, without an infinite refresh loop', async () => {
  let refreshes = 0,
    attempts = 0;
  const { client } = await loggedIn(
    baseFetch((path) => {
      if (path === '/auth/refresh') {
        refreshes++;
        return json(session(accessB, 'b'.repeat(64)));
      }
      if (path === '/protected') {
        attempts++;
        return json({}, 401);
      }
    }),
  );
  await assert.rejects(client.api.request('/protected'));
  assert.equal(refreshes, 1);
  assert.equal(attempts, 2);
  assert.equal(client.getSnapshot().status, 'anonymous');
});
test('logout during a rotation revokes the winning refresh token without resurrecting local state', async () => {
  const entered = deferred<void>(),
    release = deferred<void>();
  let revoked = '';
  const { client, storage } = await loggedIn(
    baseFetch((path, init) => {
      if (path === '/auth/refresh')
        return (async () => {
          entered.resolve();
          await release.promise;
          return json(session(accessB, 'b'.repeat(64)));
        })();
      if (path === '/auth/logout') {
        revoked = JSON.parse(String(init?.body)).refreshToken;
        return json(null, 204);
      }
    }),
  );
  const refresh = client.refresh();
  await entered.promise;
  const logout = client.logout();
  assert.equal(client.getSnapshot().status, 'anonymous');
  assert.equal(storage.getItem(SESSION_KEY), null);
  release.resolve();
  await Promise.all([refresh, logout]);
  assert.equal(revoked, 'b'.repeat(64));
  assert.equal(client.getSnapshot().status, 'anonymous');
  assert.equal(storage.getItem(SESSION_KEY), null);
});
test('logout still clears local state when the backend is unavailable', async () => {
  const { client, storage } = await loggedIn(
    baseFetch((path) => {
      if (path === '/auth/logout') throw new Error('offline');
      return undefined;
    }),
  );
  await client.selectOrganization(orgA);
  await client.logout();
  assert.equal(client.getSnapshot().selected, null);
  assert.equal(storage.getItem(SESSION_KEY), null);
});
test('reload restoration validates saved access and current organization through HTTP', async () => {
  const storage = new MemoryStorage();
  storage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: accessA,
      refreshToken: 'a'.repeat(64),
      expiresAt: Date.now() - 1,
      selectedOrganizationId: orgA,
    }),
  );
  let refreshes = 0;
  const client = new SessionClient(
    new JsonTransport(
      'http://localhost:4000',
      baseFetch((path) => {
        if (path === '/auth/refresh') {
          refreshes++;
          return json(session(accessB, 'b'.repeat(64)));
        }
      }),
    ),
    () => storage,
  );
  await client.bootstrap();
  assert.equal(refreshes, 1);
  assert.equal(client.getSnapshot().status, 'authenticated');
  assert.equal(client.getSnapshot().selected?.organizationId, orgA);
});
test('unavailable browser persistence falls back to memory without exposing credentials', async () => {
  const client = new SessionClient(
    new JsonTransport('http://localhost:4000', baseFetch()),
    () => undefined,
  );
  await client.bootstrap();
  await client.authenticate('login', {
    email: 'alex@example.invalid',
    password: 'a sensible passphrase',
  });
  assert.equal(client.getSnapshot().persistent, false);
  assert.equal(client.getSnapshot().status, 'authenticated');
});
test('protected route decisions cover anonymous, no-organization, selected and restoring states', async () => {
  const { client } = await loggedIn();
  assert.equal(
    routeDestination(client.getSnapshot(), 'application'),
    '/select-organization',
  );
  await client.selectOrganization(orgA);
  assert.equal(routeDestination(client.getSnapshot(), 'application'), null);
  assert.equal(routeDestination(client.getSnapshot(), 'organization'), '/app');
  client.clear();
  assert.equal(routeDestination(client.getSnapshot(), 'application'), '/login');
  assert.equal(routeDestination(client.getSnapshot(), 'public'), null);
});
test('reconciliation ignores duplicate and older versions while accepting equal-version distinct hints', () => {
  const cache = new Reconciliation(3);
  const ticketId = randomUUID();
  const newest = event(9, ticketId);
  assert.ok(cache.accept('ticket:status-changed', newest, orgA));
  assert.equal(cache.accept('ticket:status-changed', newest, orgA), null);
  assert.equal(
    cache.accept('ticket:status-changed', event(8, ticketId), orgA),
    null,
  );
  assert.ok(cache.accept('ticket:comment-added', event(9, ticketId), orgA));
  assert.equal(
    cache.accept('ticket:created', { ...event(), organizationId: orgB }, orgA),
    null,
  );
});
test('deduplication and version memory is bounded and reset between organizations', () => {
  const cache = new Reconciliation(2);
  const first = event();
  cache.accept('ticket:created', first, orgA);
  cache.accept('ticket:created', event(), orgA);
  cache.accept('ticket:created', event(), orgA);
  assert.ok(cache.accept('ticket:created', first, orgA));
  cache.reset();
  assert.ok(cache.accept('ticket:created', first, orgA));
});
test('socket lifecycle joins explicitly, replaces stale-token sockets, and disconnects on logout/switch', () => {
  const created: FakeSocket[] = [];
  const roles: string[] = [];
  const realtime = new RealtimeClient(
    () => {
      const socket = new FakeSocket();
      created.push(socket);
      return socket;
    },
    {
      status: () => {},
      joined: (role) => roles.push(role),
      event: () => {},
      refresh: async () => {},
      denied: () => {},
    },
  );
  realtime.update();
  assert.equal(created.length, 0);
  const target = {
    token: accessA,
    organizationId: orgA,
    membershipId: memberA,
    revision: 1,
  };
  realtime.update(target);
  created[0]!.server('connection:ready');
  assert.deepEqual(created[0]!.joins, [{ organizationId: orgA }]);
  assert.deepEqual(roles, ['OWNER']);
  realtime.update(target);
  assert.equal(created.length, 1);
  realtime.update({ ...target, token: accessB });
  assert.equal(created[0]!.disconnections, 1);
  assert.equal(created[0]!.listeners.size, 0);
  assert.equal(created.length, 2);
  realtime.update({ ...target, organizationId: orgB, revision: 2 });
  assert.equal(created[1]!.disconnections, 1);
  realtime.update();
  assert.equal(created[2]!.disconnections, 1);
  realtime.stop();
});
test('realtime authentication recovery is bounded when fresh-token socket authentication also fails', async () => {
  const created: FakeSocket[] = [];
  let refreshes = 0;
  const realtime = new RealtimeClient(
    () => {
      const socket = new FakeSocket();
      created.push(socket);
      return socket;
    },
    {
      status: () => {},
      joined: () => {},
      event: () => {},
      refresh: async () => {
        refreshes++;
      },
      denied: () => {},
    },
  );
  const target = {
    token: accessA,
    organizationId: orgA,
    membershipId: memberA,
    revision: 1,
  };
  realtime.update(target);
  created[0]!.server('connect_error', { data: { code: 'UNAUTHENTICATED' } });
  await Promise.resolve();
  realtime.update({ ...target, token: accessB });
  created[1]!.server('connect_error', { data: { code: 'UNAUTHENTICATED' } });
  await Promise.resolve();
  assert.equal(refreshes, 1);
  realtime.stop();
});
test('application notification hints deduplicate, refetch HTTP counts, reset tenant state and survive degraded realtime', async () => {
  const sockets: FakeSocket[] = [];
  let unread = 2,
    loads = 0;
  const loaded = () =>
    new Promise<void>((resolve) => {
      const unsubscribe = app.subscribe(() => {
        if (
          !app.getSnapshot().notificationLoading &&
          app.getSnapshot().unread === unread
        ) {
          unsubscribe();
          resolve();
        }
      });
    });
  const app = new ApplicationClient({
    baseUrl: 'http://localhost:4000',
    storage: () => new MemoryStorage(),
    fetcher: baseFetch((path) => {
      if (path === '/notifications') {
        loads++;
        return json({
          data: [],
          pagination: { page: 1, limit: 5, total: unread, totalPages: 1 },
        });
      }
    }),
    socketFactory: () => {
      const socket = new FakeSocket(
        sockets.length ? memberB : memberA,
        sockets.length ? orgB : orgA,
      );
      sockets.push(socket);
      return socket;
    },
  });
  app.start();
  try {
    await app.login({
      email: 'alex@example.invalid',
      password: 'a sensible passphrase',
    });
    await app.selectOrganization(orgA);
    await app.loadNotifications();
    assert.equal(sockets.length, 1);
    sockets[0]!.server('connection:ready');
    await app.loadNotifications();
    const hint = { ...event(), notificationId: randomUUID() };
    unread = 3;
    const done = loaded();
    sockets[0]!.server('notification:new', hint);
    await done;
    const before = loads;
    sockets[0]!.server('notification:new', hint);
    await Promise.resolve();
    assert.equal(loads, before);
    assert.equal(app.getSnapshot().events.length, 1);
    assert.equal(app.getSnapshot().unread, 3);
    sockets[0]!.server('connect_error', new Error('transport down'));
    await app.loadNotifications();
    assert.equal(app.getSnapshot().realtime, 'degraded');
    assert.equal(app.getSnapshot().unread, 3);
    const switching = app.selectOrganization(orgB);
    assert.equal(app.getSnapshot().unread, null);
    assert.equal(app.getSnapshot().events.length, 0);
    await switching;
    assert.equal(sockets[0]!.disconnections, 1);
    await app.logout();
    assert.equal(app.getSnapshot().session.status, 'anonymous');
    assert.equal(app.getSnapshot().notifications.length, 0);
    assert.equal(sockets[1]!.disconnections, 1);
  } finally {
    app.stop();
  }
});

test('live role changes invalidate tenant requests and removed memberships clear selection', async () => {
  let current = memberships;
  const { client } = await loggedIn(
    baseFetch((path) =>
      path === '/auth/me'
        ? json({ user: session().user, memberships: current })
        : undefined,
    ),
  );
  await client.selectOrganization(orgA);
  const previous = client.scope();
  current = memberships.map((m) =>
    m.organizationId === orgA ? { ...m, role: 'VIEWER' as const } : m,
  );
  await client.profile();
  assert.equal(client.getSnapshot().selected?.role, 'VIEWER');
  assert.ok(client.scope().revision > previous.revision);
  assert.equal(previous.signal.aborted, true);
  current = memberships.filter((m) => m.organizationId !== orgA);
  await client.profile();
  assert.equal(client.getSnapshot().selected, null);
});
test('refresh cannot silently select a recreated membership using an old organization selection', async () => {
  const replacement = memberships.map((m) =>
    m.organizationId === orgA ? { ...m, membershipId: randomUUID() } : m,
  );
  const { client } = await loggedIn(
    baseFetch((path) =>
      path === '/auth/refresh'
        ? json(session(accessB, 'b'.repeat(64), replacement))
        : undefined,
    ),
  );
  await client.selectOrganization(orgA);
  await client.refresh();
  assert.equal(client.getSnapshot().selected, null);
  assert.equal(client.getSnapshot().status, 'authenticated');
});

test('a late global profile response cannot erase a subsequently verified organization selection', async () => {
  const entered = deferred<void>(),
    release = deferred<void>();
  let hold = false;
  const { client } = await loggedIn(
    baseFetch((path) => {
      if (path === '/auth/me' && hold) {
        hold = false;
        return (async () => {
          entered.resolve();
          await release.promise;
          return json({
            user: session().user,
            memberships: memberships.slice(0, 1),
          });
        })();
      }
    }),
  );
  await client.selectOrganization(orgA);
  hold = true;
  const pending = client.profile();
  await entered.promise;
  await client.selectOrganization(orgB);
  release.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(client.getSnapshot().selected?.organizationId, orgB);
});
test('a refresh snapshot cannot overwrite an organization selected while rotation was in flight', async () => {
  const entered = deferred<void>(),
    release = deferred<void>();
  const { client } = await loggedIn(
    baseFetch((path) =>
      path === '/auth/refresh'
        ? (async () => {
            entered.resolve();
            await release.promise;
            return json(
              session(accessB, 'b'.repeat(64), memberships.slice(0, 1)),
            );
          })()
        : undefined,
    ),
  );
  await client.selectOrganization(orgA);
  const rotating = client.refresh();
  await entered.promise;
  await client.selectOrganization(orgB);
  release.resolve();
  await rotating;
  assert.equal(client.getSnapshot().selected?.organizationId, orgB);
  assert.equal(client.access()?.token, accessB);
});
