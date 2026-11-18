import type { Metadata } from 'next';
import { ActionPlansScreen } from '@/features/action-plans';

export const metadata: Metadata = { title: 'Action plans' };

export default function ActionPlansPage() {
  return <ActionPlansScreen />;
}
