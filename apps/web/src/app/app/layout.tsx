import type { ReactNode } from 'react';
import { ApplicationShell } from '../../features/application/shell';
export default function AppLayout({ children }: { children: ReactNode }) {
  return <ApplicationShell>{children}</ApplicationShell>;
}
