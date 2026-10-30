import type { Metadata } from 'next';
import { RollCallScreen } from '@/features/attendance';

export const metadata: Metadata = { title: 'Roll call' };

export default function AttendanceRollCallPage() {
  return <RollCallScreen />;
}
