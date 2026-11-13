# PulseDesk local demo environment

**LOCAL DEVELOPMENT / DEMO ONLY — never production credentials.**

The optional seed creates one `PulseDesk Demo` organization (`pulsedesk-demo`) for local development and portfolio demonstrations. It is never wired to installation, API startup, migrations or deployment. CI exercises it only inside the dedicated test-database suite. The API continues to use its existing authentication, live tenant checks and RBAC; no demo login shortcut or password field is added to any response.

## Start the demo

Configure your ignored root `.env` for local PostgreSQL/Redis and generate your own `JWT_ACCESS_SECRET` as described in the authentication guide. The seed itself only needs PostgreSQL and does not require a JWT secret, Redis or a running API.

```sh
docker compose up -d --wait
pnpm install
pnpm db
pnpm seed
pnpm dev
```

`pnpm --filter @pulsedesk/api seed` is the equivalent package command. Open <http://localhost:3000/login>, sign in and explicitly select **PulseDesk Demo**. The regular API remains at port 4000. `pnpm dev` starts web, API and the source-watched worker together; no application build or separate worker terminal is required. For daily development, use `docker compose up -d` then `pnpm dev`. Migration deployment and seeding remain explicit.

## Local credentials and roles

All five **local demo accounts** use the local-only `DEMO_PASSWORD` defined in the seed manifest; do not reuse it outside an isolated local demo. Passwords are hashed independently with the authentication `PasswordService` and its production Argon2id parameters. No plaintext password is stored in database fields. The CLI prints these explicitly requested local credentials; it never prints database URLs, real environment values, hashes or access/refresh tokens.

| Role    | Name         | Local email               | Intended test behavior                                                                                                                       |
| ------- | ------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| OWNER   | Demo Owner   | `owner@pulsedesk.local`   | All operational commands and owner-only authorization; SLA policy management.                                                                |
| ADMIN   | Demo Admin   | `admin@pulsedesk.local`   | Operational management and SLA policy writes; no owner-only verification endpoint access.                                                    |
| MANAGER | Demo Manager | `manager@pulsedesk.local` | Organization-wide queue, triage/assignment, lifecycle management and comments; no owner-only access or SLA policy writes.                    |
| AGENT   | Demo Agent   | `agent@pulsedesk.local`   | Only personally assigned or team-accessible tickets; start/wait/resume/resolve and comments; no triage, assignment, cancellation or closing. |
| VIEWER  | Demo Viewer  | `viewer@pulsedesk.local`  | Read-only organization views; no ticket/comment mutations.                                                                                   |

Customer Support contains Demo Agent and Demo Manager. Technical Support contains Demo Manager. Demo Admin and Demo Viewer have no team membership. Customers are Demo Müşteri A, B and C, with reserved `example.invalid` email addresses and empty phone fields. All identities are fictional.

## Seeded ticket scenarios

A fresh demo numbers these tickets PD-000001 through PD-000006. Normal application ticket numbering remains authoritative if a missing fixture is later recreated.

| Ticket                                 | Priority / source | Initial state    | Assignment / scenario                                                                     |
| -------------------------------------- | ----------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| Yönetici paneline giriş yapılamıyor    | URGENT / WEB      | OPEN             | Unassigned; first-response deadline near risk.                                            |
| Fatura toplamı hatalı görünüyor        | HIGH / EMAIL      | TRIAGED          | Unassigned; coherent triage history.                                                      |
| Yeni kullanıcı hesabına erişilemiyor   | MEDIUM / PHONE    | ASSIGNED         | Customer Support / Demo Agent; internal comment; first response due in about 20 minutes.  |
| API bağlantısı zaman zaman kopuyor     | HIGH / CHAT       | IN_PROGRESS      | Technical Support / Demo Manager; public response completed; resolution already breached. |
| Rapor çıktısı için ek bilgi bekleniyor | LOW / WEB         | WAITING_CUSTOMER | Customer Support / Demo Agent; public response completed; healthy resolution deadline.    |
| Bildirim problemi çözüldü              | MEDIUM / INTERNAL | RESOLVED         | Customer Support / Demo Agent; public response and resolution completed on time.          |

Four active SLA policies use first-response/resolution minutes: URGENT **15/120**, HIGH **30/240**, MEDIUM **60/480**, LOW **120/1440**. The existing active-policy unique index remains authoritative.

There are twelve SLA events, four comments, coherent assignment/status histories, matching workflow versions and resolution timestamps, and mutation audit records. The historical scenario starts from one UTC minute anchor on **first creation**, with deterministic relative offsets; it does not use a fixed calendar date that becomes stale before the first demo. The original anchor is retained in the seed audit marker. Near-risk means a display-only pending deadline within 30 minutes, matching the frontend.

The seed uses direct transaction-scoped insertion for historical timestamps, the exported lifecycle rules and allowed-role lists, live actor checks/locks, the real password/SLA services, and transactional realtime/notification outbox helpers. The historical breach has its own timestamp, audit and ordinary recipient-selection rules. Completed/breached events safely no-op when processed again by the normal worker. Pending events keep aging and may generate later legitimate breaches; rerunning the seed never moves deadlines forward.

Initially there are five notifications: unread breach notices for owner/admin/manager, an unread assignment for agent, and an already-read urgent-ticket notice for manager. Notification outbox rows use the ordinary delivery path.

## Idempotency and safety

Stable namespaced IDs identify seed-owned records. One database transaction and a transaction-scoped advisory lock serialize seed runs, including concurrent invocations. Repeated runs add no duplicates and preserve password changes, activity flags, membership roles, edited tickets, read markers, policy edits and original timestamps. Missing fixtures are created when doing so remains compatible with current domain permissions and constraints. This is **create missing demo data**, not a reset operation. A renamed identity, missing provenance marker or conflicting unique policy can deliberately stop the transaction rather than overwrite/adopt existing data.

An unrelated organization using the demo slug or an existing user using a reserved demo email causes a safe failure. No arbitrary database is reset, no tables are truncated, no data is deleted, and no other tenant is modified. A failed seed transaction rolls back completely. The CLI disconnects on success or failure and sanitizes unexpected errors.

`NODE_ENV=production` is always refused, with no override. Only `development`, `test`, or an unset local Node environment is accepted. `DATABASE_URL` must use PostgreSQL on `localhost`, `127.0.0.1` or `::1`; remote hosts are refused. These guards do not replace the responsibility to use a dedicated local development database. No production secrets or authentication exceptions are introduced.

## Verification

`pnpm test` includes production/remote refusal tests and a dedicated-database integration suite enabled only by an exported `TEST_DATABASE_URL`. That suite seeds twice and concurrently, compares row snapshots, validates roles, team membership, Argon2id, workflow/SLA/outbox consistency, notification recipients, and real manager/agent login and RBAC. It proves that reruns preserve workflow changes and read state. It skips rather than overwriting pre-existing demo identities, and removes only its own tracked fixtures from the isolated test database. Never point test variables at your working developer database.
