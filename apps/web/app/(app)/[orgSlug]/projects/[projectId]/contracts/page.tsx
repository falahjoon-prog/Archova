import type { Metadata } from 'next';
import { ContractListScreen } from '@/features/claims';

export const metadata: Metadata = { title: 'Contracts' };

export default function ContractsPage() {
  return <ContractListScreen />;
}
