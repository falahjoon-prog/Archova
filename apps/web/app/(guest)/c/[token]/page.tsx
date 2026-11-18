import type { Metadata } from 'next';
import { ClientLinkScreen } from '@/features/client-link';

export const metadata: Metadata = { title: 'Project progress' };

export default async function ClientLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientLinkScreen token={token} />;
}
