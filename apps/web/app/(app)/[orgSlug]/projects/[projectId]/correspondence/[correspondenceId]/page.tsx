import type { Metadata } from 'next';
import { CorrespondenceDetailScreen } from '@/features/correspondence';

export const metadata: Metadata = { title: 'Correspondence' };

export default async function CorrespondenceItemPage({
  params,
}: {
  params: Promise<{ correspondenceId: string }>;
}) {
  const { correspondenceId } = await params;
  return <CorrespondenceDetailScreen correspondenceId={decodeURIComponent(correspondenceId)} />;
}
