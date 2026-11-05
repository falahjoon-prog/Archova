import type { Metadata } from 'next';
import { PlanScreen } from '@/features/plan';

export const metadata: Metadata = { title: 'Plan and limits' };

export default function PlanPage() {
  return <PlanScreen />;
}
