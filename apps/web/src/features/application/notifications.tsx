'use client';
import { notificationCopy } from '../../lib/presentation';
import { useState } from 'react';
import { Icon } from '../../components/brand';
import { useApplication } from './provider';
export function Notifications() {
  const { state, client } = useApplication();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function read(id: string) {
    setPending(id);
    setError('');
    try {
      await client.markRead(id);
    } catch {
      setError('Bildirim okundu olarak işaretlenemedi. Lütfen tekrar deneyin.');
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">SİZE ÖZEL BİLDİRİMLER</span>
          <h1>Bildirimler</h1>
          <p>Bu çalışma alanında size gelen son okunmamış bildirimler.</p>
        </div>
        <button
          className="button secondary"
          disabled={state.notificationLoading}
          onClick={() => void client.loadNotifications()}
        >
          <Icon name="refresh" size={16} /> Bildirimleri Yenile
        </button>
      </div>
      <section className="panel inbox-panel">
        <header className="panel-heading">
          <h2>Okunmamış Bildirimler</h2>
          <span className="count-label">
            {state.unread === null
              ? 'Kontrol ediliyor'
              : `${state.unread} okunmamış`}
          </span>
        </header>
        {(state.notificationError || error) && (
          <div className="form-error" role="alert">
            {error || state.notificationError}
          </div>
        )}
        {state.notificationLoading && state.unread === null ? (
          <div className="inbox-loading" aria-busy="true">
            <span className="spinner" />
            <p>Bildirimleriniz kontrol ediliyor</p>
          </div>
        ) : state.notifications.length ? (
          <ul className="notification-list">
            {state.notifications.map((note) => (
              <li key={note.id}>
                <span
                  className={`notification-kind ${note.type.includes('BREACHED') ? 'urgent' : ''}`}
                >
                  <Icon
                    name={note.type.includes('BREACHED') ? 'clock' : 'bell'}
                  />
                </span>
                <div>
                  <h3>{notificationCopy(note).title}</h3>
                  <p>{notificationCopy(note).message}</p>
                  <time dateTime={note.createdAt}>
                    {new Date(note.createdAt).toLocaleString('tr-TR')}
                  </time>
                </div>
                <button
                  className="button secondary small-button"
                  disabled={pending !== null}
                  onClick={() => void read(note.id)}
                >
                  {pending === note.id
                    ? 'Kaydediliyor'
                    : 'Okundu Olarak İşaretle'}
                </button>
              </li>
            ))}
          </ul>
        ) : !state.notificationError && state.unread === 0 ? (
          <div className="empty-activity">
            <div className="empty-orbit">
              <Icon name="check" size={26} />
            </div>
            <h3>Tüm bildirimleri okudunuz.</h3>
            <p>Yeni bildirimler geldikçe burada görünecek.</p>
          </div>
        ) : null}
        <footer className="inbox-footnote">
          Son beş okunmamış bildirim gösteriliyor. Canlı bağlantı kesildiğinde
          de bildirimlerinize erişebilirsiniz.
        </footer>
      </section>
    </>
  );
}
