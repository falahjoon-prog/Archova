import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FoldersCallbackScreen } from '@/features/folder-links';

export const metadata: Metadata = { title: 'Connecting SharePoint or Drive' };

export default async function FoldersCallbackPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  if (provider !== 'm365' && provider !== 'google') notFound();
  return <FoldersCallbackScreen provider={provider} />;
}
