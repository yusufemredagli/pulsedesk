'use client';
import { useCallback, useEffect, useState } from 'react';
import { useApplication } from '../application/provider';
export function useResource<T>(path: string | null, live = true) {
  const { client, state } = useApplication();
  const [result, setResult] = useState<{
    path: string | null;
    tenant: number;
    data?: T;
    error?: Error;
    loading: boolean;
  }>({ path: '', tenant: -1, loading: true });
  const [retry, setRetry] = useState(0);
  const tenant = state.tenantRevision;
  const revision = live ? state.dataRevision : 0;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setResult((old) => ({
        path,
        tenant,
        data: old.path === path && old.tenant === tenant ? old.data : undefined,
        loading: true,
      }));
      void client.request<T>(path, { signal: controller.signal }).then(
        (data) => {
          if (!controller.signal.aborted) {
            const observe = (row: unknown) => {
              if (
                row &&
                typeof row === 'object' &&
                'id' in row &&
                typeof row.id === 'string' &&
                'version' in row &&
                typeof row.version === 'number'
              )
                client.observeTicket(row.id, row.version);
            };
            observe(data);
            if (
              data &&
              typeof data === 'object' &&
              'data' in data &&
              Array.isArray(data.data)
            )
              data.data.forEach(observe);
            setResult({ path, tenant, data, loading: false });
          }
        },
        (error) => {
          if (!controller.signal.aborted)
            setResult({
              path,
              tenant,
              error:
                error instanceof Error ? error : new Error('Please try again.'),
              loading: false,
            });
        },
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, path, tenant, revision, retry]);
  const refresh = useCallback(() => setRetry((value) => value + 1), []);
  useEffect(() => {
    if (!live) return;
    const revisit = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = setInterval(revisit, 60000);
    window.addEventListener('focus', revisit);
    document.addEventListener('visibilitychange', revisit);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', revisit);
      document.removeEventListener('visibilitychange', revisit);
    };
  }, [live, refresh]);
  const current =
    result.path === path && result.tenant === tenant
      ? result
      : { loading: true, data: undefined, error: undefined };
  return { ...current, refresh };
}
export function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
