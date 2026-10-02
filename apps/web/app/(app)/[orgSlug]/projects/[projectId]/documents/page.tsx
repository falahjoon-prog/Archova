import type { Metadata } from 'next';
import { DocumentsScreen } from '@/features/documents';

export const metadata: Metadata = { title: 'Documents' };

export default function DocumentsPage() {
  return <DocumentsScreen />;
}
