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
          <p className="eyebrow">OPERASYONLAR / TALEPLER</p>
          <h1>
            Talepler{' '}
            <span className="heading-count">
              {query.data?.pagination.total ?? '—'}
            </span>
          </h1>
          <p>Gelen talepleri birlikte yönetin, çözümü hızlandırın.</p>
        </div>
        {state.session.selected?.role !== 'VIEWER' && (
          <button className="primary-button" onClick={() => setCreating(true)}>
            ＋ Yeni Talep Oluştur
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
            Taleplerde ara
            <input
              type="search"
              maxLength={100}
              placeholder="Konu veya PD-000142"
              value={filters.search ?? ''}
              onChange={(event) => change('search', event.target.value)}
            />
          </label>
          <label>
            Durum
            <select
              aria-label="Durum"
              value={filters.status ?? ''}
              onChange={(event) => change('status', event.target.value)}
            >
              <option value="">Tüm durumlar</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Öncelik
            <select
              aria-label="Öncelik"
              value={filters.priority ?? ''}
              onChange={(event) => change('priority', event.target.value)}
            >
              <option value="">Tüm öncelikler</option>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </label>
          <details className="filter-directory">
            <summary>Ekip: {team?.name ?? 'Tüm ekipler'}</summary>
            <Lookup
              label="Ekip"
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
            <summary>Kişi: {member?.name ?? 'Tüm kişiler'}</summary>
            <Lookup
              key={team?.id ?? 'all'}
              label="Kişi"
              path={`/organization/members${team ? `?teamId=${team.id}` : ''}`}
              value={member}
              onChange={(value) => {
                setMember(value);
                change('assignedMemberId', value?.id ?? '');
              }}
            />
          </details>
          <label>
            Sıralama
            <select
              aria-label="Sıralama"
              value={filters.sort ?? 'updatedAt:desc'}
              onChange={(event) => change('sort', event.target.value)}
            >
              <option value="updatedAt:desc">Son güncellenenler</option>
              <option value="createdAt:desc">En yeni talepler</option>
              <option value="createdAt:asc">En eski talepler</option>
              <option value="priority:desc">En yüksek öncelik</option>
              <option value="ticketNumber:asc">Talep numarası ↑</option>
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
                ? 'Talep bulunamadı'
                : 'Henüz talep yok'
            }
          >
            {Object.values(filters).some(Boolean)
              ? 'Farklı bir arama yapın veya filtreleri kaldırarak yeniden deneyin.'
              : 'Yeni müşteri talepleri burada görünecek. Başlamak için bir talep oluşturun.'}
          </Empty>
        )}
        <footer className="table-pagination">
          <span>
            {query.loading
              ? 'Talepler güncelleniyor…'
              : `${query.data?.pagination.total ?? 0} talep · Sayfa ${page} / ${Math.max(1, query.data?.pagination.totalPages ?? 1)}`}
          </span>
          <div>
            <button
              disabled={page === 1 || query.loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Önceki
            </button>
            <button
              disabled={
                !query.data ||
                page >= query.data.pagination.totalPages ||
                query.loading
              }
              onClick={() => setPage((value) => value + 1)}
            >
              Sonraki
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
