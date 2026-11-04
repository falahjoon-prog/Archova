import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccountingCallbackScreen } from '@/features/accounting';

export const metadata: Metadata = { title: 'Connecting accounting' };

export default async function AccountingCallbackPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  if (provider !== 'xero' && provider !== 'myob') notFound();
  return <AccountingCallbackScreen provider={provider} />;
}
