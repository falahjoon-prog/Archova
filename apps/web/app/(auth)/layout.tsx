import type { ReactNode } from 'react';
import { CentredShell } from '@/shared/layout/AppShell';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <CentredShell>{children}</CentredShell>;
}
