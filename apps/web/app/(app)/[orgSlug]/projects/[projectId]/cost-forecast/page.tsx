import type { Metadata } from 'next';
import { CostForecastScreen } from '@/features/claims';

export const metadata: Metadata = { title: 'Cost forecast' };

export default function CostForecastPage() {
  return <CostForecastScreen />;
}
