import type { Metadata } from 'next';
import { WarrantyScreen } from '@/features/warranty';

export const metadata: Metadata = { title: 'Warranty' };

export default function WarrantyPage() {
  return <WarrantyScreen />;
}
