import type { Metadata } from 'next';
import { SitesScreen } from '@/features/attendance';

export const metadata: Metadata = { title: 'Sites and gates' };

export default function AttendanceSitesPage() {
  return <SitesScreen />;
}
