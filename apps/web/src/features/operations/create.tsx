'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApplication } from '../application/provider';
import { Dialog, Lookup } from './forms';
import { PRIORITIES, words, type Ticket } from './model';
export function CreateTicket({
  close,
  done,
}: {
  close: () => void;
  done: () => void;
}) {
  const { client } = useApplication();
  const router = useRouter();
  const lock = useRef(false);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog title="New ticket" close={close} busy={busy}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (lock.current) return;
          if (!customer) {
            setError('Choose a customer before creating this ticket.');
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
              error instanceof Error ? error.message : 'Please try again.',
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
            label="Customer"
            value={customer}
            onChange={setCustomer}
          />
          <label>
            Subject
            <input name="subject" required maxLength={200} />
          </label>
          <label>
            Description
            <textarea name="description" required maxLength={10000} rows={4} />
          </label>
          <label>
            Priority
            <select aria-label="Priority" name="priority" defaultValue="MEDIUM">
              {PRIORITIES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <small>Created through the {words('WEB')} channel.</small>
        </fieldset>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Creating…' : 'Create ticket'}
        </button>
      </form>
    </Dialog>
  );
}
