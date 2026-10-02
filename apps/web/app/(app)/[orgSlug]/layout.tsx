import type { ReactNode } from 'react';
import { OrgShell } from '@/features/orgs';

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  return <OrgShell orgSlug={decodeURIComponent(orgSlug)}>{children}</OrgShell>;
}
