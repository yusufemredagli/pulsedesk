'use client';
import Link from 'next/link';
import { useApplication } from '../application/provider';
import { useResource } from './resource';
import { type Summary, type Page, type Ticket, date } from './model';
import { Empty, ErrorState, Loading, TicketTable } from './ui';
function Activity({
  id,
  number,
  name,
  at,
  status,
  priority,
}: {
  id?: string;
  number?: number;
  name: string;
  at: string;
  status?: string;
  priority?: string;
}) {
  const ticket = useResource<Ticket>(
    id && name === 'ticket:assigned' ? `/tickets/${id}` : null,
    false,
  );
  const title =
    name === 'ticket:assigned'
      ? `assigned to ${ticket.data?.assignedMember?.name ?? ticket.data?.assignedTeam?.name ?? 'a responder'}`
      : name === 'ticket:status-changed'
        ? `${status ? status.toLowerCase().replaceAll('_', ' ') : 'status updated'}`
        : name === 'ticket:comment-added'
          ? 'new comment added'
          : name === 'ticket:created'
            ? `${priority === 'URGENT' ? 'urgent ' : ''}ticket created`
            : 'SLA notification received';
  return (
    <li>
      <span className="activity-mark" />
      <div>
        {id ? (
          <Link href={`/app/tickets/${id}`}>
            PD-{String(number).padStart(6, '0')}
          </Link>
        ) : (
          <strong>Service alert</strong>
        )}
        <p>{title}</p>
        <time dateTime={at}>{date(at)}</time>
      </div>
    </li>
  );
}
export function Dashboard() {
  const { state } = useApplication();
  const summary = useResource<Summary>('/dashboard/summary');
  const tickets = useResource<Page<Ticket>>(
    '/tickets?limit=6&sort=updatedAt:desc',
  );
  const metrics = [
    ['Open tickets', 'open', 'signal'],
    ['Urgent tickets', 'urgent', 'danger'],
    ['SLA at risk', 'atRisk', 'warning'],
    ['SLA breached', 'breached', 'danger'],
    ['Unassigned', 'unassigned', 'neutral'],
    ['Active work', 'activeWork', 'signal'],
  ] as const;
  return (
    <div className="operations">
      <header className="ops-heading">
        <div>
          <p className="eyebrow">OPERATIONS / LIVE OVERVIEW</p>
          <h1>Command center</h1>
          <p>Your queue, your commitments, one clear view.</p>
        </div>
        <Link className="primary-button" href="/app/tickets">
          Open ticket queue <span aria-hidden="true">↗</span>
        </Link>
      </header>
      {summary.error ? (
        <ErrorState error={summary.error} retry={summary.refresh} />
      ) : (
        <section className="metric-grid" aria-label="Operational summary">
          {metrics.map(([label, key, tone]) => (
            <div className={`metric ${tone}`} key={key}>
              <span>{label}</span>
              <strong>{summary.data?.[key] ?? '—'}</strong>
              <small>
                {summary.loading
                  ? 'Updating…'
                  : key === 'open'
                    ? 'Awaiting resolution'
                    : 'Current accessible queue'}
              </small>
            </div>
          ))}
        </section>
      )}
      <div className="dashboard-grid">
        <section className="ops-panel">
          <header className="panel-heading">
            <div>
              <h2>Queue pulse</h2>
              <p>Most recently updated tickets</p>
            </div>
            <Link href="/app/tickets">View all →</Link>
          </header>
          {tickets.error ? (
            <ErrorState error={tickets.error} retry={tickets.refresh} />
          ) : tickets.data?.data.length ? (
            <TicketTable tickets={tickets.data.data} />
          ) : tickets.loading ? (
            <Loading />
          ) : (
            <Empty title="A clear queue">
              New tickets will appear here as work arrives.
            </Empty>
          )}
        </section>
        <aside className="ops-panel">
          <header className="panel-heading">
            <div>
              <h2>Live operations</h2>
              <p>Activity since you joined this workspace</p>
            </div>
            <span
              className={`ops-badge ${state.realtime === 'connected' ? 'healthy' : 'warning'}`}
            >
              {state.realtime === 'connected' ? 'Live' : 'Paused'}
            </span>
          </header>
          {state.events.length ? (
            <ol className="activity-feed">
              {state.events.map((event) => (
                <Activity
                  key={event.eventId}
                  id={event.ticketId}
                  number={event.ticketNumber}
                  name={event.name}
                  at={event.occurredAt}
                  status={event.toStatus}
                  priority={event.priority}
                />
              ))}
            </ol>
          ) : (
            <Empty title="Listening for movement">
              Assignments, comments and lifecycle updates will appear here.
            </Empty>
          )}
          {state.notifications.slice(0, 2).map((notification) => (
            <div className="feed-alert" key={notification.id}>
              <strong>{notification.title}</strong>
              <p>{notification.message}</p>
              <time>{date(notification.createdAt)}</time>
            </div>
          ))}
        </aside>
      </div>
      <p className="ops-footnote">
        Counts reflect tickets you can access. Open excludes resolved, closed
        and cancelled work. SLA at risk means a pending deadline within 30
        minutes.
      </p>
    </div>
  );
}
