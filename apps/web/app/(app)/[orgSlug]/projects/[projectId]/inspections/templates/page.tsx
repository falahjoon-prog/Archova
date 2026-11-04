import type { Metadata } from 'next';
import { TemplatesScreen } from '@/features/inspections';

export const metadata: Metadata = { title: 'Inspection checklists' };

export default function InspectionTemplatesPage() {
  return <TemplatesScreen />;
}
