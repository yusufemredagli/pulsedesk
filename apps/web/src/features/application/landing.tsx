'use client';
import Link from 'next/link';
import { Icon } from '../../components/brand';
import { useApplication } from './provider';
const eventLabels = {
  'ticket:created': 'Ticket created',
  'ticket:assigned': 'Assignment changed',
  'ticket:status-changed': 'Ticket status changed',
  'ticket:comment-added': 'Comment added',
  'notification:new': 'Notification received',
};
export function Landing() {
  const { state } = useApplication();
  const { user, selected } = state.session;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">YOUR OPERATIONS WORKSPACE</span>
          <h1>A clear place to start.</h1>
          <p>
            Welcome, {user?.name.split(' ')[0]}. Your team’s next response
            starts here.
          </p>
        </div>
        <span className="workspace-tag">
          <span className="status-dot" />
          {selected?.organizationName}
        </span>
      </div>
      <section className="welcome-panel">
        <div className="welcome-symbol">
          <Icon name="signal" size={34} />
        </div>
        <div className="welcome-copy">
          <span className="eyebrow">READY FOR YOUR TEAM</span>
          <h2>
            Less noise.
            <br />
            More coordinated support.
          </h2>
          <p>
            Your workspace brings the people, context, and signals behind every
            response into focus.
          </p>
        </div>
        <div className="welcome-orbit" aria-hidden="true">
          <div />
          <div />
          <div />
          <svg viewBox="0 0 200 100">
            <path d="M0 52h48l13-17 14 38 18-65 20 84 16-50 13 10h58" />
          </svg>
        </div>
      </section>
      <section className="workspace-facts" aria-label="Current workspace">
        <div className="fact-card">
          <span className="fact-icon">
            <Icon name="team" />
          </span>
          <div>
            <span className="fact-label">ACTIVE WORKSPACE</span>
            <strong>{selected?.organizationName}</strong>
            <span>Your current organization</span>
          </div>
        </div>
        <div className="fact-card">
          <span className="fact-icon">
            <Icon name="shield" />
          </span>
          <div>
            <span className="fact-label">YOUR ACCESS</span>
            <strong className="capitalize">
              {selected?.role.toLowerCase()}
            </strong>
            <span>Verified workspace membership</span>
          </div>
        </div>
        <Link href="/app/notifications" className="fact-card fact-link">
          <span className="fact-icon">
            <Icon name="bell" />
          </span>
          <div>
            <span className="fact-label">YOUR INBOX</span>
            <strong>
              {state.unread === null
                ? 'Checking your inbox'
                : `${state.unread} unread ${state.unread === 1 ? 'notification' : 'notifications'}`}
            </strong>
            <span>
              {state.notificationError
                ? 'Refresh your inbox to try again'
                : 'Updates for your attention'}
            </span>
          </div>
          <Icon name="arrow" size={18} />
        </Link>
      </section>
      <div className="landing-grid">
        <section className="panel activity-panel">
          <header className="panel-heading">
            <div>
              <span className="overline">WORKSPACE SIGNALS</span>
              <h2>Recent activity</h2>
            </div>
            <span className="small-label">This session</span>
          </header>
          {state.events.length === 0 ? (
            <div className="empty-activity">
              <div className="empty-orbit">
                <Icon name="signal" size={25} />
              </div>
              <h3>A quiet signal, for now.</h3>
              <p>
                Updates will appear here as your team works.
                <br />
                Your workspace is ready when you are.
              </p>
            </div>
          ) : (
            <ul className="activity-list">
              {state.events.map((event) => (
                <li key={event.eventId}>
                  <span className="activity-icon">
                    <Icon
                      name={event.notificationId ? 'bell' : 'ticket'}
                      size={17}
                    />
                  </span>
                  <div>
                    <strong>{eventLabels[event.name]}</strong>
                    <span>
                      {event.ticketNumber
                        ? `PD-${String(event.ticketNumber).padStart(6, '0')}`
                        : 'Your personal inbox'}
                    </span>
                  </div>
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel focus-panel">
          <span className="focus-icon">
            <Icon name="shield" size={24} />
          </span>
          <span className="overline">A FOCUSED WORKSPACE</span>
          <h2>
            The right context.
            <br />
            The right team.
          </h2>
          <p>
            You’re working in <strong>{selected?.organizationName}</strong>.
            Switch workspaces whenever your focus changes.
          </p>
          <div className="focus-divider" />
          <p className="focus-note">
            <Icon name="signal" size={17} />
            {state.realtime === 'connected'
              ? 'Live signals are connected.'
              : 'Your workspace stays available while live updates reconnect.'}
          </p>
          <Link href="/app/notifications" className="inline-link">
            Open your notifications <Icon name="arrow" size={16} />
          </Link>
        </section>
      </div>
    </>
  );
}
