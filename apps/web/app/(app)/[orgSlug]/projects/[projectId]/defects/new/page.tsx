import type { Metadata } from 'next';
import { DefectNewScreen } from '@/features/defects';

export const metadata: Metadata = { title: 'New defect' };

export default function NewDefectPage() {
  return <DefectNewScreen />;
}
