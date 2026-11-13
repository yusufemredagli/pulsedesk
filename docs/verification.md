# Local verification — 13 November 2026

This is a dated local review, not a production readiness certificate or a CI badge. At the time of this review, no commit, push or deployment had been performed. The previous published baseline is `e4e31db`; this document records the pre-publication local recruiter/demo review.

## Runtime and environment

| Tool                | Reviewed version                                                  |
| ------------------- | ----------------------------------------------------------------- |
| Node.js             | 25.1.0 (repository target: 24; target runtime not validated here) |
| pnpm                | 10.28.2                                                           |
| Docker CLI / Engine | 29.9.2                                                            |
| Docker Compose      | 5.6.1                                                             |

The existing `pulsedesk-portfolio` PostgreSQL/Redis services were healthy. New local demo and test databases were provisioned alongside the old demo without resets or volume removal. Test queues use a dedicated Redis database and randomized namespaces. The prior local demo data and previous screenshots were retained.

The existing `.env` files were not printed or copied into artifacts. Process-level overrides selected the new local databases and worker namespace. No package, lockfile, schema, migration or API contract change was needed.

## Existing test commands and observed counts

| Command / scope                                                                         | Web       | API                  | Total                 |
| --------------------------------------------------------------------------------------- | --------- | -------------------- | --------------------- |
| `pnpm test`, no opt-in service variables                                                | 43 passed | 23 passed, 8 skipped | 66 passed, 8 skipped  |
| `pnpm test`, dedicated migrated DB and Redis via `TEST_DATABASE_URL` / `TEST_REDIS_URL` | 43 passed | 170 passed           | 213 passed, 0 skipped |

Node counts parent tests and nested subtests. Enabling the skipped integration parents runs additional checks, so the totals cannot be compared as if both commands exercised the same test scope. These numbers came from command output, not counting files or `test()` strings. See the [sanitized runner summary](verification/2026-11-13-summary.txt).

Reproduction: create an isolated local PostgreSQL database, apply existing migrations to that database, export the dedicated test service variables and run the repository's existing commands. Never reuse production services. The seed tests intentionally refuse to overwrite existing demo identities; use a separate test database rather than clearing a developer/demo database.

## Build and static checks

`pnpm build`, `pnpm typecheck` and `pnpm lint` were run through the existing scripts. The final command results are captured in the linked runner summary. Prisma's cache is directed to a writable local path; paths and environment values are omitted from published evidence.

Watch-mode startup previously failed with `EMFILE` / FSEvent limits on this Mac. The reviewed application used the documented build plus separate API, worker and web startup path. Node 25 was not worked around by changing dependency versions or lockfiles.

## Actual application walkthrough

- Liveness/readiness returned 200; Redis answered PONG. Database outbox counts confirmed processed records, rather than treating readiness as worker health.
- OWNER: workspace selection; ticket create/triage/assignment; customers, teams and settings; SLA editor.
- AGENT: assigned/team-visible queue, start and internal comment. The owner saw status/comment updates without a manual reload.
- Five-role HTTP smoke checks confirmed read access and owner-only/team/SLA/ticket write guards. Invalid empty-body writes tested guard/validation boundaries without creating records.
- A local-only one-minute URGENT first-response policy produced a real worker-generated SLA alert for PD-000007. The seed defaults were not changed, and no notification was fabricated to fit a script.
- Notification preview displayed the new persisted alert. The application currently exposes unread notifications and mark-read, not an unlimited notification history UI.
- Search with no results, loading views, missing-ticket 404, retry and return-to-list behavior were inspected. The intentional missing-ticket request is an expected HTTP error.
- Customers, teams, team role display, SLA policies and own-account settings were inspected. A full invitation/role editor and separate reporting product are not present.

## Responsive and accessibility review

Eight populated screens (dashboard, tickets, detail, customers, teams, notifications, SLA, settings) were navigated at 390 and 320 CSS pixels. Document width did not exceed viewport width in the recorded checks. The mobile recording uses the AGENT scope, so its counts can differ from desktop OWNER views.

Keyboard login used Tab/Enter; visible input focus was checked. Escape dismissed a dialog. Review found that closing a dialog could leave focus on the page body; the small `Dialog` cleanup change restores the still-connected trigger, and Escape then returned focus to “Düzenle” in the browser.

Native modal Tab wrapping was not conclusively certified: the automation reported BODY after the final control, which cannot by itself distinguish browser-chrome focus from a page focus escape. No custom focus-trap implementation was introduced on that ambiguous observation. This is a basic keyboard review, not a complete screen-reader or WCAG audit.

Measured computed foreground/background pairs:

| Element                           | Before | After  |
| --------------------------------- | ------ | ------ |
| Auth footer text                  | 2.89:1 | 5.10:1 |
| Auth supporting text              | 4.46:1 | 5.10:1 |
| Input placeholder                 | 2.92:1 | 5.29:1 |
| Input focus outline against white | 2.75:1 | 4.71:1 |

The changes reuse the existing muted/cyan design tokens. They do not add gradients, animation, decorative charts or new dependencies. Ratios cover those sampled pairs only; they are not a claim that all contrast requirements have been audited.

## Console and HTTP observation

Browser console error entries and the local API's method/route/status results were reviewed. A temporary observer outside the repository recorded no headers, queries, request bodies, auth data or tokens. The intentional 404 checks are separated from ordinary navigation. WebSocket success was checked through connected state, cross-session reconciliation and an actual persisted SLA notification; a complete HAR or frame trace was not captured.

The final status summary and known limits belong with the review artifact. Normal 2xx results are not a performance or security audit.

## Remaining deployment work

Validate Node 24 and a staging environment, choose HTTPS/origin and session transport, remove/separate demo credentials, configure backups/monitoring and explicit worker health, and load-test realistic queue sizes. The current API binds all interfaces and the realtime layer requires one API instance; access/bind policy and distributed fan-out need deliberate deployment decisions.

For a small demo, an initial planning budget is about **2 vCPU / 4 GiB RAM / 20–30 GiB persistent disk** for one web process, one API, one worker, PostgreSQL and Redis, with builds preferably outside that runtime budget. This is an engineering starting estimate, not a measured capacity guarantee or a hosting recommendation. Database growth, connection pools, event volume, concurrent sessions and build memory must be measured before sizing a real deployment. An external HTTPS endpoint/proxy, production secret management and database/Redis persistence are also required.
