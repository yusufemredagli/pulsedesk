'use client';
import { notificationCopy } from '../../lib/presentation';
import Link from 'next/link';
import { useApplication } from '../application/provider';
import { useResource } from './resource';
import { type Summary, type Page, type Ticket, date, words } from './model';
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
      ? `atandı: ${ticket.data?.assignedMember?.name ?? ticket.data?.assignedTeam?.name ?? 'bir sorumlu'}`
      : name === 'ticket:status-changed'
        ? `${status ? words(status) : 'durum güncellendi'}`
        : name === 'ticket:comment-added'
          ? 'yeni yorum eklendi'
          : name === 'ticket:created'
            ? `${priority === 'URGENT' ? 'acil talep' : 'talep'} oluşturuldu`
            : 'SLA bildirimi alındı';
  return (
    <li>
      <span className="activity-mark" />
      <div>
        {id ? (
          <Link href={`/app/tickets/${id}`}>
            PD-{String(number).padStart(6, '0')}
          </Link>
        ) : (
          <strong>Hizmet Bildirimi</strong>
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
    ['Açık Talepler', 'open', 'signal'],
    ['Acil Talepler', 'urgent', 'danger'],
    ['SLA Riskte', 'atRisk', 'warning'],
    ['SLA Aşıldı', 'breached', 'danger'],
    ['Atanmamış', 'unassigned', 'neutral'],
    ['Aktif İşler', 'activeWork', 'signal'],
  ] as const;
  return (
    <div className="operations">
      <header className="ops-heading">
        <div>
          <p className="eyebrow">OPERASYONLAR / GENEL BAKIŞ</p>
          <h1>Operasyon Merkezi</h1>
          <p>Talepler ve hizmet hedefleri tek bir görünümde.</p>
        </div>
        <Link className="primary-button" href="/app/tickets">
          Talepleri Aç <span aria-hidden="true">↗</span>
        </Link>
      </header>
      {summary.error ? (
        <ErrorState error={summary.error} retry={summary.refresh} />
      ) : (
        <section className="metric-grid" aria-label="Operasyon özeti">
          {metrics.map(([label, key, tone]) => (
            <div className={`metric ${tone}`} key={key}>
              <span>{label}</span>
              <strong>{summary.data?.[key] ?? '—'}</strong>
              <small>
                {summary.loading
                  ? 'Güncelleniyor…'
                  : key === 'open'
                    ? 'Çözüm bekleniyor'
                    : 'Erişebildiğiniz talepler'}
              </small>
            </div>
          ))}
        </section>
      )}
      <div className="dashboard-grid">
        <section className="ops-panel">
          <header className="panel-heading">
            <div>
              <h2>Talep Akışı</h2>
              <p>Son güncellenen talepler</p>
            </div>
            <Link href="/app/tickets">Tümünü Gör →</Link>
          </header>
          {tickets.error ? (
            <ErrorState error={tickets.error} retry={tickets.refresh} />
          ) : tickets.data?.data.length ? (
            <TicketTable tickets={tickets.data.data} />
          ) : tickets.loading ? (
            <Loading />
          ) : (
            <Empty title="Bekleyen talep yok">
              Yeni talepler geldikçe burada görünecek.
            </Empty>
          )}
        </section>
        <aside className="ops-panel">
          <header className="panel-heading">
            <div>
              <h2>Canlı Operasyonlar</h2>
              <p>Çalışma alanına girişinizden bu yana gerçekleşenler</p>
            </div>
            <span
              className={`ops-badge ${state.realtime === 'connected' ? 'healthy' : 'warning'}`}
            >
              {state.realtime === 'connected' ? 'Canlı' : 'Bağlantı kesildi'}
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
            <Empty title="Henüz aktivite yok">
              Atamalar, yorumlar ve durum değişiklikleri burada görünecek.
            </Empty>
          )}
          {state.notifications.slice(0, 2).map((notification) => (
            <div className="feed-alert" key={notification.id}>
              <strong>{notificationCopy(notification).title}</strong>
              <p>{notificationCopy(notification).message}</p>
              <time>{date(notification.createdAt)}</time>
            </div>
          ))}
        </aside>
      </div>
      <p className="ops-footnote">
        Sayılar, erişebildiğiniz talepleri kapsar. Açık taleplere çözülen,
        kapatılan ve iptal edilenler dahil değildir. SLA Riskte, hedef süresinin
        dolmasına en fazla 30 dakika kaldığını belirtir.
      </p>
    </div>
  );
}
