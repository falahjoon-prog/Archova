import type { Metadata } from 'next';
import { SnapshotsScreen } from '@/features/reporting';

export const metadata: Metadata = { title: 'Snapshots' };

export default function SnapshotsPage() {
  return <SnapshotsScreen />;
}
