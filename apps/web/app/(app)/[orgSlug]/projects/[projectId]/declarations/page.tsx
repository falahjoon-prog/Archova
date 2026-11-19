import type { Metadata } from 'next';
import { DeclarationsScreen } from '@/features/declarations';

export const metadata: Metadata = { title: 'Subcontractor declarations' };

export default function DeclarationsPage() {
  return <DeclarationsScreen />;
}
