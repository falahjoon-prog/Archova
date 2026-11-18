import type { ReactNode } from 'react';
import { CentredShell } from '@/shared/layout/AppShell';

export default function OauthLayout({ children }: { children: ReactNode }) {
  return <CentredShell>{children}</CentredShell>;
}
