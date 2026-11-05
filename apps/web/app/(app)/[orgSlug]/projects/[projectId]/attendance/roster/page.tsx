import type { Metadata } from 'next';
import { RosterScreen } from '@/features/roster';

export const metadata: Metadata = { title: 'Roster' };

export default function RosterPage() {
  return <RosterScreen />;
}
