import {
  ApiClient,
  ApiError,
  JsonTransport,
  StaleContextError,
} from '../api/client';
import {
  isObject,
  isRole,
  validProfile,
  validSession,
  type Membership,
  type Profile,
  type PublicUser,
  type SessionResponse,
  type TenantContext,
} from '../api/contracts';
export const SESSION_KEY = 'pulsedesk.session.v1';
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
interface StoredSession extends Credentials {
  selectedOrganizationId: string | null;
}
export interface SessionSnapshot {
  status: 'restoring' | 'authenticated' | 'anonymous' | 'restore-error';
  user: PublicUser | null;
  memberships: Membership[];
  selected: Membership | null;
  selecting: boolean;
  error: string | null;
  persistent: boolean;
}
export const INITIAL_SESSION: SessionSnapshot = {
  status: 'restoring',
  user: null,
  memberships: [],
  selected: null,
  selecting: false,
  error: null,
  persistent: true,
};
export class SessionClient {
  readonly api: ApiClient;
  private credentials: Credentials | null = null;
  private snapshot: SessionSnapshot = INITIAL_SESSION;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private revision = 0;
  private scopeAbort = new AbortController();
  private flight?: { epoch: number; promise: Promise<Credentials> };
  private bootstrapFlight?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private active = false;
  private selection = 0;
  constructor(
    private readonly transport: JsonTransport,
    private readonly storage: () => SessionStorage | undefined,
    private readonly now = Date.now,
  ) {
    this.api = new ApiClient(transport, {
      access: () => this.access(),
      scope: () => this.scope(),
      refresh: (token) => this.refresh(token),
      clear: () => this.clear(),
    });
  }
  getSnapshot = (): SessionSnapshot => this.snapshot;
  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  };
  access() {
    return this.credentials
      ? { token: this.credentials.accessToken, epoch: this.epoch }
      : null;
  }
  scope() {
    return {
      organizationId: this.snapshot.selected?.organizationId ?? null,
      revision: this.revision,
      signal: this.scopeAbort.signal,
    };
  }
  private emit(update: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    for (const callback of this.listeners) callback();
  }
  start(): void {
    this.active = true;
    this.schedule();
  }
  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
  }
  private invalidateTenant(): void {
    this.scopeAbort.abort();
    this.scopeAbort = new AbortController();
    this.revision++;
  }
  private persist(): void {
    try {
      const storage = this.storage();
      if (!storage) {
        if (this.snapshot.persistent) this.emit({ persistent: false });
        return;
      }
      if (this.credentials)
        storage.setItem(
          SESSION_KEY,
          JSON.stringify({
            ...this.credentials,
            selectedOrganizationId:
              this.snapshot.selected?.organizationId ?? null,
          } satisfies StoredSession),
        );
      else storage.removeItem(SESSION_KEY);
    } catch {
      if (this.snapshot.persistent) this.emit({ persistent: false });
    }
  }
  clear = (): void => {
    this.epoch++;
    this.selection++;
    this.credentials = null;
    this.invalidateTenant();
    if (this.timer) clearTimeout(this.timer);
    this.snapshot = {
      ...INITIAL_SESSION,
      status: 'anonymous',
      persistent: this.snapshot.persistent,
    };
    this.persist();
    this.emit({});
  };
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.active || !this.credentials) return;
    this.timer = setTimeout(
      () => {
        void this.refresh().catch(() => {});
      },
      Math.max(1000, this.credentials.expiresAt - this.now() - 30000),
    );
  }
  private accept(response: unknown): Credentials {
    if (!validSession(response)) throw new ApiError(502);
    return {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: this.now() + response.accessTokenExpiresIn * 1000,
    };
  }
  async authenticate(
    kind: 'login' | 'register',
    input: {
      email: string;
      password: string;
      name?: string;
      organizationName?: string;
    },
  ): Promise<void> {
    this.clear();
    const epoch = this.epoch;
    const response = await this.transport.request<SessionResponse>(
      `/auth/${kind}`,
      { method: 'POST', body: input },
    );
    const credentials = this.accept(response);
    if (epoch !== this.epoch) throw new StaleContextError();
    this.credentials = credentials;
    // Explicit selection for both single and multiple memberships.
    this.emit({
      status: 'authenticated',
      user: response.user,
      memberships: response.memberships,
      selected: null,
      error: null,
    });
    this.persist();
    this.schedule();
  }
  refresh = async (failedToken?: string): Promise<void> => {
    const current = this.credentials;
    const epoch = this.epoch;
    const scopeAtStart = this.revision;
    if (!current) throw new ApiError(401);
    if (failedToken && failedToken !== current.accessToken) return;
    if (this.flight?.epoch === epoch) {
      await this.flight.promise;
      return;
    }
    const promise = (async () => {
      try {
        const response = await this.transport.request<SessionResponse>(
          '/auth/refresh',
          { method: 'POST', body: { refreshToken: current.refreshToken } },
        );
        const credentials = this.accept(response);
        if (epoch === this.epoch) {
          this.credentials = credentials;
          if (scopeAtStart === this.revision) {
            const selected =
              response.memberships.find(
                (m) =>
                  m.organizationId === this.snapshot.selected?.organizationId &&
                  m.membershipId === this.snapshot.selected?.membershipId,
              ) ?? null;
            if (
              this.snapshot.selected &&
              (!selected || selected.role !== this.snapshot.selected.role)
            )
              this.invalidateTenant();
            this.emit({
              user: response.user,
              memberships: response.memberships,
              selected,
            });
          } else {
            // Preserve a context verified after this rotation started.
            this.emit({});
          }
          this.persist();
          this.schedule();
        }
        return credentials;
      } catch (error) {
        if (epoch === this.epoch) this.clear();
        throw error;
      }
    })();
    this.flight = { epoch, promise };
    try {
      await promise;
    } finally {
      if (this.flight?.promise === promise) this.flight = undefined;
    }
  };
  async logout(): Promise<void> {
    const current = this.credentials;
    const pending =
      this.flight?.epoch === this.epoch ? this.flight.promise : undefined;
    this.clear(); // Disconnect and remove tenant state immediately, even when offline.
    const replacement = await pending?.catch(() => null);
    const refreshToken = replacement?.refreshToken ?? current?.refreshToken;
    if (refreshToken)
      await this.transport
        .request('/auth/logout', { method: 'POST', body: { refreshToken } })
        .catch(() => {});
  }
  async profile(): Promise<Profile> {
    const revision = this.revision;
    const response = await this.api.request<Profile>('/auth/me');
    if (revision !== this.revision) throw new StaleContextError();
    if (!validProfile(response)) throw new ApiError(502);
    const previous = this.snapshot.selected;
    const selected = previous
      ? (response.memberships.find(
          (m) =>
            m.organizationId === previous.organizationId &&
            m.membershipId === previous.membershipId,
        ) ?? null)
      : null;
    if (previous && (!selected || previous.role !== selected.role))
      this.invalidateTenant();
    this.emit({
      user: response.user,
      memberships: response.memberships,
      selected,
    });
    this.persist();
    return response;
  }
  clearOrganization = (): void => {
    this.selection++;
    this.invalidateTenant();
    this.emit({ selected: null, selecting: false, error: null });
    this.persist();
  };
  async selectOrganization(organizationId: string): Promise<void> {
    this.clearOrganization();
    const selection = this.selection;
    const epoch = this.epoch;
    this.emit({ selecting: true, error: null });
    try {
      const profile = await this.profile();
      const membership = profile.memberships.find(
        (m) => m.organizationId === organizationId,
      );
      if (!membership) throw new ApiError(403);
      const verified = await this.api.request<TenantContext>('/auth/context', {
        organizationId,
      });
      if (
        !isObject(verified) ||
        verified.organizationId !== organizationId ||
        verified.membershipId !== membership.membershipId ||
        verified.userId !== profile.user.id ||
        !isRole(verified.role)
      )
        throw new ApiError(403);
      if (selection !== this.selection || epoch !== this.epoch)
        throw new StaleContextError();
      this.invalidateTenant();
      this.emit({
        selected: { ...membership, role: verified.role },
        selecting: false,
      });
      this.persist();
    } catch (error) {
      if (selection === this.selection && epoch === this.epoch)
        this.emit({
          selecting: false,
          error:
            error instanceof ApiError
              ? error.message
              : 'Çalışma alanı seçilemedi. Tekrar deneyin.',
        });
      throw error;
    }
  }
  updateRole(role: Membership['role']): void {
    if (this.snapshot.selected?.role !== role && this.snapshot.selected) {
      this.invalidateTenant();
      this.emit({ selected: { ...this.snapshot.selected, role } });
    }
  }
  bootstrap = (): Promise<void> => {
    if (this.bootstrapFlight) return this.bootstrapFlight;
    this.bootstrapFlight = this.restore().finally(() => {
      this.bootstrapFlight = undefined;
    });
    return this.bootstrapFlight;
  };
  private async restore(): Promise<void> {
    if (this.snapshot.status === 'authenticated') return;
    const epoch = this.epoch;
    this.emit({ status: 'restoring', error: null });
    let stored: StoredSession | null = null;
    try {
      const raw = this.storage()?.getItem(SESSION_KEY);
      const value: unknown = raw ? JSON.parse(raw) : null;
      if (
        isObject(value) &&
        typeof value.accessToken === 'string' &&
        value.accessToken.length < 8192 &&
        typeof value.refreshToken === 'string' &&
        /^[\w-]{64}$/.test(value.refreshToken) &&
        typeof value.expiresAt === 'number' &&
        Number.isFinite(value.expiresAt) &&
        (value.selectedOrganizationId === null ||
          typeof value.selectedOrganizationId === 'string')
      )
        stored = value as unknown as StoredSession;
    } catch {
      this.emit({ persistent: false });
    }
    if (!stored) {
      if (epoch === this.epoch) this.clear();
      return;
    }
    this.credentials = {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
    };
    try {
      if (this.credentials.expiresAt <= this.now() + 30000)
        await this.refresh();
      if (epoch !== this.epoch) return;
      const profile = await this.profile();
      if (epoch !== this.epoch) return;
      if (
        stored.selectedOrganizationId &&
        profile.memberships.some(
          (m) => m.organizationId === stored!.selectedOrganizationId,
        )
      ) {
        try {
          await this.selectOrganization(stored.selectedOrganizationId);
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            ![400, 403, 404].includes(error.status)
          )
            throw error;
        }
      }
      if (epoch === this.epoch) {
        this.emit({ status: 'authenticated' });
        this.schedule();
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof ApiError && error.status === 401) this.clear();
      else
        this.emit({
          status: 'restore-error',
          error:
            'Kayıtlı oturumunuz kontrol edilemedi. Bağlantınızı kontrol edip tekrar deneyin.',
        });
    }
  }
}
