import type { Metadata } from 'next';
import { EstimateScreen } from '@/features/estimating';

export const metadata: Metadata = { title: 'Estimate' };

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ estimateId: string }>;
}) {
  const { estimateId } = await params;
  return <EstimateScreen estimateId={decodeURIComponent(estimateId)} />;
}
