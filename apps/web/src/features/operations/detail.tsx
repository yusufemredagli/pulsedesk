'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useApplication } from '../application/provider';
import { ApiError } from '../../lib/api/client';
import { useResource } from './resource';
import { type Ticket, commands, date, timeline, words } from './model';
import { Badge, Empty, ErrorState, Loading, SlaBadges } from './ui';
import { Dialog, Lookup } from './forms';
const labels: Record<string, string> = {
  triage: 'Triage',
  assign: 'Assign',
  cancel: 'Cancel ticket',
  start: 'Start work',
  'wait-for-customer': 'Wait for customer',
  resume: 'Resume work',
  resolve: 'Resolve',
  close: 'Close ticket',
};
export function TicketDetail({ id }: { id: string }) {
  const { state } = useApplication();
  return <Detail key={`${state.tenantRevision}:${id}`} id={id} />;
}
function Detail({ id }: { id: string }) {
  const { client, state } = useApplication();
  const result = useResource<Ticket>(`/tickets/${id}`);
  const ticket = result.data;
  const actionVersion = useRef(0);
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const [team, setTeam] = useState<{ id: string; name: string } | null>(null);
  const [member, setMember] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [comment, setComment] = useState('');
  const [visibility, setVisibility] = useState('INTERNAL');
  const role = state.session.selected?.role ?? 'VIEWER';
  async function mutate(command: string, body: object) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await client.request(`/tickets/${id}/${command}`, {
        method: 'POST',
        body,
      });
      if (command === 'comments') setComment('');
      setAction(null);
      result.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.status === 409
          ? 'This ticket was updated by another user. Review the refreshed ticket and try again.'
          : error instanceof Error
            ? error.message
            : 'Please try again.',
      );
      if (
        command === 'comments' &&
        error instanceof ApiError &&
        error.status === 0
      ) {
        setMessage(
          'The response could not be confirmed. Review the refreshed timeline before sending this comment again.',
        );
        result.refresh();
      }
      if (error instanceof ApiError && error.status === 409) {
        setAction(null);
        result.refresh();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (result.error)
    return <ErrorState error={result.error} retry={result.refresh} />;
  if (!ticket) return <Loading />;
  const available = commands(ticket.status, role);
  return (
    <div className="operations">
      <Link className="back-link" href="/app/tickets">
        ← Ticket queue
      </Link>
      <header className="ops-heading ticket-heading">
        <div>
          <p className="eyebrow">
            {ticket.reference} <span> / VERSION {ticket.version}</span>
          </p>
          <h1>{ticket.subject}</h1>
          <div className="ticket-header-meta">
            <Badge value={ticket.priority} />
            <Badge value={ticket.status} />
            <span>{ticket.customer.name}</span>
            <span>Created {date(ticket.createdAt)}</span>
          </div>
        </div>
        <button disabled={result.loading} onClick={result.refresh}>
          Refresh
        </button>
      </header>
      {message && (
        <div role="alert" className="ops-error">
          {message}
        </div>
      )}
      <div className="command-bar">
        <span>
          {role === 'VIEWER'
            ? 'Read-only workspace access'
            : available.length
              ? 'Next steps'
              : 'Workflow complete'}
        </span>
        <div>
          {available.map((command) => (
            <button
              className={
                command === 'cancel'
                  ? 'danger-button'
                  : command === 'start' || command === 'resolve'
                    ? 'primary-button'
                    : ''
              }
              disabled={busy || result.loading}
              key={command}
              onClick={() => {
                setMessage('');
                if (command === 'assign') {
                  setTeam(ticket.assignedTeam);
                  setMember(
                    ticket.assignedMember
                      ? {
                          id: ticket.assignedMember.membershipId,
                          name: ticket.assignedMember.name,
                        }
                      : null,
                  );
                }
                actionVersion.current = ticket.version;
                setAction(command);
              }}
            >
              {labels[command]}
            </button>
          ))}
        </div>
      </div>
      <div className="detail-grid">
        <div>
          <section className="ops-panel detail-section">
            <h2>Overview</h2>
            <p className="ticket-description">{ticket.description}</p>
            <dl className="overview-facts">
              <div>
                <dt>Customer</dt>
                <dd>{ticket.customer.name}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{words(ticket.source)}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{date(ticket.updatedAt)}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{ticket.version}</dd>
              </div>
              {ticket.resolvedAt && (
                <div>
                  <dt>Resolved</dt>
                  <dd>{date(ticket.resolvedAt)}</dd>
                </div>
              )}
              {ticket.closedAt && (
                <div>
                  <dt>Closed</dt>
                  <dd>{date(ticket.closedAt)}</dd>
                </div>
              )}
            </dl>
          </section>
          <section className="ops-panel detail-section">
            <header className="panel-heading">
              <div>
                <h2>Timeline</h2>
                <p>The conversation and decisions behind this ticket</p>
              </div>
              <span className="ops-badge neutral">
                {timeline(ticket).length} entries
              </span>
            </header>
            {Object.values(ticket.historyHasMore).some(Boolean) && (
              <p className="ops-footnote">
                Showing the most recent 100 records of each type. Earlier
                history is retained by the service.
              </p>
            )}
            {timeline(ticket).length ? (
              <ol className="ticket-timeline">
                {timeline(ticket).map((item) => (
                  <li
                    key={item.id}
                    className={item.kind === 'INTERNAL' ? 'internal-entry' : ''}
                  >
                    <span className="timeline-symbol" aria-hidden="true">
                      {item.kind === 'INTERNAL'
                        ? '▣'
                        : item.kind === 'PUBLIC'
                          ? '↗'
                          : '●'}
                    </span>
                    <article>
                      <header>
                        <strong>{item.title}</strong>
                        <time dateTime={item.at}>{date(item.at)}</time>
                      </header>
                      {item.body && <p>{item.body}</p>}
                    </article>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty title="The story starts here">
                Changes and comments will build a shared record of this ticket.
              </Empty>
            )}
          </section>
          {role !== 'VIEWER' && (
            <section className="ops-panel detail-section">
              <h2>Add a comment</h2>
              <p className="muted">
                {visibility === 'INTERNAL'
                  ? 'Internal notes are visible to authorized workspace staff.'
                  : 'Public replies are recorded for the customer conversation. No email is sent.'}
              </p>
              <form
                className={`comment-form ${visibility === 'INTERNAL' ? 'internal-composer' : ''}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (comment.trim())
                    void mutate('comments', { body: comment, visibility });
                }}
              >
                <label>
                  Visibility
                  <select
                    disabled={busy}
                    aria-label="Visibility"
                    value={visibility}
                    onChange={(event) => setVisibility(event.target.value)}
                  >
                    <option value="INTERNAL">Internal note · staff only</option>
                    <option value="PUBLIC">Public reply</option>
                  </select>
                </label>
                <label>
                  Comment
                  <textarea
                    required
                    maxLength={10000}
                    rows={4}
                    value={comment}
                    disabled={busy}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder={
                      visibility === 'INTERNAL'
                        ? 'Share context with your team…'
                        : 'Write a customer-facing reply…'
                    }
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={busy || !comment.trim()}
                >
                  {busy
                    ? 'Saving…'
                    : visibility === 'INTERNAL'
                      ? 'Add internal note'
                      : 'Add public reply'}
                </button>
              </form>
              {!ticket.comments.length && (
                <p className="ops-footnote">
                  No comments yet. Add the first response or leave context for
                  your team.
                </p>
              )}
            </section>
          )}
        </div>
        <aside>
          <section className="ops-panel detail-section">
            <h2>Assignment</h2>
            <dl>
              <dt>Team</dt>
              <dd>{ticket.assignedTeam?.name ?? 'No team assigned'}</dd>
              <dt>Responder</dt>
              <dd>{ticket.assignedMember?.name ?? 'No member assigned'}</dd>
            </dl>
            {available.includes('assign') && (
              <button
                disabled={busy}
                onClick={() => {
                  setTeam(ticket.assignedTeam);
                  setMember(
                    ticket.assignedMember
                      ? {
                          id: ticket.assignedMember.membershipId,
                          name: ticket.assignedMember.name,
                        }
                      : null,
                  );
                  actionVersion.current = ticket.version;
                  setAction('assign');
                }}
              >
                Manage assignment
              </button>
            )}
          </section>
          <section className="ops-panel detail-section">
            <h2>Service commitments</h2>
            <SlaBadges ticket={ticket} />
            {ticket.sla.map((sla) => (
              <div className="sla-detail" key={sla.id}>
                <strong>{words(sla.type)}</strong>
                <span>Due {date(sla.dueAt)}</span>
                {sla.completedAt && (
                  <span>Completed {date(sla.completedAt)}</span>
                )}
                {sla.breachedAt && (
                  <span className="inline-error">
                    Breached {date(sla.breachedAt)}
                  </span>
                )}
              </div>
            ))}
            <p className="ops-footnote">
              At risk: a pending deadline within 30 minutes. A past deadline is
              shown as breached even while live processing catches up.
            </p>
          </section>
          <section className="detail-note">
            <strong>One authoritative record</strong>
            <p>
              Changes are checked against version {ticket.version}. Live updates
              refresh this view automatically.
            </p>
          </section>
        </aside>
      </div>
      {action && (
        <Dialog
          title={labels[action] ?? 'Ticket action'}
          busy={busy}
          close={() => setAction(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              if (action === 'assign' && !team && !member) {
                setMessage('Choose a team or a member.');
                return;
              }
              void mutate(action, {
                expectedVersion: actionVersion.current,
                ...(action === 'assign'
                  ? {
                      ...(team ? { assignedTeamId: team.id } : {}),
                      ...(member ? { assignedMemberId: member.id } : {}),
                    }
                  : action === 'cancel'
                    ? { reason: form.get('reason') }
                    : {}),
              });
            }}
          >
            <fieldset disabled={busy}>
              {action === 'assign' ? (
                <>
                  <p>
                    Choose a team, a responder, or both. Selecting a team
                    narrows the member directory.
                  </p>
                  <Lookup
                    label="Team"
                    path="/teams"
                    value={team}
                    onChange={(value) => {
                      setTeam(value);
                      setMember(null);
                    }}
                  />
                  <Lookup
                    key={team?.id ?? 'all'}
                    label="Member"
                    path={`/organization/members${team ? `?teamId=${team.id}` : ''}`}
                    value={member}
                    onChange={setMember}
                  />
                </>
              ) : action === 'cancel' ? (
                <label>
                  Cancellation reason
                  <textarea name="reason" required maxLength={1000} rows={3} />
                </label>
              ) : (
                <p>
                  {labels[action]} for {ticket.reference}? This records a new
                  lifecycle event.
                </p>
              )}
            </fieldset>
            {message && (
              <p className="inline-error" role="alert">
                {message}
              </p>
            )}
            <footer className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Go back
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : labels[action]}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
    </div>
  );
}
