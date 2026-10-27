'use client';
import { displayLabel, notificationCopy } from '../../lib/presentation';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Brand, Icon, type IconName } from '../../components/brand';
import { useApplication } from './provider';
import { RouteGate } from '../auth/route-gate';
import type { ReactNode } from 'react';
const navigation: Array<{ label: string; icon: IconName; href: string }> = [
  { label: 'Genel Bakış', icon: 'grid', href: '/app/dashboard' },
  { label: 'Talepler', icon: 'ticket', href: '/app/tickets' },
  { label: 'Müşteriler', icon: 'users', href: '/app/customers' },
  { label: 'Ekipler', icon: 'team', href: '/app/teams' },
  { label: 'Bildirimler', icon: 'bell', href: '/app/notifications' },
  { label: 'SLA Politikaları', icon: 'clock', href: '/app/sla-policies' },
  { label: 'Ayarlar', icon: 'settings', href: '/app/settings' },
];
function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={mobile ? 'Mobil ana gezinme' : 'Ana gezinme'}
      className="navigation"
    >
      {navigation.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          onClick={(event) => {
            const details = event.currentTarget.closest('details');
            if (details) details.open = false;
          }}
          aria-current={
            pathname === item.href || pathname.startsWith(item.href + '/')
              ? 'page'
              : undefined
          }
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
          {(pathname === item.href || pathname.startsWith(item.href + '/')) && (
            <span className="nav-active-dot" />
          )}
        </Link>
      ))}
    </nav>
  );
}
export function ApplicationShell({ children }: { children: ReactNode }) {
  const { state, client } = useApplication();
  const { user, selected } = state.session;
  const statusLabel =
    state.realtime === 'connected'
      ? 'Canlı bağlantı etkin'
      : state.realtime === 'connecting'
        ? 'Canlı bağlantı kuruluyor'
        : 'Canlı bağlantı kullanılamıyor';
  return (
    <RouteGate area="application">
      <div className="application-shell">
        <a className="skip-link" href="#workspace-content">
          İçeriğe geç
        </a>
        <aside className="sidebar">
          <Link href="/app" className="brand-link">
            <Brand />
          </Link>
          <div className="sidebar-section-label">ÇALIŞMA ALANI</div>
          <Navigation />
          <div className="sidebar-bottom">
            <div className="sidebar-signal">
              <span
                className={`status-dot ${state.realtime === 'connected' ? 'healthy' : ''}`}
              />
              <span>Tutarlı destek için tasarlandı</span>
            </div>
            <div className="sidebar-user">
              <span className="user-avatar">
                {user?.name.slice(0, 1).toLocaleUpperCase('tr-TR')}
              </span>
              <span className="user-copy">
                <strong>{user?.name}</strong>
                <span>{displayLabel(selected?.role)}</span>
              </span>
              <button
                className="icon-button"
                aria-label="Çıkış Yap"
                title="Çıkış Yap"
                onClick={() => void client.logout()}
              >
                <Icon name="logout" size={18} />
              </button>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="topbar-left">
              <div className="mobile-menu">
                <details>
                  <summary aria-label="Gezinmeyi Aç">
                    <Brand compact />
                  </summary>
                  <div className="mobile-navigation-panel">
                    <Navigation mobile />
                    <button
                      className="text-button"
                      onClick={() => void client.logout()}
                    >
                      Çıkış Yap
                    </button>
                  </div>
                </details>
              </div>
              <span className="topbar-breadcrumb">
                Çalışma Alanı <span>/</span>
              </span>
              <button
                className="organization-switcher"
                onClick={client.clearOrganization}
                aria-label={`Çalışma Alanını Değiştir, geçerli alan: ${selected?.organizationName}`}
              >
                <span className="workspace-monogram">
                  {selected?.organizationName
                    .slice(0, 1)
                    .toLocaleUpperCase('tr-TR')}
                </span>
                <strong>{selected?.organizationName}</strong>
                <span className="switch-chevron">⌄</span>
              </button>
            </div>
            <div className="topbar-actions">
              <span
                className={`connection-status ${state.realtime === 'connected' ? 'connected' : ''}`}
                role="status"
              >
                <span className="status-dot" />
                {statusLabel}
              </span>
              <NotificationBell key={state.tenantRevision} />
              <span className="topbar-avatar" title={user?.name}>
                {user?.name.slice(0, 1).toLocaleUpperCase('tr-TR')}
              </span>
            </div>
          </header>
          <main
            id="workspace-content"
            className="workspace-content"
            tabIndex={-1}
          >
            {children}
          </main>
          <footer className="workspace-footer">
            <span>
              PulseDesk <span className="footer-divider">/</span>{' '}
              {selected?.organizationName}
            </span>
            <span>Tek ekip. Koordine bir yanıt.</span>
          </footer>
        </div>
      </div>
    </RouteGate>
  );
}

function NotificationBell() {
  const { state, client } = useApplication();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function read(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await client.markRead(id);
    } catch {
      setError('Bildirim okundu olarak işaretlenemedi. Lütfen tekrar deneyin.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="notification-preview">
      <summary
        className="notification-bell"
        aria-label={`Bildirimler, ${state.unread === null ? 'okunmamış sayısı bilinmiyor' : `${state.unread} okunmamış`}`}
      >
        <Icon name="bell" size={21} />
        {!!state.unread && (
          <span className="notification-badge">
            {state.unread > 99 ? '99+' : state.unread}
          </span>
        )}
      </summary>
      <div className="notification-popover">
        <header>
          <strong>Bildirimler</strong>
          <Link href="/app/notifications">Tümünü Gör</Link>
        </header>
        {(state.notificationError || error) && (
          <p role="alert">{error || state.notificationError}</p>
        )}
        {!state.notifications.length && (
          <p>
            Tüm bildirimleri okudunuz. Yeni hizmet bildirimleri burada
            görünecek.
          </p>
        )}
        {state.notifications.map((item) => (
          <article key={item.id}>
            <strong>{notificationCopy(item).title}</strong>
            <p>{notificationCopy(item).message}</p>
            <time>{new Date(item.createdAt).toLocaleString('tr-TR')}</time>
            <button disabled={busy} onClick={() => void read(item.id)}>
              Okundu Olarak İşaretle
            </button>
          </article>
        ))}
      </div>
    </details>
  );
}
