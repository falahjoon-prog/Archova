import type { Metadata } from 'next';
import { ContractDetailScreen } from '@/features/claims';

export const metadata: Metadata = { title: 'Contract' };

export default async function ContractPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;
  return <ContractDetailScreen contractId={decodeURIComponent(contractId)} />;
}
