import type { ReactNode } from 'react';
import { CentredShell } from '@/shared/layout/AppShell';

export default function OrgsLayout({ children }: { children: ReactNode }) {
  return <CentredShell>{children}</CentredShell>;
}
