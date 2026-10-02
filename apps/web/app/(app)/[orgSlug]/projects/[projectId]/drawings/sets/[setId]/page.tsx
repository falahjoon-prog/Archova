import type { Metadata } from 'next';
import { DrawingSetReviewScreen } from '@/features/drawings';

export const metadata: Metadata = { title: 'Review drawing set' };

export default async function DrawingSetPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  return <DrawingSetReviewScreen setId={decodeURIComponent(setId)} />;
}
