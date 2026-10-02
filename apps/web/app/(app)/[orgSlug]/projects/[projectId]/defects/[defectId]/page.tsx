import type { Metadata } from 'next';
import { DefectDetailScreen } from '@/features/defects';

export const metadata: Metadata = { title: 'Defect' };

export default async function DefectPage({ params }: { params: Promise<{ defectId: string }> }) {
  const { defectId } = await params;
  return <DefectDetailScreen defectId={decodeURIComponent(defectId)} />;
}
