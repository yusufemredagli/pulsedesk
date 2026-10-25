# Frontend application foundation — Phase 5C

The existing Next.js App Router application now provides authentication, explicit organization selection, protected client routing, a minimal operations shell, a persisted notification preview, and centralized API/realtime clients. It does not implement full dashboard metrics, ticket/customer/team/SLA management screens, incidents, presence, or realtime mutations.

## Routes and boundaries

| Route                  | Behavior                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `/`                    | Redirects to `/login`                                                                |
| `/login`, `/register`  | Accessible labeled forms; authenticated sessions continue to selection or `/app`     |
| `/select-organization` | Requires authentication; refreshes memberships and verifies context before entering  |
| `/app`                 | Requires a restored session and selected organization; minimal landing/activity view |
| `/app/notifications`   | Same gate; up to five persisted unread notifications, refresh and mark-read          |

Layouts/pages remain App Router entries. Interactive auth/shell components consume `ApplicationProvider`; central controllers are ordinary TypeScript and tested without React/browser mocks. `useSyncExternalStore` exposes immutable public snapshots. Initial server/client snapshots agree, and browser session restoration starts in an effect. No credentials or tenant data are rendered into server HTML.

Because this phase retains bearer credentials in browser storage, the route gate is client-side: it redirects unauthorized users rather than only hiding elements, but is **not a server authorization boundary**. A protected page can initially return neutral restoration HTML before hydration redirects. Every data request still depends on the API's live session, membership, role, and domain authorization. There is no cookie-backed middleware/SSR authentication claim.

The shell uses graphite navigation, porcelain content, cyan signals, and controlled coral notification accents. Future navigation is visibly unavailable rather than linking to missing pages. It includes responsive navigation, organization switching, profile, notification badge, logout, visible keyboard focus, skip link, status/error semantics, reduced-motion support, and neutral restoration/degraded states. No sample ticket counts, fabricated alerts, analytics charts, social login, or OAuth controls are present.

## Configuration and HTTP transport

Set `NEXT_PUBLIC_API_URL` in `apps/web/.env.local` or the exported build environment. Next.js does not automatically read the root `.env`. A web-local `.env.example` is provided. The deliberate local default is `http://localhost:4000`; production must supply its actual HTTPS API origin at build time. Configuration accepts a plain HTTP(S) origin, without credentials, query, fragment, wildcard, or path prefix. Public Next variables are embedded in browser bundles; never put secrets in them.

```sh
cp apps/web/.env.example apps/web/.env.local
# Keep the existing ignored root API environment configured separately.
docker compose up -d --wait
pnpm --filter @pulsedesk/api prisma:migrate:deploy
pnpm dev
# Separate terminal, after building the API:
pnpm worker
```

The only backend integration change is `configureHttpCors(app)` before listening. Browser fetches to the API were previously blocked because HTTP CORS was not configured. It reuses `FRONTEND_ORIGINS`, permits GET/POST/PATCH/OPTIONS and Content-Type/Authorization/X-Organization-Id, exposes Retry-After, and enables no credentialed cookies. Unlisted browser origins receive no allow-origin header. Existing auth/domain response contracts, database schema, Socket.IO origin enforcement, and worker semantics are unchanged. Use TLS outside local development.

`JsonTransport` owns base URL, JSON serialization, ten-second request deadlines, caller abort, `cache: no-store`, and `credentials: omit`. It calls native fetch through a wrapper to preserve browser invocation semantics. Remote error bodies/HTML/messages are never displayed or logged; `ApiError` maps status codes to fixed safe messages. `ApiClient` centrally adds bearer credentials and a captured organization header. Components do not construct headers or call fetch independently.

## Session containment and browser storage

`SessionClient` privately holds the current credential pair and expiry. Public snapshots contain only user, memberships, selected membership, status, persistence availability, and safe errors. Page components never read tokens. One `sessionStorage` key, `pulsedesk.session.v1`, atomically stores the credential pair, expiry, and selected organization ID. No tokens enter URLs, DOM text, logs, localStorage, or event metadata.

This per-tab strategy survives reloads while avoiding long-lived localStorage persistence. Storage failure falls back to memory and displays a notice. Restored credentials are treated as unverified: HTTP `/auth/me` checks the live session, and `/auth/context` verifies any saved selection. Corrupt or unusable state cannot directly grant application access. Transient restoration failure shows retry/sign-in recovery rather than exposing stale workspace content.

**Known limitation:** sessionStorage is readable by JavaScript in the same origin. XSS or a compromised same-origin script can steal bearer credentials. It is not production-perfect token storage or equivalent to HttpOnly cookies. Keep third-party scripts tightly controlled, deploy appropriate content security protections, and never log request credentials. Browser tab duplication/opener behavior can copy sessionStorage; there is no cross-tab refresh lock, so copied sessions can race and one tab may need to sign in again. No third-party iframe or cross-tab synchronization system is introduced.

Future secure cookie transport must be designed with the backend: HttpOnly/Secure/SameSite choices, CSRF defenses, CORS/credential policy, refresh rotation, server routing, and socket authentication need a coordinated contract. This phase deliberately does not silently convert JSON bearer responses into cookies.

## Refresh and logout

A timer refreshes thirty seconds before the reported access lifetime ends. API 401 handling joins a single in-flight refresh per session generation. Concurrent failed requests await the same rotation; a late 401 for an already replaced access token reuses the current token rather than rotating again. Both tokens are committed in one client record/storage write. Requests retry once; a second 401 clears the session. Refresh failure clears session, organization, socket, and tenant state, leading to `/login`.

Auth generations prevent old responses from restoring a session after logout or a newer sign-in. Profile/refresh snapshots cannot overwrite a workspace that was verified after their requests started. Logout clears local state immediately and disconnects realtime even if the network fails. If rotation is already in flight, logout waits privately for its result and revokes the winning refresh token, without restoring the cleared UI. A later independent login cannot be overwritten by that old logout. Network failure still leaves local state cleared, but cannot guarantee server revocation; the backend's existing lost-refresh-response/token-family limitations remain.

```mermaid
sequenceDiagram
    participant UI
    participant API as API client
    participant Session as Session client
    participant Backend
    UI->>API: Concurrent authenticated requests
    Backend-->>API: 401 for old access token
    API->>Session: Join one refresh flight
    Session->>Backend: POST /auth/refresh
    Backend-->>Session: Rotated access and refresh tokens
    Session->>Session: Atomically replace credentials and persist
    Session->>UI: Publish safe state; reconnect socket with new access
    API->>Backend: Retry each request once
    alt Refresh or retry authentication fails
        Session->>Session: Clear session and tenant state
        Session-->>UI: Redirect to login
    end
```

## Organization context and isolation

Both single- and multi-membership users explicitly choose their workspace. The selector refreshes memberships on entry. Selection reads `/auth/me`, then verifies the candidate through `/auth/context`; frontend membership lists are not authorization. The current role comes from the verified response, and the backend remains authoritative for every subsequent action.

Switching immediately clears the selected context, notifications/count, event metadata, bounded reconciliation maps, and socket. An organization revision and abort signal invalidate in-flight requests. Live role changes invalidate scoped state too; a removed/recreated membership requires explicit reselection rather than inheriting the old membership’s caches. Responses captured in an earlier tenant generation cannot be committed into the new one, even if a transport ignores abort. New requests capture the selected organization header once. After verification, the new workspace starts fresh HTTP loading and a fresh socket join; old tenant data is never carried forward for a loading placeholder.

Focus/visibility restoration rechecks the profile, and a removed selection is cleared. Notification reads and socket joins also react to membership denial. An idle UI is not a complete live membership monitor; backend checks always enforce access, and the sixty-second inbox poll/focus checks provide recovery when realtime is unavailable.

## Socket lifecycle

One centralized `RealtimeClient` owns at most one Socket.IO instance. It connects only after authentication and verified organization selection. On `connection:ready`, it sends `organization:join`, verifies organization/membership/role in the acknowledgement, and only then shows connected state. Token rotation, organization changes, and logout remove listeners, disconnect the previous socket, and clear retry timers. New access credentials always create a new connection rather than mutating a previously authenticated socket in place.

Transient transport errors use bounded-delay reconnect behavior. Namespace authentication gets one refresh recovery attempt per unsuccessful connection episode; repeated fresh-token socket rejection leaves realtime degraded instead of creating an infinite refresh loop. A successful join resets that recovery allowance. Unrecoverable HTTP refresh failure ends the session; a transport outage alone does not. Membership denial clears selection and reloads memberships. Acknowledgements, callbacks, and event handlers are fenced to their current socket/organization target so late responses cannot select a stale workspace.

On reconnect the client authenticates, rejoins, increments organization data invalidation state, and refetches the persisted inbox. It requests no history or socket replay. The backend remains single-API-instance until distributed fan-out is implemented; this client adds no Redis adapter or replay protocol.

## Reconciliation and notification state

Allowed hints are `ticket:created`, `ticket:assigned`, `ticket:status-changed`, `ticket:comment-added`, and `notification:new`. Runtime checks verify schema version, stable event UUID, current organization, timestamp, and relevant identifier/version fields. No socket payload is treated as a complete ticket or authoritative unread count.

`Reconciliation` keeps at most 256 event IDs and 256 ticket version entries. Older ticket versions are ignored; equal versions with different event IDs remain meaningful because assignment/status events can share a version and comments do not bump workflow version. Eight latest event metadata records and a monotonic `dataRevision` prepare future scoped query hooks for invalidation. No full ticket cache or optimistic socket mutation exists. The maps and activity list reset on tenant changes; bounded eviction can allow very old duplicate hints to trigger another safe refetch.

The unread badge and preview come from `/notifications?unread=true&page=1&limit=5`, using pagination `total` for the count. A notification hint triggers a coalesced HTTP refetch instead of blindly incrementing. Hints arriving during a load request another pass so updates are not silently lost. Mark-read uses the existing endpoint and refetches the inbox. The latest activity list retains only metadata, not credentials or raw full records.

When realtime is unavailable, a subtle paused indicator is shown while HTTP remains usable. The inbox refetches on selection, successful socket join/reconnect, relevant notification hints, manual refresh, focus, and a sixty-second fallback interval. Errors keep a safe retry state and do not fabricate a zero count. Reconnect/refetch is the recovery source for missed hints.

## Testing and verification

`pnpm test` now includes lightweight Node/tsx frontend tests alongside backend tests. The tests exercise session/auth outcomes, explicit selection, headers, stale response fencing, single-flight refresh, late 401 handling, bounded retry, atomic storage, logout/rotation races, restoration, memory fallback, route decisions, bounded dedup/version handling, socket replacement/cleanup, and notification/degraded-mode behavior. A backend CORS regression test checks permitted and foreign origins without changing endpoint contracts.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Full backend suites still require dedicated exported `TEST_DATABASE_URL` and `TEST_REDIS_URL` as documented; frontend unit tests require neither.

Browser verification uses isolated Chromium and a disposable migrated PostgreSQL database, isolated Redis namespace, compiled API/worker, and built web app. It covers real forms, protected redirects, live organization joins, persisted notification delivery/read, workspace switching, expired-token recovery and refresh rotation, reload restoration, proactive refresh/socket replacement, mobile overflow, logout, revoked-session cleanup, and HTTP usability with only WebSocket transport blocked. No production environment file or developer database reset is used.

Deferred frontend work includes feature dashboards/lists/details, analytics, customer/team/SLA management, full notification pagination/history, frontend authorization capabilities beyond backend enforcement, cookie transport, cross-tab coordination, presence/typing, incidents, and email/SMS.
