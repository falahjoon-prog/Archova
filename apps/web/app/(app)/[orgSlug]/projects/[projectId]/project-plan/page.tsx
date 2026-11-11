import type { Metadata } from 'next';
import { ProjectPlanScreen } from '@/features/project-plan';

export const metadata: Metadata = { title: 'Action plan' };

export default function ProjectPlanPage() {
  return <ProjectPlanScreen />;
}
