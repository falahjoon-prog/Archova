import type { Metadata } from 'next';
import { HazardSignalsScreen } from '@/features/hazard-signals';

export const metadata: Metadata = { title: 'Safety signals' };

export default function SafetySignalsPage() {
  return <HazardSignalsScreen />;
}
