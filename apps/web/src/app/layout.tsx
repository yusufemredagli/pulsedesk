import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ApplicationProvider } from '../features/application/provider';
export const metadata: Metadata = {
  title: {
    default: 'PulseDesk — Destek Operasyonları',
    template: '%s | PulseDesk',
  },
  description:
    'Destek operasyonlarını birlikte yönetmek için odaklı bir çalışma alanı.',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <ApplicationProvider>{children}</ApplicationProvider>
      </body>
    </html>
  );
}
