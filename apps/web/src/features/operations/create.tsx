'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApplication } from '../application/provider';
import { Dialog, Lookup } from './forms';
import { PRIORITIES, words, type Ticket } from './model';
export function CreateTicket({
  close,
  done,
  initialCustomer,
}: {
  close: () => void;
  done: () => void;
  initialCustomer?: { id: string; name: string };
}) {
  const { client } = useApplication();
  const router = useRouter();
  const lock = useRef(false);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    initialCustomer ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog title="Yeni Talep Oluştur" close={close} busy={busy}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (lock.current) return;
          if (!customer) {
            setError('Talep oluşturmadan önce bir müşteri seçin.');
            return;
          }
          const form = new FormData(event.currentTarget);
          lock.current = true;
          setBusy(true);
          setError('');
          try {
            const ticket = await client.request<Ticket>('/tickets', {
              method: 'POST',
              body: {
                customerId: customer.id,
                subject: form.get('subject'),
                description: form.get('description'),
                priority: form.get('priority'),
                source: 'WEB',
              },
            });
            done();
            router.push(`/app/tickets/${ticket.id}`);
          } catch (error) {
            setError(
              error instanceof Error ? error.message : 'Lütfen tekrar deneyin.',
            );
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <Lookup
            path="/customers"
            label="Müşteri"
            value={customer}
            onChange={setCustomer}
          />
          <label>
            Konu
            <input name="subject" required maxLength={200} />
          </label>
          <label>
            Açıklama
            <textarea name="description" required maxLength={10000} rows={4} />
          </label>
          <label>
            Öncelik
            <select aria-label="Öncelik" name="priority" defaultValue="MEDIUM">
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </label>
          <small>{words('WEB')} kanalından oluşturulur.</small>
        </fieldset>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Oluşturuluyor…' : 'Yeni Talep Oluştur'}
        </button>
      </form>
    </Dialog>
  );
}
