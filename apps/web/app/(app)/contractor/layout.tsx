import type { ReactNode } from 'react';
import { CentredShell } from '@/shared/layout/AppShell';

export default function ContractorLayout({ children }: { children: ReactNode }) {
  return <CentredShell>{children}</CentredShell>;
}
