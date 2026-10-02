import type { Metadata } from 'next';
import { DefectListScreen } from '@/features/defects';

export const metadata: Metadata = { title: 'Defects' };

export default function DefectsPage() {
  return <DefectListScreen />;
}
