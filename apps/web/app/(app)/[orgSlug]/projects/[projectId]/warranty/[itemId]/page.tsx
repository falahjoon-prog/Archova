import type { Metadata } from 'next';
import { WarrantyItemScreen } from '@/features/warranty';

export const metadata: Metadata = { title: 'Warranty item' };

export default async function WarrantyItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  return <WarrantyItemScreen itemId={decodeURIComponent(itemId)} />;
}
