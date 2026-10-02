import type { Metadata } from 'next';
import { RfiDetailScreen } from '@/features/rfis';

export const metadata: Metadata = { title: 'RFI' };

export default async function RfiPage({ params }: { params: Promise<{ rfiId: string }> }) {
  const { rfiId } = await params;
  return <RfiDetailScreen rfiId={decodeURIComponent(rfiId)} />;
}
