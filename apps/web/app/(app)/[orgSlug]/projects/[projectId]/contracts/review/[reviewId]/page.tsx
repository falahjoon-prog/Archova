import type { Metadata } from 'next';
import { ReviewScreen } from '@/features/contract-review';

export const metadata: Metadata = { title: 'Contract review' };

export default async function ContractReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  return <ReviewScreen reviewId={decodeURIComponent(reviewId)} />;
}
