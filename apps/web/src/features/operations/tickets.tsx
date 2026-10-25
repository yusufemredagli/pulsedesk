'use client';
import { useState } from 'react';
import { useResource } from './resource';
import {
  type Page,
  type Ticket,
  STATUSES,
  PRIORITIES,
  words,
  ticketQuery,
} from './model';
import { Empty, ErrorState, Loading, TicketTable } from './ui';
import { useApplication } from '../application/provider';
import { CreateTicket } from './create';
import { Lookup } from './forms';
export function TicketList() {
  const { state } = useApplication();
  return <TicketQueue key={state.tenantRevision} />;
}
function TicketQueue() {
  const { state } = useApplication();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const query = useResource<Page<Ticket>>(ticketQuery(filters, page));
  const [team, setTeam] = useState<{ id: string; name: string } | null>(null);
  const [member, setMember] = useState<{ id: string; name: string } | null>(
    null,
  );
  const change = (key: string, value: string) => {
    setFilters((old) => ({
      ...old,
      [key]: value,
      ...(key === 'assignedTeamId' ? { assignedMemberId: '' } : {}),
    }));
    setPage(1);
  };
  return (
    <div className="operations">
      <header className="ops-heading">
        <div>
          <p className="eyebrow">OPERATIONS / TICKET QUEUE</p>
          <h1>
            Tickets{' '}
            <span className="heading-count">
              {query.data?.pagination.total ?? '—'}
            </span>
          </h1>
          <p>Turn incoming requests into coordinated action.</p>
        </div>
        {state.session.selected?.role !== 'VIEWER' && (
          <button className="primary-button" onClick={() => setCreating(true)}>
            ＋ New ticket
          </button>
        )}
      </header>
      {creating && (
        <CreateTicket
          close={() => setCreating(false)}
          done={() => {
            setCreating(false);
            query.refresh();
          }}
        />
      )}
      <section className="ops-panel">
        <div className="ticket-filters">
          <label className="search-field">
            Search tickets
            <input
              type="search"
              maxLength={100}
              placeholder="Subject or PD-000142"
              value={filters.search ?? ''}
              onChange={(event) => change('search', event.target.value)}
            />
          </label>
          <label>
            Status
            <select
              aria-label="Status"
              value={filters.status ?? ''}
              onChange={(event) => change('status', event.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              aria-label="Priority"
              value={filters.priority ?? ''}
              onChange={(event) => change('priority', event.target.value)}
            >
              <option value="">All priorities</option>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </label>
          <details className="filter-directory">
            <summary>Team: {team?.name ?? 'All teams'}</summary>
            <Lookup
              label="Team"
              path="/teams"
              value={team}
              onChange={(value) => {
                setTeam(value);
                setMember(null);
                change('assignedTeamId', value?.id ?? '');
              }}
            />
          </details>
          <details className="filter-directory">
            <summary>Member: {member?.name ?? 'All members'}</summary>
            <Lookup
              key={team?.id ?? 'all'}
              label="Member"
              path={`/organization/members${team ? `?teamId=${team.id}` : ''}`}
              value={member}
              onChange={(value) => {
                setMember(value);
                change('assignedMemberId', value?.id ?? '');
              }}
            />
          </details>
          <label>
            Sort
            <select
              aria-label="Sort"
              value={filters.sort ?? 'updatedAt:desc'}
              onChange={(event) => change('sort', event.target.value)}
            >
              <option value="updatedAt:desc">Recently updated</option>
              <option value="createdAt:desc">Newest created</option>
              <option value="createdAt:asc">Oldest created</option>
              <option value="priority:desc">Highest priority</option>
              <option value="ticketNumber:asc">Ticket number ↑</option>
            </select>
          </label>
        </div>
        {query.error ? (
          <ErrorState error={query.error} retry={query.refresh} />
        ) : query.data?.data.length ? (
          <TicketTable tickets={query.data.data} />
        ) : query.loading ? (
          <Loading />
        ) : (
          <Empty
            title={
              Object.values(filters).some(Boolean)
                ? 'No matching tickets'
                : 'Your queue is clear'
            }
          >
            {Object.values(filters).some(Boolean)
              ? 'Try a different search or remove a filter to widen the queue.'
              : 'New customer requests will appear here. Create a ticket to start work.'}
          </Empty>
        )}
        <footer className="table-pagination">
          <span>
            {query.loading
              ? 'Updating queue…'
              : `${query.data?.pagination.total ?? 0} tickets · Page ${page} of ${Math.max(1, query.data?.pagination.totalPages ?? 1)}`}
          </span>
          <div>
            <button
              disabled={page === 1 || query.loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <button
              disabled={
                !query.data ||
                page >= query.data.pagination.totalPages ||
                query.loading
              }
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
