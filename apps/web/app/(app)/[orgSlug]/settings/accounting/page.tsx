import type { Metadata } from 'next';
import { AccountingScreen } from '@/features/accounting';

export const metadata: Metadata = { title: 'Accounting' };

export default function AccountingPage() {
  return <AccountingScreen />;
}
