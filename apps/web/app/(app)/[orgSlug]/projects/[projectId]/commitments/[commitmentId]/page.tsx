import type { Metadata } from 'next';
import { CommitmentScreen } from '@/features/commitments';

export const metadata: Metadata = { title: 'Commitment' };

export default async function CommitmentPage({
  params,
}: {
  params: Promise<{ commitmentId: string }>;
}) {
  const { commitmentId } = await params;
  return <CommitmentScreen commitmentId={decodeURIComponent(commitmentId)} />;
}
