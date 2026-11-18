import type { Metadata } from 'next';
import { DbpInsightsScreen } from '@/features/reporting';

export const metadata: Metadata = { title: 'DBP Act insights' };

export default function DbpInsightsPage() {
  return <DbpInsightsScreen />;
}
