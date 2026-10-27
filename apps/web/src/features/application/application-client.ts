import {
  ApiError,
  JsonTransport,
  apiBaseUrl,
  type Fetcher,
} from '../../lib/api/client';
import {
  isObject,
  type Notification,
  type Page,
} from '../../lib/api/contracts';
import {
  SessionClient,
  INITIAL_SESSION,
  type SessionSnapshot,
  type SessionStorage,
} from '../../lib/session/session-client';
import {
  RealtimeClient,
  socketFactory,
  type SocketFactory,
  type RealtimeStatus,
} from '../../lib/realtime/client';
import {
  Reconciliation,
  type EventMetadata,
} from '../../lib/realtime/reconciliation';
export interface ApplicationSnapshot {
  session: SessionSnapshot;
  realtime: RealtimeStatus;
  unread: number | null;
  notifications: Notification[];
  notificationError: string | null;
  notificationLoading: boolean;
  events: EventMetadata[];
  tenantRevision: number;
  dataRevision: number;
}
export const INITIAL_APPLICATION: ApplicationSnapshot = {
  session: INITIAL_SESSION,
  realtime: 'idle',
  unread: null,
  notifications: [],
  notificationError: null,
  notificationLoading: false,
  events: [],
  tenantRevision: 0,
  dataRevision: 0,
};
export class ApplicationClient {
  private session: SessionClient;
  private realtime: RealtimeClient;
  private reconciliation = new Reconciliation();
  private snapshot: ApplicationSnapshot = INITIAL_APPLICATION;
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private poll?: ReturnType<typeof setInterval>;
  private notificationFlight?: { revision: number; promise: Promise<void> };
  private dirty = false;
  private started = false;
  private tenant = -1;
  constructor(
    options: {
      baseUrl?: string;
      fetcher?: Fetcher;
      storage?: () => SessionStorage | undefined;
      socketFactory?: SocketFactory;
    } = {},
  ) {
    const base = apiBaseUrl(options.baseUrl);
    this.session = new SessionClient(
      new JsonTransport(base, options.fetcher),
      options.storage ??
        (() => {
          try {
            return typeof window === 'undefined'
              ? undefined
              : window.sessionStorage;
          } catch {
            return undefined;
          }
        }),
    );
    this.realtime = new RealtimeClient(
      options.socketFactory ?? socketFactory(base),
      {
        status: (realtime) => this.publish({ realtime }),
        joined: (role) => {
          this.session.updateRole(role);
          this.publish({ dataRevision: this.snapshot.dataRevision + 1 });
          void this.loadNotifications();
        },
        refresh: (token) => this.session.refresh(token),
        denied: () => {
          this.session.clearOrganization();
          void this.session.profile().catch(() => {});
        },
        event: (name, payload) => {
          const org = this.session.getSnapshot().selected?.organizationId;
          if (!org) return;
          const metadata = this.reconciliation.accept(name, payload, org);
          if (!metadata) return;
          this.publish({
            events: [metadata, ...this.snapshot.events].slice(0, 8),
            dataRevision: this.snapshot.dataRevision + 1,
          });
          if (name === 'notification:new') void this.loadNotifications();
        },
      },
    );
  }
  getSnapshot = (): ApplicationSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(update: Partial<ApplicationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }
  private sync = (): void => {
    const session = this.session.getSnapshot();
    const scope = this.session.scope();
    const changed = scope.revision !== this.tenant;
    if (changed) {
      this.tenant = scope.revision;
      this.reconciliation.reset();
      this.dirty = false;
      if (this.poll) clearInterval(this.poll);
      this.poll = undefined;
      this.publish({
        session,
        unread: null,
        notifications: [],
        events: [],
        notificationError: null,
        notificationLoading: false,
        tenantRevision: scope.revision,
        dataRevision: this.snapshot.dataRevision + 1,
      });
    } else this.publish({ session });
    const access = this.session.access();
    this.realtime.update(
      session.status === 'authenticated' && session.selected && access
        ? {
            token: access.token,
            organizationId: session.selected.organizationId,
            membershipId: session.selected.membershipId,
            revision: scope.revision,
          }
        : undefined,
    );
    if (session.status === 'authenticated' && session.selected && !this.poll) {
      void this.loadNotifications();
      this.poll = setInterval(() => {
        void this.loadNotifications();
      }, 60000);
    }
  };
  start(): void {
    if (this.started) return;
    this.started = true;
    this.session.start();
    this.unsubscribe = this.session.subscribe(this.sync);
    this.sync();
    void this.session.bootstrap();
  }
  stop(): void {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.realtime.stop();
    this.session.stop();
    if (this.poll) clearInterval(this.poll);
    this.poll = undefined;
  }
  observeTicket(id: string, version: number) {
    this.reconciliation.observe(id, version);
  }
  request<T>(
    path: string,
    options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ) {
    return this.session.api.request<T>(path, {
      ...options,
      organization: true,
    });
  }
  login = (input: { email: string; password: string }): Promise<void> =>
    this.session.authenticate('login', input);
  register = (input: {
    name: string;
    email: string;
    password: string;
    organizationName: string;
  }): Promise<void> => this.session.authenticate('register', input);
  logout = (): Promise<void> => this.session.logout();
  clearSession = (): void => this.session.clear();
  restore = (): Promise<void> => this.session.bootstrap();
  selectOrganization = (id: string): Promise<void> =>
    this.session.selectOrganization(id);
  clearOrganization = (): void => this.session.clearOrganization();
  refreshSession = (): Promise<void> => this.session.refresh();
  refreshMemberships = async (): Promise<void> => {
    await this.session.profile();
  };
  async revisit(): Promise<void> {
    if (this.session.getSnapshot().status !== 'authenticated') return;
    try {
      const profile = await this.session.profile();
      const selected = this.session.getSnapshot().selected;
      if (
        selected &&
        !profile.memberships.some(
          (m) => m.membershipId === selected.membershipId,
        )
      )
        this.session.clearOrganization();
      else if (selected) void this.loadNotifications();
    } catch {
      /* API auth recovery handles invalid sessions; transient network failures preserve HTTP usability. */
    }
  }
  loadNotifications = async (): Promise<void> => {
    const revision = this.session.scope().revision;
    const selected = this.session.getSnapshot().selected;
    if (!selected || this.session.getSnapshot().status !== 'authenticated')
      return;
    if (this.notificationFlight?.revision === revision) {
      this.dirty = true;
      await this.notificationFlight.promise;
      return;
    }
    const promise = (async () => {
      do {
        this.dirty = false;
        this.publish({ notificationLoading: true });
        try {
          const response = await this.session.api.request<Page<Notification>>(
            '/notifications?unread=true&page=1&limit=5',
            { organization: true },
          );
          if (
            !isObject(response) ||
            !Array.isArray(response.data) ||
            !isObject(response.pagination) ||
            !Number.isSafeInteger(response.pagination.total) ||
            response.pagination.total < 0 ||
            !response.data.every(
              (row) =>
                isObject(row) &&
                typeof row.id === 'string' &&
                typeof row.title === 'string' &&
                typeof row.message === 'string',
            )
          )
            throw new ApiError(502);
          if (revision !== this.session.scope().revision) return;
          this.publish({
            unread: response.pagination.total,
            notifications: response.data,
            notificationError: null,
          });
        } catch (error) {
          if (revision !== this.session.scope().revision) return;
          if (error instanceof ApiError && [400, 403].includes(error.status)) {
            this.session.clearOrganization();
            return;
          }
          this.publish({
            notificationError:
              'Bildirimleriniz güncellenemedi. Tekrar deneyin.',
          });
        } finally {
          if (revision === this.session.scope().revision)
            this.publish({ notificationLoading: false });
        }
      } while (
        this.dirty &&
        revision === this.session.scope().revision &&
        this.started
      );
    })();
    this.notificationFlight = { revision, promise };
    try {
      await promise;
    } finally {
      if (this.notificationFlight?.promise === promise)
        this.notificationFlight = undefined;
    }
  };
  async markRead(id: string): Promise<void> {
    await this.session.api.request(
      `/notifications/${encodeURIComponent(id)}/read`,
      { method: 'PATCH', organization: true },
    );
    await this.loadNotifications();
  }
}
