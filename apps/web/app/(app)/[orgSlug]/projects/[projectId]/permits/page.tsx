import type { Metadata } from 'next';
import { PermitsScreen } from '@/features/permits';

export const metadata: Metadata = { title: 'Permits' };

export default function PermitsPage() {
  return <PermitsScreen />;
}
