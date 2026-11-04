import type { Metadata } from 'next';
import { EstimateListScreen } from '@/features/estimating';

export const metadata: Metadata = { title: 'Estimates' };

export default function EstimatesPage() {
  return <EstimateListScreen />;
}
