import type { Metadata } from 'next';
import { ClearanceScreen } from '@/features/attendance';

export const metadata: Metadata = { title: 'Site clearance' };

export default function AttendanceClearancePage() {
  return <ClearanceScreen />;
}
