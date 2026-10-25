'use client';
import { useState } from 'react';
import { Icon } from '../../components/brand';
import { useApplication } from './provider';
export function Notifications() {
  const { state, client } = useApplication();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function read(id: string) {
    setPending(id);
    setError('');
    try {
      await client.markRead(id);
    } catch {
      setError(
        'This notification could not be marked as read. Please try again.',
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">YOUR PERSONAL INBOX</span>
          <h1>Notifications</h1>
          <p>The latest unread updates for you in this workspace.</p>
        </div>
        <button
          className="button secondary"
          disabled={state.notificationLoading}
          onClick={() => void client.loadNotifications()}
        >
          <Icon name="refresh" size={16} /> Refresh inbox
        </button>
      </div>
      <section className="panel inbox-panel">
        <header className="panel-heading">
          <h2>Unread notifications</h2>
          <span className="count-label">
            {state.unread === null ? 'Checking' : `${state.unread} unread`}
          </span>
        </header>
        {(state.notificationError || error) && (
          <div className="form-error" role="alert">
            {error || state.notificationError}
          </div>
        )}
        {state.notificationLoading && state.unread === null ? (
          <div className="inbox-loading" aria-busy="true">
            <span className="spinner" />
            <p>Checking your inbox</p>
          </div>
        ) : state.notifications.length ? (
          <ul className="notification-list">
            {state.notifications.map((note) => (
              <li key={note.id}>
                <span
                  className={`notification-kind ${note.type.includes('BREACHED') ? 'urgent' : ''}`}
                >
                  <Icon
                    name={note.type.includes('BREACHED') ? 'clock' : 'bell'}
                  />
                </span>
                <div>
                  <h3>{note.title}</h3>
                  <p>{note.message}</p>
                  <time dateTime={note.createdAt}>
                    {new Date(note.createdAt).toLocaleString()}
                  </time>
                </div>
                <button
                  className="button secondary small-button"
                  disabled={pending !== null}
                  onClick={() => void read(note.id)}
                >
                  {pending === note.id ? 'Saving' : 'Mark read'}
                </button>
              </li>
            ))}
          </ul>
        ) : !state.notificationError && state.unread === 0 ? (
          <div className="empty-activity">
            <div className="empty-orbit">
              <Icon name="check" size={26} />
            </div>
            <h3>You’re all caught up.</h3>
            <p>New updates will appear here as they arrive.</p>
          </div>
        ) : null}
        <footer className="inbox-footnote">
          Showing up to five recent unread notifications. Your inbox stays
          available when live updates are paused.
        </footer>
      </section>
    </>
  );
}
