'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApplication } from '../application/provider';
import { useResource } from '../operations/resource';
import { type Page, type Ticket, date } from '../operations/model';
import { Empty, ErrorState, Loading, TicketTable } from '../operations/ui';
import { CreateTicket } from '../operations/create';
import { ResourceForm } from './forms';
import { type Customer, canManageOperations, listQuery } from './model';
import { PageHeading, Pager, Stats, Notice } from './ui';
export function Customers() {
  const { state } = useApplication();
  return <CustomerList key={state.tenantRevision} />;
}
function CustomerList() {
  const { state } = useApplication();
  const [search, setSearch] = useState(''),
    [sort, setSort] = useState('name:asc'),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [saved, setSaved] = useState(false);
  const result = useResource<Page<Customer>>(
    listQuery('/customers', search, page, sort),
  );
  return (
    <div className="operations">
      <PageHeading
        eyebrow="OPERASYONLAR / MÜŞTERİLER"
        title="Müşteriler"
        description="Müşteri ilişkilerini, açık işleri ve son hareketleri birlikte takip edin."
        action={
          canManageOperations(state.session.selected?.role) && (
            <button
              className="primary-button"
              onClick={() => setCreating(true)}
            >
              Müşteri Oluştur
            </button>
          )
        }
      />
      {saved && (
        <p className="management-success" role="status">
          Değişiklikler kaydedildi.
        </p>
      )}
      {creating && (
        <ResourceForm
          kind="customer"
          initial={null}
          close={() => setCreating(false)}
          refresh={result.refresh}
          done={() => {
            setCreating(false);
            setPage(1);
            setSearch('');
            setSaved(true);
            result.refresh();
          }}
        />
      )}
      <Notice>
        Talep sayıları ve son aktivite, erişebildiğiniz talepler ve yorumlar
        üzerinden hesaplanır.
      </Notice>
      <section className="ops-panel">
        <div className="management-filters">
          <label>
            Müşterilerde ara
            <input
              type="search"
              maxLength={100}
              placeholder="Ad, e-posta, telefon veya şirket"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Sıralama
            <select
              aria-label="Müşteri sıralaması"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              <option value="name:asc">Ad · A–Z</option>
              <option value="name:desc">Ad · Z–A</option>
              <option value="createdAt:desc">En yeni müşteriler</option>
              <option value="createdAt:asc">En eski müşteriler</option>
            </select>
          </label>
          <span>{result.data?.pagination.total ?? '—'} müşteri</span>
        </div>
        {result.error ? (
          <ErrorState
            entity="Müşteri"
            error={result.error}
            retry={result.refresh}
          />
        ) : result.data?.data.length ? (
          <div className="ticket-table management-table">
            <table>
              <thead>
                <tr>
                  {[
                    'Müşteri',
                    'E-posta',
                    'Telefon',
                    'Toplam Talep',
                    'Açık Talep',
                    'Son Aktivite',
                  ].map((text) => (
                    <th key={text}>{text}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((customer) => (
                  <tr key={customer.id}>
                    <td data-label="Müşteri">
                      <Link
                        className="ticket-link"
                        href={`/app/customers/${customer.id}`}
                      >
                        <strong>{customer.name}</strong>
                        <small>{customer.companyName ?? 'Müşteri kaydı'}</small>
                      </Link>
                    </td>
                    <td data-label="E-posta">
                      {customer.email ?? 'Belirtilmemiş'}
                    </td>
                    <td data-label="Telefon">
                      {customer.phone ?? 'Belirtilmemiş'}
                    </td>
                    <td data-label="Toplam Talep">
                      {customer.statistics.totalTickets}
                    </td>
                    <td data-label="Açık Talep">
                      {customer.statistics.openTickets}
                    </td>
                    <td data-label="Son Aktivite">
                      {customer.statistics.lastActivityAt
                        ? date(customer.statistics.lastActivityAt)
                        : 'Henüz hareket yok'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : result.loading ? (
          <Loading />
        ) : (
          <Empty title={search ? 'Müşteri bulunamadı' : 'Henüz müşteri yok.'}>
            {search
              ? 'Aramanızı değiştirerek tekrar deneyin.'
              : 'İlk müşteri kaydıyla destek geçmişini tek yerde toplamaya başlayın.'}
          </Empty>
        )}
        <Pager
          page={page}
          setPage={setPage}
          pagination={result.data?.pagination}
          loading={result.loading}
        />
      </section>
    </div>
  );
}
export function CustomerDetail({ id }: { id: string }) {
  const { state } = useApplication();
  return <CustomerRecord key={`${state.tenantRevision}:${id}`} id={id} />;
}
function CustomerRecord({ id }: { id: string }) {
  const { state } = useApplication();
  const result = useResource<Customer>(`/customers/${id}`),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<Customer | null>(null),
    [creating, setCreating] = useState(false),
    [saved, setSaved] = useState(false);
  const tickets = useResource<Page<Ticket>>(
    `/tickets?customerId=${id}&page=${page}&limit=20&sort=updatedAt:desc`,
  );
  if (result.error)
    return (
      <ErrorState
        entity="Müşteri"
        error={result.error}
        retry={result.refresh}
      />
    );
  if (!result.data) return <Loading />;
  const customer = result.data;
  return (
    <div className="operations">
      <Link className="back-link" href="/app/customers">
        ← Müşteriler
      </Link>
      <PageHeading
        eyebrow="MÜŞTERİ / DESTEK GEÇMİŞİ"
        title={customer.name}
        description="İletişim bilgileri ve destek geçmişi aynı kayıtta."
        action={
          <div className="management-actions">
            {canManageOperations(state.session.selected?.role) && (
              <button onClick={() => setEditing(customer)}>Düzenle</button>
            )}
            {state.session.selected?.role !== 'VIEWER' && (
              <button
                className="primary-button"
                onClick={() => setCreating(true)}
              >
                Yeni Talep Oluştur
              </button>
            )}
          </div>
        }
      />
      {saved && (
        <p className="management-success" role="status">
          Değişiklikler kaydedildi.
        </p>
      )}
      <Stats statistics={customer.statistics} />
      <section className="ops-panel detail-section">
        <h2>İletişim Bilgileri</h2>
        <dl className="overview-facts">
          <div>
            <dt>E-posta</dt>
            <dd>{customer.email ?? 'Belirtilmemiş'}</dd>
          </div>
          <div>
            <dt>Telefon</dt>
            <dd>{customer.phone ?? 'Belirtilmemiş'}</dd>
          </div>
          <div>
            <dt>Şirket</dt>
            <dd>{customer.companyName ?? 'Belirtilmemiş'}</dd>
          </div>
          <div>
            <dt>Oluşturulma</dt>
            <dd>{date(customer.createdAt)}</dd>
          </div>
        </dl>
        {customer.notes && (
          <p className="ticket-description">{customer.notes}</p>
        )}
      </section>
      <section className="ops-panel">
        <header className="panel-heading">
          <div>
            <h2>Talep Geçmişi</h2>
            <p>Erişebildiğiniz talepler · son güncellenenler önce</p>
          </div>
          <button
            onClick={() => {
              result.refresh();
              tickets.refresh();
            }}
          >
            Yenile
          </button>
        </header>
        {tickets.error ? (
          <ErrorState error={tickets.error} retry={tickets.refresh} />
        ) : tickets.data?.data.length ? (
          <TicketTable tickets={tickets.data.data} />
        ) : tickets.loading ? (
          <Loading />
        ) : (
          <Empty title="Henüz talep geçmişi yok">
            Bu müşteri için erişebildiğiniz talepler burada görünecek.
          </Empty>
        )}
        <Pager
          page={page}
          setPage={setPage}
          pagination={tickets.data?.pagination}
          loading={tickets.loading}
        />
      </section>
      {editing && (
        <ResourceForm
          kind="customer"
          initial={editing}
          close={() => setEditing(null)}
          refresh={result.refresh}
          done={() => {
            setEditing(null);
            setSaved(true);
            result.refresh();
          }}
        />
      )}
      {creating && (
        <CreateTicket
          initialCustomer={{ id: customer.id, name: customer.name }}
          close={() => setCreating(false)}
          done={() => setCreating(false)}
        />
      )}
    </div>
  );
}
