import type { Metadata } from 'next';
import { ProjectListScreen } from '@/features/projects';

export const metadata: Metadata = { title: 'Projects' };

export default function ProjectsPage() {
  return <ProjectListScreen />;
}
