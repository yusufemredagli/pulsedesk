'use client';
import { useEffect, useState } from 'react';
import { Brand, Icon } from '../../components/brand';
import { useApplication } from '../application/provider';
import { RouteGate } from './route-gate';
export function OrganizationSelector() {
  const { state, client } = useApplication();
  const session = state.session;
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (session.status !== 'authenticated') return;
    let active = true;
    void client
      .refreshMemberships()
      .then(() => {
        if (active) setLoadError(false);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [client, session.status]);
  return (
    <RouteGate area="organization">
      <main className="organization-screen">
        <header className="organization-header">
          <Brand />
          <button className="text-button" onClick={() => void client.logout()}>
            Sign out <Icon name="logout" size={16} />
          </button>
        </header>
        <section className="organization-card">
          <span className="overline">CHOOSE YOUR WORKSPACE</span>
          <h1>Where are we working today?</h1>
          <p>
            You’re signed in as <strong>{session.user?.email}</strong>. Select
            an organization to continue.
          </p>
          {session.error && (
            <div className="form-error" role="alert">
              {session.error}
            </div>
          )}
          {loadError && (
            <p className="form-error" role="alert">
              Workspace access could not be refreshed. Please try again.
            </p>
          )}
          <div className="organization-list" aria-busy={session.selecting}>
            {session.memberships.map((member) => (
              <button
                className="organization-option"
                key={member.membershipId}
                disabled={session.selecting || checking}
                onClick={() =>
                  void client
                    .selectOrganization(member.organizationId)
                    .catch(() => {})
                }
              >
                <span className="organization-avatar">
                  {member.organizationName.slice(0, 2).toUpperCase()}
                </span>
                <span className="organization-copy">
                  <strong>{member.organizationName}</strong>
                  <span>{member.role.toLowerCase()} access</span>
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
          {(session.selecting || checking) && (
            <p className="selection-status" role="status">
              <span className="spinner small" /> Verifying workspace access
            </p>
          )}
          {!checking && session.memberships.length === 0 && (
            <div className="empty-state">
              <Icon name="team" size={28} />
              <h2>No workspace access yet</h2>
              <p>
                Ask an organization owner to arrange your access, then check
                again.
              </p>
              <button
                className="button secondary"
                onClick={() => void client.revisit()}
              >
                Check access again
              </button>
            </div>
          )}
          <p className="selection-footnote">
            <Icon name="shield" size={16} /> Workspace access is verified each
            time you enter.
          </p>
        </section>
        <footer className="organization-footer">
          Your organizations stay separate. Your focus stays clear.
        </footer>
      </main>
    </RouteGate>
  );
}
