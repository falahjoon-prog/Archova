import type { Metadata } from 'next';
import { InsuranceScreen } from '@/features/insurance';

export const metadata: Metadata = { title: 'Insurance and bonds' };

export default function InsurancePage() {
  return <InsuranceScreen />;
}
