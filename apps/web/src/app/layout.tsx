import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ApplicationProvider } from '../features/application/provider';
export const metadata: Metadata = {
  title: {
    default: 'PulseDesk — Support operations',
    template: '%s | PulseDesk',
  },
  description: 'A focused workspace for coordinated support operations.',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ApplicationProvider>{children}</ApplicationProvider>
      </body>
    </html>
  );
}
