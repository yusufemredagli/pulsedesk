'use client';
import { useState } from 'react';
import { useApplication } from '../application/provider';
import { useResource } from '../operations/resource';
import { date } from '../operations/model';
import { ErrorState, Loading } from '../operations/ui';
import { displayLabel } from '../../lib/presentation';
import { NameForm } from './forms';
import { type Settings as SettingsData, canManageWorkspace } from './model';
import { PageHeading } from './ui';
export function Settings() {
  const { state } = useApplication();
  return <SettingsRecord key={state.tenantRevision} />;
}
function SettingsRecord() {
  const { client } = useApplication();
  const result = useResource<SettingsData>('/settings', false);
  const [editing, setEditing] = useState<{
      kind: 'account' | 'workspace';
      name: string;
      updatedAt: string;
    } | null>(null),
    [saved, setSaved] = useState(false),
    [profileError, setProfileError] = useState('');
  if (result.error)
    return (
      <ErrorState entity="Ayar" error={result.error} retry={result.refresh} />
    );
  if (!result.data) return <Loading />;
  const settings = result.data;
  return (
    <div className="operations">
      <PageHeading
        eyebrow="ÇALIŞMA ALANI / AYARLAR"
        title="Ayarlar"
        description="Çalışma alanınızı ve hesap bilgilerinizi güvenle yönetin."
        action={<button onClick={result.refresh}>Yenile</button>}
      />
      {saved && (
        <p className="management-success" role="status">
          Değişiklikler kaydedildi.
        </p>
      )}
      {profileError && (
        <p role="alert" className="ops-error">
          {profileError}
        </p>
      )}
      <div className="settings-grid">
        <section className="ops-panel detail-section">
          <header className="panel-heading">
            <div>
              <h2>Çalışma Alanı</h2>
              <p>Kuruluşunuzun kimliği ve mevcut yetkiniz</p>
            </div>
            {canManageWorkspace(settings.role) && (
              <button
                aria-label="Çalışma alanı adını düzenle"
                onClick={() =>
                  setEditing({ kind: 'workspace', ...settings.workspace })
                }
              >
                Düzenle
              </button>
            )}
          </header>
          <dl className="settings-facts">
            <dt>Çalışma Alanı Adı</dt>
            <dd>{settings.workspace.name}</dd>
            <dt>Kısa Ad</dt>
            <dd>
              {settings.workspace.slug}
              <small>
                Salt okunur · çalışma alanı kimliğini korumak için
                değiştirilemez.
              </small>
            </dd>
            <dt>Çalışma Alanı Kimliği</dt>
            <dd className="technical-value">{settings.workspace.id}</dd>
            <dt>Rolünüz</dt>
            <dd>{displayLabel(settings.role)}</dd>
            <dt>Son Güncelleme</dt>
            <dd>{date(settings.workspace.updatedAt)}</dd>
          </dl>
        </section>
        <section className="ops-panel detail-section">
          <header className="panel-heading">
            <div>
              <h2>Hesabım</h2>
              <p>Diğer ekip üyelerine görünen bilgileriniz</p>
            </div>
            <button
              aria-label="Görünen adını düzenle"
              onClick={() =>
                setEditing({ kind: 'account', ...settings.account })
              }
            >
              Düzenle
            </button>
          </header>
          <dl className="settings-facts">
            <dt>Görünen Ad</dt>
            <dd>{settings.account.name}</dd>
            <dt>E-posta</dt>
            <dd>
              {settings.account.email}
              <small>
                Salt okunur · e-posta değiştirme henüz desteklenmiyor.
              </small>
            </dd>
            <dt>Hesap Durumu</dt>
            <dd>
              <span
                className={`ops-badge ${settings.account.isActive ? 'healthy' : 'neutral'}`}
              >
                {settings.account.isActive ? 'Etkin' : 'Etkin Değil'}
              </span>
            </dd>
            <dt>Geçerli Rol</dt>
            <dd>{displayLabel(settings.role)}</dd>
          </dl>
        </section>
      </div>
      <section className="ops-panel detail-section">
        <h2>Güvenlik ve Oturum</h2>
        <p className="management-notice">
          {settings.account.email} hesabıyla {settings.workspace.name} çalışma
          alanındasınız. Geçerli rolünüz: {displayLabel(settings.role)}.
        </p>
        <p className="ops-footnote">
          Çıkış yaptığınızda mevcut oturumunuz iptal edilir. Farklı çalışma
          alanları arasında geçiş yapmak için üst çubuktaki çalışma alanı
          seçicisini kullanın.
        </p>
        <button className="danger-button" onClick={() => void client.logout()}>
          Çıkış Yap
        </button>
      </section>
      {editing && (
        <NameForm
          title={
            editing.kind === 'workspace'
              ? 'Çalışma Alanı Adını Düzenle'
              : 'Görünen Adını Düzenle'
          }
          initial={editing}
          path={`/settings/${editing.kind}`}
          close={() => setEditing(null)}
          refresh={result.refresh}
          done={async () => {
            setEditing(null);
            setSaved(true);
            setProfileError('');
            result.refresh();
            try {
              await client.refreshMemberships();
            } catch {
              setProfileError(
                'Değişiklik kaydedildi; üst çubuk bilgileri yenilenemedi. Sayfayı yenileyin.',
              );
            }
          }}
        />
      )}
    </div>
  );
}
