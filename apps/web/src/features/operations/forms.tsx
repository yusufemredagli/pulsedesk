'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useResource } from './resource';
import type { Page } from './model';
export function Dialog({
  title,
  close,
  children,
  busy = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="ops-dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2 id="dialog-title">{title}</h2>
        <button
          type="button"
          aria-label="Pencereyi Kapat"
          disabled={busy}
          onClick={close}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Lookup({
  path,
  label,
  value,
  onChange,
}: {
  path: string;
  label: string;
  value: { id: string; name: string } | null;
  onChange: (value: { id: string; name: string } | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const result = useResource<
    Page<{ id?: string; membershipId?: string; name: string }>
  >(
    `${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=20${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`,
  );
  return (
    <fieldset className="lookup">
      <legend>{label}</legend>
      {value && (
        <div className="lookup-selected">
          <strong>{value.name}</strong>
          <button type="button" onClick={() => onChange(null)}>
            Temizle
          </button>
        </div>
      )}
      <label>
        {label} ara
        <input
          maxLength={100}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Ada göre ara"
        />
      </label>
      {result.error ? (
        <p role="alert">
          {result.error.message}
          <button type="button" onClick={result.refresh}>
            Tekrar Dene
          </button>
        </p>
      ) : (
        <>
          <select
            aria-label={`${label} seçin`}
            value=""
            onChange={(event) => {
              const item = result.data?.data.find(
                (row) => (row.membershipId ?? row.id) === event.target.value,
              );
              if (item)
                onChange({
                  id: (item.membershipId ?? item.id)!,
                  name: item.name,
                });
            }}
          >
            <option value="">
              {result.loading ? 'Yükleniyor…' : 'Bir sonuç seçin'}
            </option>
            {result.data?.data.map((row) => (
              <option
                key={row.membershipId ?? row.id}
                value={row.membershipId ?? row.id}
              >
                {row.name}
              </option>
            ))}
          </select>
          {!result.loading && !result.data?.data.length && (
            <small>
              Eşleşen {label.toLocaleLowerCase('tr-TR')} bulunamadı. Başka bir
              ad deneyin.
            </small>
          )}
          <div className="lookup-pages">
            <button
              type="button"
              disabled={page === 1 || result.loading}
              onClick={() => setPage(page - 1)}
            >
              Önceki
            </button>
            <small>Sayfa {page}</small>
            <button
              type="button"
              disabled={
                result.loading ||
                !result.data ||
                page >= result.data.pagination.totalPages
              }
              onClick={() => setPage(page + 1)}
            >
              Sonraki
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}
