'use client';
import { displayLabel } from '../../lib/presentation';
import Link from 'next/link';
import { Icon } from '../../components/brand';
import { useApplication } from './provider';
const eventLabels = {
  'ticket:created': 'Talep oluşturuldu',
  'ticket:assigned': 'Atama değişti',
  'ticket:status-changed': 'Talep durumu değişti',
  'ticket:comment-added': 'Yorum eklendi',
  'notification:new': 'Bildirim alındı',
};
export function Landing() {
  const { state } = useApplication();
  const { user, selected } = state.session;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">OPERASYON ÇALIŞMA ALANINIZ</span>
          <h1>Net bir başlangıç.</h1>
          <p>
            Hoş geldin, {user?.name.split(' ')[0]}. Ekibinizin bir sonraki
            yanıtı burada başlar.
          </p>
        </div>
        <span className="workspace-tag">
          <span className="status-dot" />
          {selected?.organizationName}
        </span>
      </div>
      <section className="welcome-panel">
        <div className="welcome-symbol">
          <Icon name="signal" size={34} />
        </div>
        <div className="welcome-copy">
          <span className="eyebrow">EKİBİNİZ İÇİN HAZIR</span>
          <h2>
            Daha az karmaşa.
            <br />
            Daha koordineli destek.
          </h2>
          <p>
            Çalışma alanınız, her yanıtın arkasındaki ekibi, bilgiyi ve
            sinyalleri bir araya getirir.
          </p>
        </div>
        <div className="welcome-orbit" aria-hidden="true">
          <div />
          <div />
          <div />
          <svg viewBox="0 0 200 100">
            <path d="M0 52h48l13-17 14 38 18-65 20 84 16-50 13 10h58" />
          </svg>
        </div>
      </section>
      <section className="workspace-facts" aria-label="Geçerli çalışma alanı">
        <div className="fact-card">
          <span className="fact-icon">
            <Icon name="team" />
          </span>
          <div>
            <span className="fact-label">AKTİF ÇALIŞMA ALANI</span>
            <strong>{selected?.organizationName}</strong>
            <span>Geçerli çalışma alanınız</span>
          </div>
        </div>
        <div className="fact-card">
          <span className="fact-icon">
            <Icon name="shield" />
          </span>
          <div>
            <span className="fact-label">YETKİNİZ</span>
            <strong className="capitalize">
              {displayLabel(selected?.role)}
            </strong>
            <span>Doğrulanmış çalışma alanı üyeliği</span>
          </div>
        </div>
        <Link href="/app/notifications" className="fact-card fact-link">
          <span className="fact-icon">
            <Icon name="bell" />
          </span>
          <div>
            <span className="fact-label">BİLDİRİMLERİNİZ</span>
            <strong>
              {state.unread === null
                ? 'Bildirimleriniz kontrol ediliyor'
                : `${state.unread} okunmamış bildirim`}
            </strong>
            <span>
              {state.notificationError
                ? 'Tekrar denemek için bildirimlerinizi yenileyin'
                : 'İlginizi bekleyen bildirimler'}
            </span>
          </div>
          <Icon name="arrow" size={18} />
        </Link>
      </section>
      <div className="landing-grid">
        <section className="panel activity-panel">
          <header className="panel-heading">
            <div>
              <span className="overline">ÇALIŞMA ALANI AKIŞI</span>
              <h2>Son Aktiviteler</h2>
            </div>
            <span className="small-label">Bu oturum</span>
          </header>
          {state.events.length === 0 ? (
            <div className="empty-activity">
              <div className="empty-orbit">
                <Icon name="signal" size={25} />
              </div>
              <h3>Henüz aktivite yok.</h3>
              <p>
                Ekibiniz çalıştıkça güncellemeler burada görünecek.
                <br />
                Çalışma alanınız hazır.
              </p>
            </div>
          ) : (
            <ul className="activity-list">
              {state.events.map((event) => (
                <li key={event.eventId}>
                  <span className="activity-icon">
                    <Icon
                      name={event.notificationId ? 'bell' : 'ticket'}
                      size={17}
                    />
                  </span>
                  <div>
                    <strong>{eventLabels[event.name]}</strong>
                    <span>
                      {event.ticketNumber
                        ? `PD-${String(event.ticketNumber).padStart(6, '0')}`
                        : 'Size özel bildirimler'}
                    </span>
                  </div>
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleTimeString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel focus-panel">
          <span className="focus-icon">
            <Icon name="shield" size={24} />
          </span>
          <span className="overline">ODAKLI BİR ÇALIŞMA ALANI</span>
          <h2>
            Doğru bilgi.
            <br />
            Doğru ekip.
          </h2>
          <p>
            <strong>{selected?.organizationName}</strong> çalışma alanındasınız.
            İhtiyaç duyduğunuzda çalışma alanını değiştirebilirsiniz.
          </p>
          <div className="focus-divider" />
          <p className="focus-note">
            <Icon name="signal" size={17} />
            {state.realtime === 'connected'
              ? 'Canlı bağlantı etkin.'
              : 'Canlı bağlantı yeniden kurulurken çalışma alanınızı kullanabilirsiniz.'}
          </p>
          <Link href="/app/notifications" className="inline-link">
            Bildirimleri Aç <Icon name="arrow" size={16} />
          </Link>
        </section>
      </div>
    </>
  );
}
