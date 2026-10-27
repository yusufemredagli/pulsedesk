'use client';
import Link from 'next/link';
import { ApiError } from '../../lib/api/client';
import { date, slaState, words, type Ticket } from './model';
import { useMinute } from './resource';
export function ErrorState({
  error,
  retry,
  entity = 'Talep',
}: {
  error: Error;
  retry: () => void;
  entity?: string;
}) {
  return (
    <div className="ops-error" role="alert">
      <strong>
        {error instanceof ApiError && error.status === 404
          ? `${entity} bulunamadı`
          : error instanceof ApiError && error.status === 403
            ? 'Erişim yetkiniz yok'
            : 'Bu ekran yüklenemedi'}
      </strong>
      <p>{error.message}</p>
      <button onClick={retry}>Tekrar Dene</button>
      <Link href="/app/tickets">Taleplere Dön</Link>
    </div>
  );
}
export function Loading() {
  return (
    <div
      className="ops-loading"
      aria-label="Çalışma alanı yükleniyor"
      role="status"
    >
      {[1, 2, 3, 4].map((n) => (
        <div key={n} />
      ))}
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  return (
    <span className={`ops-badge ${value.toLowerCase()}`}>{words(value)}</span>
  );
}
export function SlaBadges({ ticket }: { ticket: Ticket }) {
  const now = useMinute();
  return (
    <span className="sla-badges">
      {ticket.sla?.length ? (
        ticket.sla.map((sla) => {
          const state = slaState(sla, ticket.status, now);
          return (
            <span
              className={`ops-badge ${state.tone}`}
              key={sla.id}
              title={`${words(sla.type)} · ${date(sla.dueAt)}`}
            >
              {state.label}
            </span>
          );
        })
      ) : (
        <span className="muted">Politika yok</span>
      )}
    </span>
  );
}
export function TicketTable({ tickets }: { tickets: Ticket[] }) {
  return (
    <div className="ticket-table">
      <table>
        <thead>
          <tr>
            {[
              'Talep',
              'Müşteri',
              'Öncelik',
              'Durum',
              'Atanan Kişi',
              'SLA',
              'Güncellendi',
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td data-label="Talep">
                <Link
                  className="ticket-link"
                  href={`/app/tickets/${ticket.id}`}
                >
                  <small>{ticket.reference}</small>
                  <strong>{ticket.subject}</strong>
                </Link>
              </td>
              <td data-label="Müşteri">{ticket.customer.name}</td>
              <td data-label="Öncelik">
                <Badge value={ticket.priority} />
              </td>
              <td data-label="Durum">
                <Badge value={ticket.status} />
              </td>
              <td data-label="Atanan Kişi">
                <span>
                  {ticket.assignedMember?.name ??
                    ticket.assignedTeam?.name ??
                    'Atanmamış'}
                </span>
                {ticket.assignedMember && ticket.assignedTeam && (
                  <small>{ticket.assignedTeam.name}</small>
                )}
              </td>
              <td data-label="SLA">
                <SlaBadges ticket={ticket} />
              </td>
              <td data-label="Güncellendi">
                <time dateTime={ticket.updatedAt}>
                  {date(ticket.updatedAt)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: string;
}) {
  return (
    <div className="ops-empty">
      <span aria-hidden="true">◇</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
