import type { Metadata } from 'next';
import { SubcontractorWalletsScreen } from '@/features/subcontractor-wallets';

export const metadata: Metadata = { title: 'Subcontractor wallets' };

export default function SubcontractorWalletsPage() {
  return <SubcontractorWalletsScreen />;
}
