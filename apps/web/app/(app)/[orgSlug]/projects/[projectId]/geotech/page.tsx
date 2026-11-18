import type { Metadata } from 'next';
import { GeotechScreen } from '@/features/geotech';

export const metadata: Metadata = { title: 'Civil and geotech' };

export default function GeotechPage() {
  return <GeotechScreen />;
}
