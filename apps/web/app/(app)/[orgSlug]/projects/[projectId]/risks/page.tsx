import type { Metadata } from 'next';
import { RisksScreen } from '@/features/risks';

export const metadata: Metadata = { title: 'Risk register' };

export default function RisksPage() {
  return <RisksScreen />;
}
