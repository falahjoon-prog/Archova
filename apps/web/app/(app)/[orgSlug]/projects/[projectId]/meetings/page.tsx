import type { Metadata } from 'next';
import { MeetingsScreen } from '@/features/meetings';

export const metadata: Metadata = { title: 'Meetings' };

export default function MeetingsPage() {
  return <MeetingsScreen />;
}
