'use client';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../operations/forms';
import { useMutation } from './mutation';
import type { Customer, Team } from './model';
export function ResourceForm({
  kind,
  initial,
  close,
  done,
  refresh,
}: {
  kind: 'customer' | 'team';
  initial: Customer | Team | null;
  close: () => void;
  done: () => void;
  refresh: () => void;
}) {
  const mutation = useMutation(refresh),
    isCustomer = kind === 'customer';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nullable = (key: string) =>
      String(form.get(key) ?? '').trim() || null;
    const body = {
      name: String(form.get('name') ?? '').trim(),
      ...(isCustomer
        ? {
            email: nullable('email'),
            phone: nullable('phone'),
            companyName: nullable('companyName'),
            notes: nullable('notes'),
          }
        : { description: nullable('description') }),
      ...(initial ? { expectedUpdatedAt: initial.updatedAt } : {}),
    };
    await mutation.run(
      `/${isCustomer ? 'customers' : 'teams'}${initial ? `/${initial.id}` : ''}`,
      { method: initial ? 'PATCH' : 'POST', body },
      done,
    );
  }
  const customer = isCustomer ? (initial as Customer | null) : null,
    team = isCustomer ? null : (initial as Team | null);
  return (
    <Dialog
      title={
        initial
          ? isCustomer
            ? 'Müşteriyi Düzenle'
            : 'Ekibi Düzenle'
          : isCustomer
            ? 'Müşteri Oluştur'
            : 'Ekip Oluştur'
      }
      close={close}
      busy={mutation.busy}
    >
      <form onSubmit={submit}>
        <fieldset disabled={mutation.busy}>
          <label>
            {isCustomer ? 'Müşteri Adı' : 'Ekip Adı'}
            <input
              name="name"
              required
              maxLength={isCustomer ? 200 : 100}
              defaultValue={initial?.name ?? ''}
            />
          </label>
          {isCustomer ? (
            <>
              <label>
                E-posta
                <input
                  name="email"
                  type="email"
                  maxLength={254}
                  defaultValue={customer?.email ?? ''}
                />
              </label>
              <label>
                Telefon
                <input
                  name="phone"
                  type="tel"
                  maxLength={40}
                  defaultValue={customer?.phone ?? ''}
                />
              </label>
              <label>
                Şirket Adı
                <input
                  name="companyName"
                  maxLength={200}
                  defaultValue={customer?.companyName ?? ''}
                />
              </label>
              <label>
                Notlar
                <textarea
                  name="notes"
                  aria-label="Notlar"
                  maxLength={5000}
                  rows={3}
                  defaultValue={customer?.notes ?? ''}
                />
              </label>
            </>
          ) : (
            <label>
              Açıklama
              <textarea
                name="description"
                aria-label="Açıklama"
                maxLength={1000}
                rows={3}
                defaultValue={team?.description ?? ''}
              />
            </label>
          )}
        </fieldset>
        {mutation.error && (
          <p role="alert" className="inline-error">
            {mutation.error}
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
export function NameForm({
  title,
  initial,
  path,
  close,
  done,
  refresh,
}: {
  title: string;
  initial: { name: string; updatedAt: string };
  path: string;
  close: () => void;
  done: () => void | Promise<void>;
  refresh: () => void;
}) {
  const mutation = useMutation(refresh);
  return (
    <Dialog title={title} close={close} busy={mutation.busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void mutation.run(
            path,
            {
              method: 'PATCH',
              body: {
                name: String(form.get('name') ?? '').trim(),
                expectedUpdatedAt: initial.updatedAt,
              },
            },
            done,
          );
        }}
      >
        <label>
          Ad
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={initial.name}
            disabled={mutation.busy}
          />
        </label>
        {mutation.error && (
          <p className="inline-error" role="alert">
            {mutation.error}
          </p>
        )}
        <button className="primary-button" disabled={mutation.busy}>
          {mutation.busy ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </form>
    </Dialog>
  );
}
export function DurationInput({
  label,
  name,
  minutes,
  help,
}: {
  label: string;
  name: string;
  minutes: number;
  help: string;
}) {
  const [unit, setUnit] = useState(minutes % 60 === 0 ? 'hours' : 'minutes');
  const [value, setValue] = useState(
    String(minutes % 60 === 0 ? minutes / 60 : minutes),
  );
  return (
    <fieldset className="duration-field">
      <legend>{label}</legend>
      <div>
        <label>
          Süre
          <input
            type="number"
            name={name + 'Value'}
            aria-label={label}
            step="any"
            min="0.016666666666666666"
            max={unit === 'hours' ? 8760 : 525600}
            value={value}
            required
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label>
          Birim
          <select
            name={name + 'Unit'}
            aria-label={`${label} birimi`}
            value={unit}
            onChange={(event) => {
              setUnit(event.target.value);
              setValue('');
            }}
          >
            <option value="minutes">dakika</option>
            <option value="hours">saat</option>
          </select>
        </label>
      </div>
      <small>{help}</small>
    </fieldset>
  );
}
