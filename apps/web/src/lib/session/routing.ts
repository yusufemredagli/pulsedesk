import type { SessionSnapshot } from './session-client';
export function routeDestination(
  session: SessionSnapshot,
  area: 'public' | 'organization' | 'application',
): string | null {
  if (session.status === 'restoring' || session.status === 'restore-error')
    return null;
  if (session.status !== 'authenticated')
    return area === 'public' ? null : '/login';
  if (area === 'public')
    return session.selected ? '/app' : '/select-organization';
  if (area === 'organization') return session.selected ? '/app' : null;
  return session.selected ? null : '/select-organization';
}
