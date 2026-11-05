import type { Metadata } from 'next';
import { WorkersScreen } from '@/features/attendance';

export const metadata: Metadata = { title: 'Workers' };

export default function AttendanceWorkersPage() {
  return <WorkersScreen />;
}
