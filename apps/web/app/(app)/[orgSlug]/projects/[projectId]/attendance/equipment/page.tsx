import type { Metadata } from 'next';
import { EquipmentScreen } from '@/features/equipment';

export const metadata: Metadata = { title: 'Equipment' };

export default function EquipmentPage() {
  return <EquipmentScreen />;
}
