'use client';
import { displayLabel } from '../../lib/presentation';
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
            Çıkış Yap <Icon name="logout" size={16} />
          </button>
        </header>
        <section className="organization-card">
          <span className="overline">ÇALIŞMA ALANINIZI SEÇİN</span>
          <h1>Bugün hangi çalışma alanındayız?</h1>
          <p>
            <strong>{session.user?.email}</strong> ile giriş yaptınız. Devam
            etmek için bir çalışma alanı seçin.
          </p>
          {session.error && (
            <div className="form-error" role="alert">
              {session.error}
            </div>
          )}
          {loadError && (
            <p className="form-error" role="alert">
              Çalışma alanı erişimi güncellenemedi. Lütfen tekrar deneyin.
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
                  {member.organizationName
                    .slice(0, 2)
                    .toLocaleUpperCase('tr-TR')}
                </span>
                <span className="organization-copy">
                  <strong>{member.organizationName}</strong>
                  <span>{displayLabel(member.role)}</span>
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
          {(session.selecting || checking) && (
            <p className="selection-status" role="status">
              <span className="spinner small" /> Çalışma alanı erişimi
              doğrulanıyor
            </p>
          )}
          {!checking && session.memberships.length === 0 && (
            <div className="empty-state">
              <Icon name="team" size={28} />
              <h2>Henüz bir çalışma alanına erişiminiz yok</h2>
              <p>
                Erişim için çalışma alanı sahibiyle iletişime geçin, ardından
                tekrar kontrol edin.
              </p>
              <button
                className="button secondary"
                onClick={() => void client.revisit()}
              >
                Erişimi Tekrar Kontrol Et
              </button>
            </div>
          )}
          <p className="selection-footnote">
            <Icon name="shield" size={16} /> Çalışma alanı erişiminiz her
            girişte doğrulanır.
          </p>
        </section>
        <footer className="organization-footer">
          Çalışma alanlarınız ayrı, odağınız net kalır.
        </footer>
      </main>
    </RouteGate>
  );
}
