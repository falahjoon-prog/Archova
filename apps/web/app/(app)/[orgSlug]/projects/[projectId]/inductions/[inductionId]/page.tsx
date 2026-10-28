import type { Metadata } from 'next';
import { InductionEditorScreen } from '@/features/inductions';

export const metadata: Metadata = { title: 'Edit induction' };

export default async function InductionEditorPage({
  params,
}: {
  params: Promise<{ inductionId: string }>;
}) {
  const { inductionId } = await params;
  return <InductionEditorScreen inductionId={inductionId} />;
}
