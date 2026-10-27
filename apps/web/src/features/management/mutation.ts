'use client';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api/client';
import { useApplication } from '../application/provider';
export function mutationMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409)
    return 'Bu kayıt başka bir kullanıcı tarafından değiştirilmiş olabilir veya mevcut bir kayıtla çakışıyor. Güncel kaydı görmek için pencereyi kapatıp yeniden açın.';
  return error instanceof Error
    ? error.message
    : 'İşlem tamamlanamadı. Tekrar deneyin.';
}
export function useMutation(onConflict: () => void) {
  const { client } = useApplication();
  const lock = useRef(false),
    active = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function run(
    path: string,
    options: { method: string; body?: unknown },
    success: () => void | Promise<void>,
  ) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await client.request(path, options);
      if (active.current) await success();
      return true;
    } catch (error) {
      if (
        active.current &&
        !(error instanceof Error && error.name === 'AbortError')
      ) {
        setError(mutationMessage(error));
        if (error instanceof ApiError && error.status === 409) onConflict();
      }
      return false;
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return { busy, error, run };
}
