import type { ReactNode } from 'react';
import { ProjectShell } from '@/features/projects';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectShell projectId={decodeURIComponent(projectId)}>{children}</ProjectShell>;
}
