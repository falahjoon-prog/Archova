import type { Metadata } from 'next';
import { TenderLinkScreen } from '@/features/tender-link';

export const metadata: Metadata = { title: 'Tender invitation' };

export default async function TenderLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TenderLinkScreen token={token} />;
}
