import type { Metadata } from 'next';
import { LocationsScreen } from '@/features/locations';

export const metadata: Metadata = { title: 'Location tree' };

export default function LocationsPage() {
  return <LocationsScreen />;
}
