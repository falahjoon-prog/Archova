import type { Metadata } from 'next';
import { PretaskScreen } from '@/features/pretask';

export const metadata: Metadata = { title: 'Pre-task plans' };

export default function PretaskPlansPage() {
  return <PretaskScreen />;
}
