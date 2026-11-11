# PulseDesk

**A real-time, multi-tenant customer support platform for managing tickets, teams and response deadlines.**

PulseDesk brings customer records, ticket assignment, status history and SLA tracking into one workspace. Support teams can see who owns a request, what changed and which deadlines need attention.

[Features](#features) · [Demo](#demo) · [Screenshots](#screenshots) · [Installation](#installation-and-environment) · [Tests](#tests) · [Architecture](#architecture)

## Features

- **Ticket operations:** searchable queues, assignment, lifecycle commands, comments and a chronological activity timeline.
- **Workspace administration:** customers, teams, memberships and SLA policies with organization-scoped access.
- **SLA tracking:** first-response and resolution deadlines, delayed jobs and breach notifications.
- **Live updates:** authenticated Socket.IO connections and persisted recipient-scoped notifications.
- **Backend design:** membership-based RBAC, tenant-safe relations, transactional outbox delivery and optimistic concurrency checks.

## Tech stack

| Layer                 | Technologies                                               |
| --------------------- | ---------------------------------------------------------- |
| API                   | TypeScript, NestJS, Prisma, PostgreSQL                     |
| Web                   | Next.js, React, Socket.IO client                           |
| Background processing | Redis, BullMQ, separate SLA worker                         |
| Tooling               | pnpm workspaces, Turborepo, Docker Compose, GitHub Actions |

## Demo

The repository includes a **local demo seed** with role-based accounts and sample ticket workflows. See the [demo environment guide](docs/demo-environment.md) and [startup instructions](#development). The seed is optional and intended for local development only.

A hosted demo is not available. The repository provides local demo setup instructions; the demo was not launched during this documentation review.

## Screenshots

Product screenshots are not included yet. To inspect the UI locally, start the demo and explore the dashboard, ticket queue, ticket detail and management pages. See the [product UI guide](docs/product-ui.md).

## Tests

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Unit tests and builds do not require production credentials. PostgreSQL and Redis integration suites are opt-in and require dedicated test services via `TEST_DATABASE_URL` and `TEST_REDIS_URL`; skipped suites do not establish database or worker correctness. See [Prisma](#prisma) for test setup and [CI and project status](#ci-and-project-status) for the automated checks.

## Scope and limitations

This repository includes the product UI and local demo environment. Current operational limits include a single API instance for realtime delivery and browser sessionStorage for frontend sessions. See the [realtime guide](docs/realtime.md) and [frontend architecture](docs/frontend-architecture.md) before deployment.

## Architecture

A pnpm/Turborepo workspace contains the Next.js web app (`apps/web`), NestJS API (`apps/api`) and shared packages (`packages`). Prisma connects the API to PostgreSQL. Redis and BullMQ support a separate SLA worker and outbox dispatch. Database-scoped integration behavior still needs the checks described below.

## Installation and environment

The repository targets **Node.js 24** (`.nvmrc`, `.node-version`, `package.json`) and **pnpm 10.28.2**. Docker Compose defines local PostgreSQL 18 and Redis 8.10 services.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

Configure the ignored local environment files yourself; never commit credentials. The API requires a local `DATABASE_URL`, `REDIS_URL` and a strong `JWT_ACCESS_SECRET` of at least 32 bytes. Next.js reads `apps/web/.env.local`, rather than the root file.

| Variable                               | Purpose                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`                         | PostgreSQL connection used by the API and Prisma                             |
| `REDIS_URL`                            | Redis connection for readiness and worker queues                             |
| `JWT_ACCESS_SECRET`                    | Access-token signing secret                                                  |
| `FRONTEND_ORIGINS`                     | Exact allowed frontend origins; production requires HTTPS                    |
| `NEXT_PUBLIC_API_URL`                  | Public API address for the web app, normally `http://localhost:4000` locally |
| `TEST_DATABASE_URL` / `TEST_REDIS_URL` | Explicit dedicated integration-test services                                 |

The API loads its own local environment before the root environment; exported values take precedence. See [authentication](docs/authentication.md) and [SLA configuration](docs/sla-engine.md) for additional settings.

## Development

After configuring **local-only** services and credentials:

```sh
docker compose up -d --wait
pnpm db
pnpm dev
```

`pnpm db` applies existing Prisma migrations to the configured database. Review the target before running it. It does not seed data. To add the optional local demo, run `pnpm seed` explicitly before `pnpm dev`; consult the [demo guide](docs/demo-environment.md). Migration and seed commands were not run during the documentation review.

`pnpm dev` starts the web app, API and worker in watch mode. It does not start Docker or run migrations. The worker is a separate process needed for SLA job execution.

- Web: <http://localhost:3000> — sign in or register, then choose an organization.
- API liveness: <http://localhost:4000/health>.
- API readiness: <http://localhost:4000/ready> — checks PostgreSQL and Redis, not the worker process.

These are local addresses, not hosted demo links. `docker compose down` stops local services while retaining named volumes.

## Prisma

```sh
pnpm --filter @pulsedesk/api prisma:validate
pnpm --filter @pulsedesk/api prisma:generate
```

The schema and migrations are in `apps/api/prisma`; client generation is part of the API build/test/typecheck scripts. For integration tests, provision an isolated database, apply the existing migrations to it, and explicitly set `TEST_DATABASE_URL`. Set `TEST_REDIS_URL` to an isolated Redis test service for the SLA integration suite. Do not use production services. These suites are skipped when their required test service variables are absent.

## Verification results

The documentation review on **11 November 2026** used **Node.js 25.1.0**, not the repository's target Node 24:

| Check               | Observed result                |
| ------------------- | ------------------------------ |
| Web tests           | 43 passed, 0 failed            |
| API tests           | 23 passed, 0 failed, 8 skipped |
| Total tests         | **66 passed, 8 skipped**       |
| Build and typecheck | Passed                         |
| Lint and formatting | Passed                         |

The successful test/build/typecheck run used `pnpm exec turbo run test build typecheck --env-mode=loose` with `XDG_CACHE_HOME` redirected to a writable local cache. `pnpm lint` also passed. The initial Prisma attempts failed because the sandbox could not write to the default user cache; the redirected run passed. Dependencies were installed with lifecycle scripts disabled for this review.

This is not Node 24 validation. The eight database/Redis integration tests were not executed; neither were authenticated browser workflows. No broader test-count claim is made from these results.

## CI and project status

`.github/workflows/ci.yml` is configured to run on pull requests and pushes to `main`, using Node 24 with PostgreSQL and Redis services. It defines installation, Prisma checks/migrations, lint, typecheck, tests, build and Compose validation. This describes the workflow configuration, not a claim that the documentation changes have passed CI or been deployed.

## Technical guides

- [Domain model and tenant relations](docs/domain-model.md)
- [Authentication and authorization](docs/authentication.md)
- [Ticket lifecycle and concurrency](docs/ticket-lifecycle.md)
- [SLA worker and outbox](docs/sla-engine.md)
- [Realtime delivery and single-instance limitation](docs/realtime.md)
- [Frontend sessions and architecture](docs/frontend-architecture.md)
- [Product UI](docs/product-ui.md)
- [Management UI](docs/management-ui.md)
- [Local demo environment](docs/demo-environment.md)
