import type { Metadata } from 'next';
import { ContractNewScreen } from '@/features/claims';

export const metadata: Metadata = { title: 'New contract' };

export default function NewContractPage() {
  return <ContractNewScreen />;
}
