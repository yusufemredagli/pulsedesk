'use client';
import { useState } from 'react';
import { useApplication } from '../application/provider';
import { useResource } from '../operations/resource';
import { Dialog } from '../operations/forms';
import { type Page, PRIORITIES, date } from '../operations/model';
import { Empty, ErrorState, Loading } from '../operations/ui';
import { displayLabel } from '../../lib/presentation';
import { DurationInput } from './forms';
import { useMutation } from './mutation';
import {
  type Policy,
  canManageWorkspace,
  durationLabel,
  durationMinutes,
} from './model';
import { PageHeading, Pager, Notice } from './ui';
function PolicyForm({
  priority,
  initial,
  close,
  done,
  refresh,
}: {
  priority: string;
  initial: Policy | null;
  close: () => void;
  done: () => void;
  refresh: () => void;
}) {
  const mutation = useMutation(refresh);
  const [error, setError] = useState('');
  return (
    <Dialog
      title={initial ? 'SLA Politikasını Güncelle' : 'SLA Politikası Oluştur'}
      close={close}
      busy={mutation.busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          let firstResponseMinutes: number, resolutionMinutes: number;
          try {
            firstResponseMinutes = durationMinutes(
              String(form.get('firstResponseValue')),
              String(form.get('firstResponseUnit')),
            );
            resolutionMinutes = durationMinutes(
              String(form.get('resolutionValue')),
              String(form.get('resolutionUnit')),
            );
            setError('');
          } catch (error) {
            setError(
              error instanceof Error ? error.message : 'Süreleri kontrol edin.',
            );
            return;
          }
          void mutation.run(
            initial ? `/sla/policies/${initial.id}` : '/sla/policies',
            {
              method: initial ? 'PATCH' : 'POST',
              body: {
                name: String(form.get('name') ?? '').trim(),
                firstResponseMinutes,
                resolutionMinutes,
                isActive: form.has('isActive'),
                ...(initial
                  ? { expectedUpdatedAt: initial.updatedAt }
                  : { priority }),
              },
            },
            done,
          );
        }}
      >
        <fieldset disabled={mutation.busy}>
          <p>
            <strong>{displayLabel(priority)}</strong> öncelik · Değişiklikler
            yalnızca yeni taleplere uygulanır. Mevcut taleplerin hedef süreleri
            korunur.
          </p>
          <label>
            Politika Adı
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={
                initial?.name ?? `${displayLabel(priority)} destek hedefi`
              }
            />
          </label>
          <DurationInput
            label="İlk Yanıt Hedefi"
            name="firstResponse"
            minutes={initial?.firstResponseMinutes ?? 30}
            help="Talebe ilk ekip yanıtının verilmesi gereken süre."
          />
          <DurationInput
            label="Çözüm Hedefi"
            name="resolution"
            minutes={initial?.resolutionMinutes ?? 240}
            help="Talebin çözülmesi için hedeflenen toplam süre."
          />
          <label className="checkbox-label">
            <input
              name="isActive"
              type="checkbox"
              defaultChecked={initial?.isActive ?? true}
            />
            Etkin
          </label>
          <small>
            Bu öncelikteki yeni taleplerde SLA uygulanır. Aynı öncelikte
            yalnızca bir etkin politika bulunabilir.
          </small>
        </fieldset>
        {(error || mutation.error) && (
          <p role="alert" className="inline-error">
            {error || mutation.error}
          </p>
        )}
        <footer className="dialog-actions">
          <button type="button" disabled={mutation.busy} onClick={close}>
            Vazgeç
          </button>
          <button className="primary-button" disabled={mutation.busy}>
            {mutation.busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function PolicyGroup({
  priority,
  manage,
}: {
  priority: string;
  manage: boolean;
}) {
  const [page, setPage] = useState(1),
    [editing, setEditing] = useState<Policy | null | undefined>(undefined),
    [saved, setSaved] = useState(false);
  const result = useResource<Page<Policy>>(
    `/sla/policies?priority=${priority}&page=${page}&limit=10`,
    false,
  );
  return (
    <section className="ops-panel policy-group">
      <header className="panel-heading">
        <div>
          <span className={`ops-badge ${priority.toLowerCase()}`}>
            {displayLabel(priority)}
          </span>
          <h2>{displayLabel(priority)} Öncelik</h2>
        </div>
        <button onClick={result.refresh} disabled={result.loading}>
          Yenile
        </button>
      </header>
      {saved && (
        <p className="management-success" role="status">
          Değişiklikler kaydedildi.
        </p>
      )}
      {result.error ? (
        <ErrorState
          entity="Politika"
          error={result.error}
          retry={result.refresh}
        />
      ) : result.data?.data.length ? (
        <div>
          {result.data.data.map((policy) => (
            <article className="policy-record" key={policy.id}>
              <header>
                <strong>{policy.name}</strong>
                <span
                  className={`ops-badge ${policy.isActive ? 'healthy' : 'neutral'}`}
                >
                  {policy.isActive ? 'Etkin' : 'Etkin Değil'}
                </span>
              </header>
              <dl>
                <div>
                  <dt>İlk Yanıt Hedefi</dt>
                  <dd>{durationLabel(policy.firstResponseMinutes)}</dd>
                </div>
                <div>
                  <dt>Çözüm Hedefi</dt>
                  <dd>{durationLabel(policy.resolutionMinutes)}</dd>
                </div>
              </dl>
              <p>Güncelleme: {date(policy.updatedAt)}</p>
              {manage && (
                <button onClick={() => setEditing(policy)}>Düzenle</button>
              )}
            </article>
          ))}
        </div>
      ) : result.loading ? (
        <Loading />
      ) : (
        <>
          <Empty title="Bu öncelik için SLA politikası tanımlanmamış.">
            Etkin politika olmadan açılan taleplere bu öncelikte SLA hedefi
            eklenmez.
          </Empty>
          {manage && (
            <button
              className="primary-button missing-policy-button"
              onClick={() => setEditing(null)}
            >
              Politika Oluştur
            </button>
          )}
        </>
      )}
      {result.data && result.data.pagination.totalPages > 1 && (
        <Pager
          page={page}
          setPage={setPage}
          pagination={result.data.pagination}
          loading={result.loading}
        />
      )}{' '}
      {editing !== undefined && (
        <PolicyForm
          priority={priority}
          initial={editing}
          close={() => setEditing(undefined)}
          refresh={result.refresh}
          done={() => {
            setEditing(undefined);
            setSaved(true);
            result.refresh();
          }}
        />
      )}
    </section>
  );
}
export function SlaPolicies() {
  const { state } = useApplication();
  return (
    <div className="operations" key={state.tenantRevision}>
      <PageHeading
        eyebrow="OPERASYONLAR / HİZMET HEDEFLERİ"
        title="SLA Politikaları"
        description="Önceliğe göre ilk yanıt ve çözüm hedeflerini yönetin."
      />
      <Notice>
        Politika değişiklikleri mevcut taleplerin SLA kayıtlarını yeniden
        hesaplamaz. İlk yanıt hedefi, müşteriye açık ilk ekip yanıtıyla
        tamamlanır. Süreler dakika hassasiyetinde saklanır.
      </Notice>
      {!canManageWorkspace(state.session.selected?.role) && (
        <p className="management-notice">
          Görüntüleme yetkiniz var. Politikaları yalnızca çalışma alanı sahibi
          ve yöneticiler değiştirebilir.
        </p>
      )}
      <div className="policy-grid">
        {PRIORITIES.map((priority) => (
          <PolicyGroup
            key={`${state.tenantRevision}:${priority}`}
            priority={priority}
            manage={canManageWorkspace(state.session.selected?.role)}
          />
        ))}
      </div>
    </div>
  );
}
