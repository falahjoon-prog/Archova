import type { Metadata } from 'next';
import { IncidentAnalyticsScreen } from '@/features/incident-analytics';

export const metadata: Metadata = { title: 'Injury analytics' };

export default function IncidentAnalyticsPage() {
  return <IncidentAnalyticsScreen />;
}
