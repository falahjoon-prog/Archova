import type { Metadata } from 'next';
import { ClaimDetailScreen } from '@/features/claims';

export const metadata: Metadata = { title: 'Payment claim' };

export default async function PaymentClaimPage({
  params,
}: {
  params: Promise<{ claimId: string }>;
}) {
  const { claimId } = await params;
  return <ClaimDetailScreen claimId={decodeURIComponent(claimId)} />;
}
