export class ApiError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? safeMessage(status));
    this.name = 'ApiError';
  }
}
export class StaleContextError extends Error {
  constructor() {
    super('Çalışma alanı değişti.');
    this.name = 'AbortError';
  }
}
function safeMessage(status: number): string {
  return (
    (
      {
        0: 'Hizmete ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.',
        400: 'Bilgilerinizi kontrol edip tekrar deneyin.',
        401: 'Oturumunuz doğrulanamadı. Lütfen yeniden giriş yapın.',
        403: 'Bu çalışma alanına erişmek veya bu işlemi gerçekleştirmek için yetkiniz yok.',
        404: 'Bu kayıt artık mevcut değil.',
        409: 'Bu bilgiler mevcut bir kayıtla çakışıyor. Yenileyip tekrar deneyin.',
        429: 'Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.',
      } as Record<number, string>
    )[status] ?? 'Hizmet geçici olarak kullanılamıyor. Lütfen tekrar deneyin.'
  );
}
export function apiBaseUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? 'http://localhost:4000');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      url.hostname.includes('*')
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error('Uygulamanın API adresi doğru yapılandırılmamış.');
  }
}
export type Fetcher = typeof fetch;
export class JsonTransport {
  constructor(
    readonly baseUrl: string,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {}
  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError(400);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(options.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
          ...options.headers,
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError(0);
    }
    // Never display remote error strings, HTML, exceptions, or request bodies.
    if (!response.ok) throw new ApiError(response.status);
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(502);
    }
  }
}
export interface AccessSource {
  access(): { token: string; epoch: number } | null;
  scope(): {
    organizationId: string | null;
    revision: number;
    signal: AbortSignal;
  };
  refresh(failedToken?: string): Promise<void>;
  clear(): void;
}
export interface ApiOptions {
  method?: string;
  body?: unknown;
  organization?: boolean;
  organizationId?: string;
  signal?: AbortSignal;
}
export class ApiClient {
  constructor(
    private readonly transport: JsonTransport,
    private readonly session: AccessSource,
  ) {}
  async request<T>(path: string, options: ApiOptions = {}): Promise<T> {
    const initial = this.session.access();
    if (!initial) throw new ApiError(401);
    const scoped = options.organization || options.organizationId !== undefined;
    const scope = this.session.scope();
    const organizationId =
      options.organizationId ??
      (options.organization ? scope.organizationId : null);
    if (scoped && !organizationId) throw new ApiError(403);
    const signals = [
      ...(options.signal ? [options.signal] : []),
      ...(scoped ? [scope.signal] : []),
    ];
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    const current = () => {
      if (
        initial.epoch !== this.session.access()?.epoch ||
        (scoped && scope.revision !== this.session.scope().revision)
      )
        throw new StaleContextError();
    };
    const send = async () => {
      current();
      const token = this.session.access()?.token;
      if (!token) throw new ApiError(401);
      return this.transport.request<T>(path, {
        ...options,
        headers: {
          authorization: `Bearer ${token}`,
          ...(organizationId ? { 'x-organization-id': organizationId } : {}),
        },
        signal,
      });
    };
    try {
      const result = await send();
      current();
      return result;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      current();
      await this.session.refresh(initial.token);
      current();
      try {
        const result = await send();
        current();
        return result;
      } catch (retryError) {
        if (
          retryError instanceof ApiError &&
          retryError.status === 401 &&
          this.session.access()?.epoch === initial.epoch
        )
          this.session.clear();
        throw retryError;
      }
    }
  }
}
