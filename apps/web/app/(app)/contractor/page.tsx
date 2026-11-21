import type { Metadata } from 'next';
import { ContractorPortalScreen } from '@/features/contractors';

export const metadata: Metadata = { title: 'Contractor portal' };

export default function ContractorPage() {
  return <ContractorPortalScreen />;
}
