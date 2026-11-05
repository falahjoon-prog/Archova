import type { Metadata } from 'next';
import { DataExportScreen } from '@/features/data-export';

export const metadata: Metadata = { title: 'Export your data' };

export default function DataExportPage() {
  return <DataExportScreen />;
}
