'use client';
import type { ReactNode } from 'react';
import type { Page } from '../operations/model';
import { date } from '../operations/model';
import type { Statistics } from './model';
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="ops-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function Pager({
  pagination,
  page,
  loading,
  setPage,
}: {
  pagination?: Page<unknown>['pagination'];
  page: number;
  loading: boolean;
  setPage: (page: number) => void;
}) {
  return (
    <footer className="table-pagination">
      <span>
        {loading
          ? 'Güncelleniyor…'
          : `${pagination?.total ?? 0} kayıt · Sayfa ${page} / ${Math.max(1, pagination?.totalPages ?? 1)}`}
      </span>
      <div>
        <button
          disabled={page === 1 || loading}
          onClick={() => setPage(page - 1)}
        >
          Önceki
        </button>
        <button
          disabled={loading || !pagination || page >= pagination.totalPages}
          onClick={() => setPage(page + 1)}
        >
          Sonraki
        </button>
      </div>
    </footer>
  );
}
export function Stats({
  statistics,
  team = false,
}: {
  statistics: Statistics;
  team?: boolean;
}) {
  return (
    <div className="management-metrics">
      <div>
        <span>{team ? 'Toplam iş yükü' : 'Toplam Talep'}</span>
        <strong>{statistics.totalTickets}</strong>
      </div>
      <div>
        <span>{team ? 'Çözüm Bekleyen' : 'Açık Talepler'}</span>
        <strong>{statistics.openTickets}</strong>
      </div>
      <div>
        <span>Aktif İşler</span>
        <strong>{statistics.activeTickets}</strong>
      </div>
      <div>
        <span>Son Aktivite</span>
        <strong className="metric-date">
          {statistics.lastActivityAt
            ? date(statistics.lastActivityAt)
            : 'Henüz hareket yok'}
        </strong>
      </div>
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return <p className="management-notice">{children}</p>;
}
