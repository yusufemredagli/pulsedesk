# PulseDesk — technical case study

PulseDesk is a customer support workspace that connects a ticket to its customer, responsible team, conversation history and service deadlines. The intended users are support managers coordinating a queue, agents handling authorized tickets and viewers who need operational visibility.

**Role presented:** backend-focused full-stack developer and repository owner. The implementation shown here spans the PostgreSQL model, NestJS API, authentication/authorization, background processing and Next.js interface. This is a portfolio implementation and local demo; no production adoption, customer outcome or traffic scale is claimed.

[Product screenshots](../README.md#screenshots) · [Architecture](architecture.md) · [Verification](verification.md) · [90-second walkthrough](demo-script.md)

## The business problem

A support request is difficult to coordinate when its owner, status, customer context and response deadline live in separate places. PulseDesk puts those records in one organization workspace. Managers can triage and assign work, agents can update accessible tickets, and the team can inspect the resulting timeline and SLA state.

The implemented scope includes tickets, customers, teams, comments, persisted notifications, SLA policies and basic account/workspace settings. It does not include a full user invitation/role editor, email delivery, attachments, incident management or a separate reporting product. A public customer portal is not implied by the “public comment” visibility field.

## Stack and process boundaries

| Responsibility    | Implementation                                               |
| ----------------- | ------------------------------------------------------------ |
| Product UI        | Next.js 16, React 19, TypeScript                             |
| API               | NestJS 11 with validated HTTP commands and Socket.IO         |
| Persistence       | PostgreSQL 18, Prisma 7 and the PostgreSQL adapter           |
| Delayed work      | Redis 8.10, BullMQ and a separate worker process             |
| Workspace/tooling | pnpm workspaces, Turborepo, ESLint, Prettier, GitHub Actions |

The API owns realtime outbox dispatch. The worker owns SLA outbox delivery and delayed deadline processing. These are not microservices: the API and worker share the same domain/database and are independently started processes. See the [architecture diagram](architecture.md).

Sources: [workspace scripts](../package.json), [API package](../apps/api/package.json), [web package](../apps/web/package.json), [Compose](../docker-compose.yml).

## Tenant isolation: application scope plus database relations

The authenticated request selects a workspace with `X-Organization-Id`. The organization guard verifies the user's current active membership in the database; the header alone does not grant access. Mutating transactions revalidate the member/role under row locks.

Operational queries include `organizationId`. Compound relations such as `(organizationId, customerId)` and `(organizationId, assignedMemberId)` keep tickets attached to records in the same organization. Ticket numbering is organization-local and allocated through an atomic counter update. This is a shared schema with application-enforced scope and composite foreign keys, **not PostgreSQL row-level security or one database per tenant**.

Sources: [organization guard](../apps/api/src/modules/auth/guards/organization.guard.ts), [transaction boundary](../apps/api/src/common/domain-transaction.service.ts), [schema](../apps/api/prisma/schema.prisma), [constraint tests](../apps/api/test).

## RBAC and live permissions

Roles belong to organization membership rather than the global user. The server checks current membership rather than trusting an old role in a browser token. UI controls mirror those boundaries; hiding a button is not the authorization mechanism.

| Capability                          | OWNER | ADMIN | MANAGER | AGENT                            | VIEWER |
| ----------------------------------- | ----- | ----- | ------- | -------------------------------- | ------ |
| Read workspace operational data     | Yes   | Yes   | Yes     | Ticket visibility is scoped      | Yes    |
| Create tickets / add comments       | Yes   | Yes   | Yes     | Authorized tickets               | No     |
| Triage, assign, cancel or close     | Yes   | Yes   | Yes     | No                               | No     |
| Start, wait, resume or resolve      | Yes   | Yes   | Yes     | Assigned/team-accessible tickets | No     |
| Manage customers and teams          | Yes   | Yes   | Yes     | No                               | No     |
| Write SLA policies / workspace name | Yes   | Yes   | No      | No                               | No     |

An AGENT can access personally assigned tickets and tickets for a team they currently belong to. VIEWER is read-only for operational data; basic own-account name changes are a separate settings capability. The owner-only verification endpoint is not an administration UI.

Sources: [ticket policy](../apps/api/src/modules/tickets/policies/ticket.policy.ts), [ticket commands](../apps/api/src/modules/tickets/tickets.controller.ts), [SLA guards](../apps/api/src/modules/sla/sla-policy.controller.ts), [settings](../apps/api/src/modules/settings/settings.module.ts).

## Data model and workflow history

`OrganizationMember` links users to organizations and roles; `TeamMember` links those memberships to teams. A ticket references a customer and optional current assignees, while separate assignment, comment and status-history tables preserve the operational timeline. `SlaPolicy` defines targets; `SlaEvent` stores a ticket's actual deadlines/completion/breach state. Notifications are recipient-scoped. Audit records and outbox records are distinct from the user-facing timeline.

Indexes cover organization/status/assignee/priority queue access. Composite relations and restrictive delete behavior preserve references. Ticket detail reads use a repeatable-read transaction for a coherent view of related history. History is bounded and reports whether more records exist; this is not an unlimited audit export.

Sources: [Prisma schema](../apps/api/prisma/schema.prisma), [domain model guide](domain-model.md), [ticket detail service](../apps/api/src/modules/tickets/tickets.service.ts).

## Optimistic concurrency

Lifecycle and assignment commands carry `expectedVersion`. A write matches the organization, ticket ID, version and current status, then increments the version. A stale command returns a conflict instead of silently overwriting a newer change. Customer/team/settings editors use timestamp-based conflict checks; they do not reuse the ticket version contract.

This makes concurrent work visible to the user, but a conflict still needs review/retry. Comments and every other write are not claimed to share the same version mechanism.

Sources: [conditional ticket update](../apps/api/src/modules/tickets/tickets.service.ts), [resource-edit helper](../apps/api/src/common/resource-edit.ts), [ticket lifecycle guide](ticket-lifecycle.md).

## Transactional outbox and BullMQ

Ticket changes, their history/audit effects and relevant outbox records are committed through the same database transaction. This avoids treating a successful database write as proof that a queue or socket message was delivered.

The separate worker polls SLA outbox rows with `FOR UPDATE SKIP LOCKED` and schedules BullMQ jobs in Redis. Delayed jobs identify a persisted SLA event; the processor re-reads and locks database state before recording a breach. Already completed, cancelled or previously breached work can become a no-op. Retry metadata and deferred work stay in PostgreSQL when delivery fails.

A queue call can succeed before the surrounding database transaction fails. Deterministic jobs and state checks are therefore important: this is retryable/idempotent processing, **not a distributed exactly-once guarantee**. Policy changes affect newly created tickets; existing deadlines remain snapshots. First response is completed by a public team comment, not by an email delivery event.

Sources: [outbox dispatcher](../apps/api/src/infrastructure/queue/outbox-dispatcher.service.ts), [worker runtime](../apps/api/src/worker/worker-runtime.service.ts), [deadline service](../apps/api/src/modules/sla/sla-deadline.service.ts), [SLA creation/completion](../apps/api/src/modules/sla/sla.service.ts).

## Realtime is a hint; HTTP remains authoritative

The API polls ticket/notification outbox records and emits through an authenticated Socket.IO namespace. Candidate recipients are revalidated before delivery; ticket visibility is checked again and notifications target the current member. The client reconciles ticket hints by fetching current HTTP state instead of applying event payloads as the full source of truth. Reconnect handling reselects/revalidates context and fetches persisted notifications.

The current Socket.IO adapter is local to one API instance. Redis is used for BullMQ, not as a distributed Socket.IO fan-out adapter. Horizontal API scaling would need additional delivery design. A socket hint is not durable browser history; persisted records and subsequent HTTP reads provide recovery.

Sources: [API dispatch runtime](../apps/api/src/modules/realtime/realtime-dispatch-runtime.ts), [recipient validation](../apps/api/src/modules/realtime/realtime-emitter.service.ts), [adapter](../apps/api/src/modules/realtime/realtime-adapter.ts), [client reconciliation](../apps/web/src/lib/realtime/reconciliation.ts), [frontend architecture](frontend-architecture.md).

## Challenges and trade-offs observed in the code and review

- **Concurrent operators:** explicit lifecycle commands, version checks and atomic history prevent a general “update status” endpoint from becoming the whole workflow. This adds conflict-handling work to the interface.
- **Database plus external delivery:** outbox polling adds latency and retry/retention concerns, but separates committed state from Redis/socket availability. It does not remove all failure modes.
- **Live authorization:** repeated membership/recipient validation costs database reads. It reduces reliance on stale room membership or token role snapshots.
- **Session transport:** the frontend currently uses sessionStorage with refresh coordination. An HttpOnly cookie strategy remains a deployment/security decision; the current implementation is not described as cookie-authenticated.
- **Local development:** Node 25 on this Mac hit watcher/FSEvent limits. The existing build plus separate API/web/worker startup path worked without changing dependencies or lockfiles.
- **Accessibility:** local review found low-contrast supporting text and lost trigger focus when dialogs closed. The local changes darken existing text/focus colors and restore the connected trigger on dialog cleanup; no layout redesign was needed.

## Test and quality evidence

On **13 November 2026**, using **Node 25.1.0**, the existing runner reported:

| Run                                                                | Web       | API                  | Total                 |
| ------------------------------------------------------------------ | --------- | -------------------- | --------------------- |
| Default `pnpm test`, without test services                         | 43 passed | 23 passed, 8 skipped | 66 passed, 8 skipped  |
| Dedicated migrated PostgreSQL and namespaced Redis integration run | 43 passed | 170 passed           | 213 passed, 0 skipped |

The integration count includes parent tests and nested subtests reported by Node's runner. Skipped integration parents expand into their child checks when services are enabled; these are two execution scopes, not a claim of 213 separate files or features. No generic “200+” badge is used. Current lint/typecheck/build and browser review details are recorded in [verification](verification.md).

The integration suites exercise tenant constraints, HTTP authorization/workflows, refresh sessions, SLA/Redis recovery, realtime behavior, management operations and demo-seed preservation. Computer Use adds a separate real UI walkthrough; it is not a full WCAG audit, production load test or deployment certification.

## Next steps

1. Validate the supported Node 24 runtime and a deployed staging environment.
2. Decide session/cookie transport, HTTPS/origin policy and production secret handling; exclude all demo identities from production.
3. Add operational monitoring, explicit worker health checks and tested database/Redis backup recovery.
4. Load-test realistic tenant/queue sizes before setting capacity targets or scaling the API.
5. Design distributed realtime fan-out before running multiple API instances.
6. Extend user invitations/role administration, notification history and other product capabilities only when their contracts and UI actually exist.
