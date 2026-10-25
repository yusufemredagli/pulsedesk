import type { Socket, Namespace } from 'socket.io';
import type { AccessIdentity } from '../auth/access-token.service';
import type { TenantContext } from '../auth/types/request-context';
import type { ClientEvents, ServerEvents } from './realtime-events';
export interface RealtimeData {
  identity?: Readonly<AccessIdentity>;
  tenant?: Readonly<TenantContext>;
  busy?: boolean;
  tenantRevision?: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
}
export type RealtimeSocket = Socket<
  ClientEvents,
  ServerEvents,
  Record<string, never>,
  RealtimeData
>;

export type RealtimeNamespace = Namespace<
  ClientEvents,
  ServerEvents,
  Record<string, never>,
  RealtimeData
>;
