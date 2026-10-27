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
  triage: 'İncele',
  assign: 'Ata',
  cancel: 'İptal Et',
  start: 'Başlat',
  'wait-for-customer': 'Müşteriyi Bekle',
  resume: 'Devam Et',
  resolve: 'Çöz',
  close: 'Kapat',
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
          ? 'Bu talep başka bir kullanıcı tarafından güncellendi. Güncel talebi inceleyip tekrar deneyin.'
          : error instanceof Error
            ? error.message
            : 'Lütfen tekrar deneyin.',
      );
      if (
        command === 'comments' &&
        error instanceof ApiError &&
        error.status === 0
      ) {
        setMessage(
          'İşlemin sonucu doğrulanamadı. Yorumu yeniden göndermeden önce güncel zaman akışını kontrol edin.',
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
        ← Talepler
      </Link>
      <header className="ops-heading ticket-heading">
        <div>
          <p className="eyebrow">
            {ticket.reference} <span> / SÜRÜM {ticket.version}</span>
          </p>
          <h1>{ticket.subject}</h1>
          <div className="ticket-header-meta">
            <Badge value={ticket.priority} />
            <Badge value={ticket.status} />
            <span>{ticket.customer.name}</span>
            <span>Oluşturulma: {date(ticket.createdAt)}</span>
          </div>
        </div>
        <button disabled={result.loading} onClick={result.refresh}>
          Yenile
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
            ? 'Bu çalışma alanında yalnızca görüntüleme yetkiniz var'
            : available.length
              ? 'Sonraki adımlar'
              : 'Yapılabilecek işlem yok'}
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
            <h2>Genel Bakış</h2>
            <p className="ticket-description">{ticket.description}</p>
            <dl className="overview-facts">
              <div>
                <dt>Müşteri</dt>
                <dd>{ticket.customer.name}</dd>
              </div>
              <div>
                <dt>Kaynak</dt>
                <dd>{words(ticket.source)}</dd>
              </div>
              <div>
                <dt>Son Güncelleme</dt>
                <dd>{date(ticket.updatedAt)}</dd>
              </div>
              <div>
                <dt>Sürüm</dt>
                <dd>{ticket.version}</dd>
              </div>
              {ticket.resolvedAt && (
                <div>
                  <dt>Çözülme</dt>
                  <dd>{date(ticket.resolvedAt)}</dd>
                </div>
              )}
              {ticket.closedAt && (
                <div>
                  <dt>Kapanma</dt>
                  <dd>{date(ticket.closedAt)}</dd>
                </div>
              )}
            </dl>
          </section>
          <section className="ops-panel detail-section">
            <header className="panel-heading">
              <div>
                <h2>Zaman Akışı</h2>
                <p>Bu talebe ait görüşmeler ve kararlar</p>
              </div>
              <span className="ops-badge neutral">
                {timeline(ticket).length} kayıt
              </span>
            </header>
            {Object.values(ticket.historyHasMore).some(Boolean) && (
              <p className="ops-footnote">
                Her kayıt türünün son 100 kaydı gösteriliyor. Önceki kayıtlar
                sistemde saklanır.
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
              <Empty title="Talebin geçmişi burada oluşacak">
                Değişiklikler ve yorumlar bu talebin ortak kaydını oluşturacak.
              </Empty>
            )}
          </section>
          {role !== 'VIEWER' && (
            <section className="ops-panel detail-section">
              <h2>Yorum Ekle</h2>
              <p className="muted">
                {visibility === 'INTERNAL'
                  ? 'Dahili notları yalnızca yetkili çalışma alanı üyeleri görebilir.'
                  : 'Müşteriye yanıtlar görüşme kaydına eklenir. E-posta gönderilmez.'}
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
                  Görünürlük
                  <select
                    disabled={busy}
                    aria-label="Görünürlük"
                    value={visibility}
                    onChange={(event) => setVisibility(event.target.value)}
                  >
                    <option value="INTERNAL">Dahili Not · yalnızca ekip</option>
                    <option value="PUBLIC">Müşteriye Yanıt</option>
                  </select>
                </label>
                <label>
                  Yorum
                  <textarea
                    required
                    maxLength={10000}
                    rows={4}
                    value={comment}
                    disabled={busy}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder={
                      visibility === 'INTERNAL'
                        ? 'Ekibiniz için bir not yazın…'
                        : 'Müşteriye bir yanıt yazın…'
                    }
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={busy || !comment.trim()}
                >
                  {busy
                    ? 'Kaydediliyor…'
                    : visibility === 'INTERNAL'
                      ? 'Dahili Not Ekle'
                      : 'Müşteriye Yanıt Ekle'}
                </button>
              </form>
              {!ticket.comments.length && (
                <p className="ops-footnote">
                  Henüz yorum yok. İlk yanıtı yazın veya ekibiniz için bir not
                  ekleyin.
                </p>
              )}
            </section>
          )}
        </div>
        <aside>
          <section className="ops-panel detail-section">
            <h2>Atama</h2>
            <dl>
              <dt>Ekip</dt>
              <dd>{ticket.assignedTeam?.name ?? 'Ekip atanmamış'}</dd>
              <dt>Sorumlu Kişi</dt>
              <dd>{ticket.assignedMember?.name ?? 'Kişi atanmamış'}</dd>
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
                Atamayı Düzenle
              </button>
            )}
          </section>
          <section className="ops-panel detail-section">
            <h2>SLA Hedefleri</h2>
            <SlaBadges ticket={ticket} />
            {ticket.sla.map((sla) => (
              <div className="sla-detail" key={sla.id}>
                <strong>{words(sla.type)}</strong>
                <span>Hedef: {date(sla.dueAt)}</span>
                {sla.completedAt && (
                  <span>Tamamlanma: {date(sla.completedAt)}</span>
                )}
                {sla.breachedAt && (
                  <span className="inline-error">
                    Aşılma: {date(sla.breachedAt)}
                  </span>
                )}
              </div>
            ))}
            <p className="ops-footnote">
              Riskte: Hedef süresinin dolmasına en fazla 30 dakika kaldı. Süre
              dolduğunda, sistem kaydı güncellenene kadar da hedef aşılmış
              olarak gösterilir.
            </p>
          </section>
          <section className="detail-note">
            <strong>Tek ve güncel kayıt</strong>
            <p>
              Değişiklikler {ticket.version}. sürüme göre kontrol edilir. Canlı
              güncellemeler bu ekranı otomatik olarak yeniler.
            </p>
          </section>
        </aside>
      </div>
      {action && (
        <Dialog
          title={labels[action] ?? 'Talep İşlemi'}
          busy={busy}
          close={() => setAction(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              if (action === 'assign' && !team && !member) {
                setMessage('Bir ekip veya kişi seçin.');
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
                    Bir ekip, kişi veya her ikisini seçin. Ekip seçtiğinizde
                    yalnızca o ekibin üyeleri listelenir.
                  </p>
                  <Lookup
                    label="Ekip"
                    path="/teams"
                    value={team}
                    onChange={(value) => {
                      setTeam(value);
                      setMember(null);
                    }}
                  />
                  <Lookup
                    key={team?.id ?? 'all'}
                    label="Kişi"
                    path={`/organization/members${team ? `?teamId=${team.id}` : ''}`}
                    value={member}
                    onChange={setMember}
                  />
                </>
              ) : action === 'cancel' ? (
                <label>
                  İptal Nedeni
                  <textarea name="reason" required maxLength={1000} rows={3} />
                </label>
              ) : (
                <p>
                  {ticket.reference} için “{labels[action]}” işlemini onaylıyor
                  musunuz? Bu işlem yeni bir durum kaydı oluşturur.
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
                Geri Dön
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? 'Kaydediliyor…' : labels[action]}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
    </div>
  );
}
