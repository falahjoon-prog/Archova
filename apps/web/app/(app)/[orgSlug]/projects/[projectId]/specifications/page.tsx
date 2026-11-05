import type { Metadata } from 'next';
import { SpecificationsScreen } from '@/features/specifications';

export const metadata: Metadata = { title: 'Specifications' };

export default function SpecificationsPage() {
  return <SpecificationsScreen />;
}
