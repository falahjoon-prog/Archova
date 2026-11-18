import type { Metadata } from 'next';
import { PlantScreen } from '@/features/plant';

export const metadata: Metadata = { title: 'Plant and equipment' };

export default function PlantPage() {
  return <PlantScreen />;
}
