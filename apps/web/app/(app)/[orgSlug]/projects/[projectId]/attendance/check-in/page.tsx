import type { Metadata } from 'next';
import { CheckInScreen } from '@/features/attendance';

export const metadata: Metadata = { title: 'Site check-in' };

export default function AttendanceCheckInPage() {
  return <CheckInScreen />;
}
