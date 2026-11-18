import type { Metadata } from 'next';
import { DeliveriesScreen } from '@/features/deliveries';

export const metadata: Metadata = { title: 'Deliveries' };

export default function DeliveriesPage() {
  return <DeliveriesScreen />;
}
