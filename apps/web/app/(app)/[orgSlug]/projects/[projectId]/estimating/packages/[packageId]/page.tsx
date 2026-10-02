import type { Metadata } from 'next';
import { PackageScreen } from '@/features/estimating';

export const metadata: Metadata = { title: 'Tender package' };

export default async function TenderPackagePage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  return <PackageScreen packageId={decodeURIComponent(packageId)} />;
}
