'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Brand, Icon, type IconName } from '../../components/brand';
import { useApplication } from './provider';
import { RouteGate } from '../auth/route-gate';
import type { ReactNode } from 'react';
const navigation: Array<{ label: string; icon: IconName; href?: string }> = [
  { label: 'Overview', icon: 'grid', href: '/app/dashboard' },
  { label: 'Tickets', icon: 'ticket', href: '/app/tickets' },
  { label: 'Customers', icon: 'users' },
  { label: 'Teams', icon: 'team' },
  { label: 'Notifications', icon: 'bell', href: '/app/notifications' },
  { label: 'SLA Policies', icon: 'clock' },
  { label: 'Settings', icon: 'settings' },
];
function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={mobile ? 'Mobile primary navigation' : 'Primary navigation'}
      className="navigation"
    >
      {navigation.map((item) =>
        item.href ? (
          <Link
            key={item.label}
            href={item.href}
            onClick={(event) => {
              const details = event.currentTarget.closest('details');
              if (details) details.open = false;
            }}
            aria-current={pathname === item.href ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {pathname === item.href && <span className="nav-active-dot" />}
          </Link>
        ) : (
          <span className="nav-disabled" key={item.label} aria-disabled="true">
            <Icon name={item.icon} />
            <span>{item.label}</span>
            <span className="soon">Soon</span>
          </span>
        ),
      )}
    </nav>
  );
}
export function ApplicationShell({ children }: { children: ReactNode }) {
  const { state, client } = useApplication();
  const { user, selected } = state.session;
  const statusLabel =
    state.realtime === 'connected'
      ? 'Live updates connected'
      : state.realtime === 'connecting'
        ? 'Connecting live updates'
        : 'Live updates paused';
  return (
    <RouteGate area="application">
      <div className="application-shell">
        <a className="skip-link" href="#workspace-content">
          Skip to workspace
        </a>
        <aside className="sidebar">
          <Link href="/app" className="brand-link">
            <Brand />
          </Link>
          <div className="sidebar-section-label">WORKSPACE</div>
          <Navigation />
          <div className="sidebar-bottom">
            <div className="sidebar-signal">
              <span
                className={`status-dot ${state.realtime === 'connected' ? 'healthy' : ''}`}
              />
              <span>Built for a steady response</span>
            </div>
            <div className="sidebar-user">
              <span className="user-avatar">
                {user?.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="user-copy">
                <strong>{user?.name}</strong>
                <span>{selected?.role.toLowerCase()}</span>
              </span>
              <button
                className="icon-button"
                aria-label="Sign out"
                title="Sign out"
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
                  <summary aria-label="Open navigation">
                    <Brand compact />
                  </summary>
                  <div className="mobile-navigation-panel">
                    <Navigation mobile />
                    <button
                      className="text-button"
                      onClick={() => void client.logout()}
                    >
                      Sign out
                    </button>
                  </div>
                </details>
              </div>
              <span className="topbar-breadcrumb">
                Workspace <span>/</span>
              </span>
              <button
                className="organization-switcher"
                onClick={client.clearOrganization}
                aria-label={`Switch organization, current ${selected?.organizationName}`}
              >
                <span className="workspace-monogram">
                  {selected?.organizationName.slice(0, 1).toUpperCase()}
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
                {user?.name.slice(0, 1).toUpperCase()}
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
            <span>One team. A coordinated response.</span>
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
      setError('Could not mark this alert as read. Please try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="notification-preview">
      <summary
        className="notification-bell"
        aria-label={`Notifications, ${state.unread ?? 'unknown'} unread`}
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
          <strong>Notifications</strong>
          <Link href="/app/notifications">View all</Link>
        </header>
        {(state.notificationError || error) && (
          <p role="alert">{error || state.notificationError}</p>
        )}
        {!state.notifications.length && (
          <p>You’re all caught up. New service alerts will appear here.</p>
        )}
        {state.notifications.map((item) => (
          <article key={item.id}>
            <strong>{item.title}</strong>
            <p>{item.message}</p>
            <time>{new Date(item.createdAt).toLocaleString()}</time>
            <button disabled={busy} onClick={() => void read(item.id)}>
              Mark read
            </button>
          </article>
        ))}
      </div>
    </details>
  );
}
