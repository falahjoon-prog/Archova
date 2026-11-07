import type { Metadata } from 'next';
import { ReadinessScreen } from '@/features/reporting';

export const metadata: Metadata = { title: 'Tender readiness' };

export default function ReadinessPage() {
  return <ReadinessScreen />;
}
