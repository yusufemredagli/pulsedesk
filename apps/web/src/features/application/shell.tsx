'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brand, Icon, type IconName } from '../../components/brand';
import { useApplication } from './provider';
import { RouteGate } from '../auth/route-gate';
import type { ReactNode } from 'react';
const navigation: Array<{ label: string; icon: IconName; href?: string }> = [
  { label: 'Overview', icon: 'grid', href: '/app' },
  { label: 'Tickets', icon: 'ticket' },
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
              <Link
                href="/app/notifications"
                className="notification-bell"
                aria-label={`Notifications${state.unread === null ? ', count not available' : `, ${state.unread} unread`}`}
              >
                <Icon name="bell" size={21} />
                {state.unread !== null && state.unread > 0 && (
                  <span className="notification-badge">
                    {state.unread > 99 ? '99+' : state.unread}
                  </span>
                )}
              </Link>
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
