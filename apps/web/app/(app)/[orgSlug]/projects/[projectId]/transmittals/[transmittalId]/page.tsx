import type { Metadata } from 'next';
import { TransmittalDetailScreen } from '@/features/transmittals';

export const metadata: Metadata = { title: 'Transmittal' };

export default async function TransmittalPage({
  params,
}: {
  params: Promise<{ transmittalId: string }>;
}) {
  const { transmittalId } = await params;
  return <TransmittalDetailScreen transmittalId={decodeURIComponent(transmittalId)} />;
}
