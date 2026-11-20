import type { Metadata } from 'next';
import { CompanyContractorsScreen } from '@/features/contractors';

export const metadata: Metadata = { title: 'Contractors' };

export default function ContractorsPage() {
  return <CompanyContractorsScreen />;
}
