import { io } from 'socket.io-client';
import { isObject, isRole } from '../api/contracts';
import { DOMAIN_EVENTS, type DomainEvent } from './reconciliation';
export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'degraded';
export interface SocketLike {
  connected: boolean;
  active?: boolean;
  on(event: string, listener: (...args: unknown[]) => void): this;
  removeAllListeners(): this;
  connect(): this;
  disconnect(): this;
  timeout(ms: number): {
    emit(
      event: string,
      payload: unknown,
      callback: (error: unknown, response?: unknown) => void,
    ): void;
  };
}
export type SocketFactory = (token: string) => SocketLike;
export function socketFactory(baseUrl: string): SocketFactory {
  return (token) =>
    io(`${baseUrl}/realtime`, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token },
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    }) as SocketLike;
}
export interface RealtimeTarget {
  token: string;
  organizationId: string;
  membershipId: string;
  revision: number;
}
export class RealtimeClient {
  private socket?: SocketLike;
  private target?: RealtimeTarget;
  private retry?: ReturnType<typeof setTimeout>;
  private recoveryUsed = false;
  constructor(
    private readonly factory: SocketFactory,
    private readonly callbacks: {
      status(status: RealtimeStatus): void;
      joined(role: import('../api/contracts').Role): void;
      event(name: DomainEvent, payload: unknown): void;
      refresh(token: string): Promise<void>;
      denied(): void;
    },
  ) {}
  update(target?: RealtimeTarget): void {
    if (
      target &&
      this.target &&
      target.token === this.target.token &&
      target.organizationId === this.target.organizationId &&
      target.revision === this.target.revision
    )
      return;
    this.disconnect();
    this.target = target;
    if (!target) {
      this.recoveryUsed = false;
      this.callbacks.status('idle');
      return;
    }
    const socket = this.factory(target.token);
    this.socket = socket;
    const current = () => this.socket === socket && this.target === target;
    this.callbacks.status('connecting');
    socket.on('connection:ready', () => {
      if (!current()) return;
      socket
        .timeout(5000)
        .emit(
          'organization:join',
          { organizationId: target.organizationId },
          (error, response) => {
            if (!current()) return;
            if (
              !error &&
              isObject(response) &&
              response.ok === true &&
              response.organizationId === target.organizationId &&
              response.membershipId === target.membershipId &&
              isRole(response.role)
            ) {
              this.recoveryUsed = false;
              this.callbacks.status('connected');
              this.callbacks.joined(response.role);
            } else if (
              isObject(response) &&
              response.code === 'ACCESS_DENIED'
            ) {
              this.disconnect();
              this.callbacks.denied();
            } else if (
              isObject(response) &&
              response.code === 'UNAUTHENTICATED'
            ) {
              void this.recover(target.token);
            } else {
              this.callbacks.status('degraded');
              this.schedule(socket, current);
            }
          },
        );
    });
    socket.on('connect_error', (error) => {
      if (!current()) return;
      this.callbacks.status('degraded');
      const data = isObject(error) && isObject(error.data) ? error.data : null;
      if (data?.code === 'UNAUTHENTICATED') void this.recover(target.token);
      else if (!socket.active) this.schedule(socket, current);
    });
    socket.on('error', (error) => {
      if (current() && isObject(error) && error.code === 'UNAUTHENTICATED')
        void this.recover(target.token);
    });
    socket.on('disconnect', (reason) => {
      if (!current()) return;
      this.callbacks.status('degraded');
      if (reason === 'io server disconnect') void this.recover(target.token);
    });
    for (const name of DOMAIN_EVENTS)
      socket.on(name, (payload) => {
        if (current()) this.callbacks.event(name, payload);
      });
    socket.connect();
  }
  private schedule(socket: SocketLike, current: () => boolean): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      if (current()) {
        socket.disconnect();
        socket.connect();
      }
    }, 3000);
  }
  private async recover(token: string): Promise<void> {
    if (this.recoveryUsed) {
      this.callbacks.status('degraded');
      return;
    }
    this.recoveryUsed = true;
    await this.callbacks.refresh(token).catch(() => {});
  }
  private disconnect(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    this.target = undefined;
  }
  stop(): void {
    this.disconnect();
    this.recoveryUsed = false;
  }
}
