'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ApplicationClient, INITIAL_APPLICATION } from './application-client';
const Context = createContext<ApplicationClient | null>(null);
export function ApplicationProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    try {
      return new ApplicationClient({
        baseUrl: process.env.NEXT_PUBLIC_API_URL,
      });
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!client) return;
    client.start();
    const revisit = () => {
      if (document.visibilityState === 'visible') void client.revisit();
    };
    document.addEventListener('visibilitychange', revisit);
    window.addEventListener('focus', revisit);
    return () => {
      document.removeEventListener('visibilitychange', revisit);
      window.removeEventListener('focus', revisit);
      client.stop();
    };
  }, [client]);
  if (!client)
    return (
      <main className="session-screen">
        <div className="session-card">
          <h1>Bağlantı ayarlarını kontrol edin</h1>
          <p>
            Erişimi yeniden sağlamak için çalışma alanı yöneticinizle iletişime
            geçin.
          </p>
        </div>
      </main>
    );
  return <Context.Provider value={client}>{children}</Context.Provider>;
}
export function useApplication() {
  const client = useContext(Context);
  if (!client) throw new Error('Application provider missing');
  return {
    client,
    state: useSyncExternalStore(
      client.subscribe,
      client.getSnapshot,
      () => INITIAL_APPLICATION,
    ),
  };
}
