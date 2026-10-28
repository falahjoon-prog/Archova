import type { Metadata } from 'next';
import { InductionListScreen } from '@/features/inductions';

export const metadata: Metadata = { title: 'Site inductions' };

export default function InductionsPage() {
  return <InductionListScreen />;
}
