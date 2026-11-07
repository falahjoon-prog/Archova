import type { Metadata } from 'next';
import { AttendanceScreen } from '@/features/attendance';

export const metadata: Metadata = { title: 'Attendance' };

export default function AttendancePage() {
  return <AttendanceScreen />;
}
