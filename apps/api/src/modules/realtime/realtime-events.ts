import type { TenantContext } from '../auth/types/request-context';
export const REALTIME = {
  NAMESPACE: '/realtime',
  READY: 'connection:ready',
  JOIN: 'organization:join',
  JOINED: 'organization:joined',
  LEAVE: 'organization:leave',
  LEFT: 'organization:left',
  ERROR: 'error',
} as const;
export type RealtimeErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'ACCESS_DENIED'
  | 'BUSY'
  | 'UNAVAILABLE';
export interface RealtimeFailure {
  ok: false;
  code: RealtimeErrorCode;
  message: string;
}
export type Joined = { ok: true } & Omit<TenantContext, 'userId'>;
export type Left = { ok: true; organizationId: string | null };
export type JoinResult = Joined | RealtimeFailure;
export type LeaveResult = Left | RealtimeFailure;
export interface ClientEvents {
  'organization:join': (
    payload: { organizationId: string },
    ack: (result: JoinResult) => void,
  ) => void;
  'organization:leave': (ack: (result: LeaveResult) => void) => void;
}
export interface ServerEvents {
  'connection:ready': (payload: { ok: true }) => void;
  'organization:joined': (payload: Joined) => void;
  'organization:left': (payload: Left) => void;
  error: (payload: RealtimeFailure) => void;
}
export function failure(code: RealtimeErrorCode): RealtimeFailure {
  const messages = {
    INVALID_REQUEST: 'Invalid request',
    UNAUTHENTICATED: 'Invalid authentication credentials',
    ACCESS_DENIED: 'Access denied',
    BUSY: 'Request already in progress',
    UNAVAILABLE: 'Realtime service unavailable',
  };
  return { ok: false, code, message: messages[code] };
}
