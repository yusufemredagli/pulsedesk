# PulseDesk operational product UI — Phase 6

The application opens at `/app/dashboard`; `/app` redirects there. All screens use the existing authenticated shell and explicit organization selection. There are no simulated metrics or customer records.

## Dashboard

Six database counts describe the caller's accessible queue: open (everything except resolved, closed and cancelled), urgent open work, pending SLA deadlines within 30 minutes, breached active tickets, open tickets without either a team or member, and in-progress work. Counts are ticket counts, so two SLA events on one ticket do not double-count it. An overdue pending event is displayed as breached even before the worker records its breach. Previously breached events stay visible until the ticket leaves active work. A repeatable-read transaction supplies a consistent summary.

Queue pulse shows six recently updated accessible tickets. The activity feed retains eight accepted live event hints in memory, resets on tenant changes, and is explicitly activity since joining rather than a durable audit feed. Ticket descriptions in this feed are enriched through scoped HTTP detail; assignment names describe the currently verified assignment, while lifecycle status comes from the validated event hint. Persisted unread notifications provide service alert context. Full chronological history lives on ticket detail.

## Ticket queue

Search (subject or number), status, priority, team, member, sort and page are sent to the server. Search and invalidation requests debounce by 200 ms. Twenty rows are requested per page. Changing a filter resets the page. Team/member lookups are searchable and paginated, including organizations larger than 100 members. A selected team narrows member choices. The table shows number, subject, customer, priority, status, assignment, SLA and last update. Mobile renders each row as a compact two-column ticket card.

New ticket creation accepts a real customer chosen through paginated search, subject, description and priority. It uses the WEB source. Creating customers and managing teams/members remain API operations.

## Detail and permissions

The main column contains description and facts, deterministic chronological history, and comments. The side column contains assignment and service commitments. Timeline combines the API's most recent 100 records of each type and shows when earlier records exist. Equal timestamps sort by prefixed record ID. Internal notes have explicit text and amber styling; public replies use separate composer copy. Both remain inside authenticated staff views; public means visibility classification, not email delivery or a customer portal.

OWNER, ADMIN and MANAGER can triage, assign, reassign, cancel and close in their valid states. AGENT can start assigned work, wait, resume, resolve and comment on tickets the server permits through personal or team assignment. VIEWER sees read-only content. No generic status dropdown exists. The backend rechecks every permission and scoped mutation.

A command dialog captures the version reviewed when opened and submits it as `expectedVersion`. On 409 it closes, announces “This ticket was updated by another user,” and refetches instead of retrying with a replacement version. Assignment accepts team, member or both; changing team clears the member and narrows the directory. Concurrent duplicate submissions are locked synchronously. Comments do not automatically retry uncertain network failures: review the refreshed timeline before submitting again.

## SLA and realtime

The UI derives completed, breached, cancelled, due and at-risk labels from due/completion/breach timestamps. Breach takes precedence over completion. At risk means a pending deadline with at most 30 minutes remaining; it is display-only and is never persisted. Labels update once per minute. A missing policy is stated explicitly.

Socket events remain invalidation hints. The existing bounded dedupe/version tracker now also observes versions returned by HTTP, rejects older event versions, and accepts distinct same-version comments. A 200 ms resource debounce batches event bursts; in-flight requests abort on invalidation, navigation or tenant changes. Data is keyed by path and tenant revision, preventing old data from rendering during a switch. Reconnection, visible-window focus, a visible once-per-minute safety refresh, profile revision and local command completion refresh HTTP state. Degraded realtime is visible in the shell; HTTP and manual refresh remain usable. The product does not promise event replay, exactly-once delivery or durable feed history.

## Notifications and accessibility

The topbar bell opens a small native disclosure containing five unread persisted alerts, their title/message/time, and mark-read actions. Read actions use the backend and refetch authoritative unread counts. Failures remain actionable and no remote error bodies are rendered.

Graphite navigation, porcelain surfaces and cyan focus signals frame compact operational information. Coral marks urgency/breach, amber warnings/internal notes, and green completed/healthy states. The sidebar collapses on small screens. Metrics become three then two columns, detail becomes a single column, and tables become cards. Native modal dialogs support Escape, focus containment and focus restoration; forms have labels, icon controls have accessible names, and the shell keeps its skip link. Layouts are verified at 1440, 1280, 1024, 768, 390 and 320 pixels.

## Minimal API additions

`GET /dashboard/summary` uses the existing live authentication, organization guards and accessible-ticket policy. `GET /organization/members` exposes only public member projections for active users in the current organization; it supports bounded page/limit/search and optional teamId. Ticket lists now bulk-load SLA projections once per page, avoiding per-ticket queries. No schema migration or analytics subsystem is introduced.

Incidents, attachments, portals, ingestion, AI, presence, typing, deep analytics, customer/team administration screens, durable activity history, and older-history pagination are deferred.

## Verification

`pnpm test` includes model, session, HTTP, realtime and database integration regressions. Database suites require an explicitly exported dedicated migrated `TEST_DATABASE_URL`.

The reproducible two-session Chromium regression is `pnpm --filter @pulsedesk/web test:browser`. Install its browser with `pnpm --filter @pulsedesk/web exec playwright install chromium`. First build the API and web (with the isolated API URL), and start a dedicated test API, worker, PostgreSQL and Redis queue prefix plus the built web server. Export matching `DATABASE_URL` and `TEST_DATABASE_URL` for that isolated database. The browser runner defaults to web port 3400 and API port 4400; override with `BROWSER_WEB_URL` and `BROWSER_API_URL`. The web origin must be in the API's `FRONTEND_ORIGINS`.

The runner creates randomized manager/agent/viewer fixtures, exercises lifecycle and cross-session updates, server filters/pagination, duplicate submission prevention, 409/403/404/network recovery, tenant isolation, notification delivery/read, and eighteen route/viewport overflow checks. It deletes only its own tracked fixture organizations/users and prints a temporary screenshot directory. It does not reset the database or flush Redis. Use dedicated services because setup intentionally creates workflow fixtures directly, including an SLA policy and pagination records. Browser tests run separately from the fast Node test command.
