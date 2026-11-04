import type { Metadata } from 'next';
import { ContractPlaybookScreen } from '@/features/contract-playbook';

export const metadata: Metadata = { title: 'Contract playbook' };

export default function ContractPlaybookPage() {
  return <ContractPlaybookScreen />;
}
