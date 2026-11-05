import type { Metadata } from 'next';
import { SubmittalDetailScreen } from '@/features/submittals';

export const metadata: Metadata = { title: 'Submittal' };

export default async function SubmittalPage({
  params,
}: {
  params: Promise<{ submittalId: string }>;
}) {
  const { submittalId } = await params;
  return <SubmittalDetailScreen submittalId={decodeURIComponent(submittalId)} />;
}
