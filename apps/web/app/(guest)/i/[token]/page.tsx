import type { Metadata } from 'next';
import { InductionWorkerScreen } from '@/features/inductions';

export const metadata: Metadata = { title: 'Site induction' };

export default async function InductionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InductionWorkerScreen token={token} />;
}
