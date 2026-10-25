'use client';
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useApplication } from '../application/provider';
import { routeDestination } from '../../lib/session/routing';
import { Brand } from '../../components/brand';
export function RouteGate({
  area,
  children,
}: {
  area: 'public' | 'organization' | 'application';
  children: ReactNode;
}) {
  const { state, client } = useApplication();
  const router = useRouter();
  const destination = routeDestination(state.session, area);
  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);
  if (state.session.status === 'restore-error')
    return (
      <main className="session-screen">
        <div className="session-card">
          <Brand />
          <h1>Let’s reconnect</h1>
          <p>{state.session.error}</p>
          <button
            className="button primary"
            onClick={() => void client.restore()}
          >
            Try again
          </button>
          <button className="text-button" onClick={client.clearSession}>
            Sign in instead
          </button>
        </div>
      </main>
    );
  if (state.session.status === 'restoring' || destination)
    return (
      <main className="session-screen" aria-busy="true">
        <div className="session-card">
          <Brand />
          <span className="spinner" />
          <h1>Restoring your workspace</h1>
          <p>Checking your session and workspace access.</p>
        </div>
      </main>
    );
  return children;
}
