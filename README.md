# PulseDesk

PulseDesk is the foundation for a real-time incident and customer support operations platform. Phase 5A adds authenticated, tenant-aware Socket.IO infrastructure alongside the Phase 4 recoverable SLA engine with Redis, BullMQ, a separate worker, transactional outbox delivery, policy management, and recipient-scoped notifications. Teams, customers, and ticket operations retain explicit lifecycle commands, assignment, staff comments, transactional histories/audits, and tenant-safe pagination. Authentication and live organization authorization remain in place. Frontend product/authentication screens are not implemented.

## Architecture

The pnpm workspace uses Turborepo to coordinate independent Next.js and NestJS applications and shared TypeScript packages. PostgreSQL and Redis run locally through Docker Compose. The API connects to PostgreSQL through Prisma during startup and disconnects on shutdown. Redis backs BullMQ delayed SLA jobs; a separately started worker dispatches outbox records and processes breaches.

```text
pulsedesk/
├── apps/
│   ├── web/                 # Next.js App Router, src/app, components, lib, features
│   └── api/                 # NestJS bootstrap, configuration, liveness/readiness, worker
│       ├── prisma/          # Core domain schema and additive migrations
│       ├── src/             # common, config, infrastructure, modules
│       └── test/            # HTTP, PostgreSQL, Redis, worker, and constraint tests
├── packages/
│   ├── shared/              # Shared readiness constant and health contract
│   ├── config/              # Strict TypeScript and ESLint configuration
│   └── ui/                  # Minimal shared React Button
├── docker/                  # Reserved for future Docker assets
├── scripts/                 # Repository maintenance
├── .github/workflows/ci.yml
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Technologies and requirements

Use Node.js 24 LTS, pnpm 10.28.2, and Docker Engine/Desktop with Compose v2. The applications use Next.js 16, React 19, NestJS 11, TypeScript 5, Prisma 7, ESLint 9, and Prettier 3. Docker provides PostgreSQL 18 and Redis 8.10.

Install pnpm with `npm install --global pnpm@10.28.2` if it is unavailable. `.nvmrc` and `.node-version` select Node 24.

## Installation and environment

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

Root `.env` is ignored by Git. The API reads its local `.env` first, then the root `.env`; exported environment variables take precedence. API startup requires a configured, reachable PostgreSQL database and a strong `JWT_ACCESS_SECRET`, plus a configured `REDIS_URL`. Redis outages degrade readiness without preventing committed ticket/outbox writes. Generate a secret with `openssl rand -base64 48` and store it in your ignored `.env`; no default secret is provided. Builds and unit tests do not require a database or production secrets.

| Variable                  | Purpose                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`            | PostgreSQL connection URL for Prisma commands and API startup               |
| `TEST_DATABASE_URL`       | Dedicated migrated PostgreSQL database for optional constraint tests        |
| `REDIS_URL`               | Required Redis URL for API readiness and SLA worker                         |
| `TEST_REDIS_URL`          | Explicit dedicated Redis test URL; random test queue namespaces             |
| `SLA_QUEUE_PREFIX`        | Shared deployment queue namespace, default `pulsedesk`                      |
| `OUTBOX_POLL_INTERVAL_MS` | Worker outbox interval, default `2000` milliseconds                         |
| `JWT_ACCESS_SECRET`       | Required random signing secret, at least 32 bytes                           |
| `JWT_ACCESS_TTL`          | Access lifetime in seconds, default `900` (range `60`–`1200`)               |
| `REFRESH_TOKEN_TTL`       | Refresh lifetime in seconds, default `2592000` (range `3600`–`7776000`)     |
| `FRONTEND_ORIGINS`        | Exact frontend origin allowlist; production requires explicit HTTPS origins |
| `NEXT_PUBLIC_API_URL`     | Public API base URL, default example `http://localhost:4000`                |
| `PORT`                    | API port, defaults to `4000`                                                |

For local Compose services, set `DATABASE_URL` in your ignored `.env` to `postgresql://pulsedesk:pulsedesk_local@localhost:5432/pulsedesk?schema=public` and `REDIS_URL` to `redis://localhost:6379`. These are local development credentials only. Never reuse them in production.

Next.js reads environment files from `apps/web`, rather than the root. If a future browser integration needs the API URL, set it in `apps/web/.env.local` or export it in the shell. The current home page makes no API requests.

## Local services

```sh
docker compose config
docker compose up -d --wait
docker compose ps
```

PostgreSQL and Redis have health checks, bind only to loopback, and persist data in named volumes. Redis uses append-only persistence. PostgreSQL 18 mounts its parent data directory at `/var/lib/postgresql`.

`docker compose down` stops services while preserving data. `docker compose down -v` also deletes the local database and Redis volumes.

## Development

```sh
pnpm --filter @pulsedesk/api prisma:migrate:deploy
pnpm dev
# In another terminal (after pnpm build), start the separate SLA worker:
pnpm worker
```

Web: <http://localhost:3000> displays **PulseDesk Web** and **System Ready**. API: <http://localhost:4000/health> returns:

```json
{ "status": "ok", "service": "pulsedesk-api" }
```

This endpoint reports application liveness. `GET /ready` probes PostgreSQL and Redis and returns 503 when a dependency is unavailable. It does not check the separate worker process.

| Root command     | Purpose                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `pnpm dev`       | Start both applications with watch mode                                |
| `pnpm worker`    | Start the separately built SLA worker                                  |
| `pnpm build`     | Build shared packages before applications                              |
| `pnpm lint`      | Run workspace ESLint checks and repository formatting checks           |
| `pnpm typecheck` | Build dependency types and check application/package types             |
| `pnpm test`      | Run unit tests and opt-in PostgreSQL/Redis integration tests           |
| `pnpm format`    | Format repository source and configuration                             |
| `pnpm clean`     | Remove compiled output and task caches; preserve dependencies and data |

Ports: web `3000`, API `4000`, PostgreSQL `5432`, Redis `6379`.

For production-style local startup, run `pnpm build`, then `pnpm --filter @pulsedesk/api start` and `pnpm --filter @pulsedesk/web start` in separate terminals, plus `pnpm worker` for SLA execution.

## Prisma

```sh
pnpm --filter @pulsedesk/api prisma:validate
```

Prisma 7 reads `DATABASE_URL` through `apps/api/prisma.config.ts`. The schema contains 15 core models, an organization ticket-number counter, and a transactional outbox with tenant-safe composite foreign keys. The CLI, generated client, and PostgreSQL adapter use the same Prisma version. Generated code is ignored and recreated automatically before API dev, build, type checking, and tests.

```sh
pnpm --filter @pulsedesk/api prisma:generate
pnpm --filter @pulsedesk/api prisma:migrate:deploy
pnpm --filter @pulsedesk/api prisma:migrate:status
```

`init_core_domain` is the first migration; `ticket_operations` adds the organization counter and ticket workflow version, backfilling counters from existing tickets. `sla_engine` adds the tenant-safe outbox and notification entity/type fields. The initial migration includes SQL-only positive-value checks and a partial unique index for active SLA policies. No seed or database reset is included. Use migrations rather than `db push` and inspect future migration diffs to preserve custom constraints.

The PostgreSQL authentication, ticket-operations, and constraint suites run when `TEST_DATABASE_URL` is exported, pointing at a dedicated database with migrations already applied. For example, create a separate `pulsedesk_test` database in your local PostgreSQL instance, deploy migrations with `DATABASE_URL` pointing to that database, then export its URL as `TEST_DATABASE_URL` and run `pnpm test`. Constraint fixtures roll back; HTTP suites remove only their tracked fixtures. No database reset occurs. Export `TEST_REDIS_URL` as well to run SLA integration tests; each suite generates and cleans an isolated queue prefix without flushing Redis. Without that variable the database suite is explicitly skipped. Root `.env` is not automatically loaded into the test runner; export this opt-in variable in your shell.

See [the domain model](docs/domain-model.md) for entities, the ER diagram, tenant guarantees, delete rules, indexes, and service-layer responsibilities.

## CI and project status

Pull requests and pushes to `main` use Node 24 and isolated PostgreSQL and Redis services. CI runs frozen-lockfile installation, Prisma validation/generation, migration deployment/status, lint, type checks, tests (including database constraints), build, and Compose configuration validation. CI does not deploy the application.

The domain includes users, organizations, memberships, teams, customers, tickets, assignment/comment/status history, SLA policies/events, notifications, audit logs, and hashed refresh-token records. Roles belong to organization membership. Backend registration, login, JWT access, rotating opaque refresh tokens, logout, `/auth/me`, database-verified organization context, and explicit RBAC are implemented. Teams and customers support scoped create/list/detail/update; teams support membership add/remove. Tickets support create/list/detail, triage/assignment, working-state commands, resolve/close/cancel, and staff comments, with atomic history and audit records. SLA policy selection, first-response/resolution completion, delayed breach jobs, outbox recovery, and current-member notifications are implemented. Authenticated realtime transport is available at `/realtime`, with shared access/session verification, explicit organization selection, and tenant/member rooms. Ticket broadcasts, live notifications, presence, a frontend realtime client, incident management, attachments, email ingestion, AI features, and frontend authentication/product screens remain unimplemented. The shared UI still contains only one Button.

See [authentication documentation](docs/authentication.md) for endpoint contracts, configuration, tenant guards, rotation behavior, rate limits, and security limitations. `/auth/context` and `/auth/owner-only` are removable Phase 2 verification endpoints. Authentication uses Argon2id, short-lived HS256 access JWTs, and SHA-256 hashes of opaque refresh tokens. Phase 3 adds only a ticket-number counter and ticket version field; auth/session schema remains unchanged. See [ticket lifecycle and permissions](docs/ticket-lifecycle.md) for API contracts, required `expectedVersion` command preconditions, agent visibility, concurrency, history limits, and audit behavior.

See [the SLA engine guide](docs/sla-engine.md) for worker startup, policy/notification APIs, UTC semantics, idempotency, outage behavior, retention, and manual recovery commands. Policy changes affect new tickets only; no active policy means no SLA.

See [the realtime guide](docs/realtime.md) for handshake authentication, event acknowledgements, organization switching, origin configuration, live revalidation, and single-instance scaling limits.

The lint toolchain currently stays on ESLint 9 because Next.js's React, import, and accessibility plugins declare ESLint 9 compatibility. npm marks this version deprecated; upgrade it when those plugins support ESLint 10. A root pnpm override keeps Nest CLI's transitive webpack dependency compatible with schema-utils' webpack peer requirement.
