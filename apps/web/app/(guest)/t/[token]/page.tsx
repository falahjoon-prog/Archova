import type { Metadata } from 'next';
import { TransmittalLinkScreen } from '@/features/transmittals';

export const metadata: Metadata = { title: 'Transmittal' };

export default async function TransmittalLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <TransmittalLinkScreen token={token} />;
}
