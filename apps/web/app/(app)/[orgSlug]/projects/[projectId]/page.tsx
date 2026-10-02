import type { Metadata } from 'next';
import { ProjectDetailScreen } from '@/features/projects';

export const metadata: Metadata = { title: 'Project' };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectDetailScreen projectId={decodeURIComponent(projectId)} />;
}
