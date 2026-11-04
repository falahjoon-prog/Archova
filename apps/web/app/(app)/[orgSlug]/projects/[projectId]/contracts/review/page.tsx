import type { Metadata } from 'next';
import { ReviewsScreen } from '@/features/contract-review';

export const metadata: Metadata = { title: 'Contract review' };

export default function ContractReviewsPage() {
  return <ReviewsScreen />;
}
