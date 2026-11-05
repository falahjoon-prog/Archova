import type { Metadata } from 'next';
import { ReportsScreen } from '@/features/reporting';

export const metadata: Metadata = { title: 'Reports' };

export default function ReportsPage() {
  return <ReportsScreen />;
}
