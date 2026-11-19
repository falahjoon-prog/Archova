import type { Metadata } from 'next';
import { SnapshotDetailScreen } from '@/features/reporting';

export const metadata: Metadata = { title: 'Snapshot' };

export default async function SnapshotPage({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = await params;
  return <SnapshotDetailScreen snapshotId={decodeURIComponent(snapshotId)} />;
}
