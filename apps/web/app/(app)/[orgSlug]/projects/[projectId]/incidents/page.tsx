import type { Metadata } from 'next';
import { IncidentsScreen } from '@/features/incidents';

export const metadata: Metadata = { title: 'Incidents' };

export default function IncidentsPage() {
  return <IncidentsScreen />;
}
