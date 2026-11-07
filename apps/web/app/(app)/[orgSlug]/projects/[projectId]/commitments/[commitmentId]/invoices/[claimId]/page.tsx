import type { Metadata } from 'next';
import { InvoiceDetailScreen } from '@/features/commitments';

export const metadata: Metadata = { title: 'Payment application' };

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ commitmentId: string; claimId: string }>;
}) {
  const { commitmentId, claimId } = await params;
  return (
    <InvoiceDetailScreen
      commitmentId={decodeURIComponent(commitmentId)}
      claimId={decodeURIComponent(claimId)}
    />
  );
}
