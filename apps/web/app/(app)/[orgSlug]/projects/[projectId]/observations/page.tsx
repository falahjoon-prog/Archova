import type { Metadata } from 'next';
import { ObservationsScreen } from '@/features/observations';

export const metadata: Metadata = { title: 'Observations' };

export default function ObservationsPage() {
  return <ObservationsScreen />;
}
